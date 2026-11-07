import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/auth/guard";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Staff sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  if (await getCurrentUser()) redirect("/admin");
  const { changed } = await searchParams;
  return (
    <main className="admin-card">
      <h1>Hydra staff</h1>
      {changed && <p className="admin-ok">Password changed. Sign in with the new one.</p>}
      <LoginForm />
    </main>
  );
}
