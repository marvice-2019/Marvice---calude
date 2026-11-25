-- 002_jobs.sql — background job queue in Postgres (no Redis needed on a single VPS).
-- Workers claim jobs with FOR UPDATE SKIP LOCKED, so several workers never take the same job.
-- Platform table: read and written by the worker's owner connection, not by tenant sessions.

CREATE TABLE jobs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue         text NOT NULL,
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  run_at        timestamptz NOT NULL DEFAULT now(),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  locked_at     timestamptz,
  last_error    text,
  dedupe_key    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_ready_idx ON jobs (queue, run_at) WHERE status = 'queued';
CREATE INDEX jobs_running_idx ON jobs (locked_at) WHERE status = 'running';
-- Enqueuing the same logical job twice (e.g. a webhook retry) is a no-op while it is pending.
CREATE UNIQUE INDEX jobs_dedupe_uq ON jobs (queue, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');

CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
