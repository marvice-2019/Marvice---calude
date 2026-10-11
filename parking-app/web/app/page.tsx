import { defaultWindow } from "@/lib/format";
import { areaBySlug } from "@/lib/places";
import { FindView, type FindParams } from "./FindView";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isoOr = (v: string | undefined, d: Date) => (v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : d.toISOString());

export default async function FindPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const w = defaultWindow();
  const initial: FindParams = {
    area: areaBySlug(one(sp.area)).slug,
    from: isoOr(one(sp.from), w.from),
    to: isoOr(one(sp.to), w.to),
    vehicle: one(sp.vehicle) === "bike" ? "bike" : "car",
    sort: (["dist", "price", "left"] as const).find(s => s === one(sp.sort)) ?? "dist"
  };
  return <FindView initial={initial} />;
}
