import { authEnabled } from "@/lib/auth/auth";
import { hostPlan } from "@/lib/billing/account";
import { LIMITS } from "@/lib/billing/plans";
import { getPool } from "@/lib/data/pg-store";
import { LegalLinks } from "./LegalLinks";
import { ThemeSwitch } from "./ThemeSwitch";
import { t, tNodes, type Locale } from "@/lib/i18n/guest";

/**
 * Under a host's booking pages: "Booked with Hourhand" on the Free plan only (the demo data counts as Free), and on
 * every plan the privacy and terms links, because Hourhand handles the details guests enter.
 */
export async function BookingFooter({ hostId, locale = "en" }: { hostId: string; locale?: Locale }) {
  const plan = authEnabled() ? await hostPlan(getPool(process.env.DATABASE_URL as string), hostId) : "free";
  return (
    <footer className="mt-12 flex flex-col items-center gap-2 text-center text-sm text-text-muted">
      {LIMITS[plan].footer && (
        <p>{tNodes(locale, "bookedWith", { brand: <span className="font-semibold text-text">Hourhand</span> })}</p>
      )}
      <LegalLinks className="justify-center" labels={{ nav: t(locale, "legal"), privacy: t(locale, "privacy"), terms: t(locale, "terms") }} />
      <ThemeSwitch labels={{ legend: t(locale, "appearance"), system: t(locale, "themeDevice"), light: t(locale, "themeLight"), dark: t(locale, "themeDark") }} />
    </footer>
  );
}
