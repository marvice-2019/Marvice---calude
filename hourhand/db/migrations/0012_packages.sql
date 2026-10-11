-- Batch B: session packages. A host sells N sessions of one event type for one price, paid once to the host's own
-- Razorpay account. The buyer gets a private link (/p/<token>) to book them. A credit is used by a booking made with
-- the package and comes back if that booking is cancelled, so nothing stores a balance that could drift.
create table packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_type_id uuid not null references event_types(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  sessions int not null check (sessions between 2 and 50),
  price_minor int not null check (price_minor >= 100),           -- Razorpay's minimum order is ₹1
  currency text not null default 'INR' check (currency = 'INR'),
  valid_days int not null check (valid_days between 7 and 730),  -- from payment; sessions must start before then
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index packages_user_idx on packages (user_id, created_at);

create table package_purchases (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete restrict,
  host_id uuid not null references users(id) on delete cascade,
  -- What was bought, fixed at purchase so a later edit of the package doesn't change it.
  event_type_id uuid not null references event_types(id) on delete restrict,
  sessions int not null check (sessions between 2 and 50),
  price_minor int not null check (price_minor >= 100),
  currency text not null default 'INR',
  valid_days int not null,
  guest_name text not null,
  guest_email citext not null,
  guest_phone text,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),  -- the buyer's private link, like a manage token
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  provider_order_id text unique,
  provider_payment_id text unique,
  paid_at timestamptz,
  expires_at timestamptz,
  checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null and expires_at is not null and provider_payment_id is not null))
);
create index package_purchases_host_idx on package_purchases (host_id, created_at);
create index package_purchases_pending_idx on package_purchases (checked_at nulls first, created_at) where status = 'pending';

alter table bookings add column package_purchase_id uuid references package_purchases(id) on delete restrict;
create index bookings_package_idx on bookings (package_purchase_id) where package_purchase_id is not null;
