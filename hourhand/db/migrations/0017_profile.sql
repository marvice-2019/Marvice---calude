-- Batch C: the host's page as a small website. Everything here is public on /{slug}; nothing is required.
create table profiles (
  user_id uuid primary key references users(id) on delete cascade,
  headline text check (length(headline) <= 120),
  bio text check (length(bio) <= 2000),
  area text check (length(area) <= 120),                       -- "Indiranagar, Bengaluru": shown, not geocoded
  whatsapp text check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),     -- public chat number, separate from the private alerts one
  instagram text check (instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  reviews_url text check (reviews_url ~ '^https://' and length(reviews_url) <= 500),
  updated_at timestamptz not null default now()
);

-- One photo per host, small enough to keep in the database (and in its backups) on a single server.
create table profile_photos (
  user_id uuid primary key references users(id) on delete cascade,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data bytea not null check (octet_length(data) <= 2097152),
  updated_at timestamptz not null default now()
);
