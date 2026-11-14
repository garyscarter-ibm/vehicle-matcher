-- FUCQ-458: per-employee account record aggregate (source-supplied, read whole) and the employee slot lookup.
-- Read-only in this Story; seeding is scenario preparation (FUCQ-479).
CREATE TABLE employee_account_records (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  employee_id text NOT NULL,
  record_set_id text NOT NULL CHECK (length(btrim(record_set_id)) > 0),
  record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, employee_id),
  FOREIGN KEY (environment_id, run_id, employee_id) REFERENCES employees (environment_id, run_id, employee_id)
);

CREATE INDEX entitlement_slots_employee ON entitlement_slots (environment_id, run_id, employee_id);
