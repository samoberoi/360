import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Package, KeyRound, Check } from "lucide-react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, isSuperAdminPhone } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { PageHeader } from "@/components/PageHeader";
import { DashboardShell } from "@/components/LiveFeed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { statusBadgeClass, postMovements, type LocationType } from "@/lib/inv-helpers";
import { DashboardSkeleton } from "@/components/Skeletons";
import { DataPagination, usePagination } from "@/components/DataPagination";

export const Route = createFileRoute("/admin/my-inventory")({ component: MyInventoryPage });

type Issuance = {
  id: string;
  issuance_number: string;
  issuance_type: string;
  issuance_date: string;
  status: string;
  source_type: string;
  source_id: string;
  destination_type: string;
  destination_id: string;
  ack_method: string;
  otp_code: string | null;
  notes: string;
  acknowledged_at: string | null;
};
type Line = {
  id: string;
  issuance_id: string;
  item_id: string;
  size_value: string;
  qty: number;
  condition: string;
};
type Item = { id: string; name: string; item_code: string };

function MyInventoryPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const phone = user?.phone?.replace(/\D/g, "").slice(-10) ?? "";
  const isSuperAdmin = isSuperAdminPhone(phone);

  const { data: me = null, isLoading: meLoading } = useQuery({
    queryKey: ["candidate-by-phone", phone],
    enabled: !!phone,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates" as never)
        .select("id,full_name,employee_code,role_key")
        .eq("mobile", phone)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as {
        id: string;
        full_name: string;
        employee_code: string;
        role_key: string;
      } | null;
    },
  });

  const { data: issuances = [] } = useQuery({
    queryKey: ["my-issuances", me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inv_issuances" as never)
        .select("*")
        .eq("destination_id", me!.id)
        .in("destination_type", ["guard", "field_officer"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as Issuance[]) ?? [];
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["my-issuance-lines", issuances.map((i) => i.id).join(",")],
    enabled: issuances.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inv_issuance_lines" as never)
        .select("*")
        .in(
          "issuance_id",
          issuances.map((i) => i.id),
        );
      if (error) throw error;
      return (data as unknown as Line[]) ?? [];
    },
  });

  // Live net possession from inv_stock_balances (accounts for collections, transfers, hand-outs)
  const { data: holdings = [] } = useQuery({
    queryKey: ["my-stock-balance", me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inv_stock_balances" as never)
        .select("item_id,size_value,qty")
        .eq("location_id", me!.id)
        .in("location_type", ["guard", "field_officer"]);
      if (error) throw error;
      return ((data as unknown as { item_id: string; size_value: string; qty: number }[]) ?? [])
        .filter((r) => Number(r.qty) > 0)
        .map((r) => ({ item_id: r.item_id, size_value: r.size_value ?? "", qty: Number(r.qty) }));
    },
  });

  const itemIds = useMemo(
    () => Array.from(new Set([...lines.map((l) => l.item_id), ...holdings.map((h) => h.item_id)])),
    [lines, holdings],
  );
  const { data: items = [] } = useQuery({
    queryKey: ["items-by-id", itemIds.join(",")],
    enabled: itemIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inv_items" as never)
        .select("id,name,item_code")
        .in("id", itemIds);
      if (error) throw error;
      return (data as unknown as Item[]) ?? [];
    },
  });

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const linesByIss = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of lines) {
      const arr = m.get(l.issuance_id) ?? [];
      arr.push(l);
      m.set(l.issuance_id, arr);
    }
    return m;
  }, [lines]);

  // Realtime: refresh on any stock movement touching this user's location
  useEffect(() => {
    if (!me?.id) return;
    const ch = supabase
      .channel(`my-inv-${me.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inv_stock_movements",
          filter: `location_id=eq.${me.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["my-stock-balance", me.id] });
          qc.invalidateQueries({ queryKey: ["my-issuances", me.id] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inv_issuances",
          filter: `destination_id=eq.${me.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["my-issuances", me.id] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [me?.id, qc]);

  const pending = issuances.filter((i) => i.status === "issued");
  const pg = usePagination(holdings);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["my-issuances"] });
    qc.invalidateQueries({ queryKey: ["inv", "issuances"] });
  };

  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});

  const ackMut = useMutation({
    mutationFn: async (i: Issuance) => {
      if (i.ack_method === "otp") {
        const entered = (otpInputs[i.id] ?? "").trim();
        if (!entered) throw new Error("Enter the OTP shared by your Field Officer");
        if (entered !== (i.otp_code ?? "")) throw new Error("OTP does not match");
      }
      const { error } = await supabase
        .from("inv_issuances" as never)
        .update({
          status: "completed",
          acknowledged_at: new Date().toISOString(),
          ack_otp_verified: i.ack_method === "otp",
          received_at: new Date().toISOString(),
          received_by: me?.id ?? null,
        } as never)
        .eq("id", i.id);
      if (error) throw error;
      // Post IN movements at the receiver's location now that they've confirmed.
      const issLines = linesByIss.get(i.id) ?? [];
      if (issLines.length) {
        await postMovements(
          issLines.map((l) => ({
            movement_type: `ISSUE_${i.destination_type.toUpperCase()}_IN`,
            location_type: i.destination_type as LocationType,
            location_id: i.destination_id,
            item_id: l.item_id,
            size_value: l.size_value ?? "",
            qty_change: Number(l.qty ?? 0),
            reference_type: "issuance",
            reference_id: i.id,
          })),
        );
      }
      void logActivity({
        module: "Inventory Issuances",
        action: i.ack_method === "otp" ? "acknowledge_otp" : "acknowledge",
        entityType: "inv_issuances",
        entityId: i.id,
        entityLabel: i.issuance_number,
      });
    },
    onSuccess: () => {
      toast.success("Confirmed receipt — added to your inventory");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isSuperAdmin) {
    return (
      <div className="text-sm text-muted-foreground">
        My Uniform is for end-users (guards). Switch account.
      </div>
    );
  }
  if (meLoading) return <DashboardSkeleton />;
  if (!me)
    return (
      <div className="text-sm text-muted-foreground">No employee profile found for this phone.</div>
    );

  return (
    <DashboardShell>
      <PageHeader
        title="My Uniform"
        description="Items assigned to you and pending confirmations."
        crumbs={[{ label: "My Uniform" }]}
      />

      {pending.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Pending OTP confirmations</h2>
          </div>
          <div className="space-y-4">
            {pending.map((i) => (
              <div key={i.id} className="rounded-xl border border-border p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {i.issuance_number}
                    </div>
                    <div className="text-xs text-muted-foreground">Issued {i.issuance_date}</div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${statusBadgeClass(i.status)}`}
                  >
                    {i.status}
                  </span>
                </div>
                <ul className="mb-3 list-disc pl-5 text-sm">
                  {(linesByIss.get(i.id) ?? []).map((l) => (
                    <li key={l.id}>
                      {itemMap.get(l.item_id)?.name ?? "—"}
                      {l.size_value ? ` (${l.size_value})` : ""} × {l.qty}
                    </li>
                  ))}
                </ul>
                {i.ack_method === "otp" ? (
                  <div className="space-y-3">
                    {i.otp_code && (
                      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          OTP
                        </span>
                        <span className="font-mono text-lg tracking-[0.4em] text-primary">
                          {i.otp_code}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-7 px-2 text-xs"
                          onClick={() => {
                            navigator.clipboard.writeText(i.otp_code ?? "");
                            setOtpInputs((s) => ({ ...s, [i.id]: i.otp_code ?? "" }));
                            toast.success("OTP copied");
                          }}
                        >
                          Copy
                        </Button>
                        <span className="w-full text-[11px] text-muted-foreground">
                          In production this OTP will be sent to your phone. For now it is shown
                          here — paste it below and confirm.
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="grid flex-1 gap-1">
                        <Label className="text-xs">Enter 6-digit OTP</Label>
                        <Input
                          value={otpInputs[i.id] ?? ""}
                          onChange={(e) => setOtpInputs((s) => ({ ...s, [i.id]: e.target.value }))}
                          placeholder="••••••"
                          inputMode="numeric"
                          maxLength={6}
                          className="font-mono tracking-[0.4em]"
                        />
                      </div>
                      <Button onClick={() => ackMut.mutate(i)} disabled={ackMut.isPending}>
                        <Check className="mr-1 h-4 w-4" />
                        Acknowledge
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-end justify-end">
                    <Button onClick={() => ackMut.mutate(i)} disabled={ackMut.isPending}>
                      <Check className="mr-1 h-4 w-4" />
                      Confirm Delivery Challan
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Currently assigned to me</h2>
        </div>
        {holdings.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Nothing assigned yet.
          </div>
        ) : (
          <table className="ios-table w-full text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Size</th>
                <th className="px-4 py-2 text-right">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pg.pageRows.map((h) => (
                <tr key={`${h.item_id}-${h.size_value}`}>
                  <td className="px-4 py-2 font-medium">{itemMap.get(h.item_id)?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{h.size_value || "—"}</td>
                  <td className="px-4 py-2 text-right">{h.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {holdings.length > 0 && <DataPagination {...pg} />}
      </section>
    </DashboardShell>
  );
}
