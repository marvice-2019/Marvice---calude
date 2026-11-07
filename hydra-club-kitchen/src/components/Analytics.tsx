"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { allowsAds, allowsAnalytics, CONSENT_COOKIE, isStrictRegion, parseConsent, type Consent } from "@/lib/consent";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; callMethod?: (...a: unknown[]) => void };
  }
}

function loadScript(src: string, nonce?: string) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  if (nonce) s.nonce = nonce;
  document.head.appendChild(s);
}

function startGa(id: string, nonce?: string) {
  if (window.gtag) return;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", id, { anonymize_ip: true });
  loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`, nonce);
}

function startPixel(id: string, nonce?: string) {
  if (window.fbq) return;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue!.push(args);
  } as NonNullable<Window["fbq"]>;
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = "2.0";
  window.fbq = fbq;
  loadScript("https://connect.facebook.net/en_US/fbevents.js", nonce);
  fbq("init", id);
  fbq("track", "PageView");
}

/**
 * Consent banner + GA4 / Meta Pixel loader. Off on /admin. Scripts load only
 * after consent, with the request's CSP nonce.
 */
export function Analytics({ ga4Id, pixelId, nonce }: { ga4Id?: string; pixelId?: string; nonce?: string }) {
  const path = usePathname();
  const [consent, setConsent] = useState<Consent | null | undefined>(undefined);
  const [strict, setStrict] = useState(false);
  const [choice, setChoice] = useState({ analytics: false, ads: false });

  useEffect(() => {
    setConsent(parseConsent(document.cookie));
    setStrict(isStrictRegion(Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, []);

  useEffect(() => {
    if (!consent) return;
    if (ga4Id && allowsAnalytics(consent)) startGa(ga4Id, nonce);
    if (pixelId && allowsAds(consent)) startPixel(pixelId, nonce);
  }, [consent, ga4Id, pixelId, nonce]);

  if (path?.startsWith("/admin") || consent !== null || (!ga4Id && !pixelId)) return null;

  const save = (c: Consent) => {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${CONSENT_COOKIE}=${c}; Max-Age=${180 * 86400}; Path=/; SameSite=Lax${secure}`;
    setConsent(c);
  };

  return (
    <div role="dialog" aria-label="Cookie choices" className="fixed inset-x-3 bottom-3 z-[85] mx-auto max-w-xl rounded-2xl border border-line bg-surface/95 p-4 text-sm shadow-2xl backdrop-blur md:bottom-6">
      <p>
        We use cookies to see which ads and posts bring guests in. Booking works either way.{" "}
        <a href="/privacy" className="underline underline-offset-4">
          Privacy
        </a>
      </p>
      {strict && (
        <div className="mt-3 grid gap-2">
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="size-5" checked={choice.analytics} onChange={(e) => setChoice({ ...choice, analytics: e.target.checked })} /> Analytics (Google Analytics)
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="size-5" checked={choice.ads} onChange={(e) => setChoice({ ...choice, ads: e.target.checked })} /> Advertising (Meta)
          </label>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {strict ? (
          <>
            <button type="button" onClick={() => save("none")} className="min-h-11 flex-1 rounded-xl border border-line px-4 font-semibold">
              Reject all
            </button>
            <button
              type="button"
              onClick={() => save(choice.ads ? "all" : choice.analytics ? "analytics" : "none")}
              className="min-h-11 flex-1 rounded-xl border border-line px-4 font-semibold"
            >
              Save choices
            </button>
            <button type="button" onClick={() => save("all")} className="min-h-11 flex-1 rounded-xl border border-line px-4 font-semibold">
              Accept all
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => save("none")} className="min-h-11 flex-1 rounded-xl border border-line px-4">
              Only essential
            </button>
            <button type="button" onClick={() => save("all")} className="min-h-11 flex-1 rounded-xl bg-aqua px-4 font-semibold text-on-aqua">
              Accept
            </button>
          </>
        )}
      </div>
    </div>
  );
}
