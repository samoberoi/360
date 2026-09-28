import { createFileRoute, Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { InventoryOwnerDashboard } from "./admin.inventory.dashboard";
import { useCurrentUserRole } from "@/lib/use-current-user-role";

export const Route = createFileRoute("/admin/inventory")({
  component: InventoryLayout,
});

function InventoryLayout() {
  const location = useLocation();
  const isHub = location.pathname === "/admin/inventory" || location.pathname === "/admin/inventory/";
  if (!isHub) return <Outlet />;
  return <InventoryDashboard />;
}

function InventoryDashboard() {
  const role = useCurrentUserRole();
  if (role.isLoading) return <div className="min-h-[40vh] animate-pulse rounded-2xl bg-muted" />;
  // Uniform Manager is not available to field officers.
  if (role.isFieldOfficer) return <Navigate to="/admin/field-dashboard" replace />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Uniform Command Center"
        description="End-to-end chain of custody from supplier → warehouse → branch → field officer → guard."
        crumbs={[{ label: "Uniform Manager" }]}
      />
      <InventoryOwnerDashboard />
    </div>
  );
}
