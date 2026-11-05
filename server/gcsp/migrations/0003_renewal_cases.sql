-- FUCQ-112: additive owned case state. Policy migration number 0002 remains reserved.
CREATE TABLE renewal_cases (
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  run_id text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  case_id text GENERATED ALWAYS AS (data->>'caseId') STORED NOT NULL,
  employee_id text GENERATED ALWAYS AS (data->>'employeeId') STORED NOT NULL,
  renewal_id text GENERATED ALWAYS AS (data->>'renewalId') STORED NOT NULL,
  version bigint GENERATED ALWAYS AS ((data->>'version')::bigint) STORED NOT NULL CHECK (version > 0),
  created_at text GENERATED ALWAYS AS (data->>'createdAt') STORED NOT NULL,
  updated_at text GENERATED ALWAYS AS (data->>'updatedAt') STORED NOT NULL,
  PRIMARY KEY (run_id,case_id),
  FOREIGN KEY (run_id,employee_id) REFERENCES employees(run_id,employee_id),
  CHECK (data->>'status' IN ('open','in-progress','remedy-proposed','resolved','closed'))
);
CREATE UNIQUE INDEX renewal_cases_active_renewal ON renewal_cases (run_id,employee_id,renewal_id)
  WHERE data->>'status' IN ('open','in-progress','remedy-proposed');
