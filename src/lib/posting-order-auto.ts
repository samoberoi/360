import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity-log";
import { isGuardRole } from "@/lib/role-keys";
import { sendPostingOrderEmail } from "@/lib/posting-order.functions";
import {
  buildDocumentPageHtml,
  buildPlaceholderMap,
  fetchActiveTemplate,
  fetchCandidateForRender,
  isHtmlBody,
  parsePostingOrderConfig,
  renderTemplate,
  withPostingPlaceholders,
  type PostingDetails,
} from "@/lib/company-documents";

const MODULE = "Company Documents";

function fmtDate(v: string) {
  if (!v) return "";
  try {
    return new Date(v).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return v;
  }
}

type UnitInfo = {
  id: string;
  code: string | null;
  name: string | null;
  location: string | null;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city: string | null;
  billing_address1: string | null;
  billing_address2: string | null;
  billing_city: string | null;
  customer_id: string | null;
};

async function loadUnit(unitId: string): Promise<UnitInfo | null> {
  const { data } = await supabase
    .from("units" as never)
    .select(
      "id,code,name,location,shipping_address1,shipping_address2,shipping_city,billing_address1,billing_address2,billing_city,customer_id",
    )
    .eq("id", unitId)
    .maybeSingle();
  return (data as unknown as UnitInfo) ?? null;
}

async function loadCustomerName(customerId: string | null): Promise<string> {
  if (!customerId) return "";
  const { data } = await supabase
    .from("customers" as never)
    .select("name")
    .eq("id", customerId)
    .maybeSingle();
  return ((data as unknown as { name?: string } | null)?.name ?? "").trim();
}

/** Resolve the field officer / supervisor responsible for this guard at this unit. */
async function resolveSupervisorName(candidateId: string, unitId: string): Promise<string> {
  const { data: cand } = await supabase
    .from("candidates")
    .select("reports_to")
    .eq("id", candidateId)
    .maybeSingle();
  const reportsTo = (cand as { reports_to?: string | null } | null)?.reports_to ?? null;
  if (reportsTo) {
    const { data: mgr } = await supabase
      .from("candidates")
      .select("full_name")
      .eq("id", reportsTo)
      .maybeSingle();
    const n = ((mgr as { full_name?: string } | null)?.full_name ?? "").trim();
    if (n) return n;
  }
  // Fall back to any active field officer mapped to the unit.
  const { data: cu } = await supabase
    .from("candidate_units" as never)
    .select("candidate_id, candidates:candidate_id(full_name,role_key,status)")
    .eq("unit_id", unitId);
  const rows =
    (cu as unknown as Array<{
      candidates: { full_name?: string; role_key?: string; status?: string } | null;
    }> | null) ?? [];
  const fo = rows.find(
    (r) =>
      r.candidates?.role_key === "field_officer" &&
      ["active", "approved"].includes(String(r.candidates?.status ?? "")),
  );
  return (fo?.candidates?.full_name ?? "").trim();
}

async function loadSignatory(): Promise<{ name: string; designation: string }> {
  const { data } = await supabase
    .from("org_settings" as never)
    .select("company_name")
    .maybeSingle();
  const company = ((data as unknown as { company_name?: string } | null)?.company_name ?? "").trim();
  return {
    name: company ? `For ${company}` : "For PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD.",
    designation: "Authorised Signatory",
  };
}

export type AutoPostingOrderResult =
  | { sent: true; to: string }
  | { sent: false; reason: string };

/**
 * Builds and emails a posting order automatically when a guard is mapped to a
 * unit. Everything (site, client, supervisor, signatory) is derived from data
 * already in the system — no manual form entry.
 */
export async function autoIssuePostingOrder(opts: {
  candidateId: string;
  unitId: string;
}): Promise<AutoPostingOrderResult> {
  const { candidateId, unitId } = opts;
  try {
    const { data: roleRow } = await supabase
      .from("candidates")
      .select("role_key")
      .eq("id", candidateId)
      .maybeSingle();
    const roleKey = String((roleRow as { role_key?: string } | null)?.role_key ?? "").toLowerCase();
    if (!isGuardRole(roleKey)) {
      return { sent: false, reason: "posting orders are only issued to security guards" };
    }

    const [candidate, doc, unit] = await Promise.all([
      fetchCandidateForRender(candidateId),
      fetchActiveTemplate("posting_order"),
      loadUnit(unitId),
    ]);

    const email = (candidate.email ?? "").trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { sent: false, reason: "no valid email on the employee profile" };
    }
    const config = parsePostingOrderConfig(doc?.body ?? "");
    if (!config.emailBody) {
      return { sent: false, reason: "no active Posting Order template" };
    }

    const [customerName, supervisor, signatory] = await Promise.all([
      loadCustomerName(unit?.customer_id ?? null),
      resolveSupervisorName(candidateId, unitId),
      loadSignatory(),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const siteAddress =
      [unit?.shipping_address1, unit?.shipping_address2, unit?.shipping_city]
        .filter((x) => x && String(x).trim())
        .join(", ") ||
      [unit?.billing_address1, unit?.billing_address2, unit?.billing_city]
        .filter((x) => x && String(x).trim())
        .join(", ") ||
      (unit?.location ?? "");

    const posting: PostingDetails = {
      posting_order_no: `PO-${new Date().getFullYear()}-${(
        candidate.employee_code ||
        candidate.candidate_code ||
        ""
      )
        .replace(/\D/g, "")
        .slice(-4) || "0001"}`,
      posting_date: fmtDate(today),
      client_name: customerName || unit?.name || "",
      site_name: unit?.name || "",
      site_address: siteAddress,
      reporting_date: fmtDate(today),
      reporting_time: "",
      duty_shift: "",
      site_supervisor: supervisor,
      authorised_signatory: signatory.name,
      signatory_designation: signatory.designation,
    };

    const base = (html: boolean) =>
      withPostingPlaceholders(buildPlaceholderMap(candidate, html), posting);

    const emailHtml = renderTemplate(config.emailBody, base(isHtmlBody(config.emailBody)));
    const docHtml = config.document
      ? renderTemplate(config.document, base(isHtmlBody(config.document)))
      : "";
    const subject = renderTemplate(config.emailSubject, base(false));
    const text = config.whatsappBody ? renderTemplate(config.whatsappBody, base(false)) : "";

    const html = `${buildDocumentPageHtml(emailHtml)}${
      docHtml ? `<hr/>${buildDocumentPageHtml(docHtml)}` : ""
    }`;

    await sendPostingOrderEmail({
      data: { to: email, subject, html, ...(text ? { text } : {}) },
    });

    void logActivity({
      module: MODULE,
      action: "Auto-dispatch posting order on client mapping",
      entityType: "candidates",
      entityId: candidateId,
      entityLabel: candidate.full_name ?? "",
      details: {
        to: email,
        unit_id: unitId,
        unit_name: unit?.name ?? "",
        posting_order_no: posting.posting_order_no,
        supervisor,
      },
    });

    return { sent: true, to: email };
  } catch (e) {
    return {
      sent: false,
      reason: e instanceof Error ? e.message : "posting order could not be sent",
    };
  }
}
