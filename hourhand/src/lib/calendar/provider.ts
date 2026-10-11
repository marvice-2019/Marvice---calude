// The contract every calendar provider (Google, Microsoft) meets, so sync, connections and the calendar jobs
// don't care which one a connection uses. Push channels stay provider-specific and optional.

export type CalendarProviderId = "google" | "microsoft";

/** Thrown by every provider. `revoked`: only a reconnect fixes it (grant revoked, permission removed). */
export class CalendarApiError extends Error {
  readonly status: number | null;
  readonly reason: string | null;
  readonly retryable: boolean;
  readonly revoked: boolean;
  constructor(message: string, opts: { status?: number | null; reason?: string | null; retryable?: boolean; revoked?: boolean } = {}) {
    super(message);
    this.name = "CalendarApiError";
    this.status = opts.status ?? null;
    this.reason = opts.reason ?? null;
    this.retryable = opts.retryable ?? false;
    this.revoked = opts.revoked ?? false;
  }
}

export interface TokenSet { accessToken: string; refreshToken: string | null; expiresAt: Date; scope: string; email: string | null }

/** A refreshed access token. Microsoft rotates refresh tokens: when `refreshToken` is set, it replaces the stored one. */
export interface RefreshedToken { accessToken: string; expiresAt: Date; refreshToken?: string | null }

/**
 * One calendar inside a connection. `accessRole` is normalised: "owner" calendars can hold booked events,
 * "writer" and "reader" are only checked for conflicts. `teams` is true when the calendar can create Teams meetings.
 */
export interface CalendarEntry { id: string; name: string; primary: boolean; accessRole: "owner" | "writer" | "reader"; teams?: boolean }

export interface BusyRange { start: Date; end: Date }

export type Conference = "google_meet" | "teams" | null;

export interface EventInput {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
  location: string | null;
  attendee: { email: string; name: string };
  /** The video link the provider should create with the event, if it can. */
  conference: Conference;
  bookingId: string;
}

/** `conferencePending`: the provider is still creating the video link; read the event again shortly. */
export interface EventResult { id: string; joinUrl: string | null; conferencePending: boolean }

export interface CalendarProvider {
  readonly id: CalendarProviderId;
  authUrl(p: { redirectUri: string; state: string; codeChallenge: string; loginHint?: string }): string;
  exchangeCode(p: { code: string; redirectUri: string; codeVerifier: string }, now?: Date): Promise<TokenSet>;
  refresh(refreshToken: string, now?: Date): Promise<RefreshedToken>;
  /** Best effort; a provider without a revoke endpoint resolves without doing anything. */
  revoke(token: string): Promise<void>;
  /** Scopes from `granted` (space-separated) that Hourhand needs but the user didn't grant. */
  missingScopes(granted: string): string[];
  listCalendars(accessToken: string): Promise<CalendarEntry[]>;
  /** Busy times per calendar id. A calendar that can't be read goes in `errors` instead of failing the whole call. */
  busy(accessToken: string, calendarIds: string[], timeMin: Date, timeMax: Date): Promise<{ busy: Map<string, BusyRange[]>; errors: Map<string, string> }>;
  insertEvent(accessToken: string, calendarId: string, e: EventInput): Promise<EventResult>;
  getEvent(accessToken: string, calendarId: string, eventId: string): Promise<EventResult>;
  moveEvent(accessToken: string, calendarId: string, eventId: string, start: Date, end: Date, timeZone: string, summary: string): Promise<EventResult>;
  /** Removing an event that is already gone succeeds. */
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
}

/** The providers configured on this server. A connection whose provider isn't configured can't sync or take events. */
export type CalendarProviders = Partial<Record<CalendarProviderId, CalendarProvider>>;
