-- Batch B: no-show deposit. A free event type can ask for a refundable deposit, paid like a priced booking into the
-- host's own Razorpay. It is refunded a day after the session ends unless the host marks a no-show by then, and in full
-- whenever the booking is cancelled. A priced event type doesn't take one (the price already commits the guest).
alter table event_types add column deposit_minor int check (deposit_minor >= 100);
alter table event_types add constraint event_types_deposit_free check (deposit_minor is null or price_minor is null);
-- A deposit holds one booking: weekly repeats stay on event types with nothing to pay.
alter table event_types drop constraint event_types_repeat_free;
alter table event_types add constraint event_types_repeat_free check (max_repeats = 1 or (price_minor is null and deposit_minor is null));
alter table payments add column kind text not null default 'payment' check (kind in ('payment','deposit'));
-- The job that refunds deposits after the session looks only at paid deposits.
create index payments_deposit_idx on payments (booking_id) where kind = 'deposit' and status = 'paid';
