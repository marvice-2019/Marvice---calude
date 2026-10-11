"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { tokenKey } from "@/lib/crypto/seal";
import { getPool } from "@/lib/data/pg-store";
import { disconnectRazorpay, RazorpayKeyError, razorpayVerifier, saveRazorpayKeys } from "@/lib/payments/host-razorpay";

// Each action checks the session itself and only touches the signed-in host's own keys. The key fields are never logged.

const pool = () => getPool(process.env.DATABASE_URL as string);
const text = (v: FormDataEntryValue | null): string => (typeof v === "string" ? v.trim() : "");

/** Runs a change and sends the host back to the page with its outcome. redirect() must stay outside the try. */
async function run(change: () => Promise<void>, done: "connected" | "disconnected"): Promise<never> {
  let target = `/dashboard/integrations?${done}=1`;
  try {
    await change();
  } catch (error) {
    if (error instanceof RazorpayKeyError) target = `/dashboard/integrations?error=${error.code}`;
    else if (error instanceof Error && error.message.startsWith("TOKEN_ENCRYPTION_KEY")) target = "/dashboard/integrations?error=not_configured";
    else throw error;
  }
  revalidatePath("/dashboard/integrations");
  redirect(target);
}

export async function connectRazorpay(form: FormData): Promise<void> {
  const user = await requireUser();
  if (!authEnabled()) redirect("/dashboard/integrations?error=demo");
  const keyId = text(form.get("keyId"));
  const keyPassword = text(form.get("keySecret"));
  await run(() => saveRazorpayKeys(pool(), tokenKey(), user.id, keyId, keyPassword, razorpayVerifier()).then(() => undefined), "connected");
}

export async function disconnectRazorpayAction(): Promise<void> {
  const user = await requireUser();
  if (!authEnabled()) redirect("/dashboard/integrations?error=demo");
  await run(() => disconnectRazorpay(pool(), user.id), "disconnected");
}
