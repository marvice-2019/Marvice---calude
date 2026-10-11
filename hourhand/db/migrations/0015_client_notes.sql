-- Batch C: client history and notes. A host's clients are their guests, grouped by email; each can have one private note
-- the host keeps (what they're working on, preferences, what was agreed). Only the host ever sees it.
create table client_notes (
  host_id uuid not null references users(id) on delete cascade,
  email citext not null,
  note text not null check (length(note) <= 5000),
  updated_at timestamptz not null default now(),
  primary key (host_id, email)
);
