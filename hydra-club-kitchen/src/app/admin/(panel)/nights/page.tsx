import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUser } from "@/auth/guard";
import { NightForm } from "@/components/admin/content-forms";
import { DeleteButton } from "@/components/admin/forms";
import { getDb } from "@/db";
import { nights } from "@/db/schema";

export const metadata: Metadata = { title: "Nights" };
export const dynamic = "force-dynamic";

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** §8 Nights: the weekly flyers on the site. "Pick a table for this night" pre-fills the next matching date. */
export default async function NightsAdminPage() {
  await requireUser("content:write");
  const rows = await getDb().select().from(nights).orderBy(asc(nights.sort), asc(nights.id));
  return (
    <>
      <h1 className="font-display text-3xl tracking-[-0.04em]">Nights</h1>
      <div className="mt-5">
        <NightForm />
      </div>
      {rows.length === 0 ? (
        <p className="mt-6 text-muted">No nights yet. The site points guests to Instagram for line-ups until you add some.</p>
      ) : (
        <ul className="mt-6 grid gap-2">
          {rows.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3">
              <div>
                <p className="font-semibold">
                  {n.title} <span className="font-normal text-muted">· {n.days}</span>
                </p>
                <p className="text-sm text-muted">{n.blurb}</p>
                <p className="text-xs text-muted">
                  Booking button: {n.ctaDateRule ? `next ${n.ctaDateRule.split(",").map((d) => DAY[Number(d)]).join(" or ")}` : "hidden (no weekday set)"} · colour {n.accent}
                </p>
              </div>
              <DeleteButton url={`/api/admin/content/nights?id=${n.id}`} label="Delete" confirmText={`Delete ${n.title}?`} okText="Night deleted." />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
