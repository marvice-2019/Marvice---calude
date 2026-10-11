import type { LocationKind } from "./data/types";

/** How a booking's location reads to the guest, on the booking pages and in email. */
export const GUEST_LOCATION_LABELS: Record<LocationKind, string> = {
  google_meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams", phone_host_calls: "Phone call (the host calls you)",
  phone_guest_calls: "Phone call (you call the host)", in_person: "In person", custom: "Details from the host", ask_guest: "Your chosen location",
};
