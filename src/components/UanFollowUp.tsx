import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type MissingUan = { id: string; full_name: string; employee_code: string | null; candidate_code: string | null; unit_id: string | null; preferred_joining_date: string | null; created_at: string; compliance: Record<string, unknown> | null };

function dayAge(row: MissingUan) {
  const c = row.compliance ?? {};
  const source = String(c.uan_missing_since ?? row.preferred_joining_date ?? row.created_at).slice(0, 10);
  const start = new Date(`${source}T00:00:00`).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - start) / 86400000));
  const due = new Date(start + 7 * 86400000).toISOString().slice(0, 10);
  return { source, due, days };
}

export function UanFollowUp({ fieldOfficerUserId, fieldOfficerCandidateId, compact = false, className }: { fieldOfficerUserId?: string | null; fieldOfficerCandidateId?: string | null; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const scoped = Boolean(fieldOfficerUserId || fieldOfficerCandidateId);
  const q = useQuery({
    queryKey: ["uan-follow-up", fieldOfficerUserId ?? "hr", fieldOfficerCandidateId ?? "all"],
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      let query = supabase.from("candidates").select("id,full_name,employee_code,candidate_code,unit_id,preferred_joining_date,created_at,compliance").eq("is_enabled", true).in("status", ["active", "approved"]);
      if (scoped) {
        const filters = [fieldOfficerUserId ? `created_by.eq.${fieldOfficerUserId}` : "", fieldOfficerCandidateId ? `reports_to.eq.${fieldOfficerCandidateId}` : ""].filter(Boolean);
        if (filters.length) query = query.or(filters.join(","));
      }
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as MissingUan[];
      const missing = rows.filter((r) => !/^1\d{11}$/.test(String(r.compliance?.uan ?? "").trim()));
      const unitIds = Array.from(new Set(missing.map((r) => r.unit_id).filter(Boolean))) as string[];
      const names = new Map<string, string>();
      if (unitIds.length) {
        const { data: units, error: unitsError } = await supabase.from("units").select("id,name,code").in("id", unitIds);
        if (unitsError) throw unitsError;
        for (const unit of units ?? []) names.set(unit.id, `${unit.name} · ${unit.code}`);
      }
      return missing.map((row) => ({ ...row, unitName: row.unit_id ? names.get(row.unit_id) ?? "Assigned unit" : "Not posted", ...dayAge(row) }));
    },
  });
  const rows = q.data ?? [];
  const overdue = useMemo(() => rows.filter((r) => r.days >= 7).length, [rows]);
  return (
    <>
      <Button type="button" variant="ghost" onClick={() => setOpen(true)} className={cn("group flex h-auto w-full min-w-0 items-stretch whitespace-nowrap border border-border/50 bg-[rgb(var(--tint-amber))] text-left shadow-sm transition hover:border-primary/35 hover:bg-[rgb(var(--tint-amber))] hover:shadow-md", compact ? "min-h-[104px] rounded-2xl p-3.5" : "h-[124px] rounded-2xl p-3 sm:h-[172px] sm:rounded-[26px] sm:p-5", className)}>
        <div className="flex min-w-0 flex-1 flex-col"><div className="truncate font-display text-[13px] font-medium leading-tight text-foreground sm:text-[15px]">UAN follow-up</div><div className={cn("mt-0.5 truncate text-[10px] sm:mt-1 sm:text-[11px]", q.isError ? "text-destructive" : "text-muted-foreground")}>{q.isError ? "Could not load" : overdue ? `${overdue} overdue` : "Seven-day compliance"}</div><div className={cn("mt-auto overflow-hidden text-ellipsis whitespace-nowrap font-display font-medium leading-none tabular-nums", q.isError ? "text-destructive" : "text-foreground", compact ? "text-[25px]" : "text-[26px] sm:text-[40px]")}>{q.isLoading ? "—" : q.isError ? "!" : rows.length}</div></div>
        <span className={cn("mt-auto grid shrink-0 place-items-center rounded-full bg-card/80 text-amber-700 ring-1 ring-inset ring-amber-200/70 dark:text-amber-300 dark:ring-amber-400/20", compact ? "h-8 w-8" : "h-7 w-7 sm:h-9 sm:w-9")}><CalendarClock className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>UAN follow-up</DialogTitle><DialogDescription>Employees without a valid UAN, tracked from onboarding.</DialogDescription></DialogHeader>
          <div className="space-y-2">
            {!q.isError && rows.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">All UANs are complete.</div> : rows.map((row) => {
              const tone = row.days >= 7 ? "border-destructive/30 bg-destructive/5 text-destructive" : row.days >= 4 ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
              return <div key={row.id} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="font-semibold text-foreground">{row.full_name}</div><div className="mt-0.5 text-xs text-muted-foreground">{row.employee_code || row.candidate_code || "Code pending"} · {row.unitName}</div><div className="mt-1 text-[11px] text-muted-foreground">Missing since {row.source} · Due {row.due}</div></div><div className="flex items-center justify-between gap-2 sm:justify-end"><span className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold", tone)}>{row.days >= 7 ? `${row.days - 7}d overdue` : `${7 - row.days}d left`}</span></div></div>;
            })}
          </div>
          {q.isError && <div className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4" />Could not load UAN follow-ups.</div>}
        </DialogContent>
      </Dialog>
    </>
  );
}