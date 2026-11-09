-- FUCQ-78: policy assumptions may carry the observed aggregate status (stock locator sample).
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'policy_assumptions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE policy_assumptions DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$$;

ALTER TABLE policy_assumptions
  ADD CONSTRAINT policy_assumptions_status_check
  CHECK (data->>'status' IN ('assumed', 'verified', 'observed aggregate'));
