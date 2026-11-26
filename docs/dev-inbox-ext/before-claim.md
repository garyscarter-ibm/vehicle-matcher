before-claim (vehicle-matcher). Adds to code-poller B3; no core gate is removed. Moved here from AGENTS.md (SCAF-72, 26 Nov 2026).

- Before claiming, check the story's files are not owned by another poller's in-progress story, and that the shared
  resource reservation it needs is free. Preserve other pollers' work and checkpoints (AGENTS.md#independent-claude-poller).
- Write down the story's original acceptance criteria, applicable existing contracts and allocated files; they bound the
  build (AGENTS.md#claimed-story-scope). Pass them, and that section's path, in the story-lead brief.
- Judge readiness from actual technical blockers in the current code and contracts, not from Jira `depends_on` alone
  (AGENTS.md#technical-readiness-for-pickup, `docs/gcsp/technical-readiness-2026-11-05.md`). Explicit pauses, date
  holds, claims and file ownership still hold. Pass this rule to the story-lead brief.
