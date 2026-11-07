import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Syne } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font (no runtime request to Google).
const syne = Syne({ subsets: ["latin"], weight: ["800"], variable: "--font-syne", display: "swap" });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Hydra Club & Kitchen · Nightclub in Koramangala, Bengaluru", template: "%s · Hydra Club & Kitchen" },
  description: "Eat first. Stay late. Club and kitchen in Koramangala, Bengaluru. Book a table, VIP or VVIP, in under a minute.",
};

export const viewport: Viewport = { themeColor: "#03070D", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${syne.variable} ${instrument.variable}`}>
      <body className="min-h-dvh bg-bg text-text">{children}</body>
    </html>
  );
}
