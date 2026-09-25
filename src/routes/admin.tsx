import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Bell,
  Building2,
  Boxes,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Clock,

  Wallet,
  FileText,
  Files,
  Fuel,
  Gauge,
  Home,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Car,
  CreditCard,
  MapPin,
  Menu,
  PackageOpen,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  UserPlus,
  Users,
  Warehouse,
  Wind,
  Wrench,
  Briefcase,
  Tag,
  UserCheck,
  Moon,
  Sun,
  Radio,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import brandLogoAsset from "@/assets/plus-360-fahrenheit-logo.png.asset.json";
import { MobileBottomNav, type BottomNavItem, type BottomNavMoreItem } from "@/components/MobileBottomNav";
import { useT } from "@/lib/i18n";
import { NotificationBell } from "@/components/NotificationBell";
import { AppleNativeSetupCard } from "@/components/AppleNativeSetupCard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { readStoredAuthUser, useAuth } from "@/lib/auth";
import { useMe } from "@/lib/use-me";
import { useLiveLocationBeacon } from "@/lib/use-live-location-beacon";
import { SaveConfirmGuard } from "@/components/SaveConfirmGuard";
import { useCurrentPermissions } from "@/lib/rbac";
import { RoutePermissionGuard } from "@/components/RoutePermissionGuard";
import { RBAC_MODULES } from "@/lib/rbac-modules";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/lib/use-theme";
import { isNativePlatform } from "@/lib/native";
import { toast } from "sonner";
import { isAdminConsoleRole, isFieldOfficerRole, OPERATIONS_ROLES } from "@/lib/role-keys";




export const Route = createFileRoute("/admin")({
  // The signed-in shell depends on the browser session, so server HTML can only
  // ever be a throwaway guess that React then has to discard and re-render.
  ssr: false,
  component: AdminLayout,
});

type LeafItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  search?: Record<string, unknown>;
  sub?: string; // optional sub-module key for RBAC filtering
  adminOnly?: boolean; // only super admins & inventory managers
};

type GroupItem = {
  key: string;
  label: string;
  sub?: string; // optional sub-module key for RBAC filtering on top-level entries
  icon: React.ComponentType<{ className?: string }>;
  module?: string;
  to?: string;
  children?: LeafItem[];
  activePrefixes?: string[];
  exact?: boolean;
};


const controlCenterChildren: LeafItem[] = [];


const vehiclesChildren: LeafItem[] = [
  { to: "/admin/vehicles/inventory", label: "Vehicle Inventory", icon: Car, sub: "vehicle_inventory" },
  { to: "/admin/vehicles/fastags", label: "FastTag Manager", icon: CreditCard, sub: "fastag_manager" },
  { to: "/admin/vehicles/insurances", label: "Insurance Manager", icon: ShieldCheck, sub: "insurance_manager" },
  { to: "/admin/vehicles/pucs", label: "PUC Manager", icon: Wind, sub: "puc_manager" },
  { to: "/admin/vehicles/service-manager", label: "Service Manager", icon: Wrench, sub: "service_manager" },
  { to: "/admin/vehicles/expense-manager", label: "Expense Manager", icon: Fuel, sub: "expense_manager" },
];

const assetsChildren: LeafItem[] = [
  { to: "/admin/assets/inventory", label: "Asset Inventory", icon: Home, sub: "asset_inventory" },
  { to: "/admin/assets/loan-manager", label: "Loan Manager", icon: Banknote, sub: "loan_manager" },
  { to: "/admin/assets/expense-manager", label: "Expense Manager", icon: Receipt, sub: "expense_manager" },
];

const inventoryChildren: LeafItem[] = [
  { to: "/admin/inventory", label: "Uniform Command Center", icon: LayoutDashboard },
  { to: "/admin/inventory/items", label: "Products", icon: PackageOpen, sub: "item_master" },
  { to: "/admin/inventory/vendors", label: "Vendors", icon: ShoppingBag, sub: "vendors" },
  { to: "/admin/inventory/warehouses", label: "Warehouses", icon: Warehouse, sub: "warehouses" },
  { to: "/admin/inventory/purchase-orders", label: "Purchase Orders", icon: FileText, sub: "purchase_orders" },
  { to: "/admin/inventory/demands", label: "Demands", icon: Inbox, sub: "demands" },
  { to: "/admin/inventory/goods-receipts", label: "Delivery Challans", icon: ClipboardList, sub: "goods_receipts" },
  { to: "/admin/inventory/transfers", label: "Transfers", icon: Boxes, sub: "transfers" },
  { to: "/admin/inventory/issuances", label: "Issuances", icon: UserPlus, sub: "issuances" },
  { to: "/admin/inventory/collections", label: "Collections", icon: Inbox, sub: "collections" },

  { to: "/admin/inventory/stock", label: "Stock Report", icon: Wallet, sub: "stock_report" },
  { to: "/admin/inventory/stock-ledger", label: "Stock Ledger", icon: Banknote, sub: "stock_ledger" },
  { to: "/admin/inventory/rate-cards", label: "Vendor Rate Cards", icon: FileText, sub: "rate_cards" },
  { to: "/admin/inventory/caps", label: "Uniform Cap", icon: Gauge, adminOnly: true },
];




const fieldSenseChildren: LeafItem[] = [
  { to: "/admin/field-sense", label: "Dashboard", icon: LayoutDashboard, sub: "dashboard" },
  { to: "/admin/field-sense/team", label: "Day Patrol", icon: Users, sub: "day_patrol" },
  { to: "/admin/field-sense/expenses", label: "Expense Manager", icon: Wallet, sub: "expense_manager" },
  { to: "/admin/field-sense/reports", label: "Reports", icon: FileText, sub: "reports" },
];



function maskPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  return `+91 ••• ••• ${d.slice(-4)}`;
}
// Derived path→(module,sub) map from the RBAC registry so any sub-module route
// can be gated by canSub without hand-maintaining a duplicate list.
const subPathList: { prefix: string; module: string; sub: string }[] = (() => {
  const list: { prefix: string; module: string; sub: string }[] = [];
  for (const m of RBAC_MODULES) {
    for (const s of m.subModules) {
      if (s.path) list.push({ prefix: s.path, module: m.key, sub: s.key });
    }
  }
  return list.sort((a, b) => b.prefix.length - a.prefix.length);
})();


function AdminLayout() {
  const navigate = useNavigate();
  const { user, logout, isReady } = useAuth();
  const me = useMe();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Live location beacon: streams an on-duty field officer's position from every
  // screen, so Radar viewers see them move in real time.
  useLiveLocationBeacon();
  const { can, canSub, isLoading: permsLoading, isSuperAdmin: isRbacSuperAdmin, roleKey } = useCurrentPermissions();
  // useAuth and RBAC hydrate in separate hook instances. Preserve the explicit
  // authenticated role during that hand-off so the route guard cannot issue a
  // one-way frontline redirect before RBAC catches up.
  const isSuperAdmin = user?.role === "super_admin" || isRbacSuperAdmin;
  // Frontline / FO-onboarded employees (guards, VMS/BMS operators, housekeeping,
  // drivers, etc.) — anyone who is not super admin, not a field officer, and
  // not on an admin-console role. They see only the employee dashboard,
  // their uniform, notifications and their own profile.
  // Users with NO role_key at all (freshly onboarded frontline staff) are
  // treated as frontline too — otherwise they'd land on the admin dashboard
  // with an empty sidebar.
  const isGuardRole =
    !isSuperAdmin &&
    !permsLoading &&
    (!roleKey || !(isAdminConsoleRole(roleKey) || isFieldOfficerRole(roleKey)));

  const dashboardHref =
    isGuardRole
      ? "/admin/employee-dashboard"
      : roleKey === "field_officer" && !isSuperAdmin
        ? "/admin/field-dashboard"
        : "/admin/dashboard";


  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [nativeShell, setNativeShell] = useState(false);
  const { theme, toggle: toggleTheme, mounted: themeMounted } = useTheme();

  useEffect(() => {
    setNativeShell(isNativePlatform());
  }, []);

  // One-time backfill of stored public URLs → signed URLs after buckets were privatized.
  useEffect(() => {
    if (!isSuperAdmin) return;
    const key = "radiant.backfill.signed-urls.v1";
    if (typeof window === "undefined" || window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, "running");
    (async () => {
      try {
        const mod = await import("@/lib/backfill-signed-urls.functions");
        const res = await mod.backfillSignedUrls();
        window.localStorage.setItem(key, JSON.stringify({ done: true, at: Date.now(), res }));
        console.info("[backfill] signed URLs", res);
      } catch (e) {
        window.localStorage.removeItem(key);
        console.error("[backfill] failed", e);
      }
    })();
  }, [isSuperAdmin]);

  const pathToModule: { prefix: string; module: string }[] = [
    { prefix: "/admin/customers", module: "organizations" },
    { prefix: "/admin/contracts", module: "contracts" },
    { prefix: "/admin/employees", module: "employees" },
    { prefix: "/admin/deductions", module: "payroll" },
    { prefix: "/admin/additions", module: "payroll" },
    { prefix: "/admin/deduction-type-manager", module: "control_center" },
    { prefix: "/admin/addition-type-manager", module: "control_center" },
    { prefix: "/admin/vehicles", module: "vehicles" },
    { prefix: "/admin/assets", module: "assets" },
    { prefix: "/admin/inventory", module: "inventory" },
    { prefix: "/admin/attendance", module: "attendance" },
    { prefix: "/admin/payroll", module: "payroll" },
    { prefix: "/admin/invoice", module: "invoice" },
    { prefix: "/admin/rbac", module: "rbac" },
    { prefix: "/admin/control-center", module: "control_center" },
    { prefix: "/admin/professional-tax-manager", module: "control_center" },
    { prefix: "/admin/lwf-manager", module: "control_center" },
    { prefix: "/admin/duty-manager", module: "control_center" },
    { prefix: "/admin/service-type-manager", module: "control_center" },
    { prefix: "/admin/payroll-manager", module: "control_center" },
    { prefix: "/admin/payroll-days-manager", module: "control_center" },
    { prefix: "/admin/allowance-manager", module: "control_center" },
    { prefix: "/admin/billing-type-manager", module: "control_center" },
    { prefix: "/admin/invoice-numbering", module: "control_center" },
    { prefix: "/admin/designation-manager", module: "control_center" },
    { prefix: "/admin/department-manager", module: "control_center" },
    { prefix: "/admin/platform-settings", module: "control_center" },
    { prefix: "/admin/cost-component-manager", module: "control_center" },
    { prefix: "/admin/ex-service-manager", module: "control_center" },
    { prefix: "/admin/offboarding-reason-manager", module: "control_center" },
    { prefix: "/admin/language-manager", module: "control_center" },
    { prefix: "/admin/company-documents", module: "control_center" },
    { prefix: "/admin/policy-manager", module: "control_center" },
    { prefix: "/admin/system-logs", module: "control_center" },
    { prefix: "/admin/asset-manager", module: "control_center" },
    { prefix: "/admin/attendance-code-manager", module: "control_center" },
    { prefix: "/admin/public-holiday-manager", module: "control_center" },
    { prefix: "/admin/esic-branch-manager", module: "control_center" },
    { prefix: "/admin/mis-manager", module: "control_center" },
    { prefix: "/admin/migration-utility", module: "control_center" },
    { prefix: "/admin/org-settings", module: "control_center" },
  ];
  useEffect(() => {
    if (!isReady || permsLoading || !user) return;
    // Re-read the verified login snapshot at effect execution time. An effect
    // queued by the pre-RBAC render must not redirect a restored administrator
    // to the employee dashboard after the correct dashboard navigation.
    if (readStoredAuthUser()?.role === "super_admin") return;
    // Guards have no module-based permissions; restrict them to their personal pages.
    if (isGuardRole) {
      const allowed =
        pathname === "/admin/employee-dashboard" ||
        pathname === "/admin/my-inventory" ||
        pathname === "/admin/profile" ||
        pathname === "/admin/my-attendance" ||
        pathname === "/admin/notifications" ||
        pathname.startsWith("/admin/my-inventory/") ||
        pathname.startsWith("/admin/notifications/");
      if (!allowed) navigate({ to: "/admin/employee-dashboard", replace: true });
      return;

    }
    const hit = pathToModule.find((p) => pathname === p.prefix || pathname.startsWith(p.prefix + "/"));
    if (!hit) return;
    if (hit.module === "inventory" && roleKey === "field_officer" && (
      pathname === "/admin/inventory" ||
      pathname === "/admin/inventory/" ||
      pathname.startsWith("/admin/inventory/demands") ||
      pathname.startsWith("/admin/inventory/goods-receipts") ||
      pathname.startsWith("/admin/inventory/collections") ||
      pathname.startsWith("/admin/inventory/issuances")
    )) {
      return;
    }
    if (!can(hit.module)) {
      // Never hop to an unrelated module: a denied page returns the user to
      // their own dashboard, so a link never appears to open a different tool.
      navigate({ to: dashboardHref, replace: true });
      return;
    }
    // Sub-module gating: enforce canSub for any known sub-module path.
    const subHit = subPathList.find((p) => pathname === p.prefix || pathname.startsWith(p.prefix + "/"));
    if (subHit) {
      if (subHit.module === "inventory" && ["demands", "goods_receipts", "collections", "issuances"].includes(subHit.sub) && roleKey === "field_officer") return;
      if (!canSub(subHit.module, subHit.sub)) {
        // Return to the actual module hub. Never choose the first child route,
        // which previously sent denied Control Center links to Deduction Types.
        const modulePath = RBAC_MODULES.find((m) => m.key === subHit.module)?.path;
        const dest = modulePath && can(subHit.module) ? modulePath : dashboardHref;
        navigate({ to: dest, replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, permsLoading, isSuperAdmin, isReady, roleKey]);


  useEffect(() => {
    if (!isReady) return;
    if (!user) navigate({ to: "/login", replace: true });
  }, [user, isReady, navigate]);

  // Offboarding gate: if a signed-in employee is deactivated, sign them out.
  useEffect(() => {
    if (!isReady || !user || isSuperAdmin) return;
    let alive = true;
    let strikes = 0;
    const check = async () => {
      try {
        const { data } = await supabase.rpc("is_current_employee_active" as never);
        if (!alive) return;
        if (data === false) {
          // Two consecutive definite "disabled" answers before signing out, so a
          // single flaky call can never log an active user out.
          strikes += 1;
          if (strikes < 2) return;
          toast.error("Your access has been disabled. Signing you out.");
          logout();
        } else if (data === true) {
          strikes = 0;
        }
      } catch { /* ignore transient */ }
    };
    void check();
    const t = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [isReady, user, isSuperAdmin, logout]);

  // A fresh sign-in may leave anonymous query results in cache. Clear those
  // once after sign-in, but never invalidate the entire application on token
  // refresh/initial-session events: that refetched the very large payroll
  // computation and every supporting query together, causing screen-wide
  // reflow and flicker while users were reading the register.
  const queryClient = useQueryClient();
  useEffect(() => {
    // supabase-js re-emits SIGNED_IN on token refresh and when the tab regains
    // focus. Invalidating everything on those events blanked the whole screen
    // (payroll register included). Only wipe the cache when the signed-in
    // identity actually changes.
    let lastUserId: string | null = null;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextId = session?.user?.id ?? null;
      if (event === "SIGNED_OUT") {
        lastUserId = null;
        queryClient.clear();
        return;
      }
      if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") return;
      if (!nextId || nextId === lastUserId) return;
      const isFirstObservation = lastUserId === null;
      lastUserId = nextId;
      if (isFirstObservation) return;
      queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);


  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function handleLogout() {
    logout();
    navigate({ to: "/login", replace: true });
  }

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");
  const isFieldOfficer = !isSuperAdmin && roleKey === "field_officer";

  const groups: GroupItem[] = useMemo(
    () => [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, to: dashboardHref, activePrefixes: ["/admin/dashboard", "/admin/field-dashboard"] },
      { key: "org-manager", label: "Organizations", module: "organizations", sub: "organization_manager", icon: Users, to: "/admin/customers/customer-manager", activePrefixes: ["/admin/customers/customer-manager"] },
      { key: "unit-manager", label: "Clients", module: "organizations", sub: "unit_manager", icon: Warehouse, to: "/admin/customers/unit-manager", activePrefixes: ["/admin/customers/unit-manager"] },
      { key: "contracts", label: "Contracts", module: "contracts", icon: Files, to: "/admin/contracts/client-contracts", activePrefixes: ["/admin/contracts"] },
      { key: "employees", label: isFieldOfficer ? "Candidates" : "Employees", module: "employees", icon: UserPlus, to: "/admin/employees", activePrefixes: ["/admin/employees"] },

      { key: "attendance", label: "Attendance", module: "attendance", icon: ClipboardList, to: "/admin/attendance", activePrefixes: ["/admin/attendance"] },
      { key: "payroll", label: "Payroll", module: "payroll", icon: Wallet, to: "/admin/payroll", activePrefixes: ["/admin/payroll", "/admin/additions", "/admin/deductions"] },
      { key: "invoice", label: "Invoice", module: "invoice", icon: CreditCard, to: "/admin/invoice", activePrefixes: ["/admin/invoice"] },
      { key: "inventory", label: "Uniform Manager", module: "inventory", icon: Boxes, children: inventoryChildren, activePrefixes: ["/admin/inventory"] },
      { key: "field-sense", label: "Radar", icon: Radio, children: fieldSenseChildren, activePrefixes: ["/admin/field-sense"], module: "field_sense" },
      { key: "vehicles", label: "Vehicles", module: "vehicles", icon: Car, to: "/admin/vehicles", children: vehiclesChildren, activePrefixes: ["/admin/vehicles"] },
      { key: "assets", label: "Assets", module: "assets", icon: Home, to: "/admin/assets", children: assetsChildren, activePrefixes: ["/admin/assets"] },
      
      { key: "compliance", label: "Compliance", icon: ShieldCheck, to: "/admin/compliance", activePrefixes: ["/admin/compliance"] },
      { key: "control", label: "Control Center", module: "control_center", icon: SlidersHorizontal, to: "/admin/control-center", children: controlCenterChildren, activePrefixes: ["/admin/control-center", "/admin/customers/state-manager", "/admin/customers/branch-manager"] },
    ],
    [dashboardHref, isFieldOfficer],
  );

  const isInventoryOnly =
    !isSuperAdmin &&
    can("inventory") &&
    !can("organizations") &&
    !can("contracts") &&
    !can("employees") &&
    !can("vehicles") &&
    !can("assets") &&
    !can("attendance") &&
    !can("payroll") &&
    !can("invoice");
  const filteredInventoryChildren = useMemo(
    () => {
      const isFO = roleKey === "field_officer";
      const isInvAdmin = isSuperAdmin || roleKey === "inventory_manager" || roleKey === "inventory";
      const visibleInventoryChildren = inventoryChildren.filter((c) => c.to !== "/admin/inventory/collections" || isFO);
      if (isSuperAdmin) return visibleInventoryChildren.filter((c) => !c.adminOnly || isInvAdmin);
      const list = inventoryChildren.filter((c) => {
        if (c.adminOnly) return isInvAdmin;
        // These are field-officer workflows — bypass sub-permission gating for FOs.
        if (isFO && [
          "/admin/inventory",
          "/admin/inventory/demands",
          "/admin/inventory/goods-receipts",
          "/admin/inventory/collections",
          "/admin/inventory/issuances",
        ].includes(c.to)) return true;
        return !c.sub || canSub("inventory", c.sub);
      });
      if (isFO) return list.filter((c) => [
        "/admin/inventory",
        "/admin/inventory/demands",
        "/admin/inventory/goods-receipts",
        "/admin/inventory/issuances",
        "/admin/inventory/collections",
      ].includes(c.to));
      return list;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSuperAdmin, permsLoading, roleKey],
  );

  const isGuard = isGuardRole;
  const guardGroups: GroupItem[] = useMemo(() => [
    { key: "dashboard", label: "My Dashboard", icon: LayoutGrid, to: "/admin/employee-dashboard", activePrefixes: ["/admin/employee-dashboard"] },
    { key: "my-inventory", label: "My Uniform", icon: Boxes, to: "/admin/my-inventory", activePrefixes: ["/admin/my-inventory"] },
    { key: "my-attendance", label: "My Attendance", icon: Clock, to: "/admin/my-attendance", activePrefixes: ["/admin/my-attendance"] },
  ], []);

  const visibleGroups = (() => {
    if (isGuard) return guardGroups;
    if (isInventoryOnly) {
      return filteredInventoryChildren.map<GroupItem>((c, idx) => ({
        key: c.to,
        label: c.label,
        icon: c.icon,
        to: c.to,
        activePrefixes: [c.to],
        exact: idx === 0,
      }));
    }
    const base = groups
      .filter((g) => {
        if (g.key === "field-sense") {
          // Field officers use the site visit workflow without the Radar map.
          // Other roles need RBAC access to the field_sense module and map.
          return isFieldOfficer || isSuperAdmin || can("field_sense");
        }
        // Leadership-only analytics surfaces — hidden from field officers and
        // the operations team (their scope is sites, visits and deployments).
        if (g.key === "compliance") {
          if (isFieldOfficer || (roleKey && OPERATIONS_ROLES.has(roleKey))) return false;
          return isSuperAdmin || can("contracts") || can("employees");
        }
        // Client/organization masters are leadership surfaces — never for field officers.
        if (g.key === "org-manager" || g.key === "unit-manager") {
          if (isFieldOfficer) return false;
        }
        if (g.key === "inventory" && isFieldOfficer) return true;
        if (!g.module) return true;
        if (!can(g.module)) return false;
        if (g.sub && !canSub(g.module, g.sub)) return false;
        return true;
      })
      .map((g) => {
        if (g.key === "inventory") return { ...g, children: filteredInventoryChildren };
        if (g.key === "field-sense" && g.children) {
          let kids = g.children;
          if (isFieldOfficer) {
            // FOs only see the Day Patrol dashboard — no Team/Expenses/Reports.
            kids = kids
              .filter((c) => c.to === "/admin/field-sense")
              .map((c) => ({ ...c, label: "Site Visits" }));
          } else if (!isSuperAdmin) {
            kids = kids.filter((c) => !c.sub || canSub("field_sense", c.sub));
          }
          return { ...g, children: kids };
        }
        if (!g.module || !g.children) return g;
        // Control Center hosts the State/Branch managers — their subs live under the organizations module.
        const subModule = g.key === "control" ? "organizations" : g.module!;
        const filtered = g.children.filter((c) => !c.sub || canSub(subModule, c.sub));
        return { ...g, children: filtered };
      });

    if (isFieldOfficer) {
      // FO gets a single dashboard entry that already shows their units and team.
      return base;
    }
    return base;
  })();


  const isGroupActive = (g: GroupItem) =>
    (g.activePrefixes ?? []).some((p) => {
      if (g.exact) return pathname === p;
      return pathname === p || pathname.startsWith(p + "/");
    });

  const sidebarWidth = collapsed ? "lg:w-[72px]" : "lg:w-[244px]";
  const mainOffset = nativeShell ? "" : collapsed ? "lg:ml-24" : "lg:ml-[260px]";

  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={100}>
    <div className={cn(
      "relative flex min-h-[100dvh] min-w-0 flex-col lg:block lg:min-h-screen",
      (isFieldOfficer || isGuard) && "bg-white dark:bg-neutral-950",
    )}>
      <AppleNativeSetupCard autoStart nativeOnly className="hidden" />
      {/* Soft tinted canvas — clean glass backdrop, no grid */}
      {!isFieldOfficer && !isGuard && <div className="pointer-events-none fixed inset-0 z-0 app-canvas" />}





      {/* Desktop vertical sidebar — glass / iPadOS */}
      <aside
        className={cn(
          "fixed inset-y-3 left-3 z-30 hidden flex-col rounded-[26px] border border-white/10 bg-black text-white shadow-[0_18px_50px_-20px_rgba(0,0,0,0.65)] transition-[width] duration-300 lg:flex animate-slide-in-left",
          nativeShell && "lg:hidden",
          sidebarWidth,
        )}
      >
        {/* Brand */}
        <div className={cn("flex items-center px-4 pt-5 pb-4", collapsed && "justify-center px-2")}>
          {collapsed ? (
            <Link
              to={dashboardHref}
              aria-label="Dashboard"
              className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-white p-1.5 shadow-[0_10px_28px_-10px_rgba(0,0,0,0.65)]"
            >
              <img src={brandLogoAsset.url} alt="PLUS 360" className="h-full w-full object-contain" />
            </Link>
          ) : (
            <Link to={dashboardHref} className="flex min-w-0 items-center">
              <BrandMark className="[&_.font-display]:text-white [&_.tracking-\[0\.2em\]]:text-white/50" />
            </Link>
          )}
        </div>

        {/* Nav — grouped like the reference portal (Menu / Operations / Finance / Admin) */}
        <nav className={cn("scrollbar-hide flex-1 overflow-y-auto pb-3", collapsed ? "px-2" : "px-2.5")}>
          {(() => {
            const sections: Array<{ label: string; keys: string[] }> = [
              { label: "Menu", keys: ["dashboard", "my-inventory", "my-attendance"] },
              { label: "Operations", keys: ["org-manager", "unit-manager", "contracts", "inventory", "vehicles", "assets"] },
              { label: "HR", keys: ["employees", "attendance", "payroll"] },
              { label: "Finance", keys: ["invoice"] },
              { label: "Surveillance", keys: ["field-sense"] },
              { label: "Compliance", keys: ["compliance"] },
              { label: "Admin", keys: ["control"] },
            ];
            const used = new Set<string>();
            return (
              <div className={collapsed ? "space-y-1.5" : "space-y-3"}>
                {sections.map((s) => {
                  const items = visibleGroups.filter((g) => s.keys.includes(g.key));
                  if (items.length === 0) return null;
                  items.forEach((g) => used.add(g.key));
                  return (
                    <div key={s.label} className="space-y-[3px]">
                      {!collapsed && s.label && (
                        <div className="px-2.5 pt-1 pb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">
                          {s.label}
                        </div>
                      )}
                      {items.map((g) => (
                        <SidebarGroup key={g.key} group={g} collapsed={collapsed} isActive={isActive} groupActive={isGroupActive(g)} />
                      ))}
                    </div>
                  );
                })}
                {(() => {
                  const rest = visibleGroups.filter((g) => !used.has(g.key));
                  if (rest.length === 0) return null;
                  return (
                    <div className="space-y-[3px]">
                      {!collapsed && (
                        <div className="px-2.5 pt-1 pb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">More</div>
                      )}
                      {rest.map((g) => (
                        <SidebarGroup key={g.key} group={g} collapsed={collapsed} isActive={isActive} groupActive={isGroupActive(g)} />
                      ))}
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </nav>

        {/* Footer: user + collapse */}
        <div className="border-t border-white/10 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.06] p-2 text-sm font-semibold text-white transition hover:bg-white/10",
                  collapsed && "mx-auto h-11 w-11 justify-center rounded-full border-0 bg-transparent p-0 hover:bg-white/10",
                )}
              >
                <span className={cn(
                  "relative grid shrink-0 place-items-center overflow-hidden bg-white text-black text-[11px] font-bold",
                  collapsed ? "h-11 w-11 rounded-full ring-1 ring-white/15" : "h-9 w-9 rounded-xl",
                )}>
                  {me.photoUrl ? (
                    <img src={me.photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-center" />
                  ) : (
                    me.initials
                  )}
                </span>
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[13px] font-semibold leading-tight">
                        {me.fullName || (user?.phone ? maskPhone(user.phone) : "Account")}
                      </span>
                      {me.designation && (
                        <span className="block truncate text-[11px] font-medium capitalize text-white/50">
                          {me.designation}
                        </span>
                      )}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="right" sideOffset={10} className="w-60 rounded-2xl">
              <DropdownMenuLabel>
                <div className="text-sm font-semibold">
                  {me.fullName || (user?.phone ? maskPhone(user.phone) : "Account")}
                </div>
                <div className="text-xs text-muted-foreground capitalize">
                  {me.designation || user?.role?.replace("_", " ")}
                </div>
                {user?.phone && (
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">
                    {maskPhone(user.phone)}
                  </div>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/admin/profile" className="flex items-center gap-2">
                  <Users className="h-4 w-4" /> My Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/admin/my-attendance" className="flex items-center gap-2">
                  <Clock className="h-4 w-4" /> My Attendance
                </Link>
              </DropdownMenuItem>

              <DropdownMenuItem asChild>
                <Link to="/admin/notifications" className="flex items-center gap-2">
                  <Bell className="h-4 w-4" /> Notifications
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleTheme} className="gap-2">
                {themeMounted && theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
                {themeMounted && theme === "dark" ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div
            className={cn(
              "mt-2 flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-2 py-1.5",
              collapsed && "mt-1.5 justify-center border-0 bg-transparent p-0",
            )}
          >
            <NotificationBell triggerClassName="relative inline-flex h-11 w-11 shrink-0 aspect-square items-center justify-center rounded-full text-white/70 outline-none transition-colors focus-visible:outline-none hover:bg-white/[0.08] hover:text-white" />
            {!collapsed && (
              <span className="flex-1 truncate text-[12px] font-semibold text-white">
                Notifications
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={cn(
              "mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px] font-semibold text-white/50 hover:bg-white/10 hover:text-white",
              collapsed && "mx-auto mt-1.5 h-11 w-11 rounded-full p-0",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight className="h-[18px] w-[18px]" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
          </button>

        </div>
      </aside>

      {/* Mobile top bar — compact native-app chrome */}
      <header data-app-header className={cn(
        "sticky top-0 z-20 grid min-h-[48px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1 animate-slide-in-top safe-top safe-x",
        "border-b border-border/50 bg-card/90 backdrop-blur-2xl",
        !nativeShell && "lg:hidden",
      )}>
        <Link to={dashboardHref} className="flex min-w-0 items-center gap-2">
          <div className="relative shrink-0">
            <img src={brandLogoAsset.url} alt="PLUS 360" className="h-7 w-10 object-contain" />
          </div>
          <div className="truncate text-[14px] font-semibold leading-tight text-foreground">PLUS 360</div>
        </Link>
        <div className="flex shrink-0 items-center">
          <NotificationBell />
          <Link
            to="/admin/profile"
            aria-label="Profile"
            className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground outline-none transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/15"
          >
            {me.photoUrl ? (
              <img
                src={me.photoUrl}
                alt={me.fullName || "Profile"}
                className="absolute inset-1.5 h-8 w-8 rounded-full object-cover object-center ring-1 ring-border/60"
              />
            ) : (
              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent/10 text-[12px] font-bold ring-1 ring-border/60">{me.initials || "U"}</span>
            )}
          </Link>
        </div>
      </header>





      {/* Main */}
      <main data-admin-scroll className={cn("relative z-10 min-h-0 min-w-0 flex-1 overflow-y-visible safe-x py-2 !pb-[calc(82px+env(safe-area-inset-bottom))] transition-[margin] duration-300 sm:px-6 sm:py-6 lg:min-h-[calc(100dvh-3.5rem)] lg:py-8 lg:pr-6 lg:!pb-8", mainOffset)}>


        <div className="mx-auto min-w-0 max-w-[1500px]">
          <div
            key={pathname}
            className={cn(!pathname.startsWith("/admin/payroll/") && "page-enter")}
          >
            {isReady && user && !permsLoading ? (
              <RoutePermissionGuard>
                <SaveConfirmGuard />
                <Outlet />
              </RoutePermissionGuard>
            ) : (
              <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/70" />
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Mobile bottom tab bar — primary destinations + More opens full drawer */}
      {(() => {
        const bottomItems: BottomNavItem[] = (() => {
          if (isGuard) {
            const guardBottomKeys = ["dashboard", "my-inventory", "my-attendance"];
            return guardGroups
              .filter((g) => guardBottomKeys.includes(g.key))
              .sort((a, b) => guardBottomKeys.indexOf(a.key) - guardBottomKeys.indexOf(b.key))
              .map((g) => ({
                key: g.key,
                label: g.label.replace(/^My\s+/i, ""),
                icon: g.icon,
                to: g.to,
                active: isGroupActive(g),
              }));
          }
          // Build primary destinations in priority order, filtered by permissions.
          // FO gets exactly 3 tiles (Dashboard, Site Visits, Candidates) + More.
          const priorityKeys = isFieldOfficer
            ? ["dashboard", "field-sense", "employees"]
            : ["dashboard", "employees", "attendance", "payroll", "invoice", "inventory", "organizations"];
          const cap = isFieldOfficer ? 3 : 4;
          const byKey = new Map(visibleGroups.map((g) => [g.key, g]));
          const picked: GroupItem[] = [];
          for (const k of priorityKeys) {
            const g = byKey.get(k);
            if (g && picked.length < cap) picked.push(g);
          }
          // Fallback: fill from remaining visibleGroups (skipped for FO to keep exactly 3)
          if (!isFieldOfficer) {
            for (const g of visibleGroups) {
              if (picked.length >= cap) break;
              if (!picked.find((p) => p.key === g.key)) picked.push(g);
            }
          }

          return picked.map((g) => ({
            key: g.key,
            label: g.label,
            icon: g.icon,
            to: g.to ?? g.children?.[0]?.to,
            active: isGroupActive(g),
          }));
        })();
        const moreItems: BottomNavMoreItem[] = isFieldOfficer
          ? [
              { key: "fo-dashboard", to: "/admin/field-dashboard", label: "Dashboard", icon: LayoutDashboard, active: isActive("/admin/field-dashboard") },
              { key: "fo-candidates", to: "/admin/employees", label: "Candidates", icon: UserPlus, active: isActive("/admin/employees") },
              { key: "fo-attendance", to: "/admin/attendance", label: "Attendance", icon: ClipboardList, active: isActive("/admin/attendance") },
               { key: "fo-radar", to: "/admin/field-sense", label: "Site Visits", icon: MapPin, active: isActive("/admin/field-sense") },
              { key: "fo-uniform", to: "/admin/inventory", label: "Uniform", icon: Boxes, active: isActive("/admin/inventory") },
              { key: "fo-my-attendance", to: "/admin/my-attendance", label: "My Attendance", icon: Clock, active: isActive("/admin/my-attendance") },
            ]
          : visibleGroups.flatMap((g) => {
              const to = g.to ?? g.children?.[0]?.to;
              return to ? [{ key: g.key, to, label: g.label, icon: g.icon, active: isGroupActive(g) }] : [];
            });
        const addMoreItem = (item: BottomNavMoreItem) => {
          if (!moreItems.some((entry) => entry.to === item.to)) moreItems.push(item);
        };
        if (!isGuard) addMoreItem({ key: "profile", to: "/admin/profile", label: "My Profile", icon: Users, active: isActive("/admin/profile") });
        if (!moreItems.some((entry) => entry.to === "/admin/my-attendance" || entry.to === "/admin/attendance")) {
          addMoreItem({ key: "my-attendance", to: "/admin/my-attendance", label: "My Attendance", icon: Clock, active: isActive("/admin/my-attendance") });
        }
        if (!isGuard) addMoreItem({ key: "notifications", to: "/admin/notifications", label: "Notifications", icon: Bell, active: isActive("/admin/notifications") });
        return (
          <MobileBottomNav
            items={bottomItems}
            onMore={() => setMobileOpen((open) => !open)}
            moreActive={mobileOpen}
            hideMore={isGuard}
            moreItems={moreItems}
          />
        );
      })()}
    </div>
    </TooltipProvider>
  );
}

function SidebarGroup({
  group,
  collapsed,
  isActive,
  groupActive,
}: {
  group: GroupItem;
  collapsed: boolean;
  isActive: (p: string) => boolean;
  groupActive: boolean;
}) {
  const [open, setOpen] = useState(groupActive);
  const Icon = group.icon;
  const t = useT();

  useEffect(() => {
    if (groupActive) setOpen(true);
  }, [groupActive]);

  const itemBase =
    "group relative flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2 text-[13px] font-medium transition-all";
  const itemIdle = "text-white/60 hover:bg-white/[0.07] hover:text-white";
  const itemActive =
    "bg-white text-black shadow-[0_10px_28px_-14px_rgba(0,0,0,0.6)]";

  const iconSpanBase = "grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors";
  const iconSpanActive = "bg-black/10 text-black";
  const iconSpanIdle = "text-white/55 group-hover:text-white";
  // Collapsed rail: item is a perfect circle, active state is a solid white circle
  const collapsedItem = "h-11 w-11 mx-auto justify-center rounded-full p-0";
  const collapsedIcon =
    "grid h-11 w-11 place-items-center rounded-full transition-all duration-200";
  const collapsedIconActive =
    "bg-white text-black shadow-[0_10px_28px_-10px_rgba(0,0,0,0.65)]";
  const collapsedIconIdle =
    "text-white/55 hover:bg-white/[0.08] hover:text-white";

  if (!group.children || group.children.length === 0) {
    const link = (
      <Link
        to={group.to!}
        aria-label={collapsed ? group.label : undefined}
        data-no-tip
        className={
          collapsed
            ? cn(collapsedIcon, "mx-auto", groupActive ? collapsedIconActive : collapsedIconIdle)
            : cn(itemBase, groupActive ? itemActive : itemIdle)
        }
      >
        {collapsed ? (
          <Icon className="h-[18px] w-[18px]" />
        ) : (
          <>
            <span className={cn(iconSpanBase, groupActive ? iconSpanActive : iconSpanIdle)}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="truncate">{t(group.label)}</span>
          </>
        )}
      </Link>
    );
    if (!collapsed) return link;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={10} className="font-medium">
          {t(group.label)}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (collapsed) {
    return (
      <CollapsedGroupPopover
        group={group}
        groupActive={groupActive}
        isActive={isActive}
        itemBase={itemBase}
        itemIdle={itemIdle}
        itemActive={itemActive}
        iconSpanBase={iconSpanBase}
        iconSpanIdle={iconSpanIdle}
        iconSpanActive={iconSpanActive}
        Icon={Icon}
      />
    );
  }

  return (
    <div>
      {group.to ? (
        <div className={cn(itemBase, "gap-1 pr-1", groupActive ? itemActive : itemIdle)}>
          <Link
            to={group.to}
            className="flex flex-1 items-center gap-2.5 min-w-0"
          >
            <span className={cn(iconSpanBase, groupActive ? iconSpanActive : iconSpanIdle)}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="flex-1 truncate text-left">{t(group.label)}</span>
          </Link>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
            aria-label={open ? "Collapse" : "Expand"}
            className="grid h-6 w-6 place-items-center rounded-md hover:bg-white/10"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 opacity-60 transition-transform", open ? "rotate-0" : "-rotate-90")} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(itemBase, groupActive ? itemActive : itemIdle)}
        >
          <span className={cn(iconSpanBase, groupActive ? iconSpanActive : iconSpanIdle)}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="flex-1 truncate text-left">{t(group.label)}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 opacity-50 transition-transform", open ? "rotate-0" : "-rotate-90")} />
        </button>
      )}
      {open && (
        <div className="mt-0.5 ml-[22px] space-y-0.5 border-l border-white/10 pl-3">
          {group.children.map((c) => {
            const a = isActive(c.to);
            return (
              <Link
                key={c.to}
                to={c.to}
                search={c.search as never}
                className={cn(
                  "relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
                  a
                    ? "bg-white text-black font-semibold"
                    : "text-white/55 hover:bg-white/[0.06] hover:text-white",
                )}
              >
                <c.icon className="h-3.5 w-3.5 opacity-70" />
                <span className="truncate">{t(c.label)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MobileGroup({
  group,
  isActive,
  isGroupActive,
}: {
  group: GroupItem;
  isActive: (p: string) => boolean;
  isGroupActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Icon = group.icon;
  const t = useT();
  if (!group.children || group.children.length === 0) {
    return (
      <Link
        to={group.to!}
        className={cn(
          "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
          isGroupActive
            ? "bg-[color-mix(in_oklab,var(--accent)_12%,white)] text-accent ring-1 ring-[color-mix(in_oklab,var(--accent)_30%,transparent)]"
            : "text-foreground hover:bg-accent/10 hover:text-accent",
        )}
      >
        <Icon className="h-4 w-4" />
        {t(group.label)}
      </Link>
    );
  }
  return (
    <div>
      {group.to ? (
        <div
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
            isGroupActive
              ? "bg-[color-mix(in_oklab,var(--accent)_12%,white)] text-accent ring-1 ring-[color-mix(in_oklab,var(--accent)_30%,transparent)]"
              : "text-foreground hover:bg-accent/10 hover:text-accent",
          )}
        >
          <Link to={group.to} className="flex flex-1 items-center gap-2.5 min-w-0">
            <Icon className="h-4 w-4" />
            <span className="flex-1 truncate text-left">{t(group.label)}</span>
          </Link>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
            aria-label={open ? "Collapse" : "Expand"}
            className="grid h-7 w-7 place-items-center rounded-md hover:bg-foreground/10"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open ? "rotate-0" : "-rotate-90")} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
            isGroupActive
              ? "bg-[color-mix(in_oklab,var(--accent)_12%,white)] text-accent ring-1 ring-[color-mix(in_oklab,var(--accent)_30%,transparent)]"
              : "text-foreground hover:bg-accent/10 hover:text-accent",
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="flex-1 text-left">{t(group.label)}</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", open ? "rotate-0" : "-rotate-90")} />
        </button>
      )}
      {open && (
        <div className="mt-1 space-y-0.5 pl-4">
          {group.children.map((c) => {
            const a = isActive(c.to);
            return (
              <Link
                key={c.to}
                to={c.to}
                search={c.search as never}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                  a
                    ? "bg-[color-mix(in_oklab,var(--accent)_10%,white)] text-accent ring-1 ring-[color-mix(in_oklab,var(--accent)_25%,transparent)]"
                    : "text-foreground/80 hover:bg-accent/10 hover:text-accent",
                )}
              >
                <c.icon className="h-4 w-4 opacity-80" />
                <span className="truncate">{t(c.label)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CollapsedGroupPopover({
  group,
  groupActive,
  isActive,
  itemBase,
  itemIdle,
  itemActive,
  iconSpanBase,
  iconSpanIdle,
  iconSpanActive,
  Icon,
}: {
  group: GroupItem;
  groupActive: boolean;
  isActive: (p: string) => boolean;
  itemBase: string;
  itemIdle: string;
  itemActive: string;
  iconSpanBase: string;
  iconSpanIdle: string;
  iconSpanActive: string;
  Icon: GroupItem["icon"];
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t(group.label)}
          aria-expanded={open}
          onMouseEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onMouseLeave={scheduleClose}
          onFocus={() => {
            cancelClose();
            setOpen(true);
          }}
          onBlur={scheduleClose}
          className={cn(
            "mx-auto grid h-11 w-11 place-items-center rounded-full transition-all duration-200",
            groupActive
              ? "bg-white text-black shadow-[0_10px_28px_-10px_rgba(0,0,0,0.65)]"
              : "text-white/55 hover:bg-white/[0.08] hover:text-white",
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </button>
      </PopoverTrigger>
      {group.children && (
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-60 rounded-2xl border border-border/50 bg-card/95 p-2 shadow-2xl backdrop-blur-xl"
        >
          <div className="mb-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            {t(group.label)}
          </div>
          <div className="space-y-0.5">
            {group.children.map((c) => {
              const a = isActive(c.to);
              return (
                <Link
                  key={c.to}
                  to={c.to}
                  search={c.search as never}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                    a
                      ? "bg-accent/10 text-accent"
                      : "text-foreground/80 hover:bg-accent/10 hover:text-accent",
                  )}
                >
                  <c.icon className="h-4 w-4" />
                  <span className="truncate">{t(c.label)}</span>
                </Link>
              );
            })}
          </div>
        </PopoverContent>
      )}
    </Popover>

  );
}
