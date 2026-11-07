import { formatRupees } from "@/components/content/format";
import { MenuSeen } from "@/components/content/islands";
import type { HomeData } from "@/lib/home-data";

/** FSSAI-style marker: square with a dot (veg) or triangle (non-veg), plus a text label. */
export function VegMark({ veg }: { veg: boolean }) {
  const c = veg ? "#2fa84f" : "#c0392b";
  return (
    <span className="inline-flex items-center">
      <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden="true">
        <rect x="1" y="1" width="14" height="14" fill="#fff" stroke={c} strokeWidth="2" />
        {veg ? <circle cx="8" cy="8" r="3.5" fill={c} /> : <path d="M8 4 12 11H4Z" fill={c} />}
      </svg>
      <span className="sr-only">{veg ? "Vegetarian" : "Non-vegetarian"}</span>
    </span>
  );
}

/** Menu from the database (brief §10). No dishes or prices are ever invented. */
export function Menu({ data, full = false }: { data: HomeData; full?: boolean }) {
  const { cuisines, cost_for_two_inr: cost, instagram } = data.settings;
  const H = full ? "h1" : "h2";
  return (
    <section id="menu" aria-labelledby="menu-h" className="relative px-4 py-24 md:px-10">
      <MenuSeen />
      <div className="mx-auto max-w-6xl">
        <H id="menu-h" className="font-display text-4xl tracking-[-0.05em] md:text-6xl">
          The kitchen
        </H>
        <p className="mt-3 max-w-xl text-muted">
          {cuisines.length > 0 && <>{cuisines.join(" · ")}. </>}
          {cost && <>About {formatRupees(cost * 100)} for two.</>}
        </p>
        {data.menu.length === 0 ? (
          <div data-testid="menu-empty" className="mt-10 rounded-3xl border border-line bg-surface/70 p-6 md:p-10">
            <ul className="flex flex-wrap gap-2">
              {cuisines.map((c) => (
                <li key={c} className="rounded-full border border-line px-4 py-2 text-sm">
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
              <span className="inline-flex items-center gap-2"><VegMark veg /> Veg</span>
              <span className="inline-flex items-center gap-2"><VegMark veg={false} /> Non-veg</span>
              <span>Both, on every page of the menu.</span>
            </p>
            <p className="mt-6 text-lg">
              Full menu coming soon.
              {instagram && (
                <>
                  {" "}
                  Dishes drop first on{" "}
                  <a href={instagram} className="text-aqua underline underline-offset-4" target="_blank" rel="noopener noreferrer">
                    Instagram
                  </a>
                  .
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="mt-10 grid gap-10 md:grid-cols-2">
            {data.menu.map((cat) => (
              <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
                <h3 id={`cat-${cat.id}`} className="border-b border-line pb-2 font-display text-2xl tracking-[-0.05em] text-amber">
                  {cat.name}
                </h3>
                <ul className="mt-4 space-y-4">
                  {cat.items.map((i) => (
                    <li key={i.id} className="grid grid-cols-[auto_1fr_auto] gap-x-3">
                      <span className="pt-1"><VegMark veg={i.veg} /></span>
                      <span>
                        <span className="font-semibold">{i.name}</span>
                        {i.description && <span className="block text-sm text-muted">{i.description}</span>}
                      </span>
                      <span className="tabular-nums">{i.pricePaise != null ? formatRupees(i.pricePaise) : ""}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
