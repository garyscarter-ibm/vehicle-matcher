-- FUCQ-421: monotonic freshness revisions, advanced in the writing transaction by every foundation-table write.
-- Scope 'runs' covers the runs table (and any TRUNCATE); 'run:<id>' covers that run's rows. One bump per transaction,
-- and only when a statement changed rows.
CREATE TABLE repository_revisions (
  scope text PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision > 0),
  xact xid8 NOT NULL
);

-- Triggers also catch writers outside the adapter (older instances, maintenance, raw SQL), so no write goes unseen.
CREATE FUNCTION bump_repository_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' OR TG_TABLE_NAME = 'runs' THEN
    IF TG_OP <> 'TRUNCATE' THEN
      IF NOT EXISTS (SELECT 1 FROM changed) THEN RETURN NULL; END IF;
    END IF;
    INSERT INTO repository_revisions AS r (scope, revision, xact) VALUES ('runs', 1, pg_current_xact_id())
      ON CONFLICT (scope) DO UPDATE SET revision = r.revision + 1, xact = excluded.xact WHERE r.xact <> excluded.xact;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO repository_revisions AS r (scope, revision, xact)
      SELECT 'run:' || run_id, 1, pg_current_xact_id() FROM (SELECT run_id FROM changed UNION SELECT run_id FROM removed) AS s ORDER BY 1
      ON CONFLICT (scope) DO UPDATE SET revision = r.revision + 1, xact = excluded.xact WHERE r.xact <> excluded.xact;
  ELSE
    INSERT INTO repository_revisions AS r (scope, revision, xact)
      SELECT 'run:' || run_id, 1, pg_current_xact_id() FROM (SELECT DISTINCT run_id FROM changed) AS s ORDER BY 1
      ON CONFLICT (scope) DO UPDATE SET revision = r.revision + 1, xact = excluded.xact WHERE r.xact <> excluded.xact;
  END IF;
  RETURN NULL;
END;
$$;

-- Revisions only rise: a removed row could let a later count repeat a cached value.
CREATE FUNCTION reject_repository_revision_removal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Repository revisions cannot be removed';
END;
$$;
CREATE TRIGGER repository_revisions_kept BEFORE DELETE OR TRUNCATE ON repository_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_repository_revision_removal();
CREATE TRIGGER repository_revisions_rise BEFORE UPDATE ON repository_revisions
  FOR EACH ROW WHEN (NEW.revision <= OLD.revision) EXECUTE FUNCTION reject_repository_revision_removal();

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['runs', 'employees', 'entitlement_slots', 'briefs', 'stock', 'future_order_requests',
    'confirmed_supply', 'holds', 'claims', 'quotes', 'offers', 'decisions', 'pending_operations', 'event_receipts',
    'notification_outbox', 'forecast_snapshots', 'plan_snapshots', 'identity_sessions', 'renewal_cases', 'tick_runs',
    'comparison_results', 'comparison_jobs'] LOOP
    EXECUTE format('CREATE TRIGGER revision_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION bump_repository_revision()', name);
    EXECUTE format('CREATE TRIGGER revision_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS removed NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION bump_repository_revision()', name);
    EXECUTE format('CREATE TRIGGER revision_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION bump_repository_revision()', name);
    EXECUTE format('CREATE TRIGGER revision_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION bump_repository_revision()', name);
  END LOOP;
END;
$$;
