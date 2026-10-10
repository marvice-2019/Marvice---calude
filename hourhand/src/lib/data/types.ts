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
  hidden: boolean;
  active: boolean;
  position: number;
}

export type LocationKind =
  | "google_meet" | "zoom" | "teams" | "phone_host_calls" | "phone_guest_calls" | "in_person" | "custom" | "ask_guest";

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
  status: "confirmed" | "cancelled";
  locationKind: LocationKind | null;
  idempotencyKey: string;
  cancelledAt: Date | null;
  cancelledBy: "host" | "guest" | "system" | null;
  cancelReason: string | null;
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
  invitee: { name: string; email: string; timezone: string; phone: string | null; answers: InviteeAnswer[] };
}

/** Mirrors the bookings.no_double_booking exclusion constraint (Postgres 23P01). */
export class SlotTakenError extends Error {
  readonly code = "slot_taken";
  constructor() {
    super("That time was just taken.");
    this.name = "SlotTakenError";
  }
}

/** The data layer every screen talks to. The Postgres version implements the same interface. */
export interface DataStore {
  getCurrentUser(): Promise<User>;
  getUserBySlug(slug: string): Promise<User | null>;
  listEventTypes(userId: string): Promise<EventType[]>;
  getEventType(userId: string, id: string): Promise<EventType | null>;
  getPublicEventType(hostSlug: string, eventSlug: string): Promise<{ host: User; eventType: EventType } | null>;
  listEventLocations(eventTypeId: string): Promise<EventLocation[]>;
  listCustomQuestions(eventTypeId: string): Promise<CustomQuestion[]>;
  getDefaultSchedule(userId: string): Promise<{ schedule: AvailabilitySchedule; rules: AvailabilityRule[] }>;
  listCalendarConnections(userId: string): Promise<CalendarConnection[]>;
  listCalendars(userId: string): Promise<Calendar[]>;
  listBusyBlocks(userId: string, from: Date, to: Date): Promise<BusyBlock[]>;
  listBookings(userId: string): Promise<BookingWithInvitee[]>;
  getBooking(userId: string, id: string): Promise<BookingWithInvitee | null>;
  getBookingByManageToken(token: string): Promise<BookingWithInvitee | null>;
  createBooking(input: CreateBookingInput): Promise<BookingWithInvitee>;
  cancelBooking(bookingId: string, by: "host" | "guest", reason?: string): Promise<BookingWithInvitee>;
}
