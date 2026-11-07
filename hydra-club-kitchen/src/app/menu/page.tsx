import type { Metadata } from "next";
import { SubpageShell } from "@/components/content/SubpageShell";
import { Menu } from "@/components/home/Menu";
import { getHomeData } from "@/lib/home-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Menu",
  description: "Food and drinks at Hydra Club & Kitchen, Koramangala: Japanese, North Indian, South Indian, Continental, biryani and Chinese.",
  alternates: { canonical: "/menu" },
};

export default async function MenuPage() {
  const data = await getHomeData();
  return (
    <SubpageShell>
      <Menu data={data} full />
    </SubpageShell>
  );
}
