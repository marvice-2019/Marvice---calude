import { formatRupees } from "@/components/content/format";
import { PickZone } from "@/components/content/islands";
import { VIP_CARDS } from "@/content/site";
import type { HomeData } from "@/lib/home-data";

const KEYS = ["vip", "vvip", "mezz"] as const;

/** Three zone cards with rotating conic borders; each jumps to its zone on the floor plan (brief §8). */
export function Vip({ data }: { data: HomeData }) {
  const cards = KEYS.flatMap((key) => {
    const z = data.zones.find((x) => x.key === key);
    return z ? [{ key, z }] : [];
  });
  return (
    <section id="vip" aria-labelledby="vip-h" className="px-4 py-24 md:px-10">
      <div className="mx-auto max-w-6xl">
        <h2 id="vip-h" className="font-display text-4xl tracking-[-0.05em] md:text-6xl">
          VIP table booking, Bengaluru
        </h2>
        <p className="mt-3 max-w-xl text-muted">Pick your altitude. Tap a card to see it on the floor plan.</p>
        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {cards.map(({ key, z }) => (
            <li key={key} className="hy-conic rounded-3xl p-px" style={{ "--zone": z.colour } as React.CSSProperties}>
              <PickZone
                zone={key}
                className="flex h-full min-h-56 w-full flex-col rounded-3xl bg-surface/95 p-6 text-left backdrop-blur"
              >
                <span className="font-display text-3xl tracking-[-0.05em]">{z.name}</span>
                <span className="mt-3 text-muted">{z.note || VIP_CARDS[key].body}</span>
                <span className="mt-auto flex flex-wrap gap-2 pt-6 text-sm">
                  <span className="rounded-full border border-line px-3 py-1">
                    {z.tableCount} {z.tableCount === 1 ? "table" : "tables"}
                  </span>
                  {z.seats != null && <span className="rounded-full border border-line px-3 py-1">Seats up to {z.seats}</span>}
                  {z.minSpendPaise != null && (
                    <span className="rounded-full border border-line px-3 py-1">Min spend {formatRupees(z.minSpendPaise)}</span>
                  )}
                </span>
                <span className="mt-4 text-sm font-semibold text-aqua">See it on the floor plan →</span>
              </PickZone>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
