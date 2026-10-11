-- B3: the notifications table becomes the job queue for email.
-- A worker claims due rows by setting locked_until (a lease), so a worker that dies mid-send releases its rows
-- when the lease runs out instead of holding them for ever. Retries move send_at forward; a row that runs out of
-- attempts, or hits a permanent error, ends as status 'failed' with last_error: that is the dead-letter log.
alter table notifications add column locked_until timestamptz;
alter table notifications add column sent_at timestamptz;
drop index if exists notifications_status_send_at_idx;
create index notifications_due_idx on notifications (send_at) where status = 'queued';
