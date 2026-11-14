-- FUCQ-479: which scenario prepared a run. A prepared row is final; a run is never re-prepared in place.

CREATE TABLE scenario_runs (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  scenario_id text NOT NULL CHECK (length(scenario_id) BETWEEN 1 AND 128),
  scenario_version text NOT NULL CHECK (length(scenario_version) BETWEEN 1 AND 128),
  fixture_version text NOT NULL CHECK (length(fixture_version) BETWEEN 1 AND 128),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 128),
  preparation_version text NOT NULL CHECK (length(preparation_version) BETWEEN 1 AND 128),
  state text NOT NULL CHECK (state IN ('preparing', 'prepared')),
  prepared_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'prepared') = (prepared_at IS NOT NULL)),
  PRIMARY KEY (environment_id, run_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);

CREATE FUNCTION scenario_runs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state = 'prepared' OR NEW.environment_id <> OLD.environment_id
     OR NEW.run_id <> OLD.run_id OR NEW.scenario_id <> OLD.scenario_id THEN
    RAISE EXCEPTION 'a prepared scenario run is final' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scenario_runs_guard BEFORE UPDATE OR DELETE ON scenario_runs
  FOR EACH ROW EXECUTE FUNCTION scenario_runs_guard();
