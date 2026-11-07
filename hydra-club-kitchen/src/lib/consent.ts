/**
 * Cookie consent (brief §9). Nothing beyond strictly necessary cookies runs
 * until the visitor chooses. Values: "all" (analytics + ads), "analytics",
 * "none". UK/EU visitors get granular choices; everyone else Accept / Only
 * essential. The choice is kept for 180 days.
 */
export const CONSENT_COOKIE = "hydra_consent";
export type Consent = "all" | "analytics" | "none";

export function parseConsent(cookieHeader: string | null | undefined): Consent | null {
  const m = /(?:^|;\s*)hydra_consent=(all|analytics|none)(?:;|$)/.exec(cookieHeader ?? "");
  return (m?.[1] as Consent | undefined) ?? null;
}

export const allowsAnalytics = (c: Consent | null) => c === "all" || c === "analytics";
export const allowsAds = (c: Consent | null) => c === "all";

/** Stricter UK/EU mode, decided from the browser's time zone (no IP geolocation needed). */
export const isStrictRegion = (timeZone: string) => /^Europe\//.test(timeZone) || timeZone === "Atlantic/Reykjavik" || timeZone === "Atlantic/Canary";
