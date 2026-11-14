-- FUCQ-474: owned renewal cases. One mutable row per case (version-checked) plus an immutable history child table.
-- At most one active case per employee and renewal; resolved and closed cases never block a new one.

CREATE TABLE renewal_cases (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  case_id text NOT NULL,
  employee_id text NOT NULL,
  renewal_id text NOT NULL CHECK (length(renewal_id) BETWEEN 1 AND 128),
  status text NOT NULL CHECK (status IN ('open', 'in-progress', 'remedy-proposed', 'resolved', 'closed')),
  owner_role text NOT NULL,
  owner_name text NOT NULL,
  reason text NOT NULL,
  trigger jsonb NOT NULL CHECK (jsonb_typeof(trigger) = 'object'),
  next_action text NOT NULL,
  due_at timestamptz NOT NULL,
  opened_at timestamptz NOT NULL,
  last_updated_at timestamptz NOT NULL,
  renewal_deadline date,
  renewal_deadline_state text NOT NULL CHECK (renewal_deadline_state IN ('supplied-demo-fact', 'needs-confirmation')),
  policy_version text NOT NULL,
  remedy jsonb CHECK (remedy IS NULL OR jsonb_typeof(remedy) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (environment_id, run_id, case_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id),
  CHECK ((renewal_deadline IS NOT NULL) = (renewal_deadline_state = 'supplied-demo-fact'))
);
CREATE UNIQUE INDEX renewal_cases_one_active ON renewal_cases (environment_id, run_id, employee_id, renewal_id)
  WHERE status IN ('open', 'in-progress', 'remedy-proposed');
CREATE INDEX renewal_cases_employee ON renewal_cases (environment_id, run_id, employee_id);

CREATE TABLE renewal_case_history (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  case_id text NOT NULL,
  seq bigint NOT NULL CHECK (seq > 0),
  at timestamptz NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'in-progress', 'remedy-proposed', 'resolved', 'closed')),
  reason text NOT NULL,
  trigger jsonb CHECK (trigger IS NULL OR jsonb_typeof(trigger) = 'object'),
  next_action text NOT NULL,
  due_at timestamptz NOT NULL,
  remedy jsonb CHECK (remedy IS NULL OR jsonb_typeof(remedy) = 'object'),
  PRIMARY KEY (environment_id, run_id, case_id, seq),
  FOREIGN KEY (environment_id, run_id, case_id) REFERENCES renewal_cases (environment_id, run_id, case_id)
);
CREATE TRIGGER renewal_case_history_immutable BEFORE UPDATE OR DELETE ON renewal_case_history
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
