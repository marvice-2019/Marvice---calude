-- B4a: Google Calendar.
-- Calendar writes (create, move, delete the host's event) run through the same queue as email.
alter table notifications drop constraint notifications_channel_check;
alter table notifications add constraint notifications_channel_check check (channel in ('email','whatsapp','sms','calendar'));

-- Which of the host's calendars holds a booking's event, so a later move or cancel finds it even if the host has
-- since picked another calendar for new bookings.
alter table bookings add column external_calendar_id uuid references calendars(id) on delete set null;

-- The sync job claims a connection by pushing next_sync_at forward, the same way the email queue claims rows.
alter table calendar_connections add column next_sync_at timestamptz not null default now();
alter table calendar_connections add column granted_scopes text;
create index calendar_connections_due_idx on calendar_connections (next_sync_at) where status <> 'disconnected';

-- Google's role on each calendar: only calendars the host owns can hold booked events (the events.owned scope).
alter table calendars add column access_role text not null default 'owner';
