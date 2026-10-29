/**
 * Single source of truth for who may do what. Every loader/action that reads
 * or changes protected data calls requirePermission() (session.server.ts),
 * which uses can() below. Covered by tests/permissions.test.ts.
 */
export const ROLES = ["member", "dept_leader", "finance", "cafe", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  "registration:review": ["admin"],
  "bot:manage": ["admin"],
  "member:manage": ["admin"], // roles and positions
  "department:manage": ["admin"], // appoint/remove department leaders
  "attendance:fellowship": ["admin"], // whole-fellowship sessions
  "fast:manage": ["admin"], // create fasts, add people
  "fast:scan": ["admin", "cafe"], // scan QR codes at the cafe
  "member:list": ["admin", "dept_leader"],
  "attendance:record": ["admin", "dept_leader"],
  "course:manage": ["admin"],
  "finance:record": ["admin", "finance"],
  "finance:view": ["admin", "finance"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: unknown, permission: Permission): boolean {
  if (!isRole(role)) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
