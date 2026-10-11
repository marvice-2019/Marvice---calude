-- Batch C: waitlist. A guest who finds a day full leaves their email for that day (their own day, in their time zone).
-- When a booking in that window is cancelled or moved away, each waiting guest is emailed once with a link to the freed
-- time; whoever books first gets it.
create table waitlist (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references users(id) on delete cascade,
  event_type_id uuid not null references event_types(id) on delete cascade,
  day date not null,                       -- the day as the guest saw it
  timezone text not null,
  window_start timestamptz not null,       -- that day's bounds in their zone
  window_end timestamptz not null,
  name text not null check (length(name) between 1 and 100),
  email citext not null,
  notified_at timestamptz,                 -- set when their one email is queued
  created_at timestamptz not null default now(),
  unique (event_type_id, day, email),
  check (window_end > window_start)
);
create index waitlist_waiting_idx on waitlist (event_type_id, window_start) where notified_at is null;
