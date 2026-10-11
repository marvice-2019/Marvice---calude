import type { Metadata } from "next";
import { Account } from "@/components/Account";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

export default function AccountPage() {
  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <header className="page-head"><h1>Account</h1></header>
      <Account />
    </div>
  );
}
