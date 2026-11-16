-- FUCQ-467: detail of a remote offer decision (selection or decline release). State, attempts and last known state
-- live on pending_operations (V1); the row is written with the intent and never changes.

CREATE TABLE offer_decision_operations (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  operation_id text NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('offer-selection', 'offer-decline-release')),
  offer_id text NOT NULL,
  hold_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, operation_id) REFERENCES pending_operations (environment_id, run_id, operation_id),
  FOREIGN KEY (environment_id, run_id, offer_id) REFERENCES buddy_offers (environment_id, run_id, offer_id)
);
CREATE INDEX offer_decision_operations_offer ON offer_decision_operations (environment_id, run_id, offer_id);
CREATE TRIGGER offer_decision_operations_immutable BEFORE UPDATE OR DELETE ON offer_decision_operations
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
