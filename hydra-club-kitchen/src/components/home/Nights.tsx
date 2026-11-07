import { nextNightDate } from "@/components/content/format";
import { PickDate } from "@/components/content/islands";
import type { HomeData } from "@/lib/home-data";

const ACCENT = { rose: "#ff4f8b", amber: "var(--amber)", aqua: "var(--aqua)" } as const;

/** Flyer cards with light beams; swipe row on phones (brief §11). No nights → Instagram pointer, no invented events. */
export function Nights({ data }: { data: HomeData }) {
  const { instagram, booking_window_days } = data.settings;
  const now = new Date();
  return (
    <section id="nights" aria-labelledby="nights-h" className="px-4 py-24 md:px-10">
      <div className="mx-auto max-w-6xl">
        <h2 id="nights-h" className="font-display text-4xl tracking-[-0.05em] md:text-6xl">
          Nights at the club
        </h2>
        {data.nights.length === 0 ? (
          <div data-testid="nights-empty" className="hy-beams mt-8 overflow-hidden rounded-3xl border border-line bg-surface/70 p-6 md:p-10">
            <p className="relative text-lg">Weekly nights are announced on Instagram.</p>
            {instagram && (
              <a
                href={instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="relative mt-5 inline-flex min-h-11 items-center rounded-full border border-aqua px-5 font-semibold text-aqua hover:bg-aqua hover:text-on-aqua"
              >
                See this week on Instagram
              </a>
            )}
          </div>
        ) : (
          <ul className="-mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
            {data.nights.map((n) => {
              const date = data.bookingOpen ? nextNightDate(n.ctaDateRule ?? "", now, booking_window_days) : null;
              return (
                <li
                  key={n.id}
                  className="hy-beams relative flex w-[82%] shrink-0 snap-center flex-col overflow-hidden rounded-3xl border border-line bg-surface p-6 md:w-auto"
                  style={{ "--accent": ACCENT[n.accent] } as React.CSSProperties}
                >
                  <p className="relative text-sm font-semibold uppercase tracking-widest" style={{ color: ACCENT[n.accent] }}>
                    {n.days}
                  </p>
                  <h3 className="relative mt-3 font-display text-3xl tracking-[-0.05em]">{n.title}</h3>
                  <p className="relative mt-3 text-muted">{n.blurb}</p>
                  {date && (
                    <PickDate
                      date={date}
                      className="relative mt-auto min-h-11 self-start rounded-full bg-aqua px-5 font-semibold text-on-aqua"
                    >
                      Pick a table for this night
                    </PickDate>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
