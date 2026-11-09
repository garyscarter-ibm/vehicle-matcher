-- FUCQ-175: comparison worker jobs are mutable state (progress and outcome); results stay in comparison_results.
CREATE TABLE comparison_jobs (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  run_id text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  job_id text GENERATED ALWAYS AS (data->>'jobId') STORED NOT NULL,
  status text GENERATED ALWAYS AS (data->>'status') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY (run_id,job_id),
  FOREIGN KEY (run_id) REFERENCES runs(run_id),
  CHECK (data->>'status' IN ('running','succeeded','failed','interrupted'))
);
