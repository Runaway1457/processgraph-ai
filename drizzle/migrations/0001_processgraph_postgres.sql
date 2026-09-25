CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE analysis_status AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TABLE users (
  id serial PRIMARY KEY,
  open_id varchar(128) NOT NULL UNIQUE,
  name text,
  email varchar(320),
  login_method varchar(64),
  role user_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_signed_in timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(240) NOT NULL,
  format varchar(12) NOT NULL CHECK (format IN ('csv', 'xes')),
  source_hash varchar(128) NOT NULL,
  event_count integer NOT NULL CHECK (event_count >= 0),
  case_count integer NOT NULL CHECK (case_count >= 0),
  quality_report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, source_hash)
);
CREATE INDEX event_logs_owner_created_idx ON event_logs(owner_id, created_at DESC);

CREATE TABLE process_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid NOT NULL REFERENCES event_logs(id) ON DELETE CASCADE,
  case_id varchar(240) NOT NULL,
  activity varchar(240) NOT NULL,
  event_time timestamptz NOT NULL,
  resource varchar(240),
  lifecycle varchar(32),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  sequence integer NOT NULL CHECK (sequence >= 0)
);
CREATE INDEX process_events_log_case_sequence_idx ON process_events(log_id, case_id, sequence);
CREATE INDEX process_events_log_activity_time_idx ON process_events(log_id, activity, event_time);

CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid NOT NULL REFERENCES event_logs(id) ON DELETE CASCADE,
  engine_version varchar(32) NOT NULL,
  status analysis_status NOT NULL DEFAULT 'queued',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb,
  evidence jsonb,
  error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX analysis_runs_log_created_idx ON analysis_runs(log_id, created_at DESC);

CREATE TABLE investigation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_run_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  tool varchar(80) NOT NULL,
  status varchar(24) NOT NULL,
  input jsonb NOT NULL,
  evidence_ids jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_run_id, sequence)
);

CREATE MATERIALIZED VIEW process_edge_rollup AS
SELECT
  log_id,
  activity AS from_activity,
  lead(activity) OVER trace_window AS to_activity,
  event_time,
  lead(event_time) OVER trace_window AS next_event_time,
  case_id
FROM process_events
WINDOW trace_window AS (PARTITION BY log_id, case_id ORDER BY sequence);

CREATE INDEX process_edge_rollup_log_edge_idx ON process_edge_rollup(log_id, from_activity, to_activity);
