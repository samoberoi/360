import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Network, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPages } from "@/lib/supabase-batch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Company reporting structure, built purely from data: each person's primary
 * manager (candidate_reporting_managers, falling back to candidates.reports_to).
 * Staff roles come from the `roles` table; guards hang under their FO.
 */
type P = {
  id: string;
  full_name: string | null;
  employee_code: string | null;
  role_key: string | null;
  reports_to: string | null;
  designation_id: string | null;
};

const GUARD_ROLES = ["guard", "security_guard"];

async function load() {
  const [{ data: roles }, { data: desigs }] = await Promise.all([
    supabase.from("roles" as never).select("key,name"),
    supabase.from("designations").select("id,name"),
  ]);
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
  const ranked = [...crm].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || Number(!a.unit_id) - Number(!b.unit_id));
  for (const r of ranked.reverse()) if (ids.has(r.manager_id) && r.manager_id !== r.candidate_id) mgr.set(r.candidate_id, r.manager_id);
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
  const shown = people.filter((p) => p.role_key != null && p.role_key in RANK);
  const byId = new Map(shown.map((p) => [p.id, p]));
  const rank = (p: P) => RANK[p.role_key as string];
  const kids = new Map<string, P[]>();
  const roots: P[] = [];
  const parentOf = new Map<string, string>();
  for (const p of shown) {
    const m = mgr.get(p.id);
    const mp = m ? byId.get(m) : undefined;
    if (mp && rank(mp) === rank(p) - 1) parentOf.set(p.id, mp.id);
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
  return { roots, kids, unmapped, managerName, label, total: shown.length };
}

function count(id: string, kids: Map<string, P[]>): number {
  return (kids.get(id) ?? []).reduce((n, k) => n + 1 + count(k.id, kids), 0);
}

function Card({ p, label, total, isOpen, hasKids, onClick }: { p: P; label: string; total: number; isOpen: boolean; hasKids: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative mx-auto flex w-44 flex-col items-center rounded-xl border border-border/70 bg-card px-3 py-2 text-center shadow-sm transition hover:border-primary/60 hover:shadow-md"
    >
      <span className="w-full truncate text-[12px] font-bold text-foreground">{p.full_name}</span>
      <span className="mt-0.5 w-full truncate rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{label}</span>
      <span className="mt-0.5 font-mono text-[9px] text-muted-foreground">{p.employee_code ?? "\u00a0"}</span>
      {hasKids && (
        <span className="absolute -bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-background px-1.5 text-[9px] font-bold text-muted-foreground">
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{total}
        </span>
      )}
    </button>
  );
}

function Node({ p, kids, label, open, toggle, match }: {
  p: P; kids: Map<string, P[]>; label: (p: P) => string;
  open: Set<string>; toggle: (id: string) => void; match: (p: P) => boolean;
}) {
  const children = (kids.get(p.id) ?? []).filter(match);
  const isOpen = open.has(p.id);
  const total = count(p.id, kids);
  const allLeaves = children.every((c) => (kids.get(c.id) ?? []).length === 0);
  return (
    <li className="org-node">
      <Card p={p} label={label(p)} total={total} isOpen={isOpen} hasKids={children.length > 0} onClick={() => children.length && toggle(p.id)} />
      {isOpen && children.length > 0 && (allLeaves ? (
        <div className="org-leaves">
          <div className="mx-auto max-h-72 w-52 overflow-y-auto rounded-xl border border-dashed border-border/70 bg-muted/30 p-1.5">
            <div className="px-1.5 pb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{children.length} direct reports</div>
            {children.map((c) => (
              <div key={c.id} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted/60">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                <span className="truncate text-[11px] font-semibold text-foreground">{c.full_name}</span>
                <span className="ml-auto shrink-0 truncate text-[9px] text-muted-foreground">{label(c)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <ul className="org-children">
          {children.map((c) => (
            <Node key={c.id} p={c} kids={kids} label={label} open={open} toggle={toggle} match={match} />
          ))}
        </ul>
      ))}
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

export function ReportingOrgChart() {
  const q = useQuery({ queryKey: ["reporting-org-chart"], staleTime: 60_000, queryFn: load });
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
      if (memo.has(p.id)) return memo.get(p.id)!;
      const ok = selfMatch(p) || (data.kids.get(p.id) ?? []).some(match);
      memo.set(p.id, ok);
      return ok;
    };
    const withTeam = data.roots.filter((r) => (data.kids.get(r.id) ?? []).length > 0);
    const lone = data.roots.filter((r) => (data.kids.get(r.id) ?? []).length === 0);
    return { roots: withTeam.filter(match), unassigned: lone.filter(match), match };
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
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={term} onChange={(e) => { setTerm(e.target.value); if (e.target.value) expandAll(); }} placeholder="Search person or role…" className="h-8 w-56 pl-7 text-[12px]" />
          </div>
          <Button size="sm" variant="outline" onClick={expandAll}>Expand all</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(new Set())}>Collapse</Button>
        </div>
      </header>
      <style>{ORG_CSS}</style>
      <div className="max-h-[820px] overflow-auto p-2">
        {q.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading org chart…</div>}
        {q.error && <div className="p-4 text-sm text-destructive">Couldn't load the org chart.</div>}
        {data && (
          <ul className="org-tree min-w-max px-4 pb-4 pt-2">
            {roots.map((r) => (
              <Node key={r.id} p={r} kids={data.kids} label={data.label} open={open} toggle={toggle} match={match} />
            ))}
          </ul>
        )}
        {unassigned.length > 0 && (
          <details className="mt-3 rounded-lg border border-dashed border-border/60 p-2">
            <summary className="cursor-pointer text-[12px] font-semibold text-muted-foreground">No reporting manager ({unassigned.length})</summary>
            <ul className="mt-1">
              {unassigned.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-2 py-1 text-[12px]">
                  <span className="font-semibold">{p.full_name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{p.employee_code}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{data?.label(p)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
