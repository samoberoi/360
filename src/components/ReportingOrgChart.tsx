import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Network, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/supabase-batch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Company reporting structure, built purely from data: each person's primary
 * manager (candidate_reporting_managers, falling back to candidates.reports_to).
 * Staff roles come from the `roles` table; the visible tree ends at field officers.
 */
type P = {
  id: string;
  full_name: string | null;
  employee_code: string | null;
  role_key: string | null;
  reports_to: string | null;
  designation_id: string | null;
};


async function load(rootCandidateId?: string) {
  const [{ data: roles, error: rolesError }, { data: desigs, error: desigsError }] = await Promise.all([
    supabase.from("roles" as never).select("key,name"),
    supabase.from("designations").select("id,name"),
  ]);
  if (rolesError) throw rolesError;
  if (desigsError) throw desigsError;
  const roleRows = ((roles ?? []) as unknown) as Array<{ key: string; name: string }>;
  const roleName = new Map(roleRows.map((r) => [r.key, r.name]));
  const people = await fetchAllPages<P>((from, to) =>
    supabase
      .from("candidates")
      .select("id, full_name, employee_code, role_key, reports_to, designation_id")
      .in("status", ["active", "approved"])
      .order("full_name")
      .range(from, to),
  );
  const crm = await fetchAllPages<{ candidate_id: string; manager_id: string; is_primary: boolean; unit_id: string | null }>(
    (from, to) =>
      supabase
        .from("candidate_reporting_managers")
        .select("candidate_id, manager_id, is_primary, unit_id")
        .range(from, to),
  );
  const desig = new Map((((desigs ?? []) as unknown) as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]));
  const ids = new Set(people.map((p) => p.id));
  const mgr = new Map<string, string>();
  // Primary unit-agnostic link wins, then any link, then reports_to.
  const ranked = [...crm].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || Number(Boolean(a.unit_id)) - Number(Boolean(b.unit_id)) || a.manager_id.localeCompare(b.manager_id));
  for (const r of ranked) if (!mgr.has(r.candidate_id) && ids.has(r.manager_id) && r.manager_id !== r.candidate_id) mgr.set(r.candidate_id, r.manager_id);
  for (const p of people) if (!mgr.has(p.id) && p.reports_to && ids.has(p.reports_to) && p.reports_to !== p.id) mgr.set(p.id, p.reports_to);
  // Break cycles.
  for (const p of people) {
    const seen = new Set<string>([p.id]);
    let cur = mgr.get(p.id);
    while (cur) {
      if (seen.has(cur)) { mgr.delete(p.id); break; }
      seen.add(cur);
      cur = mgr.get(cur);
    }
  }
  // Strict hierarchy, stopping at Field Officer: DGM → Branch Manager →
  // Operations Manager (incl. Assistant) → Field Officer. A person hangs under
  // their manager only when the manager sits exactly one level above; anyone
  // else is listed once under "Not mapped to anybody".
  const RANK: Record<string, number> = { dgm: 0, branch_manager: 1, operations_manager: 2, field_officer: 3 };
  const inScope = (id: string) => {
    if (!rootCandidateId) return true;
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current && !seen.has(current)) {
      if (current === rootCandidateId) return true;
      seen.add(current);
      current = mgr.get(current);
    }
    return false;
  };
  const shown = people.filter((p) => p.role_key != null && p.role_key in RANK && inScope(p.id));
  const staffCounts = new Map<string, number>();
  for (const p of people) {
    if (p.role_key && p.role_key in RANK) continue;
    let manager = mgr.get(p.id);
    const seen = new Set<string>([p.id]);
    while (manager && !seen.has(manager)) {
      seen.add(manager);
      staffCounts.set(manager, (staffCounts.get(manager) ?? 0) + 1);
      manager = mgr.get(manager);
    }
  }
  const byId = new Map(shown.map((p) => [p.id, p]));
  const rank = (p: P) => RANK[p.role_key as string];
  const kids = new Map<string, P[]>();
  const roots: P[] = [];
  const parentOf = new Map<string, string>();
  for (const p of shown) {
    const m = mgr.get(p.id);
    const mp = m ? byId.get(m) : undefined;
    if (p.id === rootCandidateId) roots.push(p);
    else if (mp && rank(mp) === rank(p) - 1) parentOf.set(p.id, mp.id);
    else if (rank(p) === 0) roots.push(p);
  }
  // Only people whose chain reaches a DGM are placed in the tree.
  const placed = new Set<string>(roots.map((r) => r.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [c, m] of parentOf) {
      if (!placed.has(c) && placed.has(m)) { placed.add(c); grew = true; }
    }
  }
  for (const p of shown) {
    const m = parentOf.get(p.id);
    if (m && placed.has(p.id)) kids.set(m, [...(kids.get(m) ?? []), p]);
  }
  const unmapped = shown
    .filter((p) => !placed.has(p.id))
    .sort((a, b) => rank(a) - rank(b) || (a.full_name ?? "").localeCompare(b.full_name ?? ""));
  const managerName = (p: P) => {
    const m = mgr.get(p.id);
    return m ? people.find((x) => x.id === m)?.full_name ?? null : null;
  };
  const label = (p: P) =>
    (p.designation_id && desig.get(p.designation_id)) ||
    (p.role_key && roleName.get(p.role_key)) ||
    p.role_key ||
    "";
  return { roots, kids, unmapped, managerName, label, staffCounts, total: shown.length };
}

function count(id: string, kids: Map<string, P[]>): number {
  return (kids.get(id) ?? []).reduce((n, k) => n + 1 + count(k.id, kids), 0);
}

function Card({ p, label, total, staffTotal, isOpen, hasKids, onClick }: { p: P; label: string; total: number; staffTotal: number; isOpen: boolean; hasKids: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      aria-label={`${p.full_name}, ${label}${hasKids ? `, ${isOpen ? "collapse" : "expand"} reports` : ""}`}
      aria-expanded={hasKids ? isOpen : undefined}
      data-person-id={p.id}
      className="relative mx-auto flex h-auto min-h-24 w-48 shrink-0 flex-col items-center gap-0 rounded-lg border border-border/70 bg-card px-3 py-2 text-center shadow-sm transition hover:border-primary/60 hover:shadow-md"
    >
      <span className="w-full whitespace-normal break-words text-[12px] font-bold text-foreground">{p.full_name}</span>
      <span className="mt-0.5 w-full whitespace-normal rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{label}</span>
      <span className="mt-0.5 font-mono text-[9px] text-muted-foreground">{p.employee_code ?? "\u00a0"}</span>
      {staffTotal > 0 && <span className="mt-1 text-[10px] text-muted-foreground">{staffTotal} site staff</span>}
      {hasKids && (
        <span className="absolute -bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-background px-1.5 text-[9px] font-bold text-muted-foreground">
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{total}
        </span>
      )}
    </Button>
  );
}

function Node({ p, kids, label, staffCounts, open, toggle, match }: {
  p: P; kids: Map<string, P[]>; label: (p: P) => string;
  staffCounts: Map<string, number>;
  open: Set<string>; toggle: (id: string) => void; match: (p: P) => boolean;
}) {
  const children = (kids.get(p.id) ?? []).filter(match);
  const isOpen = open.has(p.id);
  const total = count(p.id, kids);
  return (
    <li className="org-node">
      <Card p={p} label={label(p)} total={total} staffTotal={staffCounts.get(p.id) ?? 0} isOpen={isOpen} hasKids={children.length > 0} onClick={() => children.length && toggle(p.id)} />
      {isOpen && children.length > 0 && (
        <ul className="org-children">
          {children.map((c) => (
            <Node key={c.id} p={c} kids={kids} label={label} staffCounts={staffCounts} open={open} toggle={toggle} match={match} />
          ))}
        </ul>
      )}
    </li>
  );
}

const ORG_CSS = `
.org-tree, .org-tree ul { display:flex; justify-content:center; padding-top:20px; position:relative; margin:0; }
.org-tree { padding-top:0; }
.org-tree li.org-node { list-style:none; position:relative; padding:20px 6px 0; display:flex; flex-direction:column; align-items:center; }
.org-tree > li.org-node { padding-top:0; }
.org-children > li.org-node::before, .org-children > li.org-node::after { content:''; position:absolute; top:0; right:50%; width:50%; height:20px; border-top:1.5px solid var(--border); }
.org-children > li.org-node::after { right:auto; left:50%; border-left:1.5px solid var(--border); }
.org-children > li.org-node:only-child::before, .org-children > li.org-node:only-child::after { display:none; }
.org-children > li.org-node:only-child { padding-top:20px; }
.org-children > li.org-node:first-child::before, .org-children > li.org-node:last-child::after { border:0 none; }
.org-children > li.org-node:last-child::before { border-right:1.5px solid var(--border); border-radius:0 6px 0 0; }
.org-children > li.org-node:first-child::after { border-radius:6px 0 0 0; }
.org-children::before { content:''; position:absolute; top:0; left:50%; height:20px; border-left:1.5px solid var(--border); }
.org-children > li.org-node:only-child { padding-top:20px; }
.org-children:has(> li.org-node:only-child) > li::before { display:block; border:0; border-left:0; }
.org-leaves { position:relative; padding-top:20px; }
.org-leaves::before { content:''; position:absolute; top:0; left:50%; height:20px; border-left:1.5px solid var(--border); }
`;

export function ReportingOrgChart({ rootCandidateId }: { rootCandidateId?: string }) {
  const q = useQuery({ queryKey: ["reporting-org-chart", rootCandidateId ?? "all"], staleTime: 60_000, refetchInterval: 60_000, queryFn: () => load(rootCandidateId) });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [term, setTerm] = useState("");
  const data = q.data;
  const [seeded, setSeeded] = useState(false);
  if (data && !seeded) { setSeeded(true); setOpen(new Set([...data.kids.keys()])); }

  const { roots, unassigned, match } = useMemo(() => {
    if (!data) return { roots: [] as P[], unassigned: [] as P[], match: (_: P) => true };
    const t = term.trim().toLowerCase();
    const selfMatch = (p: P) => !t || `${p.full_name} ${p.employee_code} ${data.label(p)}`.toLowerCase().includes(t);
    const memo = new Map<string, boolean>();
    const match = (p: P): boolean => {
      const cached = memo.get(p.id);
      if (cached !== undefined) return cached;
      const ok = selfMatch(p) || (data.kids.get(p.id) ?? []).some(match);
      memo.set(p.id, ok);
      return ok;
    };
    return { roots: data.roots.filter(match), unassigned: data.unmapped.filter(selfMatch), match };
  }, [data, term]);

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const expandAll = () => data && setOpen(new Set([...data.kids.keys()]));

  return (
    <section className="rounded-2xl border border-border/60 bg-card/90 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Org chart</div>
          <h3 className="mt-0.5 flex items-center gap-2 text-base font-bold text-foreground">
            <Network className="h-4 w-4 text-muted-foreground" /> Reporting structure
            {data && <span className="text-[11px] font-semibold text-muted-foreground">· {data.total} people</span>}
          </h3>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input aria-label="Search reporting structure" value={term} onChange={(e) => { setTerm(e.target.value); if (e.target.value) expandAll(); }} placeholder="Search person or role…" className="h-8 w-full pl-7 text-[12px] sm:w-56" />
          </div>
          <Button size="sm" variant="outline" onClick={expandAll}>Expand all</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(new Set())}>Collapse</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Refresh reporting structure" title="Refresh reporting structure" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw className={q.isFetching ? "animate-spin" : ""} /></Button>
        </div>
      </header>
      <style>{ORG_CSS}</style>
      <div className="max-h-[820px] overflow-auto p-2">
        {q.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading org chart…</div>}
        {q.error && <div className="p-4 text-sm text-destructive">Couldn't load the org chart.</div>}
        {data && (
          <ul className="org-tree min-w-max px-4 pb-4 pt-2">
            {roots.map((r) => (
              <Node key={r.id} p={r} kids={data.kids} label={data.label} staffCounts={data.staffCounts} open={open} toggle={toggle} match={match} />
            ))}
          </ul>
        )}
        {unassigned.length > 0 && (
          <div className="mt-4 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-destructive">Not mapped to anybody ({unassigned.length})</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">These people don't report to someone one level above them. Map them to place them in the tree.</p>
            <ul className="mt-2 divide-y divide-border/50">
              {unassigned.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-1 py-1.5 text-[12px]">
                  <span className="font-semibold text-foreground">{p.full_name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{p.employee_code}</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{data?.label(p)}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {data?.managerName(p) ? `Currently reports to ${data.managerName(p)}` : "No manager set"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
