"use server";

import { revalidatePath } from "next/cache";
import { EventTypeInUseError, SlugTakenError, store, type QuestionDraft } from "@/lib/data";
import { SLUG_TAKEN, validateEventType, validateQuestions, type EventTypeErrors, type EventTypeForm, type QuestionErrors } from "@/lib/event-types";

export type SaveResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; errors: EventTypeErrors; questionErrors: QuestionErrors };

function refresh(userSlug: string, id?: string) {
  revalidatePath("/dashboard/event-types");
  if (id) revalidatePath(`/dashboard/event-types/${id}`);
  revalidatePath(`/${userSlug}`, "layout");
}

/** Creates the event type when `id` is null, otherwise updates it. Saves details, rules and questions together. */
export async function saveEventType(id: string | null, form: EventTypeForm, questions: QuestionDraft[]): Promise<SaveResult> {
  const user = await store.getCurrentUser();
  const others = (await store.listEventTypes(user.id)).filter((e) => e.id !== id).map((e) => e.slug);
  const details = validateEventType(form, others);
  const checked = validateQuestions(questions);
  if (!details.ok || !checked.ok) {
    return { ok: false, errors: details.ok ? {} : details.errors, questionErrors: checked.ok ? [] : checked.errors };
  }
  try {
    const saved = id ? await store.updateEventType(user.id, id, details.value) : await store.createEventType(user.id, details.value);
    await store.saveQuestions(saved.id, checked.value);
    refresh(user.slug, saved.id);
    return { ok: true, id: saved.id, slug: saved.slug };
  } catch (e) {
    if (e instanceof SlugTakenError) return { ok: false, errors: { slug: SLUG_TAKEN }, questionErrors: [] };
    throw e;
  }
}

export async function setEventTypeActive(id: string, active: boolean): Promise<void> {
  const user = await store.getCurrentUser();
  await store.setEventTypeActive(user.id, id, active === true);
  refresh(user.slug, id);
}

/** Returns the reason when the event type can't be deleted. */
export async function deleteEventType(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await store.getCurrentUser();
  try {
    await store.deleteEventType(user.id, id);
  } catch (e) {
    if (e instanceof EventTypeInUseError) return { ok: false, error: e.message };
    throw e;
  }
  refresh(user.slug);
  return { ok: true };
}
