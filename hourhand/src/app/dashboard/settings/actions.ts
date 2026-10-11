"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwnAccount } from "@/lib/auth/session";
import { store } from "@/lib/data";
import { isLocale } from "@/lib/i18n/guest";

/** The language guests see on the host's booking pages unless they pick another. */
export async function setBookingLanguage(form: FormData): Promise<void> {
  const user = await requireOwnAccount();
  const locale = form.get("locale");
  if (!isLocale(locale)) redirect("/dashboard/settings");
  await store.setUserLocale(user.id, locale);
  revalidatePath(`/${user.slug}`, "layout");
  redirect("/dashboard/settings?saved=language");
}
