import { BookingPlanner } from "@/components/booking/BookingPlanner";
import { bookableDates } from "@/booking/time";
import type { HomeData } from "@/lib/home-data";

/**
 * §3.12–13 floor plan + booking. Server part: works out the bookable nights and
 * settings, so the client island never imports DB code. With booking closed
 * (no confirmed hours or switched off) it shows how to reach the venue instead.
 */
export function FloorBooking({ data, initial }: { data: HomeData; initial?: { date?: string; table?: string } }) {
  const { settings } = data;
  return (
    <section id="floor" aria-labelledby="floor-heading" className="scroll-mt-20 px-4 py-20 md:px-8 lg:px-16" tabIndex={-1}>
      <div className="mx-auto max-w-7xl">
        <p className="text-sm tracking-[0.2em] text-neon uppercase">Floor plan</p>
        <h2 id="floor-heading" className="mt-2 font-display text-[clamp(2.4rem,7vw,5rem)] leading-[0.95] tracking-[-0.05em]">
          Pick your table
        </h2>
        <p className="mt-3 max-w-xl text-muted">
          VIP table booking in Bengaluru, done in under a minute: choose the night and time, tap a free table, leave your number.
        </p>
        <div className="mt-8">
          {data.bookingOpen ? (
            <BookingPlanner
              dates={bookableDates(new Date(), settings.booking_window_days)}
              initialDate={initial?.date}
              initialTable={initial?.table}
              zones={data.zones.map(({ key, name, colour, note }) => ({ key, name, colour, note }))}
              maxGuests={settings.max_guests_per_table}
              whatsapp={settings.whatsapp}
              instagram={settings.instagram}
            />
          ) : (
            <div className="rounded-2xl border border-line bg-surface p-6">
              <p className="text-lg">Online booking opens soon.</p>
              <p className="mt-1 text-muted">Until then, message us and we&apos;ll hold a table for you.</p>
              {settings.instagram && (
                <a
                  href={settings.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-neon px-5 font-semibold text-on-aqua"
                >
                  Message us on Instagram
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
