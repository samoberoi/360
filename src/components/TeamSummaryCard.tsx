import { useQuery } from "@tanstack/react-query";
import { Building2, MapPin, ShieldCheck, Users, UserCog } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Headcount of everyone below the signed-in person in the reporting tree,
 * grouped by role, plus the client sites their field officers cover.
 * Driven purely by reporting lines — works for OM, Branch Manager, DGM.
 */
type Row = { id: string; role_key: string | null; status: string | null };
const GUARDS = ["guard", "security_guard"];

async function load(phone: string) {
  const { data: me } = await supabase.from("candidates").select("id").eq("mobile", phone).maybeSingle();
  if (!me?.id) return null;
  const seen = new Set<string>([me.id]);
  const people: Row[] = [];
  let frontier = [me.id as string];
  for (let d = 0; d < 8 && frontier.length; d++) {
    const [a, b] = await Promise.all([
      supabase.from("candidates").select("id").in("reports_to", frontier).limit(5000),
      supabase.from("candidate_reporting_managers").select("candidate_id").in("manager_id", frontier).limit(5000),
    ]);
    const ids = [
      ...((a.data ?? []) as Array<{ id: string }>).map((r) => r.id),
      ...((b.data ?? []) as Array<{ candidate_id: string }>).map((r) => r.candidate_id),
    ].filter((id) => id && !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (!ids.length) break;
    const rows: Row[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from("candidates").select("id,role_key,status").in("id", ids.slice(i, i + 200));
      rows.push(...(((data ?? []) as unknown) as Row[]));
    }
    const active = rows.filter((r) => r.status === "active" || r.status === "approved");
    people.push(...active);
    frontier = active.filter((r) => !GUARDS.includes(r.role_key ?? "")).map((r) => r.id);
  }
  const by = (k: string[]) => people.filter((p) => k.includes(p.role_key ?? "")).length;
  const fos = people.filter((p) => p.role_key === "field_officer").map((p) => p.id);
  const unitIds = new Set<string>();
  for (let i = 0; i < fos.length; i += 200) {
    const { data } = await supabase.from("candidate_units").select("unit_id").in("candidate_id", fos.slice(i, i + 200)).limit(5000);
    ((data ?? []) as Array<{ unit_id: string | null }>).forEach((r) => r.unit_id && unitIds.add(r.unit_id));
  }
  let sites = 0;
  const all = [...unitIds];
  for (let i = 0; i < all.length; i += 200) {
    const { data } = await supabase.from("units").select("id,is_billable").in("id", all.slice(i, i + 200));
    sites += ((data ?? []) as Array<{ is_billable: boolean | null }>).filter((u) => u.is_billable !== false).length;
  }
  return {
    managers: by(["branch_manager", "dgm"]),
    oms: by(["operations_manager"]),
    fos: fos.length,
    guards: by(GUARDS),
    others: people.length - by(["branch_manager", "dgm", "operations_manager", "field_officer", ...GUARDS]),
    sites,
    total: people.length,
  };
}

export function TeamSummaryCard() {
  const { user } = useAuth();
  const phone = user?.phone?.replace(/\D/g, "").slice(-10) ?? "";
  const q = useQuery({ queryKey: ["team-summary", phone], enabled: !!phone, staleTime: 60_000, queryFn: () => load(phone) });
  const d = q.data;
  if (!d || d.total === 0) return null;
  const tiles = [
    ...(d.managers ? [{ label: "Branch managers", v: d.managers, I: UserCog }] : []),
    { label: "Operations managers", v: d.oms, I: UserCog },
    { label: "Field officers", v: d.fos, I: Users },
    { label: "Sites covered", v: d.sites, I: MapPin },
    { label: "Security guards", v: d.guards, I: ShieldCheck },
    { label: "Other staff", v: d.others, I: Building2 },
  ];
  return (
    <section className="rounded-2xl border border-border/60 bg-card/90 p-4 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">My team</div>
      <div className="mt-0.5 text-base font-bold text-foreground">{d.total} people report into you</div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(({ label, v, I }) => (
          <div key={label} className="rounded-xl border border-border/60 bg-muted/30 p-3">
            <I className="h-4 w-4 text-primary" />
            <div className="mt-1 text-2xl font-bold text-foreground">{v}</div>
            <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
