-- FUCQ-460: the employee brief. Confirmed versions and saved drafts are immutable rows; brief_heads holds the
-- authoritative current versions (one row per employee) so reads never scan history and writers CAS on it.

CREATE TABLE brief_heads (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  employee_id text NOT NULL,
  brief_version bigint NOT NULL DEFAULT 0 CHECK (brief_version >= 0),
  draft_version bigint NOT NULL DEFAULT 0 CHECK (draft_version >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, employee_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);

CREATE TABLE briefs (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  employee_id text NOT NULL,
  brief_version bigint NOT NULL CHECK (brief_version > 0),
  previous_brief_version bigint,
  operation text NOT NULL CHECK (operation IN
    ('confirmed', 'engaged', 'disengaged', 'paused', 'resumed', 'preferences-updated')),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  buddy jsonb NOT NULL CHECK (jsonb_typeof(buddy) = 'object'),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^[0-9a-f]{64}$'),
  policy_version text NOT NULL,
  account_facts_version text,
  confirmed_by text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  command_id text NOT NULL,
  PRIMARY KEY (environment_id, run_id, employee_id, brief_version),
  FOREIGN KEY (environment_id, run_id, employee_id) REFERENCES brief_heads (environment_id, run_id, employee_id),
  CHECK ((brief_version = 1 AND previous_brief_version IS NULL) OR previous_brief_version = brief_version - 1)
);
-- Consumed-draft check: has a later confirmed version the same semantic content as a saved draft.
CREATE INDEX briefs_semantic ON briefs (environment_id, run_id, employee_id, semantic_digest, brief_version);
CREATE TRIGGER briefs_immutable BEFORE UPDATE OR DELETE ON briefs FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE brief_drafts (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  employee_id text NOT NULL,
  draft_version bigint NOT NULL CHECK (draft_version > 0),
  base_brief_version bigint NOT NULL CHECK (base_brief_version >= 0),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^[0-9a-f]{64}$'),
  policy_version text NOT NULL,
  account_facts_version text,
  saved_by text NOT NULL,
  saved_at timestamptz NOT NULL,
  command_id text NOT NULL,
  PRIMARY KEY (environment_id, run_id, employee_id, draft_version),
  FOREIGN KEY (environment_id, run_id, employee_id) REFERENCES brief_heads (environment_id, run_id, employee_id)
);
CREATE TRIGGER brief_drafts_immutable BEFORE UPDATE OR DELETE ON brief_drafts FOR EACH ROW EXECUTE FUNCTION forbid_change();
