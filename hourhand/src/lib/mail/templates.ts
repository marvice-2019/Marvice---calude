// Hourhand's emails. Every message has a plain-text and an HTML version with the same content.
import type { InviteeAnswer, LocationKind } from "../data/types";
import type { BookingEmailKind } from "../data/notifications";
import { formatDate, formatTime, zoneName, type HourCycle } from "../format";
import { GUEST_LOCATION_LABELS } from "../location-labels";
import { buildIcs } from "./ics";
import type { Attachment } from "./mailer";

export interface BookingMailContext {
  bookingId: string;
  eventName: string;
  hostName: string;
  hostEmail: string;
  hostTimezone: string;
  hostTimeFormat: HourCycle;
  guestName: string;
  guestEmail: string;
  guestTimezone: string;
  startAt: Date;
  endAt: Date;
  location: { kind: LocationKind; value: string | null } | null;
  /** The video link from the host's calendar event (Google Meet), when there is one. */
  joinUrl: string | null;
  answers: InviteeAnswer[];
  cancelledBy: "host" | "guest" | "system" | null;
  cancelReason: string | null;
  /** For reschedules: when the booking used to be. */
  previousStartAt: Date | null;
  /** When the email was queued. Used as the calendar file's timestamp, so a retried send has exactly the same body. */
  issuedAt: Date;
  /** The guest's cancel / reschedule page. Only ever sent to the guest. */
  manageUrl: string;
  /** The host's view of the booking in the dashboard. */
  dashboardUrl: string;
}

export interface RenderedMail { subject: string; text: string; html: string; attachments?: Attachment[]; replyTo?: string }

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Strips line breaks from anything that goes into a subject line. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

const when = (d: Date, tz: string, cycle: HourCycle) => `${formatDate(d, tz)}, ${formatTime(d, tz, cycle)} ${zoneName(tz)}`;
const minutes = (c: BookingMailContext) => Math.round((c.endAt.getTime() - c.startAt.getTime()) / 60_000);
const hostLabel = (c: BookingMailContext) => c.hostName || c.hostEmail;

function where(c: BookingMailContext): string | null {
  if (!c.location) return null;
  const label = GUEST_LOCATION_LABELS[c.location.kind];
  if (c.joinUrl) return `${label}: ${c.joinUrl}`;
  return c.location.value ? `${label}: ${c.location.value}` : label;
}

type Row = [label: string, value: string];
type Block = { heading: string; intro: string; rows: Row[]; link?: { label: string; url: string }; note?: string; footer: string };

function toText(b: Block): string {
  const lines = [b.heading, "", b.intro, "", ...b.rows.map(([k, v]) => `${k}: ${v}`)];
  if (b.link) lines.push("", `${b.link.label}: ${b.link.url}`);
  if (b.note) lines.push("", b.note);
  lines.push("", "—", b.footer);
  return lines.join("\n");
}

function toHtml(b: Block): string {
  const rows = b.rows.map(([k, v]) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#5b6170;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0;color:#16181d">${escapeHtml(v).replace(/\n/g, "<br>")}</td></tr>`).join("");
  const link = b.link
    ? `<p style="margin:24px 0"><a href="${escapeHtml(b.link.url)}" style="background:#16181d;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(b.link.label)}</a></p>`
    : "";
  const note = b.note ? `<p style="margin:16px 0;color:#5b6170">${escapeHtml(b.note)}</p>` : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px">
<h1 style="margin:0 0 12px;font-size:20px;color:#16181d">${escapeHtml(b.heading)}</h1>
<p style="margin:0 0 16px;color:#16181d">${escapeHtml(b.intro)}</p>
<table role="presentation" style="border-collapse:collapse">${rows}</table>${link}${note}
<p style="margin:28px 0 0;font-size:13px;color:#8a8f9c">${escapeHtml(b.footer)}</p>
</div></body></html>`;
}

const render = (subject: string, b: Block, extra: Partial<RenderedMail> = {}): RenderedMail =>
  ({ subject: oneLine(subject), text: toText(b), html: toHtml(b), ...extra });

function guestRows(c: BookingMailContext): Row[] {
  const rows: Row[] = [["What", `${c.eventName} (${minutes(c)} min)`], ["When", when(c.startAt, c.guestTimezone, "12h")], ["With", hostLabel(c)]];
  const w = where(c);
  if (w) rows.push(["Where", w]);
  return rows;
}

function hostRows(c: BookingMailContext): Row[] {
  const rows: Row[] = [["What", `${c.eventName} (${minutes(c)} min)`], ["When", when(c.startAt, c.hostTimezone, c.hostTimeFormat)],
    ["Guest", `${c.guestName} <${c.guestEmail}>`], ["Guest's time zone", zoneName(c.guestTimezone)]];
  const w = where(c);
  if (w) rows.push(["Where", w]);
  for (const a of c.answers) if (a.answer.trim()) rows.push([a.label, a.answer]);
  return rows;
}

function calendarFile(c: BookingMailContext): Attachment {
  const ics = buildIcs({
    uid: `${c.bookingId}@hourhand`, start: c.startAt, end: c.endAt, stamp: c.issuedAt,
    summary: `${c.eventName} with ${hostLabel(c)}`, description: `Change or cancel: ${c.manageUrl}`, location: where(c), url: c.manageUrl,
  });
  return { filename: "booking.ics", content: Buffer.from(ics, "utf8").toString("base64"), contentType: "text/calendar; charset=utf-8; method=PUBLISH" };
}

const guestFooter = (c: BookingMailContext) => `Sent by Hourhand for ${hostLabel(c)}. Reply to this email to reach them.`;
const hostFooter = "Sent by Hourhand about your booking page.";
const manageLink = (c: BookingMailContext) => ({ label: "Reschedule or cancel", url: c.manageUrl });
const dashboardLink = (c: BookingMailContext) => ({ label: "Open in Hourhand", url: c.dashboardUrl });

function cancelNote(c: BookingMailContext): string | undefined {
  return c.cancelReason ? `Reason given: ${c.cancelReason}` : undefined;
}

export function renderBookingMail(kind: BookingEmailKind, c: BookingMailContext): RenderedMail {
  const host = hostLabel(c);
  switch (kind) {
    case "booked_guest":
      return render(`Booked: ${c.eventName} with ${host}, ${formatDate(c.startAt, c.guestTimezone)}`, {
        heading: "You're booked", intro: `Hi ${c.guestName}, your time with ${host} is confirmed.`,
        rows: guestRows(c), link: manageLink(c), note: "The attached file adds this to your calendar.", footer: guestFooter(c),
      }, { attachments: [calendarFile(c)], replyTo: c.hostEmail });
    case "booked_host":
      return render(`New booking: ${c.guestName}, ${c.eventName}, ${formatDate(c.startAt, c.hostTimezone)}`, {
        heading: "New booking", intro: `${c.guestName} booked ${c.eventName}.`, rows: hostRows(c), link: dashboardLink(c), footer: hostFooter,
      }, { replyTo: c.guestEmail });
    case "reminder_guest":
      return render(`Reminder: ${c.eventName} with ${host}, ${formatTime(c.startAt, c.guestTimezone, "12h")} ${zoneName(c.guestTimezone)}`, {
        heading: "Coming up soon", intro: `Hi ${c.guestName}, a reminder of your time with ${host}.`,
        rows: guestRows(c), link: manageLink(c), note: "Can't make it? Use the link above so they know.", footer: guestFooter(c),
      }, { replyTo: c.hostEmail });
    case "cancelled_guest":
      return render(`Cancelled: ${c.eventName} with ${host}`, {
        heading: "Your booking is cancelled",
        intro: c.cancelledBy === "guest" ? `Hi ${c.guestName}, you cancelled your time with ${host}.` : `Hi ${c.guestName}, ${host} cancelled your booking.`,
        rows: guestRows(c), note: cancelNote(c), footer: guestFooter(c),
      }, { replyTo: c.hostEmail });
    case "cancelled_host":
      return render(`Cancelled: ${c.guestName}, ${c.eventName}, ${formatDate(c.startAt, c.hostTimezone)}`, {
        heading: "A booking was cancelled",
        intro: c.cancelledBy === "guest" ? `${c.guestName} cancelled ${c.eventName}.` : `You cancelled ${c.eventName} with ${c.guestName}.`,
        rows: hostRows(c), note: cancelNote(c), footer: hostFooter,
      }, { replyTo: c.guestEmail });
    case "rescheduled_guest":
      return render(`Moved: ${c.eventName} with ${host}, now ${formatDate(c.startAt, c.guestTimezone)}`, {
        heading: "Your booking has a new time", intro: `Hi ${c.guestName}, your time with ${host} has moved.`,
        rows: [...guestRows(c), ...(c.previousStartAt ? [["Was", when(c.previousStartAt, c.guestTimezone, "12h")] as Row] : [])],
        link: manageLink(c), note: "The attached file adds the new time to your calendar. Remove the old one if you saved it.", footer: guestFooter(c),
      }, { attachments: [calendarFile(c)], replyTo: c.hostEmail });
    case "rescheduled_host":
      return render(`Moved: ${c.guestName}, ${c.eventName}, now ${formatDate(c.startAt, c.hostTimezone)}`, {
        heading: "A booking has a new time", intro: `${c.guestName} moved ${c.eventName}.`,
        rows: [...hostRows(c), ...(c.previousStartAt ? [["Was", when(c.previousStartAt, c.hostTimezone, c.hostTimeFormat)] as Row] : [])],
        link: dashboardLink(c), footer: hostFooter,
      }, { replyTo: c.guestEmail });
  }
}

/** Tells a host their calendar connection is failing, so Hourhand has stopped offering times. Sent once per outage. */
export function renderCalendarAlert(a: { accountEmail: string; disconnected: boolean; lastError: string | null; calendarsUrl: string }): RenderedMail {
  return render(a.disconnected ? "Reconnect your Google Calendar" : "Hourhand can't read your Google Calendar", {
    heading: a.disconnected ? "Your calendar is disconnected" : "Your calendar isn't syncing",
    intro: a.disconnected
      ? `Google no longer lets Hourhand use ${a.accountEmail}. Until you reconnect it, your booking pages show no times, so nobody can book over your meetings.`
      : `Hourhand hasn't been able to read ${a.accountEmail} for a few minutes. Until it can, your booking pages show no times, so nobody can book over your meetings. It keeps retrying.`,
    rows: a.lastError ? [["Last error", a.lastError.slice(0, 200)]] : [],
    link: { label: a.disconnected ? "Reconnect your calendar" : "Check your calendars", url: a.calendarsUrl },
    footer: "Sent by Hourhand about your booking page.",
  });
}

export function renderMagicLink(url: string): RenderedMail {
  return render("Your Hourhand sign-in link", {
    heading: "Sign in to Hourhand", intro: "Use the button below to sign in. The link works once and expires in 15 minutes.",
    rows: [], link: { label: "Sign in", url }, note: "If you didn't ask for this, ignore this email. Nobody can sign in without the link.",
    footer: "Sent by Hourhand.",
  });
}
