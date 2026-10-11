-- B5a: Hourhand plans. The subscriptions row is written only from provider data (webhooks re-read the subscription
-- from Razorpay or Stripe), never from what a browser sends.
alter table subscriptions add column provider_customer_id text;          -- Stripe customer, for the billing portal
alter table subscriptions add column provider_status text;               -- the provider's own status word, for support
alter table subscriptions add column synced_at timestamptz;
create index subscriptions_renewal_idx on subscriptions (current_period_end) where status = 'active' and not cancel_at_period_end;
-- unpaid: the provider stopped retrying a failed renewal (Razorpay halted, Stripe unpaid). No paid features.
alter table subscriptions drop constraint subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check check (status in ('active','paused','past_due','unpaid','cancelled'));
