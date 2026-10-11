-- Batch D: the language the guest booked in, so their emails and WhatsApp texts read the same way.
alter table invitees add column locale text not null default 'en' check (locale in ('en', 'hi', 'ta', 'te', 'kn'));
