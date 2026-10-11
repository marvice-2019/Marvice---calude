import { notFound } from "next/navigation";
import { BookingFooter } from "@/components/BookingFooter";
import { PackageCheckout } from "@/components/PackageCheckout";
import { authEnabled } from "@/lib/auth/auth";
import { formatMoney } from "@/lib/billing/plans";
import { getPool } from "@/lib/data/pg-store";
import { publicPackage } from "@/lib/packages/packages";

export const dynamic = "force-dynamic";

export default async function BuyPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = authEnabled() ? await publicPackage(getPool(process.env.DATABASE_URL as string), id) : null;
  if (!found) notFound();
  const { pkg, host, eventType } = found;
  const price = formatMoney(pkg.priceMinor, "INR");
  const each = formatMoney(Math.round(pkg.priceMinor / pkg.sessions), "INR");
  return (
    <main className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <p className="text-sm font-semibold text-text-muted">{host.name}</p>
      <h1 className="font-display text-xl text-text">{pkg.name}</h1>
      <p className="mt-2 text-text">
        {pkg.sessions} × {eventType.name} ({eventType.durationMinutes} min) for {price}, about {each} a session.
      </p>
      <p className="mt-1 text-text-muted">Book them whenever suits you within {pkg.validDays} days of paying. Cancel a session in time and you get it back.</p>
      <PackageCheckout packageId={pkg.id} price={price} hostName={host.name} packageName={pkg.name} />
      <BookingFooter hostId={host.id} />
    </main>
  );
}
