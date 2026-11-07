/**
 * Analytics events (brief §9). Forwarded to GA4 / Meta Pixel only when they
 * were loaded, which happens only after consent (components/Analytics.tsx).
 * booking_submit with a ref also fires Meta "Lead" with eventID = ref, so the
 * server-side Conversions API event (same id) is de-duplicated.
 */
export type TrackEvent = "table_pick" | "booking_submit" | "whatsapp_click" | "drop_click" | "sound_on" | "menu_view";

export function track(event: TrackEvent, params: Record<string, string | number | boolean> = {}): void {
  if (typeof window === "undefined") return;
  window.gtag?.("event", event, params);
  if (event === "booking_submit" && typeof params.ref === "string") {
    window.fbq?.("track", "Lead", { content_name: "Table booking" }, { eventID: params.ref });
  }
}
