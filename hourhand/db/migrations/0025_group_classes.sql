-- Group classes: one booking row per guest (seat), all seats of one session sharing a class_key. The overlap guard lets
-- seats of the same class overlap each other and nothing else: two rows conflict when they overlap and their class
-- differs, and a booking that isn't a seat is a class of its own (its id).
alter table bookings add column class_key text;
create index on bookings (class_key) where class_key is not null;

alter table bookings drop constraint no_double_booking;
alter table bookings add constraint no_double_booking exclude using gist
  (host_id with =, busy with &&, (coalesce(class_key, id::text)) with <>) where (status in ('confirmed','pending_payment'));

-- No group event types exist yet, so the tighter range applies cleanly.
alter table event_types add constraint event_types_seat_limit_range check (kind <> 'group' or seat_limit between 2 and 500);
