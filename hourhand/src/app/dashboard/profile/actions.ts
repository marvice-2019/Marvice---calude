"use server";

import { revalidatePath } from "next/cache";
import { authEnabled } from "@/lib/auth/auth";
import { requireHost } from "@/lib/auth/session";
import { getPool } from "@/lib/data/pg-store";
import { isNamedError } from "@/lib/data/types";
import { removePhoto, saveProfile, savePhoto, validateProfile, type PhotoRejectedError } from "@/lib/profile";

// Each action checks the session itself and writes only the signed-in host's own row.

export type ProfileFormState = { status: "idle" } | { status: "saved" } | { status: "error"; errors: Record<string, string> };

const DEMO = "Your page needs the database, which this demo copy doesn't have.";
const field = (form: FormData, name: string) => String(form.get(name) ?? "");

export async function saveProfileAction(_prev: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const user = await requireHost();
  if (!authEnabled()) return { status: "error", errors: { form: DEMO } };
  const v = validateProfile(Object.fromEntries(["headline", "bio", "area", "whatsapp", "instagram", "reviewsUrl"].map((k) => [k, field(form, k)])));
  if (!v.ok) return { status: "error", errors: v.errors };
  await saveProfile(getPool(process.env.DATABASE_URL as string), user.id, v.value);
  revalidatePath("/dashboard/profile");
  revalidatePath(`/${user.slug}`);
  return { status: "saved" };
}

export async function savePhotoAction(_prev: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const user = await requireHost();
  if (!authEnabled()) return { status: "error", errors: { photo: DEMO } };
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { status: "error", errors: { photo: "Choose a photo first." } };
  try {
    await savePhoto(getPool(process.env.DATABASE_URL as string), user.id, new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (isNamedError<PhotoRejectedError>(error, "PhotoRejectedError")) {
      return { status: "error", errors: { photo: error.reason === "too_big" ? "That photo is over 2 MB. Pick a smaller one." : "Use a JPEG, PNG or WebP photo." } };
    }
    throw error;
  }
  revalidatePath("/dashboard/profile");
  revalidatePath(`/${user.slug}`);
  return { status: "saved" };
}

export async function removePhotoAction(): Promise<void> {
  const user = await requireHost();
  if (!authEnabled()) return;
  await removePhoto(getPool(process.env.DATABASE_URL as string), user.id);
  revalidatePath("/dashboard/profile");
  revalidatePath(`/${user.slug}`);
}
