import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Syne } from "next/font/google";
import { headers } from "next/headers";
import { Analytics } from "@/components/Analytics";
import { SITE_NAME, siteUrl } from "@/lib/seo";
import "./globals.css";

// Self-hosted at build time by next/font (no runtime request to Google).
const syne = Syne({ subsets: ["latin"], weight: ["800"], variable: "--font-syne", display: "swap" });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });

const description =
  "Eat first. Stay late. Nightclub and kitchen in Koramangala, Bengaluru: dance floor, VIP and VVIP tables, live sports, food till late. Book a table in under a minute.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} · Nightclub in Koramangala, Bengaluru`, template: `%s · ${SITE_NAME}` },
  description,
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_IN", title: `${SITE_NAME} · Eat first. Stay late.`, description, url: "/" },
  twitter: { card: "summary_large_image", title: `${SITE_NAME} · Eat first. Stay late.`, description },
};

export const viewport: Viewport = { themeColor: "#03070D", colorScheme: "dark" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request's CSP nonce makes every page render per request, which the nonce needs.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en-IN" className={`${syne.variable} ${instrument.variable}`}>
      <body className="min-h-dvh bg-bg text-text">
        {children}
        <Analytics ga4Id={process.env.GA4_ID} pixelId={process.env.META_PIXEL_ID} nonce={nonce} />
      </body>
    </html>
  );
}
