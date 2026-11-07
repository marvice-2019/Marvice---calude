"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { CredentialsSignin } from "next-auth";
import { signIn, signOut } from "@/auth";
import { changePassword, credentialsSchema } from "@/auth/core";
import { requireUser } from "@/auth/guard";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export type FormState = { error?: string; errors?: Record<string, string>; email?: string };

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  // React resets the form after an action; hand the email back so it survives a failed attempt.
  const email = String(form.get("email") ?? "").slice(0, 254);
  try {
    await signIn("credentials", { email, password: form.get("password"), redirect: false });
  } catch (err) {
    if (err instanceof CredentialsSignin) {
      return err.code === "rate_limited"
        ? { email, error: "Too many attempts. Wait 15 minutes and try again." }
        : { email, error: "That email and password don't match." };
    }
    throw err;
  }
  // Send the user straight to where they must go, rather than relying on a redirect chain
  // during the client-side navigation that follows a server action.
  const normalised = credentialsSchema.shape.email.parse(email);
  const [user] = await getDb()
    .select({ mustChangePassword: users.mustChangePassword })
    .from(users)
    .where(eq(users.email, normalised));
  redirect(user?.mustChangePassword ? "/admin/change-password" : "/admin");
}

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser(undefined, { allowPasswordChange: true });
  const result = await changePassword(getDb(), user.id, {
    current: form.get("current"),
    next: form.get("next"),
    confirm: form.get("confirm"),
  });
  if (!result.ok) return { errors: result.errors };
  // Every session issued before the change (including this one) is now invalid.
  await signOut({ redirectTo: "/admin/login?changed=1" });
  return {};
}

export async function logoutAction() {
  await signOut({ redirectTo: "/admin/login" });
}
