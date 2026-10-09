import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { readStoredAuthUser, useAuth } from "@/lib/auth";
import { useCurrentPermissions } from "@/lib/rbac";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "PLUS 360 — Staff workspace" },
      { name: "description", content: "PLUS 360 staff attendance, site visits and operations workspace." },
      { property: "og:title", content: "PLUS 360 — Staff workspace" },
      { property: "og:description", content: "PLUS 360 staff attendance, site visits and operations workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const ORDER = ["organizations","contracts","employees","vehicles","assets","inventory","attendance","payroll","control_center","notification_center","rbac"] as const;
const PATH_FOR: Record<string,string> = {
  organizations: "/admin/customers/customer-manager",
  contracts: "/admin/contracts/client-contracts",
  employees: "/admin/employees",
  vehicles: "/admin/vehicles",
  assets: "/admin/assets",
  inventory: "/admin/inventory",
  attendance: "/admin/attendance",
  payroll: "/admin/payroll",
  control_center: "/admin/control-center",
  notification_center: "/admin/notifications",
  rbac: "/admin/rbac",
};

function Index() {
  const navigate = useNavigate();
  const { user, isReady } = useAuth();
  const {
    can,
    isLoading,
    isSuperAdmin,
    isAdminConsole,
    isFieldOfficer,
  } = useCurrentPermissions();

  useEffect(() => {
    if (!isReady) return;
    if (!user) {
      navigate({ to: "/login", replace: true });
      return;
    }
    // Login persists the verified role before navigating here. Check it before
    // waiting for the independently-hydrated RBAC query so a stale frontline
    // redirect can never be queued for a super administrator.
    if (user.role === "super_admin" || readStoredAuthUser()?.role === "super_admin") {
      navigate({ to: "/admin/dashboard", replace: true });
      return;
    }
    if (isLoading) return;

    // Role-based dashboard landing — derived from RBAC role helpers,
    // not from hardcoded role-key sets.
    if (isFieldOfficer) {
      navigate({ to: "/admin/field-dashboard", replace: true });
      return;
    }
    if (isSuperAdmin) {
      navigate({ to: "/admin/dashboard", replace: true });
      return;
    }
    if (!isAdminConsole) {
      // Guards & other frontline employees.
      navigate({ to: "/admin/employee-dashboard", replace: true });
      return;
    }
    if (can("dashboard") || can("organizations") || can("employees")) {
      navigate({ to: "/admin/dashboard", replace: true });
      return;
    }
    for (const m of ORDER) {
      if (can(m)) {
        navigate({ to: PATH_FOR[m], replace: true });
        return;
      }
    }
    navigate({ to: "/admin/employee-dashboard", replace: true });
  }, [user, isReady, isLoading, isSuperAdmin, isAdminConsole, isFieldOfficer, can, navigate]);

  return <div className="min-h-screen bg-background" />;
}
