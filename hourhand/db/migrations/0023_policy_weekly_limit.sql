-- Batch D: a cancellation policy the host writes (shown before booking and next to Cancel), and a cap on bookings per
-- week (Monday to Sunday in the host's zone), alongside the daily one.
alter table event_types add column cancel_policy text check (length(cancel_policy) <= 1000);
alter table event_types add column weekly_limit integer check (weekly_limit > 0);
