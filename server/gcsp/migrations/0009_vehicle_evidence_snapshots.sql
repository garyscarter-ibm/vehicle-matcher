-- FUCQ-393: shared immutable evidence lives outside whole-run foundation snapshots.
CREATE TABLE vehicle_evidence_snapshots (
  digest text PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION reject_vehicle_evidence_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Vehicle evidence snapshots are immutable';
END;
$$;
CREATE TRIGGER vehicle_evidence_immutable BEFORE UPDATE ON vehicle_evidence_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_vehicle_evidence_update();

-- These references are changed in the same transaction as their owning row.
-- Referenced snapshots cannot be removed while a stock row, quote or receipt needs them.
CREATE TABLE vehicle_evidence_references (
  table_name text NOT NULL,
  row_key text NOT NULL,
  digest text NOT NULL REFERENCES vehicle_evidence_snapshots(digest) ON DELETE RESTRICT,
  PRIMARY KEY (table_name, row_key, digest)
);
CREATE INDEX vehicle_evidence_reference_digest ON vehicle_evidence_references(digest);
