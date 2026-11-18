-- FUCQ-463: manual review details. Each saved version is one immutable row (Node kept them as event receipts); the
-- primary key makes two saves of the same next version collide, so the second is answered as stale. A freeze is one
-- immutable row per hold. No FK to custody_holds: these are append-only evidence keyed by hold id.
CREATE TABLE manual_review_details (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  employee_id text NOT NULL,
  slot_id text NOT NULL,
  hold_id text NOT NULL,
  review_details_version bigint NOT NULL CHECK (review_details_version > 0),
  binding jsonb NOT NULL CHECK (jsonb_typeof(binding) = 'object'),
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  constraints jsonb NOT NULL CHECK (jsonb_typeof(constraints) = 'object'),
  saved_at timestamptz NOT NULL,
  clock_version bigint NOT NULL CHECK (clock_version > 0),
  command_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, employee_id, slot_id, hold_id, review_details_version),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE TRIGGER manual_review_details_immutable BEFORE UPDATE OR DELETE ON manual_review_details
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE manual_review_freezes (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  employee_id text NOT NULL,
  slot_id text NOT NULL,
  hold_id text NOT NULL,
  review_details_version bigint NOT NULL CHECK (review_details_version > 0),
  binding jsonb NOT NULL CHECK (jsonb_typeof(binding) = 'object'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  frozen_at timestamptz NOT NULL,
  clock_version bigint NOT NULL CHECK (clock_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, employee_id, slot_id, hold_id),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE TRIGGER manual_review_freezes_immutable BEFORE UPDATE OR DELETE ON manual_review_freezes
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
