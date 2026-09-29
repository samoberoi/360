import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentPermissions } from "@/lib/rbac";
import { logActivity } from "@/lib/activity-log";
import {
  DEFAULT_RULE,
  MARK_MODE_LABEL,
  fetchAttendanceRules,
  saveAttendanceRule,
  type AttendanceRule,
  type MarkMode,
} from "@/lib/attendance-rules";

export const Route = createFileRoute("/admin/field-sense/attendance-rules")({
  component: AttendanceRulesPage,
  head: () => ({
    meta: [
      { title: "Radar — Attendance Location Rules" },
      { name: "description", content: "Set where each role may mark attendance, allowed distance and face photo requirement." },
      { property: "og:title", content: "Radar — Attendance Location Rules" },
      { property: "og:description", content: "Where people may mark attendance, per role." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const PRETTY: Record<string, string> = {
  accounts: "Accounts",
  admin: "Admin",
  branch_manager: "Branch Manager",
  control_center: "Control Center",
  field_officer: "Field Officer",
  finance: "Finance",
  guard: "Guard",
  head_control_center: "Head - Control Center",
  hr: "HR",
};

function AttendanceRulesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isSuperAdmin, isLoading: permLoading } = useCurrentPermissions();

  useEffect(() => {
    if (!permLoading && !isSuperAdmin) navigate({ to: "/admin/dashboard", replace: true });
  }, [permLoading, isSuperAdmin, navigate]);

  const rulesQ = useQuery({ queryKey: ["attendance-location-rules"], queryFn: fetchAttendanceRules });
  const rolesQ = useQuery({
    queryKey: ["roles-for-rules"],
    queryFn: async () => {
      const { data } = await supabase.from("roles" as never).select("key, name");
      return ((data ?? []) as unknown as Array<{ key: string; name: string }>);
    },
  });

  const rows = useMemo(() => {
    const names = new Map<string, string>(Object.entries(PRETTY));
    for (const r of rolesQ.data ?? []) names.set(r.key, r.name);
    for (const r of rulesQ.data ?? []) if (!names.has(r.role_key)) names.set(r.role_key, r.role_key);
    return [...names.entries()]
      .map(([key, name]) => ({ name, rule: rulesQ.data?.find((r) => r.role_key === key) ?? DEFAULT_RULE(key) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rolesQ.data, rulesQ.data]);

  const update = async (before: AttendanceRule, patch: Partial<AttendanceRule>, label: string) => {
    const next = { ...before, ...patch };
    qc.setQueryData<AttendanceRule[]>(["attendance-location-rules"], (old) => {
      const list = (old ?? []).filter((r) => r.role_key !== next.role_key);
      return [...list, next];
    });
    try {
      await saveAttendanceRule(next);
      void logActivity({
        module: "field_sense",
        action: "update",
        entityType: "attendance_location_rule",
        entityId: next.role_key,
        entityLabel: label,
        before: before as unknown as Record<string, unknown>,
        after: next as unknown as Record<string, unknown>,
      });
      toast.success(`${label} rule saved`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
      void qc.invalidateQueries({ queryKey: ["attendance-location-rules"] });
    }
  };

  if (!isSuperAdmin) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance Location Rules"
        description="Where people may mark attendance. Sites without a saved location learn it from the first on-site check-in or client visit."
        crumbs={[
          { label: "Admin", to: "/admin/dashboard" },
          { label: "Radar", to: "/admin/field-sense" },
          { label: "Attendance Rules" },
        ]}
      />
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <div className="border-b border-border/60 px-4 py-3">
          <div className="text-sm font-semibold text-foreground">By role</div>
          <div className="text-[12px] text-muted-foreground">Applies to everyone in the role.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left">Role</th>
                <th className="px-4 py-2.5 text-left">Where they can mark</th>
                <th className="px-4 py-2.5 text-left">Allowed distance (m)</th>
                <th className="px-4 py-2.5 text-left">Save new site locations</th>
                <th className="px-4 py-2.5 text-left">Face photo required</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map(({ name, rule }) => (
                <tr key={rule.role_key}>
                  <td className="px-4 py-2.5 font-medium text-foreground">{name}</td>
                  <td className="px-4 py-2.5">
                    <Select value={rule.mark_mode} onValueChange={(v) => void update(rule, { mark_mode: v as MarkMode }, name)}>
                      <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(MARK_MODE_LABEL) as MarkMode[]).map((m) => (
                          <SelectItem key={m} value={m}>{MARK_MODE_LABEL[m]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="number"
                      min={25}
                      max={5000}
                      defaultValue={rule.allowed_distance_m}
                      disabled={rule.mark_mode === "anywhere"}
                      onBlur={(e) => {
                        const n = Math.round(Number(e.target.value));
                        if (!Number.isFinite(n) || n < 25 || n > 5000) {
                          toast.error("Distance must be between 25 and 5000 m");
                          e.target.value = String(rule.allowed_distance_m);
                          return;
                        }
                        if (n !== rule.allowed_distance_m) void update(rule, { allowed_distance_m: n }, name);
                      }}
                      className="h-9 w-28 rounded-md border border-border bg-background px-3 tabular-nums disabled:opacity-50"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <Switch checked={rule.save_new_site_locations} onCheckedChange={(v) => void update(rule, { save_new_site_locations: v }, name)} />
                  </td>
                  <td className="px-4 py-2.5">
                    <Switch checked={rule.face_photo_required} onCheckedChange={(v) => void update(rule, { face_photo_required: v }, name)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
