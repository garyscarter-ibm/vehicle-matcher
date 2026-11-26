# Poller hand-over: ishbel, 26 November 2026, 23:05 UTC (updated)

Gary's Claude dev poller, registered as `garyscarter-ibm-ishbel` (lease until 2026-11-27T08:46Z). Retiring at about
310k tokens of context. Russell's `usget-baymax` (Codex) had a live poller lease to 21:06Z and held no batch or
story work this evening.

## Goal
Run the dev poller per the `scaffolding:dev-inbox` skill: the generic `references/code-poller.md`, step E from
`/Users/garycarter/Claude/agent-scaffolding/plugin/skills/dev-inbox/references/code-poller.md`, and the extension
steps in `docs/dev-inbox-ext/`. Read `AGENTS.md` first (OneDrive ban, Story test set, Shared local test stack). The
shared checkout stays on `gcsp-poc-dev`.

## Owned and waiting: the successor takes it over
- **DEV-2026-11-19-GC-ishbel-001 = FUCQ-599** (C; skeleton loading on every Angular GCSP screen). Claimed at 8 points
  (triage: horse, by The Brain, cdf4a97b3). Jira: In Progress, assignee Gary, 8 points, start 2026-11-26, labels and
  branch comment, all read back. Story-lead Heihei reported **`waiting`** at 23:00Z: code `ce29de193`, Result
  `f62a86be0`, in `.claude/worktrees/DEV-2026-11-19-GC-ishbel-001`. Specs: 74 files, 1423 passed on pinned Node 24.22.3;
  `check:boundaries` passes; drift 0 new. Layouts: shell, state page, stock and manual route use `page`; Your cars
  `feature`; activity and orders `timeline`; preferences `form`; case queue, Greg demand/policy, order plan,
  comparison, outbox and presenter `console`; production status `section`. `LoadingSkeletonComponent` is reused
  unchanged.
- **The branch is not pushed** (only in this clone's worktree). The subagent's permission classifier refused the
  explicit branch push, and `scaffold_git.py push` pushes only the base branch. The worktree's claim is ours
  (`cleanup_client: 516ca3553159`), so do not drop it.
- **Left to make it built:** run the 11 browser cases (f549, f551, f552, f553, f554, f556, f557, f558, f559, f560,
  f561; f551 also has the reduced-motion check) on the merging commit, after 00:00 GMT (3.5 GiB, kit night window),
  under `heavy`. Not alongside the web-e2e batch: heavy serialises them. First `refresh --id` onto the current base,
  rerun the spec set, then run the cases. Most cases need `GCSP_NODE_REFERENCE`, a clean checkout of `e44ed08a`, which
  this Mac lacks (make one as a git worktree at that commit). Set `GCSP_E2E_PG_MODULE` to
  `server/node_modules/pg/lib/index.js` and TMPDIR under `/tmp` (the temp-path tests fail under the default macOS
  TMPDIR). `node link` is still in place in the worktree; `node unlink` before the worktree is removed. The subagent's
  classifier also refused starting `run.py`, so Gary may need to approve it (learning DL-20261126-ISHBEL-02).
- Scope rulings: screens with no Node skeleton still get one (no new layout). Sub-panel loading text is out of scope
  and listed under "not done" for a collaborator to raise.

## For the successor
- **web-e2e is due and unleased.** Last line at 68eacb337. Uncovered matching merges: 73b493c42 (FUCQ-546),
  2ed7b5a64, bce44883b, 1c653c0c4. Run it **after 00:00 GMT only**, under `heavy` (3.5 GiB), never alongside another
  full suite: `batch claim --suite web-e2e --base <sha> --ttl 3600`, through a batch-tester. This Mac has JDK 21
  (`/opt/homebrew/opt/openjdk@21`), PostgreSQL 17 (`/opt/homebrew/opt/postgresql@17`) and Google Chrome (set
  `GCSP_E2E_BROWSER_PATH` if Playwright's Chromium is absent). Host Node is v26.5.0, and the suite's `needs` says Node
  24.22.3 (pinned-runner recipe in `docs/gcsp/dispatcher-learnings.md`, grep "Node 24"). Link both `node_modules`
  and `server/node_modules` in the batch worktree. **Test stack changed at 22:17Z** (MSG-2026-11-26-002, acked):
  `_tools/test_stack.py` is now the kit's 1.2.1 (8329d6099); the `--except` rule is lifted, `test_stack_build.py` is
  gone (`test_stack.py node link|build`), state is under `~/Library/Caches/agent-scaffolding/test-stack`, and heavy
  above 3 GiB exits 75 outside 00:00 to 07:30. This Mac's kit is 0.17.0; Russell asks for 0.17.1 (`tools/update`, then
  the pending script's sudo apply line as ADMIN-D0Q). Once `test_stack.py gcsp-legacy status` lists no databases,
  `gcsp-legacy down` stops the old cluster.
- node and web each had 1 uncovered matching merge at 21:00Z (not due on count; due on the first pass after midnight
  if still uncovered and not run today: node ran 12:45Z, web 05:39Z on 26 Nov).
- **Queue:** nothing else claimable. Most GC Stories from Jira fail check-story (missing sections); ui Bugs
  051/040/050 lack a `ui:` line; FUCQ-522/524 and FUCQ-334 to 339 are `design_impact: yes` with no agreed design;
  vesper-011/012/013/015 need external access or collaborator agreement (their prereqs say so); 23 held Bugs need
  their origin Story worked out (`related_story: unresolved`).
- **Jira pull:** the full delta pull (178 issues since 2026-11-19 04:40) is still skipped for the attachment-field gap.
  FUCQ-599 came in by a single-issue `pull --issues <one-issue file> --now 2026-11-19T04:40`, which keeps the
  watermark where it was so the skipped delta isn't jumped over. Use the same for any other single urgent import.
- **Jira push queue:** this clone's local `pushed` map was stale (learning DL-20261126-ISHBEL-01). 522 ops were
  verified true in Jira and marked done. 26 ops on 13 issues differ from Jira and are left unapplied for their owners
  (FUCQ-376/387/392/396/504/505 closed in git but To Do in Jira; 440/442/444/408/594 In Progress; 483 superseded;
  433 Epic). 110 `link` ops are unchecked. Don't send them blind: `push --json` now lists 137, none of them new work.

## Gotchas
- Close records need `cleanup_client: 516ca3553159` (this clone).
- `dev_mail.py inbox` prints `NOTE poller lease not renewed: TAKEN ... by Garys-MacBook-Pro.local (claude)` for this
  poller's own name: the renewal treats a fresh process as another clone. `poller status` shows the lease live.
- The Atlassian cloudId is `9024e134-9d2e-4f15-af8d-4df1fd4c2cb1` (ibm-consulting.atlassian.net).
- `dev_mail.py ack` on a `note` closes it; reply in a new thread if needed.
