import { MyLiveStatusCard } from "@/components/MyLiveStatusCard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Briefcase,
  Camera,
  Download,
  FileSignature,
  GraduationCap,
  Heart,
  IdCard,
  Languages as LanguagesIcon,
  Mail,
  MapPin,
  Phone as PhoneIcon,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  Package,
  UserCheck,
  Loader2,
  Wallet,
  Building2,
  X,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "@/lib/use-theme";
import { useNavigate } from "@tanstack/react-router";
import { computeWages, fmtINR, type ContractResourceLike } from "@/lib/payroll-calc";
import { PageHeader } from "@/components/PageHeader";
import { useI18n, LANG_LABELS, type LangCode } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  DOC_TYPE_LABELS,
  generateDocumentPdf,
  downloadBlob,
  type DocType,
} from "@/lib/company-documents";
import { logActivity } from "@/lib/activity-log";
import { OffboardingRecordsSection } from "@/components/offboarding-records-section";

export const Route = createFileRoute("/admin/profile")({
  component: ProfilePage,
  head: () => ({
    meta: [
      { title: "My Profile | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "View your PLUS 360 employee profile, posting, CTC, and documents." },
      { property: "og:title", content: "My Profile | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "View your PLUS 360 employee profile, posting, CTC, and documents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function CameraCaptureDialog({
  open,
  onOpenChange,
  onCapture,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string>("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setReady(false);
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (e: any) {
        setError(e?.message || "Camera not available");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  function snap() {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
        onOpenChange(false);
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Take a photo</DialogTitle>
        </DialogHeader>
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
          {error ? (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-destructive">
              {error}
            </div>
          ) : (
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="mr-1.5 h-4 w-4" /> Cancel
          </Button>
          <Button onClick={snap} disabled={!ready || !!error}>
            <Camera className="mr-1.5 h-4 w-4" /> Capture
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ProfileData = {
  id: string;
  full_name: string;
  employee_code: string;
  candidate_code: string;
  status: string;
  role_key: string;
  photo_url: string;
  aadhaar_image_url: string;
  pan_image_url: string;
  signature_url: string;
  aadhaar_number: string;
  pan_number: string;
  mobile: string;
  email: string;
  date_of_birth: string | null;
  gender: string;
  marital_status: string;
  blood_group?: string;
  present_address1: string;
  present_address2: string;
  present_city: string;
  present_state: string;
  present_pincode: string;
  permanent_address1: string;
  permanent_city: string;
  permanent_state: string;
  permanent_pincode: string;
  bank_account_holder: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_name: string;
  bank_branch: string;
  preferred_joining_date: string | null;
  approved_at: string | null;
  unit_id: string | null;
  designation_id: string | null;
  reports_to: string | null;
  emergency_contact_name: string;
  emergency_contact_relation: string;
  emergency_contact_mobile: string;
  bank_account_type: string;
  documents: Array<{ name?: string; url?: string; type?: string }>;
  identification_proofs: Array<{ type?: string; number?: string; url?: string }>;
  assigned_asset_ids: string[];
  contacts: Array<{ name?: string; relation?: string; mobile?: string; occupation?: string; alive?: boolean }>;
  nominations: Array<{ name?: string; relation?: string; share?: number; dob?: string; aadhaar?: string }>;
  references: Array<{ name?: string; relation?: string; mobile?: string; email?: string; address?: string }>;
  languages: Array<{ name?: string; read?: boolean; write?: boolean; speak?: boolean }>;
  experiences: Array<{ company?: string; designation?: string; from?: string; to?: string; salary?: string; reason_for_leaving?: string }>;
  educations: Array<{ qualification?: string; institution?: string; year?: string; percentage?: string }>;
  extra_curricular: Array<{ activity?: string; level?: string; year?: string }>;
  criminal_history: { has_history?: boolean; incidents?: Array<{ description?: string; year?: string }> };
  physical_health_full: Record<string, string>;
  other_info: Record<string, string>;
  offboarding_details: Record<string, any> | null;
};

type LookupRow = { id: string; name: string };
type UnitRow = { id: string; name: string; city?: string };
type SignedDocRow = {
  id: string;
  doc_type: string;
  version: number;
  signed_at: string | null;
  rendered_body: string;
  employee_signature_data: string;
  company_signature_data: string;
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-secondary/35 px-3 py-2.5">
      <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="mt-0.5 block break-words text-[13px] font-medium text-foreground">
        {value || "—"}
      </span>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
  className = "",
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm ${className}`}>
      <div className="flex min-h-14 items-center gap-3 border-b border-border/60 px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-inset ring-accent/15">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
      </div>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme, mounted: themeMounted } = useTheme();
  function handleSignOut() {
    logout();
    navigate({ to: "/login", replace: true });
  }
  const bottomActions = (
    <div className="rounded-xl border border-border bg-card p-2 shadow-sm">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={toggleTheme}
          className="h-11 justify-center gap-2 rounded-lg bg-secondary/50 px-3 text-sm text-foreground hover:bg-secondary"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-background text-primary shadow-sm">
            {themeMounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </span>
          {themeMounted && theme === "dark" ? "Light mode" : "Dark mode"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={handleSignOut}
          className="h-11 justify-center gap-2 rounded-lg bg-destructive/5 px-3 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-destructive/10 text-destructive">
            <LogOut className="h-4 w-4" />
          </span>
          Sign out
        </Button>
      </div>
    </div>
  );
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [downloadingDoc, setDownloadingDoc] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const phone = useMemo(
    () => (user?.phone ?? "").replace(/\D/g, "").slice(-10),
    [user?.phone],
  );

  const profileQ = useQuery({
    queryKey: ["my-profile", phone],
    enabled: !!phone,
    queryFn: async (): Promise<ProfileData | null> => {
      const { data, error } = await supabase
        .from("candidates")
        .select(
          "id,full_name,employee_code,candidate_code,status,role_key,photo_url,aadhaar_image_url,pan_image_url,signature_url,aadhaar_number,pan_number,mobile,email,date_of_birth,gender,marital_status,present_address1,present_address2,present_city,present_state,present_pincode,permanent_address1,permanent_city,permanent_state,permanent_pincode,bank_account_holder,bank_account_number,bank_ifsc,bank_name,bank_branch,bank_account_type,emergency_contact_name,emergency_contact_relation,emergency_contact_mobile,preferred_joining_date,approved_at,unit_id,designation_id,reports_to,documents,identification_proofs,assigned_asset_ids,physical_health,contacts,nominations,references,languages,experiences,educations,extra_curricular,criminal_history,other_info,offboarding_details",
        )
        .eq("mobile", phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as any;
      const arr = (v: any) => (Array.isArray(v) ? v : []);
      return {
        ...row,
        blood_group: row.physical_health?.blood_group ?? "",
        physical_health_full: row.physical_health ?? {},
        other_info: row.other_info ?? {},
        offboarding_details: row.offboarding_details && typeof row.offboarding_details === "object" ? row.offboarding_details : null,
        documents: arr(row.documents),
        identification_proofs: arr(row.identification_proofs),
        assigned_asset_ids: arr(row.assigned_asset_ids),
        contacts: arr(row.contacts),
        nominations: arr(row.nominations),
        references: arr(row.references),
        languages: arr(row.languages),
        experiences: arr(row.experiences),
        educations: arr(row.educations),
        extra_curricular: arr(row.extra_curricular),
        criminal_history: row.criminal_history ?? { has_history: false, incidents: [] },
      } as ProfileData;
    },
  });

  const profile = profileQ.data ?? null;

  const lookupsQ = useQuery({
    queryKey: ["my-profile-lookups", profile?.unit_id, profile?.designation_id, profile?.role_key],
    enabled: !!profile,
    queryFn: async () => {
      const [unitRes, desigRes, roleRes, assetRes] = await Promise.all([
        profile?.unit_id
          ? supabase.from("units").select("id,name,city").eq("id", profile.unit_id).maybeSingle()
          : Promise.resolve({ data: null, error: null } as any),
        profile?.designation_id
          ? supabase
              .from("designations")
              .select("id,name")
              .eq("id", profile.designation_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null } as any),
        profile?.role_key
          ? supabase.from("roles").select("key,name").eq("key", profile.role_key).maybeSingle()
          : Promise.resolve({ data: null, error: null } as any),
        profile?.assigned_asset_ids?.length
          ? supabase.from("assets").select("id,name").in("id", profile.assigned_asset_ids)
          : Promise.resolve({ data: [], error: null } as any),
      ]);
      return {
        unit: (unitRes.data as UnitRow | null) ?? null,
        designation: (desigRes.data as LookupRow | null) ?? null,
        role: (roleRes.data as { key: string; name: string } | null) ?? null,
        assets: (assetRes.data as LookupRow[] | null) ?? [],
      };
    },
  });

  const stockBalanceQ = useQuery({
    queryKey: ["my-stock-balance", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inv_stock_balances" as never)
        .select("item_id,size_value,qty,inv_items(id,name,item_code,unit)")
        .eq("location_id", profile!.id)
        .in("location_type", ["guard", "security_guard", "field_officer", "candidate", "employee"]);
      if (error) throw error;
      type Row = {
        item_id: string;
        size_value: string;
        qty: number;
        inv_items: { id: string; name: string; item_code: string; unit: string } | null;
      };
      return ((data as unknown as Row[]) ?? [])
        .filter((r) => Number(r.qty) > 0)
        .map((r) => ({
          item_id: r.item_id,
          item_name: r.inv_items?.name ?? "Unknown item",
          item_code: r.inv_items?.item_code ?? "",
          unit: r.inv_items?.unit ?? "",
          size_value: r.size_value ?? "",
          qty: Number(r.qty),
        }));
    },
  });

  useEffect(() => {
    if (!profile?.id) return;
    const ch = supabase
      .channel(`profile-stock-${profile.id}`)
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "inv_stock_movements", filter: `location_id=eq.${profile.id}` } as never,
        () => { void stockBalanceQ.refetch(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [profile?.id, stockBalanceQ]);


  const postingsQ = useQuery({
    queryKey: ["my-postings", profile?.id, profile?.reports_to],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data: cu, error: cuErr } = await supabase
        .from("candidate_units")
        .select("unit_id,is_primary,sort_order")
        .eq("candidate_id", profile!.id)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true });
      if (cuErr) throw cuErr;
      const unitIds = Array.from(
        new Set(
          [
            ...(cu ?? []).map((r: any) => r.unit_id),
            profile?.unit_id,
          ].filter(Boolean) as string[],
        ),
      );
      let units: any[] = [];
      if (unitIds.length) {
        const { data: u, error: uErr } = await supabase
          .from("units")
          .select(
            "id,code,name,location,billing_city,billing_state,branch_id,customer_id,reporting_officers,emergency_contact_name,emergency_contact_mobile,nearby_hospital_name,nearby_hospital_mobile",
          )
          .in("id", unitIds);
        if (uErr) throw uErr;
        units = u ?? [];
      }
      const branchIds = Array.from(
        new Set(units.map((u) => u.branch_id).filter(Boolean)),
      );
      const customerIds = Array.from(
        new Set(units.map((u) => u.customer_id).filter(Boolean)),
      );
      const [branchesRes, customersRes] = await Promise.all([
        branchIds.length
          ? supabase.from("branches").select("id,name,code").in("id", branchIds)
          : Promise.resolve({ data: [], error: null } as any),
        customerIds.length
          ? supabase.from("customers").select("id,name,short_name").in("id", customerIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);
      const branchMap = new Map<string, any>(
        ((branchesRes.data as any[]) ?? []).map((b: any) => [b.id, b]),
      );
      const customerMap = new Map<string, any>(
        ((customersRes.data as any[]) ?? []).map((c: any) => [c.id, c]),
      );
      const cuMap = new Map<string, any>(
        ((cu ?? []) as any[]).map((r: any) => [r.unit_id, r]),
      );
      const ownPostings = units
        .map((u: any) => ({
          ...u,
          is_primary:
            cuMap.get(u.id)?.is_primary || u.id === profile?.unit_id,
          branch: branchMap.get(u.branch_id) ?? null,
          customer: customerMap.get(u.customer_id) ?? null,
        }))
        .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));

      // Units overseen as a reporting officer (matched by full name on units.reporting_officers JSONB)
      let overseenUnits: any[] = [];
      if (profile?.full_name) {
        const { data: ou } = await supabase
          .from("units")
          .select(
            "id,code,name,location,billing_city,billing_state,branch_id,customer_id,reporting_officers,emergency_contact_name,emergency_contact_mobile,nearby_hospital_name,nearby_hospital_mobile",
          )
          .contains("reporting_officers", [{ name: profile.full_name }]);
        const ownIds = new Set(ownPostings.map((u: any) => u.id));
        const extraBranchIds = Array.from(
          new Set(((ou as any[]) ?? []).map((u: any) => u.branch_id).filter(Boolean)),
        ).filter((id) => !branchMap.has(id as string));
        const extraCustomerIds = Array.from(
          new Set(((ou as any[]) ?? []).map((u: any) => u.customer_id).filter(Boolean)),
        ).filter((id) => !customerMap.has(id as string));
        if (extraBranchIds.length) {
          const { data: b } = await supabase
            .from("branches")
            .select("id,name,code")
            .in("id", extraBranchIds as string[]);
          for (const row of (b as any[]) ?? []) branchMap.set(row.id, row);
        }
        if (extraCustomerIds.length) {
          const { data: c } = await supabase
            .from("customers")
            .select("id,name,short_name")
            .in("id", extraCustomerIds as string[]);
          for (const row of (c as any[]) ?? []) customerMap.set(row.id, row);
        }
        overseenUnits = ((ou as any[]) ?? [])
          .filter((u: any) => !ownIds.has(u.id))
          .map((u: any) => ({
            ...u,
            branch: branchMap.get(u.branch_id) ?? null,
            customer: customerMap.get(u.customer_id) ?? null,
          }));
      }

      // Direct reports — candidates who report to this profile
      const { data: reportsRaw } = await supabase
        .from("candidates")
        .select("id,full_name,employee_code,mobile,designation_id,photo_url,status,unit_id")
        .eq("reports_to", profile!.id)
        .order("full_name", { ascending: true });
      const reportDesigIds = Array.from(
        new Set(((reportsRaw as any[]) ?? []).map((r: any) => r.designation_id).filter(Boolean)),
      );
      const reportUnitIds = Array.from(
        new Set(((reportsRaw as any[]) ?? []).map((r: any) => r.unit_id).filter(Boolean)),
      );
      const [reportDesigsRes, reportUnitsRes] = await Promise.all([
        reportDesigIds.length
          ? supabase.from("designations").select("id,name").in("id", reportDesigIds as string[])
          : Promise.resolve({ data: [] } as any),
        reportUnitIds.length
          ? supabase.from("units").select("id,name").in("id", reportUnitIds as string[])
          : Promise.resolve({ data: [] } as any),
      ]);
      const desigMap = new Map<string, string>(
        ((reportDesigsRes.data as any[]) ?? []).map((d: any) => [d.id, d.name]),
      );
      const unitNameMap = new Map<string, string>(
        ((reportUnitsRes.data as any[]) ?? []).map((u: any) => [u.id, u.name]),
      );
      const directReports = ((reportsRaw as any[]) ?? []).map((r: any) => ({
        ...r,
        designation_name: desigMap.get(r.designation_id) ?? "",
        unit_name: unitNameMap.get(r.unit_id) ?? "",
      }));

      let manager: any = null;
      if (profile?.reports_to) {
        const { data: m } = await supabase
          .from("candidates")
          .select("id,full_name,employee_code,mobile,designation_id,photo_url")
          .eq("id", profile.reports_to)
          .maybeSingle();
        if (m) {
          let desigName = "";
          if ((m as any).designation_id) {
            const { data: d } = await supabase
              .from("designations")
              .select("name")
              .eq("id", (m as any).designation_id)
              .maybeSingle();
            desigName = (d as any)?.name ?? "";
          }
          manager = { ...(m as any), designation_name: desigName };
        }
      }
      return { postings: ownPostings, overseenUnits, manager, directReports };
    },
  });

  const docsQ = useQuery({
    queryKey: ["my-signed-docs", profile?.id],
    enabled: !!profile?.id,
    queryFn: async (): Promise<SignedDocRow[]> => {
      const { data, error } = await supabase
        .from("employee_signed_documents")
        .select(
          "id,doc_type,version,signed_at,rendered_body,employee_signature_data,company_signature_data",
        )
        .eq("candidate_id", profile!.id)
        .order("signed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SignedDocRow[];
    },
  });

  const salaryQ = useQuery({
    queryKey: [
      "my-salary-slip",
      profile?.id,
      profile?.unit_id,
      profile?.designation_id,
      profile?.role_key,
    ],
    enabled:
      !!profile?.id &&
      ((!!profile?.unit_id && !!profile?.designation_id) || !!profile?.role_key),
    queryFn: async () => {
      let contract: any = null;
      let res: any = null;

      if (profile?.unit_id && profile?.designation_id) {
        // Billable employee: salary against client contract on their unit + designation.
        const { data: contracts, error: cErr } = await supabase
          .from("client_contracts")
          .select("id, contract_code, start_date, end_date, status, unit_id, record_type")
          .eq("unit_id", profile.unit_id)
          .eq("record_type", "client")
          .eq("status", "active")
          .order("start_date", { ascending: false });
        if (cErr) throw cErr;
        contract = (contracts ?? [])[0];
        if (!contract) return null;

        const { data, error: rErr } = await supabase
          .from("contract_resources")
          .select(
            "id, gross, components, deductions, benefits, employer_contributions, designation_id, payroll_day_base_id",
          )
          .eq("contract_id", contract.id)
          .eq("designation_id", profile.designation_id)
          .limit(1)
          .maybeSingle();
        if (rErr) throw rErr;
        res = data;
      } else if (profile?.role_key) {
        // Non-billable employee: salary against PLUS 360 internal contract, keyed by role.
        const { data: contracts, error: cErr } = await supabase
          .from("client_contracts")
          .select("id, contract_code, start_date, end_date, status, unit_id, record_type")
          .eq("is_internal" as never, true as never)
          .eq("status", "active")
          .limit(1);
        if (cErr) throw cErr;
        contract = (contracts ?? [])[0];
        if (!contract) return null;

        const { data, error: rErr } = await supabase
          .from("contract_resources")
          .select(
            "id, gross, components, deductions, benefits, employer_contributions, designation_id, payroll_day_base_id",
          )
          .eq("contract_id", contract.id)
          .eq("role_key" as never, profile.role_key as never)
          .limit(1)
          .maybeSingle();
        if (rErr) throw rErr;
        res = data;
      } else {
        return null;
      }

      if (!res) return { contract, resource: null as null, wages: null as null, pdb: null as null };


      let pdb: any = null;
      if (res.payroll_day_base_id) {
        const { data } = await supabase
          .from("payroll_day_bases")
          .select("id, method, fixed_days, weekly_off_day")
          .eq("id", res.payroll_day_base_id)
          .maybeSingle();
        pdb = data;
      }

      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const periodDayCount = periodEnd.getDate();

      const resourceLike: ContractResourceLike = {
        designationId: (res.designation_id ?? "") as string,
        components: (res.components as any) ?? [],
        benefits: (res.benefits as any) ?? [],
        deductions: (res.deductions as any) ?? [],
        employerContributions: (res.employer_contributions as any) ?? [],
        payrollDayBase: pdb
          ? {
              method: pdb.method,
              fixedDays: pdb.fixed_days,
              weeklyOffDay: pdb.weekly_off_day,
            }
          : null,
      };

      // Default slip: assume full attendance (tDays = baseDays)
      // First call with tDays=0 to resolve baseDays, then recompute.
      const probe = computeWages(
        { pDays: 0, otHours: 0, otDays: 0, phDays: 0, woDays: 0, otherPaidDays: 0, tDays: 0 },
        resourceLike,
        periodDayCount,
      );
      const wages = computeWages(
        { pDays: probe.baseDays, otHours: 0, otDays: 0, phDays: 0, woDays: 0, otherPaidDays: 0, tDays: probe.baseDays },
        resourceLike,
        periodDayCount,
      );

      return {
        contract,
        resource: res,
        wages,
        period: {
          start: periodStart.toISOString().slice(0, 10),
          end: periodEnd.toISOString().slice(0, 10),
          label: periodStart.toLocaleString("en-IN", { month: "long", year: "numeric" }),
          days: periodDayCount,
        },
      };
    },
  });

  async function handlePhoto(file: File) {
    if (!profile) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    setUploadingPhoto(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `photo/${profile.aadhaar_number || profile.id}-${Date.now()}.${ext}`;
      const up = await supabase.storage
        .from("candidate-files")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) throw up.error;
      const { data: signed, error: signErr } = await supabase.storage
        .from("candidate-files")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
      if (signErr) throw signErr;
      const url = signed.signedUrl;
      const upd = await supabase
        .from("candidates")
        .update({ photo_url: url })
        .eq("id", profile.id);
      if (upd.error) throw upd.error;
      void logActivity({
        module: "My Profile",
        action: "update",
        entityType: "candidates",
        entityId: profile.id,
        entityLabel: profile.full_name,
        details: { field: "photo_url" },
      });
      toast.success("Photo updated");
      qc.invalidateQueries({ queryKey: ["my-profile", phone] });
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploadingPhoto(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDownloadSigned(row: SignedDocRow) {
    if (!profile) return;
    setDownloadingDoc(row.id);
    try {
      const label = DOC_TYPE_LABELS[row.doc_type as DocType] ?? row.doc_type;
      const blob = await generateDocumentPdf({
        title: label,
        body: row.rendered_body,
        employeeSignatureDataUrl: row.employee_signature_data || undefined,
        companySignatureDataUrl: row.company_signature_data || undefined,
        employeeName: profile.full_name,
        employeeCode: profile.employee_code,
        signedAt: row.signed_at,
      });
      const filename = `${label.replace(/\s+/g, "_")}-${profile.employee_code || profile.candidate_code || "doc"}.pdf`;
      await downloadBlob(blob, filename);
    } catch (e: any) {
      toast.error(e?.message || "Could not generate PDF");
    } finally {
      setDownloadingDoc(null);
    }
  }

  if (!phone) {
    return (
      <div className="space-y-5">
        <PageHeader title="My Profile" />
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Sign in to view your profile.
        </div>
      </div>
    );
  }

  if (profileQ.isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title="My Profile" />
        <div className="flex items-center justify-center rounded-2xl border border-border bg-card p-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-5">
        <PageHeader title="My Profile" />
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No employee record is linked to your phone number ({phone}). Please contact your admin.
        </div>
        {bottomActions}
      </div>
    );
  }

  const lookups = lookupsQ.data;
  const stockItems = stockBalanceQ.data ?? [];
  const postings = postingsQ.data?.postings ?? [];
  const manager = postingsQ.data?.manager ?? null;
  const overseenUnits = postingsQ.data?.overseenUnits ?? [];
  const directReports = postingsQ.data?.directReports ?? [];

  return (
    <div data-profile-page className="flex w-full min-w-0 flex-col gap-4 pb-6 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden lg:pb-0">
      <PageHeader
        title="My Profile"
        description="Work details, records and documents."
        icon={Users}
      />

      <div className="grid min-h-0 min-w-0 flex-1 items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4 lg:h-full lg:overflow-y-auto lg:pr-1">
      <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
        <div className="flex flex-col items-center gap-4 p-5 text-center">
          <div className="relative shrink-0">
            <div className="block h-24 w-24 overflow-hidden rounded-full border-4 border-background bg-accent/10 shadow-sm ring-1 ring-border">
              {profile.photo_url ? (
                <img
                  src={profile.photo_url}
                  alt={profile.full_name}
                  className="h-full w-full object-cover"
                />
              ) : (
                  <div className="flex h-full w-full items-center justify-center text-accent">
                    <Users className="h-10 w-10" />
                </div>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  disabled={uploadingPhoto}
                  aria-label="Change profile photo"
                  className="absolute -bottom-1 -right-1 h-9 w-9 rounded-full border-2 border-background bg-accent text-accent-foreground shadow-md hover:bg-accent/90"
                  title="Change photo"
                >
                  {uploadingPhoto ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCameraOpen(true)}>
                  <Camera className="mr-2 h-4 w-4" /> Take photo
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" /> Upload file
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handlePhoto(f);
              }}
            />
            <CameraCaptureDialog
              open={cameraOpen}
              onOpenChange={setCameraOpen}
              onCapture={handlePhoto}
            />
          </div>

           <div className="min-w-0 w-full">
             <h1 className="break-words font-display text-xl font-semibold leading-tight text-foreground">
              {profile.full_name || "Unnamed"}
            </h1>
             <p className="mt-1 break-words text-[13px] font-medium text-muted-foreground">
              {lookups?.designation?.name || "—"}
              {lookups?.unit ? ` · ${lookups.unit.name}` : ""}
              {lookups?.unit?.city ? ` (${lookups.unit.city})` : ""}
            </p>
             <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Badge className="rounded-full border border-accent/15 bg-accent/10 px-3 py-1 capitalize text-accent hover:bg-accent/10">
                {profile.status}
              </Badge>
              {lookups?.role?.name && (
                <Badge className="rounded-full bg-primary/15 px-2.5 py-0.5 text-primary hover:bg-primary/20">
                  {lookups.role.name}
                </Badge>
              )}
              {profile.employee_code && (
                <Badge variant="outline" className="rounded-full px-2.5 py-0.5 font-mono text-[11px]">
                  {profile.employee_code}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border/60 bg-accent/5 p-3">
          <InfoRow label="Employee Code" value={profile.employee_code || "—"} />
          <InfoRow
            label="Role"
            value={lookups?.role?.name || (profile.role_key ? profile.role_key : "Not assigned")}
          />
          <InfoRow
            label="Date of Joining"
            value={
              profile.approved_at?.slice(0, 10) ??
              profile.preferred_joining_date ??
              "—"
            }
          />
          <InfoRow label="Status" value={profile.status} />
        </div>
      </div>

      <div className="shrink-0"><MyLiveStatusCard /></div>
      <LanguagePreferenceCard candidateId={profile.id} />
      <div className="hidden lg:block">{bottomActions}</div>
      </aside>

      <div className="min-w-0 space-y-4 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
      <Section title="My Posting & Reporting" icon={Building2}>
        {postingsQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading posting details…</div>
        ) : postings.length === 0 && overseenUnits.length === 0 && directReports.length === 0 && !manager ? (
          <div className="text-sm text-muted-foreground">
            No posting, reporting line, or team mapped yet. Please contact HR.
          </div>
        ) : (
          <div className="space-y-4">
            {postings.length > 0 && (
              <div className="grid gap-4 xl:grid-cols-2">
                {postings.map((u: any) => {
                  const officers = Array.isArray(u.reporting_officers)
                    ? u.reporting_officers
                    : [];
                  const cityState = [u.billing_city, u.billing_state]
                    .filter(Boolean)
                    .join(", ");
                  const siteDetails = [u.customer?.name, u.branch?.name, u.location || cityState]
                    .filter(Boolean);
                  const initials = (name: string) =>
                    name
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part: string) => part[0]?.toUpperCase() ?? "")
                      .join("") || "?";
                  return (
                    <div
                      key={u.id}
                      className="group overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm transition duration-200 hover:border-accent/30 hover:shadow-md"
                    >
                      <div className="flex min-h-[74px] items-start justify-between gap-3 bg-primary px-4 py-4 text-primary-foreground sm:px-5">
                        <div className="min-w-0">
                          <div className="font-display text-[13px] font-bold leading-snug sm:text-sm">
                            {u.name}
                          </div>
                          {u.code && (
                            <div className="mt-1 font-mono text-[10px] font-semibold text-accent-secondary">
                              {u.code}
                            </div>
                          )}
                        </div>
                        {u.is_primary && (
                          <span className="shrink-0 rounded-md border border-accent-secondary/30 bg-accent-secondary/15 px-2 py-1 text-[9px] font-bold uppercase text-accent-secondary">
                            Primary posting
                          </span>
                        )}
                      </div>

                      <div className="flex items-start gap-2 border-b border-border/70 bg-secondary/45 px-4 py-3 text-xs text-muted-foreground sm:px-5">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                        <span className="min-w-0 break-words font-medium">
                          {siteDetails.join(" · ") || "Location not available"}
                        </span>
                      </div>

                      <div className="px-4 py-4 sm:px-5">
                        <div className="mb-2.5 flex items-center justify-between gap-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                            Reporting hierarchy
                          </div>
                          <span className="text-[10px] font-semibold text-accent">
                            {officers.length} {officers.length === 1 ? "person" : "people"}
                          </span>
                        </div>
                        {officers.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border bg-secondary/30 px-3 py-4 text-xs text-muted-foreground">
                            None listed for this unit.
                          </div>
                        ) : (
                          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
                            {officers.map((o: any, idx: number) => (
                              <li
                                key={`${o.name || "officer"}-${o.mobile || idx}-${idx}`}
                                className="flex min-w-0 items-center gap-3 bg-card px-3 py-2.5 transition-colors hover:bg-accent/5"
                              >
                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-foreground ring-1 ring-inset ring-border">
                                  {initials(o.name || "")}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="truncate text-[13px] font-semibold text-foreground">
                                      {o.name || "—"}
                                    </span>
                                    {o.is_primary && (
                                      <span className="rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent-foreground">
                                        Primary
                                      </span>
                                    )}
                                    {o.is_active === false && (
                                      <span className="rounded border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                                        Inactive
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                                    {o.mobile && <span className="tabular-nums">{o.mobile}</span>}
                                    {o.mobile && (o.role || o.designation) && <span aria-hidden>·</span>}
                                    {(o.role || o.designation) && (
                                      <span className="font-medium text-accent">{o.role || o.designation}</span>
                                    )}
                                  </div>
                                </div>
                                {o.mobile && (
                                  <a
                                    href={`tel:${o.mobile}`}
                                    aria-label={`Call ${o.name || o.mobile}`}
                                    title={`Call ${o.name || o.mobile}`}
                                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    <PhoneIcon className="h-3.5 w-3.5" />
                                  </a>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {(u.emergency_contact_name || u.nearby_hospital_name) && (
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {u.emergency_contact_name && (
                            <InfoRow
                              label="Emergency Contact"
                              value={`${u.emergency_contact_name}${u.emergency_contact_mobile ? ` · ${u.emergency_contact_mobile}` : ""}`}
                            />
                          )}
                          {u.nearby_hospital_name && (
                            <InfoRow
                              label="Nearby Hospital"
                              value={`${u.nearby_hospital_name}${u.nearby_hospital_mobile ? ` · ${u.nearby_hospital_mobile}` : ""}`}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {manager && (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Direct Manager
                </div>
                <div className="mt-2 flex items-center gap-3">
                  {manager.photo_url ? (
                    <img
                      src={manager.photo_url}
                      alt={manager.full_name}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                      <UserCheck className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold">{manager.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[manager.designation_name, manager.employee_code, manager.mobile]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {overseenUnits.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-accent" />
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Units I Oversee ({overseenUnits.length})
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {overseenUnits.map((u: any) => (
                    <div key={u.id} className="rounded-lg border border-border bg-secondary/30 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold">{u.name}</div>
                        {u.code && (
                          <Badge variant="outline" className="text-[10px]">{u.code}</Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {[
                          u.customer?.name,
                          u.branch?.name,
                          u.location || [u.billing_city, u.billing_state].filter(Boolean).join(", "),
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {directReports.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-accent" />
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Team / Direct Reports ({directReports.length})
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {directReports.map((r: any) => (
                    <div key={r.id} className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3">
                      {r.photo_url ? (
                        <img
                          src={r.photo_url}
                          alt={r.full_name}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-semibold">{r.full_name}</div>
                          {r.status && (
                            <Badge variant="outline" className="text-[10px] capitalize">{r.status}</Badge>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[r.designation_name, r.unit_name, r.employee_code, r.mobile]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
        <Section title="Contact" icon={PhoneIcon}>
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow label="Mobile" value={profile.mobile} />
            <InfoRow label="Email" value={profile.email} />
            <InfoRow
              label="Date of Birth"
              value={profile.date_of_birth ?? "—"}
            />
            <InfoRow label="Gender" value={profile.gender} />
            <InfoRow label="Marital Status" value={profile.marital_status} />
            <InfoRow label="Blood Group" value={profile.blood_group} />
          </div>
        </Section>

        <Section title="Addresses" icon={MapPin}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Present
              </div>
              <p className="text-sm">
                {[
                  profile.present_address1,
                  profile.present_address2,
                  profile.present_city,
                  profile.present_state,
                  profile.present_pincode,
                ]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </p>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Permanent
              </div>
              <p className="text-sm">
                {[
                  profile.permanent_address1,
                  profile.permanent_city,
                  profile.permanent_state,
                  profile.permanent_pincode,
                ]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </p>
            </div>
          </div>
        </Section>

        <Section title="Identification" icon={IdCard}>
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow label="Aadhaar" value={profile.aadhaar_number} />
            <InfoRow label="PAN" value={profile.pan_number} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Photo", url: profile.photo_url },
              { label: "Aadhaar", url: profile.aadhaar_image_url },
              { label: "PAN", url: profile.pan_image_url },
              { label: "Signature", url: profile.signature_url },
              ...profile.identification_proofs.map((p, i) => ({
                label: p.type || `Proof ${i + 1}`,
                url: p.url || "",
              })),
            ].map((p, i) => (
              <a
                key={`${p.label}-${i}`}
                href={p.url || "#"}
                target="_blank"
                rel="noreferrer"
                className={
                  "flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs font-medium " +
                  (p.url
                    ? "hover:border-accent hover:text-accent"
                    : "cursor-not-allowed opacity-50")
                }
                onClick={(e) => {
                  if (!p.url) e.preventDefault();
                }}
              >
                <span>{p.label}</span>
                <Download className="h-3.5 w-3.5" />
              </a>
            ))}
          </div>
        </Section>

        <Section title="Bank" icon={ShieldCheck}>
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow label="Account Holder" value={profile.bank_account_holder} />
            <InfoRow label="Account Number" value={profile.bank_account_number} />
            <InfoRow label="IFSC" value={profile.bank_ifsc} />
            <InfoRow label="Bank" value={profile.bank_name} />
            <InfoRow label="Branch" value={profile.bank_branch} />
            <InfoRow label="Account Type" value={profile.bank_account_type} />
          </div>
        </Section>

        <Section title="Emergency Contact" icon={ShieldAlert}>
          <div className="grid gap-4 sm:grid-cols-3">
            <InfoRow label="Name" value={profile.emergency_contact_name} />
            <InfoRow label="Relation" value={profile.emergency_contact_relation} />
            <InfoRow label="Mobile" value={profile.emergency_contact_mobile} />
          </div>
        </Section>

        <Section title="Family & Contacts" icon={Users}>
          {profile.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No family contacts on file.</p>
          ) : (
            <ul className="divide-y divide-border">
              {profile.contacts.map((c, i) => (
                <li key={i} className="grid grid-cols-2 gap-3 py-2 text-sm sm:grid-cols-4">
                  <span className="font-medium">{c.name || "—"}</span>
                  <span className="text-muted-foreground">{c.relation || "—"}</span>
                  <span className="font-mono text-xs">{c.mobile || "—"}</span>
                  <span className="text-muted-foreground">{c.occupation || "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Nominees" icon={UserCheck}>
          {profile.nominations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No nominees added.</p>
          ) : (
            <ul className="divide-y divide-border">
              {profile.nominations.map((n, i) => (
                <li key={i} className="grid grid-cols-2 gap-3 py-2 text-sm sm:grid-cols-4">
                  <span className="font-medium">{n.name || "—"}</span>
                  <span className="text-muted-foreground">{n.relation || "—"}</span>
                  <span className="text-muted-foreground">DOB: {n.dob || "—"}</span>
                  <span className="font-semibold text-accent">{n.share ?? "—"}%</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        </div>
        <div className="min-w-0 space-y-4">

        <Section title="References" icon={UserCheck}>
          {profile.references.length === 0 ? (
            <p className="text-sm text-muted-foreground">No references provided.</p>
          ) : (
            <ul className="divide-y divide-border">
              {profile.references.map((r, i) => (
                <li key={i} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name || "—"}</span>
                    <span className="text-xs text-muted-foreground">· {r.relation || "—"}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {r.mobile && <span className="font-mono">{r.mobile}</span>}
                    {r.email && <span>{r.email}</span>}
                    {r.address && <span>{r.address}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Languages" icon={LanguagesIcon}>
          {profile.languages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No languages listed.</p>
          ) : (
            <ul className="space-y-2">
              {profile.languages.map((l, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{l.name || "—"}</span>
                  <span className="flex gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
                    {l.read && <Badge variant="outline">Read</Badge>}
                    {l.write && <Badge variant="outline">Write</Badge>}
                    {l.speak && <Badge variant="outline">Speak</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Work Experience" icon={Briefcase}>
          {profile.experiences.length === 0 ? (
            <p className="text-sm text-muted-foreground">No previous experience recorded.</p>
          ) : (
            <ul className="space-y-3">
              {profile.experiences.map((e, i) => (
                <li key={i} className="rounded-lg border border-border/70 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{e.company || "—"}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.from || "?"} → {e.to || "Present"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {e.designation || "—"}
                    {e.salary ? ` · ₹${e.salary}` : ""}
                  </div>
                  {e.reason_for_leaving && (
                    <div className="mt-1 text-xs italic text-muted-foreground">
                      Left: {e.reason_for_leaving}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Education" icon={GraduationCap}>
          {profile.educations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No education records.</p>
          ) : (
            <ul className="divide-y divide-border">
              {profile.educations.map((ed, i) => (
                <li key={i} className="grid grid-cols-2 gap-3 py-2 text-sm sm:grid-cols-4">
                  <span className="font-medium">{ed.qualification || "—"}</span>
                  <span className="text-muted-foreground">{ed.institution || "—"}</span>
                  <span className="text-muted-foreground">{ed.year || "—"}</span>
                  <span className="font-semibold">{ed.percentage ? `${ed.percentage}%` : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Physical Health" icon={Heart}>
          <div className="grid gap-4 sm:grid-cols-3">
            <InfoRow label="Height" value={profile.physical_health_full.height_cm ? `${profile.physical_health_full.height_cm} cm` : ""} />
            <InfoRow label="Weight" value={profile.physical_health_full.weight_kg ? `${profile.physical_health_full.weight_kg} kg` : ""} />
            <InfoRow label="Blood Group" value={profile.blood_group} />
            
            <InfoRow label="Disabilities" value={profile.physical_health_full.disabilities} />
            <InfoRow label="Allergies" value={profile.physical_health_full.allergies} />
          </div>
        </Section>

        <Section title="Extra Curricular" icon={Activity}>
          {profile.extra_curricular.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {profile.extra_curricular.map((x, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="font-medium">{x.activity || "—"}</span>
                  <span className="text-xs text-muted-foreground">
                    {x.level || "—"}{x.year ? ` · ${x.year}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Other Info" icon={Sparkles}>
          {Object.keys(profile.other_info || {}).length === 0 ? (
            <p className="text-sm text-muted-foreground">No additional info.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {Object.entries(profile.other_info).map(([k, v]) => (
                <InfoRow
                  key={k}
                  label={k.replace(/_/g, " ")}
                  value={String(v ?? "")}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Criminal History" icon={ShieldAlert}>
          {profile.criminal_history?.has_history ? (
            <ul className="space-y-2 text-sm">
              {(profile.criminal_history.incidents ?? []).map((inc, i) => (
                <li key={i} className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <div className="font-medium">{inc.description || "—"}</div>
                  <div className="text-xs text-muted-foreground">{inc.year || ""}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No criminal history declared.</p>
          )}
        </Section>

        <Section title="Stock Available" icon={Package}>
          {stockBalanceQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading stock…</p>
          ) : stockItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No stock currently assigned to you.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border bg-muted/40 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Total Qty
                  </div>
                  <div className="mt-1 text-xl font-bold tabular-nums leading-none sm:text-2xl">
                    {stockItems.reduce((s, it) => s + it.qty, 0)}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    SKUs
                  </div>
                  <div className="mt-1 text-xl font-bold tabular-nums leading-none sm:text-2xl">
                    {stockItems.length}
                  </div>
                </div>
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {stockItems.map((it) => (
                  <li
                    key={`${it.item_id}-${it.size_value}`}
                    className="flex items-center justify-between gap-3 p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{it.item_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {it.item_code}
                        {it.size_value ? ` · Size ${it.size_value}` : ""}
                        {it.unit ? ` · ${it.unit}` : ""}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      × {it.qty}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                to="/admin/inventory/stock"
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
              >
                View full stock →
              </Link>
            </div>
          )}
        </Section>


        <Section title="Other Documents" icon={Upload}>
          {profile.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No additional documents uploaded.</p>
          ) : (
            <ul className="divide-y divide-border">
              {profile.documents.map((d, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="truncate">{d.name || `Document ${i + 1}`}</span>
                  {d.url ? (
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" /> Open
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {profile.offboarding_details && Object.keys(profile.offboarding_details).length > 0 && (
          <Section title="Offboarding Documents" icon={FileSignature}>
            <OffboardingRecordsSection details={profile.offboarding_details} hideHeader />
          </Section>
        )}
        </div>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-3 [&>section]:h-full">
      <Section title="CTC" icon={Wallet} className="lg:col-span-2">
        {salaryQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !salaryQ.data ? (
          <p className="text-sm text-muted-foreground">
            No active contract or salary mapping found for your unit and designation. Ask your admin to map a resource for{" "}
            <span className="font-semibold">{lookups?.designation?.name || "your designation"}</span>.
          </p>
        ) : !salaryQ.data.resource || !salaryQ.data.wages ? (
          <p className="text-sm text-muted-foreground">
            Contract <span className="font-mono">{salaryQ.data.contract.contract_code}</span> exists for your unit but no salary resource is mapped for your designation yet.
          </p>
        ) : (
          (() => {
            const w = salaryQ.data.wages;
            const c = salaryQ.data.contract;
            const p = salaryQ.data.period!;
            return (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch">
                <div className="grid gap-4 rounded-xl border border-border/70 bg-secondary/30 p-4 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Pay Period
                    </div>
                    <div className="text-sm font-semibold">{p.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.start} → {p.end} · {p.days} days
                    </div>
                  </div>
                  <div className="min-w-0 sm:text-right">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Contract
                    </div>
                    <div className="font-mono text-xs">{c.contract_code}</div>
                    <div className="text-xs text-muted-foreground">
                      {lookups?.unit?.name || "—"}
                    </div>
                  </div>
                </div>
                <div className="flex min-w-[190px] flex-col justify-between rounded-xl border border-accent/15 bg-accent/10 p-4 sm:text-right">
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-accent">
                    Monthly CTC
                  </div>
                  <div className="mt-4 font-display text-3xl font-semibold tabular-nums text-accent">
                    {fmtINR(w.employerCost)}
                  </div>
                </div>
              </div>
            );
          })()
        )}
      </Section>



      <Section title="Signed Documents" icon={FileSignature} className="lg:col-span-1">
        {docsQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (docsQ.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven't signed any company documents yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {docsQ.data!.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 p-3 transition-colors hover:border-accent/25 hover:bg-accent/5"
              >
                <div>
                  <div className="text-sm font-semibold">
                    {DOC_TYPE_LABELS[d.doc_type as DocType] ?? d.doc_type}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    v{d.version}
                    {d.signed_at
                      ? ` · Signed ${new Date(d.signed_at).toLocaleDateString()}`
                      : " · Unsigned"}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloadingDoc === d.id}
                  onClick={() => handleDownloadSigned(d)}
                >
                  {downloadingDoc === d.id ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Download PDF
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      </div>
      </div>
      </div>
      <div className="lg:hidden">{bottomActions}</div>
    </div>
  );
}

function LanguagePreferenceCard({ candidateId }: { candidateId: string }) {
  const { lang, setLang, enabled } = useI18n();

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("candidates")
        .select("preferred_language")
        .eq("id", candidateId)
        .maybeSingle();
      if (!alive) return;
      const code = (data as { preferred_language?: string } | null)?.preferred_language as LangCode | undefined;
      if (code && ["en", "hi", "mr"].includes(code)) setLang(code);
    })();
    return () => {
      alive = false;
    };
  }, [candidateId, setLang]);

  async function change(code: LangCode) {
    setLang(code);
    await supabase
      .from("candidates")
      .update({ preferred_language: code } as never)
      .eq("id", candidateId);
    toast.success("Language updated");
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
      <div className="flex min-h-14 items-center gap-3 border-b border-border/60 px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-inset ring-accent/15">
          <LanguagesIcon className="h-4 w-4" />
        </span>
        <div>
          <div className="text-sm font-medium text-foreground">Language</div>
          <p className="text-xs text-muted-foreground">Portal language</p>
        </div>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap gap-2">
          {enabled.map((code) => (
            <Button
              key={code}
              type="button"
              size="sm"
              variant={lang === code ? "default" : "outline"}
              onClick={() => change(code)}
              className={`rounded-full px-4 ${
                lang === code
                  ? "bg-accent text-accent-foreground hover:bg-accent/90"
                  : "hover:border-accent/25 hover:bg-accent/5"
              }`}
            >
              {LANG_LABELS[code]}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}
