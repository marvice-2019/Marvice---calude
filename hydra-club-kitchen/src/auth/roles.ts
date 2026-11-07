export const ROLES = ["owner", "manager", "host"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Who can do what in /admin. Hosts run the door; managers run the venue;
 * only the owner manages staff accounts.
 */
export const PERMISSIONS = {
  "bookings:read": ["owner", "manager", "host"],
  "bookings:write": ["owner", "manager", "host"], // confirm, cancel, no-show, walk-in
  "bookings:export": ["owner", "manager"],
  "holds:write": ["owner", "manager"],
  "content:write": ["owner", "manager"], // menu, nights, photos
  "settings:write": ["owner", "manager"],
  "audit:read": ["owner", "manager"],
  "users:manage": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
