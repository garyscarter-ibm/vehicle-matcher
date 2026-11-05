CREATE TABLE policy_versions (
  data jsonb NOT NULL,
  run_id text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  policy_version text GENERATED ALWAYS AS (data->'seed'->>'policyVersion') STORED NOT NULL,
  seed_digest text GENERATED ALWAYS AS (data->>'seedDigest') STORED NOT NULL,
  command_id text GENERATED ALWAYS AS (data->>'commandId') STORED,
  effective_from timestamptz NOT NULL,
  PRIMARY KEY (run_id, policy_version),
  UNIQUE (run_id, seed_digest), UNIQUE (run_id, effective_from), UNIQUE (run_id, command_id),
  CHECK (effective_from = (data->'seed'->>'effectiveFrom')::timestamptz),
  CHECK (jsonb_typeof(data->'seed') = 'object' AND data->'seed'->>'schemaVersion' = '1'),
  CHECK (length(data->>'publisher') > 0 AND length(data->>'publishedAt') > 0)
);

CREATE TABLE eligibility_rules (
  data jsonb NOT NULL,
  run_id text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  policy_version text GENERATED ALWAYS AS (data->>'policyVersion') STORED NOT NULL,
  rule_id text GENERATED ALWAYS AS (data->>'ruleId') STORED NOT NULL,
  row_key text GENERATED ALWAYS AS (data->>'key') STORED NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0), effective_from timestamptz NOT NULL,
  PRIMARY KEY (run_id, policy_version, rule_id), UNIQUE (run_id, policy_version, row_key),
  UNIQUE (run_id, policy_version, ordinal),
  FOREIGN KEY (run_id, policy_version) REFERENCES policy_versions,
  CHECK (data->>'effect' IN ('include', 'exclude')),
  CHECK (effective_from = (data->>'effectiveFrom')::timestamptz)
);

CREATE TABLE scheme_rule_links (
  data jsonb NOT NULL,
  run_id text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  policy_version text GENERATED ALWAYS AS (data->>'policyVersion') STORED NOT NULL,
  link_id text GENERATED ALWAYS AS (data->>'linkId') STORED NOT NULL,
  rule_id text GENERATED ALWAYS AS (data->>'ruleId') STORED NOT NULL,
  row_key text GENERATED ALWAYS AS (data->>'key') STORED NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0), effective_from timestamptz NOT NULL,
  PRIMARY KEY (run_id, policy_version, link_id), UNIQUE (run_id, policy_version, row_key),
  UNIQUE (run_id, policy_version, ordinal),
  FOREIGN KEY (run_id, policy_version) REFERENCES policy_versions,
  FOREIGN KEY (run_id, policy_version, rule_id) REFERENCES eligibility_rules DEFERRABLE INITIALLY DEFERRED,
  CHECK (effective_from = (data->>'effectiveFrom')::timestamptz)
);

CREATE TABLE price_plans (
  data jsonb NOT NULL,
  run_id text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  policy_version text GENERATED ALWAYS AS (data->>'policyVersion') STORED NOT NULL,
  price_plan_id text GENERATED ALWAYS AS (data->>'pricePlanId') STORED NOT NULL,
  price_entry_id text GENERATED ALWAYS AS (data->>'priceEntryId') STORED NOT NULL,
  row_key text GENERATED ALWAYS AS (data->>'key') STORED NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0), effective_from timestamptz NOT NULL,
  PRIMARY KEY (run_id, policy_version, price_plan_id, price_entry_id), UNIQUE (run_id, policy_version, row_key),
  UNIQUE (run_id, policy_version, ordinal),
  FOREIGN KEY (run_id, policy_version) REFERENCES policy_versions,
  CHECK (effective_from = (data->>'effectiveFrom')::timestamptz),
  CHECK ((data->>'monthlyPoints')::numeric >= 0)
);

CREATE TABLE grade_allowances (
  data jsonb NOT NULL,
  run_id text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  policy_version text GENERATED ALWAYS AS (data->>'policyVersion') STORED NOT NULL,
  company_id text GENERATED ALWAYS AS (data->>'companyId') STORED NOT NULL,
  scheme_id text GENERATED ALWAYS AS (data->>'schemeId') STORED NOT NULL,
  grade_id text GENERATED ALWAYS AS (data->>'gradeId') STORED NOT NULL,
  row_key text GENERATED ALWAYS AS (data->>'key') STORED NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0), effective_from timestamptz NOT NULL,
  PRIMARY KEY (run_id, policy_version, company_id, scheme_id, grade_id), UNIQUE (run_id, policy_version, row_key),
  UNIQUE (run_id, policy_version, ordinal),
  FOREIGN KEY (run_id, policy_version) REFERENCES policy_versions,
  CHECK (effective_from = (data->>'effectiveFrom')::timestamptz),
  CHECK ((data->>'monthlyPoints')::numeric >= 0)
);

CREATE TABLE policy_assumptions (
  data jsonb NOT NULL,
  run_id text GENERATED ALWAYS AS (data->>'runId') STORED NOT NULL,
  policy_version text GENERATED ALWAYS AS (data->>'policyVersion') STORED NOT NULL,
  row_key text GENERATED ALWAYS AS (data->>'key') STORED NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0), effective_from timestamptz NOT NULL,
  PRIMARY KEY (run_id, policy_version, row_key), UNIQUE (run_id, policy_version, ordinal),
  FOREIGN KEY (run_id, policy_version) REFERENCES policy_versions,
  CHECK (effective_from = (data->>'effectiveFrom')::timestamptz),
  CHECK (data->>'status' IN ('assumed', 'verified'))
);

CREATE FUNCTION reject_policy_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Policy versions are immutable' USING ERRCODE = '55000';
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['policy_versions', 'scheme_rule_links', 'eligibility_rules', 'price_plans', 'grade_allowances', 'policy_assumptions']
  LOOP
    EXECUTE format('CREATE TRIGGER immutable_policy BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_policy_mutation()', table_name);
  END LOOP;
END;
$$;
