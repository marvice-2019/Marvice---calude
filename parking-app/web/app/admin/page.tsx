import type { Metadata } from "next";
import { AdminConsole } from "@/components/AdminConsole";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default function AdminPage() {
  return (
    <div className="wrap">
      <header className="page-head"><h1>Bayline admin</h1><p>Payouts, operator onboarding, refunds, promos and the audit log. Every action here is recorded.</p></header>
      <AdminConsole />
    </div>
  );
}
