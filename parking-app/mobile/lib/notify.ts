import * as Notifications from "expo-notifications";
import type { Booking } from "@/shared/types";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false })
});

const REMIND_BEFORE_MS = 15 * 60_000;

/**
 * Local reminder 15 minutes before a pass expires, so the driver can extend before overstay charges.
 * Local (not server push) because it must fire even with no signal; the API's WhatsApp reminder covers the rest.
 * Idempotent: one reminder per booking id, rescheduled when the end time changes (after an extension).
 */
export async function scheduleExpiryReminder(b: Pick<Booking, "id" | "code" | "lot_name" | "to">) {
  const at = Date.parse(b.to) - REMIND_BEFORE_MS;
  if (at <= Date.now()) return false;
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;
  const id = `expiry-${b.id}`;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title: "15 minutes left", body: `${b.lot_name} · ${b.code}. Tap to add an hour.`, data: { url: `/passes?focus=${b.id}` } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at }
  });
  return true;
}

export async function cancelExpiryReminder(bookingId: string) {
  await Notifications.cancelScheduledNotificationAsync(`expiry-${bookingId}`).catch(() => undefined);
}

/** Tapping the reminder opens the pass. Returns an unsubscribe function. */
export function onReminderTap(open: (url: string) => void) {
  const sub = Notifications.addNotificationResponseReceivedListener(r => {
    const url = r.notification.request.content.data?.url;
    if (typeof url === "string") open(url);
  });
  return () => sub.remove();
}
