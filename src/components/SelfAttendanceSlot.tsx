import { MarkAttendanceCard } from "@/components/MarkAttendanceCard";
import { useCurrentUserRole } from "@/lib/use-current-user-role";

/** Shows the "mark my attendance" card for any signed-in staff member with a profile. */
export function SelfAttendanceSlot() {
  const role = useCurrentUserRole();
  if (role.isSuperAdmin || !role.candidateId) return null;
  return (
    <div className="mb-4">
      <MarkAttendanceCard candidateId={role.candidateId} />
    </div>
  );
}
