-- Reshape the sign-in tables for Better Auth (0001 had the Auth.js layout).
-- The three auth_* tables were never written to, so they are dropped and recreated.
-- users stays the user table; only its verified-email column changes type.

alter table users drop column email_verified;
alter table users add column email_verified boolean not null default false;

drop table auth_accounts;
drop table auth_sessions;
drop table auth_verification_tokens;

create table auth_sessions (
  id text primary key default gen_random_uuid()::text,  -- text: Better Auth sets its own non-uuid ids for some rows
  token text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on auth_sessions (user_id);

create table auth_accounts (
  id text primary key default gen_random_uuid()::text,  -- text: Better Auth sets its own non-uuid ids for some rows
  account_id text not null,
  provider_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  access_token text,                          -- OAuth tokens: encrypted by the app before B4 stores calendar scopes
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, account_id)
);
create index on auth_accounts (user_id);

create table auth_verification_tokens (       -- magic-link tokens and other one-time codes
  id text primary key default gen_random_uuid()::text,  -- text: Better Auth sets its own non-uuid ids for some rows
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on auth_verification_tokens (identifier);
