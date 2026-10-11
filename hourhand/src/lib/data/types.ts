// Entities mirror replica/schema.sql (snake_case columns -> camelCase fields). Times are UTC Date objects.

export type Interval = { from: string; to: string }; // "HH:MM" wall time in the schedule's zone

export interface User {
  id: string;
  email: string;
  name: string;
  slug: string;
  timezone: string;
  timeFormat: "12h" | "24h";
}

export interface AvailabilitySchedule {
  id: string;
  userId: string;
  name: string;
  timezone: string;
  isDefault: boolean;
}

export type AvailabilityRule =
  | { id: string; scheduleId: string; kind: "weekly"; weekday: number; onDate: null; intervals: Interval[] }
  | { id: string; scheduleId: string; kind: "date"; weekday: null; onDate: string; intervals: Interval[] };

export interface EventType {
  id: string;
  userId: string;
  scheduleId: string | null;
  name: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  minNoticeMinutes: number;
  bookingWindowDays: number;
  startIncrementMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  dailyLimit: number | null;
  /** Guests can't cancel online once the start is closer than this. 0 = any time before the start. */
  cancelCutoffMinutes: number;
  /** What guests pay in paise; null = free. Set only together with currency (price_minor / currency in the schema). */
  priceMinor: number | null;
  currency: "INR" | null;
  hidden: boolean;
  active: boolean;
  position: number;
  /** A one_off type is a one-off meeting: offered only at its own times, through its single-use link. */
  kind: "one_on_one" | "group" | "one_off";
}

/** What the host enters for a one-off meeting. */
export interface OneOffInput {
  name: string;
  durationMinutes: number;
  location: { kind: LocationKind; value?: string | null };
  description?: string | null;
  times: Date[];
}

/** A one-off meeting the store refused: `field` names what is wrong. */
export class InvalidOneOffError extends Error {
  readonly code = "invalid_one_off";
  constructor(readonly field: "times" | "durationMinutes" | "name", message: string) {
    super(message);
    this.name = "InvalidOneOffError";
  }
}

export type LocationKind =
  | "google_meet" | "zoom" | "teams" | "phone_host_calls" | "phone_guest_calls" | "in_person" | "custom" | "ask_guest";

export const LOCATION_KINDS: readonly LocationKind[] = [
  "google_meet", "zoom", "teams", "phone_host_calls", "phone_guest_calls", "in_person", "custom", "ask_guest",
];

export interface EventLocation {
  id: string;
  eventTypeId: string;
  kind: LocationKind;
  value: string | null;
  position: number;
}

export interface CustomQuestion {
  id: string;
  eventTypeId: string;
  label: string;
  kind: "short_text" | "long_text" | "phone" | "single_select" | "multi_select" | "consent";
  required: boolean;
  choices: string[];
  position: number;
}

export interface Booking {
  id: string;
  eventTypeId: string;
  hostId: string;
  startAt: Date;
  endAt: Date;
  bufferedStart: Date;
  bufferedEnd: Date;
  /** pending_payment: a paid booking holding its slot until holdExpiresAt while the guest pays. */
  status: "confirmed" | "cancelled" | "pending_payment";
  holdExpiresAt: Date | null;
  locationKind: LocationKind | null;
  /** The video link from the host's calendar (Google Meet), once the calendar event exists. */
  joinUrl: string | null;
  idempotencyKey: string;
  cancelledAt: Date | null;
  cancelledBy: "host" | "guest" | "system" | null;
  cancelReason: string | null;
  /** The booking this one replaced when a guest rescheduled. */
  rescheduledFromId: string | null;
  createdAt: Date;
}

export interface Invitee {
  id: string;
  bookingId: string;
  hostId: string;
  name: string;
  email: string;
  timezone: string;
  phone: string | null;
  answers: InviteeAnswer[];
  manageToken: string;
  /** When the host marked the guest as not having turned up. */
  noShowAt: Date | null;
}

/** One entry of invitees.answers (jsonb). The label is copied so later edits to the question don't rewrite history. */
export interface InviteeAnswer { questionId: string; label: string; answer: string }

export type BookingWithInvitee = Booking & { invitee: Invitee };

export type SyncStatus = "ok" | "degraded" | "disconnected";

export interface CalendarConnection {
  id: string;
  userId: string;
  provider: "google" | "microsoft" | "icloud";
  accountEmail: string;
  status: SyncStatus;
  lastSyncedAt: Date | null;
  lastError: string | null;
}

export interface Calendar {
  id: string;
  connectionId: string;
  userId: string;
  name: string;
  checkConflicts: boolean;
  isAddTo: boolean;
  /** Whether booked events can go into it: only calendars the host owns. */
  canWrite: boolean;
}

export interface BusyBlock {
  id: string;
  calendarId: string;
  userId: string;
  start: Date;
  end: Date;
}

export interface CreateBookingInput {
  eventTypeId: string;
  startAt: Date;
  idempotencyKey: string;
  /** Set for a paid booking: it starts as pending_payment holding the slot until then, with no emails yet. Postgres only. */
  holdUntil?: Date;
  /** Book through a single-use link: it must be open and for this event type, and is used up in the same transaction. */
  bookingLinkToken?: string;
  invitee: { name: string; email: string; timezone: string; phone: string | null; answers: InviteeAnswer[] };
}

export type BookingLinkState = "open" | "used" | "expired" | "revoked";

/**
 * A single-use booking link. `state` is derived: used when a booking made through it exists that the system didn't
 * cancel (a lapsed payment hold frees it); otherwise revoked, then expired, then open.
 */
export interface BookingLink {
  id: string;
  eventTypeId: string;
  label: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  state: BookingLinkState;
  usedBy: { bookingId: string; guestName: string; startAt: Date } | null;
}

export type ResolvedBookingLink =
  | { status: "open"; link: BookingLink; host: User; eventType: EventType }
  | { status: "used" | "expired" | "revoked" | "not_found" };

/** Someone already booked through this single-use link (or won the race to). */
export class LinkUsedError extends Error {
  readonly code = "link_used";
  constructor() {
    super("This link has already been used");
    this.name = "LinkUsedError";
  }
}

/** A booking link that can't be booked through: unknown (or for another event type), expired or revoked. */
export class LinkUnavailableError extends Error {
  readonly code = "link_unavailable";
  readonly status: "used" | "expired" | "revoked" | "not_found";
  constructor(status: "used" | "expired" | "revoked" | "not_found") {
    super(status === "not_found" ? "Booking link not found" : `This link is ${status}`);
    this.name = "LinkUnavailableError";
    this.status = status;
  }
}

/** Mirrors the bookings.no_double_booking exclusion constraint (Postgres 23P01). */
export class SlotTakenError extends Error {
  readonly code = "slot_taken";
  constructor() {
    super("That time was just taken.");
    this.name = "SlotTakenError";
  }
}

/** A request key that was already used for a different booking (another event type, host or reschedule). */
export class RequestKeyConflictError extends Error {
  readonly code = "key_conflict";
  constructor() {
    super("That request key was already used for a different booking");
    this.name = "RequestKeyConflictError";
  }
}

/** A record that doesn't exist, or belongs to someone else (the caller can't tell which, by design). */
export class NotFoundError extends Error {
  readonly code = "not_found";
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** The data layer every screen talks to. The Postgres version implements the same interface. */
export interface DataStore {
  /** Memory mode only: the seeded demo host. Postgres throws; screens use requireUser() from @/lib/auth/session. */
  getCurrentUser(): Promise<User>;
  getUserBySlug(slug: string): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  listEventTypes(userId: string): Promise<EventType[]>;
  getEventType(userId: string, id: string): Promise<EventType | null>;
  getPublicEventType(hostSlug: string, eventSlug: string): Promise<{ host: User; eventType: EventType } | null>;
  /** Empty unless the event type belongs to `userId`. */
  listEventLocations(userId: string, eventTypeId: string): Promise<EventLocation[]>;
  listCustomQuestions(userId: string, eventTypeId: string): Promise<CustomQuestion[]>;
  getDefaultSchedule(userId: string): Promise<{ schedule: AvailabilitySchedule; rules: AvailabilityRule[] }>;
  listCalendarConnections(userId: string): Promise<CalendarConnection[]>;
  listCalendars(userId: string): Promise<Calendar[]>;
  listBusyBlocks(userId: string, from: Date, to: Date): Promise<BusyBlock[]>;
  listBookings(userId: string): Promise<BookingWithInvitee[]>;
  getBooking(userId: string, id: string): Promise<BookingWithInvitee | null>;
  getBookingByManageToken(token: string): Promise<BookingWithInvitee | null>;
  createBooking(input: CreateBookingInput): Promise<BookingWithInvitee>;
  /** Throws NotFoundError unless the booking belongs to `hostId`. */
  cancelBooking(hostId: string, bookingId: string, by: "host" | "guest", reason?: string): Promise<BookingWithInvitee>;
  /** Atomically books `startAt` for the same guest and cancels the old booking. The overlap check ignores the old booking. */
  /** `by` is recorded as who cancelled the old booking. */
  rescheduleBooking(hostId: string, bookingId: string, startAt: Date, idempotencyKey: string, by?: "host" | "guest"): Promise<BookingWithInvitee>;
  /** Marks (or clears) the guest as a no-show. Throws NotFoundError unless it is `hostId`'s confirmed booking that has started by `now`. */
  setNoShow(hostId: string, bookingId: string, on: boolean, now: Date): Promise<BookingWithInvitee>;
  /** Replaces the weekly rules: weekday (0 = Sunday) to its ranges. Days left out or empty are unavailable. */
  /** The four schedule writes throw NotFoundError unless the schedule belongs to `userId`. */
  saveWeeklyHours(userId: string, scheduleId: string, byWeekday: Record<number, Interval[]>): Promise<void>;
  /** Sets one date's hours, replacing any override for that date. Empty intervals = unavailable all day. */
  saveDateOverride(userId: string, scheduleId: string, date: string, intervals: Interval[]): Promise<void>;
  deleteDateOverride(userId: string, scheduleId: string, date: string): Promise<void>;
  /** Marks every date from `from` to `to` (both included, YYYY-MM-DD) unavailable. */
  blockDateRange(userId: string, scheduleId: string, from: string, to: string): Promise<void>;
  /** Throws SlugTakenError when the user already has an event type with that slug (unique (user_id, slug)). */
  createEventType(userId: string, draft: EventTypeDraft): Promise<EventType>;
  updateEventType(userId: string, id: string, draft: EventTypeDraft): Promise<EventType>;
  setEventTypeActive(userId: string, id: string, active: boolean): Promise<EventType>;
  /** Throws EventTypeInUseError while bookings still point at it (bookings.event_type_id is on delete restrict). */
  deleteEventType(userId: string, id: string, now?: Date): Promise<void>;
  /** Replaces the event type's questions; list order becomes position. */
  saveQuestions(userId: string, eventTypeId: string, questions: QuestionDraft[]): Promise<CustomQuestion[]>;
  /**
   * Closes the account now: marks it deleted, turns its links off, cancels upcoming bookings and ends every session.
   * Deleted hosts are invisible to getUser and getUserBySlug. Returns the cancelled bookings so guests can be told.
   */
  deleteAccount(userId: string, now?: Date): Promise<BookingWithInvitee[]>;
  /** Permanently removes accounts deleted more than 30 days before `now`, with everything they own. Returns how many. */
  purgeDeletedAccounts(now?: Date): Promise<number>;
  /** Throws NotFoundError unless the event type is `hostId`'s and active. The raw token is returned only here. */
  createBookingLink(hostId: string, eventTypeId: string, opts: { label?: string; expiresAt?: Date | null }, now: Date): Promise<{ link: BookingLink; token: string }>;
  /** Newest first. */
  listBookingLinks(hostId: string, now: Date): Promise<BookingLink[]>;
  /** Throws NotFoundError unless it is `hostId`'s link and open at `now`. */
  revokeBookingLink(hostId: string, linkId: string, now: Date): Promise<BookingLink>;
  /** Public: what `/l/{token}` shows. Only an open link reveals its host and event type. */
  resolveBookingLink(token: string, now: Date): Promise<ResolvedBookingLink>;
  /**
   * A hidden one_off event type at the given times, with a single-use link to it that expires at the last time; all in one
   * write. Throws InvalidOneOffError unless there are 1–20 distinct future times and the duration is 5–720 minutes.
   */
  createOneOffMeeting(hostId: string, input: OneOffInput, now: Date): Promise<{ eventType: EventType; link: BookingLink; token: string }>;
  /** The offered start times of a one_off event type, earliest first. */
  listOneOffTimes(eventTypeId: string): Promise<Date[]>;
}

/** The editable fields of an event type, already validated. */
export type EventTypeDraft = Pick<EventType,
  "name" | "slug" | "description" | "durationMinutes" | "minNoticeMinutes" | "bookingWindowDays" | "startIncrementMinutes" |
  "bufferBeforeMinutes" | "bufferAfterMinutes" | "dailyLimit" | "cancelCutoffMinutes" | "priceMinor" | "currency" | "hidden"> & {
  location: { kind: LocationKind; value: string | null } | null;
};

/** A question as edited; `id` is null for a new one. */
export type QuestionDraft = Pick<CustomQuestion, "label" | "kind" | "required" | "choices"> & { id: string | null };

export class SlugTakenError extends Error {
  readonly code = "slug_taken";
  constructor() {
    super("That link is already used by another event type");
    this.name = "SlugTakenError";
  }
}

/** "upcoming": confirmed bookings still ahead. "history": only past or cancelled bookings, which must be kept. */
export class EventTypeInUseError extends Error {
  readonly code = "event_type_in_use";
  readonly reason: "upcoming" | "history";
  readonly upcomingCount: number;
  // Plain fields, not parameter properties: Node's built-in TypeScript stripping (used by scripts/) can't run those.
  constructor(reason: "upcoming" | "history", upcomingCount: number) {
    super(reason === "upcoming"
      ? `This event type has ${upcomingCount} upcoming ${upcomingCount === 1 ? "booking" : "bookings"}. Cancel or move ${upcomingCount === 1 ? "it" : "them"} first, or turn the link off to stop new bookings.`
      : "Past bookings were made with this event type, so it stays in your history. Turn the link off to stop new bookings.");
    this.name = "EventTypeInUseError";
    this.reason = reason;
    this.upcomingCount = upcomingCount;
  }
}
