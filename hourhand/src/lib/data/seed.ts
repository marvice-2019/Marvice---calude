import { TZDate } from "@date-fns/tz";
import type {
  AvailabilityRule, AvailabilitySchedule, BookingWithInvitee, BusyBlock, Calendar, CalendarConnection,
  CustomQuestion, EventLocation, EventType, User,
} from "./types";

export interface Seed {
  users: User[];
  schedules: AvailabilitySchedule[];
  rules: AvailabilityRule[];
  eventTypes: EventType[];
  locations: EventLocation[];
  questions: CustomQuestion[];
  connections: CalendarConnection[];
  calendars: Calendar[];
  busyBlocks: BusyBlock[];
  bookings: BookingWithInvitee[];
}

const TZ = "Asia/Kolkata";
const MIN = 60_000;

/** Fictional demo data for Priya Raman. Dates are relative to `now`: "next week" is the week after the coming Monday. */
export function buildSeed(now: Date): Seed {
  const local = new TZDate(now.getTime(), TZ);
  const daysToMonday = ((8 - local.getDay()) % 7) || 7;
  const at = (dayOffset: number, h: number, m = 0) =>
    new Date(new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + daysToMonday + 7 + dayOffset, h, m, TZ).getTime());
  const dateOf = (dayOffset: number) => at(dayOffset, 12).toISOString().slice(0, 10);

  const priya: User = { id: "usr_priya", email: "priya@example.in", name: "Priya Raman", slug: "priya", timezone: TZ, timeFormat: "12h" };
  const schedule: AvailabilitySchedule = { id: "sch_priya", userId: priya.id, name: "Working hours", timezone: TZ, isDefault: true };
  const weekday = [
    { from: "10:00", to: "13:00" },
    { from: "15:00", to: "19:00" },
  ];
  const rules: AvailabilityRule[] = [
    ...[1, 2, 3, 4, 5].map((d): AvailabilityRule => ({ id: `rule_w${d}`, scheduleId: schedule.id, kind: "weekly", weekday: d, onDate: null, intervals: weekday })),
    { id: "rule_w6", scheduleId: schedule.id, kind: "weekly", weekday: 6, onDate: null, intervals: [{ from: "10:00", to: "13:00" }] },
    { id: "rule_off", scheduleId: schedule.id, kind: "date", weekday: null, onDate: dateOf(2), intervals: [] }, // next Wednesday off
  ];

  const base = { userId: priya.id, scheduleId: schedule.id, minNoticeMinutes: 240, bookingWindowDays: 60, startIncrementMinutes: 30, dailyLimit: null, hidden: false, active: true };
  const eventTypes: EventType[] = [
    { ...base, id: "evt_coaching", name: "45-min coaching session", slug: "coaching", description: "A focused session on one goal you bring.", durationMinutes: 45, bufferBeforeMinutes: 10, bufferAfterMinutes: 10, position: 0 },
    { ...base, id: "evt_intro", name: "Free 15-min intro call", slug: "intro", description: "A short call to see if we're a good fit.", durationMinutes: 15, startIncrementMinutes: 15, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, position: 1 },
  ];

  const connections: CalendarConnection[] = [
    { id: "con_google", userId: priya.id, provider: "google", accountEmail: "priya.raman@example.in", status: "ok", lastSyncedAt: new Date(now.getTime() - 2 * MIN), lastError: null },
  ];
  const calendars: Calendar[] = [
    { id: "cal_work", connectionId: "con_google", userId: priya.id, name: "Work", checkConflicts: true, isAddTo: true },
  ];
  const busyBlocks: BusyBlock[] = [
    { id: "busy_1", calendarId: "cal_work", userId: priya.id, start: at(0, 16), end: at(0, 17) },
    { id: "busy_2", calendarId: "cal_work", userId: priya.id, start: at(1, 12), end: at(1, 13) },
    { id: "busy_3", calendarId: "cal_work", userId: priya.id, start: at(3, 17, 30), end: at(3, 18, 30) },
  ];

  const booking = (id: string, et: EventType, start: Date, guest: [string, string, string], cancelled = false): BookingWithInvitee => {
    const end = new Date(start.getTime() + et.durationMinutes * MIN);
    return {
      id, eventTypeId: et.id, hostId: priya.id, startAt: start, endAt: end,
      bufferedStart: new Date(start.getTime() - et.bufferBeforeMinutes * MIN),
      bufferedEnd: new Date(end.getTime() + et.bufferAfterMinutes * MIN),
      status: cancelled ? "cancelled" : "confirmed", locationKind: et.id === "evt_coaching" ? "google_meet" : null,
      idempotencyKey: `seed-${id}`, cancelledAt: cancelled ? now : null, cancelledBy: cancelled ? "guest" : null,
      cancelReason: cancelled ? "Travelling that week." : null, createdAt: now,
      invitee: { id: `inv_${id}`, bookingId: id, hostId: priya.id, name: guest[0], email: guest[1], timezone: guest[2], phone: null, answers: [], manageToken: `tok_${id}` },
    };
  };
  const [coaching, intro] = eventTypes;
  const bookings = [
    booking("bkg_1", coaching, at(0, 10), ["Arjun Mehta", "arjun.mehta@example.com", "Asia/Kolkata"]),
    booking("bkg_2", intro, at(1, 15), ["Sara Thomas", "sara.thomas@example.co.uk", "Europe/London"]),
    booking("bkg_3", coaching, at(3, 11), ["Kabir Nair", "kabir.nair@example.com", "America/New_York"], true),
  ];

  return {
    users: [priya], schedules: [schedule], rules, eventTypes,
    locations: [{ id: "loc_meet", eventTypeId: "evt_coaching", kind: "google_meet", value: null, position: 0 }],
    questions: [{ id: "q_goal", eventTypeId: "evt_coaching", label: "What would you like to work on?", kind: "long_text", required: true, choices: [], position: 0 }],
    connections, calendars, busyBlocks, bookings,
  };
}
