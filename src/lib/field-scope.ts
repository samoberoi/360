import { supabase } from "@/integrations/supabase/client";

/**
 * Reporting-line driven scoping for operations managers.
 * An operations manager sees exactly the field officers who report to him
 * (candidate_reporting_managers) and the union of those officers' sites
 * (candidate_units). Nothing is hardcoded per person — change the reporting
 * lines and every scoped screen follows.
 */

/** Candidate ids of active field officers reporting to `managerCandidateId`. */
export async function fetchReporteeFoIds(managerCandidateId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("candidate_reporting_managers" as never)
    .select("candidate_id")
    .eq("manager_id", managerCandidateId);
  if (error) throw error;
  const ids = (((data ?? []) as unknown) as Array<{ candidate_id: string }>).map(
    (r) => r.candidate_id,
  );
  if (!ids.length) return [];
  const { data: fos, error: foErr } = await supabase
    .from("candidates" as never)
    .select("id")
    .in("id", ids)
    .eq("role_key", "field_officer")
    .in("status", ["approved", "active"]);
  if (foErr) throw foErr;
  return (((fos ?? []) as unknown) as Array<{ id: string }>).map((r) => r.id);
}

/** Union of unit ids mapped to any field officer reporting to the manager. */
export async function fetchReporteeUnitIds(managerCandidateId: string): Promise<string[]> {
  const foIds = await fetchReporteeFoIds(managerCandidateId);
  if (!foIds.length) return [];
  const { data, error } = await supabase
    .from("candidate_units" as never)
    .select("unit_id")
    .in("candidate_id", foIds);
  if (error) throw error;
  const set = new Set<string>();
  for (const r of ((data ?? []) as unknown) as Array<{ unit_id: string }>) set.add(r.unit_id);
  return Array.from(set);
}
