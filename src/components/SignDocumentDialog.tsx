import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileSignature, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/SignaturePad";
import { DocumentPreview } from "@/components/DocumentPreview";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";
import {
  DOC_TYPE_LABELS,
  DOC_TYPE_SHORT,
  buildPlaceholderMap,
  isHtmlBody,
  downloadBlob,
  fetchActiveTemplate,
  fetchCandidateForRender,
  generateDocumentPdf,
  renderTemplate,
  type DocType,
  type SignedDocument,
} from "@/lib/company-documents";

export function SignDocumentDialog({
  open,
  onOpenChange,
  candidateId,
  docType,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidateId: string | null;
  docType: DocType;
}) {
  const enabled = open && !!candidateId;

  const { data, isLoading, error } = useQuery({
    queryKey: ["signing", candidateId, docType, open],
    enabled,
    queryFn: async () => {
      const [candidate, template] = await Promise.all([
        fetchCandidateForRender(candidateId as string),
        fetchActiveTemplate(docType),
      ]);
      if (!template) throw new Error(`No active ${DOC_TYPE_SHORT[docType]} template. Publish one in Company Documents first.`);
      // Existing signed copy?
      const { data: existing } = await supabase
        .from("employee_signed_documents")
        .select("*")
        .eq("candidate_id", candidateId as string)
        .eq("doc_type", docType)
        .order("created_at", { ascending: false })
        .limit(1);
      const prev = ((existing as unknown) as SignedDocument[] | null)?.[0] ?? null;
      return { candidate, template, prev };
    },
  });

  const rendered = useMemo(() => {
    if (!data) return "";
    return renderTemplate(data.template.body, buildPlaceholderMap(data.candidate, isHtmlBody(data.template.body)));
  }, [data]);

  const [signature, setSignature] = useState<string>("");
  const [companySignature, setCompanySignature] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSignature(data?.prev?.employee_signature_data ?? "");
      setCompanySignature(data?.prev?.company_signature_data ?? "");
    }
  }, [open, data?.prev?.employee_signature_data, data?.prev?.company_signature_data]);

  const handleSignAndDownload = async () => {
    if (!data || !candidateId) return;
    if (!signature) {
      toast.error("Please sign in the box before downloading.");
      return;
    }
    setSaving(true);
    try {
      const signedAt = new Date().toISOString();
      const { data: inserted, error: e1 } = await supabase
        .from("employee_signed_documents")
        .insert({
          candidate_id: candidateId,
          template_id: data.template.id,
          doc_type: docType,
          version: data.template.version,
          rendered_body: rendered,
          employee_signature_data: signature,
          company_signature_data: companySignature,
          signed_at: signedAt,
        })
        .select("id")
        .maybeSingle();
      if (e1) throw e1;
      void logActivity({
        module: "Company Documents",
        action: "sign",
        entityType: "employee_signed_documents",
        entityId: (inserted?.id as string) ?? "",
        entityLabel: `${DOC_TYPE_SHORT[docType]} — ${data.candidate.full_name}`,
        details: { candidate_id: candidateId, doc_type: docType, version: data.template.version },
      });
      const blob = await generateDocumentPdf({
        title: data.template.title,
        body: rendered,
        employeeSignatureDataUrl: signature,
        companySignatureDataUrl: companySignature || undefined,
        employeeName: data.candidate.full_name,
        employeeCode: data.candidate.employee_code,
        signedAt,
      });
      const fname = `${DOC_TYPE_SHORT[docType].replace(/ /g, "_")}_${data.candidate.employee_code || data.candidate.candidate_code || data.candidate.id}.pdf`;
      await downloadBlob(blob, fname);
      toast.success("Signed and downloaded");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to sign");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-amber-600" />
            {DOC_TYPE_LABELS[docType]}
          </DialogTitle>
          <DialogDescription>
            Review the document, sign in the employee box, and add the employer signature. Then download a stamped PDF.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing document…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load document"}
          </div>
        )}
        {data && (
          <>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono">v{data.template.version}</span>
                {data.prev?.signed_at && <span>Previously signed on {new Date(data.prev.signed_at).toLocaleDateString("en-IN")}</span>}
              </div>
              <DocumentPreview body={rendered} className="max-h-[60vh]" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>Employee Signature</Label>
                <SignaturePad value={signature} onChange={setSignature} />
              </div>
              <div className="grid gap-2">
                <Label>Employer Signature (for PLUS 360)</Label>
                <SignaturePad value={companySignature} onChange={setCompanySignature} />
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSignAndDownload} disabled={saving || !data || !signature}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            Sign &amp; Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
