import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, BadgeIndianRupee, CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type MissingContractDesignation = {
  candidate_id: string;
  full_name: string;
  employee_code: string | null;
  candidate_code: string | null;
  unit_id: string;
  unit_name: string;
  unit_code: string;
  customer_name: string;
  designation_id: string;
  designation_name: string;
  contract_id: string | null;
  missing_since: string;
};

type FollowUpRow = MissingContractDesignation & { due: string; days: number };
const QUERY_KEY = ["contract-designation-follow-up"] as const;

function readSnapshot(key: string): FollowUpRow[] | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as FollowUpRow[]) : undefined;
  } catch {
    return undefined;
  }
}

function withAge(row: MissingContractDesignation): FollowUpRow {
  const source = row.missing_since.slice(0, 10);
  const start = new Date(`${source}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - start) / 86_400_000));
  return {
    ...row,
    missing_since: source,
    due: new Date(start + 7 * 86_400_000).toISOString().slice(0, 10),
    days,
  };
}

export function ContractDesignationFollowUp({
  fieldOfficer = false,
  compact = false,
  actionable = false,
  className,
}: {
  fieldOfficer?: boolean;
  compact?: boolean;
  actionable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const cacheKey = `contract-designation-follow-up:${fieldOfficer ? "mine" : "all"}`;
  const query = useQuery({
    queryKey: [...QUERY_KEY, fieldOfficer ? "mine" : "all"],
    staleTime: 60_000,
    refetchInterval: 120_000,
    initialData: () => readSnapshot(cacheKey),
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_missing_contract_designations" as never);
      if (error) throw error;
      const rows = (((data ?? []) as unknown) as MissingContractDesignation[]).map(withAge);
      if (typeof window !== "undefined") {
        try { window.localStorage.setItem(cacheKey, JSON.stringify(rows)); } catch { /* optional cache */ }
      }
      return rows;
    },
  });

  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    const channel = supabase
      .channel(`contract-designation-follow-up-${fieldOfficer ? "mine" : "all"}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "candidate_units" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "contract_resources" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "client_contracts" }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [fieldOfficer, queryClient]);

  const rows = query.data ?? [];
  const overdue = useMemo(() => rows.filter((row) => row.days >= 7).length, [rows]);

  return (
    <>
      <Button type="button" variant="ghost" onClick={() => setOpen(true)} className={cn("group flex h-auto w-full min-w-0 items-stretch whitespace-nowrap border border-border/50 bg-[rgb(var(--tint-amber))] text-left shadow-sm transition hover:border-primary/35 hover:bg-[rgb(var(--tint-amber))] hover:shadow-md", compact ? "min-h-[104px] rounded-2xl p-3.5" : "h-[124px] rounded-2xl p-3 sm:h-[172px] sm:rounded-[26px] sm:p-5", className)}>
        <div className="flex min-w-0 flex-1 flex-col"><div className="truncate font-display text-[13px] font-medium leading-tight text-foreground sm:text-[15px]">Contract designation</div><div className={cn("mt-0.5 truncate text-[10px] sm:mt-1 sm:text-[11px]", query.isError ? "text-destructive" : "text-muted-foreground")}>{query.isError ? "Could not load" : overdue ? `${overdue} overdue` : "Seven-day follow-up"}</div><div className={cn("mt-auto overflow-hidden text-ellipsis whitespace-nowrap font-display font-medium leading-none tabular-nums", query.isError ? "text-destructive" : "text-foreground", compact ? "text-[25px]" : "text-[26px] sm:text-[40px]")}>{query.isLoading ? "—" : query.isError ? "!" : rows.length}</div></div>
        <span className={cn("mt-auto grid shrink-0 place-items-center rounded-full bg-card/80 text-amber-700 ring-1 ring-inset ring-amber-200/70 dark:text-amber-300 dark:ring-amber-400/20", compact ? "h-8 w-8" : "h-7 w-7 sm:h-9 sm:w-9")}><CalendarClock className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Contract designation follow-up</DialogTitle><DialogDescription>Postings whose designation still needs a billing line in the unit contract.</DialogDescription></DialogHeader>
          <div className="space-y-2">
            {!query.isError && rows.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">All posted designations are covered by their contracts.</div> : rows.map((row) => {
              const tone = row.days >= 7 ? "border-destructive/30 bg-destructive/5 text-destructive" : row.days >= 4 ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
              return <div key={`${row.candidate_id}:${row.unit_id}:${row.designation_id}`} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="font-semibold text-foreground">{row.full_name}</div><div className="mt-0.5 text-xs text-muted-foreground">{row.employee_code || row.candidate_code || "Code pending"} · {row.designation_name}</div><div className="mt-1 text-xs text-muted-foreground">{row.customer_name} · {row.unit_name} ({row.unit_code})</div><div className="mt-1 text-[11px] text-muted-foreground">Missing since {row.missing_since} · Due {row.due}</div></div><div className="flex items-center justify-between gap-2 sm:justify-end"><span className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold", tone)}>{row.days >= 7 ? `${row.days - 7}d overdue` : `${7 - row.days}d left`}</span>{actionable && <Button asChild size="icon" variant="outline" className="h-8 w-8" title="Open this unit's contract"><Link to="/admin/contracts/client-contracts" search={{ tab: "client", unit: row.unit_id }} aria-label={`Open contract for ${row.unit_name}`}><BadgeIndianRupee className="h-4 w-4" /></Link></Button>}</div></div>;
            })}
          </div>
          {query.isError && <div className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4" />Could not load contract designation follow-ups.</div>}
        </DialogContent>
      </Dialog>
    </>
  );
}