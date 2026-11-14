-- FUCQ-464: Buddy allocation, pinned quotes, offers and remote Buddy operations. Holds stay in custody_holds (V1),
-- whose unique indexes give one occupying holder per exact car and per slot unit.

-- One allocation per trigger event: the frozen plan, its claim cursor (next_index, by version CAS) and the outcome.
CREATE TABLE allocation_runs (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  allocation_id text NOT NULL CHECK (length(allocation_id) BETWEEN 1 AND 200),
  trigger_type text NOT NULL CHECK (trigger_type IN ('stock-released', 'brief-changed', 'buddy-expired', 'offer-declined')),
  source_event_id text NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 512),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('pending', 'completed')),
  evaluated_at timestamptz NOT NULL,
  clock_version bigint NOT NULL CHECK (clock_version > 0),
  policy_version text NOT NULL,
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  contender_count integer NOT NULL CHECK (contender_count >= 0),
  next_index integer NOT NULL DEFAULT 0 CHECK (next_index >= 0 AND next_index <= contender_count),
  outcome jsonb CHECK (outcome IS NULL OR jsonb_typeof(outcome) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'completed') = (outcome IS NOT NULL)),
  PRIMARY KEY (environment_id, run_id, allocation_id),
  UNIQUE (environment_id, run_id, source_event_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);

CREATE FUNCTION allocation_runs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state = 'completed' OR NEW.allocation_id <> OLD.allocation_id
     OR NEW.source_event_id <> OLD.source_event_id OR NEW.input_digest <> OLD.input_digest
     OR NEW.plan <> OLD.plan OR NEW.contender_count <> OLD.contender_count OR NEW.next_index < OLD.next_index THEN
    RAISE EXCEPTION 'an allocation keeps its plan, only moves forward and is final once completed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER allocation_runs_guard BEFORE UPDATE OR DELETE ON allocation_runs
  FOR EACH ROW EXECUTE FUNCTION allocation_runs_guard();

-- Every ranked eligible contender (the complete fallback list), in claim order, with its pinned quote.
CREATE TABLE allocation_contenders (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  allocation_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  employee_id text NOT NULL,
  slot_id text NOT NULL,
  renewal_id text,
  order_uuid text NOT NULL,
  renewal_due timestamptz NOT NULL,
  score double precision,
  lottery text NOT NULL CHECK (lottery ~ '^[0-9a-f]{64}$'),
  expected_versions jsonb NOT NULL CHECK (jsonb_typeof(expected_versions) = 'object'),
  reasons jsonb NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  quote jsonb NOT NULL CHECK (jsonb_typeof(quote) = 'object'),
  PRIMARY KEY (environment_id, run_id, allocation_id, ordinal),
  FOREIGN KEY (environment_id, run_id, allocation_id) REFERENCES allocation_runs (environment_id, run_id, allocation_id)
);
CREATE TRIGGER allocation_contenders_immutable BEFORE UPDATE OR DELETE ON allocation_contenders
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Each evaluated employee's decisions (gate, score, reasons, blockers, unknowns): the allocation's explanations.
CREATE TABLE allocation_evaluations (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  allocation_id text NOT NULL,
  employee_id text NOT NULL,
  excluded_code text CHECK (excluded_code IS NULL OR excluded_code ~ '^[a-z][a-z0-9-]{0,63}$'),
  evaluation jsonb NOT NULL CHECK (jsonb_typeof(evaluation) = 'object'),
  PRIMARY KEY (environment_id, run_id, allocation_id, employee_id),
  FOREIGN KEY (environment_id, run_id, allocation_id) REFERENCES allocation_runs (environment_id, run_id, allocation_id)
);
CREATE TRIGGER allocation_evaluations_immutable BEFORE UPDATE OR DELETE ON allocation_evaluations
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- One row per attempted contender, written in the same transaction as the cursor advance (and any custody).
CREATE TABLE allocation_attempts (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  allocation_id text NOT NULL,
  ordinal integer NOT NULL,
  operation_id text NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('claimed', 'claim-pending', 'refused')),
  code text CHECK (code IS NULL OR code ~ '^[a-z][a-z0-9-]{0,63}$'),
  hold_id text,
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'refused') = (hold_id IS NULL)),
  PRIMARY KEY (environment_id, run_id, allocation_id, ordinal),
  UNIQUE (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, allocation_id, ordinal)
    REFERENCES allocation_contenders (environment_id, run_id, allocation_id, ordinal)
);
CREATE TRIGGER allocation_attempts_immutable BEFORE UPDATE OR DELETE ON allocation_attempts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- The pinned quote behind a Buddy hold: exact car, terms and explanation as offered. Immutable.
CREATE TABLE buddy_quotes (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  quote_id text NOT NULL CHECK (length(quote_id) BETWEEN 1 AND 128),
  allocation_id text NOT NULL,
  order_uuid text NOT NULL,
  employee_id text NOT NULL,
  slot_id text NOT NULL,
  configuration_id text NOT NULL,
  policy_version text NOT NULL,
  quoted_at timestamptz NOT NULL,
  valid_until timestamptz,
  monthly_points integer CHECK (monthly_points IS NULL OR monthly_points >= 0),
  vehicle_name text,
  image_path text,
  quote jsonb NOT NULL CHECK (jsonb_typeof(quote) = 'object'),
  PRIMARY KEY (environment_id, run_id, quote_id),
  FOREIGN KEY (environment_id, run_id, order_uuid) REFERENCES stock_cars (environment_id, run_id, order_uuid),
  FOREIGN KEY (environment_id, run_id, allocation_id) REFERENCES allocation_runs (environment_id, run_id, allocation_id)
);
CREATE TRIGGER buddy_quotes_immutable BEFORE UPDATE OR DELETE ON buddy_quotes
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- The employee-facing offer for one confirmed Buddy hold. Decisions and links are later Stories (FUCQ-465/466).
CREATE TABLE buddy_offers (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  offer_id text NOT NULL CHECK (length(offer_id) BETWEEN 1 AND 128),
  hold_id text NOT NULL,
  quote_id text NOT NULL,
  employee_id text NOT NULL,
  order_uuid text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'release-pending', 'decision-pending', 'accepted', 'declined',
                                       'superseded', 'expired', 'released')),
  brief_version bigint NOT NULL CHECK (brief_version > 0),
  policy_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  operation_id text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, offer_id),
  UNIQUE (environment_id, run_id, hold_id),
  FOREIGN KEY (environment_id, run_id, hold_id) REFERENCES custody_holds (environment_id, run_id, hold_id),
  FOREIGN KEY (environment_id, run_id, quote_id) REFERENCES buddy_quotes (environment_id, run_id, quote_id)
);
CREATE UNIQUE INDEX buddy_offers_one_open_per_car ON buddy_offers (environment_id, run_id, order_uuid)
  WHERE state IN ('active', 'release-pending', 'decision-pending');
CREATE INDEX buddy_offers_employee ON buddy_offers (environment_id, run_id, employee_id);

CREATE FUNCTION buddy_offers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state IN ('accepted', 'declined', 'superseded', 'expired', 'released')
     OR NEW.offer_id <> OLD.offer_id OR NEW.hold_id <> OLD.hold_id OR NEW.quote_id <> OLD.quote_id
     OR NEW.employee_id <> OLD.employee_id OR NEW.order_uuid <> OLD.order_uuid OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'an offer keeps its identity and deadline and is final once closed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER buddy_offers_guard BEFORE UPDATE OR DELETE ON buddy_offers
  FOR EACH ROW EXECUTE FUNCTION buddy_offers_guard();

-- Remote Buddy claim/release detail. State, attempts and last known state live on pending_operations (V1).
CREATE TABLE buddy_operations (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('buddy-claim', 'buddy-release')),
  hold_id text NOT NULL,
  source_claim_operation_id text,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((operation_type = 'buddy-release') = (source_claim_operation_id IS NOT NULL)),
  PRIMARY KEY (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, operation_id) REFERENCES pending_operations (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, hold_id) REFERENCES custody_holds (environment_id, run_id, hold_id)
);
CREATE INDEX buddy_operations_hold ON buddy_operations (environment_id, run_id, hold_id);
CREATE TRIGGER buddy_operations_immutable BEFORE UPDATE OR DELETE ON buddy_operations
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Bounded trigger and expiry reads: due Buddy holds by deadline; unconsumed allocation triggers in commit order.
CREATE INDEX custody_holds_buddy_due ON custody_holds (environment_id, run_id, expires_at, hold_id)
  WHERE hold_type = 'buddy-offer' AND state = 'active';
CREATE INDEX outbox_events_allocation_triggers ON outbox_events (environment_id, run_id, run_revision, event_id)
  WHERE event_type IN ('stock-released', 'brief-changed', 'buddy-expired', 'offer-declined');
