import type { Permission } from "@/auth/roles";

/**
 * Admin sections. The shell (stage 5A) renders this list, showing only what the
 * user's role allows; each page also calls requireUser(permission) itself.
 */
export const ADMIN_NAV: { href: string; label: string; permission: Permission }[] = [
  { href: "/admin", label: "Today", permission: "bookings:read" },
  { href: "/admin/bookings", label: "Bookings", permission: "bookings:read" },
  { href: "/admin/holds", label: "Holds", permission: "holds:write" },
  { href: "/admin/photos", label: "Photos", permission: "content:write" },
  { href: "/admin/menu", label: "Menu", permission: "content:write" },
  { href: "/admin/nights", label: "Nights", permission: "content:write" },
  { href: "/admin/settings", label: "Settings", permission: "settings:write" },
  { href: "/admin/users", label: "Users", permission: "users:manage" },
];
