import Link from "next/link";
import { EmbedResize } from "@/components/EmbedResize";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { ManageBooking } from "@/components/ManageBooking";
import { RunningLate } from "@/components/RunningLate";
import { canSayRunningLate } from "@/lib/manage";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { isUnpaidRelease } from "@/lib/booking-reasons";
import { store } from "@/lib/data";
import { formatDate, zoneName } from "@/lib/format";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LOCATION_KEYS, resolveLocale, t, tNodes } from "@/lib/i18n/guest";
import { AddToCalendar } from "@/components/AddToCalendar";
import { resolveBaseUrl } from "@/lib/auth/auth";

export const dynamic = "force-dynamic";


export default async function ManageBookingPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { token } = await params;
  const { lang } = await searchParams;
  const booking = await store.getBookingByManageToken(token);
  if (!booking) notFound();
  const [host, eventType] = await Promise.all([store.getUser(booking.hostId), store.getEventType(booking.hostId, booking.eventTypeId)]);
  if (!host || !eventType) notFound();
  const tz = booking.invitee.timezone;
  const locale = resolveLocale(lang, host.locale);
  const q = typeof lang === "string" && lang === locale ? `?lang=${locale}` : "";
  const time = (d: Date) => <LocalTime date={d} tz={tz} locale={locale} />;
  const cancelled = booking.status === "cancelled";
  const pending = booking.status === "pending_payment";
  // A hold that ran out before the guest paid: say so plainly rather than "cancelled".
  const unpaid = cancelled && isUnpaidRelease(booking.cancelReason);
  // A week of a weekly series: its place, and how many later weeks are still to come (they can be cancelled with it).
  const series = booking.seriesId ? (await store.listBookings(booking.hostId)).filter((b) => b.seriesId === booking.seriesId) : [];
  const now = new Date();
  const laterWeeks = series.filter((b) => (b.seriesIndex ?? 0) > (booking.seriesIndex ?? 0) && b.status === "confirmed" && b.startAt > now).length;

  return (
    <main lang={locale} className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <EmbedResize />
      <LanguageSwitcher locale={locale} path={`/b/${token}`} />
      <h1 className="font-display text-xl text-text">{t(locale, "yourBooking")}</h1>
      <Card className="mt-4 max-w-md">
        <dl className="grid gap-3">
          <div><dt className="text-sm text-text-muted">{t(locale, "what")}</dt><dd className="text-text">{t(locale, "eventWith", { event: eventType.name, host: host.name })}</dd></div>
          <div>
            <dt className="text-sm text-text-muted">{t(locale, "when")}</dt>
            <dd className={cancelled ? "text-text-muted line-through" : "text-text"}>
              {tNodes(locale, "whenRange", { date: formatDate(booking.startAt, tz, locale), start: time(booking.startAt), end: time(booking.endAt), zone: zoneName(tz) })}
            </dd>
            {series.length > 1 && <dd className="text-sm text-text-muted">{t(locale, "weekOf", { i: booking.seriesIndex ?? 1, n: new Set(series.map((b) => b.seriesIndex)).size })}</dd>}
          </div>
          {booking.locationKind && <div><dt className="text-sm text-text-muted">{t(locale, "where")}</dt><dd className="text-text">{t(locale, LOCATION_KEYS[booking.locationKind])}{booking.joinUrl && booking.status === "confirmed" && <> · <a href={booking.joinUrl} className="font-semibold text-accent underline" rel="noopener noreferrer" target="_blank">{t(locale, "joinCall")}</a></>}</dd></div>}
          <div><dt className="text-sm text-text-muted">{t(locale, "bookedFor")}</dt><dd className="text-text">{booking.invitee.name}, {booking.invitee.email}</dd></div>
        </dl>
      </Card>
      {cancelled ? (
        <>
          <p className="mt-6 font-semibold text-text" role="status">
            {t(locale, unpaid ? "unpaidReleased" : "cancelledShort")}
          </p>
          <Link href={`/${host.slug}/${eventType.slug}${q}`} className={`mt-3 ${buttonClasses({ variant: "primary" })}`}>{t(locale, "bookAnother")}</Link>
        </>
      ) : pending ? (
        <p className="mt-6 max-w-md text-text" role="status">
          {tNodes(locale, "waitingPayment", { time: booking.holdExpiresAt ? time(booking.holdExpiresAt) : t(locale, "fewMinutes") })}{" "}
          {t(locale, "ifPaid")}
        </p>
      ) : (
        <>
        <AddToCalendar
          token={token} title={`${eventType.name} with ${host.name}`} start={booking.startAt} end={booking.endAt} locale={locale}
          location={booking.joinUrl ?? (booking.locationKind ? t(locale, LOCATION_KEYS[booking.locationKind]) : null)}
          manageUrl={`${(resolveBaseUrl() ?? "").replace(/\/+$/, "")}/b/${token}`}
        />
        {canSayRunningLate(booking.startAt, new Date()) && <RunningLate token={token} hostName={host.name} told={booking.invitee.runningLateMinutes} locale={locale} />}
        <ManageBooking token={token} slug={host.slug} event={eventType.slug} bookingWindowDays={eventType.bookingWindowDays} hostName={host.name} laterWeeks={laterWeeks} locale={locale} langQuery={q} cancelPolicy={eventType.cancelPolicy} />
        </>
      )}
    </main>
  );
}
