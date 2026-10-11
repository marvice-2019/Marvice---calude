import type { Metadata, Viewport } from "next";
import { Archivo, Atkinson_Hyperlegible, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const atkinson = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-atkinson", display: "swap" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Bayline — Book parking in Bengaluru", template: "%s · Bayline" },
  description: "Find and pre-book parking in Bengaluru. See the full price with GST before you pay, pay by UPI, and get your pass on WhatsApp.",
  applicationName: "Bayline",
  openGraph: { siteName: "Bayline", locale: "en_IN", type: "website" }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#FFFFFF" }, { media: "(prefers-color-scheme: dark)", color: "#141C2E" }]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${archivo.variable} ${atkinson.variable} ${plex.variable}`}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        {process.env.NEXT_PUBLIC_SAMPLE_DATA_NOTICE !== "off" && (
          <div className="notice">Early access. Sample lots and prices for Bengaluru.</div>
        )}
        <OfflineBanner />
        <header className="top">
          <Link href="/" className="brand"><span className="p-sign" aria-hidden="true">P</span>Bayline</Link>
          <Nav variant="tabs" />
        </header>
        <main id="main">{children}</main>
        <footer className="site">
          <span>© Bayline</span>
          <Link href="/parking/bengaluru">Parking in Bengaluru</Link>
          <Link href="/list-your-space">List your space</Link>
          <Link href="/account">Account</Link>
        </footer>
        <Nav variant="bottom" />
      </body>
    </html>
  );
}
