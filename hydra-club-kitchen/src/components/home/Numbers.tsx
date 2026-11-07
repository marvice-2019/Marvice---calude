import { CountUp } from "@/components/content/islands";
import { numbersFor } from "@/components/content/format";
import type { HomeData } from "@/lib/home-data";

/** Count-up stats, all derived from the database (brief §7). Nothing true to show → no band. */
export function Numbers({ data }: { data: HomeData }) {
  const stats = numbersFor({
    totalTables: data.totalTables,
    zones: data.zones,
    hours: data.settings.hours,
    costForTwoInr: data.settings.cost_for_two_inr,
  });
  if (stats.length === 0) return <section id="numbers" aria-hidden="true" />;
  return (
    <section id="numbers" aria-labelledby="numbers-h" className="border-y border-line px-4 py-16 md:px-10">
      <h2 id="numbers-h" className="sr-only">Hydra in numbers</h2>
      <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col-reverse gap-1">
            <dt className="text-sm text-muted">{s.label}</dt>
            <dd className="hy-num font-display text-5xl tracking-[-0.05em] md:text-6xl">
              <CountUp value={s.value} prefix={s.prefix} />
              <span className="sr-only">
                {s.prefix}
                {s.value.toLocaleString("en-IN")}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
