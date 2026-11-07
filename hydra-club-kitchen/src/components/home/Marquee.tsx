import { MarqueeSpeed } from "@/components/fx/MarqueeSpeed";
import { MARQUEE } from "@/content/site";
import type { HomeData } from "@/lib/home-data";

/** §3.3 Ticker. The list is rendered twice so the loop is seamless; the copy is hidden from screen readers. */
export function Marquee({ data }: { data: HomeData }) {
  void data;
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-10 pr-10" aria-hidden={hidden || undefined}>
      {MARQUEE.map((item) => (
        <li key={item} className="flex items-center gap-10 font-display text-[clamp(1.6rem,5vw,3rem)] tracking-[-0.05em] whitespace-nowrap">
          {item}
          <span className="size-2 rounded-full bg-aqua shadow-[0_0_12px_var(--aqua)]" aria-hidden="true" />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="relative overflow-hidden border-y border-line bg-surface py-5" aria-label="What's inside">
      <MarqueeSpeed>
        <div className="hydra-marquee flex w-max">
          {row(false)}
          {row(true)}
        </div>
      </MarqueeSpeed>
    </div>
  );
}
