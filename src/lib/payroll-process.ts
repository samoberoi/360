// Payroll processing.
//
// Once attendance is locked and the payroll run is APPROVED, processing the
// run parks every computed money line into its permanent ledger:
//
//   • employee deductions      → public.deductions            (source_kind = 'payroll_run')
//   • employer contributions   → public.employer_contributions
//   • benefits / add-ons       → public.additions             (source_kind = 'payroll_run')
//
// Employees put ON HOLD are skipped entirely — nothing is posted for them and
// a row is written to public.payroll_processing_holds so the exclusion is
// auditable. Processing is idempotent: everything previously posted for the
// run is cleared first.

import { supabase } from "@/integrations/supabase/client";

export type ProcessLine = { name: string; amount: number };

export type ProcessableRow = {
  candidateId: string;
  employeeCode: string;
  name: string;
  earnings?: ProcessLine[];
  deductions: ProcessLine[];
  employerContributions: ProcessLine[];
  additions: ProcessLine[];
  paidDays?: number;
  edDays?: number;
  gross?: number;
  netPay: number;
};

export type ProcessResult = {
  processed: number;
  held: number;
  deductionRows: number;
  employerRows: number;
  additionRows: number;
  netTotal: number;
};

function mergeProcessLines(lines: ProcessLine[]): ProcessLine[] {
  const totals = new Map<string, ProcessLine>();
  for (const line of lines) {
    const name = String(line.name ?? "").trim();
    const amount = Number(line.amount) || 0;
    if (!name || Math.abs(amount) < 0.005) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const current = totals.get(key);
    totals.set(key, { name: current?.name ?? name, amount: (current?.amount ?? 0) + amount });
  }
  return Array.from(totals.values()).map((line) => ({
    ...line,
    amount: Math.round(line.amount * 100) / 100,
  }));
}


function pickDeductionTypeId(name: string, types: { id: string; code: string; name: string }[]): string {
  const n = name.toLowerCase();
  const byCode = (code: string) => types.find((t) => t.code === code)?.id;
  if (/\besi(c)?\b/.test(n)) return byCode("esi_employee") ?? byCode("general_deduction") ?? types[0].id;
  if (/\b(epf|pf|provident)\b/.test(n)) return byCode("epf_employee") ?? byCode("general_deduction") ?? types[0].id;
  if (/professional\s*tax|\bpt\b/.test(n)) return byCode("professional_tax") ?? byCode("general_deduction") ?? types[0].id;
  if (/\blwf\b|labour\s*welfare|welfare\s*fund/.test(n)) return byCode("lwf_employee") ?? byCode("welfare_fund") ?? types[0].id;
  if (/uniform|kit\b/.test(n)) return byCode("uniform") ?? byCode("general_deduction") ?? types[0].id;
  if (/gpaip|group\s*personal\s*accident/.test(n)) return byCode("gpaip") ?? byCode("general_deduction") ?? types[0].id;
  if (/recruit/.test(n)) return byCode("recruitment_fee") ?? byCode("general_deduction") ?? types[0].id;
  if (/advance/.test(n)) return byCode("salary_advance") ?? byCode("general_deduction") ?? types[0].id;
  return byCode("general_deduction") ?? byCode("miscellaneous") ?? types[0].id;
}

function pickAdditionTypeId(name: string, types: { id: string; code: string; name: string }[]): string {
  const n = name.toLowerCase();
  const byCode = (code: string) => types.find((t) => t.code === code)?.id;
  if (/bonus/.test(n)) return byCode("bonus") ?? byCode("miscellaneous") ?? types[0].id;
  if (/incentive/.test(n)) return byCode("incentive") ?? byCode("miscellaneous") ?? types[0].id;
  if (/arrear/.test(n)) return byCode("arrears") ?? byCode("miscellaneous") ?? types[0].id;
  if (/uniform/.test(n)) return byCode("uniform_allowance") ?? byCode("miscellaneous") ?? types[0].id;
  if (/extra\s*duty|overtime|\bot\b/.test(n)) return byCode("overtime_allowance") ?? byCode("miscellaneous") ?? types[0].id;
  if (/leave\s*encash/.test(n)) return byCode("leave_encashment") ?? byCode("miscellaneous") ?? types[0].id;
  return byCode("miscellaneous") ?? types[0].id;
}

/** Contribution cadence — everything computed from a monthly register is monthly today. */
function frequencyOf(name: string): "monthly" | "annual" | "half_yearly" {
  const n = name.toLowerCase();
  if (/gpaip|group\s*personal\s*accident|annual|yearly|gratuity|bonus/.test(n)) return "annual";
  if (/half\s*yearly|semi/.test(n)) return "half_yearly";
  return "monthly";
}

/** Turn any Supabase/Postgrest error object into a real Error with a readable message. */
export function asError(e: unknown, context: string): Error {
  if (e instanceof Error) return e;
  const o = (e ?? {}) as Record<string, unknown>;
  const bits = [o.message, o.details, o.hint, o.code].filter(Boolean).join(" — ");
  return new Error(`${context}: ${bits || JSON.stringify(o)}`);
}

/** Persist the exact figures paid for a run version so amendments can diff against them. */
async function writeSnapshots(args: {
  runId: string;
  unitId: string;
  version: number;
  rows: ProcessableRow[];
  heldIds: Set<string>;
  uid: string | null;
}) {
  await supabase
    .from("payroll_run_snapshots" as never)
    .delete()
    .eq("payroll_run_id", args.runId)
    .eq("version", args.version);

  // An employee can appear on several register rows (one per unit designation).
  // The snapshot is per candidate, so those rows are AGGREGATED — never dropped,
  // otherwise the paid figure is understated and a later amendment diff invents
  // a change for someone nobody touched.
  const byCandidate = new Map<string, ProcessableRow>();
  for (const r of args.rows) {
    if (!r.candidateId) continue;
    const prev = byCandidate.get(r.candidateId);
    if (!prev) {
      byCandidate.set(r.candidateId, { ...r });
      continue;
    }
    byCandidate.set(r.candidateId, {
      ...prev,
      paidDays: (Number(prev.paidDays) || 0) + (Number(r.paidDays) || 0),
      edDays: (Number(prev.edDays) || 0) + (Number(r.edDays) || 0),
      gross: (Number(prev.gross) || 0) + (Number(r.gross) || 0),
      netPay: (Number(prev.netPay) || 0) + (Number(r.netPay) || 0),
      earnings: mergeProcessLines([...(prev.earnings ?? []), ...(r.earnings ?? [])]),
      deductions: mergeProcessLines([...(prev.deductions ?? []), ...(r.deductions ?? [])]),
      employerContributions: mergeProcessLines([...(prev.employerContributions ?? []), ...(r.employerContributions ?? [])]),
      additions: mergeProcessLines([...(prev.additions ?? []), ...(r.additions ?? [])]),
    });
  }
  const payload = [...byCandidate.values()]
    .map((r) => ({
      payroll_run_id: args.runId,
      unit_id: args.unitId,
      candidate_id: r.candidateId,
      version: args.version,
      employee_code: r.employeeCode ?? "",
      full_name: r.name ?? "",
      paid_days: Number(r.paidDays) || 0,
      ed_days: Number(r.edDays) || 0,
      gross: Number(r.gross) || 0,
      total_deductions: (r.deductions ?? []).reduce((s, d) => s + (Number(d.amount) || 0), 0),
      total_employer: (r.employerContributions ?? []).reduce((s, d) => s + (Number(d.amount) || 0), 0),
      net_pay: Number(r.netPay) || 0,
      earnings: mergeProcessLines(r.earnings ?? []),
      deductions: mergeProcessLines(r.deductions ?? []),
      employer_contributions: mergeProcessLines(r.employerContributions ?? []),
      additions: mergeProcessLines(r.additions ?? []),
      on_hold: args.heldIds.has(r.candidateId),
      posted_by: args.uid,
    }));

  if (!payload.length) return;
  for (let i = 0; i < payload.length; i += 300) {
    const { error } = await supabase.from("payroll_run_snapshots" as never).insert(payload.slice(i, i + 300) as never);
    if (error) throw asError(error, "Could not save pay sheet snapshot");
  }
}


export async function processPayrollRun(args: {
  runId: string;
  unitId: string;
  unitLabel: string;
  periodStart: string;
  periodEnd: string;
  rows: ProcessableRow[];
  heldCandidateIds: string[];
  holdReason?: string;
  version?: number;
}): Promise<ProcessResult> {

  const { runId, unitId, unitLabel, periodStart, periodEnd, rows } = args;
  const held = new Set(args.heldCandidateIds);
  const payable = rows.filter((r) => !held.has(r.candidateId));

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id ?? null;

  const [{ data: dTypes }, { data: aTypes }] = await Promise.all([
    supabase.from("deduction_types").select("id, code, name"),
    supabase.from("addition_types").select("id, code, name"),
  ]);
  const deductionTypes = (dTypes ?? []) as { id: string; code: string; name: string }[];
  const additionTypes = (aTypes ?? []) as { id: string; code: string; name: string }[];
  if (deductionTypes.length === 0) throw new Error("No deduction types configured");
  if (additionTypes.length === 0) throw new Error("No addition types configured");

  const ref = `payroll_run:${runId}`;
  const periodLabel = `${unitLabel} · ${periodStart} → ${periodEnd}`;

  // Idempotent re-run: clear anything posted earlier for this run.
  const cleanup = await Promise.all([
    supabase.from("deductions").delete().eq("source_kind", "payroll_run").eq("source_ref", ref),
    supabase.from("additions" as never).delete().eq("source_kind", "payroll_run").eq("source_ref", ref),
    supabase.from("employer_contributions" as never).delete().eq("payroll_run_id", runId),
    supabase.from("payroll_processing_holds" as never).delete().eq("payroll_run_id", runId),
  ]);
  for (const c of cleanup) if (c.error) throw asError(c.error, "Could not clear previously posted payroll lines");

  const deductionRows: Record<string, unknown>[] = [];
  const additionRows: Record<string, unknown>[] = [];
  const employerRows: Record<string, unknown>[] = [];

  for (const r of payable) {
    for (const d of r.deductions) {
      const amount = Math.round((Number(d.amount) || 0) * 100) / 100;
      if (amount <= 0) continue;
      deductionRows.push({
        candidate_id: r.candidateId,
        deduction_type_id: pickDeductionTypeId(d.name, deductionTypes),
        deduction_name: d.name,
        deduction_date: periodEnd,
        amount,
        calculation_type: "lumpsum",
        entry_mode: "lumpsum",
        installments: 1,
        description: `Payroll ${periodLabel}`,
        status: "completed",
        source_kind: "payroll_run",
        source_ref: ref,
      });
    }
    for (const a of r.additions) {
      const amount = Math.round((Number(a.amount) || 0) * 100) / 100;
      if (amount <= 0) continue;
      additionRows.push({
        candidate_id: r.candidateId,
        addition_type_id: pickAdditionTypeId(a.name, additionTypes),
        addition_name: a.name,
        addition_date: periodEnd,
        amount,
        calculation_type: "lumpsum",
        entry_mode: "lumpsum",
        installments: 1,
        description: `Payroll ${periodLabel}`,
        status: "completed",
        source_kind: "payroll_run",
        source_ref: ref,
      });
    }
    for (const e of r.employerContributions) {
      const amount = Math.round((Number(e.amount) || 0) * 100) / 100;
      if (amount <= 0) continue;
      employerRows.push({
        candidate_id: r.candidateId,
        unit_id: unitId,
        payroll_run_id: runId,
        contribution_name: e.name,
        amount,
        frequency: frequencyOf(e.name),
        period_start: periodStart,
        period_end: periodEnd,
        contribution_date: periodEnd,
        status: "processed",
        notes: `Payroll ${periodLabel}`,
        source_kind: "payroll_run",
        source_ref: ref,
      });
    }
  }

  const holdRows = rows
    .filter((r) => held.has(r.candidateId))
    .map((r) => ({
      payroll_run_id: runId,
      candidate_id: r.candidateId,
      unit_id: unitId,
      reason: args.holdReason?.trim() || "Excluded from payroll processing",
      status: "on_hold",
      created_by: uid,
    }));

  const chunk = <T,>(arr: T[], size = 400) => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  for (const part of chunk(deductionRows)) {
    const { error } = await supabase.from("deductions").insert(part as never);
    if (error) throw asError(error, "Could not post deductions");
  }
  for (const part of chunk(additionRows)) {
    const { error } = await supabase.from("additions" as never).insert(part as never);
    if (error) throw asError(error, "Could not post additions");
  }
  for (const part of chunk(employerRows)) {
    const { error } = await supabase.from("employer_contributions" as never).insert(part as never);
    if (error) throw asError(error, "Could not post employer contributions");
  }
  if (holdRows.length) {
    const { error } = await supabase.from("payroll_processing_holds" as never).insert(holdRows as never);
    if (error) throw asError(error, "Could not save on-hold employees");
  }

  await writeSnapshots({ runId, unitId, version: args.version ?? 1, rows, heldIds: held, uid });



  const { error: runErr } = await supabase
    .from("payroll_runs" as never)
    .update({
      payroll_status: "processed",
      payroll_processed_at: new Date().toISOString(),
      payroll_processed_by: uid,
    } as never)
    .eq("id", runId);
  if (runErr) throw asError(runErr, "Could not mark the run processed");

  return {
    processed: payable.length,
    held: holdRows.length,
    deductionRows: deductionRows.length,
    employerRows: employerRows.length,
    additionRows: additionRows.length,
    netTotal: Math.round(payable.reduce((s, r) => s + (Number(r.netPay) || 0), 0) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Amendments
//
// A period that has already been processed is never re-posted wholesale. When
// an amended (v2+) attendance sheet is approved, only the employees whose money
// actually moved get a delta line:
//
//   net increase  → additions   ("Payroll arrears — <period> v2")
//   net decrease  → deductions  ("Payroll recovery — <period> v2")
//   employer cost → employer_contributions adjustment (may be negative)
//
// Everything is keyed on source_ref = payroll_run:<id>:v<version>, so
// re-processing the same amendment replaces its own lines and nothing else.
// ---------------------------------------------------------------------------

export type SnapshotTotals = {
  paidDays: number;
  edDays: number;
  gross: number;
  totalDeductions: number;
  totalEmployer: number;
  netPay: number;
};

export type AmendmentDelta = {
  candidateId: string;
  employeeCode: string;
  name: string;
  before: SnapshotTotals;
  after: SnapshotTotals;
  /** Component-level figures so each register (ESI, EPF, PT, LWF…) can be adjusted head by head. */
  earningsBefore?: ProcessLine[];
  earningsAfter?: ProcessLine[];
  deductionsBefore?: ProcessLine[];
  deductionsAfter?: ProcessLine[];
  employerBefore?: ProcessLine[];
  employerAfter?: ProcessLine[];
};

/** name → amount, canonical-cased, summing duplicate heads. */
export function linesToMap(lines: ProcessLine[] | undefined | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines ?? []) {
    const key = (l?.name || "").trim();
    if (!key) continue;
    m.set(key, Math.round(((m.get(key) ?? 0) + (Number(l.amount) || 0)) * 100) / 100);
  }
  return m;
}

/** Per-head before/after/delta for two line sets (union of names, zero-filled). */
export function diffLines(
  before: ProcessLine[] | undefined | null,
  after: ProcessLine[] | undefined | null,
): Array<{ name: string; before: number; after: number; delta: number }> {
  const b = linesToMap(before);
  const a = linesToMap(after);
  const names = Array.from(new Set([...b.keys(), ...a.keys()]));
  return names
    .map((name) => {
      const bv = b.get(name) ?? 0;
      const av = a.get(name) ?? 0;
      return { name, before: bv, after: av, delta: Math.round((av - bv) * 100) / 100 };
    })
    .sort((x, y) => x.name.localeCompare(y.name));
}


export type AmendmentResult = {
  version: number;
  affected: number;
  arrears: number;
  recoveries: number;
  netImpact: number;
  employerImpact: number;
};

export async function processPayrollAmendment(args: {
  runId: string;
  unitId: string;
  unitLabel: string;
  periodStart: string;
  periodEnd: string;
  version: number;
  deltas: AmendmentDelta[];
  rows: ProcessableRow[];
  heldCandidateIds: string[];
}): Promise<AmendmentResult> {
  const { runId, unitId, unitLabel, periodStart, periodEnd, version } = args;
  const held = new Set(args.heldCandidateIds);
  const ref = `payroll_run:${runId}:v${version}`;
  const periodLabel = `${unitLabel} · ${periodStart} → ${periodEnd}`;

  // An amendment raised after the run was paid is NOT settled money — it is an
  // open item recovered/paid in the NEXT payroll. It is therefore dated to the
  // first day of the next window (the apply date) and left status = 'active'
  // so the next run picks it up, instead of being closed as 'completed'.
  const applyDate = (() => {
    const d = new Date(`${periodEnd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const registeredOn = new Date().toISOString().slice(0, 10);
  const fmtDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });


  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id ?? null;

  const [{ data: dTypes }, { data: aTypes }] = await Promise.all([
    supabase.from("deduction_types").select("id, code, name"),
    supabase.from("addition_types").select("id, code, name"),
  ]);
  const deductionTypes = (dTypes ?? []) as { id: string; code: string; name: string }[];
  const additionTypes = (aTypes ?? []) as { id: string; code: string; name: string }[];
  if (!deductionTypes.length || !additionTypes.length) throw new Error("Deduction/addition types not configured");

  // Idempotent: wipe anything this amendment version posted before.
  await Promise.all([
    supabase.from("deductions").delete().eq("source_kind", "payroll_amendment").eq("source_ref", ref),
    supabase.from("additions" as never).delete().eq("source_kind", "payroll_amendment").eq("source_ref", ref),
    supabase.from("employer_contributions" as never).delete().eq("payroll_run_id", runId).eq("source_ref", ref),
  ]);

  const additionRows: Record<string, unknown>[] = [];
  const deductionRows: Record<string, unknown>[] = [];
  const employerRows: Record<string, unknown>[] = [];
  let arrears = 0;
  let recoveries = 0;
  let employerImpact = 0;

  for (const d of args.deltas) {
    if (held.has(d.candidateId)) continue;
    const netDelta = Math.round(((d.after.netPay || 0) - (d.before.netPay || 0)) * 100) / 100;
    const empDelta = Math.round(((d.after.totalEmployer || 0) - (d.before.totalEmployer || 0)) * 100) / 100;
    const dayDelta = Math.round(((d.after.paidDays || 0) - (d.before.paidDays || 0)) * 100) / 100;
    const reason =
      dayDelta === 0
        ? `Attendance amendment (v${version}) — pay revised`
        : dayDelta > 0
          ? `${dayDelta} extra payable day${Math.abs(dayDelta) === 1 ? "" : "s"} credited (v${version})`
          : `${Math.abs(dayDelta)} payable day${Math.abs(dayDelta) === 1 ? "" : "s"} short-paid, recovery (v${version})`;
    const note =
      `Reason: ${reason}. Payroll amendment v${version} — ${periodLabel}. `
      + `Paid days ${d.before.paidDays} → ${d.after.paidDays}, net ₹${d.before.netPay} → ₹${d.after.netPay}. `
      + `Registered on ${fmtDate(registeredOn)}; to be applied in the next payroll starting ${fmtDate(applyDate)}.`;

    const period = periodStart.slice(0, 7);

    // ---- 1. Wage side -----------------------------------------------------
    // The earnings movement (Basic, DA, HRA, Conv, WA…) is consolidated into a
    // SINGLE "Gross" line so the next payroll recovers/credits the whole wage
    // difference in one ledger row. The individual heads stay in the note.
    const earningDiffs = diffLines(d.earningsBefore, d.earningsAfter).filter((l) => Math.abs(l.delta) > 0.004);
    const deductionDiffs = diffLines(d.deductionsBefore, d.deductionsAfter).filter((l) => Math.abs(l.delta) > 0.004);
    const employerDiffs = diffLines(d.employerBefore, d.employerAfter).filter((l) => Math.abs(l.delta) > 0.004);

    const earningDeltaTotal = Math.round(earningDiffs.reduce((s, l) => s + l.delta, 0) * 100) / 100;
    const deductionDeltaTotal = Math.round(deductionDiffs.reduce((s, l) => s + l.delta, 0) * 100) / 100;

    // Fall back to the totals-only path when the caller could not supply lines
    // (older snapshots have no component jsonb).
    const grossDelta = earningDiffs.length
      ? earningDeltaTotal
      : Math.round((netDelta + deductionDeltaTotal) * 100) / 100;
    const headBreakup = earningDiffs
      .map((l) => `${l.name} ₹${l.before.toFixed(2)} → ₹${l.after.toFixed(2)}`)
      .join(", ");
    const wageLines: Array<{ name: string; delta: number }> =
      Math.abs(grossDelta) > 0.004 ? [{ name: "Gross", delta: grossDelta }] : [];

    for (const l of wageLines) {
      const detail =
        `${note} Gross ₹${(d.before.gross ?? 0).toFixed(2)} → ₹${(d.after.gross ?? 0).toFixed(2)} — `
        + `${l.delta >= 0 ? "credited" : "recovered"} ₹${Math.abs(l.delta).toFixed(2)}.`
        + (headBreakup ? ` Heads: ${headBreakup}.` : "");
      if (l.delta > 0) {
        arrears += l.delta;
        additionRows.push({
          candidate_id: d.candidateId,
          addition_type_id: pickAdditionTypeId(l.name, additionTypes),
          addition_name: `Gross arrears — amendment v${version} (${period})`,
          addition_date: applyDate,
          amount: Math.round(l.delta * 100) / 100,
          calculation_type: "lumpsum",
          entry_mode: "lumpsum",
          installments: 1,
          description: detail,
          status: "active",
          source_kind: "payroll_amendment",
          source_ref: ref,
        });
      } else {
        recoveries += Math.abs(l.delta);
        deductionRows.push({
          candidate_id: d.candidateId,
          deduction_type_id: pickDeductionTypeId("general", deductionTypes),
          deduction_name: `Gross deduction — amendment v${version} (${period})`,
          deduction_date: applyDate,
          // Ledger adjustments use signed net-impact values. A gross recovery
          // is negative because it reduces the employee's next net payroll;
          // payroll consumption recognises this head and applies its magnitude
          // as a deduction.
          amount: Math.round(l.delta * 100) / 100,
          calculation_type: "lumpsum",
          entry_mode: "lumpsum",
          installments: 1,
          description: detail,
          status: "active",
          source_kind: "payroll_amendment",
          source_ref: ref,
        });
      }
    }

    // ---- 2. Employee deduction heads --------------------------------------
    // A lower gross means less ESI / EPF / PT was actually due. Keep both
    // increases and reductions in the deduction ledger under their own head.
    // Reductions are signed negative rows: moving them to Additions would hide
    // the correction from the statutory deduction register.
    for (const l of deductionDiffs) {
      const typeId = pickDeductionTypeId(l.name, deductionTypes);
      const detail =
        `${note} Head: ${l.name} — ₹${l.before.toFixed(2)} → ₹${l.after.toFixed(2)} `
        + `(${l.delta >= 0 ? "additional recovery" : "excess deducted, refunded"} ₹${Math.abs(l.delta).toFixed(2)}).`;
      if (l.delta > 0) recoveries += l.delta;
      else arrears += Math.abs(l.delta);
      deductionRows.push({
        candidate_id: d.candidateId,
        deduction_type_id: typeId,
        deduction_name: `${l.name} — amendment v${version} (${period})`,
        deduction_date: applyDate,
        amount: Math.round(l.delta * 100) / 100,
        calculation_type: "lumpsum",
        entry_mode: "lumpsum",
        installments: 1,
        description: detail,
        status: "active",
        source_kind: "payroll_amendment",
        source_ref: ref,
      });
    }

    // ---- 3. Employer contribution heads -----------------------------------
    // Employer EPF / ESI / EDLI / admin charges move with the wage too — post
    // each head separately (amount may be negative) so the contribution
    // register nets off correctly instead of showing one blended adjustment.
    const empLines = employerDiffs.length
      ? employerDiffs
      : Math.abs(empDelta) > 0.004
        ? [{ name: "Employer cost", before: d.before.totalEmployer || 0, after: d.after.totalEmployer || 0, delta: empDelta }]
        : [];
    for (const l of empLines) {
      employerImpact += l.delta;
      employerRows.push({
        candidate_id: d.candidateId,
        unit_id: unitId,
        payroll_run_id: runId,
        contribution_name: `${l.name} — amendment v${version}`,
        amount: Math.round(l.delta * 100) / 100,
        frequency: frequencyOf(l.name),
        period_start: periodStart,
        period_end: periodEnd,
        contribution_date: applyDate,
        status: "active",
        notes:
          `${note} Head: ${l.name} — ₹${l.before.toFixed(2)} → ₹${l.after.toFixed(2)} `
          + `(${l.delta >= 0 ? "increase" : "reversal"} ₹${Math.abs(l.delta).toFixed(2)}).`,
        source_kind: "payroll_amendment",
        source_ref: ref,
      });
    }
  }


  if (additionRows.length) {
    const { error } = await supabase.from("additions" as never).insert(additionRows as never);
    if (error) throw asError(error, "Could not post arrears");
  }
  if (deductionRows.length) {
    const { error } = await supabase.from("deductions").insert(deductionRows as never);
    if (error) throw asError(error, "Could not post recoveries");
  }
  if (employerRows.length) {
    const { error } = await supabase.from("employer_contributions" as never).insert(employerRows as never);
    if (error) throw asError(error, "Could not post employer adjustments");
  }

  await writeSnapshots({ runId, unitId, version, rows: args.rows, heldIds: held, uid });

  const { error: runErr } = await supabase
    .from("payroll_runs" as never)
    .update({
      payroll_status: "processed",
      payroll_processed_at: new Date().toISOString(),
      payroll_processed_by: uid,
    } as never)
    .eq("id", runId);
  if (runErr) throw asError(runErr, "Could not mark the run processed");

  return {
    version,
    affected: new Set(
      [...additionRows, ...deductionRows].map((r) => String((r as { candidate_id?: string }).candidate_id ?? "")),
    ).size,

    arrears: Math.round(arrears * 100) / 100,
    recoveries: Math.round(recoveries * 100) / 100,
    netImpact: Math.round((arrears - recoveries) * 100) / 100,
    employerImpact: Math.round(employerImpact * 100) / 100,
  };
}

export async function fetchRunSnapshots(runId: string) {
  const { data, error } = await supabase
    .from("payroll_run_snapshots" as never)
    .select(
      "candidate_id, version, employee_code, full_name, paid_days, ed_days, gross, total_deductions, total_employer, net_pay, earnings, deductions, employer_contributions, additions, on_hold, posted_at",
    )
    .eq("payroll_run_id", runId)
    .order("version", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown) as Array<{
    candidate_id: string;
    version: number;
    employee_code: string;
    full_name: string;
    paid_days: number;
    ed_days: number;
    gross: number;
    total_deductions: number;
    total_employer: number;
    net_pay: number;
    earnings: ProcessLine[];
    deductions: ProcessLine[];
    employer_contributions: ProcessLine[];
    additions: ProcessLine[];
    on_hold: boolean;
    posted_at: string;
  }>;
}
