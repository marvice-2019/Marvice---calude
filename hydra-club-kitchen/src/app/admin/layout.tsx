import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Hydra admin" }, robots: { index: false, follow: false } };

/** Outer admin frame. Sign-in pages centre a card; signed-in pages use the (panel) shell. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-bg text-text [&>main.admin-card]:mx-auto [&>main.admin-card]:mt-[12vh]">{children}</div>;
}
