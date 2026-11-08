import type { Metadata } from "next";
import Link from "next/link";
import { Emblem } from "@/components/Emblem";
import { FloorBooking } from "@/components/home/FloorBooking";
import { getHomeData } from "@/lib/home-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book a table",
  description: "Book a table, VIP or VVIP at Hydra Club & Kitchen, Koramangala, Bengaluru. Pick your night, time and table in under a minute.",
  alternates: { canonical: "/book" },
};

/** Deep-linkable booking: /book?date=YYYY-MM-DD&table=T4 pre-selects the night and table. */
export default async function BookPage({ searchParams }: { searchParams: Promise<{ date?: string; table?: string }> }) {
  const [data, q] = await Promise.all([getHomeData(), searchParams]);
  const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : undefined;
  const table = typeof q.table === "string" && /^[A-Z0-9-]{1,10}$/i.test(q.table) ? q.table.toUpperCase() : undefined;
  return (
    <>
      <header id="top" className="flex items-center justify-between px-4 py-4 md:px-8 lg:px-16">
        <Link href="/" className="flex min-h-11 items-center gap-2 font-display text-lg tracking-[-0.05em]">
          <Emblem className="size-9" title="" />
          Hydra
        </Link>
        <Link href="/#visit" className="min-h-11 content-center text-sm text-muted underline-offset-4 hover:underline">
          How to find us
        </Link>
      </header>
      <main>
        <FloorBooking data={data} initial={{ date, table }} />
      </main>
    </>
  );
}
