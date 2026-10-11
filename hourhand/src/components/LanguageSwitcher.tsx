import Link from "next/link";
import { focusRing } from "@/components/ui/focus";
import { LOCALES, LOCALE_NAMES, t, type Locale } from "@/lib/i18n/guest";

/** Links to the same guest page in each language; other query parameters (like a suggested time) are kept. */
export function LanguageSwitcher({ locale, path, params = {} }: { locale: Locale; path: string; params?: Record<string, string | undefined> }) {
  const href = (l: Locale) => {
    const all: Record<string, string | undefined> = { ...params, lang: l };
    const q = new URLSearchParams(Object.entries(all).filter((e): e is [string, string] => typeof e[1] === "string"));
    return `${path}?${q}`;
  };
  return (
    <nav aria-label={t(locale, "language")} className="mb-4 flex flex-wrap gap-x-3 text-sm">
      {LOCALES.map((l) => (
        <Link key={l} href={href(l)} lang={l} hrefLang={l} aria-current={l === locale ? "true" : undefined}
          className={`inline-flex min-h-11 items-center rounded-sm ${l === locale ? "font-semibold text-text" : "text-accent underline"} ${focusRing}`}>
          {LOCALE_NAMES[l]}
        </Link>
      ))}
    </nav>
  );
}
