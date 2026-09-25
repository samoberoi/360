import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useOrgSettings } from "@/lib/org-settings";
import { logActivity } from "@/lib/activity-log";

export const Route = createFileRoute("/admin/org-settings")({
  component: OrgSettingsPage,
  head: () => ({
    meta: [
      { title: "Company Settings | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Manage company, statutory, bank, and invoice settings." },
      { property: "og:title", content: "Company Settings | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Manage company, statutory, bank, and invoice settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type FieldKey =
  | "company_name" | "company_gstin" | "company_state" | "company_state_code"
  | "registered_address" | "corporate_address" | "cin" | "pan" | "email" | "phone"
  | "bank_name" | "bank_account_no" | "bank_branch" | "bank_ifsc"
  | "supplier_type" | "msme_udyam_no" | "pf_number" | "esic_number"
  | "default_hsn_sac" | "invoice_declaration" | "invoice_note";

const FIELD_KEYS: FieldKey[] = [
  "company_name", "company_gstin", "company_state", "company_state_code",
  "registered_address", "corporate_address", "cin", "pan", "email", "phone",
  "bank_name", "bank_account_no", "bank_branch", "bank_ifsc",
  "supplier_type", "msme_udyam_no", "pf_number", "esic_number",
  "default_hsn_sac", "invoice_declaration", "invoice_note",
];

function OrgSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useOrgSettings();
  const [form, setForm] = useState<Record<FieldKey, string>>(
    () => Object.fromEntries(FIELD_KEYS.map((k) => [k, ""])) as Record<FieldKey, string>,
  );

  useEffect(() => {
    if (!data) return;
    setForm(
      Object.fromEntries(
        FIELD_KEYS.map((k) => [k, (data as unknown as Record<string, string | null>)[k] ?? ""]),
      ) as Record<FieldKey, string>,
    );
  }, [data]);

  const set = (k: FieldKey) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = Object.fromEntries(
        FIELD_KEYS.map((k) => [k, form[k].trim() || null]),
      ) as Record<string, string | null>;
      if (data?.id) {
        const { error } = await supabase
          .from("org_settings" as never)
          .update(payload as never)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("org_settings" as never)
          .insert(payload as never);
        if (error) throw error;
      }
      void logActivity({
        module: "Company Settings",
        action: "update",
        entityType: "org_settings",
        entityId: data?.id,
        entityLabel: form.company_name,
        details: payload,
      });
    },
    onSuccess: () => {
      toast.success("Company settings saved");
      void qc.invalidateQueries({ queryKey: ["org_settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const Field = ({ k, label, hint, upper }: { k: FieldKey; label: string; hint?: string; upper?: boolean }) => (
    <div className="modern-form-field">
      <Label>{label}</Label>
      <Input
        value={form[k]}
        onChange={(e) => set(k)(upper ? e.target.value.toUpperCase() : e.target.value)}
      />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Company Settings"
        description="Legal entity, statutory registrations and bank details — printed on every tax invoice."
        crumbs={[{ label: "Control Center", to: "/admin/control-center" }, { label: "Company Settings" }]}
      />

      <form
        className="modern-business-form mx-auto max-w-3xl"
        onSubmit={(event) => {
          event.preventDefault();
          saveMut.mutate();
        }}
      >
        <section className="modern-form-section">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-semibold">Registered entity</div>
              <div className="text-sm text-muted-foreground">Header block of the tax invoice.</div>
            </div>
          </div>

          <div className="grid gap-4">
            <Field k="company_name" label="Company Name" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field k="company_gstin" label="GSTIN" upper />
              <Field k="company_state_code" label="State Code" />
            </div>
            <Field
              k="company_state"
              label="State"
              hint="Invoices to customers in this state → CGST + SGST. Other states → IGST."
            />
            <Field k="registered_address" label="Registered Office Address" />
            <Field k="corporate_address" label="Corporate Office Address" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field k="cin" label="CIN" upper />
              <Field k="pan" label="PAN" upper />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field k="email" label="E-Mail" />
              <Field k="phone" label="Phone" />
            </div>
          </div>
        </section>

        <section className="modern-form-section">
          <div className="mb-4 text-base font-semibold">Statutory registrations</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field k="pf_number" label="PF No." />
            <Field k="esic_number" label="ESIC No." />
            <Field k="supplier_type" label="Supplier Type" hint="e.g. MSME" />
            <Field k="msme_udyam_no" label="Udyam Registration No." upper />
            <Field k="default_hsn_sac" label="Default HSN / SAC" hint="Printed on every service line." />
          </div>
        </section>

        <section className="modern-form-section">
          <div className="mb-4 text-base font-semibold">Bank details</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field k="bank_name" label="Bank Name" />
            <Field k="bank_account_no" label="A/c No." />
            <Field k="bank_branch" label="Branch" />
            <Field k="bank_ifsc" label="IFS Code" upper />
          </div>
        </section>

        <section className="modern-form-section">
          <div className="mb-4 text-base font-semibold">Invoice footer</div>
          <div className="grid gap-4">
            <Field k="invoice_declaration" label="Declaration" />
            <Field k="invoice_note" label="Note" />
          </div>
        </section>

        <div className="sticky-action-bar flex justify-end border-t border-border bg-card py-4 pb-8">
          <Button type="submit" disabled={saveMut.isPending || isLoading}>
            {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}

