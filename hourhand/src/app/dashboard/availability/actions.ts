"use server";

import { revalidatePath } from "next/cache";
import { todayIn, validateDateOverride, validateDateRange, validateWeeklyHours, type FieldErrors, type WeeklyHours } from "@/lib/availability";
import { store, type Interval } from "@/lib/data";

export type FormState = { status: "idle" | "saved" | "error"; errors: FieldErrors; savedAt?: number };

const PATH = "/dashboard/availability";

/** The signed-in host's default schedule. The schedule id never comes from the form. */
async function mySchedule() {
  const user = await store.getCurrentUser();
  return (await store.getDefaultSchedule(user.id)).schedule;
}

/** Reads ranges named `${prefix}-0-from`, `${prefix}-0-to`, `${prefix}-1-from`, … until one is missing. */
function readRanges(form: FormData, prefix: string): Interval[] {
  const out: Interval[] = [];
  for (let i = 0; form.has(`${prefix}-${i}-from`); i++) {
    out.push({ from: String(form.get(`${prefix}-${i}-from`)), to: String(form.get(`${prefix}-${i}-to`) ?? "") });
  }
  return out;
}

const fail = (errors: FieldErrors): FormState => ({ status: "error", errors });
const saved = (): FormState => ({ status: "saved", errors: {}, savedAt: Date.now() });

export async function saveWeeklyHoursAction(_prev: FormState, form: FormData): Promise<FormState> {
  const hours: WeeklyHours = {};
  for (let day = 0; day < 7; day++) hours[day] = form.get(`w${day}-on`) ? readRanges(form, `w${day}`) : [];
  const checked = validateWeeklyHours(hours);
  if (!checked.ok) return fail(checked.errors);
  await store.saveWeeklyHours((await mySchedule()).id, checked.value);
  revalidatePath(PATH);
  return saved();
}

export async function saveDateOverrideAction(_prev: FormState, form: FormData): Promise<FormState> {
  const schedule = await mySchedule();
  const intervals = form.get("ov-kind") === "hours" ? readRanges(form, "ov") : [];
  if (form.get("ov-kind") === "hours" && intervals.length === 0) return fail({ "ov-0-from": "Add at least one range." });
  const checked = validateDateOverride(String(form.get("ov-date") ?? ""), intervals, todayIn(schedule.timezone, new Date()));
  if (!checked.ok) return fail(checked.errors);
  await store.saveDateOverride(schedule.id, checked.value.date, checked.value.intervals);
  revalidatePath(PATH);
  return saved();
}

export async function blockDateRangeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const schedule = await mySchedule();
  const checked = validateDateRange(String(form.get("block-from") ?? ""), String(form.get("block-to") ?? ""), todayIn(schedule.timezone, new Date()));
  if (!checked.ok) return fail(checked.errors);
  await store.blockDateRange(schedule.id, checked.value.from, checked.value.to);
  revalidatePath(PATH);
  return saved();
}

export async function deleteDateOverrideAction(form: FormData): Promise<void> {
  await store.deleteDateOverride((await mySchedule()).id, String(form.get("date") ?? ""));
  revalidatePath(PATH);
}
