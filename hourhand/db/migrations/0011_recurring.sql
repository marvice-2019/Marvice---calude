-- Batch B: weekly repeats. A host lets guests book the same time for up to max_repeats weeks in one go (1 = off).
-- Each week is an ordinary booking; series_id points every week (the first included) at the first week's booking.
-- Free event types only for now: a paid series would need one payment covering several bookings.
alter table event_types add column max_repeats int not null default 1 check (max_repeats between 1 and 12);
alter table event_types add constraint event_types_repeat_free check (max_repeats = 1 or price_minor is null);
alter table bookings add column series_id uuid references bookings(id) on delete set null;
alter table bookings add column series_index int check (series_index between 1 and 12);
alter table bookings add constraint bookings_series_check check ((series_id is null) = (series_index is null));
create index bookings_series_idx on bookings (series_id) where series_id is not null;
