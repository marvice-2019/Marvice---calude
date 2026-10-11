import * as Haptics from "expo-haptics";
import type { PayOutcome } from "./pay";

/** A short buzz so the driver feels the payment result without reading the screen (car park, one hand on the wheel). */
export function payHaptic(outcome: PayOutcome) {
  if (outcome === "cancelled") return;
  Haptics.notificationAsync(outcome === "paid" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}
