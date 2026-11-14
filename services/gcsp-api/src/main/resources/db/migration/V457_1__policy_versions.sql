-- FUCQ-457: canonical versioned policy. Every key carries environment and run; V1 is not touched.

-- Content-addressed policy documents: one row per distinct digest, shared by every run that uses it.
CREATE TABLE policy_documents (
  seed_digest text PRIMARY KEY CHECK (seed_digest ~ '^[0-9a-f]{64}$'),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER policy_documents_immutable BEFORE UPDATE OR DELETE ON policy_documents
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- One row per policy version a run retains; the first is the run's base, materialized from the reviewed seed.
CREATE TABLE policy_versions (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 256),
  effective_from timestamptz NOT NULL,
  seed_digest text NOT NULL REFERENCES policy_documents (seed_digest),
  source_version text,
  publisher text NOT NULL,
  published_at timestamptz NOT NULL,
  command_id text,
  adoption jsonb,
  PRIMARY KEY (environment_id, run_id, policy_version),
  UNIQUE (environment_id, run_id, effective_from),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE TRIGGER policy_versions_immutable BEFORE UPDATE OR DELETE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- The run's activated policy, changed only by version CAS.
CREATE TABLE policy_run_activation (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  policy_version text NOT NULL,
  as_of timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id),
  FOREIGN KEY (environment_id, run_id, policy_version) REFERENCES policy_versions (environment_id, run_id, policy_version)
);
