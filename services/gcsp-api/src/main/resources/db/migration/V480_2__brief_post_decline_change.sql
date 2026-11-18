-- FUCQ-443: the single post-decline change. A confirmed brief version may now be recorded as 'changed-after-decline'
-- and carries the audit of that one change (decision, path, before, after) in its own column, not in the brief content.

ALTER TABLE briefs DROP CONSTRAINT IF EXISTS briefs_operation_check;
ALTER TABLE briefs ADD CONSTRAINT briefs_operation_check CHECK (operation IN
  ('confirmed', 'engaged', 'disengaged', 'paused', 'resumed', 'preferences-updated', 'changed-after-decline'));

ALTER TABLE briefs ADD COLUMN post_decline_change jsonb
  CHECK (post_decline_change IS NULL OR jsonb_typeof(post_decline_change) = 'object');
