-- Batch D: up to 5 extra guests on a booking. They get the confirmation, changes and reminders; only the person who
-- booked gets the link that can cancel or move it.
alter table invitees add column guests citext[] not null default '{}' check (cardinality(guests) <= 5);
