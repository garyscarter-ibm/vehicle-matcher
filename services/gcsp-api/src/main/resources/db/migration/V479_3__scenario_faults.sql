-- FUCQ-479: the presenter's synthetic adapter fault, per run. A reset starts a new run, so its fault is none.

CREATE TABLE scenario_faults (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  adapter text NOT NULL CHECK (adapter IN ('stock')),
  mode text NOT NULL CHECK (mode IN ('none', 'unavailable', 'stale')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, adapter),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
