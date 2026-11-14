-- FUCQ-478: Production requests. One immutable submission per plan, one request row per plan line (its id is also the one
-- provider operation id), append-only applied answers, confirmations awaiting supply, and the synthetic provider's record.

CREATE TABLE production_submissions (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  submission_id text NOT NULL CHECK (length(submission_id) BETWEEN 1 AND 200),
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 200),
  requested_by text NOT NULL,
  plan_id text NOT NULL CHECK (length(plan_id) BETWEEN 1 AND 512),
  plan_versions jsonb NOT NULL CHECK (jsonb_typeof(plan_versions) = 'object'),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, submission_id),
  -- One plan is sent to Production once.
  UNIQUE (environment_id, run_id, plan_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE TRIGGER production_submissions_immutable BEFORE UPDATE OR DELETE ON production_submissions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE production_requests (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 200),
  submission_id text NOT NULL,
  line_id text NOT NULL CHECK (length(line_id) BETWEEN 1 AND 200),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  derivative text NOT NULL CHECK (length(derivative) BETWEEN 1 AND 200),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  state text NOT NULL CHECK (state IN ('intent', 'uncertain', 'requested', 'partly-confirmed', 'confirmed', 'delayed',
    'refused', 'unsupported')),
  provider_mode text,
  provider_reference text,
  source_version text,
  refusal_code text,
  refusal_reason text,
  delay_until timestamptz,
  delay_reason text,
  confirmed_quantity integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_outcome jsonb CHECK (last_outcome IS NULL OR jsonb_typeof(last_outcome) = 'object'),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (confirmed_quantity BETWEEN 0 AND quantity),
  CHECK (state NOT IN ('requested', 'partly-confirmed', 'confirmed', 'delayed') OR provider_reference IS NOT NULL),
  CHECK (state <> 'delayed' OR delay_until IS NOT NULL),
  CHECK ((state IN ('refused', 'unsupported')) = (refusal_code IS NOT NULL)),
  PRIMARY KEY (environment_id, run_id, request_id),
  UNIQUE (environment_id, run_id, submission_id, line_id),
  FOREIGN KEY (environment_id, run_id, submission_id) REFERENCES production_submissions (environment_id, run_id, submission_id)
);
-- The later reconcile pass walks only requests still awaiting a final provider answer.
CREATE INDEX production_requests_open ON production_requests (environment_id, run_id, request_id)
  WHERE state IN ('intent', 'uncertain', 'requested', 'partly-confirmed', 'delayed');

-- Every applied provider answer, in order; an answer that changes nothing appends nothing.
CREATE TABLE production_responses (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  request_id text NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  state text NOT NULL CHECK (state IN ('requested', 'partly-confirmed', 'confirmed', 'delayed', 'refused', 'unsupported')),
  at timestamptz NOT NULL,
  provider_reference text,
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  PRIMARY KEY (environment_id, run_id, request_id, seq),
  FOREIGN KEY (environment_id, run_id, request_id) REFERENCES production_requests (environment_id, run_id, request_id)
);
CREATE TRIGGER production_responses_immutable BEFORE UPDATE OR DELETE ON production_responses
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Confirmed vehicles awaiting their queue into supply; queued_at is set when supply takes them.
CREATE TABLE production_confirmations (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  supply_id text NOT NULL CHECK (length(supply_id) BETWEEN 1 AND 512),
  request_id text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  confirmed_at timestamptz NOT NULL,
  source_version text NOT NULL CHECK (length(source_version) BETWEEN 1 AND 512),
  provider_reference text NOT NULL,
  queued_at timestamptz,
  eligible_from timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, supply_id),
  FOREIGN KEY (environment_id, run_id, request_id) REFERENCES production_requests (environment_id, run_id, request_id)
);
CREATE INDEX production_confirmations_unqueued ON production_confirmations (environment_id, run_id, confirmed_at, supply_id)
  WHERE queued_at IS NULL;
CREATE INDEX production_confirmations_request ON production_confirmations (environment_id, run_id, request_id);

-- The synthetic provider's own record (its "external system"): one order per operation id, and its scripted answers.
CREATE TABLE production_synthetic_orders (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 200),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  provider_reference text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('requested', 'refused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE TRIGGER production_synthetic_orders_immutable BEFORE UPDATE OR DELETE ON production_synthetic_orders
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE production_synthetic_responses (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, operation_id, seq),
  FOREIGN KEY (environment_id, run_id, operation_id) REFERENCES production_synthetic_orders (environment_id, run_id, operation_id)
);
CREATE TRIGGER production_synthetic_responses_immutable BEFORE UPDATE OR DELETE ON production_synthetic_responses
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
