// Shared payroll computation helpers used by the Payroll section.
//
// Wage formulas mirror the attendance page derivations: a candidate's earned
// gross for a period is `per-day × T Days`, where per-day is derived from the
// contract resource's monthly gross divided by the configured payroll-day
// base. Percentage deductions/contributions are recalculated from earned
// component bases, while explicitly fixed statutory rows stay fixed.
//
// In addition, each contract line (component / benefit / deduction /
// employer contribution) may carry a `formulaMode` + `formulaExpression`
// snapshotted from Allowance Manager or Cost Component Manager. When
// present, that formula is evaluated against a per-employee context and
// REPLACES the legacy proration for that line. Statutory ESI/EPF/PT still
// run as a final post-pass unless the line opts out of statutory via its
// own formula.
import { evaluateFormula, parseFormulaConfig, slugifyVar, type FormulaContext } from "./formula-engine";

export type AttendanceEntryLike = {
  candidate_id: string;
  entry_date: string;
  code: string;
  ot_hours: number | string | null;
};

export type AttendanceCodeLike = {
  code: string;
  counts_as_present: boolean;
  is_paid: boolean;
  // Fractional day contributed to the payable-day bucket. HD (Half-Day) = 0.5,
  // full-day codes = 1.0 (default), non-paid absence codes should be 0.
  // Backfilled by migration; older code rows that predate the column read as 1.0.
  day_value?: number | null;
};

export type AttendanceTotals = {
  pDays: number;
  otHours: number;
  otDays: number;
  phDays: number;
  woDays: number;
  otherPaidDays: number;
  tDays: number;
};

export const UNIT_DUTY_HOURS = 8;

/**
 * Strip trailing percentage / numeric qualifiers from a component name so
 * variants like "HRA 5%", "HRA 15 %", "HRA (10%)" all collapse to "HRA".
 * Idempotent and safe on names without a suffix.
 */
export function canonicalComponentName(name: string): string {
  const raw = String(name ?? "").trim();
  if (!raw) return raw;
  // Remove trailing "[(]?<num>[%]?[)]?" segments and trailing tag words like
  // "CTC", "Employer", "Employee", "EE", "ER" so variants such as
  // "Reliever Charges CTC" and "Reliever Charges" collapse to one column.
  let out = raw;
  for (let i = 0; i < 4; i++) {
    const next = out
      .replace(/[\s\-_]*[\(\[]?\s*\d+(?:\.\d+)?\s*%\s*[\)\]]?\s*$/gi, "")
      .replace(/[\s\-_]+\d+(?:\.\d+)?\s*$/g, "")
      .replace(/[\s\-_]*[\(\[]?\s*(ctc)\s*[\)\]]?\s*$/gi, "")
      .trim();
    if (next === out) break;
    out = next;
  }
  return out || raw;
}

/**
 * Sum amounts of items whose names canonicalize to the same value.
 * Preserves first-seen order; display name = canonical form.
 */
export function mergeByCanonicalName<T extends { name: string; amount: number | string | null | undefined }>(
  items: T[] | null | undefined,
): { name: string; amount: number }[] {
  if (!items || items.length === 0) return [];
  const map = new Map<string, { name: string; amount: number }>();
  for (const it of items) {
    const key = canonicalComponentName(it.name);
    if (!key) continue;
    const prev = map.get(key);
    if (prev) prev.amount = Math.round((prev.amount + (Number(it.amount) || 0)) * 100) / 100;
    else map.set(key, { name: key, amount: Math.round((Number(it.amount) || 0) * 100) / 100 });
  }
  return Array.from(map.values());
}

export function computeAttendanceTotals(
  candidateId: string,
  periodDates: string[],
  entries: AttendanceEntryLike[],
  codes: AttendanceCodeLike[],
  /** Unit-level public holiday credit: present on one of these dates earns `multiplier` extra duties. */
  ph?: { dates: Iterable<string>; multiplier: number } | null,
  /** Employee joining date (YYYY-MM-DD). Holidays before this date earn no PH credit. */
  joiningDate?: string | null,
  /**
   * Per-unit override for the duty value of one PH-marked day (units.ph_day_value).
   * Null/undefined falls back to the PH code's day_value in Attendance Code settings.
   * Nothing about the holiday value is hard-coded anywhere in this file.
   */
  phDayValueOverride?: number | null,
): AttendanceTotals {
  const phDatesSet = new Set(ph?.dates ?? []);
  const phUnitMultiplier = Number(ph?.multiplier ?? 0) || 0;
  const phOverride =
    phDayValueOverride == null || Number.isNaN(Number(phDayValueOverride)) ? null : Number(phDayValueOverride);

  let unitPhDays = 0;
  const codeMap = new Map(codes.map((c) => [c.code, c]));
  const entryMap = new Map<string, AttendanceEntryLike>();
  for (const e of entries) {
    if (e.candidate_id === candidateId) entryMap.set(e.entry_date, e);
  }

  let pDays = 0;
  // NOTE: attendance_entries.ot_hours stores OT DAYS (0.5 = half OT day, 1 = one OT day).
  // The legacy "Hours" label is kept on the column for schema stability; the value is days.
  let otDaysSum = 0;
  let phCount = 0;
  let woCount = 0;
  let otherPaidDays = 0;

  for (const date of periodDates) {
    const e = entryMap.get(date);
    if (!e) continue;
    otDaysSum += Number(e.ot_hours) || 0;
    const c = codeMap.get(e.code);
    if (!c) continue;
    // National/public holiday credit is granted for the day itself, whether the
    // employee worked (P + PH) or not (A + PH). Only the multiplier matters.
    // A holiday that falls before the employee joined earns no credit.
    const joinedByThisDate = !joiningDate || date >= joiningDate;
    if (joinedByThisDate && phDatesSet.size > 0 && phUnitMultiplier > 0 && phDatesSet.has(date)) {
      unitPhDays += phUnitMultiplier;
    }
    if (e.code === "PH") {
      // Value of one Paid Holiday duty: the unit's own setting when present,
      // else the PH code's day_value from Attendance Code settings.
      const codeValue = c.day_value == null || Number.isNaN(Number(c.day_value)) ? 1 : Number(c.day_value);
      phCount += phOverride != null ? phOverride : codeValue;
      continue;
    }

    // Fractional day contribution: HD = 0.5, full-day codes = 1, WO/A/etc = 0.
    // Default to 1 for legacy rows that don't have day_value populated.
    const dv = c.day_value == null || Number.isNaN(Number(c.day_value)) ? 1 : Number(c.day_value);
    if (c.counts_as_present) pDays += dv;
    else if (c.is_paid) otherPaidDays += dv;
  }

  const phDays = round2(phCount + unitPhDays);

  const otDays = Math.round(otDaysSum * 100) / 100;
  const otHours = otDays;
  // Total PAID days = present + paid holiday (double) + extra duty ONLY.
  // Other "paid" attendance codes (leave etc.) are tracked but do NOT add
  // payable days and must never inflate earnings or contributions.
  const tDays = round2(pDays) + phDays + otDays;
  return { pDays: round2(pDays), otHours, otDays, phDays, otherPaidDays: round2(otherPaidDays), tDays };
}

export type FixedCalcMethod = "flat" | "per_duty";
export type FixedDutyBucket = "p_days" | "ot_days" | "ph_days" | "other_paid_days";
// Built-ins: "base_days" | "days_in_month" | "payable_days" | "fixed_26".
// Dynamic: "pdb:<uuid>" — references a Payroll Days Manager entry,
// resolved at runtime via options.dayBases passed to computeWages.
export type FixedDutyDivisor = string;

export type PayrollDayBaseDef = {
  id: string;
  code?: string | null;
  method: "actual_days" | "fixed_days" | "actual_minus_weekly_off" | "custom_weekdays" | "fixed_annual_average";
  fixedDays?: number | null;
  weeklyOffDay?: number | null;
  includedWeekdays?: number[] | null;
};

export type WageComponent = {
  allowanceId?: string | null;
  name: string;
  amount: number;
  calcType?: "percentage" | "fixed" | string;
  percentage?: number | string | null;
  baseComponents?: { label: string; operator: "+" | "-" }[];
  capAmount?: number | string | null;
  capFlatAmount?: number | string | null;
  includeInOt?: boolean | null;
  fixedCalcMethod?: FixedCalcMethod | null;
  fixedDutyComponents?: FixedDutyBucket[] | null;
  fixedDutyDivisor?: FixedDutyDivisor | null;
  formulaMode?: string | null;
  formulaExpression?: string | null;
  formulaVersion?: number | null;
};
export type BenefitLike = {
  name: string;
  amount: number | string | null;
  calcType?: "percentage" | "fixed" | string;
  percentage?: number | string | null;
  baseComponents?: { label: string; operator: "+" | "-" }[];
  capAmount?: number | string | null;
  capFlatAmount?: number | string | null;
  deductionCalcType?: "earned_salary" | "fixed_amount" | null;
  fixedCalcMethod?: FixedCalcMethod | null;
  fixedDutyComponents?: FixedDutyBucket[] | null;
  fixedDutyDivisor?: FixedDutyDivisor | null;
  formulaMode?: string | null;
  formulaExpression?: string | null;
  formulaVersion?: number | null;
};


export type ContractResourceLike = {
  designationId: string;
  components: WageComponent[];
  benefits: BenefitLike[];
  deductions: BenefitLike[];
  employerContributions: BenefitLike[];
  payrollDayBase: {
    method: "actual_days" | "fixed_days" | "actual_minus_weekly_off" | "custom_weekdays" | "fixed_annual_average";
    fixedDays: number | null;
    weeklyOffDay: number | null;
    includedWeekdays?: number[] | null;
  } | null;
};

export type WageComputation = {
  contractGross: number;
  perDayRate: number;
  baseDays: number;
  earnedGross: number;
  ratio: number;
  components: WageComponent[];
  benefits: WageComponent[];
  deductions: WageComponent[];
  employerContributions: WageComponent[];
  totalDeductions: number;
  totalEmployerContributions: number;
  netPay: number;
  employerCost: number;
  otBaseAmount: number;
  perDutyOtAmount: number;
  otDuties: number;
  totalOtAmount: number;
};

// Earned-component name matching the Extra Duty (ED) wage line.
export const EXTRA_DUTY_COMPONENT_RE = /extra\s*duty|\bovertime\b|\bover\s*time\b/i;

const ESI_NAME_RE = /\besi(c)?\b/i;
const ESI_EARNED_GROSS_CEILING = 21000;
const EPF_NAME_RE = /\bepf\b|provident\s*fund|\bpf\b/i;
const BONUS_NAME_RE = /\bbonus\b/i;
const GRATUITY_NAME_RE = /\bgratuity\b/i;

const round2 = (n: number) => Math.round(n * 100) / 100;

function hasConfiguredFormula(item: { formulaExpression?: string | null }): boolean {
  return !!item.formulaExpression?.trim();
}

function normFormulaName(name: string): string {
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formulaNameAliases(name: string): string[] {
  const raw = String(name ?? "").trim();
  if (!raw) return [];
  const canonical = canonicalComponentName(raw);
  const keys = new Set(
    [raw, canonical]
      .flatMap((label) => [normFormulaName(label), slugifyVar(label)])
      .filter(Boolean),
  );
  const compact = normFormulaName(canonical || raw);
  const pairs: Record<string, string[]> = {
    splallow: ["spl_allow", "specialallowance", "special_allowance"],
    splallowance: ["spl_allowance", "specialallowance", "special_allowance"],
    specialallowance: ["special_allowance", "splallow", "spl_allow", "splallowance", "spl_allowance"],
    convallow: ["conv_allow", "conveyanceallowance", "conveyance_allowance"],
    conveyanceallowance: ["conveyance_allowance", "convallow", "conv_allow"],
    wa: ["washingallowance", "washing_allowance"],
    washingallowance: ["washing_allowance", "wa"],
    hra: ["houserentallowance", "house_rent_allowance"],
    houserentallowance: ["house_rent_allowance", "hra"],
  };
  for (const alias of pairs[compact] ?? []) keys.add(alias);
  return Array.from(keys);
}

function addFormulaContextAliases(ctx: FormulaContext, amount: number, name: string) {
  for (const key of formulaNameAliases(name)) {
    const slug = slugifyVar(key);
    if (!slug) continue;
    ctx[slug] = round2((ctx[slug] ?? 0) + amount);
  }
}

function applyEsiRule(
  items: WageComponent[],
  share: number,
  _defaultName: string,
): WageComponent[] {
  // Only the FIRST matching row carries the statutory amount; any other
  // ESI-named rows are zeroed so the contract can't double-count ESI.
  // If the contract has no ESI row, do NOT auto-inject — the contract is
  // the source of truth for whether ESI applies to this resource.
  // CUSTOM-FORMULA WINS: if the row carries its own formula_expression,
  // keep the already-evaluated amount instead of overwriting with statutory.
  let placed = false;
  return items.map((i) => {
    if (!ESI_NAME_RE.test(i.name)) return i;
    if (hasConfiguredFormula(i)) return i;
    if (placed) return { ...i, amount: 0 };
    placed = true;
    return { ...i, amount: share };
  });
}

export function calculateEsiAmounts(
  earnedGross: number,
  earnedComponents: WageComponent[],
  options: { employeePct?: number; employerPct?: number; ceiling?: number } = {},
): { base: number; employee: number; employer: number } {
  const earnedComponentAmount = (pattern: RegExp) =>
    earnedComponents
      .filter((c) => pattern.test(c.name))
      .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const earnedWashing = earnedComponentAmount(/\bwashing\b/i);
  const earnedConveyance = earnedComponentAmount(/\bconveyance\b|\bconv\.?\b/i);
  const base = Math.max(0, earnedGross - earnedWashing - earnedConveyance);
  const ceiling = options.ceiling && options.ceiling > 0 ? options.ceiling : ESI_EARNED_GROSS_CEILING;
  if (base > ceiling) {
    return { base, employee: 0, employer: 0 };
  }
  // Statutory ESIC rule: only up to ₹21,000 earned gross; contributions are
  // rounded UP to the next rupee.
  const employeePct = options.employeePct && options.employeePct > 0 ? options.employeePct : 0.75;
  const employerPct = options.employerPct && options.employerPct > 0 ? options.employerPct : 3.25;
  return {
    base,
    employee: base > 0 ? Math.ceil(base * (employeePct / 100)) : 0,
    employer: base > 0 ? Math.ceil(base * (employerPct / 100)) : 0,
  };
}

export function applyEsiToWageComputation(
  wages: WageComputation,
  opts: { isDisabled?: boolean } = {},
): WageComputation {
  const firstEsi = (items: WageComponent[]) => items.find((i) => ESI_NAME_RE.test(i.name));
  const employeeEsi = firstEsi(wages.deductions);
  const employerEsi = firstEsi(wages.employerContributions);
  // Statutory disability workers get raised ceiling of ₹25,000.
  const configuredCeiling =
    Number(employeeEsi?.capAmount) || Number(employerEsi?.capAmount) || ESI_EARNED_GROSS_CEILING;
  const ceiling = opts.isDisabled
    ? Math.max(configuredCeiling, ESI_DISABILITY_CEILING)
    : configuredCeiling;
  const edAmount = wages.components
    .filter((c) => EXTRA_DUTY_COMPONENT_RE.test(c.name))
    .reduce((s2, c) => s2 + (Number(c.amount) || 0), 0);
  const esi = calculateEsiAmounts(
    Math.max(0, round2(wages.earnedGross - edAmount)),
    wages.components.filter((c) => !EXTRA_DUTY_COMPONENT_RE.test(c.name)),
    {
    employeePct: Number(employeeEsi?.percentage) || 0.75,
    employerPct: Number(employerEsi?.percentage) || 3.25,
      ceiling,
    },
  );
  const deductions = applyEsiRule(wages.deductions, esi.employee, "ESI Employee Contribution");
  const employerContributions = applyEsiRule(
    wages.employerContributions,
    esi.employer,
    "ESI Employer Contribution",
  );
  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  const totalEmployerContributions = employerContributions.reduce((s, d) => s + d.amount, 0);
  return {
    ...wages,
    deductions,
    employerContributions,
    totalDeductions: round2(totalDeductions),
    totalEmployerContributions: round2(totalEmployerContributions),
    netPay: Math.max(0, round2(wages.earnedGross - totalDeductions)),
    employerCost: round2(wages.earnedGross + totalEmployerContributions),
  };
}

// ---- Professional Tax (PT) ----
// PT is resolved per employee from the Professional Tax Manager slabs using:
//   - Unit billing state (with optional pincode for region disambiguation)
//   - Candidate gender (fallback "all")
//   - Earned gross for the period (monthly)
// The matching slab's tax_per_month becomes that employee's PT for the period.

export type PtSlabLike = {
  id?: string;
  state: string;
  region_label: string;
  salary_min: number;
  salary_max: number | null;
  tax_per_month: number;
  gender: string;
};

export type PincodeRangeLike = {
  state: string;
  region_label: string;
  range_start: number;
  range_end: number;
  is_excluded: boolean;
};

const PT_NAME_RE = /\bprofessional\s*tax\b|\bpt\b/i;
const ptNorm = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

export type PtResolveInput = {
  state?: string | null;
  pincode?: string | null;
  gender?: string | null;
  earnedGross: number;
  slabs: PtSlabLike[];
  ranges?: PincodeRangeLike[];
};

export type PtResolveResult = {
  amount: number;
  state: string | null;
  regionLabel: string | null;
  slabId: string | null;
  source: "resolved" | "no_state" | "no_slab" | "no_match";
};

export function resolvePtAmount(input: PtResolveInput): PtResolveResult {
  const { state, pincode, gender, earnedGross, slabs, ranges } = input;
  const stateStr = (state ?? "").trim();
  if (!stateStr) {
    return { amount: 0, state: null, regionLabel: null, slabId: null, source: "no_state" };
  }

  // 1) Narrow to slabs of this state.
  const stateSlabs = slabs.filter((s) => ptNorm(s.state) === ptNorm(stateStr));
  if (stateSlabs.length === 0) {
    return { amount: 0, state: stateStr, regionLabel: null, slabId: null, source: "no_slab" };
  }

  // 2) Pick region using pincode → range lookup; else most common region in state.
  let regionLabel: string | null = null;
  const pinTrim = (pincode ?? "").trim();
  if (pinTrim.length === 6 && ranges && ranges.length > 0) {
    const pin = parseInt(pinTrim, 10);
    if (Number.isFinite(pin)) {
      const containing = ranges.filter(
        (r) => ptNorm(r.state) === ptNorm(stateStr) && pin >= r.range_start && pin <= r.range_end,
      );
      const candidates: Array<{ region_label: string; span: number }> = [];
      for (const r of containing) {
        if (r.is_excluded) continue;
        const excluded = containing.some(
          (x) =>
            x.is_excluded &&
            ptNorm(x.region_label) === ptNorm(r.region_label),
        );
        if (excluded) continue;
        candidates.push({ region_label: r.region_label, span: r.range_end - r.range_start });
      }
      candidates.sort((a, b) => a.span - b.span);
      if (candidates.length > 0) regionLabel = candidates[0].region_label;
    }
  }

  let regionSlabs = regionLabel
    ? stateSlabs.filter((s) => ptNorm(s.region_label) === ptNorm(regionLabel!))
    : stateSlabs;
  if (regionSlabs.length === 0) {
    // Fallback: "All Pincodes" if present, else any region in the state.
    const allPincodes = stateSlabs.filter((s) => /all\s*pincodes/i.test(s.region_label));
    regionSlabs = allPincodes.length > 0 ? allPincodes : stateSlabs;
    regionLabel = regionSlabs[0]?.region_label ?? regionLabel;
  }

  // 3) Filter by gender. Try exact match, then "all".
  const g = (gender ?? "").trim().toLowerCase();
  let genderSlabs = regionSlabs.filter((s) => s.gender.toLowerCase() === g);
  if (genderSlabs.length === 0) {
    genderSlabs = regionSlabs.filter((s) => s.gender.toLowerCase() === "all");
  }
  if (genderSlabs.length === 0) {
    // Gender not recorded on the employee (or no "all" slab for this state,
    // e.g. Maharashtra which only has male/female slabs). Fall back to the
    // standard (male) schedule so PT is never silently skipped; the female
    // exemption only applies when gender is explicitly recorded as female.
    genderSlabs = regionSlabs.filter((s) => s.gender.toLowerCase() === "male");
  }
  if (genderSlabs.length === 0) {
    return { amount: 0, state: stateStr, regionLabel, slabId: null, source: "no_match" };
  }

  // 4) Find slab whose salary range covers earnedGross.
  const hit = genderSlabs.find(
    (s) =>
      earnedGross >= Number(s.salary_min || 0) &&
      (s.salary_max == null || earnedGross <= Number(s.salary_max)),
  );
  if (!hit) {
    return { amount: 0, state: stateStr, regionLabel, slabId: null, source: "no_match" };
  }
  return {
    amount: Number(hit.tax_per_month) || 0,
    state: stateStr,
    regionLabel,
    slabId: hit.id ?? null,
    source: "resolved",
  };
}

function applyPtRule(items: WageComponent[], amount: number, defaultName: string): WageComponent[] {
  // CUSTOM-FORMULA WINS: PT rows with their own formula keep the evaluated
  // amount. Statutory slab lookup only fills plain (formula-less) PT rows.
  const hasPt = items.some((i) => PT_NAME_RE.test(i.name));
  let placed = false;
  const mapped = items.map((i) => {
    if (!PT_NAME_RE.test(i.name)) return i;
    if (hasConfiguredFormula(i)) return i;
    if (placed) return { ...i, amount: 0 };
    placed = true;
    return { ...i, amount };
  });
  if (!hasPt && amount > 0) mapped.push({ name: defaultName, amount });
  return mapped;
}

export function applyPtToWageComputation(
  wages: WageComputation,
  ptAmount: number,
): WageComputation {
  const deductions = applyPtRule(wages.deductions, ptAmount, "Professional Tax (PT)");
  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  return {
    ...wages,
    deductions,
    totalDeductions: round2(totalDeductions),
    netPay: Math.max(0, round2(wages.earnedGross - totalDeductions)),
  };
}

// ---- Labour Welfare Fund (LWF) ----
// Live-synced from the LWF Master (Control Center) via `labour_welfare_funds`.
// Matches any deduction / employer-contribution row whose name mentions LWF or
// "Labour Welfare". If no matching row exists, does nothing (contracts opt in
// by including an LWF cost-component). Only fires in the configured
// deduction_months and only when the master row is enabled.
const LWF_NAME_RE = /\blwf\b|labour\s*welfare/i;

export type LwfApplyInput = {
  employee: number;
  employer: number;
  applies: boolean; // false => zero out both sides (out of window / disabled)
};

function applyLwfRule(items: WageComponent[], amount: number, applies: boolean): WageComponent[] {
  let placed = false;
  return items.map((i) => {
    if (!LWF_NAME_RE.test(i.name)) return i;
    if (hasConfiguredFormula(i)) return i; // custom formula wins
    if (!applies) return { ...i, amount: 0 };
    if (placed) return { ...i, amount: 0 };
    placed = true;
    return { ...i, amount: round2(amount) };
  });
}

export function applyLwfToWageComputation(
  wages: WageComputation,
  lwf: LwfApplyInput,
): WageComputation {
  const deductions = applyLwfRule(wages.deductions, lwf.employee, lwf.applies);
  const employerContributions = applyLwfRule(
    wages.employerContributions,
    lwf.employer,
    lwf.applies,
  );
  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  const totalEmployerContributions = employerContributions.reduce((s, d) => s + d.amount, 0);
  return {
    ...wages,
    deductions,
    employerContributions,
    totalDeductions: round2(totalDeductions),
    totalEmployerContributions: round2(totalEmployerContributions),
    netPay: Math.max(0, round2(wages.earnedGross - totalDeductions)),
    employerCost: round2(wages.earnedGross + totalEmployerContributions),
  };
}

// ---- Employer EPF row ----
// The employer PF contribution stays as ONE row, using the exact component
// name configured on the contract (e.g. "ER-EPF nocap"). We deliberately do
// NOT split it into an EPS + EPF Employer pair — the register must mirror the
// contract line-for-line. Kept as a no-op for call-site compatibility.
export function applyEpfBreakdownToWageComputation(
  wages: WageComputation,
  _options?: { epfCapEnabled?: boolean },
): WageComputation {
  return wages;
}


// ---- Statutory constants (industry defaults, exported for future engine work) ----
// These are the standard India statutory limits. They are exported here so
// downstream code can reference a single source of truth. The engine currently
// respects contract-configured percentages and caps for backward-compat; use
// these constants when hardening EPF / Bonus / Gratuity in a follow-up.
export const EPF_WAGE_CEILING = 15000;      // ₹15,000 monthly wage ceiling
export const EPS_CAP = 1250;                // 8.33% of 15,000 employer share cap
export const EDLI_RATE = 0.005;             // 0.5% of wages (capped by EPF ceiling)
export const EDLI_ADMIN_RATE = 0.005;       // 0.5% administrative charges
export const BONUS_CAP = 7000;              // Statutory bonus salary cap
export const BONUS_RATE_MIN = 0.0833;       // 8.33% minimum bonus
export const GRATUITY_RATE = 0.0481;        // 4.81% monthly accrual (15/26 of Basic per year)
export const ESI_DISABILITY_CEILING = 25000;// ₹25,000 ceiling for disabled workers

function scaleItems(items: BenefitLike[], ratio: number, perDuty?: (i: BenefitLike) => number): WageComponent[] {
  return items.map((i) => ({
    ...i,
    name: i.name,
    amount: i.fixedCalcMethod === "per_duty" && perDuty
      ? perDuty(i)
      : round2((Number(i.amount) || 0) * ratio),
  }));

}

function benefitAmountFromConfig(
  item: BenefitLike | undefined,
  earnedComponents: WageComponent[],
  contractComponents: WageComponent[],
  ratio: number,
): number {
  if (!item) return 0;
  if (item.calcType !== "percentage") return round2(Number(item.amount) || 0);

  const amountMap = (items: WageComponent[]) => {
    const map = new Map<string, number>();
    for (const c of items) {
      const amount = Number(c.amount) || 0;
      const keys = new Set(formulaNameAliases(c.name));
      keys.forEach((key) => map.set(key, round2((map.get(key) ?? 0) + amount)));
    }
    return map;
  };
  const earnedByName = amountMap(earnedComponents);
  const contractByName = amountMap(contractComponents);
  const earnedGross = round2(earnedComponents.reduce((sum, c) => sum + (Number(c.amount) || 0), 0));
  const contractGross = round2(contractComponents.reduce((sum, c) => sum + (Number(c.amount) || 0), 0));
  const bases = Array.isArray(item.baseComponents) ? item.baseComponents : [];
  const base = bases.reduce((sum, b) => {
    const key = normFormulaName(String(b.label ?? ""));
    const contractValue =
      key === "gross" || key === "fgross" || key === "fixedgross" || key === "contractgross"
        ? contractGross
        : contractByName.get(key) ?? 0;
    const value =
      key === "gross" || key === "earnedgross" || key === "egross" || key === "salarygross"
        ? earnedGross
        : (earnedByName.get(key) ?? round2(contractValue * ratio));
    return b.operator === "-" ? sum - value : sum + value;
  }, 0);
  let amount = (Number(item.percentage) || 0) * Math.max(0, base) / 100;
  const capAmount = Number(item.capAmount) || 0;
  if (capAmount > 0 && base > capAmount) {
    amount = Number(item.capFlatAmount) > 0
      ? Number(item.capFlatAmount) || 0
      : (Number(item.percentage) || 0) * capAmount / 100;
  }
  return round2(amount);
}

export function computeWages(
  totals: AttendanceTotals,
  resource: ContractResourceLike,
  periodDayCount: number,
  options?: {
    phOverrideAmount?: number;
    periodDates?: Date[];
    dayBases?: PayrollDayBaseDef[];
    /**
     * Unit-level EPF cap policy (units.epf_cap_enabled), inherited by the contract.
     * true  → EPF base is capped at the ₹15,000 wage ceiling.
     * false → no ceiling; EPF is computed on the full configured base.
     * undefined → legacy behaviour: whatever the contract line configures.
     */
    epfCapEnabled?: boolean;
  },
): WageComputation {
  const contractGross = resource.components.reduce(
    (s, c) => s + (Number(c.amount) || 0),
    0,
  );

  // Resolve base days from payroll-day-base method.
  // Default base = 26 (vendor convention for contract-labour wage registers)
  // rather than calendar days, so contracts without an explicit Payroll Day
  // Base still match the standard register format.
  const FALLBACK_BASE_DAYS = 26;
  let baseDays = FALLBACK_BASE_DAYS;
  const pdb = resource.payrollDayBase;
  if (pdb) {
    if (pdb.method === "fixed_days" && pdb.fixedDays && pdb.fixedDays > 0) {
      baseDays = pdb.fixedDays;
    } else if (pdb.method === "fixed_annual_average") {
      baseDays = 30.4166;
    } else if (pdb.method === "actual_minus_weekly_off") {
      // Rough approximation: assume ~4 weekly offs in the period.
      baseDays = Math.max(periodDayCount - 4, 1);
    } else if (pdb.method === "actual_days") {
      baseDays = periodDayCount;
    } else if (pdb.method === "custom_weekdays") {
      const allowed = Array.isArray(pdb.includedWeekdays) ? pdb.includedWeekdays : [];
      if (allowed.length === 0) {
        baseDays = FALLBACK_BASE_DAYS;
      } else if (options?.periodDates && options.periodDates.length > 0) {
        baseDays = options.periodDates.reduce(
          (n, d) => n + (allowed.includes(d.getDay()) ? 1 : 0),
          0,
        );
      } else {
        // No period dates available — approximate by ratio of allowed weekdays.
        baseDays = Math.max(Math.round((periodDayCount * allowed.length) / 7), 1);
      }
      if (baseDays <= 0) baseDays = FALLBACK_BASE_DAYS;
    } else {
      baseDays = FALLBACK_BASE_DAYS;
    }
  }
  if (baseDays <= 0) baseDays = FALLBACK_BASE_DAYS;

  // ---- New earning model (matches vendor wage register) ----
  // 1. Per-component base earnings prorate ONLY by present days:
  //        componentAmount × P / baseDays
  //    PH and OT no longer inflate every component.
  // 2. PH is paid as ONE separate line = (contractGross / baseDays) × PH_count.
  // 3. OT is paid as ONE separate line = (Basic+DA) / (baseDays × 8) × 2 × OT_hours.
  // 4. earnedGross = scaled components + PH line + OT line.
  // Verified against FPL May-2026 register (e.g. Sambhaji Mastake: 21 P ×
  // 26076/26 = 21,061.85 base + 1 PH × 1003.31 + 8 OT × (Basic+DA 12,888 /
  // 208) × 2 = 991.38  →  Gross 23,056).
  const perDayRate = contractGross / baseDays;
  // phDays is already expressed in duty-days (PH count × the PH day_value
  // configured in Attendance Code settings, plus unit holiday credit).
  const phCount = totals.phDays;

  // Earnings prorate on PRESENT days only. Non-present "paid" codes do not
  // add payable days; PH and ED are paid through their own separate lines.
  const basePaidDays = totals.pDays;
  const baseRatio = baseDays > 0 ? basePaidDays / baseDays : 0;

  // Per-duty / duty-bucket helpers (used by both component proration and
  // fixed-amount deductions/contributions further below).
  const dutyBucketValueEarly = (bucket: FixedDutyBucket): number => {
    switch (bucket) {
      case "p_days": return totals.pDays;
      case "ot_days": return totals.otDays;
      case "ph_days": return totals.phDays;
      case "other_paid_days": return totals.otherPaidDays;
      default: return 0;
    }
  };
  // Resolve a divisor key (built-in or "pdb:<uuid>" from Payroll Days
  // Manager) to its day count. Falls back to baseDays when unknown.
  const dayBasesById = new Map<string, PayrollDayBaseDef>();
  for (const b of options?.dayBases ?? []) dayBasesById.set(b.id, b);
  const resolveDayBaseCount = (base: PayrollDayBaseDef): number => {
    switch (base.method) {
      case "fixed_days":
        return Number(base.fixedDays) > 0 ? Number(base.fixedDays) : baseDays;
      case "fixed_annual_average":
        return 30.4166;
      case "actual_days":
        return periodDayCount;
      case "actual_minus_weekly_off": {
        const wd = base.weeklyOffDay;
        if (wd == null) return Math.max(periodDayCount - 4, 1);
        if (options?.periodDates && options.periodDates.length > 0) {
          return options.periodDates.reduce((n, d) => n + (d.getDay() === wd ? 0 : 1), 0);
        }
        return Math.max(periodDayCount - 4, 1);
      }
      case "custom_weekdays": {
        const allowed = Array.isArray(base.includedWeekdays) ? base.includedWeekdays : [];
        if (allowed.length === 0) return baseDays;
        if (options?.periodDates && options.periodDates.length > 0) {
          return options.periodDates.reduce((n, d) => n + (allowed.includes(d.getDay()) ? 1 : 0), 0);
        }
        return Math.max(Math.round((periodDayCount * allowed.length) / 7), 1);
      }
      default:
        return baseDays;
    }
  };
  const resolveDivisor = (key: FixedDutyDivisor | null | undefined): number => {
    if (typeof key === "string" && key.startsWith("pdb:")) {
      const base = dayBasesById.get(key.slice(4));
      if (base) {
        const n = resolveDayBaseCount(base);
        return n > 0 ? n : baseDays;
      }
      return baseDays;
    }
    switch (key) {
      case "days_in_month": return periodDayCount;
      case "payable_days":  return basePaidDays;
      case "fixed_26":      return 26;
      case "base_days":
      default:              return baseDays;
    }
  };
  const perDutyAmountEarly = (i: { amount?: number | string | null; fixedDutyComponents?: FixedDutyBucket[] | null; fixedDutyDivisor?: FixedDutyDivisor | null }): number => {
    const configured = Number(i.amount) || 0;
    const buckets = Array.isArray(i.fixedDutyComponents) ? i.fixedDutyComponents : [];
    const totalDuties = buckets.reduce((s, b) => s + dutyBucketValueEarly(b), 0);
    const divisor = resolveDivisor(i.fixedDutyDivisor);
    const perDuty = divisor > 0 ? configured / divisor : 0;
    return round2(perDuty * totalDuties);
  };

  // Pass 1: pro-rate every non-formula component so we know the earned
  // base value for each (Basic, Spl Allow, ...) BEFORE evaluating any
  // formula. This way a formula like `5% of (Basic + Spl Allow)` scales
  // with attendance instead of always returning the full-month amount.
  const componentEarnedAmounts: number[] = resource.components.map((c) => {
    if (c.fixedCalcMethod === "per_duty") return perDutyAmountEarly(c);
    return round2((Number(c.amount) || 0) * baseRatio);
  });
  const earnedContractGrossPreFormula = componentEarnedAmounts.reduce((s, v) => s + v, 0);

  // FormulaContext shared by every line that opts into the engine.
  // Variables match what Allowance Manager / Cost Component Manager expose.
  const baseFormulaCtx: FormulaContext = {
    basic: 0,
    da: 0,
    // `gross` exposed to formulas = earned gross (pro-rated).
    gross: round2(earnedContractGrossPreFormula),
    fixed_amount: 0,
    fixed_days: baseDays,
    working_days: periodDayCount,
    payable_days: basePaidDays,
    days_in_month: periodDayCount,
    present: totals.pDays,
    worked: totals.pDays, // alias of present (legacy)
    ot: totals.otDays,
    ph: totals.phDays,
    wo: 0,
    el: 0,
    pl: totals.otherPaidDays,
  };
  // Expose every contract component as a slugified variable, using the
  // PRO-RATED earned amount (not the full-month contract amount).
  resource.components.forEach((c, idx) => {
    addFormulaContextAliases(baseFormulaCtx, componentEarnedAmounts[idx] ?? 0, c.name);
  });

  const tryFormulaAmount = (
    item: { formulaMode?: string | null; formulaExpression?: string | null; amount?: number | string | null },
  ): number | null => {
    if (!hasConfiguredFormula(item)) return null;
    const cfg = parseFormulaConfig(item.formulaMode, item.formulaExpression);
    if (!cfg) return null;
    if (cfg.mode === "advanced" && (!cfg.expression || !cfg.expression.trim())) return null;
    // Flat-amount formulas also prorate: scale configured fixed_amount by ratio.
    const fixedAmt = round2((Number(item.amount) || 0) * baseRatio);
    const ctx: FormulaContext = { ...baseFormulaCtx, fixed_amount: fixedAmt };
    const r = evaluateFormula(cfg, ctx);
    return r.error ? null : r.amount;
  };

  // Pass 2: formula lines override the pass-1 pro-rated amount.
  const components: WageComponent[] = resource.components.map((c, idx) => {
    const fromFormula = tryFormulaAmount(c);
    const amount = fromFormula != null ? fromFormula : (componentEarnedAmounts[idx] ?? 0);
    return { ...c, name: c.name, amount };
  });

  // Paid Holiday line: when the caller provides a cash override (i.e. the
  // user entered a PH amount in Payroll Additions), use that exact rupee
  // value. Otherwise fall back to perDayRate × phCount derived from
  // attendance.
  const phOverride = options?.phOverrideAmount;
  const phAmount = phOverride != null && phOverride > 0
    ? round2(phOverride)
    : round2(perDayRate * phCount);
  if (phAmount > 0) {
    components.push({ name: "Paid Holiday", amount: phAmount, calcType: "fixed" });
  }

  // Overtime (statutory: Basic+DA / (baseDays × 8) × 2 × hours; here we
  // treat OT as days at basic/baseDays × 2). Fix: divisor now tracks the
  // contract's actual base-days rather than being hardcoded to 26, so a
  // 30-day contract doesn't underpay OT and a 26-day contract stays
  // backwards-compatible.
  const OT_DIVISOR = baseDays > 0 ? baseDays : 26;
  // Per-resource OT basis: the contract resource editor lets the user pick
  // exactly which wage components feed overtime (includeInOt). When at least
  // one component is explicitly selected we use that selection; otherwise we
  // fall back to the legacy basis (full contract gross minus uniform).
  const otSelected = resource.components.filter((c) => c.includeInOt !== false);
  let otBase: number;
  if (otSelected.length > 0) {
    otBase = Math.max(
      0,
      otSelected.reduce((s, c) => s + (Number(c.amount) || 0), 0),
    );
  } else {
    const excludedFromOt = resource.components
      .filter((c) => /\buniform\b/i.test(canonicalComponentName(c.name)))
      .reduce((s, c) => s + (Number(c.amount) || 0), 0);
    otBase = Math.max(0, contractGross - excludedFromOt);
  }

  const perDutyOt = otBase / OT_DIVISOR;
  const otAmount = round2(perDutyOt * totals.otDays);
  const otDuties = totals.otDays;
  if (otAmount > 0) {
    components.push({ name: "Extra Duty", amount: otAmount, calcType: "fixed" });
  }

  // Extra Duty (ED) is a pure earning. Statutory / contractual deductions and
  // employer contributions are NEVER computed on ED wages, so every benefit
  // base uses the earned components WITHOUT the Extra Duty line.
  const benefitBaseComponents = components.filter(
    (c) => !EXTRA_DUTY_COMPONENT_RE.test(c.name),
  );
  const earnedGrossExcludingEd = round2(
    benefitBaseComponents.reduce((s2, c) => s2 + (Number(c.amount) || 0), 0),
  );


  const earnedGross = round2(
    components.reduce((s, c) => s + (Number(c.amount) || 0), 0),
  );
  const ratio = contractGross > 0 ? earnedGross / contractGross : 0;
  const earnedSalaryRatio = baseRatio;
  // Fixed (non-prorated) deduction/contribution names. These stay at the
  // contract amount regardless of attendance — e.g. Uniform Charges is a
  // flat monthly recovery, LWF is a flat statutory monthly contribution.
  // Management Fee is intentionally NOT fixed — it prorates by T Days
  // like other earnings/contributions.
  // A row is treated as a fixed (non-prorated) deduction/contribution when
  // its configured deduction_calc_type is 'fixed_amount'. Legacy fallback:
  // when the row has no flag set (older contracts), use the historical
  // name-based heuristic so reproductions remain identical.
  const isFixedItem = (i: BenefitLike) => {
    if (i.deductionCalcType === "fixed_amount") return true;
    if (i.deductionCalcType === "earned_salary") return false;
    const n = i.name;
    return (
      /\buniform\b/i.test(n) ||
      /\blwf\b/i.test(n) ||
      /labour\s*welfare/i.test(n)
    );
  };
  // Per-duty proration for fixed-amount components (e.g. WC Policy):
  //   perDuty = configuredAmount / baseDays
  //   amount  = perDuty × Σ(selected duty buckets from totals)
  const dutyBucketValue = (bucket: FixedDutyBucket): number => {
    switch (bucket) {
      case "p_days": return totals.pDays;
      case "ot_days": return totals.otDays;
      case "ph_days": return totals.phDays;
      case "other_paid_days": return totals.otherPaidDays;
      default: return 0;
    }
  };
  const computePerDutyAmount = (i: BenefitLike): number => {
    const configured = Number(i.amount) || 0;
    const buckets = Array.isArray(i.fixedDutyComponents) ? i.fixedDutyComponents : [];
    const totalDuties = buckets.reduce((s, b) => s + dutyBucketValue(b), 0);
    const divisor = resolveDivisor(i.fixedDutyDivisor);
    const perDuty = divisor > 0 ? configured / divisor : 0;
    return round2(perDuty * totalDuties);
  };
  const resolveFixedAmount = (i: BenefitLike): number => {
    if (i.fixedCalcMethod === "per_duty") return computePerDutyAmount(i);
    return round2(Number(i.amount) || 0);
  };
  const scaleItemsRespectingFixed = (items: BenefitLike[]): WageComponent[] =>
    items.map((i) => {
      const fromFormula = tryFormulaAmount(i);
      const amount = fromFormula != null
        ? fromFormula
        : i.fixedCalcMethod === "per_duty"
        ? computePerDutyAmount(i)
        : isFixedItem(i)
        ? resolveFixedAmount(i)
        : i.calcType === "percentage"
        ? benefitAmountFromConfig(i, benefitBaseComponents, resource.components, earnedSalaryRatio)
        : round2((Number(i.amount) || 0) * earnedSalaryRatio);
      return { ...i, name: i.name, amount };
    });

  const benefits = (resource.benefits ?? []).map((i) => {
    const fromFormula = tryFormulaAmount(i);
    const amount = fromFormula != null
      ? fromFormula
      : i.fixedCalcMethod === "per_duty"
      ? computePerDutyAmount(i)
      : round2((Number(i.amount) || 0) * ratio);
    return { ...i, name: i.name, amount } as WageComponent;
  });
  const deductionsScaled = scaleItemsRespectingFixed(resource.deductions);
  const employerContributionsScaled = scaleItemsRespectingFixed(resource.employerContributions);

  // Statutory defaults: EPF caps base at ₹15,000 unless the contract
  // explicitly overrides the cap. This ensures every EPF contribution
  // respects the PF wage ceiling without requiring admins to remember to
  // type 15000 in Cost Component Manager.
  // CAP POLICY: the contract / Cost Component Manager is the single source of
  // truth for wage ceilings. We NEVER inject a statutory ceiling the admin did
  // not configure — doing so made payroll silently diverge from the contract
  // (e.g. "EE-EPF NoCap" contracted at 12% of 15,246 = 1,829.52 but paid on a
  // phantom 15,000 ceiling = 1,800). Only percentage / base defaults are filled.
  const epfCapPolicy = options?.epfCapEnabled;
  const applyEpfDefaults = (i: BenefitLike | undefined): BenefitLike | undefined => {
    if (!i) return i;
    if (hasConfiguredFormula(i)) return i;
    return {
      ...i,
      // Unit-level cap policy wins when set: capped units get the ₹15,000
      // ceiling even if the contract line omits it; no-cap units drop any
      // configured ceiling so EPF is paid on the full base.
      capAmount:
        epfCapPolicy === true
          ? (Number(i.capAmount) > 0 ? i.capAmount : EPF_WAGE_CEILING)
          : epfCapPolicy === false
          ? 0
          : i.capAmount,
      calcType: i.calcType ?? "percentage",
      percentage: Number(i.percentage) > 0 ? i.percentage : i.calcType === "percentage" ? 12 : i.percentage,
      baseComponents:
        Array.isArray(i.baseComponents) && i.baseComponents.length > 0
          ? i.baseComponents
          : [{ label: "Basic", operator: "+" }, { label: "DA", operator: "+" }],
    };
  };

  const findEpf = (items: BenefitLike[]) =>
    items.find((i) => EPF_NAME_RE.test(i.name));
  const employeeEpfItem = applyEpfDefaults(findEpf(resource.deductions));
  const employerEpfItem = applyEpfDefaults(findEpf(resource.employerContributions));
  const employeeEpfAmount = benefitAmountFromConfig(
    employeeEpfItem,
    benefitBaseComponents,
    resource.components,
    earnedSalaryRatio,
  );
  const employerEpfAmount = benefitAmountFromConfig(
    employerEpfItem,
    benefitBaseComponents,
    resource.components,
    earnedSalaryRatio,
  );

  // Only the FIRST EPF-named row carries the statutory amount; any other
  // EPF-named rows are zeroed so a contract listing multiple EPF lines
  // can't double-deduct.
  // CUSTOM-FORMULA WINS: rows whose contract line carries an explicit
  // formula_expression keep that evaluated amount; statutory EPF only
  // applies to plain (formula-less) EPF rows.
  const applyEpfRule = (items: WageComponent[], amount: number) => {
    let placed = false;
    return items.map((i) => {
      if (!EPF_NAME_RE.test(i.name)) return i;
      if (hasConfiguredFormula(i)) return i;
      if (placed) return { ...i, amount: 0 };
      placed = true;
      return { ...i, amount };
    });
  };

  // ---- Statutory Bonus (Payment of Bonus Act) ----
  // Rule: 8.33% of the configured base. Per CAP POLICY above, the ₹7,000
  // statutory salary cap is applied ONLY when the contract line configures it;
  // it is never auto-injected (that was making "Bonus SP" pay 583.10 instead of
  // the contracted 1,269.99 on a full 26/26 month).
  const applyBonusDefaults = (i: BenefitLike | undefined): BenefitLike | undefined => {
    if (!i) return i;
    if (hasConfiguredFormula(i)) return i;
    return {
      ...i,
      calcType: i.calcType ?? "percentage",
      percentage: Number(i.percentage) > 0 ? i.percentage : BONUS_RATE_MIN * 100,
      baseComponents:
        Array.isArray(i.baseComponents) && i.baseComponents.length > 0
          ? i.baseComponents
          : [{ label: "Basic", operator: "+" }, { label: "DA", operator: "+" }],
    };
  };

  const findBonus = (items: BenefitLike[]) =>
    items.find((i) => BONUS_NAME_RE.test(i.name));
  const employeeBonusItem = applyBonusDefaults(findBonus(resource.deductions));
  const employerBonusItem = applyBonusDefaults(findBonus(resource.employerContributions));
  const employeeBonusAmount = benefitAmountFromConfig(
    employeeBonusItem,
    benefitBaseComponents,
    resource.components,
    earnedSalaryRatio,
  );
  const employerBonusAmount = benefitAmountFromConfig(
    employerBonusItem,
    benefitBaseComponents,
    resource.components,
    earnedSalaryRatio,
  );
  const applyBonusRule = (items: WageComponent[], amount: number) => {
    let placed = false;
    return items.map((i) => {
      if (!BONUS_NAME_RE.test(i.name)) return i;
      if (hasConfiguredFormula(i)) return i;
      if (placed) return { ...i, amount: 0 };
      placed = true;
      return { ...i, amount };
    });
  };

  // ---- Statutory Gratuity (Payment of Gratuity Act) ----
  // Rule: 4.81% (= 15/26/12) of Basic+DA, no statutory cap on monthly
  // accrual. Only employer-side; auto-fills percentage when contract line
  // is a plain percentage row without an explicit value.
  const applyGratuityDefaults = (i: BenefitLike | undefined): BenefitLike | undefined => {
    if (!i) return i;
    if (hasConfiguredFormula(i)) return i;
    return {
      ...i,
      calcType: i.calcType ?? "percentage",
      percentage: Number(i.percentage) > 0 ? i.percentage : GRATUITY_RATE * 100,
      baseComponents:
        Array.isArray(i.baseComponents) && i.baseComponents.length > 0
          ? i.baseComponents
          : [{ label: "Basic", operator: "+" }, { label: "DA", operator: "+" }],
    };
  };
  const findGratuity = (items: BenefitLike[]) =>
    items.find((i) => GRATUITY_NAME_RE.test(i.name));
  const employerGratuityItem = applyGratuityDefaults(findGratuity(resource.employerContributions));
  const employerGratuityAmount = benefitAmountFromConfig(
    employerGratuityItem,
    benefitBaseComponents,
    resource.components,
    earnedSalaryRatio,
  );
  const applyGratuityRule = (items: WageComponent[], amount: number) => {
    let placed = false;
    return items.map((i) => {
      if (!GRATUITY_NAME_RE.test(i.name)) return i;
      if (hasConfiguredFormula(i)) return i;
      if (placed) return { ...i, amount: 0 };
      placed = true;
      return { ...i, amount };
    });
  };



  // ---- Statutory ESI override ----
  // Rule: ESI is computed on earned Gross minus earned Washing and
  // Conveyance allowances. Employee share = 0.75%, employer share = 3.25%.
  // Applied to any row whose name contains "ESI".
  const findEsi = (items: BenefitLike[]) => items.find((i) => ESI_NAME_RE.test(i.name));
  const employeeEsiItem = findEsi(resource.deductions);
  const employerEsiItem = findEsi(resource.employerContributions);
  const esi = calculateEsiAmounts(earnedGrossExcludingEd, benefitBaseComponents, {
    employeePct: Number(employeeEsiItem?.percentage) || 0.75,
    employerPct: Number(employerEsiItem?.percentage) || 3.25,
    ceiling:
      Number(employeeEsiItem?.capAmount) ||
      Number(employerEsiItem?.capAmount) ||
      ESI_EARNED_GROSS_CEILING,
  });

  const deductions = applyBonusRule(
    applyEsiRule(
      applyEpfRule(deductionsScaled, employeeEpfAmount),
      esi.employee,
      "ESI Employee Contribution",
    ),
    employeeBonusAmount,
  );
  const employerContributions = applyGratuityRule(
    applyBonusRule(
      applyEsiRule(
        applyEpfRule(employerContributionsScaled, employerEpfAmount),
        esi.employer,
        "ESI Employer Contribution",
      ),
      employerBonusAmount,
    ),
    employerGratuityAmount,
  );

  // ---- EPF wage-ceiling clamp ----
  // No EPF line (employee or employer, however it is configured — percentage,
  // formula or flat) may ever exceed its percentage applied to the PF wage
  // ceiling. Unit policy `epfCapEnabled === false` opts out of the ceiling.
  const clampEpf = (items: WageComponent[], contractItems: BenefitLike[]): WageComponent[] => {
    if (epfCapPolicy === false) return items;
    return items.map((i) => {
      if (!EPF_NAME_RE.test(i.name)) return i;
      const src = contractItems.find((c) => EPF_NAME_RE.test(c.name));
      const ceiling = Number(src?.capAmount) > 0 ? Number(src?.capAmount) : EPF_WAGE_CEILING;
      const pct = Number(src?.percentage) > 0 ? Number(src?.percentage) : 12;
      const maxAmount = Number(src?.capFlatAmount) > 0
        ? round2(Number(src?.capFlatAmount))
        : round2((pct * ceiling) / 100);
      return i.amount > maxAmount ? { ...i, amount: maxAmount } : i;
    });
  };

  // Extra-duty-only lines (no regular earnings in this window) carry NO
  // deductions and NO employer contributions at all.
  const edOnly = earnedGrossExcludingEd <= 0 && earnedGross > 0;
  const finalDeductions = edOnly ? [] : clampEpf(deductions, resource.deductions);
  const finalEmployerContributions = edOnly
    ? []
    : clampEpf(employerContributions, resource.employerContributions);
  const totalDeductions = finalDeductions.reduce((s, d) => s + d.amount, 0);
  const totalEmployerContributions = finalEmployerContributions.reduce(
    (s, d) => s + d.amount,
    0,
  );

  const netPay = Math.max(0, round2(earnedGross - totalDeductions));
  const employerCost =
    round2(earnedGross + totalEmployerContributions);

  return {
    contractGross,
    perDayRate: round2(perDayRate),
    baseDays,
    earnedGross,
    ratio,
    components,
    benefits,
    deductions: finalDeductions,
    employerContributions: finalEmployerContributions,
    totalDeductions: round2(totalDeductions),
    totalEmployerContributions: round2(totalEmployerContributions),
    netPay,
    employerCost,
    otBaseAmount: round2(otBase),
    perDutyOtAmount: round2(perDutyOt),
    otDuties: round2(otDuties),
    totalOtAmount: otAmount,
  };
}

export function fmtINR(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}
