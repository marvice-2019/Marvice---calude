-- Batch C: the Duo plan's second person. An owner on Duo invites one email; whoever signs in with it and accepts gets
-- Duo on their own account and can manage the owner's bookings, availability, event types and clients (not billing,
-- settings, integrations, calendar connections or earnings).
create table seats (
  owner_id uuid primary key references users(id) on delete cascade,   -- one second person per Duo plan
  member_email citext not null unique,                                 -- a person is the second person on one plan at most
  member_id uuid unique references users(id) on delete set null,       -- set when they accept
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  check ((member_id is null) = (accepted_at is null))
);
