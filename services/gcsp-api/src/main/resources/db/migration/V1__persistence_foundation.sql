-- FUCQ-456: fresh Java schema (Flyway, schema gcsp_app). Every mutable row is scoped by environment and run.
-- Later Stories add domain tables in new versioned files; applied files never change.

CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- The database's own identity, claimed once by the first app start; reset and startup compare it to config.
CREATE TABLE environment_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment_id text NOT NULL UNIQUE CHECK (environment_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  instance_id uuid NOT NULL DEFAULT gen_random_uuid(),
  reset_allowed boolean NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER environment_identity_immutable BEFORE UPDATE OR DELETE ON environment_identity
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE runs (
  environment_id text NOT NULL REFERENCES environment_identity (environment_id),
  run_id text NOT NULL CHECK (run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  status text NOT NULL CHECK (status IN ('active', 'retired')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  activated_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CHECK ((status = 'retired') = (retired_at IS NOT NULL)),
  PRIMARY KEY (environment_id, run_id)
);
CREATE UNIQUE INDEX runs_one_active ON runs (environment_id) WHERE status = 'active';

CREATE FUNCTION runs_forward_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'retired' OR NEW.revision < OLD.revision OR NEW.run_id <> OLD.run_id
     OR NEW.environment_id <> OLD.environment_id THEN
    RAISE EXCEPTION 'runs only move forward' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER runs_forward_only BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION runs_forward_only();
CREATE TRIGGER runs_no_delete BEFORE DELETE ON runs FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE run_resets (
  environment_id text NOT NULL,
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 200),
  actor_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  retired_run_id text NOT NULL,
  activated_run_id text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, command_id),
  UNIQUE (environment_id, activated_run_id),
  FOREIGN KEY (environment_id, retired_run_id) REFERENCES runs (environment_id, run_id),
  FOREIGN KEY (environment_id, activated_run_id) REFERENCES runs (environment_id, run_id)
);
CREATE TRIGGER run_resets_immutable BEFORE UPDATE OR DELETE ON run_resets
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE command_receipts (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  actor_id text NOT NULL,
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 200),
  command_type text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  run_revision bigint NOT NULL CHECK (run_revision > 0),
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, actor_id, command_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE TRIGGER command_receipts_immutable BEFORE UPDATE OR DELETE ON command_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE outbox_events (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  event_id text NOT NULL,
  actor_id text NOT NULL,
  command_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  run_revision bigint NOT NULL CHECK (run_revision > 0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'delivered', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, event_id),
  FOREIGN KEY (environment_id, run_id, actor_id, command_id)
    REFERENCES command_receipts (environment_id, run_id, actor_id, command_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX outbox_events_pending ON outbox_events (environment_id, run_id, created_at, event_id) WHERE state = 'pending';

-- Durable intent for external I/O: written before the call, finalized afterwards by version CAS.
CREATE TABLE pending_operations (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL,
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('intent', 'pending', 'acknowledged', 'refused')),
  provider_reference text,
  outcome jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, operation_id),
  UNIQUE (environment_id, run_id, operation_type, idempotency_key),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE INDEX pending_operations_open ON pending_operations (environment_id, run_id, updated_at) WHERE state IN ('intent', 'pending');

CREATE TABLE employees (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  employee_id text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, employee_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);

CREATE TABLE entitlement_slots (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  slot_id text NOT NULL,
  employee_id text NOT NULL,
  capacity smallint NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  attributes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, slot_id),
  UNIQUE (environment_id, run_id, slot_id, employee_id),
  FOREIGN KEY (environment_id, run_id, employee_id) REFERENCES employees (environment_id, run_id, employee_id)
);

-- Exact stock car: orderUuid is the identity; many cars may share one configurationId. No VIN on stock.
CREATE TABLE stock_cars (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  order_uuid text NOT NULL,
  configuration_id text NOT NULL,
  state text NOT NULL CHECK (length(state) BETWEEN 1 AND 40),
  attributes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, order_uuid),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE INDEX stock_cars_configuration ON stock_cars (environment_id, run_id, configuration_id);

-- Custody: one occupying hold per exact car and per slot unit (unit <= slot capacity), enforced natively.
CREATE TABLE custody_holds (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  hold_id text NOT NULL,
  order_uuid text NOT NULL,
  employee_id text NOT NULL,
  slot_id text NOT NULL,
  slot_unit smallint NOT NULL CHECK (slot_unit BETWEEN 1 AND 20),
  hold_type text NOT NULL CHECK (hold_type IN ('cart', 'buddy-offer')),
  state text NOT NULL CHECK (state IN ('active', 'claim-pending', 'release-pending', 'selection-pending',
                                       'released', 'expired', 'allocated', 'claim-failed')),
  expires_at timestamptz NOT NULL,
  operation_id text,
  attributes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, hold_id),
  FOREIGN KEY (environment_id, run_id, order_uuid) REFERENCES stock_cars (environment_id, run_id, order_uuid),
  FOREIGN KEY (environment_id, run_id, slot_id, employee_id)
    REFERENCES entitlement_slots (environment_id, run_id, slot_id, employee_id)
);
CREATE UNIQUE INDEX custody_holds_one_per_car ON custody_holds (environment_id, run_id, order_uuid)
  WHERE state IN ('active', 'claim-pending', 'release-pending', 'selection-pending');
CREATE UNIQUE INDEX custody_holds_one_per_slot_unit ON custody_holds (environment_id, run_id, slot_id, slot_unit)
  WHERE state IN ('active', 'claim-pending', 'release-pending', 'selection-pending');
CREATE INDEX custody_holds_employee ON custody_holds (environment_id, run_id, employee_id);

CREATE FUNCTION custody_holds_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state IN ('released', 'expired', 'allocated', 'claim-failed') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'terminal hold cannot change state' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.order_uuid <> OLD.order_uuid OR NEW.slot_id <> OLD.slot_id OR NEW.employee_id <> OLD.employee_id THEN
    RAISE EXCEPTION 'hold identity is fixed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER custody_holds_guard BEFORE UPDATE ON custody_holds FOR EACH ROW EXECUTE FUNCTION custody_holds_guard();

CREATE FUNCTION custody_holds_slot_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slot_unit > (SELECT capacity FROM entitlement_slots s WHERE s.environment_id = NEW.environment_id
                      AND s.run_id = NEW.run_id AND s.slot_id = NEW.slot_id) THEN
    RAISE EXCEPTION 'slot unit exceeds capacity' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER custody_holds_slot_unit BEFORE INSERT ON custody_holds FOR EACH ROW EXECUTE FUNCTION custody_holds_slot_unit();
