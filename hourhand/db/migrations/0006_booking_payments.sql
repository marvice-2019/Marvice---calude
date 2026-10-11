-- B6: guests pay at booking, straight into the host's own Razorpay account (Hourhand never holds the money).
-- A paid booking first exists as pending_payment with a short hold, so the slot can't be taken while the guest pays.
alter table bookings drop constraint bookings_status_check;
alter table bookings add constraint bookings_status_check check (status in ('confirmed','cancelled','pending_payment'));
alter table bookings add column hold_expires_at timestamptz;
alter table bookings add constraint bookings_hold_check check ((status = 'pending_payment') = (hold_expires_at is not null));
-- A held slot blocks the host's calendar exactly like a confirmed one.
alter table bookings drop constraint no_double_booking;
alter table bookings add constraint no_double_booking exclude using gist (host_id with =, busy with &&) where (status in ('confirmed','pending_payment'));

-- One payment per Razorpay order, created on the host's account.
alter table payments add column provider_order_id text unique;
alter table payments add column paid_at timestamptz;
alter table payments add column refund_id text;
alter table payments add column last_error text;
alter table payments drop constraint payments_status_check;
alter table payments add constraint payments_status_check check (status in ('pending','paid','failed','refunded','refund_pending'));

-- The host's own API key pair. public_id is the key id (not sensitive, shown masked); the pair itself is sealed.
alter table integrations add column public_id text;
alter table integrations add column mode text check (mode in ('test','live'));

-- Refunds go through the job queue like email does.
alter table notifications drop constraint notifications_channel_check;
alter table notifications add constraint notifications_channel_check check (channel in ('email','whatsapp','sms','calendar','payment'));
