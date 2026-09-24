import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Hash, CalendarHeart, DatabaseZap, FileBadge, BadgeCheck, Briefcase, Building2, Calculator, CalendarCheck, CalendarDays, CalendarRange, ClipboardList, Clock, Coins, FileSignature, FileSpreadsheet, HandCoins, Languages, LogOut, MapPin, Network, Package, Receipt, ReceiptText, Settings, Shield, ShieldCheck, Workflow, TrendingUp, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useCurrentPermissions } from "@/lib/rbac";
import { RBAC_MODULES } from "@/lib/rbac-modules";

export const Route = createFileRoute("/admin/control-center")({
  head: () => ({
    meta: [
      { title: "Control Center | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { name: "description", content: "Manage company settings, operational rules, permissions, and workflows." },
      { property: "og:title", content: "Control Center | PLUS 360 FAHRENHEIT SOLUTIONS" },
      { property: "og:description", content: "Manage company settings, operational rules, permissions, and workflows." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ControlCenterDashboard,
});

type Tile = {
  to: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const tiles: Tile[] = [
  {
    to: "/admin/customers/state-manager",
    label: "States",
    description: "State and statutory details.",
    icon: MapPin,
  },
  {
    to: "/admin/customers/branch-manager",
    label: "Branches",
    description: "Branches and locations.",
    icon: Building2,
  },
  {
    to: "/admin/professional-tax-manager",
    label: "Professional Tax",
    description: "State tax slabs and rates.",
    icon: ReceiptText,
  },
  {
    to: "/admin/lwf-manager",
    label: "Labour Welfare Fund",
    description: "State contribution rules.",
    icon: HandCoins,
  },
  {
    to: "/admin/duty-manager",
    label: "Duty Types",
    description: "Duty hours and shifts.",
    icon: Clock,
  },
  {
    to: "/admin/attendance-code-manager",
    label: "Attendance Codes",
    description: "Daily attendance codes.",
    icon: CalendarCheck,
  },
  {
    to: "/admin/public-holiday-manager",
    label: "Public Holidays",
    description: "Holiday calendar.",
    icon: CalendarHeart,
  },

  {
    to: "/admin/service-type-manager",
    label: "Service Types",
    description: "Security and staffing services.",
    icon: Briefcase,
  },
  {
    to: "/admin/payroll-manager",
    label: "Payroll Cycle",
    description: "Payroll dates and processing day.",
    icon: CalendarRange,
  },
  {
    to: "/admin/payroll-days-manager",
    label: "Payroll Days",
    description: "Salary day rules.",
    icon: CalendarDays,
  },
  {
    to: "/admin/allowance-manager",
    label: "Allowances",
    description: "Payroll earnings.",
    icon: Coins,
  },
  {
    to: "/admin/addition-type-manager",
    label: "Addition Types",
    description: "Bonus and incentive types.",
    icon: TrendingUp,
  },
  {
    to: "/admin/deduction-type-manager",
    label: "Deduction Types",
    description: "Advance and deduction types.",
    icon: TrendingDown,
  },
  {
    to: "/admin/billing-type-manager",
    label: "Billing Types",
    description: "Hours, days and monthly billing.",
    icon: Receipt,
  },
  {
    to: "/admin/designation-manager",
    label: "Designations",
    description: "Employee roles and posts.",
    icon: BadgeCheck,
  },
  {
    to: "/admin/platform-settings",
    label: "Platform Settings",
    description: "Sign-in and app controls.",
    icon: Settings,
  },
  {
    to: "/admin/department-manager",
    label: "Departments",
    description: "Company departments.",
    icon: Network,
  },

  {
    to: "/admin/cost-component-manager",
    label: "Cost Components",
    description: "EPF, ESI, bonus and more.",
    icon: Calculator,
  },
  {
    to: "/admin/ex-service-manager",
    label: "Ex-Service Ranks",
    description: "Service branch and rank.",
    icon: Shield,
  },
  {
    to: "/admin/offboarding-reason-manager",
    label: "Offboarding Reasons",
    description: "Exit reasons.",
    icon: LogOut,
  },
  {
    to: "/admin/esic-branch-manager",
    label: "ESIC Branches",
    description: "Branch codes and zones.",
    icon: Building2,
  },
  {
    to: "/admin/asset-manager",
    label: "Asset Types",
    description: "Uniforms, IDs and devices.",
    icon: Package,
  },
  {
    to: "/admin/language-manager",
    label: "Languages",
    description: "Profile languages.",
    icon: Languages,
  },
  {
    to: "/admin/company-documents",
    label: "Company Documents",
    description: "NDA and appointment templates.",
    icon: FileSignature,
  },
  {
    to: "/admin/policy-manager",
    label: "Policies",
    description: "Insurance and company policies.",
    icon: FileBadge,
  },
  {
    to: "/admin/roles-manager",
    label: "Roles",
    description: "Create and edit roles.",
    icon: ShieldCheck,
  },

  {
    to: "/admin/rbac",
    label: "Access Control",
    description: "Role permissions.",
    icon: ShieldCheck,
  },
  {
    to: "/admin/workflow-manager",
    label: "Workflows",
    description: "Approval steps and roles.",
    icon: Workflow,
  },
  {
    to: "/admin/migration-utility",
    label: "Data Migration",
    description: "Import attendance files.",
    icon: DatabaseZap,
  },
  {
    to: "/admin/org-settings",
    label: "Company Settings",
    description: "Company, tax and bank details.",
    icon: Building2,
  },
  {
    to: "/admin/invoice-numbering",
    label: "Invoice Numbering",
    description: "State-wise series and client codes.",
    icon: Hash,
  },
  {
    to: "/admin/mis-manager",
    label: "MIS Sheets",
    description: "Client-wise MIS formats.",
    icon: FileSpreadsheet,
  },


];

function ControlCenterDashboard() {
  const { can, canSub, isSuperAdmin } = useCurrentPermissions();
  const visibleTiles = tiles.filter((tile) => {
    if (isSuperAdmin) return true;
    if (tile.to === "/admin/rbac") return can("rbac");
    const permission = RBAC_MODULES.flatMap((module) =>
      module.subModules.map((sub) => ({ module: module.key, sub })),
    ).find(({ sub }) => sub.path === tile.to);
    if (permission) return canSub(permission.module, permission.sub.key);
    const module = RBAC_MODULES.find((item) => item.path === tile.to);
    return module ? can(module.key) : false;
  });
  const canViewSystemLogs = isSuperAdmin || canSub("control_center", "system_logs");

  return (
    <div className="space-y-3 sm:space-y-5">
      <div className="relative">
        <PageHeader
          title="Control Center"
          description="App settings and rules."
          crumbs={[{ label: "Control Center" }]}
        />
        {canViewSystemLogs && (
          <Link
            to="/admin/system-logs"
            aria-label="System Logs"
            title="System Logs"
            className="mobile-glass-control group absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card/80 text-foreground/80 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent sm:right-0 sm:top-0 sm:w-auto sm:gap-2 sm:rounded-full sm:px-3 sm:text-xs"
          >
            <Settings className="h-4 w-4 transition-transform group-hover:rotate-45" />
            <span className="hidden sm:inline">System Logs</span>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-4 xl:grid-cols-3">
        {visibleTiles.map((tile) => (
          <Link
            key={tile.to}
            to={tile.to}
            className="group relative grid min-h-[88px] min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-border bg-card p-2.5 transition-colors hover:border-accent/40 hover:bg-accent/5 sm:flex sm:min-h-0 sm:flex-col sm:items-stretch sm:gap-3 sm:p-4"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent sm:h-11 sm:w-11 sm:rounded-xl">
              <tile.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="line-clamp-2 font-display text-[13px] font-medium leading-tight text-foreground sm:text-base">
                {tile.label}
              </div>
              <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{tile.description}</p>
            </div>
            <div className="col-span-2 hidden items-center gap-1 text-xs font-medium text-accent sm:mt-auto sm:inline-flex">
              Open
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
