-- FUCQ-462: stock release on native PostgreSQL. Ticks drive releases; receipts and the supply queue are immutable.

-- A delivered clock tick. delivered_seq is the cursor for the pending partial index; clock_version is run-monotonic.
CREATE TABLE supply_release_ticks (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  tick_id text NOT NULL CHECK (length(tick_id) BETWEEN 1 AND 200),
  delivered_seq bigint GENERATED ALWAYS AS IDENTITY,
  tick_now timestamptz NOT NULL,
  clock_version bigint NOT NULL CHECK (clock_version > 0),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('pending', 'completed', 'refused')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_outcome jsonb CHECK (last_outcome IS NULL OR jsonb_typeof(last_outcome) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state = 'pending' OR last_outcome IS NOT NULL),
  PRIMARY KEY (environment_id, run_id, tick_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE INDEX supply_release_ticks_pending ON supply_release_ticks (environment_id, run_id, delivered_seq)
  WHERE state = 'pending';
CREATE INDEX supply_release_ticks_clock ON supply_release_ticks (environment_id, run_id, clock_version DESC, delivered_seq DESC);

CREATE FUNCTION supply_release_ticks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state <> 'pending' OR NEW.tick_id <> OLD.tick_id OR NEW.tick_now <> OLD.tick_now
     OR NEW.clock_version <> OLD.clock_version OR NEW.input_digest <> OLD.input_digest
     OR NEW.delivered_seq <> OLD.delivered_seq THEN
    RAISE EXCEPTION 'a delivered tick keeps its identity and a finished tick is final'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supply_release_ticks_guard BEFORE UPDATE OR DELETE ON supply_release_ticks
  FOR EACH ROW EXECUTE FUNCTION supply_release_ticks_guard();

-- Confirmed supply queued for a later release; eligible_from is confirmed_at plus the policy lead time.
CREATE TABLE confirmed_supply_queue (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  supply_id text NOT NULL CHECK (length(supply_id) BETWEEN 1 AND 512),
  confirmed_at timestamptz NOT NULL,
  source_version text NOT NULL CHECK (length(source_version) BETWEEN 1 AND 512),
  eligible_from timestamptz NOT NULL,
  policy_version text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, supply_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE TRIGGER confirmed_supply_queue_immutable BEFORE UPDATE OR DELETE ON confirmed_supply_queue
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- The tranche receipt: one row per released tranche, written in the same transaction as its cars.
CREATE TABLE stock_releases (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  tranche_id text NOT NULL CHECK (length(tranche_id) BETWEEN 1 AND 512),
  window_id text NOT NULL,
  supply_id text,
  tick_id text NOT NULL,
  released_at timestamptz NOT NULL,
  policy_version text NOT NULL,
  source jsonb NOT NULL CHECK (jsonb_typeof(source) = 'object'),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  order_uuids jsonb NOT NULL CHECK (jsonb_typeof(order_uuids) = 'array'),
  visible_order_uuids jsonb NOT NULL CHECK (jsonb_typeof(visible_order_uuids) = 'array'),
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, tranche_id),
  FOREIGN KEY (environment_id, run_id, tick_id) REFERENCES supply_release_ticks (environment_id, run_id, tick_id),
  FOREIGN KEY (environment_id, run_id, supply_id) REFERENCES confirmed_supply_queue (environment_id, run_id, supply_id)
);
CREATE INDEX stock_releases_latest ON stock_releases (environment_id, run_id, released_at DESC, tranche_id DESC);
CREATE TRIGGER stock_releases_immutable BEFORE UPDATE OR DELETE ON stock_releases
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- The allocator reads released cars by keyset over order_uuid.
CREATE INDEX stock_cars_released ON stock_cars (environment_id, run_id, order_uuid) WHERE state = 'released';
