-- FUCQ-472: handover appointments. Requested, confirmed (scheduled) and completed stay distinct states;
-- provider writes ride pending_operations (V1) with their immutable inputs here.

-- One handover appointment per exact order in a run. Planning never sets completed; only a provider outcome does.
CREATE TABLE appointments (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  order_uuid text NOT NULL CHECK (length(order_uuid) BETWEEN 1 AND 128),
  employee_id text NOT NULL CHECK (length(employee_id) BETWEEN 1 AND 128),
  state text NOT NULL CHECK (state IN ('not-requested', 'requested', 'change-proposed', 'scheduled', 'completed')),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 128),
  provider_mode text NOT NULL,
  opening jsonb NOT NULL CHECK (jsonb_typeof(opening) = 'object'),
  confirmation jsonb NOT NULL CHECK (jsonb_typeof(confirmation) = 'object'),
  requested_slot jsonb NOT NULL CHECK (jsonb_typeof(requested_slot) = 'object'),
  slot jsonb CHECK (slot IS NULL OR jsonb_typeof(slot) = 'object'),
  proposed_slot jsonb CHECK (proposed_slot IS NULL OR jsonb_typeof(proposed_slot) = 'object'),
  proposal_id text,
  accepted_proposal_id text,
  pending_step text CHECK (pending_step IN ('request', 'confirm', 'accept', 'complete')),
  pending_operation_id text,
  blocked jsonb CHECK (blocked IS NULL OR jsonb_typeof(blocked) = 'object'),
  outcome jsonb CHECK (outcome IS NULL OR jsonb_typeof(outcome) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, order_uuid),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id),
  CHECK ((pending_step IS NULL) = (pending_operation_id IS NULL)),
  CHECK (state NOT IN ('scheduled', 'completed') OR slot IS NOT NULL),
  CHECK (state <> 'change-proposed' OR (proposed_slot IS NOT NULL AND proposal_id IS NOT NULL)),
  CHECK ((state = 'completed') = (outcome IS NOT NULL))
);
-- Ticks visit only appointments with provider work left: awaiting confirmation or an open operation.
CREATE INDEX appointments_actionable ON appointments (environment_id, run_id, order_uuid)
  WHERE state = 'requested' OR pending_step IS NOT NULL;

CREATE FUNCTION appointments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state = 'completed' OR NEW.environment_id <> OLD.environment_id
     OR NEW.run_id <> OLD.run_id OR NEW.order_uuid <> OLD.order_uuid OR NEW.employee_id <> OLD.employee_id
     OR NEW.policy_version <> OLD.policy_version OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'an appointment keeps its identity, moves by version and a completed one is final'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_guard BEFORE UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_guard();

-- Append-only state history; every entry carries the provider's own reference.
CREATE TABLE appointment_history (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  order_uuid text NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  state text NOT NULL CHECK (state IN ('requested', 'change-proposed', 'scheduled', 'completed')),
  at timestamptz NOT NULL,
  provider_reference text NOT NULL CHECK (length(provider_reference) BETWEEN 1 AND 512),
  PRIMARY KEY (environment_id, run_id, order_uuid, seq),
  FOREIGN KEY (environment_id, run_id, order_uuid) REFERENCES appointments (environment_id, run_id, order_uuid)
);
CREATE TRIGGER appointment_history_immutable BEFORE UPDATE OR DELETE ON appointment_history
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- The exact input of each provider write, fixed before the call so a retry or reconcile resends the same thing.
CREATE TABLE appointment_operation_inputs (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL,
  order_uuid text NOT NULL,
  step text NOT NULL CHECK (step IN ('request', 'confirm', 'accept', 'complete')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (environment_id, run_id, operation_id),
  UNIQUE (environment_id, run_id, order_uuid, step),
  FOREIGN KEY (environment_id, run_id, operation_id) REFERENCES pending_operations (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, order_uuid) REFERENCES appointments (environment_id, run_id, order_uuid)
);
CREATE TRIGGER appointment_operation_inputs_immutable BEFORE UPDATE OR DELETE ON appointment_operation_inputs
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Presenter ticks for appointment progress; the latest one is the run's demo time for appointments.
CREATE TABLE appointment_ticks (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  tick_id text NOT NULL CHECK (length(tick_id) BETWEEN 1 AND 200),
  tick_now timestamptz NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, tick_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE INDEX appointment_ticks_latest ON appointment_ticks (environment_id, run_id, tick_now DESC, seq DESC);
CREATE TRIGGER appointment_ticks_immutable BEFORE UPDATE OR DELETE ON appointment_ticks
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Labelled synthetic provider only: its own record of each write, once per operation id, for reconcile.
CREATE TABLE synthetic_appointment_receipts (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE TRIGGER synthetic_appointment_receipts_immutable BEFORE UPDATE OR DELETE ON synthetic_appointment_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
