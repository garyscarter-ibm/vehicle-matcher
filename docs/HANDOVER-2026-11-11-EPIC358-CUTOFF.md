# Hand-over: epic FUCQ-358, from the 04:17 GMT cutoff, 11 November 2026

Written at 10:20 GMT on 11 November by the follow-on dispatcher session (epic358-poller). It replaces the 02:50 GMT
checkpoint in `docs/HANDOVER-2026-11-11-EPIC358-DISPATCHER.md`. For the goal, Russell's instructions and the
decisions, read `docs/HANDOVER-2026-11-10-EPIC358-POLLER.md`.

## Where it stands

- The overnight poller stopped at 04:17 GMT, and nothing has run on the epic since. At 09:00 GMT Russell asked for
  Jira to be brought up to date and for this hand-over. He did not ask for a resume.
- Three of the six stories are merged into `gcsp-poc`, closed, and In Review in Jira.
- FUCQ-369 is partly built. Its branch is pushed, but it isn't merged.
- FUCQ-370 and FUCQ-371 are not claimed.

## Why it stopped

- **04:14 GMT.** Cecil Turtle, the FUCQ-369 story-lead, committed a focus-ring inset (4707f8c5). They asked Petunia
  Pig, the implementer running the capture slice, to recapture, then ended their turn "WAITING on Petunia-Pig".
- **04:17:47 GMT.** Petunia Pig failed with an IBM gateway HTTP 422: "You've used all of your Advantage credits for
  Frontier Models. To continue without interruption, please switch to a free model." Their recapture commit 753adee0
  had already landed locally, but it wasn't pushed.
- **04:17:50 and 04:20:15 GMT.** This session's own model calls got the same 422. The turn ended without scheduling
  another pass.
- **How the rule applies.** Under AGENTS.md "IBM gateway 422 responses", a child's 422 alone is not a reason to stop.
  The launcher refusing too is the one condition that allows it. The message is kept only as a diagnostic: it doesn't
  verify the credit balance. Calls worked again by 09:00 GMT.

## Done

| Story | Jira | Merged | Closed | Jira status |
| --- | --- | --- | --- | --- |
| DEV-2026-11-10-GC-036, Account layout | FUCQ-359 | b3341032 | db596e21, cleanup complete 784df762 | In Review |
| DEV-2026-11-10-010, compact preferences | FUCQ-368 | 2b025aa8 | d69d48c5, cleanup complete ec94ece2 | In Review |
| DEV-2026-11-10-009, star rating | FUCQ-367 | eff70d42 | bac7cd68, cleanup complete baeb946b | In Review |

Each has a merge comment in Jira listing its open ACs and the questions for Russell below.

## FUCQ-369 (DEV-2026-11-10-011), Same again and Buddy understanding, 8 points

**State:**
- Claimed b0d0a397, hold lifted 2a72979c. In Jira it is In Progress, assigned to Russell, 8 points, start date
  2026-11-11.
- Branch `dev/DEV-2026-11-10-011` is at 753adee0. Five of its commits (ea8334b2 to 753adee0) were local only at the
  cutoff; they were pushed at about 09:05 GMT today.
- The worktree `.claude/worktrees/DEV-2026-11-10-011` matches the branch. Its only untracked file is the
  `server/node_modules` symlink.

**Commits on the branch:**
- 6063df85: the contract. Same again is persisted intent in `brief.accountPreferences.v1`. Buddy understanding is one
  canonical PolicyService entry: 0 to 6 categories map to 1, 3, 4, 6, 7, 9, 10, and Same again is 11.
- cf9b7053: client shape checks and transport.
- 30d658fa: the new kit `understandingMeter`, and the Same again row in `categoryPreferences`, using the shared
  `helpTip`.
- 106c5ba5: the Same again autosave lane, understanding readback, and the Account mount.
- 9335cbd5: product map slice states.
- ea8334b2: the strict paired capture.
- 8faebc18: Cecil Turtle's own review fixes, not an independent critique's. The understanding block goes full width
  at narrow sizes, and toggling Same again confirms with the saved message.
- f380d7f7: recapture, with all 470 checks passing.
- 4707f8c5: the focus-ring inset attempt.
- 753adee0: recapture. 470 of 472 checks pass.

**Evidence:**
- Paired, side-by-side and zoom images are in `docs/gcsp/evidence/fucq369/`, about 16.6 MiB.
- `results.json` holds the 472 checks. The 0 to 6 category counts read 1, 3, 4, 6, 7, 9, 10 out of 11, with matching
  accessible names.
- The two failures are the focus ring at 320px, in the `320-same-tooltip-long` and `320-same-keyboard` states.

**Tests:** the last scoped run, at 03:52 GMT before the capture, ran 671 tests: 662 pass, 1 fails and 8 are skipped.
The failure is `gcsp-brief` "retained brief, conflict and validation fixtures", which also fails on base. The log is
kept at `.claude/dev-poller-20261110-claude/DEV-2026-11-10-011/lead-scoped-0352.txt`.

**Not yet done:** no independent Opus critique has run, and the story file has no Result block.

### Left to finish FUCQ-369, in order

1. **Fix the focus ring.** At 320px it still overlaps the "!" of "Same again, please!".
   - Cause: in `blocks/gcsp/kit/category-preferences.css`, line 14,
     `.gcsp .gcsp-prefs :is(button, input:not(.vm-slider-input)):focus-visible` sets `outline-offset: 3px` at
     specificity (0,4,1).
   - The attempted fix in `blocks/gcsp/kit/same-again.css`, line 5, is
     `.gcsp .gcsp-prefs .gcsp-prefs-info:focus-visible` at (0,4,0). It loses whatever value it sets, and the capture
     reports a computed offset of 3px.
   - Fix: a selector one class stronger, such as `.gcsp .gcsp-prefs .gcsp-prefs-info.vm-btn:focus-visible` (the
     line-4 rule already uses it), should apply the intended -8px inset. Then recapture both 320 states.
2. **Run the independent rendered critique.** Use a `general-purpose` agent with `model: "opus"`. Give it only the
   paired images, the reference docs and the story's visual ACs, including the SHARED VISUAL INTEGRATION AC.
   - It covers desktop, intermediate and narrow widths.
   - It covers these states: Same again on, neutralised and restored; help open; the long description; 0 to 6
     categories; and no current car.
   - It covers the full Account order.
   - Then fix the findings, recapture, and inspect the result.
3. **Merge `gcsp-poc` into the branch.**
   - Since the claim, Gary's work has touched:
     - `COMPONENTS.md` (90170e7c, 606d12c2, 4fe084a2);
     - `blocks/gcsp/account/gcsp-account.js` (606d12c2, FUCQ-354);
     - `blocks/vehicle-matcher/component-gallery.js` and `server/gcsp/policy/seed-v1.json` (82a6c77c, FUCQ-315).
   - A trial `git merge-tree` at 10:10 GMT was clean.
   - Rerun the scoped tests on the merged tree.
   - Gary's c9bd67f5 repaired `gcsp-live-regions` and `gcsp-activity-live`, and stubbed vehicle evidence in
     `dom-harness.js`. So those two are no longer known base failures, and the `render.test.js` em-dash timeout should
     be gone. The `gcsp-brief` retained-fixtures failure still is a known base failure.
4. **Write the Result block** (step B11).
5. **Dispatcher steps D and C:** merge, then close. Then set Jira to In Review with transition id 3, and mark that
   key's sync operations done.

**How to resume.**
- The story-lead brief is `.claude/dev-poller-20261110-claude/DEV-2026-11-10-011/lead-brief.md`. Its ports are 8807
  and 3027; neither is listening now.
- Cecil Turtle is a subagent of this session. Only this session can resume them (`SendMessage` to `Cecil-Turtle`), and
  this session's context is past 370k.
- A new session should start a fresh story-lead from that brief, adding a "resume from 753adee0" section with the five
  steps above.

## Left after FUCQ-369

1. **FUCQ-370** (DEV-2026-11-10-012, Engage Buddy explicitly), then **FUCQ-371** (013, feedback-aware
   recommendations). Both are To Do in Jira, unassigned and unestimated, and still carry `discussion-only`; the claim
   step removes it.
2. **The shared six-story integration critique,** run with the last Account story. It is the one AC that every story
   leaves open.
3. **Stop:** write the final hand-over, and mark `.claude/dev-poller-directive.md` STOPPED. FUCQ-250 stays deferred
   (Russell), so there are no defects to take.

**Claim recipe,** used for FUCQ-367 and FUCQ-369:
- Git side:
  1. `scaffold_git.py claim --id ID --points N`.
  2. Add "Hold lifted" and "Design agreed" bullets at the top of `decided`, then commit and push.
- Jira side:
  1. Transition id 21.
  2. `editJiraIssue` with:
     - assignee Russell, `557058:16dd887a-6b2b-4677-b36a-145a2ea69c92`;
     - points in `customfield_10016`;
     - the start date in `customfield_10015`;
     - labels `account-preferences`, `backlog`, `agent:claude-code` and `host:russells-macbook-air`, which drops
       `discussion-only`.
  3. A claim comment.
  4. `jira_sync.py push --mark-done` for that key's operations.
- The story-lead brief: copy and adapt the FUCQ-369 one.

## Jira, checked at 10:12 GMT

| Key | Status | Assignee | Points |
| --- | --- | --- | --- |
| FUCQ-358 (epic) | In Progress | none | none |
| FUCQ-359 | In Review | Russell | 8 |
| FUCQ-367 | In Review | Russell | 8 |
| FUCQ-368 | In Review | Russell | 13 |
| FUCQ-369 | In Progress | Russell | 8 |
| FUCQ-370 | To Do | none | none |
| FUCQ-371 | To Do | none | none |

- `jira_sync.py push --json` has no pending operations for any of these keys.
- **Five of Russell's earlier stories were checked too:** FUCQ-322, 323, 346, 347 and 348 (DEV-2026-11-10-001, 002 and
  005 to 007, closed on 10 November).
  - Jira already matched git for all five: In Review, Russell assigned, points 8, 3, 3, 1 and 1, and start date
    2026-11-10.
  - The branch comments on FUCQ-322, 323 and 348 were added by Gary's poller at 10:06 GMT.
  - Only this machine's sync state still listed their 23 operations. They were marked done at 10:25 GMT, and Jira was
    not written again.
- **What's left in the queue:** 1,118 pending operations, all on Gary's claims. His own poller pushes those. This
  machine's state file just doesn't know they were sent.
- FUCQ-369's status comment, 3628763, was corrected at 10:20 GMT with the launcher refusal and the focus-ring cause.
  The epic has a status comment.
- Gary's importer added `jira_changed: 2026-11-11: decided` to the in-progress story at 09:50 GMT (fdfe9340). That is
  harmless:
  - Jira's changelog shows no description edit since the 02:44 GMT claim.
  - The difference is the two bullets the claim added to the local story file, which Jira's description doesn't
    carry.

## Gary's work since the cutoff

- **Merged into `gcsp-poc`, 08:06 to 09:35 GMT:**
  - the stale-test repair, c9bd67f5;
  - the presenter console skeleton and copy, and the clock start;
  - FUCQ-343, FUCQ-315 (car names), FUCQ-354 (UK local time) and FUCQ-351 (reset to Greg).
- **Imported at 09:50 GMT:**
  - FUCQ-376, a P3 bug: the local corpus load blocks the event loop.
  - FUCQ-377, a P4 bug.
  - FUCQ-378, a P4 bug. It is the CSP timer-scan failure on `release-grid.js` that this run noted and didn't file.
    Gary claimed it at 10:00 GMT as DEV-2026-11-11-GC-003.
- None of them is High, so the poller still takes no defects after the epic.
- Don't touch Gary's claims: GC-037 to GC-045, now plus DEV-2026-11-11-GC-003.

## For Russell

- **Resume?** Should FUCQ-369 be resumed now, in a fresh session from this file?
- **FUCQ-359** (also on its ticket):
  - (a) Should the "Account as of …" line stay at the page foot?
  - (b) Proposed Low Bug: the employee rail shows four icons where the reference has two.
  - (c) The reference shows "Registration: Not supplied", but FUCQ-316's rule hides an unknown registration.
  - (d) The card reads "320i" twice. That comes from the data.
- **FUCQ-367** (also on its ticket):
  - (a) A pending rating has no visible cue, only `aria-busy`. Is that enough?
  - (b) Proposed Low Bug: the fixture repeats "320i" and "Touring" in the model and specification, so the rating help
    reads awkwardly.
- **Cleanups:** the archived cleanups DEV-2026-11-04-035 and -036 are still `cleanup: pending`. The helper refuses
  their dirty worktrees.
- **Install:** the agent-scaffolding 0.7.3 install (it needs sudo) and the marketplace pin are still not done.

## Leftovers and resources

- **Removed:** FUCQ-369's scratch is emptied: 205,025 bytes of test logs, with one 77,419-byte log kept as
  `lead-scoped-0352.txt`. The dispatcher's scratch was already empty. Both folders were checked at 0 bytes.
- **Kept:**
  - the FUCQ-369 worktree and its `server/node_modules` symlink. Remove the symlink by absolute path before
    `drop-branch`, or the helper refuses the worktree as dirty.
  - the `.claude/dev-poller-20261110-claude/` receipts.
- **Nothing still running:** this session owns no servers and no running agents. The Playwright MCP processes on the
  Mac started at about 08:16 GMT under other sessions, and were left alone.

## A successor reads first

1. This file.
2. `docs/HANDOVER-2026-11-10-EPIC358-POLLER.md`.
3. The top section of `.claude/dev-poller-directive.md`.
4. `.claude/dev-poller-20261110-claude/DEV-2026-11-10-011/lead-brief.md`.
5. The story file on the branch: `git show origin/dev/DEV-2026-11-10-011:_dev/in-progress/DEV-2026-11-10-011.md`.
6. `docs/gcsp/evidence/fucq369/results.json` on the branch.
7. The shared notes log, `epic358-dispatcher-log.md`, in this group's side-session notes folder.
