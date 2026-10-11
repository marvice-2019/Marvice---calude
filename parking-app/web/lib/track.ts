// Analytics events from SPEC §9. Pushed to window.dataLayer so any tag manager can pick them up;
// no analytics vendor is chosen yet, so nothing is sent anywhere by default.
type Props = Record<string, string | number | boolean | null | undefined>;
declare global { interface Window { dataLayer?: object[] } }

export function track(event: string, props: Props = {}) {
  if (typeof window === "undefined") return;
  (window.dataLayer ??= []).push({ event, ...props });
}
