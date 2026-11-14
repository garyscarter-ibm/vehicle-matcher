-- FUCQ-468: the selection-order handoff. One immutable selection per employee slot per run, bound to one
-- pending_operations intent (the external-call custody), a gap-free reference counter and the synthetic provider's record.

CREATE TABLE selection_orders (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 200),
  employee_id text NOT NULL,
  entitlement_slot_id text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('cart', 'buddy-offer')),
  hold_id text NOT NULL,
  order_uuid text NOT NULL CHECK (length(order_uuid) BETWEEN 1 AND 128),
  order_reference text NOT NULL CHECK (length(order_reference) BETWEEN 1 AND 40),
  policy_version text NOT NULL,
  -- The immutable snapshot: quote, stock, terms (with approval stages and digest), declarations, draft mode, driver, contact.
  selection jsonb NOT NULL CHECK (jsonb_typeof(selection) = 'object'),
  received_at timestamptz NOT NULL,
  -- The only mutable column: a driver holds it while it calls the provider, so one provider call is in flight.
  handoff_lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, operation_id) REFERENCES pending_operations (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, entitlement_slot_id, employee_id)
    REFERENCES entitlement_slots (environment_id, run_id, slot_id, employee_id),
  FOREIGN KEY (environment_id, run_id, order_uuid) REFERENCES stock_cars (environment_id, run_id, order_uuid),
  CONSTRAINT selection_orders_one_per_slot UNIQUE (environment_id, run_id, employee_id, entitlement_slot_id),
  CONSTRAINT selection_orders_reference_unique UNIQUE (environment_id, run_id, order_reference)
);
CREATE INDEX selection_orders_order ON selection_orders (environment_id, run_id, order_uuid);

CREATE FUNCTION selection_orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'selection_orders rows are never deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (to_jsonb(NEW) - 'handoff_lease_until' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'handoff_lease_until' - 'updated_at') THEN
    RAISE EXCEPTION 'a selection snapshot is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER selection_orders_guard BEFORE UPDATE OR DELETE ON selection_orders
  FOR EACH ROW EXECUTE FUNCTION selection_orders_guard();

-- Next order number per prefix: one row read and bumped by a fixed-cost upsert, rolled back with a refused command.
CREATE TABLE ordering_reference_counters (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  prefix text NOT NULL,
  next_value bigint NOT NULL CHECK (next_value > 0),
  PRIMARY KEY (environment_id, run_id, prefix),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);

-- The synthetic ordering provider's own idempotent record (its "external system"), so a reconcile can find an order.
CREATE TABLE ordering_synthetic_receipts (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, operation_id)
);
CREATE TRIGGER ordering_synthetic_receipts_immutable BEFORE UPDATE OR DELETE ON ordering_synthetic_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
