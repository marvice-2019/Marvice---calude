import { BlockRangeForm, DateOverrideForm, WeeklyHoursForm } from "@/components/AvailabilityForms";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { todayIn } from "@/lib/availability";
import { store, type Interval } from "@/lib/data";
import { deleteDateOverrideAction } from "./actions";

export const dynamic = "force-dynamic";

function zoneName(timezone: string): string {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
  return part ? `${part.value} (${timezone})` : timezone;
}

const longDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const hoursText = (intervals: Interval[]) => (intervals.length ? intervals.map((i) => `${i.from}–${i.to}`).join(", ") : "Unavailable");

export default async function AvailabilityPage() {
  const user = await store.getCurrentUser();
  const { schedule, rules } = await store.getDefaultSchedule(user.id);
  const today = todayIn(schedule.timezone, new Date());

  const weekly: Record<number, Interval[]> = {};
  const overrides: { date: string; intervals: Interval[] }[] = [];
  for (const r of rules) {
    if (r.kind === "weekly") weekly[r.weekday] = r.intervals;
    else if (r.onDate >= today) overrides.push({ date: r.onDate, intervals: r.intervals });
  }
  overrides.sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-xl text-text">Availability</h1>
        <p className="mt-2 text-text-muted">Set the hours people can book you each week, plus days off.</p>
        <p className="mt-2 text-text">
          All times are in <strong>{zoneName(schedule.timezone)}</strong>.
        </p>
      </div>

      <Card>
        <h2 className="font-display text-lg text-text">Weekly hours</h2>
        <WeeklyHoursForm initial={weekly} />
      </Card>

      <Card className="space-y-6">
        <section aria-labelledby="overrides-heading">
          <h2 id="overrides-heading" className="font-display text-lg text-text">Date overrides</h2>
          <p className="mt-1 text-text-muted">Change your hours for a single day. Overrides win over your weekly hours.</p>
          {overrides.length === 0 ? (
            <p className="mt-4 rounded-md bg-surface p-4 text-text-muted">No date overrides. Add one when your hours change for a day.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {overrides.map((o) => (
                <li key={o.date} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-text">
                    <span className="font-semibold">{longDate(o.date)}</span>
                    <span className="text-text-muted"> · {hoursText(o.intervals)}</span>
                  </span>
                  <form action={deleteDateOverrideAction}>
                    <input type="hidden" name="date" value={o.date} />
                    <Button type="submit" variant="ghost">
                      Remove<span className="sr-only"> override for {longDate(o.date)}</span>
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="add-override-heading" className="border-t border-border pt-6">
          <h3 id="add-override-heading" className="font-semibold text-text">Add an override</h3>
          <div className="mt-3">
            <DateOverrideForm today={today} />
          </div>
        </section>

        <section aria-labelledby="block-heading" className="border-t border-border pt-6">
          <h3 id="block-heading" className="font-semibold text-text">Block a stretch of days</h3>
          <p className="mt-1 text-text-muted">Going away? Pick the first and last day and nobody can book you in between.</p>
          <div className="mt-3">
            <BlockRangeForm today={today} />
          </div>
        </section>
      </Card>
    </div>
  );
}
