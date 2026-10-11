import type { Metadata, Viewport } from "next";
import { Archivo, Atkinson_Hyperlegible, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import { Header, OfflineBanner, TabBar } from "@/components/Nav";
import "./globals.css";

// Archivo (condensed widths) for signage-style display, Atkinson Hyperlegible for body: built for low-vision legibility.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const atkinson = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-atkinson", display: "swap" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"], variable: "--font-plex-mono", display: "swap" });

const site = process.env.SITE_URL ?? "http://localhost:3001";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "Bayline — book parking in Bengaluru", template: "%s · Bayline" },
  description: "Find and book a parking bay before you leave. Price with GST shown up front, UPI checkout, and a pass that works at the gate. Valet with live car tracking.",
  openGraph: { siteName: "Bayline", locale: "en_IN", type: "website" },
  alternates: { canonical: "/" }
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F4F6FB" }, { media: "(prefers-color-scheme: dark)", color: "#070D1A" }],
  width: "device-width", initialScale: 1, viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const demo = process.env.DEV_FAKE_PAY === "1";
  return (
    <html lang="en-IN" className={`${archivo.variable} ${atkinson.variable} ${plex.variable}`}>
      <body>
        <a className="sr" href="#main">Skip to content</a>
        {demo && <div className="demo">Demo mode: sample Bengaluru lots and a test payment gateway. No real money moves.</div>}
        <Header />
        <OfflineBanner />
        <main id="main">{children}</main>
        <footer className="footer wrap">
          <strong>Bayline</strong> · Prices include an ₹15 platform fee; GST 18% is shown on every bill.
          <nav aria-label="Footer">
            <Link href="/parking/mg-road">Parking near MG Road</Link>
            <Link href="/parking/koramangala">Koramangala</Link>
            <Link href="/parking/indiranagar">Indiranagar</Link>
            <Link href="/parking/chinnaswamy-stadium">Chinnaswamy Stadium</Link>
            <Link href="/list-your-space">List your space</Link>
            <Link href="/park-now">Park now with a code</Link>
          </nav>
        </footer>
        <TabBar />
      </body>
    </html>
  );
}
