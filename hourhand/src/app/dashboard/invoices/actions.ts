"use server";

import { revalidatePath } from "next/cache";
import { authEnabled } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { getPool } from "@/lib/data/pg-store";
import { removeTaxProfile, saveTaxProfile, validateTaxProfile } from "@/lib/gst/invoices";

export type TaxFormState = { status: "idle" } | { status: "saved" } | { status: "removed" } | { status: "error"; errors: Record<string, string> };

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Saves the signed-in host's GST details; invoices are issued from the next payment on. */
export async function saveTaxProfileAction(_prev: TaxFormState, form: FormData): Promise<TaxFormState> {
  const user = await requireUser();
  if (!authEnabled()) return { status: "error", errors: { form: "GST invoices need payments, which this demo copy doesn't have." } };
  if (form.get("remove") === "1") {
    await removeTaxProfile(getPool(process.env.DATABASE_URL as string), user.id);
    revalidatePath("/dashboard/invoices");
    return { status: "removed" };
  }
  const v = validateTaxProfile({
    legalName: field(form, "legalName"), address: field(form, "address"), gstin: field(form, "gstin"), sac: field(form, "sac"), rate: field(form, "rate"), invoicePrefix: field(form, "invoicePrefix"),
  });
  if (!v.ok) return { status: "error", errors: v.errors };
  await saveTaxProfile(getPool(process.env.DATABASE_URL as string), user.id, v.value);
  revalidatePath("/dashboard/invoices");
  return { status: "saved" };
}
