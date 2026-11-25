-- 012_appointments.sql — bookable time slots, appointments and WhatsApp reminders.

CREATE TABLE booking_settings (
  tenant_id             uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  timezone              text NOT NULL DEFAULT 'Asia/Kolkata',
  hours                 jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"mon":[["10:00","13:00"],["14:00","18:00"]]}; missing day = closed
  slot_minutes          integer NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 480),
  capacity              integer NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 100),   -- bookings allowed in the same slot
  min_notice_minutes    integer NOT NULL DEFAULT 60 CHECK (min_notice_minutes BETWEEN 0 AND 10080),
  days_ahead            integer NOT NULL DEFAULT 14 CHECK (days_ahead BETWEEN 1 AND 90),
  reminder_minutes      integer NOT NULL DEFAULT 120 CHECK (reminder_minutes BETWEEN 0 AND 10080),   -- 0 = no reminder
  reminder_template_id  uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE appointments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL CHECK (ends_at > starts_at),
  status            text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled','completed','no_show')),
  notes             text CHECK (length(notes) <= 1000),
  source            text NOT NULL DEFAULT 'agent' CHECK (source IN ('agent','flow','api')),
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  reminder_sent_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointments_time_idx ON appointments (tenant_id, starts_at) WHERE status = 'booked';
CREATE INDEX appointments_contact_idx ON appointments (tenant_id, contact_id, starts_at);

CREATE TRIGGER booking_settings_updated_at BEFORE UPDATE ON booking_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['booking_settings','appointments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;
