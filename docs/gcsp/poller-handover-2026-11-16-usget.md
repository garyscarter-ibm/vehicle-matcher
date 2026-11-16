# Dev poller hand-over, 16 November 2026 (Russell's machine, usget)

Scope given by Russell: the remainder of FUCQ-431 and FUCQ-433, then stop. Stopped early at his request for a
Claude Desktop restart, after the first wave.

## Done
- FUCQ-435 (DEV-2026-11-13-003): merged d40ae5946, closed, Jira In Review. AC1 still needs the proof
  (`scripts/gcsp/fucq435-cross-origin-proof.mjs`) re-run against the hosted dev origins once they exist.
- FUCQ-467 (DEV-2026-11-13-035): merged a59124025, closed, Jira In Review. Signed-in hosted Angular/mail journey
  not yet proven; no Angular screen shows the new 202 pending state.

## Paused (claimed by usget, Jira In Progress)
- FUCQ-507 (DEV-2026-11-16-026): slice 1 of 3 done on `dev/DEV-2026-11-16-026` (tip 3b5c2a485). The story file's
  "Checkpoint, paused 2026-11-16" section has what's left. Resume it first, with a fresh story-lead on the same
  branch. Merge `gcsp-poc-dev` into the branch before the final run. Open question: current Node no longer
  reproduces the retained `process-only.json` buddy measures exactly, so buddy equivalence needs a numeric bound or
  a fresh Node reference.

## Not started (still in the inbox, unclaimed)
Suggested order: FUCQ-437 (DEV-2026-11-13-005, builds on 435), FUCQ-481 (DEV-2026-11-13-049, needs 467 and 507),
then FUCQ-438 (DEV-2026-11-13-006) and FUCQ-482 (DEV-2026-11-13-050), the hand-over and cutover stories.
FUCQ-436 is Gary's (in progress, blocked on hosted environment).

## Notes for the next poller
- Shared story-lead brief: `.claude/poller/brief-2026-11-16.md` (git-ignored, local only).
- Java HTTP test profiles hard-code database `gcsp_test_dev`; `pg_ctl` needs `LC_ALL` set on this Mac.
- `PresenterClockHttpTest.readinessReportsTheClockCheckAndItsHandlers` already fails on the base (FUCQ-509).
- Two `state-page.component.spec.ts` Angular specs already fail on the base (copy drift).
- The Jira pull on 16 Nov imported 28 bugs into `_dev/code-inbox/`; not in this run's scope.
