import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, MapPinned, Search, UserRound, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useOperationalUnitScope } from "@/lib/use-manager-scope";
import { ListSkeleton } from "@/components/Skeletons";
import { useOperationsFocus, OPS_PEOPLE_ROLE_KEYS } from "@/lib/ops-scope";

export const Route = createFileRoute("/admin/attendance/employee")({
  head: () => ({
    meta: [
      { title: "Employee Attendance | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Search employees and review attendance across assigned clients." },
      { property: "og:title", content: "Employee Attendance | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Search employees and review attendance across assigned clients." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmployeeAttendanceLookupPage,
});

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

function monthRange(year: number, monthIdx: number) {
  const last = new Date(year, monthIdx + 1, 0).getDate();
  return {
    start: `${year}-${pad(monthIdx + 1)}-01`,
    end: `${year}-${pad(monthIdx + 1)}-${pad(last)}`,
    days: last,
  };
}

type CandidateHit = {
  id: string;
  full_name: string;
  employee_code: string | null;
  candidate_code: string | null;
  mobile: string | null;
  status: string | null;
  is_enabled: boolean | null;
  unit_id: string | null;
};

type UnitLite = { id: string; code: string; name: string };

type EntryRow = {
  unit_id: string;
  entry_date: string;
  code: string;
  ot_hours: number | string | null;
};

type CodeMeta = {
  code: string;
  label: string;
  color: string;
  day_value: number;
  counts_as_present: boolean;
};

function EmployeeAttendanceLookupPage() {
  const now = new Date();
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [selected, setSelected] = useState<CandidateHit | null>(null);
  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const foScope = useOperationalUnitScope();
  const opsFocus = useOperationsFocus();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTerm(term.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [term]);
  const search = debouncedTerm;

  const searchQ = useQuery({
    queryKey: ["attendance-employee-search", search, opsFocus],
    enabled: search.length >= 2,
    staleTime: 15_000,
    queryFn: async (): Promise<CandidateHit[]> => {
      const like = `%${search}%`;
      let qb = supabase
        .from("candidates")
        .select("id, full_name, employee_code, candidate_code, mobile, status, is_enabled, unit_id")
        .or(
          `full_name.ilike.${like},employee_code.ilike.${like},candidate_code.ilike.${like},mobile.ilike.${like}`,
        );
      // Operations leaders only look up field officers and the managers they
      // report to — never the guard roster.
      if (opsFocus) qb = qb.in("role_key", Array.from(OPS_PEOPLE_ROLE_KEYS));
      const { data, error } = await qb.order("full_name").limit(25);
      if (error) throw error;
      return (data ?? []) as CandidateHit[];
    },
  });

  const { start, end, days } = monthRange(year, monthIdx);

  const detailQ = useQuery({
    queryKey: ["attendance-employee-detail", selected?.id, start, end],
    enabled: !!selected?.id,
    queryFn: async () => {
      const candidateId = selected!.id;
      const [entriesRes, linksRes, codesRes] = await Promise.all([
        supabase
          .from("attendance_entries")
          .select("unit_id, entry_date, code, ot_hours")
          .eq("candidate_id", candidateId)
          .gte("entry_date", start)
          .lte("entry_date", end),
        supabase
          .from("candidate_units")
          .select("unit_id, is_primary, is_reliever, designation_id")
          .eq("candidate_id", candidateId),
        supabase
          .from("attendance_codes")
          .select("code, label, color, day_value, counts_as_present")
          .eq("enabled", true),
      ]);
      if (entriesRes.error) throw entriesRes.error;
      if (linksRes.error) throw linksRes.error;
      if (codesRes.error) throw codesRes.error;

      const entries = (entriesRes.data ?? []) as unknown as EntryRow[];
      const links = (linksRes.data ?? []) as unknown as Array<{
        unit_id: string;
        is_primary: boolean | null;
        is_reliever: boolean | null;
        designation_id: string | null;
      }>;


      const unitIds = Array.from(
        new Set<string>([
          ...entries.map((e) => e.unit_id),
          ...links.map((l) => l.unit_id),
          ...(selected!.unit_id ? [selected!.unit_id] : []),
        ]),
      );

      let units: UnitLite[] = [];
      if (unitIds.length) {
        const { data, error } = await supabase
          .from("units")
          .select("id, code, name")
          .in("id", unitIds);
        if (error) throw error;
        units = (data ?? []) as unknown as UnitLite[];
      }

      // Contracted designation held at each unit — the role slot that drives
      // salary and day caps, separate from the person's system role.
      const desigIds = Array.from(
        new Set(links.map((l) => l.designation_id).filter(Boolean)),
      ) as string[];
      const designationByUnit: Record<string, string> = {};
      if (desigIds.length) {
        const { data: desigs } = await supabase
          .from("designations")
          .select("id, name")
          .in("id", desigIds);
        const nameById = new Map(
          ((desigs ?? []) as unknown as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]),
        );
        for (const l of links) {
          if (l.designation_id && nameById.has(l.designation_id)) {
            designationByUnit[l.unit_id] = nameById.get(l.designation_id)!;
          }
        }
      }

      return {
        entries,
        links,
        units,
        designationByUnit,
        codes: (codesRes.data ?? []) as unknown as CodeMeta[],
      };

    },
  });

  const codeMap = useMemo(() => {
    const m = new Map<string, CodeMeta>();
    for (const c of detailQ.data?.codes ?? []) m.set(c.code, c);
    return m;
  }, [detailQ.data?.codes]);

  const unitBlocks = useMemo(() => {
    const d = detailQ.data;
    if (!d) return [];
    const unitsById = new Map(d.units.map((u) => [u.id, u]));
    const linkById = new Map(d.links.map((l) => [l.unit_id, l]));

    const ids = Array.from(
      new Set<string>([...d.entries.map((e) => e.unit_id), ...d.links.map((l) => l.unit_id)]),
    ).filter((id) => (foScope.isScoped ? foScope.unitIds.has(id) : true));

    return ids
      .map((id) => {
        const unit = unitsById.get(id);
        const link = linkById.get(id);
        const rows = d.entries.filter((e) => e.unit_id === id);
        const byDay = new Map<number, EntryRow>();
        for (const r of rows) byDay.set(Number(r.entry_date.slice(8, 10)), r);
        let presentDays = 0;
        let edHours = 0;
        for (const r of rows) {
          const meta = codeMap.get(r.code);
          if (meta?.counts_as_present) presentDays += Number(meta.day_value ?? 1);
          edHours += Number(r.ot_hours ?? 0);
        }
        return {
          id,
          name: unit?.name || unit?.code || "Unknown client",
          code: unit?.code || "",
          designation: d.designationByUnit[id] || "",
          isPrimary: !!link?.is_primary,
          isReliever: !!link?.is_reliever,
          byDay,
          presentDays,
          edHours,
          marked: rows.length,
        };

      })
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
  }, [detailQ.data, codeMap, foScope.isScoped, foScope.unitIds]);

  const totals = useMemo(
    () =>
      unitBlocks.reduce(
        (acc, b) => ({
          present: acc.present + b.presentDays,
          ed: acc.ed + b.edHours,
          marked: acc.marked + b.marked,
        }),
        { present: 0, ed: 0, marked: 0 },
      ),
    [unitBlocks],
  );

  const hits = searchQ.data ?? [];

  return (
    <div className="page-shell space-y-4">
      <PageHeader
        title="Employee attendance lookup"
        eyebrow="Attendance"
        icon={UserRound}
        description="View attendance across clients."
        crumbs={[{ label: "Attendance", to: "/admin/attendance" }, { label: "Employee lookup" }]}
        actions={
          <Button asChild variant="outline" size="sm" className="h-10 gap-1.5 text-xs">
            <Link to="/admin/attendance">
              <MapPinned className="h-3.5 w-3.5" /> Client view
            </Link>
          </Button>
        }
      />

      <div className="rounded-xl border border-border/70 bg-card p-2.5 shadow-sm sm:rounded-3xl sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search employees…"
              className="h-10 rounded-xl pl-10 pr-11 sm:h-12"
            />
            {term && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setTerm("")}
                className="absolute right-1 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full text-muted-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1.45fr)_1px_minmax(0,1fr)] items-center gap-1 rounded-xl border border-border/70 bg-background/60 p-1 sm:flex sm:rounded-2xl sm:p-1.5">
            <Select value={String(monthIdx)} onValueChange={(v) => setMonthIdx(Number(v))}>
              <SelectTrigger className="h-10 w-full rounded-xl border-0 bg-transparent shadow-none focus:ring-0 sm:w-[128px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((m, i) => (
                  <SelectItem key={m} value={String(i)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="h-5 w-px bg-border/70" />
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-10 w-full rounded-xl border-0 bg-transparent shadow-none focus:ring-0 sm:w-[92px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[year - 2, year - 1, year, year + 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {search.length >= 2 && (
          <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl border border-border/60">
            {searchQ.isLoading ? (
              <div className="p-3"><ListSkeleton rows={3} /></div>
            ) : hits.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No employee matched “{search}”.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(h)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60 ${
                        selected?.id === h.id ? "bg-muted/70" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">{h.full_name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {[h.employee_code || h.candidate_code, h.mobile, h.status].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {!selected ? (
        <div className="rounded-3xl border border-dashed border-border/70 bg-card/60 px-6 py-14 text-center">
          <UserRound className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Search for an employee</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Type at least two characters. Attendance is shown per unit, including reliever (extra duty) units.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
        <div className="grid grid-cols-1 gap-2 rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-sm sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:rounded-3xl sm:px-5 sm:py-3">
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold tracking-tight text-foreground">
                {selected.full_name}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {[selected.employee_code || selected.candidate_code, selected.mobile].filter(Boolean).join(" · ")} ·{" "}
                {MONTH_NAMES[monthIdx]} {year}
              </p>
            </div>
            <div className="scrollbar-hide flex max-w-full items-center gap-1.5 overflow-x-auto pb-0.5">
              <Stat label="Present days" value={totals.present.toFixed(2).replace(/\.00$/, "")} />
              <Stat label="Extra duty hrs" value={totals.ed.toFixed(2).replace(/\.00$/, "")} />
              <Stat label="Clients" value={String(unitBlocks.length)} />
            </div>
          </div>

          {detailQ.isLoading ? (
            <ListSkeleton rows={4} />
          ) : detailQ.error ? (
            <p className="rounded-3xl border border-border/70 bg-card px-5 py-10 text-center text-sm text-destructive">
              {detailQ.error instanceof Error ? detailQ.error.message : "Could not load attendance."}
            </p>
          ) : unitBlocks.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-border/70 bg-card/60 px-5 py-12 text-center text-sm text-muted-foreground">
              No units or attendance found for this employee in {MONTH_NAMES[monthIdx]} {year}.
            </p>
          ) : (
            unitBlocks.map((block) => (
              <div key={block.id} className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm sm:rounded-3xl">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/60 px-3 py-2.5 sm:px-5 sm:py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{block.name}</span>
                      {block.isPrimary ? (
                        <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-600">
                          Primary
                        </span>
                      ) : (
                        <span className="rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-violet-600">
                          Reliever · ED
                        </span>
                      )}
                      {block.designation && (
                        <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-sky-600">
                          {block.designation}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {block.code} · {block.designation || "Designation not set"} ·{" "}
                      {block.presentDays.toFixed(2).replace(/\.00$/, "")} present ·{" "}
                      {block.edHours.toFixed(2).replace(/\.00$/, "")} ED hrs
                    </p>

                  </div>
                  <Button asChild size="icon" variant="outline" className="h-9 w-9 shrink-0 rounded-lg sm:w-auto sm:gap-1.5 sm:px-3 sm:text-xs">
                    <Link to="/admin/attendance/$unitId" params={{ unitId: block.id }}>
                      <CalendarDays className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Open muster roll</span>
                    </Link>
                  </Button>
                </div>

                <div className="overflow-x-auto px-3 py-3 sm:px-4">
                  <div className="flex min-w-max gap-1">
                    {Array.from({ length: days }, (_, i) => i + 1).map((day) => {
                      const entry = block.byDay.get(day);
                      const meta = entry ? codeMap.get(entry.code) : undefined;
                      const ed = Number(entry?.ot_hours ?? 0);
                      return (
                        <div key={day} className="flex w-9 flex-col items-center gap-1">
                          <span className="text-[10px] font-medium text-muted-foreground">{day}</span>
                          <div
                            className="flex h-8 w-9 items-center justify-center rounded-lg border border-border/60 text-[11px] font-bold"
                            style={
                              meta
                                ? { backgroundColor: `${meta.color}1f`, color: meta.color, borderColor: `${meta.color}55` }
                                : undefined
                            }
                            title={meta ? `${meta.label}${ed ? ` · ED ${ed}h` : ""}` : "Not marked"}
                          >
                            {entry?.code || "·"}
                          </div>
                          <span className="text-[9px] font-semibold text-violet-600">
                            {ed ? `${ed}h` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5">
      <span className="text-sm font-bold tabular-nums text-foreground">{value}</span>
      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
    </div>
  );
}
