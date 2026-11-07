import type { Metadata } from "next";
import { SubpageShell } from "@/components/content/SubpageShell";
import { Gallery } from "@/components/home/Gallery";
import { getHomeData } from "@/lib/home-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Photos from Hydra Club & Kitchen, the nightclub and kitchen in Koramangala, Bengaluru: the club, the kitchen, the bar and the floor.",
  alternates: { canonical: "/gallery" },
};

export default async function GalleryPage() {
  const data = await getHomeData();
  return (
    <SubpageShell>
      <Gallery data={data} full />
    </SubpageShell>
  );
}
