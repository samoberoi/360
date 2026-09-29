import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { signedProofUrl, type FieldVisit } from "@/lib/field-visits";

function hhmm(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function VisitDetailDialog({
  visit,
  unitName,
  address,
  onClose,
}: {
  visit: FieldVisit | null;
  unitName: string;
  address: string | null;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["visit-detail-proofs", visit?.id, visit?.client_photo_url, visit?.client_signature_url, visit?.check_in_selfie_path],
    enabled: !!visit,
    staleTime: 8 * 60_000,
    queryFn: async () => {
      const [photo, sign, selfie] = await Promise.all([
        signedProofUrl(visit!.client_photo_url),
        signedProofUrl(visit!.client_signature_url),
        signedProofUrl(visit!.check_in_selfie_path ?? null),
      ]);
      return { photo, sign, selfie };
    },
  });
  return (
    <Dialog open={!!visit} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {visit && (
          <>
            <DialogHeader>
              <DialogTitle className="leading-snug">Visit #{visit.visit_seq} · {unitName}</DialogTitle>
            </DialogHeader>
            {address && <p className="text-[13px] text-muted-foreground">{address}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Box label="Checked in" value={hhmm(visit.check_in_at)} />
              <Box label="Checked out" value={visit.check_out_at ? hhmm(visit.check_out_at) : "In meeting"} />
            </div>
            <Field label="Client met" value={visit.client_name || "—"} />
            <Field
              label="Rating"
              value={visit.customer_rating != null ? (
                <span className="inline-flex items-center gap-1"><Star className="h-4 w-4 fill-current" /> {visit.customer_rating} / 5</span>
              ) : "—"}
            />
            <Field label="Feedback / notes" value={visit.visit_notes || "—"} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Photo</div>
                {q.data?.photo || q.data?.selfie ? (
                  <a href={(q.data.photo ?? q.data.selfie)!} target="_blank" rel="noopener noreferrer">
                    <img src={(q.data.photo ?? q.data.selfie)!} alt="Visit photo" className="w-full rounded-xl border border-border/60 object-cover" />
                  </a>
                ) : <Empty />}
              </div>
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Client signature</div>
                {q.data?.sign ? (
                  <img src={q.data.sign} alt="Client signature" className="w-full rounded-xl border border-border/60 bg-muted/30 object-contain p-2" />
                ) : <Empty />}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}
function Empty() {
  return <div className="grid h-24 place-items-center rounded-xl border border-dashed border-border/60 text-[11px] text-muted-foreground">Not captured</div>;
}
