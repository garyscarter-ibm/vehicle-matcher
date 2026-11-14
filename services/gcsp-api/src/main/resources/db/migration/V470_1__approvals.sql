-- FUCQ-470: lifecycle approvals. One head per order (current stage list, stages and outcome read together), insert-only
-- revision history, one decision row per stage (ticks, intent, provider phase), delivered ticks and the synthetic provider's record.

CREATE TABLE approval_orders (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  order_uuid text NOT NULL CHECK (length(order_uuid) BETWEEN 1 AND 128),
  employee_id text NOT NULL,
  entitlement_slot_id text,
  renewal_id text,
  route text NOT NULL CHECK (route IN ('manual', 'buddy')),
  source jsonb NOT NULL CHECK (jsonb_typeof(source) = 'object'),
  policy_version text NOT NULL,
  stage_list jsonb NOT NULL CHECK (jsonb_typeof(stage_list) = 'array'),
  current_stage text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('in-progress', 'declined', 'sent-to-ordering')),
  stages jsonb NOT NULL CHECK (jsonb_typeof(stages) = 'array'),
  transition jsonb CHECK (transition IS NULL OR jsonb_typeof(transition) = 'object'),
  lifecycle_revision bigint NOT NULL CHECK (lifecycle_revision > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, order_uuid),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE INDEX approval_orders_employee ON approval_orders (environment_id, run_id, employee_id, order_uuid);

-- Every lifecycle revision's full record, appended as Node appends its revision receipts.
CREATE TABLE approval_revisions (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  order_uuid text NOT NULL,
  lifecycle_revision bigint NOT NULL CHECK (lifecycle_revision > 0),
  record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, order_uuid, lifecycle_revision),
  FOREIGN KEY (environment_id, run_id, order_uuid) REFERENCES approval_orders (environment_id, run_id, order_uuid)
);
CREATE TRIGGER approval_revisions_immutable BEFORE UPDATE OR DELETE ON approval_revisions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Own table, not pending_operations: it needs stage, tick counts and the intended decision as typed columns.
CREATE TABLE approval_decisions (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 200),
  order_uuid text NOT NULL,
  stage text NOT NULL,
  intended_decision text NOT NULL CHECK (intended_decision IN ('approved', 'declined')),
  ticks_required integer NOT NULL CHECK (ticks_required BETWEEN 1 AND 50),
  ticks_elapsed integer NOT NULL DEFAULT 0 CHECK (ticks_elapsed >= 0),
  phase text NOT NULL DEFAULT 'waiting' CHECK (phase IN ('waiting', 'requested', 'uncertain', 'unsupported', 'confirmed')),
  occurred_at timestamptz,
  reason_code text,
  reason text,
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  provider_reference text,
  outcome jsonb CHECK (outcome IS NULL OR jsonb_typeof(outcome) = 'object'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- The tick that last counted or created this decision: one tick moves an order one step, even across instances.
  last_tick_id text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((phase = 'confirmed') = (provider_reference IS NOT NULL)),
  PRIMARY KEY (environment_id, run_id, operation_id),
  UNIQUE (environment_id, run_id, order_uuid, stage),
  FOREIGN KEY (environment_id, run_id, order_uuid) REFERENCES approval_orders (environment_id, run_id, order_uuid)
);
-- Startup reconcile and the open-decision read of a list page walk only decisions still awaiting a provider answer.
CREATE INDEX approval_decisions_open ON approval_decisions (environment_id, run_id, order_uuid, stage)
  WHERE phase <> 'confirmed';

CREATE TABLE approval_ticks (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  tick_id text NOT NULL CHECK (length(tick_id) BETWEEN 1 AND 200),
  now timestamptz NOT NULL,
  clock_version bigint NOT NULL CHECK (clock_version > 0),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('pending', 'completed')),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state = 'pending' OR result IS NOT NULL),
  PRIMARY KEY (environment_id, run_id, tick_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE INDEX approval_ticks_clock ON approval_ticks (environment_id, run_id, clock_version);

-- The synthetic ordering-status provider's own record (its "external system"), so a reconcile can find a decision.
CREATE TABLE approval_synthetic_decisions (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, operation_id)
);
CREATE TRIGGER approval_synthetic_decisions_immutable BEFORE UPDATE OR DELETE ON approval_synthetic_decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
