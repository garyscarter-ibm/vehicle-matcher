-- FUCQ-546: the draft constraint changes a plan was submitted under (Node submission output.changes); old rows read [].
ALTER TABLE production_submissions
  ADD COLUMN constraint_changes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(constraint_changes) = 'array');
