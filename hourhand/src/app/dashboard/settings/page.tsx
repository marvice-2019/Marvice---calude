import Link from "next/link";
import { DeleteAccountForm } from "@/components/DeleteAccountForm";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { authEnabled } from "@/lib/auth/auth";
import { signOutEverywhere } from "@/lib/auth/actions";
import { requireOwnAccount } from "@/lib/auth/session";
import { focusRing } from "@/components/ui/focus";
import { LOCALES, LOCALE_NAMES, isLocale } from "@/lib/i18n/guest";
import { setBookingLanguage } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const user = await requireOwnAccount();
  const { saved } = await searchParams;
  return (
    <div>
      <h1 className="font-display text-xl text-text">Settings</h1>
      <p className="mt-2 text-text-muted">Change your name, booking page address, time zone and time format.</p>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/dashboard/event-types" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Event types</Link></li>
      </ul>

      <Card className="mt-8 max-w-xl">
        <h2 className="font-semibold text-text">Appearance</h2>
        <p className="mt-1 text-text-muted">Dark mode is easier on the eyes at night. Device follows your phone or computer setting.</p>
        <ThemeSwitch className="mt-4" />
      </Card>

      <Card className="mt-6 max-w-xl">
        <h2 className="font-semibold text-text">Booking page language</h2>
        <p className="mt-1 text-text-muted">What guests see first on your booking pages. They can switch to another language at the top of the page.</p>
        <form action={setBookingLanguage} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="locale" className="block text-sm font-semibold text-text">Language</label>
            <select id="locale" name="locale" defaultValue={isLocale(user.locale) ? user.locale : "en"}
              className={`mt-1 block h-11 rounded-md border border-border-input bg-card px-3 text-base text-text ${focusRing}`}>
              {LOCALES.map((l) => <option key={l} value={l} lang={l}>{LOCALE_NAMES[l]}</option>)}
            </select>
          </div>
          <Button type="submit">Save</Button>
        </form>
        {saved === "language" && <p role="status" className="mt-2 text-success">Saved. New guests see your booking pages in this language.</p>}
      </Card>

      <Card className="mt-6 max-w-xl">
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
