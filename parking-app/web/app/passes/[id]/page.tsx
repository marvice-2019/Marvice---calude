import type { Metadata } from "next";
import { PassWait } from "./PassWait";

export const metadata: Metadata = { title: "Your pass", robots: { index: false } };

export default async function PassPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { id } = await params;
  const { new: fresh } = await searchParams;
  return <PassWait id={id} fresh={fresh === "1"} />;
}
