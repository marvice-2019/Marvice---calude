"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth/auth";
import { requireHost } from "@/lib/auth/session";
import { getPool } from "@/lib/data/pg-store";
import { isNamedError } from "@/lib/data/types";
import { createPackage, setPackageActive, validatePackageForm } from "@/lib/packages/packages";

// Each action checks the session itself; every query takes the signed-in host's id, so another host's package or event
// type is simply not found.

export type PackageFormState = { status: "idle" } | { status: "created" } | { status: "error"; errors: Record<string, string> };

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function createPackageAction(_prev: PackageFormState, form: FormData): Promise<PackageFormState> {
  const user = await requireHost();
  if (!authEnabled()) return { status: "error", errors: { form: "Packages need payments, which this demo copy doesn't have." } };
  const v = validatePackageForm({ eventTypeId: field(form, "eventTypeId"), name: field(form, "name"), sessions: field(form, "sessions"), price: field(form, "price"), validDays: field(form, "validDays") });
  if (!v.ok) return { status: "error", errors: v.errors };
  try {
    await createPackage(getPool(process.env.DATABASE_URL as string), user.id, v.value);
  } catch (error) {
    if (isNamedError(error, "NotFoundError")) return { status: "error", errors: { eventTypeId: "That event type isn't available. Turn it on first, or pick another." } };
    throw error;
  }
  revalidatePath("/dashboard/packages");
  return { status: "created" };
}

export async function togglePackage(form: FormData): Promise<void> {
  const user = await requireHost();
  let target = "/dashboard/packages";
  try {
    await setPackageActive(getPool(process.env.DATABASE_URL as string), user.id, field(form, "packageId"), field(form, "active") === "on");
  } catch (error) {
    if (!isNamedError(error, "NotFoundError")) throw error;
    target = "/dashboard/packages?error=not_found";
  }
  revalidatePath("/dashboard/packages");
  redirect(target);
}
