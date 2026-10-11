import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--hh-font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--hh-font-sans", display: "swap" });

export const metadata: Metadata = {
  // Absolute URLs for the share image and canonical links; BETTER_AUTH_URL is the public address in production.
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? "https://hourhand.cloud"),
  title: "Hourhand",
  description: "Share one link and let people book a time that suits you both.",
  openGraph: { siteName: "Hourhand", type: "website" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Font variables sit on body so they override the fallback stacks defined on :root in tokens.css. */}
      <body className={`${display.variable} ${sans.variable} bg-bg font-sans text-text antialiased`}>{children}</body>
    </html>
  );
}
