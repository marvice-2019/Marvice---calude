import { DayToNight } from "@/components/home/DayToNight";
import { FloorBooking } from "@/components/home/FloorBooking";
import { Footer } from "@/components/home/Footer";
import { Gallery } from "@/components/home/Gallery";
import { Header } from "@/components/home/Header";
import { Hero } from "@/components/home/Hero";
import { Marquee } from "@/components/home/Marquee";
import { Menu } from "@/components/home/Menu";
import { Nights } from "@/components/home/Nights";
import { Numbers } from "@/components/home/Numbers";
import { RunTheRoom } from "@/components/home/RunTheRoom";
import { Story } from "@/components/home/Story";
import { Vip } from "@/components/home/Vip";
import { Visit } from "@/components/home/Visit";
import { getHomeData } from "@/lib/home-data";

// Rendered per request: admin edits show at once, and the Docker build needs no database.
export const dynamic = "force-dynamic";

/** Section order is fixed by the brief (§3) and the prototype. */
export default async function Home() {
  const data = await getHomeData();
  return (
    <>
      <Header data={data} />
      <main>
        <Hero data={data} />
        <Marquee data={data} />
        <Story data={data} />
        <RunTheRoom data={data} />
        <DayToNight data={data} />
        <Numbers data={data} />
        <Vip data={data} />
        <Gallery data={data} />
        <Menu data={data} />
        <Nights data={data} />
        <FloorBooking data={data} />
        <Visit data={data} />
      </main>
      <Footer data={data} />
    </>
  );
}
