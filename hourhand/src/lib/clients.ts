import { createHash } from "node:crypto";
import type { BookingWithInvitee } from "./data/types";

// A host's clients: everyone who has booked them, grouped by email (any case). Worked out from bookings, so nothing
// can drift; the only thing stored is the host's private note.

export interface Client {
  /** A stable id for the client's page that doesn't put their email in the address. */
  key: string;
  name: string;
  email: string;
  phone: string | null;
  /** Sessions that happened or will happen (confirmed), no-shows included. */
  sessions: number;
  upcoming: number;
  noShows: number;
  cancelled: number;
  firstAt: Date;
  lastAt: Date | null;
  nextAt: Date | null;
}

/** sha256 of the lowercased email, shortened: the client page's address. */
export function clientKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 20);
}

/**
 * Groups bookings into clients, most recent activity first. A payment hold that lapsed was never a session and is left
 * out; the latest booking's name and phone are the ones shown (people fix typos).
 */
export function summarizeClients(bookings: BookingWithInvitee[], now: Date): Client[] {
  const byEmail = new Map<string, BookingWithInvitee[]>();
  for (const b of bookings) {
    if (b.status === "pending_payment" || (b.status === "cancelled" && b.cancelledBy === "system")) continue;
    const k = b.invitee.email.trim().toLowerCase();
    byEmail.set(k, [...(byEmail.get(k) ?? []), b]);
  }
  const clients = [...byEmail.entries()].map(([email, list]) => {
    const sorted = [...list].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const latest = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1)!;
    const confirmed = sorted.filter((b) => b.status === "confirmed");
    const past = confirmed.filter((b) => b.startAt <= now);
    const future = confirmed.filter((b) => b.startAt > now);
    return {
      key: clientKey(email), name: latest.invitee.name, email: latest.invitee.email, phone: [...sorted].reverse().find((b) => b.invitee.phone)?.invitee.phone ?? null,
      sessions: confirmed.length, upcoming: future.length, noShows: confirmed.filter((b) => b.invitee.noShowAt).length,
      cancelled: sorted.filter((b) => b.status === "cancelled").length, firstAt: sorted[0].startAt,
      lastAt: past.at(-1)?.startAt ?? null, nextAt: future[0]?.startAt ?? null,
    };
  });
  // Clients with a session coming up first, soonest first; then everyone else, most recently seen first.
  const coming = clients.filter((c) => c.nextAt).sort((a, b) => a.nextAt!.getTime() - b.nextAt!.getTime());
  const rest = clients.filter((c) => !c.nextAt).sort((a, b) => (b.lastAt ?? b.firstAt).getTime() - (a.lastAt ?? a.firstAt).getTime());
  return [...coming, ...rest];
}

/** "Session 3 with this client": where a booking falls among the client's confirmed sessions, by start. */
export function sessionNumber(bookings: BookingWithInvitee[], booking: BookingWithInvitee): number {
  const email = booking.invitee.email.trim().toLowerCase();
  const confirmed = bookings.filter((b) => b.status === "confirmed" && b.invitee.email.trim().toLowerCase() === email).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const i = confirmed.findIndex((b) => b.id === booking.id);
  return i === -1 ? 0 : i + 1;
}
