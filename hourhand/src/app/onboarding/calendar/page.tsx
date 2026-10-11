import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import { authEnabled } from "@/lib/auth/auth";
import { calendarDeps } from "@/lib/calendar/env";

// The connect links never prefetch: a prefetch would start an OAuth handshake nobody asked for.
export const dynamic = "force-dynamic";

export default function OnboardingCalendarPage() {
  const providers = authEnabled() ? (calendarDeps()?.providers ?? {}) : {};
  return (
    <div>
      <h1 className="font-display text-xl text-text">Connect your calendar</h1>
      <p className="mt-2 text-text-muted">Connect a calendar so we only offer times when you are free.</p>
      {(providers.google || providers.microsoft) && (
        <div className="mt-4 flex flex-wrap gap-3">
          {providers.google && <Link prefetch={false} href="/api/calendars/google/connect" className={buttonClasses()}>Connect Google Calendar</Link>}
          {providers.microsoft && <Link prefetch={false} href="/api/calendars/microsoft/connect" className={buttonClasses()}>Connect Outlook</Link>}
        </div>
      )}
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/onboarding/hours" className="mt-4 inline-flex min-h-11 items-center font-semibold text-accent underline">Next: your hours</Link></li>
      </ul>
    </div>
  );
}
