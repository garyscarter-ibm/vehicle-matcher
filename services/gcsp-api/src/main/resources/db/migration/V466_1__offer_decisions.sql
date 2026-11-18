-- FUCQ-466: one immutable employee decision (accept or decline) per Buddy offer, with the versions it was made against.
-- The primary key is the hard one-decision-per-offer guarantee; the outcome is the stored first answer.

CREATE TABLE offer_decisions (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  offer_id text NOT NULL,
  decision_id text NOT NULL,
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 200),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  employee_id text NOT NULL,
  hold_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accept', 'decline')),
  reason_code text,
  reason jsonb CHECK (reason IS NULL OR jsonb_typeof(reason) = 'object'),
  versions jsonb NOT NULL CHECK (jsonb_typeof(versions) = 'object'),
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
  decided_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((decision = 'decline') = (reason_code IS NOT NULL)),
  PRIMARY KEY (environment_id, run_id, offer_id),
  UNIQUE (environment_id, run_id, decision_id),
  FOREIGN KEY (environment_id, run_id, offer_id) REFERENCES buddy_offers (environment_id, run_id, offer_id),
  FOREIGN KEY (environment_id, run_id, hold_id) REFERENCES custody_holds (environment_id, run_id, hold_id)
);
CREATE INDEX offer_decisions_employee ON offer_decisions (environment_id, run_id, employee_id);
CREATE TRIGGER offer_decisions_immutable BEFORE UPDATE OR DELETE ON offer_decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
