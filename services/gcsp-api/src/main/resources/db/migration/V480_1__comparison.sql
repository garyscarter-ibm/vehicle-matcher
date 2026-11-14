-- FUCQ-480: retained comparison results and supported comparison jobs. Both are keyed by environment, not run,
-- because a retained baseline must survive a demo run reset.

CREATE TABLE comparison_results (
  environment_id text NOT NULL REFERENCES environment_identity (environment_id),
  result_id text NOT NULL CHECK (length(result_id) BETWEEN 1 AND 128),
  experiment_id text NOT NULL CHECK (experiment_id IN ('process-only', 'order-mix', 'points', 'hold-sweep')),
  kind text NOT NULL CHECK (kind IN ('process-comparison', 'experiment-comparison')),
  completed_at timestamptz NOT NULL,
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 128),
  result_digest text NOT NULL CHECK (result_digest ~ '^[0-9a-f]{64}$'),
  origin text NOT NULL CHECK (origin IN ('retained', 'run')),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  stored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, result_id),
  CHECK ((kind = 'process-comparison') = (experiment_id = 'process-only'))
);
CREATE INDEX comparison_results_latest
  ON comparison_results (environment_id, experiment_id, completed_at DESC, result_id DESC);
CREATE TRIGGER comparison_results_immutable BEFORE UPDATE OR DELETE ON comparison_results
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE comparison_jobs (
  environment_id text NOT NULL REFERENCES environment_identity (environment_id),
  job_id text NOT NULL CHECK (length(job_id) BETWEEN 1 AND 128),
  experiment_id text NOT NULL CHECK (experiment_id IN ('process-only', 'order-mix', 'points', 'hold-sweep')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'interrupted')),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  seeds_done integer NOT NULL DEFAULT 0 CHECK (seeds_done >= 0),
  seeds_total integer NOT NULL DEFAULT 0 CHECK (seeds_total >= 0),
  steps_done integer NOT NULL DEFAULT 0 CHECK (steps_done >= 0),
  steps_total integer NOT NULL DEFAULT 0 CHECK (steps_total >= 0),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  result_id text,
  reason text,
  requested_by text NOT NULL,
  command_id text NOT NULL,
  input_digest text NOT NULL,
  instance_id text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  PRIMARY KEY (environment_id, job_id),
  UNIQUE (environment_id, requested_by, command_id),
  FOREIGN KEY (environment_id, result_id) REFERENCES comparison_results (environment_id, result_id),
  CHECK ((status = 'running') = (finished_at IS NULL))
);
CREATE UNIQUE INDEX comparison_jobs_one_running ON comparison_jobs (environment_id) WHERE status = 'running';

CREATE FUNCTION comparison_jobs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'running' THEN
    RAISE EXCEPTION 'a finished comparison job is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER comparison_jobs_guard BEFORE UPDATE OR DELETE ON comparison_jobs
  FOR EACH ROW EXECUTE FUNCTION comparison_jobs_guard();
