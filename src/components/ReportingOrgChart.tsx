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
  const keys = [...roleRows.map((r) => r.key), ...GUARD_ROLES];
  const people = await fetchAllPages<P>((from, to) =>
    supabase
      .from("candidates")
      .select("id, full_name, employee_code, role_key, reports_to, designation_id")
      .in("role_key", keys)
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
  const kids = new Map<string, P[]>();
  const roots: P[] = [];
  for (const p of people) {
    const m = mgr.get(p.id);
    if (m) kids.set(m, [...(kids.get(m) ?? []), p]);
    else roots.push(p);
  }
  const label = (p: P) =>
    (p.designation_id && desig.get(p.designation_id)) ||
    (p.role_key && roleName.get(p.role_key)) ||
    (p.role_key && GUARD_ROLES.includes(p.role_key) ? "Security Guard" : p.role_key) ||
    "";
  // Roots: people with reports; lone guards collapse into "Unassigned".
  return { roots, kids, label, total: people.length };
}

function count(id: string, kids: Map<string, P[]>): number {
  return (kids.get(id) ?? []).reduce((n, k) => n + 1 + count(k.id, kids), 0);
}

function Node({ p, depth, kids, label, open, toggle, match }: {
  p: P; depth: number; kids: Map<string, P[]>; label: (p: P) => string;
  open: Set<string>; toggle: (id: string) => void; match: (p: P) => boolean;
}) {
  const children = (kids.get(p.id) ?? []).filter(match);
  const isOpen = open.has(p.id);
  const total = count(p.id, kids);
  return (
    <li>
      <button
        type="button"
        onClick={() => children.length && toggle(p.id)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60"
        style={{ paddingLeft: 8 + depth * 20 }}
      >
        {children.length ? (isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />) : <span className="w-3.5" />}
        <span className="truncate text-[13px] font-semibold text-foreground">{p.full_name}</span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">{p.employee_code ?? ""}</span>
        <span className="ml-auto shrink-0 rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{label(p)}</span>
        {total > 0 && <span className="shrink-0 text-[10px] font-semibold text-primary">{total} below</span>}
      </button>
      {isOpen && children.length > 0 && (
        <ul className="border-l border-border/50" style={{ marginLeft: 15 + depth * 20 }}>
          {children.map((c) => (
            <Node key={c.id} p={c} depth={0} kids={kids} label={label} open={open} toggle={toggle} match={match} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ReportingOrgChart() {
  const q = useQuery({ queryKey: ["reporting-org-chart"], staleTime: 60_000, queryFn: load });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [term, setTerm] = useState("");
  const data = q.data;

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
      <div className="max-h-[640px] overflow-auto p-2">
        {q.isLoading && <div className="p-4 text-sm text-muted-foreground">Loading org chart…</div>}
        {q.error && <div className="p-4 text-sm text-destructive">Couldn't load the org chart.</div>}
        {data && (
          <ul>
            {roots.map((r) => (
              <Node key={r.id} p={r} depth={0} kids={data.kids} label={data.label} open={open} toggle={toggle} match={match} />
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
