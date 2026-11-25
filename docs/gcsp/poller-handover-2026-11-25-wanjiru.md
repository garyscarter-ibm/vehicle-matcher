# Poller hand-over: wanjiru, 25 November 2026, 16:10 UTC

Gary's Claude dev poller (registered as `garyscarter-ibm-wanjiru`, lease until 22:52 UTC). Russell's poller
(sorrel) paused for a restart at 08:33 UTC; see `docs/gcsp/dispatcher-learnings.md` DL-20261125-SORREL-19.

## Goal
Run the dev poller per the `scaffolding:dev-inbox` skill (the generic `references/code-poller.md`, plus step E
from `/Users/garycarter/Claude/agent-scaffolding/plugin/skills/dev-inbox/references/code-poller.md`).
Read `AGENTS.md` first (OneDrive ban, Story test set, shared test stack).

## Done this session
- Pulled 586 commits; base `gcsp-poc-dev` at 1458dfb93.
- Web batch suite green at 54e746a33 (1,996 tests, 13 serial whole-file chunks), recorded in `_dev/batches.md`
  (8dea18ee0). A single-process run of the same base timed out (103 fails), and every failing file passed alone:
  always use the chunked variant.
- Gary's parity verdicts recorded verbatim in the ledger of
  `docs/gcsp/evidence/offer-and-bell-parity-2026-11-23.md` (1458dfb93) and answered on `MSG-2026-11-25-sorrel-001`:
  F555 AC8, F548 AC6 and F552 AC7 (3a, 3c, 3d) match. F552 AC7 3b (editor axes) differs: an extra
  "Update preview" button in Angular. No Bug named; no Jira status changed.
- Opened job `MSG-2026-11-25-GC-wanjiru-001` (to any) asking for the 28 queued Jira stories missing required
  headings (or a `ui:` line) to be completed. No reply yet.
- Logged the Jira pull failure as a recurrence of DL-20261117-GCC-012 (4d0708e38).

## Left to do
- **web-e2e batch** is due (covers 33efe618a, 52feec065, e8bf8bd1e, c1ad50c5f, f31e1b1b4) but needs 3.5 GiB,
  over the 3 GiB daytime heavy cap: claim and run it from 00:00 local. JDK 21 at `/opt/homebrew/opt/openjdk@21`,
  PG 17 at `/opt/homebrew/opt/postgresql@17/bin`, Node 24.22.3 via the pinned npx in `_tools/test_stack_build.py`,
  Chrome at `/Applications/Google Chrome.app` (`GCSP_E2E_NODE`, `GCSP_E2E_BROWSER_PATH`).
- **Jira pull** is held: 262 issues fail because Jira omits `attachment` when an issue has none. The
  `attachments is EMPTY` witness needs the search response saved to a file by a tool, not retyped (the auto-mode
  classifier refuses hand transcription). Don't retry until there is a way to save the pages.
- **Queue:** only FUCQ-336 and FUCQ-338 (need agreed design) and FUCQ-255 (needs collaborator review) pass
  check-story; the rest wait on the job above.
- The F552 3b difference may need a Bug or an intended-change ruling; ask Gary before filing one.
- Blank ledger rows: F549 AC4, F550 AC5, F551 AC6, F556 AC6 (their pairs are Jira attachments).

## Gotchas
- zsh doesn't word-split `$G` holding a command: call `python3 -B _tools/scaffold_git.py --poller wanjiru ...`
  in full each time.
- `batch renew` needs `--ttl`.
- The local review page `.claude/review/parity-review.html` is ignored and uncommitted.
