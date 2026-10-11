-- B8: single-use booking links and one-off meetings. Only the SHA-256 of a link's token is stored.
create table booking_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_type_id uuid not null references event_types(id) on delete cascade,
  token_hash text not null unique,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  used_booking_id uuid references bookings(id) on delete set null,
  created_at timestamptz not null default now()
);
create index booking_links_user_id_idx on booking_links (user_id);

create table one_off_times (
  event_type_id uuid not null references event_types(id) on delete cascade,
  start_at timestamptz not null,
  primary key (event_type_id, start_at)
);

alter table bookings add column booking_link_id uuid references booking_links(id) on delete set null;
