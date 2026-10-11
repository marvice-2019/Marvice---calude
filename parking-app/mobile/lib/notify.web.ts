import type { Booking } from "@/shared/types";

// expo-notifications has no web support; the web preview skips reminders.
export async function scheduleExpiryReminder(_b: Pick<Booking, "id" | "code" | "lot_name" | "to">) { return false; }
export async function cancelExpiryReminder(_bookingId: string) {}
export function onReminderTap(_open: (url: string) => void) { return () => {}; }
