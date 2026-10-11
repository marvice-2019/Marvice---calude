import Link from "next/link";
import { DeleteAccountForm } from "@/components/DeleteAccountForm";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { authEnabled } from "@/lib/auth/auth";
import { signOutEverywhere } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div>
      <h1 className="font-display text-xl text-text">Settings</h1>
      <p className="mt-2 text-text-muted">Change your name, booking page address, time zone and time format.</p>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/dashboard/event-types" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Event types</Link></li>
      </ul>

      <Card className="mt-8 max-w-xl">
        <h2 className="font-semibold text-text">Signed in as {user.email}</h2>
        {authEnabled() ? (
          <>
            <p className="mt-1 text-text-muted">Lost a phone or used a shared computer? Sign out everywhere, including this browser.</p>
            <form action={signOutEverywhere} className="mt-4">
              <Button type="submit" variant="secondary">
                Sign out of all devices
              </Button>
            </form>
          </>
        ) : (
          <p className="mt-1 text-text-muted">This copy runs on demo data, so there are no sessions to end.</p>
        )}
      </Card>

      {authEnabled() && (
        <Card className="mt-6 max-w-xl">
          <h2 className="font-semibold text-text">Delete your account</h2>
          <p className="mt-1 text-text-muted">
            Your booking links stop working straight away and upcoming bookings are cancelled. We keep your data for 30 days in case you change
            your mind, then delete it for good.
          </p>
          <DeleteAccountForm email={user.email} />
        </Card>
      )}
    </div>
  );
}
