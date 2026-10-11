import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { authEnabled } from "@/lib/auth/auth";
import { requireOwnAccount } from "@/lib/auth/session";
import { hostPlan } from "@/lib/billing/account";
import { parseKey } from "@/lib/crypto/seal";
import { getPool } from "@/lib/data/pg-store";
import { maskKeyId, razorpayStatus } from "@/lib/payments/host-razorpay";
import { connectRazorpay, disconnectRazorpayAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  format: "That doesn't look like a Razorpay key pair. Key IDs start with rzp_test_ or rzp_live_.",
  rejected: "Razorpay didn't accept those keys. Copy them again from the dashboard.",
  unreachable: "Couldn't reach Razorpay to check the keys. Try again in a minute.",
  not_configured: "Payments aren't set up on this server yet.",
  demo: "The demo data can't connect Razorpay.",
  busy: "A guest's payment is still being confirmed or refunded through this account. Disconnect once it settles, usually within a few minutes.",
};

/** True when the server can encrypt stored keys; a missing or malformed TOKEN_ENCRYPTION_KEY means it can't. */
function encryptionReady(): boolean {
  try {
    parseKey(process.env.TOKEN_ENCRYPTION_KEY);
    return true;
  } catch {
    return false;
  }
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOwnAccount();
  const params = await searchParams;
  const live = authEnabled();
  const pool = live ? getPool(process.env.DATABASE_URL as string) : null;
  const [status, plan] = pool ? await Promise.all([razorpayStatus(pool, user.id), hostPlan(pool, user.id)]) : [null, null];
  const canConnect = live && encryptionReady();

  return (
    <div>
      <h1 className="font-display text-xl text-text">Integrations</h1>
      <p className="mt-2 text-text-muted">Connect video, payments and messaging tools to your booking links.</p>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/dashboard/calendars" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Calendars</Link></li>
        <li><Link href="/dashboard/settings" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Settings</Link></li>
      </ul>

      {params.connected && <p role="status" className="mt-4 max-w-xl text-success">Razorpay connected. Guests&apos; payments now go to your account.</p>}
      {params.disconnected && <p role="status" className="mt-4 max-w-xl text-success">Razorpay disconnected. Your keys were removed from Hourhand.</p>}
      {params.error && <p role="alert" className="mt-4 max-w-xl text-danger">{(Object.hasOwn(ERRORS, params.error) && ERRORS[params.error]) || ERRORS.unreachable}</p>}

      <Card className="mt-6 max-w-2xl">
        <h2 className="font-semibold text-text">Razorpay · take payments at booking</h2>
        <p className="mt-1 text-text-muted">Payments go straight to your own Razorpay account. Hourhand never holds your money.</p>
        {plan === "free" && (
          <p className="mt-2 text-sm text-text-muted">
            Charging guests needs the Solo or Duo plan.{" "}
            <Link href="/dashboard/plan" className="font-semibold text-accent underline">See plans</Link>
          </p>
        )}

        {status ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-text">{maskKeyId(status.keyId)}</span>
              <span className={`inline-flex items-center rounded-pill px-3 py-1 text-xs ${status.mode === "test" ? "bg-warning-bg text-warning" : "bg-success-bg text-success"}`}>
                {status.mode === "test" ? "Test mode" : "Live"}
              </span>
            </div>
            <form action={disconnectRazorpayAction}>
              <Button type="submit" variant="secondary" size="sm">Disconnect</Button>
            </form>
          </div>
        ) : canConnect ? (
          <form action={connectRazorpay} className="mt-4 grid max-w-md gap-4">
            <div>
              <Label htmlFor="razorpay-key-id">Key ID</Label>
              <Input id="razorpay-key-id" name="keyId" type="text" autoComplete="off" required />
            </div>
            <div>
              <Label htmlFor="razorpay-key-secret">Key secret</Label>
              <Input id="razorpay-key-secret" name="keySecret" type="password" autoComplete="off" required />
            </div>
            <p className="text-sm text-text-muted">Find them in Razorpay Dashboard → Account &amp; Settings → API Keys. Use test keys first.</p>
            <div><Button type="submit">Connect</Button></div>
          </form>
        ) : (
          <p className="mt-4 max-w-xl text-sm text-text-muted">{live ? ERRORS.not_configured : ERRORS.demo}</p>
        )}
      </Card>
    </div>
  );
}
