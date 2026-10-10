-- Hourhand schema, first migration.
-- Postgres 16. Every time is timestamptz in UTC. Money is integer minor units (paise / cents) plus a currency.
-- Access rule: there is no row level security. Every query in the data layer filters by the session user's id
-- (host_id / user_id). The public booking routes read only active event types by slug, and write invitees
-- through one server function that recomputes availability inside a transaction.

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists btree_gist; -- uuid equality inside an exclusion constraint
create extension if not exists citext;     -- case-insensitive email and slug

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Accounts and auth.
-- Better Auth owns the auth tables. Run its CLI schema generator at build time and map its user / session /
-- account / verification models onto users, auth_sessions, auth_accounts and auth_verification_tokens
-- (Better Auth supports custom table and field names). The auth_* columns below are placeholders for that
-- step; the app-owned columns on users (slug, timezone, time_format, whatsapp_number) stay as written.

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  email_verified timestamptz,
  name text,
  image text,
  slug citext not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  timezone text not null default 'Asia/Kolkata',
  locale text not null default 'en',
  time_format text not null default '12h' check (time_format in ('12h','24h')),
  whatsapp_number text,                       -- E.164; for sync alerts and host reminders
  deleted_at timestamptz,                     -- soft delete; a nightly job purges personal data after 30 days
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table auth_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  provider text not null,
  provider_account_id text not null,
  refresh_token text,                         -- encrypted at rest by the app (AES-GCM, key in env)
  access_token text,
  expires_at bigint,
  token_type text,
  scope text,
  id_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);
create index on auth_accounts (user_id);

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  session_token text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  expires timestamptz not null,
  created_at timestamptz not null default now()
);
create index on auth_sessions (user_id);

create table auth_verification_tokens (
  identifier text not null,
  token text not null,
  expires timestamptz not null,
  primary key (identifier, token)
);

-- Billing (plan state lives here, written only by Razorpay / Stripe webhooks)

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','solo','duo')),
  interval text check (interval in ('month','year')),
  provider text check (provider in ('razorpay','stripe')),
  provider_subscription_id text unique,
  status text not null default 'active' check (status in ('active','paused','past_due','cancelled')),
  extra_seats int not null default 0 check (extra_seats >= 0),
  current_period_end timestamptz,
  renewal_reminder_sent_at timestamptz,        -- fix 2: reminder 7 days before every renewal
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table team_members (                    -- Duo: an owner plus up to (1 + extra_seats) people
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  member_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('member','assistant')),
  created_at timestamptz not null default now(),
  unique (owner_id, member_id),
  check (owner_id <> member_id)
);
create index on team_members (member_id);

-- Calendars and sync health (fix 1)

create table calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft','icloud')),
  account_email citext not null,
  credentials_encrypted bytea not null,        -- OAuth tokens or iCloud app-specific password, encrypted by the app
  status text not null default 'ok' check (status in ('ok','degraded','disconnected')),
  last_synced_at timestamptz,
  last_error text,
  error_count int not null default 0,
  alert_sent_at timestamptz,                   -- one alert per outage, reset when status returns to ok
  push_channel_id text,                        -- Google watch channel / Graph subscription id
  push_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, account_email)
);
create index on calendar_connections (status, last_synced_at);
create index on calendar_connections (push_expires_at);

create table calendars (                       -- the individual calendars inside one connection
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references calendar_connections(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  external_id text not null,
  name text not null,
  check_conflicts boolean not null default true,
  is_add_to boolean not null default false,
  sync_token text,                             -- provider incremental sync token / CalDAV ctag
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id)
);
create index on calendars (user_id);
create unique index one_add_to_calendar_per_user on calendars (user_id) where is_add_to;

create table busy_blocks (                     -- cached busy times from external calendars
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references calendars(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  external_event_id text not null,
  busy tstzrange not null,
  updated_at timestamptz not null default now(),
  unique (calendar_id, external_event_id)
);
create index on busy_blocks using gist (user_id, busy);

-- Availability

create table availability_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  timezone text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on availability_schedules (user_id);
create unique index one_default_schedule_per_user on availability_schedules (user_id) where is_default;

create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references availability_schedules(id) on delete cascade,
  kind text not null check (kind in ('weekly','date')),
  weekday smallint check (weekday between 0 and 6),   -- 0 = Sunday
  on_date date,
  intervals jsonb not null default '[]',               -- [{"from":"09:00","to":"13:00"}], empty = unavailable
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'weekly' and weekday is not null and on_date is null)
      or (kind = 'date' and on_date is not null and weekday is null)),
  check (jsonb_typeof(intervals) = 'array')
);
create unique index on availability_rules (schedule_id, weekday) where kind = 'weekly';
create unique index on availability_rules (schedule_id, on_date) where kind = 'date';

-- Event types

create table event_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  schedule_id uuid references availability_schedules(id) on delete set null,  -- null = user's default
  kind text not null default 'one_on_one' check (kind in ('one_on_one','group','one_off')),
  name text not null,
  slug citext not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  description text,
  color text not null default '#b4410e',
  duration_minutes int not null check (duration_minutes between 5 and 720),
  duration_options int[] not null default '{}',
  min_notice_minutes int not null default 240 check (min_notice_minutes >= 0),
  booking_window_days int not null default 60 check (booking_window_days between 1 and 730),
  start_increment_minutes int not null default 30 check (start_increment_minutes in (5,10,15,20,30,45,60)),
  buffer_before_minutes int not null default 0 check (buffer_before_minutes between 0 and 240),
  buffer_after_minutes int not null default 0 check (buffer_after_minutes between 0 and 240),
  daily_limit int check (daily_limit > 0),
  seat_limit int check (seat_limit > 0),         -- group events only
  lock_timezone boolean not null default false,
  hidden boolean not null default false,          -- reachable by link only
  single_use boolean not null default false,
  active boolean not null default true,
  price_minor int check (price_minor >= 0),       -- null = free
  currency text check (currency in ('INR','USD','EUR','GBP','AUD','CAD')),
  cancellation_policy text,
  cancel_cutoff_minutes int not null default 0 check (cancel_cutoff_minutes >= 0),
  redirect_url text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug),
  check ((price_minor is null) = (currency is null)),
  check (kind <> 'group' or seat_limit is not null)
);
create index on event_types (user_id, position);

create table event_locations (
  id uuid primary key default gen_random_uuid(),
  event_type_id uuid not null references event_types(id) on delete cascade,
  kind text not null check (kind in ('google_meet','zoom','teams','phone_host_calls','phone_guest_calls','in_person','custom','ask_guest')),
  value text,
  position int not null default 0
);
create index on event_locations (event_type_id);

create table custom_questions (
  id uuid primary key default gen_random_uuid(),
  event_type_id uuid not null references event_types(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('short_text','long_text','phone','single_select','multi_select','consent')),
  required boolean not null default false,
  choices text[] not null default '{}',
  position int not null default 0
);
create index on custom_questions (event_type_id, position);

-- Bookings

create table bookings (
  id uuid primary key default gen_random_uuid(),
  event_type_id uuid not null references event_types(id) on delete restrict,
  host_id uuid not null references users(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  -- start/end widened by the event type's buffers, computed by the app at booking time
  buffered_start timestamptz not null,
  buffered_end timestamptz not null,
  busy tstzrange generated always as (tstzrange(buffered_start, buffered_end, '[)')) stored,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  location_kind text,
  location_value text,
  join_url text,
  external_event_id text,                      -- the event written to the host's add-to calendar
  idempotency_key text not null unique,        -- from the booking form; double submits return the same booking
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('host','guest','system')),
  cancel_reason text,
  rescheduled_from_id uuid references bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  check (buffered_start <= start_at and buffered_end >= end_at),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  -- the hard constraint: one host can never hold two overlapping confirmed one-on-one bookings
  constraint no_double_booking exclude using gist (host_id with =, busy with &&) where (status = 'confirmed')
);
create index on bookings (host_id, start_at);
create index on bookings (event_type_id);
create index on bookings (rescheduled_from_id);

create table invitees (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  host_id uuid not null references users(id) on delete cascade,
  name text not null,
  email citext not null,
  timezone text not null,
  phone text,                                  -- E.164; WhatsApp / SMS reminders, opt-in
  reminders_opt_out boolean not null default false,
  answers jsonb not null default '[]',
  manage_token text not null unique default encode(gen_random_bytes(24), 'hex'),  -- cancel / reschedule links
  no_show_at timestamptz,
  utm jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on invitees (booking_id);
create index on invitees (host_id, email);

create table booking_guests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  email citext not null,
  unique (booking_id, email)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete restrict,
  host_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('razorpay','stripe')),
  provider_payment_id text unique,
  amount_minor int not null check (amount_minor > 0),
  currency text not null,
  status text not null check (status in ('pending','paid','failed','refunded')),
  refunded_minor int not null default 0 check (refunded_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on payments (booking_id);
create index on payments (host_id, created_at);

-- Notifications (outbox: the job runner sends due rows and records the result)

create table notification_settings (
  id uuid primary key default gen_random_uuid(),
  event_type_id uuid not null references event_types(id) on delete cascade,
  trigger text not null check (trigger in ('booked','before_start','after_end','cancelled','rescheduled')),
  offset_minutes int not null default 0,
  channel text not null check (channel in ('email','whatsapp','sms')),
  recipient text not null check (recipient in ('guest','host')),
  template text,
  enabled boolean not null default true
);
create index on notification_settings (event_type_id);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,   -- whose quota it counts against
  channel text not null check (channel in ('email','whatsapp','sms')),
  kind text not null,                          -- confirmation, reminder, sync_alert, renewal_reminder, ...
  recipient text not null,
  send_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  attempts int not null default 0,
  provider_message_id text,
  last_error text,
  dedupe_key text not null unique,             -- e.g. booking:<id>:reminder:1440 — sends at most once
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on notifications (status, send_at);
create index on notifications (user_id, created_at);
create index on notifications (booking_id);

-- Integrations and incoming webhooks

create table integrations (                    -- Zoom, Razorpay / Stripe connected accounts
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('zoom','razorpay','stripe')),
  credentials_encrypted bytea not null,
  status text not null default 'ok' check (status in ('ok','disconnected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table webhook_events (                  -- idempotency for Razorpay, Stripe, Google, Microsoft, WhatsApp
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index on webhook_events (processed_at) where processed_at is null;

create table support_tickets (                 -- fix 3: a human replies within one working day
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  email citext not null,
  subject text not null,
  body text not null,
  status text not null default 'open' check (status in ('open','waiting','closed')),
  first_reply_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on support_tickets (status, created_at);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['users','auth_accounts','subscriptions','calendar_connections','calendars',
    'availability_schedules','availability_rules','event_types','bookings','invitees','payments',
    'notifications','integrations','support_tickets']
  loop
    execute format('create trigger %I_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;
