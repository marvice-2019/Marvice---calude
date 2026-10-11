-- Feature 10: a guest can tell the host they're running late from their booking page; the host is emailed at once.
alter table invitees add column running_late_minutes int check (running_late_minutes between 1 and 120);
alter table invitees add column running_late_at timestamptz;
