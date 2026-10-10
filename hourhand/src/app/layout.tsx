import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--hh-font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--hh-font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Hourhand",
  description: "Share one link and let people book a time that suits you both.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Font variables sit on body so they override the fallback stacks defined on :root in tokens.css. */}
      <body className={`${display.variable} ${sans.variable} bg-bg font-sans text-text antialiased`}>{children}</body>
    </html>
  );
}
