import { hoursSummary } from "@/components/content/format";
import { MapEmbed, WhatsAppLink } from "@/components/content/islands";
import type { HomeData } from "@/lib/home-data";

const digits = (s: string) => s.replace(/\D/g, "");

/** Address, hours, map and contact (brief §14). Empty WhatsApp/phone are hidden, never rendered as broken links. */
export function Visit({ data }: { data: HomeData }) {
  const s = data.settings;
  const hours = hoursSummary(s.hours);
  const link = "inline-flex min-h-11 items-center rounded-full border border-line px-5 font-semibold hover:border-aqua hover:text-aqua";
  return (
    <section id="visit" aria-labelledby="visit-h" className="px-4 py-24 md:px-10">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-2">
        <div>
          <h2 id="visit-h" className="font-display text-4xl tracking-[-0.05em] md:text-6xl">
            Find the club and kitchen in Koramangala
          </h2>
          {s.address && <address className="mt-6 not-italic text-lg">{s.address}</address>}
          {hours.length > 0 && (
            <ul className="mt-4 space-y-1 text-amber">
              {hours.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          {s.good_to_know.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Good to know">
              {s.good_to_know.map((g) => (
                <li key={g} className="rounded-full border border-line bg-surface px-3 py-1 text-sm">
                  {g}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm text-muted">Valet at the door. Leave the car, keep the night.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {s.maps_url && (
              <a href={s.maps_url} target="_blank" rel="noopener noreferrer" className={link}>
                Directions
              </a>
            )}
            {s.instagram && (
              <a href={s.instagram} target="_blank" rel="noopener noreferrer" className={link}>
                Instagram
              </a>
            )}
            {digits(s.whatsapp) && (
              <WhatsAppLink href={`https://wa.me/${digits(s.whatsapp)}`} className={link}>
                WhatsApp
              </WhatsAppLink>
            )}
            {digits(s.phone) && (
              <a href={`tel:+${digits(s.phone)}`} className={link}>
                Call
              </a>
            )}
          </div>
        </div>
        {s.address && <MapEmbed address={s.address} />}
      </div>
    </section>
  );
}
