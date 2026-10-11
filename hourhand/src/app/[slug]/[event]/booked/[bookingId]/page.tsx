import Link from "next/link";
import { EmbedResize } from "@/components/EmbedResize";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LocalTime } from "@/components/LocalTime";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { isUnpaidRelease } from "@/lib/booking-reasons";
import { store } from "@/lib/data";
import { formatDate, zoneName } from "@/lib/format";
import { LOCATION_KEYS, resolveLocale, t, tNodes } from "@/lib/i18n/guest";
import { AddToCalendar } from "@/components/AddToCalendar";
import { AutoRedirect } from "@/components/AutoRedirect";
import { cleanRedirectUrl } from "@/lib/calendar-links";
import { resolveBaseUrl } from "@/lib/auth/auth";

export const dynamic = "force-dynamic";


export default async function BookedPage({ params, searchParams }: { params: Promise<{ slug: string; event: string; bookingId: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { slug, bookingId } = await params;
  const { lang } = await searchParams;
  const host = await store.getUserBySlug(slug);
  const booking = host && (await store.getBooking(host.id, bookingId));
  if (!host || !booking) notFound();
  const eventType = await store.getEventType(host.id, booking.eventTypeId);
  // Checked again here: a stored value from before the https rule must never become a link or a redirect.
  const redirectUrl = eventType?.redirectUrl ? cleanRedirectUrl(eventType.redirectUrl) : null;
  const tz = booking.invitee.timezone;
  const locale = resolveLocale(lang, host.locale);
  const q = typeof lang === "string" && lang === locale ? `?lang=${locale}` : "";
  const time = (d: Date) => <LocalTime date={d} tz={tz} locale={locale} />;
  if (booking.status === "pending_payment") {
    return (
      <main lang={locale} className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <EmbedResize />
        <h1 className="font-display text-xl text-text">{t(locale, "confirmingPayment")}</h1>
        <p className="mt-2 max-w-md text-text-muted" role="status">
          {t(locale, "paymentSeconds")} {booking.holdExpiresAt ? tNodes(locale, "heldUntil", { time: time(booking.holdExpiresAt) }) : t(locale, "heldGeneric")}{" "}
          {t(locale, "closedRazorpay")}
        </p>
        <AutoRefresh labels={{ waiting: t(locale, "updatesItself"), stopped: t(locale, "stillWaiting") }} />
      </main>
    );
  }
  if (booking.status === "cancelled") {
    const unpaid = isUnpaidRelease(booking.cancelReason);
    return (
      <main lang={locale} className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <EmbedResize />
        <h1 className="font-display text-xl text-text">{t(locale, unpaid ? "unpaidTitle" : "cancelledTitle")}</h1>
        <p className="mt-2 max-w-md text-text-muted">{t(locale, unpaid ? "unpaidBody" : "nothingMore")}</p>
        <Link href={`/${host.slug}/${eventType?.slug ?? ""}${q}`} className={`mt-4 ${buttonClasses({ variant: "primary" })}`}>{t(locale, "bookATime")}</Link>
      </main>
    );
  }
  return (
    <main lang={locale} className="mx-auto max-w-(--hh-booking-max) px-4 py-10">
      <EmbedResize />
      <h1 className="font-display text-xl text-text">{t(locale, "booked")}</h1>
      <Card className="mt-4 max-w-md">
        <dl className="grid gap-3">
          <div><dt className="text-sm text-text-muted">{t(locale, "what")}</dt><dd className="text-text">{t(locale, "eventWith", { event: eventType?.name ?? "", host: host.name })}</dd></div>
          <div>
            <dt className="text-sm text-text-muted">{t(locale, "when")}</dt>
            <dd className="text-text">{tNodes(locale, "whenRange", { date: formatDate(booking.startAt, tz, locale), start: time(booking.startAt), end: time(booking.endAt), zone: zoneName(tz) })}</dd>
          </div>
          {booking.locationKind && <div><dt className="text-sm text-text-muted">{t(locale, "where")}</dt><dd className="text-text">{t(locale, LOCATION_KEYS[booking.locationKind])}{booking.joinUrl && booking.status === "confirmed" && <> · <a href={booking.joinUrl} className="font-semibold text-accent underline" rel="noopener noreferrer" target="_blank">{t(locale, "joinCall")}</a></>}</dd></div>}
          <div><dt className="text-sm text-text-muted">{t(locale, "bookedFor")}</dt><dd className="text-text">{booking.invitee.name}, {booking.invitee.email}</dd></div>
        </dl>
      </Card>
      {booking.status === "confirmed" && (
        <AddToCalendar
          token={booking.invitee.manageToken} title={`${eventType?.name ?? ""} with ${host.name}`} start={booking.startAt} end={booking.endAt} locale={locale}
          location={booking.joinUrl ?? (booking.locationKind ? t(locale, LOCATION_KEYS[booking.locationKind]) : null)}
          manageUrl={`${(resolveBaseUrl() ?? "").replace(/\/+$/, "")}/b/${booking.invitee.manageToken}`}
        />
      )}
      <p className="mt-4 text-text-muted">{t(locale, "keepLink")}</p>
      <Link href={`/b/${booking.invitee.manageToken}${q}`} className={`mt-2 ${buttonClasses({ variant: "secondary" })}`}>{t(locale, "manageBooking")}</Link>
      {redirectUrl && (
        <AutoRedirect url={redirectUrl} waiting={t(locale, "redirecting")} label={t(locale, "continueTo", { site: new URL(redirectUrl).hostname })} />
      )}
    </main>
  );
}
