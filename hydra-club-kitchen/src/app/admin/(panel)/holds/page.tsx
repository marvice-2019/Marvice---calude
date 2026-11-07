import type { Metadata } from "next";
import { requireUser } from "@/auth/guard";
import { listHolds } from "@/booking/service";
import { serviceDateOf } from "@/booking/time";
import { DeleteButton, HoldForm } from "@/components/admin/forms";
import { FLOOR } from "@/content/floor-plan";
import { getDb } from "@/db";

export const metadata: Metadata = { title: "Holds" };
export const dynamic = "force-dynamic";

const ZONES = [
  { key: "standard", name: "Standard" },
  { key: "vip", name: "VIP" },
  { key: "vvip", name: "VVIP" },
  { key: "mezz", name: "Mezzanine" },
];

/** §8 Holds: block a table or a whole zone for a night (events, private parties). */
export default async function HoldsPage() {
  await requireUser("holds:write");
  const tonight = serviceDateOf(new Date());
  const holds = await listHolds(getDb(), tonight);
  return (
    <>
      <h1 className="font-display text-3xl tracking-[-0.04em]">Holds</h1>
      <p className="text-muted">Held tables can&apos;t be booked online for that night.</p>
      <div className="mt-5">
        <HoldForm tables={FLOOR.tables.map((t) => t.code)} zones={ZONES} defaultDate={tonight} />
      </div>
      <h2 className="mt-8 text-lg font-semibold">Coming up</h2>
      {holds.length === 0 ? (
        <p className="mt-2 text-muted">Nothing blocked.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {holds.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3">
              <p>
                <span className="font-semibold">{h.date}</span> · {h.table ?? ZONES.find((z) => z.key === h.zone)?.name ?? h.zone} · {h.reason}
              </p>
              <DeleteButton url={`/api/admin/holds?id=${h.id}`} label="Remove" confirmText="Remove this hold? The tables open for booking again." okText="Hold removed." />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
