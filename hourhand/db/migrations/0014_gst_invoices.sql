-- Batch B: GST invoices to guests. A GST-registered host enters their details once; every price they're paid (a booking
-- or a session package) gets a tax invoice, and every refund of an invoiced payment a credit note. Deposits aren't
-- invoiced. Numbers run per host, per series, per financial year (CGST Rule 46(b): unique, at most 16 characters).
create table tax_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  legal_name text not null check (length(legal_name) between 1 and 200),
  address text not null check (length(address) between 5 and 500),
  state_code text not null check (state_code ~ '^[0-9]{2}$'),
  gstin text not null check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$' and substr(gstin, 1, 2) = state_code),
  sac text not null check (sac ~ '^[0-9]{4,8}$'),
  rate_bp int not null check (rate_bp in (500, 1200, 1800, 2800)),
  invoice_prefix text not null check (invoice_prefix ~ '^[A-Z0-9]{1,4}$'),
  updated_at timestamptz not null default now()
);

create table invoice_counters (
  host_id uuid not null references users(id) on delete cascade,
  series text not null check (series in ('invoice', 'credit_note')),
  fy text not null check (fy ~ '^[0-9]{4}$'),
  last int not null,
  primary key (host_id, series, fy)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('invoice', 'credit_note')),
  number text not null check (length(number) <= 16),
  fy text not null,
  seq int not null,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),  -- the guest's link to view and print it
  issued_at timestamptz not null,
  payment_id uuid references payments(id) on delete restrict,
  package_purchase_id uuid references package_purchases(id) on delete restrict,
  original_invoice_id uuid references invoices(id) on delete restrict,
  buyer_name text not null,
  buyer_email citext not null,
  supplier jsonb not null,               -- legal name, address, GSTIN and state as they were when issued
  place_of_supply text not null,
  description text not null,
  sac text not null,
  rate_bp int not null,
  taxable_minor int not null,
  cgst_minor int not null,
  sgst_minor int not null,
  igst_minor int not null,
  total_minor int not null check (total_minor > 0),
  created_at timestamptz not null default now(),
  unique (host_id, number),
  check ((payment_id is null) <> (package_purchase_id is null)),
  check ((kind = 'credit_note') = (original_invoice_id is not null)),
  check (taxable_minor + cgst_minor + sgst_minor + igst_minor = total_minor)
);
create unique index invoices_one_per_payment on invoices (payment_id) where kind = 'invoice' and payment_id is not null;
create unique index invoices_one_per_purchase on invoices (package_purchase_id) where kind = 'invoice' and package_purchase_id is not null;
create unique index invoices_one_credit_note on invoices (original_invoice_id) where kind = 'credit_note';
create index invoices_host_idx on invoices (host_id, issued_at);
