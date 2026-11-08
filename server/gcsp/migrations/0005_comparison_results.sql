-- FUCQ-136: comparison results are append-only; a new run writes a new row and no row is ever updated.
CREATE TABLE comparison_results (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  run_id text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  result_id text GENERATED ALWAYS AS (data->>'resultId') STORED NOT NULL,
  experiment_id text GENERATED ALWAYS AS (data->>'experimentId') STORED NOT NULL,
  policy_version text GENERATED ALWAYS AS (data->>'policyVersion') STORED NOT NULL,
  completed_at text GENERATED ALWAYS AS (data->>'completedAt') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version = 1),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY (run_id,result_id),
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
);
