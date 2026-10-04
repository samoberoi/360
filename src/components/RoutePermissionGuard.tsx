import { useMemo } from "react";
import { useLocation, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useCurrentPermissions } from "@/lib/rbac";
import { RBAC_MODULES } from "@/lib/rbac-modules";
import { useCurrentUserRole } from "@/lib/use-current-user-role";

/**
 * Any authenticated employee may reach these — they are role-agnostic
 * personal surfaces (own profile, own attendance, own dashboard shells).
 */
const ALWAYS_ALLOW_PREFIXES: readonly string[] = [
  "/admin/profile",
  "/admin/employee-dashboard",
  "/admin/field-dashboard",
  "/admin/dashboard",
  "/admin/my-attendance",
  "/admin/my-inventory",
  "/admin/my-reportees",
];

/**
 * Explicit path → required module. Only listed when the mapping isn't
 * already discoverable from RBAC_MODULES.path / subModules[].path.
 */
const EXTRA_PATH_TO_MODULE: Record<string, string> = {
  "/admin/notifications": "notification_center",
  "/admin/rbac": "rbac",
};

type RequiredPermission = { module: string; sub?: string };

function buildPrefixTable(): Array<[string, RequiredPermission]> {
  const map = new Map<string, RequiredPermission>();
  for (const [k, v] of Object.entries(EXTRA_PATH_TO_MODULE)) map.set(k, { module: v });
  for (const m of RBAC_MODULES) {
    if (m.path) map.set(m.path, { module: m.key });
    for (const sub of m.subModules) {
      if (sub.path) map.set(sub.path, { module: m.key, sub: sub.key });
    }
  }
  // Sort by descending prefix length so longer matches win first.
  return Array.from(map.entries()).sort((a, b) => b[0].length - a[0].length);
}

let PREFIX_TABLE: Array<[string, RequiredPermission]> | null = null;
function getPrefixTable() {
  if (!PREFIX_TABLE) PREFIX_TABLE = buildPrefixTable();
  return PREFIX_TABLE;
}

function resolveRequiredModule(pathname: string): RequiredPermission | null {
  for (const [prefix, mod] of getPrefixTable()) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return mod;
  }
  return null;
}

function isAlwaysAllowed(pathname: string): boolean {
  return ALWAYS_ALLOW_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function RoutePermissionGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const pathname = location.pathname;
  const { can, canSub, isSuperAdmin, isLoading, accessUnresolved, reloadAccess } =
    useCurrentPermissions();
  const role = useCurrentUserRole();

  const decision = useMemo(() => {
    if (isAlwaysAllowed(pathname)) return { allow: true as const };
    if (
      role.isFieldOfficer &&
      (pathname === "/admin/inventory" ||
        pathname === "/admin/inventory/" ||
        pathname.startsWith("/admin/inventory/demands") ||
        pathname.startsWith("/admin/inventory/goods-receipts") ||
        pathname.startsWith("/admin/inventory/issuances") ||
        pathname.startsWith("/admin/inventory/collections"))
    )
      return { allow: true as const };
    if (isSuperAdmin) return { allow: true as const };
    const required = resolveRequiredModule(pathname);
    if (!required) return { allow: true as const, unmapped: true };
    return {
      allow: required.sub ? canSub(required.module, required.sub) : can(required.module),
      module: required.module,
    };
  }, [pathname, isSuperAdmin, can, canSub, role.isFieldOfficer]);

  if (isLoading || role.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/70" />
      </div>
    );
  }

  if (!decision.allow && accessUnresolved) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-lg font-semibold text-foreground">Loading your access…</div>
        <div className="text-sm text-muted-foreground">
          We couldn't confirm your permissions yet. Check your connection and try again.
        </div>
        <button
          type="button"
          onClick={reloadAccess}
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!decision.allow) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-200">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <div className="space-y-1">
          <div className="text-lg font-semibold text-foreground">Access denied</div>
          <div className="text-sm text-muted-foreground">
            You don't have permission to view this page. Ask your administrator to grant access to
            the <span className="font-medium">{decision.module}</span> module.
          </div>
        </div>
        <Link
          to="/"
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Go home
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
