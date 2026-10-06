import { createFileRoute } from "@tanstack/react-router";
import { RecordViewButton } from "@/components/RecordViewButton";
import { notifySaved } from "@/components/ConfirmProvider";
import { DataPagination, usePagination } from "@/components/DataPagination";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Download, Edit2, MapPin, Plus, Search, Warehouse, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DeleteGuardButton } from "@/components/DeleteGuardButton";
import { csvDate, csvJoin, csvMapLink, csvStatus, csvYesNo, downloadCsv } from "@/lib/csv-export";
import { toast } from "sonner";
import { logActivity } from "@/lib/activity-log";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  nextUnitCode,
  useBranches,
  useCustomers,
  useStates,
  useUnits,
  BONUS_FREQUENCY_OPTIONS,
  type BonusFrequency,
  type ReportingOfficer,
  type Unit,
} from "@/lib/admin-data";
import {
  loadClientAttributeValues,
  loadClientAttributesForCustomer,
  saveClientAttributeValues,
} from "@/lib/mis-template";
import { cn } from "@/lib/utils";
import { useOperationalUnitScope } from "@/lib/use-manager-scope";
import { GuidedForm, useGuidedFormCloseGuard, useGuidedFormDraft, type GuidedFormStep } from "@/components/GuidedForm";
import { UnitMappingFields, loadUnitMapping, saveUnitMapping, type UnitMappingValue } from "@/components/UnitMappingFields";
import { resolvePt, usePincodeRanges, usePtSlabs } from "@/lib/pt-lookup";
import { pickEsicBranchId } from "@/lib/esic-auto-map";
import { MONTH_NAMES, resolveLwf, useLwfRows } from "@/lib/lwf-lookup";
import {
  resolveFieldOfficersForUnit,
  resolveGuardsForUnit,
  SCOPE_TYPE_LABEL,
  useEmployeesLite,
  useScopeAssignments,
  useCandidateUnits,
} from "@/lib/deployment";

export const Route = createFileRoute("/admin/customers/unit-manager")({
  head: () => ({
    meta: [
      { title: "Clients | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Manage client locations, organization links, and deployment details." },
      { property: "og:title", content: "Clients | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Manage client locations, organization links, and deployment details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UnitManagerPage,
});

const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr.", "Mx."];

const GST_TYPES = [
  "Regular",
  "Composition",
  "SEZ Client",
  "SEZ Developer",
  "Casual Taxable Person",
  "Non-Resident Taxable Person",
];

function emptyUnit(code: string): Omit<Unit, "id"> {
  return {
    code,
    name: "",
    location: "",
    description: "",
    status: "active",
    zone: "",
    branchSapCode: "",
    isBillable: true,
    branchId: null,
    customerId: null,
    onboardingDate: "",
    closingDate: "",
    contractStartDate: "",
    contractEndDate: "",
    panNumber: "",
    gstPayable: false,
    gstType: "",
    gstNumber: "",
    billingSalutation: "",
    billingName: "",
    billingAddress1: "",
    billingAddress2: "",
    billingPincode: "",
    billingCity: "",
    billingDistrict: "",
    billingState: "",
    billingCountry: "India",
    shippingSameAsBilling: true,
    shippingSameAsOrg: false,
    shippingSalutation: "",
    shippingName: "",
    shippingAddress1: "",
    shippingAddress2: "",
    shippingPincode: "",
    shippingCity: "",
    shippingDistrict: "",
    shippingState: "",
    shippingCountry: "India",
    reportingOfficers: [{ name: "", isPrimary: true, isActive: true }],
    emergencyContactName: "",
    emergencyContactMobile: "",
    nearbyHospitalName: "",
    nearbyHospitalMobile: "",
    ambulanceName: "",
    ambulanceMobile: "",
    securityServiceName: "",
    securityServiceMobile: "",
    latitude: null,
    longitude: null,
    enablePt: false,
    enableLwf: false,
    uniformIncluded: true,
    uniformFeeAmount: 0,
    recruitmentFeeEnabled: false,
    recruitmentFeeAmount: 0,
    gpaipEnabled: false,
    gpaipAmount: 0,
    phEnabled: false,
    phMultiplier: 1,
    phDayValue: null,
    bonusEnabled: false,
    epfCapEnabled: true,
    bonusFrequency: null,
    esicBranchId: null,
  };
}

function UnitManagerPage() {
  const { units, addUnit, updateUnit, deleteUnit } = useUnits();
  const { branches } = useBranches();
  const { customers } = useCustomers();
  const { states } = useStates();
  const foScope = useOperationalUnitScope();

  // Field officers only ever see the clients they are mapped to.
  const scopedUnits = useMemo(
    () => (foScope.isScoped ? units.filter((u) => foScope.unitIds.has(u.id)) : units),
    [units, foScope.isScoped, foScope.unitIds],
  );
  const scopedCustomers = useMemo(
    () => (foScope.isScoped ? customers.filter((c) => foScope.customerIds.has(c.id)) : customers),
    [customers, foScope.isScoped, foScope.customerIds],
  );

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [orgFilter, setOrgFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [cityFilter, setCityFilter] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [deleting, setDeleting] = useState<Unit | null>(null);

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const stateById = useMemo(() => new Map(states.map((s) => [s.id, s])), [states]);

  const rows = useMemo(() => {
    const list = [...scopedUnits]
      .map((u) => {
        const br = u.branchId ? branchById.get(u.branchId) : undefined;
        const stName = br ? stateById.get(br.stateId)?.name ?? "" : "";
        return {
          ...u,
          branchLabel: br ? `${br.code} – ${stName}` : "—",
          customerLabel: u.customerId ? customerById.get(u.customerId)?.name ?? "—" : "—",
          stateLabel: (u.billingState || "").trim(),
          cityLabel: (u.billingCity || "").trim(),
        };
      })
      .sort((a, b) => {
        const na = parseInt(a.code.replace(/\D/g, ""), 10) || 0;
        const nb = parseInt(b.code.replace(/\D/g, ""), 10) || 0;
        return na - nb;
      });
    const stateSet = new Set(stateFilter);
    const citySet = new Set(cityFilter);
    const filtered = list.filter((u) => {
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (orgFilter !== "all" && u.customerId !== orgFilter) return false;
      if (stateSet.size && !stateSet.has(u.stateLabel)) return false;
      if (citySet.size && !citySet.has(u.cityLabel)) return false;
      return true;
    });
    if (!query.trim()) return filtered;
    const q = query.trim().toLowerCase();
    return filtered.filter(
      (u) =>
        u.code.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.location.toLowerCase().includes(q) ||
        u.branchLabel.toLowerCase().includes(q) ||
        u.customerLabel.toLowerCase().includes(q) ||
        u.stateLabel.toLowerCase().includes(q) ||
        u.cityLabel.toLowerCase().includes(q) ||
        u.zone.toLowerCase().includes(q) ||
        u.branchSapCode.toLowerCase().includes(q),
    );
  }, [scopedUnits, branchById, customerById, stateById, query, statusFilter, orgFilter, stateFilter, cityFilter]);

  const pg = usePagination(rows);

  const orgOptions = useMemo(
    () => [...scopedCustomers].sort((a, b) => a.name.localeCompare(b.name)),
    [scopedCustomers],
  );

  // State / city come from the client's billing address, which is already
  // populated for almost every client.
  const stateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of scopedUnits) if (u.billingState?.trim()) set.add(u.billingState.trim());
    return [...set].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  }, [scopedUnits]);

  const cityOptions = useMemo(() => {
    const picked = new Set(stateFilter);
    const set = new Set<string>();
    for (const u of scopedUnits) {
      if (picked.size && !picked.has((u.billingState || "").trim())) continue;
      if (u.billingCity?.trim()) set.add(u.billingCity.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  }, [scopedUnits, stateFilter]);

  const activeCount = scopedUnits.filter((u) => u.status === "active").length;

  return (
    <div>
      <PageHeader
        title="Clients"
        eyebrow="Organizations"
        icon={Warehouse}
        description="Track operational clients deployed across branches."
        crumbs={[
          { label: "Organizations", to: "/admin/customers/customer-manager" },
          { label: "Clients" },
        ]}
        kpis={
          <>
            <PageStat label="Total clients" value={units.length} icon={Warehouse} />
            <PageStat label="Active" value={activeCount} tone="accent" />
            <PageStat label="Inactive" value={units.length - activeCount} tone="destructive" />
          </>
        }
      />

      <div className="mobile-directory-toolbar mobile-glass-surface mb-3 grid grid-cols-1 gap-1.5 rounded-xl border border-border/60 bg-card/60 p-2 sm:mb-4 sm:flex sm:items-center sm:justify-between sm:gap-2 sm:rounded-2xl sm:p-2.5">
        <div className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
          <div className="relative col-span-2 w-full sm:min-w-56 sm:max-w-sm sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by code, name, branch, organisation…"
              className="h-10 rounded-xl border-transparent bg-card/80 pl-9 shadow-sm focus-visible:border-accent/30"
            />
          </div>
          <Select value={orgFilter} onValueChange={setOrgFilter}>
            <SelectTrigger className="h-10 w-full shrink-0 rounded-xl border-transparent bg-card/80 shadow-sm sm:w-[220px]">
              <SelectValue placeholder="All organisations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All organisations</SelectItem>
              {orgOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MultiSelectFilter
            options={stateOptions}
            selected={stateFilter}
            onChange={(next) => {
              setStateFilter(next);
              setCityFilter([]);
            }}
            allLabel="All states"
            className="h-10 w-full shrink-0 rounded-xl border-transparent bg-card/80 shadow-sm sm:w-auto sm:min-w-36"
          />
          <MultiSelectFilter
            options={cityOptions}
            selected={cityFilter}
            onChange={setCityFilter}
            allLabel="All cities"
            className="h-10 w-full shrink-0 rounded-xl border-transparent bg-card/80 shadow-sm sm:w-auto sm:min-w-36"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10 w-full shrink-0 rounded-xl border-transparent bg-card/80 shadow-sm sm:w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:flex sm:gap-2">
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                "units",
                rows.map((u) => ({
                  unitCode: u.code,
                  unitName: u.name,
                  customer: u.customerLabel,
                  branch: u.branchLabel,
                  location: u.location,
                  state: u.stateLabel,
                  city: u.cityLabel,
                  zone: u.zone,
                  branchSapCode: u.branchSapCode,
                  description: u.description,
                  status: csvStatus(u.status),
                  contractStartDate: csvDate(u.contractStartDate),
                  contractEndDate: csvDate(u.contractEndDate),
                  pan: u.panNumber,
                  gstPayable: csvYesNo(u.gstPayable),
                  gstType: u.gstType,
                  gst: u.gstNumber,
                  billingContact: csvJoin([u.billingSalutation, u.billingName], " "),
                  billingAddress: csvJoin(
                    [
                      u.billingAddress1,
                      u.billingAddress2,
                      u.billingCity,
                      u.billingDistrict,
                      u.billingState,
                      u.billingPincode,
                      u.billingCountry,
                    ],
                  ),
                  shippingSameAsBilling: csvYesNo(u.shippingSameAsBilling),
                  shippingSameAsOrganisation: csvYesNo(u.shippingSameAsOrg),
                  shippingContact: csvJoin([u.shippingSalutation, u.shippingName], " "),
                  shippingAddress: csvJoin(
                    [
                      u.shippingAddress1,
                      u.shippingAddress2,
                      u.shippingCity,
                      u.shippingDistrict,
                      u.shippingState,
                      u.shippingPincode,
                      u.shippingCountry,
                    ],
                  ),
                  reportingOfficers: csvJoin(
                    u.reportingOfficers.map((officer) =>
                      csvJoin(
                        [
                          officer.name,
                          officer.isPrimary ? "Primary" : "Secondary",
                          officer.isActive ? "Active" : "Inactive",
                        ],
                        " | ",
                      ),
                    ),
                    " ; ",
                  ),
                  emergencyContact: csvJoin(
                    [u.emergencyContactName, u.emergencyContactMobile],
                    " | ",
                  ),
                  nearbyHospital: csvJoin(
                    [u.nearbyHospitalName, u.nearbyHospitalMobile],
                    " | ",
                  ),
                  ambulance: csvJoin([u.ambulanceName, u.ambulanceMobile], " | "),
                  latitude: u.latitude,
                  longitude: u.longitude,
                  mapLink: csvMapLink(u.latitude, u.longitude),
                })),
                [
                  { key: "unitCode", header: "Client code" },
                  { key: "unitName", header: "Client name" },
                  { key: "customer", header: "Organization" },
                  { key: "branch", header: "Branch" },
                  { key: "location", header: "Location" },
                  { key: "state", header: "State" },
                  { key: "city", header: "City" },
                  { key: "zone", header: "Zone" },
                  { key: "branchSapCode", header: "Branch SAP code" },
                  { key: "description", header: "Description" },
                  { key: "status", header: "Status" },
                  { key: "contractStartDate", header: "Contract start" },
                  { key: "contractEndDate", header: "Contract end" },
                  { key: "pan", header: "PAN" },
                  { key: "gstPayable", header: "GST payable" },
                  { key: "gstType", header: "GST type" },
                  { key: "gst", header: "GST" },
                  { key: "billingContact", header: "Billing contact" },
                  { key: "billingAddress", header: "Billing address" },
                  { key: "shippingSameAsBilling", header: "Shipping same as billing" },
                  { key: "shippingSameAsOrganisation", header: "Shipping same as organisation" },
                  { key: "shippingContact", header: "Shipping contact" },
                  { key: "shippingAddress", header: "Shipping / Deployment address" },
                  { key: "reportingOfficers", header: "Reporting officers" },
                  { key: "emergencyContact", header: "Emergency contact" },
                  { key: "nearbyHospital", header: "Nearby hospital" },
                  { key: "ambulance", header: "Ambulance" },
                  { key: "latitude", header: "Latitude" },
                  { key: "longitude", header: "Longitude" },
                  { key: "mapLink", header: "Map link" },
                ],
              )
            }
            disabled={rows.length === 0}
            className="h-9 rounded-lg px-2.5 text-xs sm:h-10 sm:rounded-xl sm:px-4 sm:text-sm"
          >
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="h-9 rounded-lg bg-primary px-2.5 text-xs text-primary-foreground shadow-sm hover:bg-primary/90 sm:h-10 sm:rounded-xl sm:px-4 sm:text-sm"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add client
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 backdrop-blur-xl shadow-[0_1px_0_0_rgba(255,255,255,0.7)_inset,0_18px_40px_-30px_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between border-b border-border/60 bg-gradient-to-r from-accent/[0.08] via-transparent to-transparent px-5 py-2.5 text-xs text-foreground">
          <span className="inline-flex items-center gap-2"><span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] text-primary-foreground">{rows.length}</span><span className="uppercase tracking-[0.14em] text-muted-foreground">Total {rows.length === 1 ? "row" : "rows"}</span></span>
        </div>
        <div className="overflow-x-auto">
          <table className="ios-table w-full text-sm">
            <thead className="bg-secondary/60 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Client ID</th>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Location</th>
                <th className="px-5 py-3">State</th>
                <th className="px-5 py-3">City</th>
                <th className="px-5 py-3">Branch</th>
                <th className="px-5 py-3">Organisation</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right" data-col="actions">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pg.pageRows.map((u) => (
                <tr key={u.id} className="hover:bg-secondary/30">
                  <td data-label="Client ID" className="px-5 py-3 font-mono text-xs font-semibold text-accent">{u.code}</td>
                  <td data-label="Name" className="px-5 py-3 font-semibold text-foreground" data-wrap="true">{u.name}</td>
                  <td data-label="Location" className="px-5 py-3 text-muted-foreground" data-wrap="true">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{u.location || <span className="italic opacity-60">—</span>}</span>
                      {(u.latitude != null && u.longitude != null) && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${u.latitude},${u.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="cell-pill"
                          title="Open in Google Maps"
                        >
                          <MapPin className="h-3 w-3" />
                          <span>Map</span>
                        </a>
                      )}
                    </div>
                  </td>
                  <td data-label="State" className="px-5 py-3 text-foreground" data-wrap="true">{u.stateLabel || <span className="italic opacity-60">—</span>}</td>
                  <td data-label="City" className="px-5 py-3 text-foreground" data-wrap="true">{u.cityLabel || <span className="italic opacity-60">—</span>}</td>
                  <td data-label="Branch" className="px-5 py-3 text-foreground" data-wrap="true">{u.branchLabel}</td>
                  <td data-label="Organization" className="px-5 py-3 text-foreground" data-wrap="true">{u.customerLabel}</td>
                  <td data-label="Status" className="px-5 py-3">
                    <StatusBadge active={u.status === "active"} />
                  </td>
                  <td data-label="Actions" className="px-5 py-3 text-right" data-col="actions">
                    <div className="inline-flex gap-1">
                      <RecordViewButton
                        record={u}
                        title="Unit details"
                        onEdit={() => { setEditing(u);
                          setFormOpen(true); }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditing(u);
                          setFormOpen(true);
                        }}
                        aria-label="Edit"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <DeleteGuardButton
                        id={u.id}
                        entityLabel="unit"
                        checks={[
                          { table: "client_contracts", column: "unit_id", label: "client contracts" },
                          { table: "candidates", column: "unit_id", label: "candidates" },
                          { table: "candidate_units", column: "unit_id", label: "candidate links" },
                        ]}
                        onDelete={() => setDeleting(u)}
                      />

                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-sm text-muted-foreground">
                    <Warehouse className="mx-auto mb-2 h-6 w-6 opacity-50" />
                    {units.length === 0
                      ? "No clients yet. Add your first client to get started."
                      : "No clients match your search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <DataPagination {...pg} />
        </div>
      </div>


      <UnitFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        units={units}
        onSubmit={async (data) => {
          const r = editing ? await updateUnit(editing.id, data) : await addUnit(data);
          if (!r.ok) return { error: r.error, id: null };
          void logActivity({ module: "Clients", action: editing ? "update" : "create", entityType: "units", entityId: editing?.id, entityLabel: String((data as Record<string, unknown>).code ?? (data as Record<string, unknown>).name ?? ""), details: data as Record<string, unknown> });
          void notifySaved({ title: "Saved", description: editing ? "Client updated" : "Client added" });
          return { error: null, id: editing ? editing.id : (("id" in r ? r.id : undefined) ?? null) };
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete unit?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <span className="font-mono font-semibold text-foreground">{deleting?.code}</span>
              {deleting?.name ? <> – {deleting.name}</> : null} from the directory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleting) return;
                try {
                  const _delId = deleting.id;
                  const _delLabel = String((deleting as Record<string, unknown>).name ?? (deleting as Record<string, unknown>).code ?? _delId);
                  await deleteUnit(_delId);
                  void logActivity({ module: "Clients", action: "delete", entityType: "units", entityId: _delId, entityLabel: _delLabel });
                  toast.success("Client deleted");
                  setDeleting(null);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Delete failed");
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
        active ? "bg-accent/15 text-accent" : "bg-rose-500/15 text-rose-700",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : "bg-rose-500")} />
      {active ? "active" : "inactive"}
    </span>
  );
}

function readableError(e: unknown, fallback: string): string {
  if (e && typeof e === "object") {
    const record = e as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "code"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return e instanceof Error && e.message ? e.message : fallback;
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="modern-form-section">
      <h3 className="modern-form-section-title">{title}</h3>
      {children}
    </section>
  );
}

function UnitFormDialog({
  open,
  onOpenChange,
  editing,
  units,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Unit | null;
  units: Unit[];
  onSubmit: (data: Omit<Unit, "id">) => Promise<{ error: string | null; id: string | null }>;
}) {
  const { branches } = useBranches();
  const { customers } = useCustomers();
  const { states } = useStates();
  const { data: esicBranches = [] } = useQuery({
    queryKey: ["admin", "esic-branches", "enabled"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("esic_branches")
        .select("id, location, esic_code, enabled")
        .order("location");
      if (error) throw error;
      return (data ?? []).filter((b) => b.enabled !== false);
    },
  });
  // Paid-holiday duty values offered to this unit come straight from
  // Control Center → Attendance Code Manager (every enabled PH-family code).
  // Add a code there and it appears in this dropdown automatically.
  const { data: phCodeOptions = [] } = useQuery({
    queryKey: ["admin", "attendance-codes", "ph-family"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_codes")
        .select("code, label, day_value, enabled")
        .order("sort_order");
      if (error) throw error;
      const rows = (data ?? []) as Array<{ code: string; label: string; day_value: number | string | null; enabled: boolean | null }>;
      return rows
        .filter((r) => r.enabled !== false && String(r.code).toUpperCase().startsWith("PH"))
        .map((r) => ({
          code: String(r.code),
          label: String(r.label ?? r.code),
          value: r.day_value == null || Number.isNaN(Number(r.day_value)) ? 1 : Number(r.day_value),
        }));
    },
  });



  const [form, setForm] = useState<Omit<Unit, "id">>(() => emptyUnit(nextUnitCode(units)));
  const [error, setError] = useState<string | null>(null);
  const [assignedFoIds, setAssignedFoIds] = useState<string[]>([]);
  const [mapping, setMapping] = useState<UnitMappingValue>({ fieldOfficerId: null, reportingManagerId: null });
  useEffect(() => {
    if (!open) return;
    if (!editing?.id) { setMapping({ fieldOfficerId: null, reportingManagerId: null }); return; }
    let live = true;
    void loadUnitMapping(editing.id).then((m) => { if (live) setMapping(m); }).catch(() => {});
    return () => { live = false; };
  }, [open, editing?.id]);
  const [clientAttrValues, setClientAttrValues] = useState<Record<string, string>>({});
  const [selectedFoToAdd, setSelectedFoToAdd] = useState("");
  const [, setFoSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [stepKey, setStepKey] = useState("organization");
  const openedUnitRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      openedUnitRef.current = null;
      return;
    }
    const unitKey = editing?.id ?? "new";
    if (openedUnitRef.current === unitKey) return;
    openedUnitRef.current = unitKey;
    if (editing) {
      const { id: _ignored, ...rest } = editing;
      void _ignored;
      setForm(rest);
    } else {
      setForm(emptyUnit(nextUnitCode(units)));
    }
    setError(null);
    setSelectedFoToAdd("");
    setStepKey("organization");
  }, [open, editing, units]);

  const set = <K extends keyof Omit<Unit, "id">>(k: K, v: Omit<Unit, "id">[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // The ESIC sub-code follows the site's location, so map it automatically
  // whenever the site has no branch yet. A manual choice is never overwritten.
  const autoEsicBranchId = useMemo(
    () => pickEsicBranchId(esicBranches, form.billingCity, form.billingState),
    [esicBranches, form.billingCity, form.billingState],
  );
  useEffect(() => {
    if (!open) return;
    if (form.esicBranchId) return;
    if (!autoEsicBranchId) return;
    setForm((f) => (f.esicBranchId ? f : { ...f, esicBranchId: autoEsicBranchId }));
  }, [open, autoEsicBranchId, form.esicBranchId]);

  // Sort branches as code (BR1, BR2…)
  const branchOptions = useMemo(() => {
    const stateById = new Map(states.map((s) => [s.id, s]));
    return [...branches]
      .sort((a, b) => {
        const na = parseInt(a.code.replace(/\D/g, ""), 10) || 0;
        const nb = parseInt(b.code.replace(/\D/g, ""), 10) || 0;
        return na - nb;
      })
      .map((b) => ({ id: b.id, label: `${b.code} – ${stateById.get(b.stateId)?.name ?? ""}` }));
  }, [branches, states]);

  const customerOptions = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name)),
    [customers],
  );

  const selectedOrg = customers.find((c) => c.id === form.customerId);

  // Sync defaults from the selected organisation into empty billing/contact fields
  const prevCustomerIdRef = useRef<string | null>(form.customerId);
  useEffect(() => {
    if (form.customerId === prevCustomerIdRef.current) return;
    prevCustomerIdRef.current = form.customerId;
    if (!form.customerId) return;
    const org = customers.find((c) => c.id === form.customerId);
    if (!org) return;
    setForm((f) => ({
      ...f,
      billingSalutation: f.billingSalutation || org.billingSalutation,
      billingName: f.billingName || org.billingName || org.name,
      billingAddress1: f.billingAddress1 || org.billingAddress1,
      billingAddress2: f.billingAddress2 || org.billingAddress2,
      billingPincode: f.billingPincode || org.billingPincode,
      billingCity: f.billingCity || org.billingCity,
      billingDistrict: f.billingDistrict || org.billingDistrict,
      billingState: f.billingState || org.billingState,
      billingCountry: f.billingCountry || org.billingCountry || "India",
    }));
  }, [form.customerId, customers]);

  // Apply "shipping same as billing"
  useEffect(() => {
    if (!form.shippingSameAsBilling) return;
    setForm((f) => ({
      ...f,
      shippingSalutation: f.billingSalutation,
      shippingName: f.billingName,
      shippingAddress1: f.billingAddress1,
      shippingAddress2: f.billingAddress2,
      shippingPincode: f.billingPincode,
      shippingCity: f.billingCity,
      shippingDistrict: f.billingDistrict,
      shippingState: f.billingState,
      shippingCountry: f.billingCountry,
      shippingSameAsOrg: false,
    }));
  }, [
    form.shippingSameAsBilling,
    form.billingSalutation,
    form.billingName,
    form.billingAddress1,
    form.billingAddress2,
    form.billingPincode,
    form.billingCity,
    form.billingDistrict,
    form.billingState,
    form.billingCountry,
  ]);

  // Apply "shipping same as organisation"
  useEffect(() => {
    if (!form.shippingSameAsOrg || !selectedOrg) return;
    setForm((f) => ({
      ...f,
      shippingAddress1: selectedOrg.address,
      shippingAddress2: "",
      shippingName: selectedOrg.name,
      shippingSameAsBilling: false,
    }));
  }, [form.shippingSameAsOrg, selectedOrg]);

  // ---- Field officer assignment (scope_type='unit') ----
  const qc = useQueryClient();
  const fosQuery = useQuery({
    queryKey: ["unit-form", "field-officers"],
    enabled: open,
    queryFn: async () => {
      // Uses a SECURITY DEFINER RPC so branch-scoped viewers (HR, leadership,
      // branch managers) can still see all onboarded field officers to assign.
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
      }).rpc("list_active_field_officers");
      if (error) throw error as Error;
      return (data ?? []) as Array<{ id: string; full_name: string; employee_code: string | null; mobile: string | null; status: string }>;
    },
  });

  const fieldOfficerIds = useMemo(
    () => (fosQuery.data ?? []).map((fo) => fo.id),
    [fosQuery.data],
  );

  const existingAssignQuery = useQuery({
    queryKey: ["unit-form", "assignments", editing?.id ?? "new", fieldOfficerIds.join(",")],
    enabled: open && !!editing?.id && !fosQuery.isLoading,
    queryFn: async () => {
      if (fieldOfficerIds.length === 0) return [];
      const { data, error } = await supabase
        .from("employee_scope_assignments")
        .select("id,candidate_id")
        .eq("scope_type", "unit")
        .eq("scope_id", editing!.id)
        .in("candidate_id", fieldOfficerIds);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; candidate_id: string }>;
    },
  });

  useEffect(() => {
    if (!open) return;
    if (editing?.id) {
      setAssignedFoIds((existingAssignQuery.data ?? []).map((r) => r.candidate_id));
    } else {
      setAssignedFoIds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, existingAssignQuery.data]);

  // Optional attributes this organization's MIS format contributes to its clients.
  const clientAttrsQuery = useQuery({
    queryKey: ["unit-form", "client-attributes", form.customerId ?? ""],
    enabled: open && !!form.customerId,
    queryFn: () => loadClientAttributesForCustomer(form.customerId),
  });
  const clientAttributes = clientAttrsQuery.data ?? [];

  const clientAttrValuesQuery = useQuery({
    queryKey: ["unit-form", "client-attribute-values", editing?.id ?? "new"],
    enabled: open && !!editing?.id,
    queryFn: () => loadClientAttributeValues(editing!.id),
  });

  useEffect(() => {
    if (!open) return;
    setClientAttrValues(editing?.id ? (clientAttrValuesQuery.data ?? {}) : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, clientAttrValuesQuery.data]);

  const toggleFo = (id: string) =>
    setAssignedFoIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const availableFieldOfficers = useMemo(
    () => (fosQuery.data ?? []).filter((fo) => !assignedFoIds.includes(fo.id)),
    [fosQuery.data, assignedFoIds],
  );

  const addSelectedFieldOfficer = () => {
    if (!selectedFoToAdd || assignedFoIds.includes(selectedFoToAdd)) return;
    setAssignedFoIds((prev) => [...prev, selectedFoToAdd]);
    setSelectedFoToAdd("");
  };

  const syncFieldOfficerAssignments = async (unitId: string): Promise<string | null> => {
    try {
      setFoSyncing(true);
      const existing = editing?.id
        ? (existingAssignQuery.data ?? [])
        : [];
      const currentIds = new Set(existing.map((r) => r.candidate_id));
      const desired = new Set(assignedFoIds);
      const toRemove = existing.filter((r) => !desired.has(r.candidate_id));
      const toAdd = assignedFoIds.filter((id) => !currentIds.has(id));
      const scopeLabel = `${form.code}${form.name ? ` – ${form.name}` : ""}`.trim();
      if (toRemove.length) {
        const { error } = await supabase
          .from("employee_scope_assignments")
          .delete()
          .in("id", toRemove.map((r) => r.id));
        if (error) throw error;
      }
      if (toAdd.length) {
        const rows = toAdd.map((cid) => ({
          candidate_id: cid,
          scope_type: "unit",
          scope_id: unitId,
          scope_label: scopeLabel,
        }));
        const { error } = await supabase
          .from("employee_scope_assignments")
          .upsert(rows as never, {
            onConflict: "candidate_id,scope_type,scope_id",
            ignoreDuplicates: true,
          });
        if (error) throw error;
      }
      if (toRemove.length || toAdd.length) {
        void logActivity({
          module: "Clients",
          action: "assign_field_officers",
          entityType: "units",
          entityId: unitId,
          entityLabel: scopeLabel,
          after: { added: toAdd, removed: toRemove.map((r) => r.candidate_id) },
        });
        qc.invalidateQueries({ queryKey: ["admin", "employee_scope_assignments"] });
      }
      return null;
    } catch (e) {
      return readableError(e, "Failed to save field officer assignments");
    } finally {
      setFoSyncing(false);
    }
  };

  const addOfficer = () =>
    set("reportingOfficers", [...form.reportingOfficers, { name: "", isPrimary: false, isActive: true }]);

  const updateOfficer = (idx: number, patch: Partial<ReportingOfficer>) => {
    const next = form.reportingOfficers.map((o, i) => (i === idx ? { ...o, ...patch } : o));
    // Ensure only one primary
    if (patch.isPrimary) {
      for (let i = 0; i < next.length; i++) {
        if (i !== idx) next[i] = { ...next[i], isPrimary: false };
      }
    }
    set("reportingOfficers", next);
  };

  const removeOfficer = (idx: number) =>
    set(
      "reportingOfficers",
      form.reportingOfficers.filter((_, i) => i !== idx),
    );

  const saveUnit = async () => {
    if (isSaving) return;
    setError(null);
    if (!form.uniformIncluded && !(Number(form.uniformFeeAmount) > 0)) {
      const msg = "Enter the uniform fee (₹) — uniform is not included in this unit's contract.";
      setError(msg);
      toast.error(msg);
      return;
    }

    setIsSaving(true);
    try {
      const result = await onSubmit(form);
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      if (result.id && clientAttributes.length > 0) {
        try {
          await saveClientAttributeValues(clientAttributes, result.id, clientAttrValues);
        } catch (cause) {
          toast.error(
            `Client saved, but the extra attributes could not be stored: ${cause instanceof Error ? cause.message : "unknown error"}`,
          );
        }
      }
      onOpenChange(false);
      if (result.id) {
        void syncFieldOfficerAssignments(result.id).then((syncErr) => {
          if (syncErr) toast.error(`Client saved, but field officer assignments could not be updated: ${syncErr}`);
        });
        const unitId = result.id;
        void saveUnitMapping(unitId, `${form.code} – ${form.name}`, mapping)
          .then(() => qc.invalidateQueries({ queryKey: ["ops-deployments"] }))
          .catch((e) => toast.error(`Client saved, but mapping could not be updated: ${e instanceof Error ? e.message : String(e)}`));
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save the client. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const steps: GuidedFormStep[] = [
    { key: "organization", label: "Organization", caption: "Organization and branch mapping" },
    { key: "details", label: "Client details", caption: "Identity, status and business details" },
    { key: "billing", label: "Billing", caption: "Contact and billing address" },
    { key: "deployment", label: "Deployment", caption: "Deployment address and map location" },
    { key: "statutory", label: "Statutory", caption: "Tax and welfare settings" },
    { key: "inclusions", label: "Inclusions", caption: "Contract charges and benefits" },
    { key: "mapping", label: "Mapping", caption: "Field officer and reporting manager" },
    { key: "review", label: "Review", caption: "Contacts, deployment and final check" },
  ];
  const validateStep = (key: string) => {
    if (key === "organization" && !form.customerId) return "Select an organization";
    if (key === "organization" && !form.branchId) return "Select a branch";
    if (key === "details" && !form.name.trim()) return "Client name is required";
    if (key === "billing" && form.billingPincode && !/^\d{6}$/.test(form.billingPincode)) return "Enter a valid billing pincode";
    if (key === "inclusions" && !form.uniformIncluded && !(Number(form.uniformFeeAmount) > 0)) return "Enter the uniform fee";
    return null;
  };
  const isStepComplete = (key: string): boolean => {
    if (["organization", "details", "billing", "inclusions"].includes(key)) return !validateStep(key);
    if (key === "deployment") return form.shippingSameAsBilling || form.shippingSameAsOrg || Boolean(form.shippingAddress1.trim());
    if (key === "statutory") return true;
    if (key === "mapping") return Boolean(mapping.fieldOfficerId && mapping.reportingManagerId);
    return steps.slice(0, 6).every((step) => isStepComplete(step.key));
  };
  const requestStep = (key: string) => {
    const target = steps.findIndex((step) => step.key === key);
    for (let index = 0; index < target; index += 1) {
      const problem = validateStep(steps[index].key);
      if (problem) { toast.error(problem); setStepKey(steps[index].key); return; }
    }
    setStepKey(key);
  };
  const restoreDraft = useCallback((value: Omit<Unit, "id">) => setForm(value), []);
  const meaningfulDraft = useCallback((value: Omit<Unit, "id">) => Boolean(value.name || value.customerId || value.billingAddress1), []);
  const draft = useGuidedFormDraft({ open, storageKey: editing ? null : "rg-wizard-draft-client", value: form, onRestore: restoreDraft, isMeaningful: meaningfulDraft });

  const closeGuard = useGuidedFormCloseGuard(() => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={closeGuard.onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-card p-0 sm:h-auto sm:max-h-[94dvh] sm:w-[96vw] sm:max-w-6xl sm:rounded-xl sm:border">
        <DialogHeader className="sr-only">
          <DialogTitle>{editing ? "Edit client" : "Add client"}</DialogTitle>
          <DialogDescription>
            A unit is an operational location mapped to a branch and an organisation.
          </DialogDescription>
        </DialogHeader>

        <GuidedForm closeGuardRef={closeGuard.ref} title={editing ? "Edit client" : "New client"} steps={steps} stepKey={stepKey} onStepChange={requestStep} isStepComplete={isStepComplete} onCancel={() => onOpenChange(false)} onSaveDraft={editing ? undefined : () => { draft.save(); toast.success("Draft saved"); }} onSubmit={() => void saveUnit()} saving={isSaving} submitLabel={editing ? "Save changes" : "Create client"}>
          {draft.hasDraft && !editing && stepKey === "organization" && <div className="mb-4 flex items-center justify-between rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 text-sm"><span className="text-muted-foreground">Saved draft available</span><Button size="sm" variant="outline" onClick={draft.restore}>Restore</Button></div>}
        <div className="modern-business-form">
          <div className={stepKey === "organization" ? "block" : "hidden"}>
          {/* ORG & BRANCH (first) */}
          <Section title="Organisation & branch">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Organisation" required>
                <Select value={form.customerId ?? ""} onValueChange={(v) => set("customerId", v || null)}>
                  <SelectTrigger><SelectValue placeholder="Select organisation first" /></SelectTrigger>
                  <SelectContent>
                    {customerOptions.length === 0 ? (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                        No organisations yet
                      </div>
                    ) : (
                      customerOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.code} – {c.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Branch" required>
                <Select
                  value={form.branchId ?? ""}
                  onValueChange={(v) => set("branchId", v || null)}
                  disabled={!form.customerId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={form.customerId ? "Select branch" : "Pick organisation first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {branchOptions.length === 0 ? (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                        No branches yet
                      </div>
                    ) : (
                      branchOptions.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </Section>
          </div>

          {/* UNIT INFO */}
          <div className={stepKey === "details" ? "space-y-5" : "hidden"}>
          <Section title="Client information">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client code (auto, editable)">
                <Input
                  value={form.code}
                  onChange={(e) => set("code", e.target.value.toUpperCase())}
                  placeholder="UN1"
                  className="font-mono"
                />
              </Field>
              <Field label="Client name" required>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Client location">
                <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
              </Field>
              <Field label="Zone">
                <Input value={form.zone} onChange={(e) => set("zone", e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Branch SAP code">
                <Input value={form.branchSapCode} onChange={(e) => set("branchSapCode", e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Status">
                <div className="modern-form-toggle">
                  <span className="text-sm font-medium text-foreground">
                    {form.status === "active" ? "Active" : "Inactive"}
                  </span>
                  <Switch
                    checked={form.status === "active"}
                    onCheckedChange={(v) => set("status", v ? "active" : "inactive")}
                  />
                </div>
              </Field>
              <Field label="Billable">
                <div className="modern-form-toggle">
                  <span className="text-sm font-medium text-foreground">
                    {form.isBillable ? "Billable" : "Non-billable"}
                  </span>
                  <Switch
                    checked={form.isBillable}
                    onCheckedChange={(v) => set("isBillable", v)}
                  />
                </div>
              </Field>
            </div>
          </Section>

          {clientAttributes.length > 0 && (
            <Section title="Additional attributes">
              <div className="grid gap-3 sm:grid-cols-2">
                {clientAttributes.map((attr) => (
                  <Field key={attr.columnId} label={attr.header}>
                    <Input
                      value={clientAttrValues[attr.columnId] ?? ""}
                      placeholder="Optional"
                      onChange={(e) =>
                        setClientAttrValues((prev) => ({ ...prev, [attr.columnId]: e.target.value }))
                      }
                    />
                  </Field>
                ))}
              </div>
            </Section>
          )}


          {/* BUSINESS */}
          <Section title="Business information">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="PAN number">
                <Input
                  format="pan"
                  value={form.panNumber}
                  onChange={(e) => set("panNumber", e.target.value)}
                />
              </Field>
              <Field label="GST payable?">
                <div className="modern-form-toggle">
                  <span className="text-sm font-medium text-foreground">
                    {form.gstPayable ? "Yes" : "No"}
                  </span>
                  <Switch
                    checked={form.gstPayable}
                    onCheckedChange={(v) => {
                      set("gstPayable", v);
                      if (!v) {
                        setForm((f) => ({ ...f, gstType: "", gstNumber: "" }));
                      }
                    }}
                  />
                </div>
              </Field>
              {form.gstPayable && (
                <>
                  <Field label="GST type">
                    <Select value={form.gstType} onValueChange={(v) => set("gstType", v)}>
                      <SelectTrigger><SelectValue placeholder="Select GST type" /></SelectTrigger>
                      <SelectContent>
                        {GST_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="GST number">
                    <Input
                      format="gstin"
                      value={form.gstNumber}
                      onChange={(e) => set("gstNumber", e.target.value)}
                    />
                  </Field>
                  <div className="sm:col-span-2 text-xs text-muted-foreground">
                    GSTIN portal auto-verification (type detection) is coming soon — for now please pick the type manually.
                  </div>
                </>
              )}
            </div>
          </Section>
          </div>

          {/* CONTACT / BILLING */}
          <div className={stepKey === "billing" ? "block" : "hidden"}>
          <Section title="Contact / billing information">
            <AddressFields
              prefix="billing"
              salutation={form.billingSalutation}
              name={form.billingName}
              address1={form.billingAddress1}
              address2={form.billingAddress2}
              pincode={form.billingPincode}
              city={form.billingCity}
              district={form.billingDistrict}
              stateName={form.billingState}
              country={form.billingCountry}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Latitude">
                <Input
                  value={form.latitude ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    set("latitude", v === "" ? null : Number(v));
                  }}
                  placeholder="19.0760"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Longitude">
                <Input
                  value={form.longitude ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    set("longitude", v === "" ? null : Number(v));
                  }}
                  placeholder="72.8777"
                  inputMode="decimal"
                />
              </Field>
              <div className="flex items-end">
                {form.latitude != null && form.longitude != null && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${form.latitude},${form.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold text-accent hover:bg-accent/10"
                  >
                    <MapPin className="h-3.5 w-3.5" /> Open in Maps
                  </a>
                )}
              </div>
            </div>
          </Section>
          </div>

          {/* SHIPPING */}
          <div className={stepKey === "deployment" ? "block" : "hidden"}>
          <Section title="Shipping / Deployment address">
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <ToggleRow
                label="Same as billing"
                checked={form.shippingSameAsBilling}
                onCheckedChange={(v) => set("shippingSameAsBilling", v)}
              />
              <ToggleRow
                label="Same as organisation address"
                checked={form.shippingSameAsOrg}
                onCheckedChange={(v) => set("shippingSameAsOrg", v)}
              />
            </div>
            {!form.shippingSameAsBilling && !form.shippingSameAsOrg && (
              <AddressFields
                prefix="shipping"
                salutation={form.shippingSalutation}
                name={form.shippingName}
                address1={form.shippingAddress1}
                address2={form.shippingAddress2}
                pincode={form.shippingPincode}
                city={form.shippingCity}
                district={form.shippingDistrict}
                stateName={form.shippingState}
                country={form.shippingCountry}
                onChange={(patch) => {
                  // patch keys come back as billing*; remap to shipping*
                  const remapped: Partial<Omit<Unit, "id">> = {};
                  for (const [k, v] of Object.entries(patch)) {
                    const sk = k.replace(/^billing/, "shipping") as keyof Omit<Unit, "id">;
                    (remapped as Record<string, unknown>)[sk] = v;
                  }
                  setForm((f) => ({ ...f, ...remapped }));
                }}
              />
            )}
          </Section>
          </div>

          {/* PROFESSIONAL TAX */}
          <div className={stepKey === "statutory" ? "space-y-5" : "hidden"}>
          <Section title="Professional tax information">
            <ProfessionalTaxBlock
              enabled={form.enablePt}
              onToggle={(v) => set("enablePt", v)}
              billingPincode={form.billingPincode}
            />
          </Section>

          {/* LABOUR WELFARE FUND */}
          <Section title="Labour welfare fund (LWF)">
            <LwfBlock
              enabled={form.enableLwf}
              onToggle={(v) => set("enableLwf", v)}
              billingPincode={form.billingPincode}
            />
          </Section>
          </div>

          {/* CONTRACT INCLUSIONS */}
          <div className={stepKey === "inclusions" ? "block" : "hidden"}>
          <Section title="Contract inclusions">
            <div className="rounded-xl border border-border/60 bg-background p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold">Uniform included in contract</div>
                    <Badge
                      className={cn(
                        "border-0 text-[10px] font-semibold uppercase tracking-wide",
                        form.uniformIncluded
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {form.uniformIncluded ? "Included" : "Not included"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    {form.uniformIncluded
                      ? "When on, uniforms issued to staff on this client are billed to the client — the staff member is not charged. Uniform items will show ₹0 · Included on their profile."
                      : "When off, the value of uniforms issued to staff is charged to the staff member. Their profile will show the recoverable rupee value against each uniform item."}
                  </p>
                </div>
                <Switch
                  checked={form.uniformIncluded}
                  onCheckedChange={(v) => {
                    set("uniformIncluded", v);
                    if (v) set("uniformFeeAmount", 0);
                  }}
                />
              </div>
              {!form.uniformIncluded && (
                <div className="mt-3 max-w-xs">
                  <Field label="Uniform fee (₹)" required>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      autoFocus
                      value={String(form.uniformFeeAmount ?? 0)}
                      onChange={(e) => set("uniformFeeAmount", Math.max(0, Number(e.target.value) || 0))}
                    />
                  </Field>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    This amount is charged to every staff member on this unit as an automatic uniform deduction once they acknowledge issuance. It can be edited or split into instalments later in Payroll → Deductions.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-border/60 bg-background p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold">Recruitment fee</div>
                    <Badge
                      className={cn(
                        "border-0 text-[10px] font-semibold uppercase tracking-wide",
                        form.recruitmentFeeEnabled
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {form.recruitmentFeeEnabled ? "Applicable" : "Off"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    Turn on if a recruitment fee is chargeable for this unit, then enter the amount in rupees.
                  </p>
                </div>
                <Switch
                  checked={form.recruitmentFeeEnabled}
                  onCheckedChange={(v) => set("recruitmentFeeEnabled", v)}
                />
              </div>
              {form.recruitmentFeeEnabled && (
                <div className="mt-3 max-w-xs">
                  <Field label="Recruitment fee amount (₹)">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={String(form.recruitmentFeeAmount ?? 0)}
                      onChange={(e) => set("recruitmentFeeAmount", Math.max(0, Number(e.target.value) || 0))}
                    />
                  </Field>
                </div>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-border/60 bg-background p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold">GPAIP</div>
                    <Badge
                      className={cn(
                        "border-0 text-[10px] font-semibold uppercase tracking-wide",
                        form.gpaipEnabled
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {form.gpaipEnabled ? "Applicable" : "Off"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    Group Personal Accident Insurance Policy. Turn on to charge this unit, then enter the amount in rupees.
                  </p>
                </div>
                <Switch
                  checked={form.gpaipEnabled}
                  onCheckedChange={(v) => set("gpaipEnabled", v)}
                />
              </div>
              {form.gpaipEnabled && (
                <div className="mt-3 max-w-xs">
                  <Field label="GPAIP amount (₹)">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={String(form.gpaipAmount ?? 0)}
                      onChange={(e) => set("gpaipAmount", Math.max(0, Number(e.target.value) || 0))}
                    />
                  </Field>
                </div>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-border/60 bg-background p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">Public Holiday (PH)</div>
                  <Badge
                    className={cn(
                      "border-0 text-[10px] font-semibold uppercase tracking-wide",
                      form.phEnabled
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {form.phEnabled ? `+${form.phMultiplier || 1}` : "Off"}
                  </Badge>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                  Credit extra duty when an employee is present on a public holiday. Absent on the holiday = no credit.
                </p>
              </div>
              <Switch checked={form.phEnabled} onCheckedChange={(v) => set("phEnabled", v)} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {form.phEnabled && (
                <Field label="Extra duty credit on PH">
                  <Select
                    value={String(form.phMultiplier || 1)}
                    onValueChange={(v) => set("phMultiplier", Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(phCodeOptions.length
                        ? Array.from(new Set(phCodeOptions.map((o) => o.value))).sort((a, b) => a - b)
                        : [1, 2]
                      ).map((v) => (
                        <SelectItem key={v} value={String(v)}>
                          +{v} {v === 1 ? "duty" : "duties"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    How many extra duties an employee earns for being present on a public holiday.
                  </p>
                </Field>
              )}
              <Field label="Value of one PH day for attendance/payroll">
                <Select
                  value={form.phDayValue == null ? "default" : String(form.phDayValue)}
                  onValueChange={(v) => set("phDayValue", v === "default" ? null : Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Use Attendance Code setting</SelectItem>
                    {phCodeOptions.map((o) => (
                      <SelectItem key={o.code} value={String(o.value)}>
                        {o.label} ({o.code}) — {o.value} {o.value === 1 ? "duty" : "duties"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  How much each public holiday itself counts toward payable/billable duties. This is separate from the extra-duty credit above. Options come from Control Center → Attendance Code Manager.
                </p>
              </Field>
            </div>

            </div>


            <div className="mt-3 rounded-xl border border-border/60 bg-background p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold">Bonus</div>
                    <Badge
                      className={cn(
                        "border-0 text-[10px] font-semibold uppercase tracking-wide",
                        form.bonusEnabled
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {form.bonusEnabled ? "Applicable" : "Off"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    Statutory / contractual bonus for this unit. Turn on and choose how it is paid out.
                  </p>
                </div>
                <Switch
                  checked={form.bonusEnabled}
                  onCheckedChange={(v) => {
                    set("bonusEnabled", v);
                    if (v && !form.bonusFrequency) set("bonusFrequency", "monthly");
                    if (!v) set("bonusFrequency", null);
                  }}
                />
              </div>
              {form.bonusEnabled && (
                <div className="mt-3 max-w-xs">
                  <Field label="Bonus payout">
                    <Select
                      value={form.bonusFrequency ?? "monthly"}
                      onValueChange={(v) => set("bonusFrequency", v as BonusFrequency)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select payout" />
                      </SelectTrigger>
                      <SelectContent>
                        {BONUS_FREQUENCY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-border/60 bg-background p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold">EPF cap</div>
                    <Badge
                      className={cn(
                        "border-0 text-[10px] font-semibold uppercase tracking-wide",
                        form.epfCapEnabled
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {form.epfCapEnabled ? "Capped" : "No cap"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    Capped: EPF is computed on the ₹15,000 wage ceiling and attendance is limited to the contract payroll days
                    (extra duties must be marked as ED). No cap: EPF is computed on full wages and Present days are not limited
                    by payroll days. Contracts on this unit inherit this setting.
                  </p>
                </div>
                <Switch
                  checked={form.epfCapEnabled}
                  onCheckedChange={(v) => set("epfCapEnabled", v)}
                />
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-border/60 bg-background p-3.5">
              <Field label="ESIC branch (sub-code)">
                <Select
                  value={form.esicBranchId ?? "none"}
                  onValueChange={(v) => set("esicBranchId", v === "none" ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select ESIC branch" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not mapped</SelectItem>
                    {esicBranches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        <span className="font-mono text-xs">{b.esic_code}</span>
                        <span className="ml-2">{b.location}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
                ESIC compliance is grouped by this branch. The sub-code is picked up automatically from the ESIC Branch Manager.
              </p>
            </div>
          </Section>
          </div>



          {/* OTHER */}
          <div className={stepKey === "mapping" ? "block" : "hidden"}>
            <Section title="Mapping">
              <UnitMappingFields value={mapping} onChange={setMapping} />
            </Section>
          </div>
          <div className={stepKey === "review" ? "space-y-5" : "hidden"}>
          <Section title="Other details">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Emergency contact name">
                <Input value={form.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} />
              </Field>
              <Field label="Emergency contact mobile">
                <Input value={form.emergencyContactMobile} onChange={(e) => set("emergencyContactMobile", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" />
              </Field>
              <Field label="Nearby hospital">
                <Input value={form.nearbyHospitalName} onChange={(e) => set("nearbyHospitalName", e.target.value)} />
              </Field>
              <Field label="Hospital mobile">
                <Input value={form.nearbyHospitalMobile} onChange={(e) => set("nearbyHospitalMobile", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" />
              </Field>
              <Field label="Ambulance service">
                <Input value={form.ambulanceName} onChange={(e) => set("ambulanceName", e.target.value)} />
              </Field>
              <Field label="Ambulance mobile">
                <Input value={form.ambulanceMobile} onChange={(e) => set("ambulanceMobile", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" />
              </Field>
              <Field label="Security service">
                <Input value={form.securityServiceName} onChange={(e) => set("securityServiceName", e.target.value)} />
              </Field>
              <Field label="Security mobile">
                <Input value={form.securityServiceMobile} onChange={(e) => set("securityServiceMobile", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" />
              </Field>
            </div>
          </Section>

          {editing && (
            <Section title="Deployment">
              <UnitDeployment
                unitId={editing.id}
                branchId={form.branchId}
                customerId={form.customerId}
                stateName={form.billingState}
              />
            </Section>
          )}
          <Section title="Review">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Client</dt><dd className="mt-1 font-medium">{form.name || "Not entered"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Code</dt><dd className="mt-1 font-mono font-medium">{form.code || "Not entered"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Organization</dt><dd className="mt-1 font-medium">{selectedOrg?.name || "Not selected"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Location</dt><dd className="mt-1 font-medium">{form.location || form.billingCity || "Not entered"}</dd></div>
            </dl>
          </Section>
          </div>

          {error && <p className="text-xs font-medium text-destructive">{error}</p>}

        </div>
        </GuidedForm>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="modern-form-field">
      <Label className="font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="modern-form-toggle">
      <span className="text-sm text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function AddressFields({
  prefix,
  salutation,
  name,
  address1,
  address2,
  pincode,
  city,
  district,
  stateName,
  country,
  onChange,
}: {
  prefix: "billing" | "shipping";
  salutation: string;
  name: string;
  address1: string;
  address2: string;
  pincode: string;
  city: string;
  district: string;
  stateName: string;
  country: string;
  onChange: (patch: Record<string, string>) => void;
}) {
  const k = (suffix: string) => `${prefix}${suffix}`;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Salutation">
        <Select value={salutation} onValueChange={(v) => onChange({ [k("Salutation")]: v })}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>
            {SALUTATIONS.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(e) => onChange({ [k("Name")]: e.target.value })} />
      </Field>
      <Field label="Address line 1">
        <Input value={address1} onChange={(e) => onChange({ [k("Address1")]: e.target.value })} />
      </Field>
      <Field label="Address line 2">
        <Input value={address2} onChange={(e) => onChange({ [k("Address2")]: e.target.value })} />
      </Field>
      <Field label="Pincode">
        <Input value={pincode} onChange={(e) => onChange({ [k("Pincode")]: e.target.value.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" maxLength={6} placeholder="6-digit pincode" />
      </Field>
      <Field label="City">
        <Input value={city} onChange={(e) => onChange({ [k("City")]: e.target.value })} />
      </Field>
      <Field label="District">
        <Input value={district} onChange={(e) => onChange({ [k("District")]: e.target.value })} />
      </Field>
      <Field label="State">
        <Input value={stateName} onChange={(e) => onChange({ [k("State")]: e.target.value })} />
      </Field>
      <Field label="Country">
        <Input value={country} onChange={(e) => onChange({ [k("Country")]: e.target.value })} />
      </Field>
    </div>
  );
}

function ProfessionalTaxBlock({
  enabled,
  onToggle,
  billingPincode,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  billingPincode: string;
}) {
  const { data: ranges } = usePincodeRanges();
  const { data: slabs } = usePtSlabs();

  const result = useMemo(
    () => resolvePt(billingPincode, ranges ?? [], slabs ?? []),
    [billingPincode, ranges, slabs],
  );

  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  const fmtRange = (min: number, max: number | null) =>
    max == null ? `${fmtCurrency(min)} & above` : `${fmtCurrency(min)} – ${fmtCurrency(max)}`;
  const genderLabel = (g: string) =>
    g === "male" ? "Male only" : g === "female" ? "Female only" : "All";

  return (
    <div className="space-y-3">
      <ToggleRow label="Enable Professional Tax" checked={enabled} onCheckedChange={onToggle} />
      {enabled && (
        <div className="rounded-lg border border-border bg-background p-3 text-sm">
          {result.kind === "no_pincode" || result.kind === "invalid" ? (
            <p className="text-muted-foreground">
              Navigate to <span className="font-semibold text-foreground">unit's billing</span> and provide a valid 6-digit pincode to view applicable PT slabs.
            </p>
          ) : result.kind === "no_match" ? (
            <p className="text-muted-foreground">
              No PT slab configured for pincode <span className="font-mono font-semibold text-foreground">{result.pincode}</span>.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-accent/15 px-2.5 py-1 font-semibold text-accent">
                  {result.state}
                </span>
                <span className="rounded-full bg-secondary px-2.5 py-1 font-semibold text-foreground">
                  {result.regionLabel}
                </span>
                <span className="font-mono text-muted-foreground">PIN {result.pincode}</span>
              </div>
              {result.slabs.length === 0 ? (
                <p className="text-muted-foreground">No slab rows defined for this region.</p>
              ) : (
                <div className="overflow-x-clip">
                  <table className="ios-table w-full text-xs">
                    <thead className="bg-secondary/60 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Salary range</th>
                        <th className="px-3 py-2">Gender</th>
                        <th className="px-3 py-2 text-right">Tax / month</th>
                        <th className="px-3 py-2">Period</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {result.slabs.map((s) => (
                        <tr key={s.id}>
                          <td className="px-3 py-2 font-medium text-foreground">{fmtRange(Number(s.salary_min), s.salary_max == null ? null : Number(s.salary_max))}</td>
                          <td className="px-3 py-2 text-muted-foreground">{genderLabel(s.gender)}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-foreground">{fmtCurrency(Number(s.tax_per_month))}</td>
                          <td className="px-3 py-2 text-muted-foreground">{s.period}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LwfBlock({
  enabled,
  onToggle,
  billingPincode,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  billingPincode: string;
}) {
  const { data: ranges } = usePincodeRanges();
  const { data: lwfRows } = useLwfRows();

  const result = useMemo(
    () => resolveLwf(billingPincode, ranges ?? [], lwfRows ?? []),
    [billingPincode, ranges, lwfRows],
  );

  const fmtAmount = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
  const freqLabel = (f: string) =>
    f === "monthly" ? "Monthly"
      : f === "quarterly" ? "Quarterly"
      : f === "half-yearly" ? "Half-yearly (twice a year)"
      : "Yearly";

  return (
    <div className="space-y-3">
      <ToggleRow label="Enable LWF" checked={enabled} onCheckedChange={onToggle} />
      {enabled && (
        <div className="rounded-lg border border-border bg-background p-3 text-sm">
          {result.kind === "no_pincode" || result.kind === "invalid" ? (
            <p className="text-muted-foreground">
              Navigate to <span className="font-semibold text-foreground">unit's billing</span> and provide a valid 6-digit pincode to view applicable LWF.
            </p>
          ) : result.kind === "no_state" ? (
            <p className="text-muted-foreground">
              Could not resolve a state for pincode <span className="font-mono font-semibold text-foreground">{result.pincode}</span>.
            </p>
          ) : result.kind === "no_lwf" ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-accent/15 px-2.5 py-1 font-semibold text-accent">{result.state}</span>
                <span className="font-mono text-muted-foreground">PIN {result.pincode}</span>
              </div>
              <p className="text-muted-foreground">No LWF configured for this state.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-accent/15 px-2.5 py-1 font-semibold text-accent">{result.state}</span>
                <span className="font-mono text-muted-foreground">PIN {result.pincode}</span>
                {!result.lwf.enabled && (
                  <span className="rounded-full bg-destructive/15 px-2.5 py-1 font-semibold text-destructive">Disabled in registry</span>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-border p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Frequency</div>
                  <div className="text-sm font-semibold text-foreground">{freqLabel(result.lwf.frequency)}</div>
                </div>
                <div className="rounded-md border border-border p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Deduction months</div>
                  <div className="text-sm font-semibold text-foreground">
                    {result.lwf.deduction_months.length === 0
                      ? "—"
                      : result.lwf.deduction_months
                          .slice()
                          .sort((a, b) => a - b)
                          .map((m) => MONTH_NAMES[m - 1] ?? m)
                          .join(", ")}
                  </div>
                </div>
                <div className="rounded-md border border-border p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Employee contribution</div>
                  <div className="font-mono text-sm font-semibold text-foreground">{fmtAmount(Number(result.lwf.employee_contribution))}</div>
                </div>
                <div className="rounded-md border border-border p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Employer contribution</div>
                  <div className="font-mono text-sm font-semibold text-foreground">{fmtAmount(Number(result.lwf.employer_contribution))}</div>
                </div>
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 sm:col-span-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">Total per cycle</div>
                  <div className="font-mono text-base font-semibold text-primary">
                    {fmtAmount(Number(result.lwf.employee_contribution) + Number(result.lwf.employer_contribution))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UnitDeployment({
  unitId,
  branchId,
  customerId,
  stateName,
}: {
  unitId: string;
  branchId: string | null;
  customerId: string | null;
  stateName: string;
}) {
  const sa = useScopeAssignments();
  const emp = useEmployeesLite();
  const cu = useCandidateUnits();
  const assignments = sa.data ?? [];
  const employees = emp.data ?? [];
  const candidateUnits = cu.data ?? [];
  const ctx = { id: unitId, branch_id: branchId, customer_id: customerId, state_name: stateName };
  const allFms = resolveFieldOfficersForUnit(ctx, assignments, employees, candidateUnits);
  const guards = resolveGuardsForUnit(ctx, employees, assignments, candidateUnits);
  // Only show field officers actually posted to THIS unit (explicit unit mapping),
  // or who have guards deployed here. Branch/organization/state-wide scopes are
  // access rights, not deployments — they must not populate a brand-new unit's tree.
  const guardManagerIds = new Set(guards.map((g) => g.reports_to).filter(Boolean) as string[]);
  const fms = allFms.filter(({ fm, sources }) => sources.includes("unit") || guardManagerIds.has(fm.id));
  const guardsByMgr = new Map<string, typeof guards>();
  const orphan: typeof guards = [];
  for (const g of guards) {
    const key = g.reports_to ?? "";
    if (key && fms.some((f) => f.fm.id === key)) {
      if (!guardsByMgr.has(key)) guardsByMgr.set(key, []);
      guardsByMgr.get(key)!.push(g);
    } else orphan.push(g);
  }
  if (sa.isLoading || emp.isLoading || cu.isLoading) return <p className="text-xs text-muted-foreground">Loading deployment…</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-border/60 bg-card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tree</div>
        {fms.length === 0 && <p className="text-xs text-muted-foreground">No field officer posted to this unit yet.</p>}
        {fms.map(({ fm, sources }) => (
          <div key={fm.id} className="mb-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">{fm.full_name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{fm.employee_code}</span>
              {sources.map((s) => (<span key={s} className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">via {SCOPE_TYPE_LABEL[s]}</span>))}
            </div>
            <div className="ml-3 mt-1 space-y-1 border-l-2 border-sky-200 pl-3">
              {(guardsByMgr.get(fm.id) ?? []).map((g) => (
                <div key={g.id} className="text-xs">↳ {g.full_name} <span className="font-mono text-muted-foreground">{g.employee_code}</span></div>
              ))}
              {(guardsByMgr.get(fm.id) ?? []).length === 0 && <div className="text-xs text-muted-foreground">No guards reporting yet.</div>}
            </div>
          </div>
        ))}
        {orphan.length > 0 && (
          <div className="mt-2 rounded border border-dashed border-border/60 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Guards without a manager</div>
            {orphan.map((g) => <div key={g.id} className="text-xs">{g.full_name} <span className="font-mono text-muted-foreground">{g.employee_code}</span></div>)}
          </div>
        )}
      </div>
      <div className="rounded-xl border border-border/60 bg-card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Guards deployed ({guards.length})</div>
        {guards.length === 0 && <p className="text-xs text-muted-foreground">No guards deployed to this unit yet.</p>}
        <div className="space-y-1">
          {guards.map((g) => {
            const mgr = employees.find((e) => e.id === g.reports_to);
            return (
              <div key={g.id} className="flex items-center justify-between text-xs">
                <span><span className="font-mono text-[10px] text-muted-foreground">{g.employee_code}</span> {g.full_name}</span>
                <span className="text-muted-foreground">{mgr ? `→ ${mgr.full_name}` : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
