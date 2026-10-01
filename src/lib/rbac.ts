import { supabase } from "@/integrations/supabase/client";
import type { PermissionAction } from "@/lib/rbac-modules";
import { moduleSupportsApprove } from "@/lib/rbac-modules";

export type RoleRow = {
  key: string;
  name: string;
  description: string;
  is_system: boolean;
  sort_order: number;
};

export type PermissionRow = {
  id?: string;
  role_key: string;
  module_key: string;
  sub_module_key: string; // '' for module-level
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_approve: boolean;
};

export type PermKey = `${string}::${string}`; // `${module_key}::${sub_module_key}`

export function permKey(moduleKey: string, subModuleKey = ""): PermKey {
  return `${moduleKey}::${subModuleKey}` as PermKey;
}

export const EMPTY_PERM = {
  can_view: false,
  can_edit: false,
  can_delete: false,
  can_approve: false,
};

export async function fetchRoles(): Promise<RoleRow[]> {
  const { data, error } = await supabase
    .from("roles")
    .select("key,name,description,is_system,sort_order")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as RoleRow[];
}

export async function fetchRolePermissions(roleKey: string): Promise<PermissionRow[]> {
  const { data, error } = await supabase
    .from("role_permissions")
    .select("id,role_key,module_key,sub_module_key,can_view,can_edit,can_delete,can_approve")
    .eq("role_key", roleKey);
  if (error) throw error;
  return (data ?? []) as PermissionRow[];
}

export async function saveRolePermissions(roleKey: string, rows: PermissionRow[]): Promise<void> {
  // Replace all rows for the role in one shot — simplest & matches editor UX.
  const del = await supabase.from("role_permissions").delete().eq("role_key", roleKey);
  if (del.error) throw del.error;
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    role_key: roleKey,
    module_key: r.module_key,
    sub_module_key: r.sub_module_key ?? "",
    can_view: r.can_view,
    can_edit: r.can_edit,
    can_delete: r.can_delete,
    can_approve: r.can_approve,
  }));
  const ins = await supabase.from("role_permissions").insert(payload);
  if (ins.error) throw ins.error;
}

// Enforce action implications: edit ⇒ view, delete ⇒ edit+view, approve ⇒ view.
export function normalizePerm(p: {
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_approve: boolean;
}) {
  const can_delete = p.can_delete;
  const can_edit = p.can_edit || can_delete;
  const can_approve = p.can_approve;
  const can_view = p.can_view || can_edit || can_approve;
  return { can_view, can_edit, can_delete, can_approve };
}

type PermCell = {
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_approve: boolean;
};

export function hasFromMap(
  map: Map<PermKey, PermCell>,
  moduleKey: string,
  subModuleKey: string,
  action: PermissionAction,
): boolean {
  const row = map.get(permKey(moduleKey, subModuleKey));
  if (!row) return false;
  if (action === "view") return row.can_view;
  if (action === "edit") return row.can_edit;
  if (action === "delete") return row.can_delete;
  return row.can_approve;
}

// ---------------- Runtime enforcement ----------------
import { useQuery } from "@tanstack/react-query";
import { readStoredAuthUser, useAuth, isSuperAdminPhone } from "@/lib/auth";
import { isAdminConsoleRole, isFieldOfficerRole, isGuardRole, ROLE_KEYS } from "@/lib/role-keys";

// Tiny local snapshot of the signed-in user's role + permissions. Purely a
// paint accelerator: every read still revalidates against the server, and the
// database keeps enforcing access.
const roleCacheKey = (phone: string) => `rbac:role:${phone}`;
const permsCacheKey = (roleKey: string) => `rbac:perms:${roleKey}`;

function readCache<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — cache is optional */
  }
}

export type PermCheck = (moduleKey: string, action?: PermissionAction) => boolean;
export type SubPermCheck = (
  moduleKey: string,
  subModuleKey: string,
  action?: PermissionAction,
) => boolean;

export function useCurrentPermissions(): {
  isLoading: boolean;
  isSuperAdmin: boolean;
  isAdminConsole: boolean;
  isFieldOfficer: boolean;
  isGuard: boolean;
  roleKey: string | null;
  can: PermCheck;
  canSub: SubPermCheck;
} {
  const { user } = useAuth();
  // Separate useAuth consumers hydrate independently. Read the already-written
  // login snapshot as a synchronous fallback so route guards cannot classify a
  // signed-in administrator as frontline during that brief hand-off.
  const effectiveUser = user ?? readStoredAuthUser();
  const phone = effectiveUser?.phone?.replace(/\D/g, "").slice(-10) ?? "";
  // Phone allowlist retained as a bootstrap bypass: the three super-admin
  // phones don't exist as candidate rows so removing this would lock them
  // out. DB `is_admin_user()` mirrors the same allowlist.
  const isSuperAdminByPhone = isSuperAdminPhone(phone);
  // The authenticated app role is written synchronously by the successful
  // login flow. Honour it as well as the phone bootstrap so routing cannot
  // briefly demote a restored super-admin session while role data hydrates.
  const isSuperAdminByAuthRole = effectiveUser?.role === "super_admin";

  const roleQ = useQuery({
    queryKey: ["rbac", "current-role", phone],
    enabled: !!phone,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("role_key")
        .eq("mobile", phone)
        .maybeSingle();
      if (error) throw error;
      const key = (data?.role_key as string | undefined) ?? null;
      writeCache(roleCacheKey(phone), key);
      return key;
    },
    // The shell is gated on this read. Serve the last known role instantly and
    // revalidate in the background so navigation never blanks the interface.
    initialData: () => readCache<string | null>(roleCacheKey(phone)) ?? undefined,
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  const roleKey = roleQ.data ?? null;
  const isSuperAdmin =
    isSuperAdminByPhone ||
    isSuperAdminByAuthRole ||
    roleKey === ROLE_KEYS.SUPER_ADMIN ||
    roleKey === ROLE_KEYS.ADMIN;

  const permsQ = useQuery({
    queryKey: ["rbac", "current-perms", roleKey],
    enabled: !!roleKey && !isSuperAdmin,
    queryFn: async () => {
      const rows = await fetchRolePermissions(roleKey as string);
      writeCache(permsCacheKey(roleKey as string), rows);
      return rows;
    },
    initialData: () =>
      roleKey ? (readCache<PermissionRow[]>(permsCacheKey(roleKey)) ?? undefined) : undefined,
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  const map = new Map<string, PermissionRow>();
  for (const r of permsQ.data ?? []) {
    map.set(`${r.module_key}::${r.sub_module_key ?? ""}`, r);
  }

  const valueFor = (r: PermissionRow | undefined, action: PermissionAction) => {
    if (!r) return false;
    if (action === "view") return r.can_view;
    if (action === "edit") return r.can_edit;
    if (action === "delete") return r.can_delete;
    return r.can_approve;
  };

  const can: PermCheck = (moduleKey, action = "view") => {
    if (isSuperAdmin) return action === "approve" ? moduleSupportsApprove(moduleKey) : true;
    if (action === "approve" && !moduleSupportsApprove(moduleKey)) return false;
    // Module-level grant
    const m = map.get(`${moduleKey}::`);
    if (valueFor(m, action)) return true;
    // Any sub-module granted counts as access to parent group
    for (const [k, r] of map) {
      if (k.startsWith(`${moduleKey}::`) && k !== `${moduleKey}::` && valueFor(r, action))
        return true;
    }
    return false;
  };

  const canSub: SubPermCheck = (moduleKey, subModuleKey, action = "view") => {
    if (isSuperAdmin) return action === "approve" ? moduleSupportsApprove(moduleKey) : true;
    if (action === "approve" && !moduleSupportsApprove(moduleKey)) return false;
    const subGrant = map.get(`${moduleKey}::${subModuleKey}`);
    if (subGrant) return valueFor(subGrant, action);

    // If a role has explicit sub-module rows for this module, those rows are the
    // authority. Do not let the parent module row accidentally expose every child.
    const hasAnySubGrant = Array.from(map.keys()).some(
      (k) => k.startsWith(`${moduleKey}::`) && k !== `${moduleKey}::`,
    );
    if (hasAnySubGrant) return false;

    const moduleGrant = map.get(`${moduleKey}::`);
    return valueFor(moduleGrant, action);
  };

  return {
    // Cached values prevent blank screens, but routing must wait for the live
    // role and permission reads so an old device cache cannot select a stale dashboard.
    isLoading:
      !isSuperAdmin &&
      (roleQ.isLoading || roleQ.isFetching || permsQ.isLoading || permsQ.isFetching),
    isSuperAdmin,
    isAdminConsole: isSuperAdmin || isAdminConsoleRole(roleKey),
    isFieldOfficer: !isSuperAdmin && isFieldOfficerRole(roleKey),
    isGuard: !isSuperAdmin && isGuardRole(roleKey),
    roleKey,
    can,
    canSub,
  };
}
