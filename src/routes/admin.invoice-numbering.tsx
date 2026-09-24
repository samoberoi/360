import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Edit2, Hash, Plus, Search, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { confirmAction } from "@/components/ConfirmProvider";
import { DataPagination } from "@/components/DataPagination";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useCurrentPermissions } from "@/lib/rbac";
import {
  MONTH_CODES,
  buildInvoiceNumber,
  fiscalYearLabel,
  monthCode,
  useInvoiceMonthCounts,
  useInvoiceNumberSeries,
  useInvoiceNumberTokens,
  useInvoiceRegistry,
  type InvoiceNumberSeries,
  type InvoiceNumberToken,
} from "@/lib/invoice-numbering";

export const Route = createFileRoute("/admin/invoice-numbering")({
  head: () => ({
    meta: [
      { title: "Invoice Numbering | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "State-wise invoice number series, client codes and the issued number register." },
      { property: "og:title", content: "Invoice Numbering | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "State-wise invoice number series, client codes and the issued number register." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvoiceNumberingPage,
});

const MODULE = "Invoice Numbering";

function InvoiceNumberingPage() {
  const { can, isSuperAdmin } = useCurrentPermissions();
  const canEdit = isSuperAdmin || can("control_center", "edit");
  const canDelete = isSuperAdmin || can("control_center", "delete");
  const qc = useQueryClient();

  const today = useMemo(() => new Date(), []);
  const currentFy = fiscalYearLabel(today);
  const currentMonth = monthCode(today);

  const { data: allSeries = [] } = useInvoiceNumberSeries();
  const fiscalYears = useMemo(() => {
    const set = new Set<string>(allSeries.map((s) => s.fiscal_year));
    set.add(currentFy);
    return [...set].sort().reverse();
  }, [allSeries, currentFy]);

  const [fy, setFy] = useState(currentFy);
  const series = useMemo(() => allSeries.filter((s) => s.fiscal_year === fy), [allSeries, fy]);
  const { data: monthCounts = [] } = useInvoiceMonthCounts(fy);
  const { data: tokens = [] } = useInvoiceNumberTokens();

  const [stateCode, setStateCode] = useState<string>("MH");
  useEffect(() => {
    if (series.length > 0 && !series.some((s) => s.state_code === stateCode)) {
      setStateCode(series[0]!.state_code);
    }
  }, [series, stateCode]);

  const activeSeries = series.find((s) => s.state_code === stateCode) ?? null;
  const stateTokens = useMemo(() => tokens.filter((t) => t.state_code === stateCode), [tokens, stateCode]);

  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [fy, stateCode, monthFilter, search, pageSize]);

  const { data: registry, isLoading } = useInvoiceRegistry({
    fiscalYear: fy,
    stateCode,
    monthCode: monthFilter === "all" ? null : monthFilter,
    search,
    page,
    pageSize,
  });
  const rows = registry?.rows ?? [];
  const total = registry?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const stateMonthCounts = useMemo(
    () => monthCounts.filter((m) => m.state_code === stateCode).sort((a, b) => a.month_order - b.month_order),
    [monthCounts, stateCode],
  );
  const stateTotal = useMemo(
    () => stateMonthCounts.reduce((sum, m) => sum + m.invoice_count, 0),
    [stateMonthCounts],
  );

  // Next number preview for the selected state, computed from the stored series.
  const [previewToken, setPreviewToken] = useState("");
  const nextNumber = activeSeries
    ? buildInvoiceNumber({
        prefix: activeSeries.number_prefix,
        monthCode: currentMonth,
        fiscalYear: activeSeries.fiscal_year,
        token: previewToken,
        sequence: activeSeries.last_sequence + 1,
        padding: activeSeries.seq_padding,
      })
    : "-";

  // --- series editing ---
  const [seriesDialog, setSeriesDialog] = useState<InvoiceNumberSeries | null>(null);
  const [seriesDraft, setSeriesDraft] = useState({ state_code: "", state_name: "", number_prefix: "", fiscal_year: currentFy, last_sequence: 0, seq_padding: 4, enabled: true, notes: "" });

  const openSeries = (row: InvoiceNumberSeries | null) => {
    setSeriesDialog(row ?? ({ id: "" } as InvoiceNumberSeries));
    setSeriesDraft({
      state_code: row?.state_code ?? "",
      state_name: row?.state_name ?? "",
      number_prefix: row?.number_prefix ?? "",
      fiscal_year: row?.fiscal_year ?? fy,
      last_sequence: row?.last_sequence ?? 0,
      seq_padding: row?.seq_padding ?? 4,
      enabled: row?.enabled ?? true,
      notes: row?.notes ?? "",
    });
  };

  const saveSeries = useMutation({
    mutationFn: async () => {
      const payload = {
        state_code: seriesDraft.state_code.trim().toUpperCase(),
        state_name: seriesDraft.state_name.trim(),
        number_prefix: seriesDraft.number_prefix.trim().toUpperCase() || null,
        fiscal_year: seriesDraft.fiscal_year.trim(),
        last_sequence: Number(seriesDraft.last_sequence) || 0,
        seq_padding: Number(seriesDraft.seq_padding) || 4,
        enabled: seriesDraft.enabled,
        notes: seriesDraft.notes.trim() || null,
      };
      if (!payload.state_code || !payload.state_name) throw new Error("State code and name are required");
      const existingId = seriesDialog?.id;
      if (existingId) {
        const { error } = await supabase.from("invoice_number_series" as never).update(payload as never).eq("id", existingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("invoice_number_series" as never).insert(payload as never);
        if (error) throw error;
      }
      await logActivity({
        module: MODULE,
        action: existingId ? "update" : "create",
        entityLabel: `${payload.state_code} ${payload.fiscal_year}`,
      });
    },
    onSuccess: () => {
      toast.success("Series saved");
      setSeriesDialog(null);
      void qc.invalidateQueries({ queryKey: ["invoice-number-series"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // --- client code editing ---
  const [tokenDialog, setTokenDialog] = useState<InvoiceNumberToken | null>(null);
  const [tokenDraft, setTokenDraft] = useState({ state_code: "", token: "", sample_party_name: "", enabled: true });

  const openToken = (row: InvoiceNumberToken | null) => {
    setTokenDialog(row ?? ({ id: "" } as InvoiceNumberToken));
    setTokenDraft({
      state_code: row?.state_code ?? stateCode,
      token: row?.token ?? "",
      sample_party_name: row?.sample_party_name ?? "",
      enabled: row?.enabled ?? true,
    });
  };

  const saveToken = useMutation({
    mutationFn: async () => {
      const payload = {
        state_code: tokenDraft.state_code.trim().toUpperCase(),
        token: tokenDraft.token.trim().toUpperCase(),
        sample_party_name: tokenDraft.sample_party_name.trim() || null,
        enabled: tokenDraft.enabled,
      };
      if (!payload.state_code || !payload.token) throw new Error("State and client code are required");
      const existingId = tokenDialog?.id;
      if (existingId) {
        const { error } = await supabase.from("invoice_number_client_tokens" as never).update(payload as never).eq("id", existingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("invoice_number_client_tokens" as never).insert(payload as never);
        if (error) throw error;
      }
      await logActivity({ module: MODULE, action: existingId ? "update" : "create", entityLabel: `${payload.state_code}-${payload.token}` });
    },
    onSuccess: () => {
      toast.success("Client code saved");
      setTokenDialog(null);
      void qc.invalidateQueries({ queryKey: ["invoice-number-tokens"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteToken = useMutation({
    mutationFn: async (row: InvoiceNumberToken) => {
      const { error } = await supabase.from("invoice_number_client_tokens" as never).delete().eq("id", row.id);
      if (error) throw error;
      await logActivity({ module: MODULE, action: "delete", entityLabel: `${row.state_code}-${row.token}` });
    },
    onSuccess: () => {
      toast.success("Client code removed");
      void qc.invalidateQueries({ queryKey: ["invoice-number-tokens"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 sm:space-y-5">
      <PageHeader
        title="Invoice Numbering"
        description="State-wise series, client codes and issued numbers."
        crumbs={[{ label: "Control Center", to: "/admin/control-center" }, { label: "Invoice Numbering" }]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={fy} onValueChange={setFy}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Fiscal year" /></SelectTrigger>
          <SelectContent>
            {fiscalYears.map((y) => <SelectItem key={y} value={y}>FY {y}</SelectItem>)}
          </SelectContent>
        </Select>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => openSeries(null)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add state series
          </Button>
        )}
      </div>

      {/* State cards */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {series.map((s) => {
          const count = monthCounts
            .filter((m) => m.state_code === s.state_code)
            .reduce((sum, m) => sum + m.invoice_count, 0);
          const selected = s.state_code === stateCode;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setStateCode(s.state_code)}
              className={`min-h-[92px] rounded-xl border p-3 text-left transition-colors ${selected ? "border-accent bg-accent/10" : "border-border bg-card hover:border-accent/40"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate whitespace-nowrap font-display text-[13px] font-medium">{s.state_name}</span>
                <Badge variant="outline" className="shrink-0">{s.state_code}</Badge>
              </div>
              <div className="mt-2 whitespace-nowrap font-display text-[26px] leading-none tabular-nums">{count}</div>
              <div className="mt-1 truncate whitespace-nowrap text-xs text-muted-foreground">Last no. {s.last_sequence}</div>
            </button>
          );
        })}
      </div>

      {/* Next number */}
      <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Next number for {activeSeries?.state_name ?? "-"} ({currentMonth})</div>
            <div className="mt-1 flex items-center gap-2 font-display text-[22px] leading-none tabular-nums sm:text-[26px]">
              <Hash className="h-5 w-5 text-accent" />
              <span className="whitespace-nowrap">{nextNumber}</span>
            </div>
          </div>
          <div className="w-[180px]">
            <Label className="text-xs">Client code (optional)</Label>
            <Select value={previewToken || "none"} onValueChange={(v) => setPreviewToken(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No code</SelectItem>
                {stateTokens.filter((t) => t.enabled).map((t) => (
                  <SelectItem key={t.id} value={t.token}>{t.token}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canEdit && activeSeries && (
            <Button variant="outline" size="sm" onClick={() => openSeries(activeSeries)}>
              <Wand2 className="mr-1.5 h-4 w-4" /> Adjust series
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Invoicing picks this number automatically from the invoice date and the client's billing state.
        </p>
      </div>

      {/* Month on month */}
      <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-display text-sm font-medium">Month on month — {activeSeries?.state_name ?? "-"}</div>
          <div className="whitespace-nowrap text-sm text-muted-foreground tabular-nums">Total {stateTotal}</div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {MONTH_CODES.map((m) => {
            const row = stateMonthCounts.find((c) => c.month_code === m);
            return (
              <div key={m} className="rounded-lg border border-border/70 bg-background/60 p-2">
                <div className="text-[11px] text-muted-foreground">{m}</div>
                <div className="whitespace-nowrap font-display text-[20px] leading-none tabular-nums">{row?.invoice_count ?? 0}</div>
              </div>
            );
          })}
        </div>
        {stateMonthCounts.some((m) => m.month_order === 99) && (
          <p className="mt-2 text-xs text-muted-foreground">Arrear numbers are grouped separately in the register.</p>
        )}
      </div>

      {/* Client codes */}
      <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-display text-sm font-medium">Client codes for {activeSeries?.state_name ?? "-"}</div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => openToken(null)}>
              <Plus className="mr-1.5 h-4 w-4" /> Add code
            </Button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {stateTokens.length === 0 && <span className="text-sm text-muted-foreground">No client codes yet.</span>}
          {stateTokens.map((t) => (
            <div key={t.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${t.enabled ? "border-border bg-background/60" : "border-dashed border-border/60 opacity-60"}`}>
              <span className="whitespace-nowrap font-mono text-xs">{t.token}</span>
              <span className="max-w-[180px] truncate text-xs text-muted-foreground">{t.sample_party_name ?? ""}</span>
              {canEdit && (
                <button type="button" aria-label={`Edit ${t.token}`} onClick={() => openToken(t)} className="text-muted-foreground hover:text-accent">
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  aria-label={`Delete ${t.token}`}
                  onClick={async () => {
                    if (await confirmAction({ title: `Remove ${t.token}?`, description: "Issued numbers keep this code." })) {
                      deleteToken.mutate(t);
                    }
                  }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Register */}
      <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, party or IRN" className="h-9 pl-8" />
          </div>
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {MONTH_CODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="whitespace-nowrap py-2 pr-3">Invoice No</th>
                <th className="py-2 pr-3">Party</th>
                <th className="whitespace-nowrap py-2 pr-3">Month</th>
                <th className="whitespace-nowrap py-2 pr-3">Seq</th>
                <th className="whitespace-nowrap py-2 pr-3">Code</th>
                <th className="py-2">IRN / Remarks</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No numbers found.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs">{r.invoice_no}</td>
                  <td className="max-w-[260px] truncate py-2 pr-3">{r.party_name ?? "-"}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{r.month_code}</td>
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{r.sequence}</td>
                  <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs">{r.client_token ?? "-"}</td>
                  <td className="max-w-[260px] truncate py-2 text-xs text-muted-foreground">
                    {[r.irn_number, r.remarks, r.irn_date_text].filter(Boolean).join(" · ") || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DataPagination
          page={page}
          setPage={setPage}
          pageSize={pageSize}
          setPageSize={setPageSize}
          pageCount={pageCount}
          total={total}
          start={(page - 1) * pageSize}
          end={Math.min(page * pageSize, total)}
          pageRows={rows}
          label="numbers"
        />
      </div>

      {/* Series dialog */}
      <Dialog open={seriesDialog !== null} onOpenChange={(open) => { if (!open) setSeriesDialog(null); }}>
        <DialogContent className="modern-business-form">
          <DialogHeader>
            <DialogTitle>{seriesDialog?.id ? "Edit series" : "Add state series"}</DialogTitle>
            <DialogDescription>Numbers are issued as PREFIX-MONTHFY-CODE0000.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>State code</Label>
              <Input value={seriesDraft.state_code} maxLength={4} onChange={(e) => setSeriesDraft({ ...seriesDraft, state_code: e.target.value.toUpperCase() })} className="mt-1 font-mono" />
            </div>
            <div>
              <Label>State name</Label>
              <Input value={seriesDraft.state_name} onChange={(e) => setSeriesDraft({ ...seriesDraft, state_name: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Number prefix</Label>
              <Input value={seriesDraft.number_prefix} maxLength={6} onChange={(e) => setSeriesDraft({ ...seriesDraft, number_prefix: e.target.value.toUpperCase() })} className="mt-1 font-mono" />
            </div>
            <div>
              <Label>Fiscal year</Label>
              <Input value={seriesDraft.fiscal_year} onChange={(e) => setSeriesDraft({ ...seriesDraft, fiscal_year: e.target.value })} className="mt-1 font-mono" placeholder="26-27" />
            </div>
            <div>
              <Label>Last used sequence</Label>
              <Input type="number" value={seriesDraft.last_sequence} onChange={(e) => setSeriesDraft({ ...seriesDraft, last_sequence: Number(e.target.value) })} className="mt-1 tabular-nums" />
            </div>
            <div>
              <Label>Digits</Label>
              <Input type="number" value={seriesDraft.seq_padding} onChange={(e) => setSeriesDraft({ ...seriesDraft, seq_padding: Number(e.target.value) })} className="mt-1 tabular-nums" />
            </div>
            <div className="sm:col-span-2">
              <Label>Notes</Label>
              <Input value={seriesDraft.notes} onChange={(e) => setSeriesDraft({ ...seriesDraft, notes: e.target.value })} className="mt-1" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
              <span className="text-sm">Active</span>
              <Switch checked={seriesDraft.enabled} onCheckedChange={(v) => setSeriesDraft({ ...seriesDraft, enabled: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeriesDialog(null)}>Cancel</Button>
            <Button onClick={() => saveSeries.mutate()} disabled={!canEdit || saveSeries.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token dialog */}
      <Dialog open={tokenDialog !== null} onOpenChange={(open) => { if (!open) setTokenDialog(null); }}>
        <DialogContent className="modern-business-form">
          <DialogHeader>
            <DialogTitle>{tokenDialog?.id ? "Edit client code" : "Add client code"}</DialogTitle>
            <DialogDescription>These letters sit between the month and the sequence.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>State code</Label>
              <Input value={tokenDraft.state_code} maxLength={4} onChange={(e) => setTokenDraft({ ...tokenDraft, state_code: e.target.value.toUpperCase() })} className="mt-1 font-mono" />
            </div>
            <div>
              <Label>Client code</Label>
              <Input value={tokenDraft.token} maxLength={8} onChange={(e) => setTokenDraft({ ...tokenDraft, token: e.target.value.toUpperCase() })} className="mt-1 font-mono" />
            </div>
            <div className="sm:col-span-2">
              <Label>Client name</Label>
              <Input value={tokenDraft.sample_party_name} onChange={(e) => setTokenDraft({ ...tokenDraft, sample_party_name: e.target.value })} className="mt-1" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
              <span className="text-sm">Active</span>
              <Switch checked={tokenDraft.enabled} onCheckedChange={(v) => setTokenDraft({ ...tokenDraft, enabled: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTokenDialog(null)}>Cancel</Button>
            <Button onClick={() => saveToken.mutate()} disabled={!canEdit || saveToken.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
