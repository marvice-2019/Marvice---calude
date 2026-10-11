-- When a refund was recorded, set once. Earnings place refunds in a month by it; updated_at moves on any later write.
alter table payments add column refunded_at timestamptz;
update payments set refunded_at = updated_at where status = 'refunded';
-- Waitlist joins per address are capped over a rolling week (see joinWaitlist).
create index waitlist_email_created_idx on waitlist (email, created_at);
