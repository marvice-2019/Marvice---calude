import type { Metadata } from "next";
import { requireUser } from "@/auth/guard";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const user = await requireUser(undefined, { allowPasswordChange: true });
  return (
    <main className="admin-card">
      <h1>Change password</h1>
      {user.mustChangePassword && <p className="admin-ok">Set your own password before you continue.</p>}
      <ChangePasswordForm />
    </main>
  );
}
