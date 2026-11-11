# Hand-over: epic FUCQ-358 follow-on dispatcher, 11 November 2026 01:50 GMT

This is a checkpoint, not a stop. The follow-on dispatcher session (started 23:05 GMT from the old poller session
`69298e71`) is still running and pacing with ScheduleWakeup. Read `docs/HANDOVER-2026-11-10-EPIC358-POLLER.md` first.
It records the goal, Russell's instructions and the decisions. This file says where the epic stands now.

## Done

| Story | Jira | Merged | Closed | Jira status |
| --- | --- | --- | --- | --- |
| DEV-2026-11-10-GC-036, Account layout | FUCQ-359 | b3341032 | db596e21, cleanup complete 784df762 | In Review |
| DEV-2026-11-10-010, compact preferences | FUCQ-368 | 2b025aa8 | d69d48c5, cleanup complete ec94ece2 | In Review |

- GC-036's merge conflicted with Gary's FUCQ-375 notification bell in the `mountAccount` option list. Both
  `preferences` and `notifications` are kept. The scoped rerun on the merged tree passed 294/294.
- FUCQ-368's full `npm test` at 8377a0e7 ran 4801 tests: 4753 pass, 9 fail and 39 skipped. The same 9 fail on base
  784df762. The summary is in `docs/gcsp/evidence/fucq368/test-summary.txt`.
- Epic FUCQ-358 is In Progress in Jira, with start date 2026-11-10.

## In flight

- **DEV-2026-11-10-009 / FUCQ-367 star rating (8 points).** Story-lead Daffy Duck is a subagent of the follow-on
  session, so their report goes to that session only.
  - Phase 1 is done: kit `star-rating` and `help-tip` primitives (d3336a6e), Result 6cef4acf, branch pushed.
  - Daffy Duck was resumed at 01:47 GMT for phase 2: merge gcsp-poc, build the rating contract on FUCQ-368's
    `brief.accountPreferences.v1` autosave approach, mount the stars on the Your cars bitmap, then the strict
    comparison and the Opus critique.
  - Brief and contract plan are in `.claude/dev-poller-20261110-claude/DEV-2026-11-10-009/`.
  - Note: the interim 320 tooltip capture showed 0 stars where the reference shows 4. The phase-2 capture must
    reproduce each manifest state.

## Left, in order (serial: shared Account and brief files)

1. Merge (step D) and close (step C) FUCQ-367 when Daffy Duck reports `built`. Then set it to In Review in Jira with
   transition id 3, and mark its sync ops done.
2. Claim FUCQ-369 (DEV-2026-11-10-011, Same again and Buddy understanding). It reuses the kit `help-tip` from
   FUCQ-367 and FUCQ-368's switch.
   - It must restore the two rules around the Same again row. It closes the 68px tile offset noted on FUCQ-368, and
     Taz's critique finding 5.
   - Consider Taz's minor point here: the pending text "Saving your preferences." is easy to miss.
3. FUCQ-370 (012, Engage Buddy explicitly), then FUCQ-371 (013, feedback-aware recommendations).
4. Run the shared six-story integration critique with the last Account story. It is the one AC every story leaves
   open.
5. Stop: write the final hand-over, and mark `.claude/dev-poller-directive.md` STOPPED. FUCQ-250 stays deferred
   (Russell), so there are no defects to take.

Claim recipe per story (as used for FUCQ-367):
- Git side:
  1. `scaffold_git.py claim --id ID --points N`.
  2. Add "Hold lifted" and "Design agreed" bullets at the top of `decided`, then commit and push.
- Jira side:
  1. Transition id 21.
  2. `editJiraIssue` with assignee Russell `557058:16dd887a-6b2b-4677-b36a-145a2ea69c92`, `customfield_10016`
     points, `customfield_10015` 2026-11-10, and labels `account-preferences`, `backlog`, `agent:claude-code`,
     `host:russells-macbook-air` (dropping `discussion-only`).
  3. A claim comment.
  4. `jira_sync.py push --mark-done` for that key's ops.
- The story-lead brief: copy and adapt `.claude/dev-poller-20261110-claude/DEV-2026-11-10-009/lead-brief.md`.

## For Russell

- FUCQ-359 (also on its Jira ticket):
  - (a) Should the "Account as of …" line stay at the page foot? The reference doesn't have it.
  - (b) Proposed Low Bug: the employee rail shows four icons where the reference shows two. Base shows the same.
  - (c) The reference shows "Registration: Not supplied", but the build hides an unknown registration under
    FUCQ-316's rule.
  - (d) The card reads "320i" twice ("BMW 3 Series Touring 320i" over "320i M Sport Touring · Petrol") where the
    reference reads "BMW 3 Series Touring". This is data-driven, critique finding F3.
- Low defect seen in Gary's area, not filed: the CSP check in `server/test/gcsp-greg-dashboard.test.js` treats every
  `setTimeout` as a string timer. It fails on `blocks/gcsp/kit/release-grid.js` (FUCQ-365), whose timers take
  functions. It fails on base.
- Archived cleanups DEV-2026-11-04-035 and -036 are still `cleanup: pending`. The helper refuses their dirty
  worktrees, and they are left alone.
- Not done, from the earlier hand-over: the agent-scaffolding 0.7.3 install (needs sudo) and the marketplace pin.
