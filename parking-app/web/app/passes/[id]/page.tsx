import type { Metadata } from "next";
import { PassWait } from "./PassWait";

export const metadata: Metadata = { title: "Your pass", robots: { index: false } };

export default async function PassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PassWait id={id} />;
}
