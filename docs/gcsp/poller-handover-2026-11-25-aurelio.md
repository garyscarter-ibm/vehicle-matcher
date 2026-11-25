# Poller hand-over: aurelio, 25 November 2026, 22:40 UTC

Gary's Claude dev poller, registered as `garyscarter-ibm-aurelio` (lease to 2026-11-26 09:20 UTC). Retiring at
about 300k tokens. Russell's poller `usget-velko` is live.

## Goal
Run the dev poller per the `scaffolding:dev-inbox` skill: the generic `references/code-poller.md`, plus step E from
`/Users/garycarter/Claude/agent-scaffolding/plugin/skills/dev-inbox/references/code-poller.md`. Read `AGENTS.md`
first (OneDrive ban, Story test set, Shared local test stack). Shared checkout stays on `gcsp-poc-dev`.

## Done this session
- FUCQ-513 (DEV-2026-11-22-vesper-001), FUCQ-516 (vesper-002), FUCQ-515 (vesper-010): all already repaired on base
  (da9852dfe; 259eea70f; 123327f69 + 93e94bec5). Merged at 2d50fa1b6, 0b878b6dc and 81add09a8. Closed with
  `cleanup: complete`, and moved to In Review in Jira with evidence comments. Poller reran the key tests: 18/18, 4/4,
  8/8 + 3/3 + 4/4. Two Jira comments ask Gary to confirm: F516's pinned-quote terms basis (ignores four time fields)
  and F515's persisted-hold disposition (no rewrite; holds lapse by sweep).
- Acceptance still needs covering batch lines: web for F513, java for F515/F516 (merges since the last java line).
- Mail: closed the answered job MSG-2026-11-25-GC-wanjiru-001 (velko repaired 14 Jira descriptions, left 14 as
  unagreed proposals). Acked all waiting notes. Chat sent.
- Learnings: DL-20261125-AURELIO-01 (Bugs claimed after fix landed), -02 (worktree `push` pushes base;
  product-map append conflicts), -03 (story-lead hand-back mid-story).

## In flight
- None. **FUCQ-520 (DEV-2026-11-22-vesper-009)** finished after the first draft of this note: existing repair dff5b1ec2,
  plus new web-e2e case f520 (`apps/gcsp-web/e2e/manual-review.test.mjs`, 1/1 at 1280 and 390, peak 2.5 GiB).
  Merged at e919a2784, closed, Jira In Review. Specs 45/45, rerun by the poller. The preview's "details unavailable"
  text was a transient loading state, not a Bug. Acceptance waits on covering web and web-e2e batch lines: the web-e2e
  batch must include `--case f520`.

## Left to do
- **web-e2e batch is due** (last line 03:17 UTC; merges since touch `apps/gcsp-web/**`, including new case f520). It needs about 3.5 GiB, over
  the 3 GiB daytime cap: claim it after 00:00 local with
  `python3 -B _tools/scaffold_git.py --poller <name> batch claim --suite web-e2e --base <sha> --ttl 3600`. Environment:
  JDK 21 `/opt/homebrew/opt/openjdk@21`, PG 17 `/opt/homebrew/opt/postgresql@17/bin`, Node 24.22.3 via the pinned npx
  in `_tools/test_stack_build.py`, Chrome `/Applications/Google Chrome.app` (`GCSP_E2E_NODE`, `GCSP_E2E_BROWSER_PATH`).
- **java batch** is due on the F515/F516 merges (and the node suite was red at 20:43 UTC, base 9788987e0; read its
  line before claiming).
- Queue: FUCQ-522 (vesper-008) and FUCQ-524 (vesper-007) are `design_impact: yes` with no recorded design agreement,
  so B2 blocks them: don't claim them until it is agreed. FUCQ-553 (vesper-034) was claimed by velko at 22:3x.
  Claimable now (check-story OK): FUCQ-334, 335, 337, 339 (DEV-2026-11-10-GC-015/016/018/020). Most queued ui Bugs
  still lack a `ui:` line.
- The Jira push lists about 570 ops for other issues, from older claims. Only ours were applied; leave the rest to their
  owners.
- Don't retry the Jira attachment-field pull until there's a way to save the search pages by tool.

## Gotchas
- `git rm` before `scaffold_git.py commit --paths` makes its add fail: delete with plain `rm` and name both paths.
- `.product-map/work.json` and `docs/gcsp/dispatcher-learnings.md` conflict when two branches append. Resolve as a
  union (check by id, keep both), in a temporary worktree, never by switching the shared checkout.
- `ClaimRunClockHttpTest` lives in `gcsp.api.appointments`, not `claims`.
- Close records need `cleanup_client: 516ca3553159` (this clone).
