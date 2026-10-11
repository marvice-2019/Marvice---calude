-- B4b: instant sync. Google notifies Hourhand when a watched calendar changes; the next sync then runs at once instead
-- of waiting for the 5-minute poll, which stays on as a safety net. One watch channel per checked calendar.
alter table calendars add column push_channel_id text unique;  -- our id for Google's channel (a fresh uuid per renewal)
alter table calendars add column push_resource_id text;        -- Google's id for the watched resource, needed to stop it
alter table calendars add column push_token_hash text;         -- sha-256 of the random per-channel token Google echoes back
alter table calendars add column push_expires_at timestamptz;
alter table calendars add column push_error text;
alter table calendars add column push_retry_at timestamptz;    -- when to try watching again after a failure
create index calendars_push_due_idx on calendars (push_expires_at nulls first) where check_conflicts;
-- A sync holds its connection for a short lease, so a ping can't start a second, overlapping sync of the same calendar
-- (whose older result could overwrite fresh busy times).
alter table calendar_connections add column sync_claimed_until timestamptz;
