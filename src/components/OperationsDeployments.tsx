import { useMemo, useState } from "react";
import { useManagerFieldOfficerScope } from "@/lib/use-manager-scope";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, MapPin, Repeat, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages, fetchInChunks } from "@/lib/supabase-batch";
import { ROLE_KEYS } from "@/lib/role-keys";
import { logActivity } from "@/lib/activity-log";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PAGE = 25;
const MODULE = "Field Officer Deployments";

type UnitRow = { id: string; code: string | null; name: string | null; customer_id: string | null; status: string | null };
type FoRow = { id: string; full_name: string | null; employee_code: string | null };
type LinkRow = { candidate_id: string; unit_id: string };

type Directory = {
  units: UnitRow[];
  customerName: Map<string, string>;
  fos: FoRow[];
  foByUnit: Map<string, string[]>;
  unitsByFo: Map<string, string[]>;
};

async function loadDirectory(): Promise<Directory> {
  const [units, customers, fos] = await Promise.all([
    fetchAllPages<UnitRow>((from, to) =>
      supabase.from("units").select("id, code, name, customer_id, status").eq("status", "active").range(from, to).order("name"),
    ),
    fetchAllPages<{ id: string; name: string | null }>((from, to) =>
      supabase.from("customers").select("id, name").range(from, to),
    ),
    fetchAllPages<FoRow>((from, to) =>
      supabase
        .from("candidates")
        .select("id, full_name, employee_code")
        .eq("role_key", ROLE_KEYS.FIELD_OFFICER)
        .in("status", ["approved", "active"])
        .range(from, to)
        .order("full_name"),
    ),
  ]);

  const links = await fetchInChunks<LinkRow>(
    fos.map((f) => f.id),
    (chunk, from, to) =>
      supabase.from("candidate_units").select("candidate_id, unit_id").in("candidate_id", chunk).range(from, to),
  );

  const activeUnitIds = new Set(units.map((u) => u.id));
  const foByUnit = new Map<string, string[]>();
  const unitsByFo = new Map<string, string[]>();
  for (const l of links) {
    if (!activeUnitIds.has(l.unit_id)) continue;
    foByUnit.set(l.unit_id, [...(foByUnit.get(l.unit_id) ?? []), l.candidate_id]);
    unitsByFo.set(l.candidate_id, [...(unitsByFo.get(l.candidate_id) ?? []), l.unit_id]);
  }

  const customerName = new Map<string, string>();
  for (const c of customers) customerName.set(c.id, c.name ?? "");

  return { units, customerName, fos, foByUnit, unitsByFo };
}

/**
 * Deployments — every client site with the field officer covering it, plus the
 * reverse view by officer. Sites with no officer are the red flag operations
 * cares about.
 */
/** Keyword match: every word in the query must appear somewhere in the haystack. */
function matchesKeywords(haystack: string, query: string): boolean {
  const hay = haystack.toLowerCase();
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .every((token) => hay.includes(token));
}

export function OperationsDeployments() {
  const qc = useQueryClient();
  const [view, setView] = useState<"unit" | "officer">("unit");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [openFo, setOpenFo] = useState<string | null>(null);
  const [switchUnits, setSwitchUnits] = useState<UnitRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());


  const dirQ = useQuery({ queryKey: ["ops-deployments"], staleTime: 2 * 60_000, queryFn: loadDirectory });
  const mgrScope = useManagerFieldOfficerScope();
  // Managers see only their reporting officers and the sites those officers cover.
  const dir = useMemo(() => {
    const d = dirQ.data;
    if (!d || !mgrScope.isScoped) return d;
    const fo = mgrScope.fieldOfficerIds;
    const fos = d.fos.filter((f) => fo.has(f.id));
    const unitIds = new Set<string>();
    for (const f of fos) for (const u of d.unitsByFo.get(f.id) ?? []) unitIds.add(u);
    return {
      ...d,
      fos,
      units: d.units.filter((u) => unitIds.has(u.id)),
      unitsByFo: new Map([...d.unitsByFo].filter(([k]) => fo.has(k))),
      foByUnit: new Map([...d.foByUnit].filter(([k]) => unitIds.has(k)).map(([k, v]) => [k, v.filter((x) => fo.has(x))])),
    };
  }, [dirQ.data, mgrScope.isScoped, mgrScope.fieldOfficerIds]);

  const foName = (id: string) => {
    const f = dir?.fos.find((x) => x.id === id);
    return f ? `${f.full_name ?? "—"}${f.employee_code ? ` · ${f.employee_code}` : ""}` : "—";
  };
  const unitLabel = (u: UnitRow) =>
    [dir?.customerName.get(u.customer_id ?? "") || "", u.name || u.code || ""].filter(Boolean).join(" — ");

  const unitRows = useMemo(() => {
    if (!dir) return [] as UnitRow[];
    const term = search.trim();
    return dir.units.filter((u) => {
      const assigned = (dir.foByUnit.get(u.id) ?? []).length > 0;
      if (onlyUnassigned && assigned) return false;
      if (!term) return true;
      const officers = (dir.foByUnit.get(u.id) ?? []).map(foName).join(" ");
      return matchesKeywords(`${unitLabel(u)} ${u.code ?? ""} ${officers}`, term);
    });
  }, [dir, search, onlyUnassigned]);

  const officerRows = useMemo(() => {
    if (!dir) return [] as FoRow[];
    const term = search.trim();
    return dir.fos.filter((f) =>
      !term ? true : matchesKeywords(`${f.full_name ?? ""} ${f.employee_code ?? ""}`, term),
    );
  }, [dir, search]);

  const rowsLength = view === "unit" ? unitRows.length : officerRows.length;
  const pageCount = Math.max(1, Math.ceil(rowsLength / PAGE));
  const current = Math.min(page, pageCount - 1);
  const slice = <T,>(arr: T[]) => arr.slice(current * PAGE, current * PAGE + PAGE);

  const totalUnits = dir?.units.length ?? 0;
  const totalFos = dir?.fos.length ?? 0;
  const unassigned = useMemo(
    () => (dir ? dir.units.filter((u) => (dir.foByUnit.get(u.id) ?? []).length === 0).length : 0),
    [dir],
  );

  const switchMut = useMutation({
    mutationFn: async ({ units, foId }: { units: UnitRow[]; foId: string }) => {
      const unitIds = units.map((u) => u.id);
      const previousByUnit = new Map(unitIds.map((id) => [id, dir?.foByUnit.get(id) ?? []]));
      const previousIds = Array.from(new Set(Array.from(previousByUnit.values()).flat()));

      // One delete + one insert for the whole selection instead of per-site round trips.
      if (previousIds.length) {
        const { error } = await supabase
          .from("candidate_units")
          .delete()
          .in("unit_id", unitIds)
          .in("candidate_id", previousIds);
        if (error) throw error;
      }
      const { error: insErr } = await supabase.from("candidate_units").insert(
        unitIds.map((unit_id) => ({
          candidate_id: foId,
          unit_id,
          is_primary: false,
          is_reliever: false,
        })),
      );
      if (insErr && !String(insErr.message).includes("duplicate")) throw insErr;

      // Audit trail is fire-and-forget: it must never hold up the UI.
      void logActivity({
        module: MODULE,
        action: "update",
        entityType: "unit",
        entityId: unitIds[0] ?? "",
        entityLabel:
          units.length === 1 ? unitLabel(units[0]) : `${units.length} client sites`,
        details: {
          to: foName(foId),
          sites: units.map((u) => ({
            id: u.id,
            label: unitLabel(u),
            from: (previousByUnit.get(u.id) ?? []).map(foName),
          })),
        },
      });

      return { unitIds, foId, previousByUnit };
    },
    onSuccess: (res, vars) => {
      toast.success(
        vars.units.length > 1
          ? `Field officer assigned to ${vars.units.length} sites`
          : "Field officer reassigned",
      );
      setSwitchUnits(null);
      setSelected(new Set());
      // Patch the cached directory in place — a full reload here was the slow part.
      qc.setQueryData<Directory>(["ops-deployments"], (prev) => {
        if (!prev) return prev;
        const foByUnit = new Map(prev.foByUnit);
        const unitsByFo = new Map(prev.unitsByFo);
        for (const unitId of res.unitIds) {
          for (const oldFo of foByUnit.get(unitId) ?? []) {
            unitsByFo.set(oldFo, (unitsByFo.get(oldFo) ?? []).filter((u) => u !== unitId));
          }
          foByUnit.set(unitId, [res.foId]);
          const own = unitsByFo.get(res.foId) ?? [];
          if (!own.includes(unitId)) unitsByFo.set(res.foId, [...own, unitId]);
        }
        return { ...prev, foByUnit, unitsByFo };
      });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not reassign"),
  });


  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });


  return (
    <section className="rounded-2xl border border-border/60 bg-card/90 shadow-sm sm:rounded-3xl">
      <header className="space-y-3 border-b border-border/50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              Deployments
            </div>
            <h3 className="mt-0.5 font-display text-base font-bold tracking-tight text-foreground">
              {view === "unit" ? "By client site" : "By field officer"}
            </h3>
          </div>
          <div className="inline-flex rounded-lg border border-border/60 bg-background p-0.5 text-[11px] font-semibold">
            {(["unit", "officer"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setView(v); setPage(0); }}
                className={
                  view === v
                    ? "rounded-md bg-foreground px-3 py-1 text-background"
                    : "rounded-md px-3 py-1 text-muted-foreground hover:text-foreground"
                }
              >
                {v === "unit" ? "By site" : "By officer"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat icon={<MapPin className="h-3.5 w-3.5" />} tone="sky" label="Active sites" value={totalUnits} />
          <Stat icon={<Users className="h-3.5 w-3.5" />} tone="emerald" label="Field officers" value={totalFos} />
          <button type="button" onClick={() => { setView("unit"); setOnlyUnassigned((v) => !v); setPage(0); }} className="text-left">
            <Stat
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              tone="rose"
              label={onlyUnassigned ? "Unassigned · filtered" : "Unassigned sites"}
              value={unassigned}
            />
          </button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={view === "unit" ? "Search site, client or officer" : "Search field officer"}
            className="h-9 pl-8 text-sm"
          />
        </div>
      </header>

      {dirQ.isLoading ? (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">Loading deployments…</div>
      ) : view === "unit" ? (
        <ul className="divide-y divide-border/50">
          <li className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-4 py-2 text-[11px] font-semibold text-muted-foreground">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-foreground"
                checked={slice(unitRows).length > 0 && slice(unitRows).every((u) => selected.has(u.id))}
                onChange={(e) => {
                  const ids = slice(unitRows).map((u) => u.id);
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) ids.forEach((id) => next.add(id));
                    else ids.forEach((id) => next.delete(id));
                    return next;
                  });
                }}
              />
              Select all on this page
            </label>
            <span className="flex items-center gap-2">
              {selected.size > 0 && <span>{selected.size} selected</span>}
              {selected.size > 0 && (
                <>
                  <Button
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() =>
                      setSwitchUnits((dir?.units ?? []).filter((u) => selected.has(u.id)))
                    }
                  >
                    <Repeat className="h-3 w-3" /> Assign officer
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                </>
              )}
            </span>
          </li>
          {slice(unitRows).map((u) => {
            const officers = dir?.foByUnit.get(u.id) ?? [];
            return (
              <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 accent-foreground"
                    checked={selected.has(u.id)}
                    onChange={() => toggleSelected(u.id)}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-foreground">{unitLabel(u)}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {u.code ?? "—"} ·{" "}
                      {officers.length ? (
                        officers.map(foName).join(", ")
                      ) : (
                        <span className="font-semibold text-rose-600 dark:text-rose-400">No field officer</span>
                      )}
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-[11px]" onClick={() => setSwitchUnits([u])}>
                  <Repeat className="h-3 w-3" /> Switch officer
                </Button>
              </li>
            );
          })}

          {unitRows.length === 0 && (
            <li className="px-4 py-8 text-center text-xs text-muted-foreground">No sites match.</li>
          )}
        </ul>
      ) : (
        <ul className="divide-y divide-border/50">
          {slice(officerRows).map((f) => {
            const units = dir?.unitsByFo.get(f.id) ?? [];
            const open = openFo === f.id;
            return (
              <li key={f.id} className="px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => setOpenFo(open ? null : f.id)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-foreground">{f.full_name ?? "—"}</div>
                    <div className="text-[11px] text-muted-foreground">{f.employee_code ?? "—"}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-foreground">
                    {units.length} sites
                  </span>
                </button>
                {open && (
                  <ul className="mt-2 max-h-[260px] space-y-1 overflow-y-auto rounded-xl border border-border/50 bg-card/60 p-2">
                    {units.map((uid) => {
                      const u = dir?.units.find((x) => x.id === uid);
                      if (!u) return null;
                      return (
                        <li key={uid} className="flex items-center justify-between gap-2 text-[12px]">
                          <span className="truncate text-foreground">{unitLabel(u)}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{u.code ?? ""}</span>
                        </li>
                      );
                    })}
                    {units.length === 0 && (
                      <li className="py-3 text-center text-[11px] text-muted-foreground">No sites mapped yet.</li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
          {officerRows.length === 0 && (
            <li className="px-4 py-8 text-center text-xs text-muted-foreground">No field officers match.</li>
          )}
        </ul>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-border/50 px-4 py-2.5 text-[11px] font-semibold text-muted-foreground">
        <span>
          {rowsLength === 0
            ? "0 of 0"
            : `${current * PAGE + 1}–${Math.min(rowsLength, current * PAGE + PAGE)} of ${rowsLength}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span>
            {current + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={current + 1 >= pageCount}
            onClick={() => setPage(current + 1)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </footer>

      <SwitchOfficerDialog
        units={switchUnits}
        unitLabel={
          switchUnits && switchUnits.length === 1
            ? unitLabel(switchUnits[0])
            : `${switchUnits?.length ?? 0} sites selected`
        }
        current={
          switchUnits && switchUnits.length === 1
            ? (dir?.foByUnit.get(switchUnits[0].id) ?? []).map(foName)
            : []
        }
        fos={dir?.fos ?? []}
        saving={switchMut.isPending}
        onClose={() => setSwitchUnits(null)}
        onSave={(foId) => switchUnits && switchMut.mutate({ units: switchUnits, foId })}
      />

    </section>
  );
}

function SwitchOfficerDialog({
  units, unitLabel, current, fos, saving, onClose, onSave,
}: {
  units: UnitRow[] | null;

  unitLabel: string;
  current: string[];
  fos: FoRow[];
  saving: boolean;
  onClose: () => void;
  onSave: (foId: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const list = useMemo(() => {
    const t = term.trim();
    const filtered = !t
      ? fos
      : fos.filter((f) => matchesKeywords(`${f.full_name ?? ""} ${f.employee_code ?? ""}`, t));
    return filtered.slice(0, 60);
  }, [fos, term]);

  return (
    <Dialog open={!!units?.length} onOpenChange={(o) => { if (!o) { setTerm(""); setPicked(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Switch field officer</DialogTitle>
          <DialogDescription>
            {unitLabel}
            {current.length ? ` · currently ${current.join(", ")}` : " · currently unassigned"}
          </DialogDescription>
        </DialogHeader>

        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search field officer"
          className="h-9 text-sm"
        />
        <ul className="max-h-[280px] divide-y divide-border/50 overflow-y-auto rounded-xl border border-border/60">
          {list.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setPicked(f.id)}
                className={
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] " +
                  (picked === f.id ? "bg-foreground text-background" : "hover:bg-muted")
                }
              >
                <span className="truncate">{f.full_name ?? "—"}</span>
                <span className="shrink-0 text-[11px] opacity-70">{f.employee_code ?? ""}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">No field officers found.</li>
          )}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button disabled={!picked || saving} onClick={() => picked && onSave(picked)}>
            {saving
              ? "Saving…"
              : (units?.length ?? 0) > 1
              ? `Assign to ${units?.length} sites`
              : "Assign to this site"}
          </Button>

        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "emerald" | "sky" | "rose";
}) {
  const toneCls = {
    emerald: "text-emerald-700 bg-emerald-500/10 ring-emerald-500/20 dark:text-emerald-400",
    sky: "text-sky-700 bg-sky-500/10 ring-sky-500/20 dark:text-sky-400",
    rose: "text-rose-700 bg-rose-500/10 ring-rose-500/20 dark:text-rose-400",
  }[tone];
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 p-2.5">
      <div className={"inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 " + toneCls}>
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-[22px] font-black leading-none tracking-tight text-foreground">{value}</div>
    </div>
  );
}
