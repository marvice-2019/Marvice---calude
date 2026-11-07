import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Hydra Club & Kitchen", template: "%s · Hydra Club & Kitchen" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body style={{ margin: 0, background: "#03070D" }}>{children}</body>
    </html>
  );
}
