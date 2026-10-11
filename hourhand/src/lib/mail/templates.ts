// Hourhand's emails. Every message has a plain-text and an HTML version with the same content.
import type { InviteeAnswer, LocationKind } from "../data/types";
import type { BookingEmailKind } from "../data/notifications";
import { formatDate, formatTime, zoneName, type HourCycle } from "../format";
import { GUEST_LOCATION_LABELS } from "../location-labels";
import { formatMoney } from "../billing/plans";
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
  /** What the guest paid for this booking (paise, INR), or null for a free booking. */
  paidMinor?: number | null;
  /** The payment was a refundable no-show deposit, not a price. */
  paidIsDeposit?: boolean;
  /** For reschedules: when the booking used to be. */
  previousStartAt: Date | null;
  /** For a rescheduled booking: who moved it (who cancelled the old one). */
  movedBy?: "host" | "guest" | "system" | null;
  /** When the email was queued. Used as the calendar file's timestamp, so a retried send has exactly the same body. */
  issuedAt: Date;
  /** The guest's cancel / reschedule page. Only ever sent to the guest. */
  manageUrl: string;
  /** The host's view of the booking in the dashboard. */
  dashboardUrl: string;
  /** For late_host: how many minutes late the guest said they'll be. */
  runningLateMinutes?: number | null;
  /** For cancelled_guest after the host cancelled: free times to book instead, nearest the cancelled one. */
  rebook?: { at: Date; url: string }[];
  /** For the first week's confirmations of a weekly series: every week still booked, in order, the first included. */
  series?: { bookingId: string; startAt: Date; endAt: Date; manageUrl: string }[];
  /** For cancellations: later weeks of the same series cancelled in the same step. */
  alsoCancelled?: Date[];
  /** The recipient is an extra guest the booker added: told about the booking, never given the link that changes it. */
  extraGuest?: boolean;
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
type Block = { heading: string; intro: string; rows: Row[]; link?: { label: string; url: string }; choices?: { heading: string; items: { label: string; url: string }[] }; note?: string; footer: string };

function toText(b: Block): string {
  const lines = [b.heading, "", b.intro, "", ...b.rows.map(([k, v]) => `${k}: ${v}`)];
  if (b.link) lines.push("", `${b.link.label}: ${b.link.url}`);
  if (b.choices) lines.push("", b.choices.heading, ...b.choices.items.map((i) => `- ${i.label}: ${i.url}`));
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
  const choices = b.choices
    ? `<p style="margin:24px 0 8px;font-weight:600;color:#16181d">${escapeHtml(b.choices.heading)}</p>` + b.choices.items.map((i) =>
      `<p style="margin:0 0 8px"><a href="${escapeHtml(i.url)}" style="border:1px solid #16181d;color:#16181d;padding:8px 14px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(i.label)}</a></p>`).join("")
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px">
<h1 style="margin:0 0 12px;font-size:20px;color:#16181d">${escapeHtml(b.heading)}</h1>
<p style="margin:0 0 16px;color:#16181d">${escapeHtml(b.intro)}</p>
<table role="presentation" style="border-collapse:collapse">${rows}</table>${link}${choices}${note}
<p style="margin:28px 0 0;font-size:13px;color:#8a8f9c">${escapeHtml(b.footer)}</p>
</div></body></html>`;
}

const render = (subject: string, b: Block, extra: Partial<RenderedMail> = {}): RenderedMail =>
  ({ subject: oneLine(subject), text: toText(b), html: toHtml(b), ...extra });

/** "Every week": the series' dates, one line each, when this is a series confirmation. */
const seriesRow = (c: BookingMailContext, tz: string, cycle: HourCycle): Row[] => [
  ...(c.series && c.series.length > 1 ? [[`Every week (${c.series.length})`, c.series.map((s) => when(s.startAt, tz, cycle)).join("\n")] as Row] : []),
  ...(c.alsoCancelled?.length ? [[`Also cancelled (${c.alsoCancelled.length})`, c.alsoCancelled.map((d) => when(d, tz, cycle)).join("\n")] as Row] : []),
];

function guestRows(c: BookingMailContext): Row[] {
  const rows: Row[] = [["What", `${c.eventName} (${minutes(c)} min)`], ["When", when(c.startAt, c.guestTimezone, "12h")], ...seriesRow(c, c.guestTimezone, "12h"), ["With", hostLabel(c)]];
  const w = where(c);
  if (w) rows.push(["Where", w]);
  if (c.paidMinor) rows.push(c.paidIsDeposit ? ["Deposit", `${formatMoney(c.paidMinor, "INR")}, refunded a day after your session. Kept only if you don't turn up.`] : ["Paid", formatMoney(c.paidMinor, "INR")]);
  return rows;
}

function hostRows(c: BookingMailContext): Row[] {
  const rows: Row[] = [["What", `${c.eventName} (${minutes(c)} min)`], ["When", when(c.startAt, c.hostTimezone, c.hostTimeFormat)], ...seriesRow(c, c.hostTimezone, c.hostTimeFormat),
    ["Guest", `${c.guestName} <${c.guestEmail}>`], ["Guest's time zone", zoneName(c.guestTimezone)]];
  const w = where(c);
  if (w) rows.push(["Where", w]);
  for (const a of c.answers) if (a.answer.trim()) rows.push([a.label, a.answer]);
  if (c.paidMinor) rows.push(c.paidIsDeposit
    ? ["Deposit", `${formatMoney(c.paidMinor, "INR")} in your Razorpay account. Refunded a day after the session unless you mark a no-show.`]
    : ["Paid", `${formatMoney(c.paidMinor, "INR")} to your Razorpay account`]);
  return rows;
}

function calendarFile(c: BookingMailContext): Attachment {
  const weeks = c.series && c.series.length > 1 ? c.series : [{ bookingId: c.bookingId, startAt: c.startAt, endAt: c.endAt, manageUrl: c.manageUrl }];
  const ics = buildIcs(weeks.map((w) => ({
    uid: `${w.bookingId}@hourhand`, start: w.startAt, end: w.endAt, stamp: c.issuedAt,
    summary: `${c.eventName} with ${hostLabel(c)}`, description: `Change or cancel: ${w.manageUrl}`, location: where(c), url: w.manageUrl,
  })));
  return { filename: "booking.ics", content: Buffer.from(ics, "utf8").toString("base64"), contentType: "text/calendar; charset=utf-8; method=PUBLISH" };
}

const guestFooter = (c: BookingMailContext) => `Sent by Hourhand for ${hostLabel(c)}. Reply to this email to reach them.`;
const hostFooter = "Sent by Hourhand about your booking page.";
const manageLink = (c: BookingMailContext) => ({ label: "Reschedule or cancel", url: c.manageUrl });
const dashboardLink = (c: BookingMailContext) => ({ label: "Open in Hourhand", url: c.dashboardUrl });

function cancelNote(c: BookingMailContext, to: "guest" | "host"): string | undefined {
  const reason = c.cancelReason ? `Reason given: ${c.cancelReason}` : "";
  // A paid booking is refunded in full on cancellation; say so, since that's what the guest wants to know first.
  const refund = !c.paidMinor ? "" : to === "guest"
    ? `Your ${c.paidIsDeposit ? "deposit" : "payment"} of ${formatMoney(c.paidMinor, "INR")} is being refunded to the way you paid. Banks usually take 5 to 7 working days.`
    : `The guest's ${formatMoney(c.paidMinor, "INR")} is being refunded from your Razorpay account.`;
  return [refund, reason].filter(Boolean).join(" ") || undefined;
}

/** What an extra guest hears: the same news, framed as an invitation, with no manage link, payment or refund details. */
function renderForExtraGuest(kind: "booked_guest" | "reminder_guest" | "cancelled_guest" | "rescheduled_guest", c: BookingMailContext): RenderedMail {
  const host = hostLabel(c);
  const rows = guestRows({ ...c, paidMinor: null });
  const footer = `Sent by Hourhand for ${host}. Only ${c.guestName} can change or cancel this booking.`;
  const file = () => {
    const weeks = c.series && c.series.length > 1 ? c.series : [{ bookingId: c.bookingId, startAt: c.startAt, endAt: c.endAt }];
    const ics = buildIcs(weeks.map((w) => ({
      uid: `${w.bookingId}@hourhand`, start: w.startAt, end: w.endAt, stamp: c.issuedAt,
      summary: `${c.eventName} with ${host}`, description: `Booked by ${c.guestName}`, location: where(c),
    })));
    return { filename: "booking.ics", content: Buffer.from(ics, "utf8").toString("base64"), contentType: "text/calendar; charset=utf-8; method=PUBLISH" };
  };
  switch (kind) {
    case "booked_guest":
      return render(`Invitation: ${c.eventName} with ${host}, ${formatDate(c.startAt, c.guestTimezone)}`, {
        heading: "You're invited", intro: `${c.guestName} added you to their ${c.eventName} with ${host}.`, rows, footer,
        note: "The attached file adds it to your calendar.",
      }, { attachments: [file()], replyTo: c.guestEmail });
    case "reminder_guest":
      return render(`Reminder: ${c.eventName} with ${host}, ${formatTime(c.startAt, c.guestTimezone, "12h")} ${zoneName(c.guestTimezone)}`, {
        heading: "Coming up soon", intro: `A reminder of ${c.guestName}'s ${c.eventName} with ${host}, which you're invited to.`, rows, footer,
      }, { replyTo: c.guestEmail });
    case "cancelled_guest":
      return render(`Cancelled: ${c.eventName} with ${host}`, {
        heading: "This booking is cancelled", intro: `${c.guestName}'s ${c.eventName} with ${host}, which you were invited to, is cancelled.`, rows, footer,
      }, { replyTo: c.guestEmail });
    case "rescheduled_guest":
      return render(`Moved: ${c.eventName} with ${host}, now ${formatDate(c.startAt, c.guestTimezone)}`, {
        heading: "New time", intro: `${c.guestName}'s ${c.eventName} with ${host}, which you're invited to, has a new time.`,
        rows: [...rows, ...(c.previousStartAt ? [["Was", when(c.previousStartAt, c.guestTimezone, "12h")] as Row] : [])], footer,
        note: "The attached file adds the new time to your calendar. Remove the old one if you saved it.",
      }, { attachments: [file()], replyTo: c.guestEmail });
  }
}

export function renderBookingMail(kind: BookingEmailKind, c: BookingMailContext): RenderedMail {
  if (c.extraGuest && (kind === "booked_guest" || kind === "reminder_guest" || kind === "cancelled_guest" || kind === "rescheduled_guest")) return renderForExtraGuest(kind, c);
  const host = hostLabel(c);
  switch (kind) {
    case "booked_guest":
      return render(`Booked: ${c.eventName} with ${host}, ${formatDate(c.startAt, c.guestTimezone)}`, {
        heading: "You're booked", intro: `Hi ${c.guestName}, your time with ${host} is confirmed.`,
        rows: guestRows(c), link: manageLink(c), footer: guestFooter(c),
        note: c.series && c.series.length > 1
          ? "The attached file adds every week to your calendar. Each week's reminder has its own link to move or cancel that week."
          : "The attached file adds this to your calendar.",
      }, { attachments: [calendarFile(c)], replyTo: c.hostEmail });
    case "booked_host":
      return render(`New booking: ${c.guestName}, ${c.eventName}, ${formatDate(c.startAt, c.hostTimezone)}`, {
        heading: "New booking", intro: `${c.guestName} booked ${c.eventName}.`, rows: hostRows(c), link: dashboardLink(c), footer: hostFooter,
      }, { replyTo: c.guestEmail });
    case "reminder_guest":
      return render(`Reminder: ${c.eventName} with ${host}, ${formatTime(c.startAt, c.guestTimezone, "12h")} ${zoneName(c.guestTimezone)}`, {
        heading: "Coming up soon", intro: `Hi ${c.guestName}, a reminder of your time with ${host}.`,
        rows: guestRows(c), link: manageLink(c), note: "Can't make it, or running late on the day? Use the link above so they know.", footer: guestFooter(c),
      }, { replyTo: c.hostEmail });
    case "cancelled_guest":
      return render(`Cancelled: ${c.eventName} with ${host}`, {
        heading: "Your booking is cancelled",
        intro: c.cancelledBy === "guest" ? `Hi ${c.guestName}, you cancelled your time with ${host}.` : `Hi ${c.guestName}, ${host} cancelled your booking.`,
        rows: guestRows(c), note: cancelNote(c, "guest"), footer: guestFooter(c),
        ...(c.cancelledBy === "host" && c.rebook?.length ? {
          choices: { heading: `Book another time with ${host}`, items: c.rebook.map((s) => ({ label: when(s.at, c.guestTimezone, "12h"), url: s.url })) },
        } : {}),
      }, { replyTo: c.hostEmail });
    case "cancelled_host":
      return render(`Cancelled: ${c.guestName}, ${c.eventName}, ${formatDate(c.startAt, c.hostTimezone)}`, {
        heading: "A booking was cancelled",
        intro: c.cancelledBy === "guest" ? `${c.guestName} cancelled ${c.eventName}.` : `You cancelled ${c.eventName} with ${c.guestName}.`,
        rows: hostRows(c), note: cancelNote(c, "host"), footer: hostFooter,
      }, { replyTo: c.guestEmail });
    case "rescheduled_guest":
      return render(`Moved: ${c.eventName} with ${host}, now ${formatDate(c.startAt, c.guestTimezone)}`, {
        heading: "Your booking has a new time", intro: c.movedBy === "host" ? `Hi ${c.guestName}, ${host} moved your booking to a new time.` : `Hi ${c.guestName}, your time with ${host} has moved.`,
        rows: [...guestRows(c), ...(c.previousStartAt ? [["Was", when(c.previousStartAt, c.guestTimezone, "12h")] as Row] : [])],
        link: manageLink(c), note: "The attached file adds the new time to your calendar. Remove the old one if you saved it.", footer: guestFooter(c),
      }, { attachments: [calendarFile(c)], replyTo: c.hostEmail });
    case "late_host":
      return render(`Running late: ${c.guestName}, ${c.runningLateMinutes ?? "a few"} min, ${c.eventName}`, {
        heading: `${c.guestName} is running late`,
        intro: `${c.guestName} says they'll be about ${c.runningLateMinutes ?? "a few"} minutes late for ${c.eventName} at ${formatTime(c.startAt, c.hostTimezone, c.hostTimeFormat)}.`,
        rows: hostRows(c), link: dashboardLink(c), footer: hostFooter,
      }, { replyTo: c.guestEmail });
    case "rescheduled_host":
      return render(`Moved: ${c.guestName}, ${c.eventName}, now ${formatDate(c.startAt, c.hostTimezone)}`, {
        heading: "A booking has a new time", intro: c.movedBy === "host" ? `You moved ${c.eventName} with ${c.guestName}.` : `${c.guestName} moved ${c.eventName}.`,
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

export function renderRenewalReminder(a: { planName: string; price: string; renewsOn: Date; timezone: string; planUrl: string }): RenderedMail {
  const on = formatDate(a.renewsOn, a.timezone);
  return render(`Your Hourhand ${a.planName} plan renews on ${on}`, {
    heading: `${a.planName} renews in 7 days`,
    intro: `Your ${a.planName} plan renews automatically on ${on}. Nothing to do if you want to keep it. To stop it, cancel or pause from your plan page before then.`,
    rows: [["Plan", a.planName], ["Price", a.price], ["Renews", on]],
    link: { label: "Manage your plan", url: a.planUrl },
    footer: "Sent by Hourhand about your subscription.",
  });
}

export interface PackageMailContext {
  hostName: string; hostEmail: string; guestName: string; guestEmail: string; packageName: string; eventName: string;
  sessions: number; priceMinor: number; expiresAt: Date; timezone: string; buyerUrl: string; dashboardUrl: string;
}

/** A paid session package: the buyer's private link to book their sessions, or the host's note of the sale. */
export function renderPackageMail(kind: "package_guest" | "package_host", c: PackageMailContext): RenderedMail {
  const until = formatDate(c.expiresAt, c.timezone);
  const rows: Row[] = [["Package", c.packageName], ["Sessions", `${c.sessions} × ${c.eventName}`], ["Paid", formatMoney(c.priceMinor, "INR")], ["Book by", until]];
  if (kind === "package_guest") {
    return render(`Your ${c.sessions} sessions with ${c.hostName}`, {
      heading: "Your package is ready", intro: `Hi ${c.guestName}, thanks for buying ${c.packageName}. Book your sessions any time before ${until}.`,
      rows, link: { label: "Book your sessions", url: c.buyerUrl },
      note: "Keep this email: the link is yours alone and shows how many sessions you have left. Cancel a session in time and you get it back.",
      footer: `Sent by Hourhand for ${c.hostName}. Reply to this email to reach them.`,
    }, { replyTo: c.hostEmail });
  }
  return render(`Package sold: ${c.guestName}, ${c.packageName}`, {
    heading: "You sold a package", intro: `${c.guestName} <${c.guestEmail}> bought ${c.packageName}. The money went to your Razorpay account.`,
    rows, link: { label: "Open in Hourhand", url: c.dashboardUrl }, footer: "Sent by Hourhand about your booking page.",
  }, { replyTo: c.guestEmail });
}

/** A GST invoice or credit note for the guest: the key figures and a link to the full document to view, print or save. */
export function renderInvoiceMail(v: { kind: "invoice" | "credit_note"; number: string; supplierName: string; supplierEmail: string; totalMinor: number; description: string; url: string; originalNumber: string | null }): RenderedMail {
  const isNote = v.kind === "credit_note";
  return render(isNote ? `Credit note ${v.number} from ${v.supplierName}` : `Invoice ${v.number} from ${v.supplierName}`, {
    heading: isNote ? "Your credit note" : "Your tax invoice",
    intro: isNote ? `Your refund is recorded against invoice ${v.originalNumber}.` : `Thanks for your payment to ${v.supplierName}. Here's your GST invoice.`,
    rows: [["Number", v.number], ["For", v.description], [isNote ? "Refunded" : "Paid", formatMoney(v.totalMinor, "INR")]],
    link: { label: isNote ? "View the credit note" : "View the invoice", url: v.url },
    note: "Open the link to print it or save it as a PDF for your records.",
    footer: `Sent by Hourhand for ${v.supplierName}. Reply to this email to reach them.`,
  }, { replyTo: v.supplierEmail });
}

/** Last month in a few figures, with a link to the full report. */
export function renderEarningsMail(e: { monthLabel: string; netMinor: number; bookingsMinor: number; packagesMinor: number; refundsMinor: number; sessionsHeld: number; noShows: number; url: string }): RenderedMail {
  return render(`Your ${e.monthLabel} on Hourhand: ${formatMoney(e.netMinor, "INR")}`, {
    heading: `${e.monthLabel} at a glance`, intro: `Here's how ${e.monthLabel} went.`,
    rows: [["Net received", formatMoney(e.netMinor, "INR")], ["Bookings", formatMoney(e.bookingsMinor, "INR")], ["Packages", formatMoney(e.packagesMinor, "INR")],
      ["Refunds", formatMoney(e.refundsMinor, "INR")], ["Sessions held", String(e.sessionsHeld)], ["No-shows", String(e.noShows)]],
    link: { label: "See the full report", url: e.url }, footer: "Sent by Hourhand once a month.",
  });
}

export function renderSeatInviteMail(c: { ownerName: string; ownerEmail: string; url: string }): RenderedMail {
  return render(`${c.ownerName} added you to their Hourhand plan`, {
    heading: "You're invited to Hourhand", intro: `${c.ownerName} added you as the second person on their Duo plan. Sign in with this email address to accept.`,
    rows: [], link: { label: "Sign in to accept", url: c.url },
    note: "Once you accept, you get your own booking page on Duo and can manage their bookings. If you weren't expecting this, ignore it.",
    footer: `Sent by Hourhand for ${c.ownerName}. Reply to reach them.`,
  }, { replyTo: c.ownerEmail });
}

export function renderWaitlistMail(c: { guestName: string; hostName: string; eventName: string; start: Date; timezone: string; url: string }): RenderedMail {
  return render(`A time opened up with ${c.hostName}`, {
    heading: "A time opened up", intro: `Hi ${c.guestName}, a ${c.eventName} time with ${c.hostName} just became free on the day you asked about.`,
    rows: [["Time", when(c.start, c.timezone, "12h")]], link: { label: "Book it", url: c.url },
    note: "Everyone on the waitlist for that day gets this email, so it goes to whoever books first. We only send it once.",
    footer: `Sent by Hourhand for ${c.hostName}.`,
  });
}

export function renderMagicLink(url: string): RenderedMail {
  return render("Your Hourhand sign-in link", {
    heading: "Sign in to Hourhand", intro: "Use the button below to sign in. The link works once and expires in 15 minutes.",
    rows: [], link: { label: "Sign in", url }, note: "If you didn't ask for this, ignore this email. Nobody can sign in without the link.",
    footer: "Sent by Hourhand.",
  });
}
