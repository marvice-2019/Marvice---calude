import { DayClock } from "@/components/fx/DayClock";
import { DAY_TO_NIGHT } from "@/content/site";
import type { HomeData } from "@/lib/home-data";

/** §3.6 Day-to-night clock. Hours shown here are the confirmed 11:30 AM–1 AM day. */
export function DayToNight({ data }: { data: HomeData }) {
  void data;
  return (
    <section id="day-to-night" aria-labelledby="clock-heading" className="relative">
      <h2 id="clock-heading" className="sr-only">
        From lunch to last call
      </h2>
      <DayClock panels={DAY_TO_NIGHT} />
    </section>
  );
}
