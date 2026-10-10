// Pure validation for the event type editor. Limits mirror the checks on event_types and custom_questions in replica/schema.sql.
import type { CustomQuestion, EventTypeDraft, LocationKind, QuestionDraft } from "./data/types";

export const DURATION = { min: 5, max: 720 } as const;
export const START_INCREMENTS = [5, 10, 15, 20, 30, 45, 60] as const;
export const BUFFER = { min: 0, max: 240 } as const;
export const BOOKING_WINDOW = { min: 1, max: 730 } as const;
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const SLUG_TAKEN = "That link is already used by another event type";

/** Locations whose value the host must fill in, with the label shown for that value. */
export const LOCATION_VALUE_LABEL: Partial<Record<LocationKind, string>> = {
  in_person: "Address",
  phone_guest_calls: "Your phone number",
  custom: "Location details",
};

/** What the editor sends. Numbers arrive as the strings typed into the inputs. */
export interface EventTypeForm {
  name: string;
  slug: string;
  durationMinutes: string;
  description: string;
  locationKind: LocationKind | "";
  locationValue: string;
  minNoticeMinutes: string;
  bookingWindowDays: string;
  startIncrementMinutes: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
  /** Blank means no limit. */
  dailyLimit: string;
  cancelCutoffMinutes: string;
}

export type EventTypeErrors = Partial<Record<keyof EventTypeForm, string>>;
export type QuestionErrors = { label?: string; choices?: string }[];

/** "45-min Coaching Session!" -> "45-min-coaching-session". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

function whole(raw: string): number | null {
  const t = raw.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** Checks the form against the schema limits. `takenSlugs` are the user's other event type slugs. */
export function validateEventType(form: EventTypeForm, takenSlugs: readonly string[]):
  { ok: true; value: EventTypeDraft } | { ok: false; errors: EventTypeErrors } {
  const errors: EventTypeErrors = {};

  const name = form.name.trim();
  if (!name) errors.name = "Give this event type a name.";

  const slug = form.slug.trim() ? form.slug.trim().toLowerCase() : slugify(name);
  if (!slug) {
    if (name) errors.slug = "Add a link using letters or numbers.";
  } else if (!SLUG_PATTERN.test(slug)) {
    errors.slug = "Use lowercase letters, numbers and hyphens, starting with a letter or number (60 characters at most).";
  } else if (takenSlugs.includes(slug)) {
    errors.slug = SLUG_TAKEN;
  }

  const number = (key: keyof EventTypeForm, min: number, max: number, message: string): number => {
    const n = whole(form[key]);
    if (n === null || n < min || n > max) errors[key] = message;
    return n ?? 0;
  };

  const durationMinutes = number("durationMinutes", DURATION.min, DURATION.max, `Pick a length between ${DURATION.min} and ${DURATION.max} minutes.`);
  const minNoticeMinutes = number("minNoticeMinutes", 0, Number.MAX_SAFE_INTEGER, "Enter 0 or more minutes.");
  const bookingWindowDays = number("bookingWindowDays", BOOKING_WINDOW.min, BOOKING_WINDOW.max, `Enter between ${BOOKING_WINDOW.min} and ${BOOKING_WINDOW.max} days.`);
  const startIncrementMinutes = number("startIncrementMinutes", 0, 60, "Pick one of the listed start times.");
  if (!errors.startIncrementMinutes && !(START_INCREMENTS as readonly number[]).includes(startIncrementMinutes)) {
    errors.startIncrementMinutes = "Pick one of the listed start times.";
  }
  const bufferBeforeMinutes = number("bufferBeforeMinutes", BUFFER.min, BUFFER.max, `Enter between ${BUFFER.min} and ${BUFFER.max} minutes.`);
  const bufferAfterMinutes = number("bufferAfterMinutes", BUFFER.min, BUFFER.max, `Enter between ${BUFFER.min} and ${BUFFER.max} minutes.`);
  const cancelCutoffMinutes = number("cancelCutoffMinutes", 0, Number.MAX_SAFE_INTEGER, "Enter 0 or more minutes.");
  const dailyLimit = form.dailyLimit.trim() ? number("dailyLimit", 1, Number.MAX_SAFE_INTEGER, "Enter 1 or more, or leave it blank for no limit.") : null;

  const valueLabel = form.locationKind ? LOCATION_VALUE_LABEL[form.locationKind] : undefined;
  const locationValue = form.locationValue.trim();
  if (valueLabel && !locationValue) errors.locationValue = `Add the ${valueLabel.toLowerCase()} so guests know where to go.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name, slug, description: form.description.trim() || null, durationMinutes, minNoticeMinutes, bookingWindowDays,
      startIncrementMinutes, bufferBeforeMinutes, bufferAfterMinutes, dailyLimit, cancelCutoffMinutes,
      location: form.locationKind ? { kind: form.locationKind, value: valueLabel ? locationValue : null } : null,
    },
  };
}

const QUESTION_KINDS: readonly CustomQuestion["kind"][] = ["short_text", "long_text", "phone", "single_select", "multi_select", "consent"];

/** Checks each question; the error list lines up with the input list. */
export function validateQuestions(questions: readonly QuestionDraft[]):
  { ok: true; value: QuestionDraft[] } | { ok: false; errors: QuestionErrors } {
  let ok = true;
  const value: QuestionDraft[] = [];
  const errors: QuestionErrors = questions.map((q) => {
    const e: QuestionErrors[number] = {};
    const label = q.label.trim();
    if (!label) e.label = "Write the question guests will see.";
    if (!QUESTION_KINDS.includes(q.kind)) e.label = "Pick a kind of answer.";
    const isSelect = q.kind === "single_select" || q.kind === "multi_select";
    const choices = isSelect ? q.choices.map((c) => c.trim()).filter(Boolean) : [];
    if (isSelect && choices.length < 2) e.choices = "Add at least two choices, one per line.";
    if (e.label || e.choices) ok = false;
    value.push({ id: q.id, label, kind: q.kind, required: q.required, choices });
    return e;
  });
  return ok ? { ok: true, value } : { ok: false, errors };
}
