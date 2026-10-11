import { formatDate, formatTime, zoneName } from "./format";

/**
 * A guest's phone as WhatsApp's wa.me wants it: country code and number, digits only. Ten-digit numbers and numbers
 * with a leading 0 are taken as Indian (+91), the default for Hourhand's hosts. Null when it can't be a phone number.
 */
export function waNumber(phone: string | null | undefined, defaultCountry = "91"): string | null {
  if (!phone) return null;
  const plus = phone.trim().startsWith("+");
  let digits = phone.replace(/\D/g, "");
  if (!plus && digits.startsWith("00")) digits = digits.slice(2);
  else if (!plus && digits.length === 11 && digits.startsWith("0")) digits = defaultCountry + digits.slice(1);
  else if (!plus && digits.length === 10) digits = defaultCountry + digits;
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
}

/** The message the host sends from their own WhatsApp. Plain words, first name, the time in the guest's zone. */
export function whatsappMessage(kind: WhatsAppKind, c: WhatsAppContext): string {
  const first = c.guestName.trim().split(/\s+/)[0] || c.guestName;
  const when = `${formatDate(c.startAt, c.guestTimezone)}, ${formatTime(c.startAt, c.guestTimezone)} ${zoneName(c.guestTimezone)}`;
  const where = c.where ? `\n${c.where}` : "";
  switch (kind) {
    case "confirmation":
      return `Hi ${first}, this is ${c.hostName}. Your ${c.eventName} is booked for ${when}.${where}\n\nNeed to change it? ${c.manageUrl}`;
    case "reminder":
      return `Hi ${first}, a reminder from ${c.hostName}: ${c.eventName} on ${when}.${where}\n\nCan't make it? Move or cancel here: ${c.manageUrl}`;
    case "manage":
      return `Hi ${first}, you can move or cancel your ${c.eventName} on ${when} here: ${c.manageUrl}`;
  }
}

/** A link that opens WhatsApp with the message ready to send to the guest. */
export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
