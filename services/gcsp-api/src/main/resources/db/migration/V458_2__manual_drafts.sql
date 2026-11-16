-- Manual draft versions: one immutable row per saved or discarded version (Node kept them as event receipts).
-- The primary key makes two saves of the same next version collide, so the second is answered as stale.
CREATE TABLE manual_drafts (
  environment_id text NOT NULL,
  run_id text NOT NULL,
  employee_id text NOT NULL,
  draft_version bigint NOT NULL CHECK (draft_version > 0),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  discarded boolean NOT NULL DEFAULT false,
  command_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_id, run_id, employee_id, draft_version),
  FOREIGN KEY (environment_id, run_id) REFERENCES runs (environment_id, run_id)
);
CREATE TRIGGER manual_drafts_immutable BEFORE UPDATE OR DELETE ON manual_drafts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
