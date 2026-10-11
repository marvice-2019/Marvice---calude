import { NextResponse, type NextRequest } from "next/server";
import { resolveBaseUrl } from "@/lib/auth/auth";
import { store } from "@/lib/data";
import { GUEST_LOCATION_LABELS } from "@/lib/location-labels";
import { buildIcs } from "@/lib/mail/ics";

export const dynamic = "force-dynamic";

/** The booking as an .ics file for Apple Calendar and the rest. Same UID as the email's file, so adding both makes one event. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await store.getBookingByManageToken(token);
  if (!booking || booking.status !== "confirmed") return new NextResponse(null, { status: 404 });
  const [host, eventType] = await Promise.all([store.getUser(booking.hostId), store.getEventType(booking.hostId, booking.eventTypeId)]);
  if (!host || !eventType) return new NextResponse(null, { status: 404 });
  const manageUrl = `${(resolveBaseUrl() ?? request.nextUrl.origin).replace(/\/+$/, "")}/b/${token}`;
  const ics = buildIcs({
    uid: `${booking.id}@hourhand`, start: booking.startAt, end: booking.endAt, stamp: new Date(),
    summary: `${eventType.name} with ${host.name}`, description: `Change or cancel: ${manageUrl}`,
    location: booking.joinUrl ?? (booking.locationKind ? GUEST_LOCATION_LABELS[booking.locationKind] : null), url: manageUrl,
  });
  return new NextResponse(ics, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="booking.ics"', "cache-control": "no-store" },
  });
}
