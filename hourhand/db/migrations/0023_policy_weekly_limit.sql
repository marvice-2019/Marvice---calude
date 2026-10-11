-- Batch D: a cancellation policy the host writes (shown before booking and next to Cancel), and a cap on bookings per
-- week (Monday to Sunday in the host's zone), alongside the daily one. The policy uses 0001's cancellation_policy column.
alter table event_types add constraint event_types_cancellation_policy_length check (length(cancellation_policy) <= 1000);
alter table event_types add column weekly_limit integer check (weekly_limit > 0);
-- The confirmation page sends guests to redirect_url, so only https links up to 500 characters are kept.
update event_types set redirect_url = null where redirect_url is not null and (redirect_url not like 'https://%' or length(redirect_url) > 500);
alter table event_types add constraint event_types_redirect_url_https check (redirect_url like 'https://%' and length(redirect_url) <= 500);
