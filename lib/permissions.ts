// Role -> permission table, mirrored from backend/core/permissions.py (backend/tests/test_permissions_mirror.py fails
// if the two differ). The UI uses it only to HIDE what a person cannot use; the backend still enforces every action.
import table from './permissions.json';

export type PermissionTable = Record<string, string[]>;

const PERMISSIONS = table as PermissionTable;

export function can(role: string | null | undefined, permission: string): boolean {
  return !!role && (PERMISSIONS[role] ?? []).includes(permission);
}

/** True when the role holds at least one of the permissions (or `permission` is undefined: no restriction). */
export function canAny(role: string | null | undefined, permissions?: string | string[]): boolean {
  if (permissions === undefined) return true;
  return (Array.isArray(permissions) ? permissions : [permissions]).some((p) => can(role, p));
}
