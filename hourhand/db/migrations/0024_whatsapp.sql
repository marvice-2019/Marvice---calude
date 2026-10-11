-- D7: automatic WhatsApp. A guest opts in with a tick next to their phone when booking; a STOP reply to our number
-- opts that number out for every host. Sends go through the notifications outbox with channel 'whatsapp'.
alter table invitees add column whatsapp_opt_in_at timestamptz;
create table whatsapp_opt_outs (
  phone text primary key,                      -- digits with country code, as WhatsApp sees the number
  opted_out_at timestamptz not null default now()
);
