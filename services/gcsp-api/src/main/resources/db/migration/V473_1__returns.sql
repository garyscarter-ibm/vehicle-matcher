-- FUCQ-473: the separate old-car return journey. A plan is the return appointment; its outcome is recorded apart,
-- and only a confirmed return (or handover completion) changes the current-car relationship.

-- One return plan per exact order, pinned to the old contract and slot the order's selection recorded.
CREATE TABLE return_plans (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  order_uuid text NOT NULL CHECK (length(order_uuid) BETWEEN 1 AND 128),
  employee_id text NOT NULL CHECK (length(employee_id) BETWEEN 1 AND 128),
  old_contract_id text NOT NULL CHECK (length(old_contract_id) BETWEEN 1 AND 128),
  entitlement_slot_id text NOT NULL CHECK (length(entitlement_slot_id) BETWEEN 1 AND 128),
  source_reference text NOT NULL CHECK (length(source_reference) BETWEEN 1 AND 256),
  source_received_at timestamptz,
  choice text NOT NULL CHECK (choice IN ('same-visit', 'separate')),
  location jsonb NOT NULL CHECK (jsonb_typeof(location) = 'object'),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 128),
  provider_mode text NOT NULL CHECK (provider_mode IN ('synthetic', 'live')),
  state text NOT NULL CHECK (state IN ('not-requested', 'requested', 'change-proposed', 'scheduled')),
  requested_slot jsonb NOT NULL CHECK (jsonb_typeof(requested_slot) = 'object'),
  slot jsonb CHECK (slot IS NULL OR jsonb_typeof(slot) = 'object'),
  proposed_slot jsonb CHECK (proposed_slot IS NULL OR jsonb_typeof(proposed_slot) = 'object'),
  proposal_id text CHECK (length(proposal_id) BETWEEN 1 AND 128),
  accepted_proposal_id text CHECK (length(accepted_proposal_id) BETWEEN 1 AND 128),
  confirmation jsonb NOT NULL CHECK (jsonb_typeof(confirmation) = 'object'),
  history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history) = 'array' AND jsonb_array_length(history) <= 16),
  request_operation_id text NOT NULL,
  confirm_operation_id text,
  accept_operation_id text,
  pending_step text CHECK (pending_step IN ('request', 'confirm', 'accept')),
  pending_operation_id text,
  pending_last_known text CHECK (pending_last_known IN ('requesting', 'waiting', 'unknown')),
  blocked_step text CHECK (blocked_step IN ('request', 'confirm', 'accept')),
  blocked_code text CHECK (length(blocked_code) BETWEEN 1 AND 128),
  blocked_reason text CHECK (length(blocked_reason) BETWEEN 1 AND 512),
  outcome_closed boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, order_uuid),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id),
  CHECK ((pending_step IS NULL) = (pending_operation_id IS NULL) AND (pending_step IS NULL) = (pending_last_known IS NULL)),
  CHECK ((blocked_code IS NULL) = (blocked_reason IS NULL) AND (blocked_code IS NULL) = (blocked_step IS NULL)),
  CHECK (state <> 'scheduled' OR slot IS NOT NULL),
  CHECK (state <> 'change-proposed' OR (proposed_slot IS NOT NULL AND proposal_id IS NOT NULL))
);
CREATE INDEX return_plans_employee ON return_plans (environment_id, run_id, employee_id);
-- Progress reads only plans with provider work left; outcome_closed is set once the outcome settles or is refused.
CREATE INDEX return_plans_progress ON return_plans (environment_id, run_id, order_uuid)
  WHERE (state IN ('requested', 'scheduled') AND NOT outcome_closed) OR pending_operation_id IS NOT NULL;

CREATE FUNCTION return_plans_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.employee_id <> OLD.employee_id OR NEW.old_contract_id <> OLD.old_contract_id
     OR NEW.entitlement_slot_id <> OLD.entitlement_slot_id OR NEW.source_reference <> OLD.source_reference
     OR NEW.choice <> OLD.choice OR NEW.request_operation_id <> OLD.request_operation_id
     OR NEW.policy_version <> OLD.policy_version THEN
    RAISE EXCEPTION 'a return plan keeps its order, old car and source' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER return_plans_guard BEFORE UPDATE OR DELETE ON return_plans
  FOR EACH ROW EXECUTE FUNCTION return_plans_guard();

-- The physical return's outcome, opened once a plan is scheduled and settled only by the provider's confirmation.
CREATE TABLE return_outcomes (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  order_uuid text NOT NULL,
  operation_id text NOT NULL,
  expected_outcome text NOT NULL CHECK (expected_outcome IN ('returned', 'missed')),
  confirm_after timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('awaiting', 'returned', 'missed')),
  occurred_at timestamptz,
  provider_reference text CHECK (length(provider_reference) BETWEEN 1 AND 128),
  appointment jsonb NOT NULL CHECK (jsonb_typeof(appointment) = 'object'),
  location jsonb NOT NULL CHECK (jsonb_typeof(location) = 'object'),
  old_contract_id text NOT NULL,
  entitlement_slot_id text NOT NULL,
  exception_type text NOT NULL CHECK (length(exception_type) BETWEEN 1 AND 128),
  policy_version text NOT NULL,
  pending_last_known text CHECK (pending_last_known IN ('waiting', 'unknown')),
  blocked_code text CHECK (length(blocked_code) BETWEEN 1 AND 128),
  blocked_reason text CHECK (length(blocked_reason) BETWEEN 1 AND 512),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, order_uuid),
  UNIQUE (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, order_uuid) REFERENCES return_plans (environment_id, run_id, order_uuid),
  CHECK ((state = 'awaiting') = (occurred_at IS NULL) AND (state = 'awaiting') = (provider_reference IS NULL)),
  CHECK (state = 'awaiting' OR (pending_last_known IS NULL AND blocked_code IS NULL)),
  CHECK ((blocked_code IS NULL) = (blocked_reason IS NULL))
);
CREATE INDEX return_outcomes_awaiting ON return_outcomes (environment_id, run_id, order_uuid) WHERE state = 'awaiting';

CREATE FUNCTION return_outcomes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state <> 'awaiting' OR NEW.operation_id <> OLD.operation_id
     OR NEW.expected_outcome <> OLD.expected_outcome OR NEW.old_contract_id <> OLD.old_contract_id
     OR NEW.confirm_after <> OLD.confirm_after THEN
    RAISE EXCEPTION 'a recorded return outcome is final' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER return_outcomes_guard BEFORE UPDATE OR DELETE ON return_outcomes
  FOR EACH ROW EXECUTE FUNCTION return_outcomes_guard();

-- Current-car relationship per exact order; absent until the first confirmed event (the selection implies the baseline).
CREATE TABLE current_car_relationships (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  order_uuid text NOT NULL CHECK (length(order_uuid) BETWEEN 1 AND 128),
  employee_id text NOT NULL CHECK (length(employee_id) BETWEEN 1 AND 128),
  old_contract_id text CHECK (length(old_contract_id) BETWEEN 1 AND 128),
  old_slot_id text,
  old_status text CHECK (old_status IN ('held', 'returned')),
  old_returned_at timestamptz,
  old_provider_reference text,
  old_location jsonb CHECK (old_location IS NULL OR jsonb_typeof(old_location) = 'object'),
  new_configuration_id text,
  new_status text NOT NULL CHECK (new_status IN ('on-order', 'collected')),
  new_collected_at timestamptz,
  new_vin text CHECK (new_vin IS NULL OR new_vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  new_provider_reference text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, order_uuid),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id),
  CHECK ((old_contract_id IS NULL) = (old_status IS NULL)),
  CHECK (old_status IS DISTINCT FROM 'returned' OR (old_returned_at IS NOT NULL AND old_provider_reference IS NOT NULL)),
  CHECK (old_status = 'returned' OR (old_returned_at IS NULL AND old_provider_reference IS NULL)),
  CHECK ((new_status = 'collected') = (new_collected_at IS NOT NULL AND new_provider_reference IS NOT NULL))
);
CREATE INDEX current_car_relationships_employee ON current_car_relationships (environment_id, run_id, employee_id);

CREATE FUNCTION current_car_relationships_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.employee_id <> OLD.employee_id
     OR NEW.old_contract_id IS DISTINCT FROM OLD.old_contract_id
     OR (OLD.old_status = 'returned' AND NEW.old_status IS DISTINCT FROM 'returned')
     OR (OLD.new_status = 'collected' AND NEW.new_status <> 'collected') THEN
    RAISE EXCEPTION 'the current-car relationship only moves forward' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER current_car_relationships_guard BEFORE UPDATE OR DELETE ON current_car_relationships
  FOR EACH ROW EXECUTE FUNCTION current_car_relationships_guard();

-- The confirmed events that changed it; one per order and type, immutable.
CREATE TABLE current_car_events (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  order_uuid text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('handover-completed', 'return-confirmed')),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  provider_reference text NOT NULL CHECK (length(provider_reference) BETWEEN 1 AND 128),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, order_uuid, event_type),
  FOREIGN KEY (environment_id, run_id, order_uuid)
    REFERENCES current_car_relationships (environment_id, run_id, order_uuid)
);
CREATE TRIGGER current_car_events_immutable BEFORE UPDATE OR DELETE ON current_car_events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- The synthetic provider's own record of each call it received, so reconcile can answer not-found truthfully.
CREATE TABLE return_provider_receipts (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL,
  step text NOT NULL CHECK (step IN ('request', 'confirm', 'accept', 'outcome')),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE TRIGGER return_provider_receipts_immutable BEFORE UPDATE OR DELETE ON return_provider_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- The exact provider payload of each return operation, so a retry or reconcile resends identical input.
CREATE TABLE return_operations (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL,
  order_uuid text NOT NULL,
  step text NOT NULL CHECK (step IN ('request', 'confirm', 'accept', 'outcome')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, operation_id),
  UNIQUE (environment_id, run_id, order_uuid, step),
  FOREIGN KEY (environment_id, run_id, operation_id) REFERENCES pending_operations (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, order_uuid) REFERENCES return_plans (environment_id, run_id, order_uuid)
);
CREATE TRIGGER return_operations_immutable BEFORE UPDATE OR DELETE ON return_operations
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
