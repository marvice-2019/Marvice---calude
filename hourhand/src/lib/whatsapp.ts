import { formatDate, formatTime, zoneName } from "./format";
import { isLocale } from "./i18n/guest";
import { mt } from "./i18n/mail";

/**
 * A guest's phone as WhatsApp's wa.me wants it: country code and number, digits only. Without a +, only a number that
 * is an Indian mobile (6-9 then nine digits, maybe after a 0) gets +91: guessing India for anything else could send the
 * guest's manage link to a stranger. Null when it can't be a phone number or the country can't be told.
 */
export function waNumber(phone: string | null | undefined, defaultCountry = "91"): string | null {
  if (!phone) return null;
  const plus = phone.trim().startsWith("+");
  let digits = phone.replace(/\D/g, "");
  if (!plus && digits.startsWith("00")) digits = digits.slice(2);
  else if (!plus && /^0?[6-9]\d{9}$/.test(digits)) digits = defaultCountry + digits.slice(-10);
  else if (!plus && digits.startsWith("0")) digits = digits.slice(1);
  if (!plus && digits.length <= 11) return null; // no country code we can trust
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export type WhatsAppKind = "confirmation" | "reminder" | "manage";

export interface WhatsAppContext {
  guestName: string;
  hostName: string;
  eventName: string;
  startAt: Date;
  /** The guest's zone: times are written as they'll read them. */
  guestTimezone: string;
  /** Where to meet: a video link, an address, or a phone arrangement, already worded. */
  where: string | null;
  manageUrl: string;
  /** The language the guest booked in; English when unset. */
  locale?: string;
}

/** The message the host sends from their own WhatsApp. Plain words, first name, the time in the guest's zone. */
export function whatsappMessage(kind: WhatsAppKind, c: WhatsAppContext): string {
  const l = isLocale(c.locale) ? c.locale : "en";
  const first = c.guestName.trim().split(/\s+/)[0] || c.guestName;
  const when = `${formatDate(c.startAt, c.guestTimezone, l)}, ${formatTime(c.startAt, c.guestTimezone, "12h", l)} ${zoneName(c.guestTimezone)}`;
  const v = { first, host: c.hostName, event: c.eventName, when, where: c.where ? `\n${c.where}` : "", url: c.manageUrl };
  return mt(l, kind === "confirmation" ? "waConfirmation" : kind === "reminder" ? "waReminder" : "waManage", v);
}

/** A link that opens WhatsApp with the message ready to send to the guest. */
export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
