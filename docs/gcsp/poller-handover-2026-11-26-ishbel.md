# Poller hand-over: ishbel, 26 November 2026, 22:00 UTC

Gary's Claude dev poller, registered as `garyscarter-ibm-ishbel` (lease until 2026-11-27T08:46Z). Retiring at about
310k tokens of context. Russell's `usget-baymax` (Codex) had a live poller lease to 21:06Z and held no batch or
story work this evening.

## Goal
Run the dev poller per the `scaffolding:dev-inbox` skill: the generic `references/code-poller.md`, step E from
`/Users/garycarter/Claude/agent-scaffolding/plugin/skills/dev-inbox/references/code-poller.md`, and the extension
steps in `docs/dev-inbox-ext/`. Read `AGENTS.md` first (OneDrive ban, Story test set, Shared local test stack). The
shared checkout stays on `gcsp-poc-dev`.

## In flight: do not touch until ishbel reports it retired
- **DEV-2026-11-19-GC-ishbel-001 = FUCQ-599** (C; skeleton loading on every Angular GCSP screen). Claimed at 8 points
  (triage: horse, by The Brain, cdf4a97b3). Jira: In Progress, assignee Gary, 8 points, start 2026-11-26, labels and
  branch comment, all read back. Story-lead **Heihei** (ishbel's own subagent) is building it on
  `dev/DEV-2026-11-19-GC-ishbel-001` in `.claude/worktrees/DEV-2026-11-19-GC-ishbel-001`. At 21:36Z it had 3 commits.
  Ishbel merges, closes and does Jira for it, then retires. If ishbel's session is gone and the story has no
  `## Result`, resume it with a fresh story-lead on the same branch.
- Scope rulings given to Heihei: screens with no Node skeleton still get one, reusing page, console or section (no new
  layout). Sub-panel loading text is out of scope and is listed under "not done" for a collaborator to raise.
- Its browser cases run under `heavy` on the final commit, so they share the slot with the web-e2e batch below.

## For the successor
- **web-e2e is due and unleased.** Last line at 68eacb337. Uncovered matching merges: 73b493c42 (FUCQ-546),
  2ed7b5a64, bce44883b, 1c653c0c4. Run it **after 00:00 GMT only**, under `heavy` (3.5 GiB), never alongside another
  full suite: `batch claim --suite web-e2e --base <sha> --ttl 3600`, through a batch-tester. This Mac has JDK 21
  (`/opt/homebrew/opt/openjdk@21`), PostgreSQL 17 (`/opt/homebrew/opt/postgresql@17`) and Google Chrome (set
  `GCSP_E2E_BROWSER_PATH` if Playwright's Chromium is absent). Host Node is v26.5.0, and the suite's `needs` says Node
  24.22.3 (pinned-runner recipe in `docs/gcsp/dispatcher-learnings.md`, grep "Node 24"). Link both `node_modules`
  and `server/node_modules` in the batch worktree. Keep `_tools/test_stack.py` as is: run
  `inbox_setup.py update --except _tools/test_stack.py` until SCAF-77 to 81 land.
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
