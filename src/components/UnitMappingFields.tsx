import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { logActivity } from "@/lib/activity-log";

const NONE = "__none__";

type Person = { id: string; full_name: string; mobile: string | null; role_key: string | null };

export type UnitMappingValue = { fieldOfficerId: string | null; reportingManagerId: string | null };

async function fetchPeople(): Promise<Person[]> {
  const out: Person[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("candidates")
      .select("id, full_name, mobile, role_key")
      .in("status", ["active", "approved"])
      .neq("role_key", "guard")
      .neq("role_key", "security_guard")
      .order("full_name")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Person[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadUnitMapping(unitId: string): Promise<UnitMappingValue> {
  const [{ data: unit }, { data: links }] = await Promise.all([
    supabase.from("units").select("reporting_manager_id").eq("id", unitId).maybeSingle(),
    supabase
      .from("candidate_units")
      .select("candidate_id, candidates!inner(role_key)")
      .eq("unit_id", unitId)
      .eq("candidates.role_key", "field_officer"),
  ]);
  return {
    fieldOfficerId: (links?.[0] as { candidate_id: string } | undefined)?.candidate_id ?? null,
    reportingManagerId: (unit as { reporting_manager_id: string | null } | null)?.reporting_manager_id ?? null,
  };
}

/** Saves the mapping. Field officer reuses the same candidate_units link as Radar. */
export async function saveUnitMapping(unitId: string, label: string, value: UnitMappingValue) {
  const before = await loadUnitMapping(unitId);
  if (before.reportingManagerId !== value.reportingManagerId) {
    const { error } = await supabase
      .from("units")
      .update({ reporting_manager_id: value.reportingManagerId } as never)
      .eq("id", unitId);
    if (error) throw error;
  }
  if (before.fieldOfficerId !== value.fieldOfficerId) {
    const { data: fos } = await supabase
      .from("candidate_units")
      .select("candidate_id, candidates!inner(role_key)")
      .eq("unit_id", unitId)
      .eq("candidates.role_key", "field_officer");
    const old = (fos ?? []).map((r) => (r as { candidate_id: string }).candidate_id);
    if (old.length) {
      const { error } = await supabase.from("candidate_units").delete().eq("unit_id", unitId).in("candidate_id", old);
      if (error) throw error;
    }
    if (value.fieldOfficerId) {
      const { error } = await supabase
        .from("candidate_units")
        .insert({ candidate_id: value.fieldOfficerId, unit_id: unitId, is_primary: false, is_reliever: false });
      if (error && !String(error.message).includes("duplicate")) throw error;
    }
  }
  if (before.fieldOfficerId !== value.fieldOfficerId || before.reportingManagerId !== value.reportingManagerId) {
    void logActivity({
      module: "Clients",
      action: "update_mapping",
      entityType: "units",
      entityId: unitId,
      entityLabel: label,
      before,
      after: value,
    });
  }
}

export function UnitMappingFields({
  value,
  onChange,
}: {
  value: UnitMappingValue;
  onChange: (v: UnitMappingValue) => void;
}) {
  const people = useQuery({ queryKey: ["unit-mapping", "people"], queryFn: fetchPeople, staleTime: 60_000 });
  const all = people.data ?? [];
  const fos = all.filter((p) => p.role_key === "field_officer");
  const label = (p: Person) => `${p.full_name}${p.mobile ? ` – ${p.mobile}` : ""}`;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Field officer</Label>
        <Select
          value={value.fieldOfficerId ?? NONE}
          onValueChange={(v) => onChange({ ...value, fieldOfficerId: v === NONE ? null : v })}
        >
          <SelectTrigger><SelectValue placeholder={people.isLoading ? "Loading…" : "Select field officer"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not mapped</SelectItem>
            {fos.map((p) => <SelectItem key={p.id} value={p.id}>{label(p)}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Same mapping used on the Radar dashboard.</p>
      </div>
      <div className="space-y-1.5">
        <Label>Reporting manager</Label>
        <Select
          value={value.reportingManagerId ?? NONE}
          onValueChange={(v) => onChange({ ...value, reportingManagerId: v === NONE ? null : v })}
        >
          <SelectTrigger><SelectValue placeholder={people.isLoading ? "Loading…" : "Select reporting manager"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not mapped</SelectItem>
            {all.map((p) => <SelectItem key={p.id} value={p.id}>{label(p)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
