-- FUCQ-479: the run clock, its ticks and handler receipts. A tick moves forward only; receipts are immutable.

CREATE TABLE run_clocks (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  clock_instant timestamptz NOT NULL,
  clock_version bigint NOT NULL CHECK (clock_version > 0),
  scenario_version text NOT NULL CHECK (length(scenario_version) BETWEEN 1 AND 128),
  fixture_version text NOT NULL CHECK (length(fixture_version) BETWEEN 1 AND 128),
  starts_at timestamptz NOT NULL,
  named_times jsonb NOT NULL CHECK (jsonb_typeof(named_times) = 'object'),
  last_tick_id text CHECK (last_tick_id IS NULL OR length(last_tick_id) BETWEEN 1 AND 200),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);

CREATE FUNCTION run_clocks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.environment_id <> OLD.environment_id OR NEW.run_id <> OLD.run_id
     OR NEW.clock_instant < OLD.clock_instant OR NEW.clock_version < OLD.clock_version THEN
    RAISE EXCEPTION 'a run clock only moves forward' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_clocks_guard BEFORE UPDATE OR DELETE ON run_clocks
  FOR EACH ROW EXECUTE FUNCTION run_clocks_guard();

CREATE TABLE clock_ticks (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  tick_id text NOT NULL CHECK (length(tick_id) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('presenter', 'startup')),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  target_now timestamptz NOT NULL,
  target_clock_version bigint NOT NULL CHECK (target_clock_version > 0),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 128),
  handler_order jsonb NOT NULL CHECK (jsonb_typeof(handler_order) = 'array'),
  missing_stages jsonb NOT NULL CHECK (jsonb_typeof(missing_stages) = 'array'),
  outcomes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(outcomes) = 'array'),
  state text NOT NULL CHECK (state IN ('running', 'interrupted', 'pending', 'completed')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, tick_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);

-- A tick keeps its identity and plan; pending and completed ticks are final.
CREATE FUNCTION clock_ticks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state IN ('pending', 'completed') OR NEW.tick_id <> OLD.tick_id
     OR NEW.environment_id <> OLD.environment_id OR NEW.run_id <> OLD.run_id OR NEW.kind <> OLD.kind
     OR NEW.input_digest <> OLD.input_digest OR NEW.target_now <> OLD.target_now
     OR NEW.target_clock_version <> OLD.target_clock_version OR NEW.policy_version <> OLD.policy_version
     OR NEW.handler_order <> OLD.handler_order OR NEW.missing_stages <> OLD.missing_stages THEN
    RAISE EXCEPTION 'a clock tick keeps its plan and a finished tick is final'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clock_ticks_guard BEFORE UPDATE OR DELETE ON clock_ticks
  FOR EACH ROW EXECUTE FUNCTION clock_ticks_guard();

CREATE TABLE clock_handler_receipts (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  tick_id text NOT NULL,
  handler_id text NOT NULL CHECK (handler_id ~ '^[a-z0-9][a-z0-9-]*$'),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('completed', 'pending')),
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, tick_id, handler_id),
  FOREIGN KEY (environment_id, run_id, tick_id) REFERENCES clock_ticks (environment_id, run_id, tick_id)
);
CREATE TRIGGER clock_handler_receipts_immutable BEFORE UPDATE OR DELETE ON clock_handler_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
