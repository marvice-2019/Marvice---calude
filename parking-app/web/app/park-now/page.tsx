import type { Metadata } from "next";
import { ParkNow } from "./ParkNow";

export const metadata: Metadata = { title: "Park now", description: "Already at the gate? Enter the lot code and pay for the hours you need." };

export default async function ParkNowPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const { area } = await searchParams;
  return <ParkNow areaSlug={area} />;
}
