/**
 * Analytics events (brief §9). Call sites are wired now; stage 6 connects GA4
 * and Meta Pixel behind the consent banner. Until then this is a no-op.
 */
export type TrackEvent = "table_pick" | "booking_submit" | "whatsapp_click" | "drop_click" | "sound_on" | "menu_view";

export function track(event: TrackEvent, params: Record<string, string | number | boolean> = {}): void {
  void event;
  void params;
}
