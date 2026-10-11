import { authEnabled } from "@/lib/auth/auth";
import { hostPlan } from "@/lib/billing/account";
import { LIMITS } from "@/lib/billing/plans";
import { getPool } from "@/lib/data/pg-store";

/** "Booked with Hourhand" under a host's booking pages, on the Free plan only. The demo data counts as Free. */
export async function BookingFooter({ hostId }: { hostId: string }) {
  const plan = authEnabled() ? await hostPlan(getPool(process.env.DATABASE_URL as string), hostId) : "free";
  if (!LIMITS[plan].footer) return null;
  return (
    <footer className="mt-12 text-center text-sm text-text-muted">
      Booked with <span className="font-semibold text-text">Hourhand</span>
    </footer>
  );
}
