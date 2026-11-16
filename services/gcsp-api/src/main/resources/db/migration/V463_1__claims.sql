-- FUCQ-463: manual (cart) claims. Exclusivity stays in custody_holds (V1): its partial unique indexes give one
-- occupying holder per exact car and per slot unit, shared with Buddy holds. Every claim change bumps the hold version.

CREATE TABLE manual_claims (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  hold_id text NOT NULL,
  employee_id text NOT NULL,
  slot_id text NOT NULL,
  order_uuid text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('local', 'remote')),
  phase text NOT NULL CHECK (phase IN ('preview', 'order-review')),
  review_started_at timestamptz,
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 128),
  draft_version bigint NOT NULL CHECK (draft_version > 0),
  context_version text NOT NULL CHECK (length(context_version) BETWEEN 1 AND 128),
  terms_digest text NOT NULL CHECK (terms_digest ~ '^[0-9a-f]{64}$'),
  quote jsonb NOT NULL CHECK (jsonb_typeof(quote) = 'object'),
  quoted_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  release_reason text CHECK (release_reason IN ('cancel', 'change', 'back', 'expiry')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((phase = 'order-review') = (review_started_at IS NOT NULL)),
  PRIMARY KEY (environment_id, run_id, hold_id),
  FOREIGN KEY (environment_id, run_id, hold_id) REFERENCES custody_holds (environment_id, run_id, hold_id)
);
CREATE INDEX manual_claims_owner ON manual_claims (environment_id, run_id, employee_id, slot_id, created_at DESC);

-- The pinned quote and identity never change; review starts once and never returns to preview.
CREATE FUNCTION manual_claims_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.employee_id <> OLD.employee_id OR NEW.slot_id <> OLD.slot_id
     OR NEW.order_uuid <> OLD.order_uuid OR NEW.mode <> OLD.mode OR NEW.quote <> OLD.quote
     OR NEW.terms_digest <> OLD.terms_digest OR NEW.quoted_at <> OLD.quoted_at
     OR (OLD.phase = 'order-review' AND NEW.phase <> 'order-review')
     OR (OLD.review_started_at IS NOT NULL AND NEW.review_started_at IS DISTINCT FROM OLD.review_started_at)
     OR (OLD.release_reason IS NOT NULL AND NEW.release_reason IS DISTINCT FROM OLD.release_reason) THEN
    RAISE EXCEPTION 'a manual claim keeps its identity, quote and review start'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER manual_claims_guard BEFORE UPDATE OR DELETE ON manual_claims
  FOR EACH ROW EXECUTE FUNCTION manual_claims_guard();

-- Remote claim/release/allocate detail. State, attempts and outcome live on pending_operations (V1).
CREATE TABLE manual_claim_operations (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('manual-claim', 'manual-release', 'manual-allocate')),
  hold_id text NOT NULL,
  target_state text NOT NULL CHECK (target_state IN ('active', 'released', 'expired', 'allocated')),
  reason text CHECK (reason IN ('cancel', 'change', 'back', 'expiry')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, operation_id) REFERENCES pending_operations (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, hold_id) REFERENCES custody_holds (environment_id, run_id, hold_id)
);
CREATE INDEX manual_claim_operations_hold ON manual_claim_operations (environment_id, run_id, hold_id);
CREATE TRIGGER manual_claim_operations_immutable BEFORE UPDATE OR DELETE ON manual_claim_operations
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Bounded expiry sweep: due active cart holds by deadline.
CREATE INDEX custody_holds_cart_due ON custody_holds (environment_id, run_id, expires_at, hold_id)
  WHERE hold_type = 'cart' AND state = 'active';
