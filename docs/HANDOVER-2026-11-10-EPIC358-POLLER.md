# Hand-over: epic FUCQ-358 dev poller (Claude Code), 10 November 2026

**Goal (Russell, 21:00 GMT):** "Start the dev poller. Work to machine constraints … Ignore hard limits this session.
Work only on stories from epic 358. Pay close attention to the UI and the mockup. If you complete that, then move onto
any high priority defects which need fixing. If you run out then stop." Russell then said "Leave it deferred" for
FUCQ-250, the only open High bug, so the run stops once the epic is done.

**Read first:** `.claude/dev-poller-directive.md` (top section), `AGENTS.md`, the dev-inbox skill's
`references/code-poller.md`, `docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md`.

## Decisions

- Russell's instruction lifts every FUCQ-358 Story's "discuss only" hold. On each claim: remove the `paused:` line, add
  "Hold lifted" and "Design agreed" bullets at the top of `decided` (see `_dev/in-progress/DEV-2026-11-10-GC-036.md`),
  commit and push, then in Jira transition to In Progress (id 21), assign Russell, set points (`customfield_10016`) and
  start date (`customfield_10015`), set labels without `discussion-only` plus `agent:claude-code` and
  `host:russells-macbook-air`, add a comment, and run `jira_sync.py push --mark-done` for that key's operations.
- Binding mockup: frozen reference **193cbf07** (supersedes bd27555a). Every story needs paired captures at the
  manifest's exact width and height, plus an independent Opus critique, with its findings fixed.
- No high-level design change: the epic extends the existing BriefService and Account view.
- Russell asked whether the stories really block each other, and for a second story-lead. Jira has no links between them.
  The overlap is mainly files (all six touch `blocks/gcsp/account/` and most touch `server/gcsp/brief/`). FUCQ-369 and
  FUCQ-370 depend on FUCQ-368's categories and contract.

## Update, 23:05 GMT: the follow-on session takes over

At Russell's request the poller moves to a fresh session. **Mulan and Shaggy stay subagents of the old session**
(this file's author, Oluwaseun), because their reports can only go to the session that started them. The old session
does nothing except forward each report to the follow-on session with `SendMessage`, and stop either one if you ask.
The follow-on session is the dispatcher: it does step D (merge), step C (close), the Jira push, the next claims and
the new story-leads, and it paces itself with `ScheduleWakeup`. To see progress without waiting for a relay, read their
branches' `## Result` blocks or run the stall check against the old transcript
(`/Users/usget/.claude/projects/-Users-usget-Claude-vehicle-matcher/69298e71-279e-478c-8b3b-491582e278f1.jsonl`,
`--agent Mulan` or `--agent Shaggy`).

- **Capacity:** `can_start` also applies the harness's 8-agent cap, which counts every Claude and Codex process on the
  Mac. Russell waived that cap, so go by the "room for N" memory figure (5 at 23:04, 66% free, normal pressure). Russell
  then asked for more help: each story-lead may run up to 2 implementers at once on slices whose files don't overlap,
  and one slot is kept for runners and the Opus critique agent. Only one full suite runs at a time.
- **Shaggy (FUCQ-368):** worktree `.claude/worktrees/DEV-2026-11-10-010`; slice briefs `brief-slice1.md` (server
  contract, `POST /api/gcsp/brief/preferences` draft autosave) and `brief-slice2a.md` (kit `category-preferences` and
  a `checkboxField` switch) are under `.claude/dev-poller-20261110-claude/DEV-2026-11-10-010/`. Slices 1 and 2a are now
  running in parallel. The Account mount (slice 3) waits for GC-036 to merge; if it isn't merged, Shaggy reports
  `blocked` and the dispatcher resumes them by relay once it is.
- **Mulan (FUCQ-359):** building; no commits on the branch yet at 22:46.

## In flight (as at 22:05 GMT)

| Story | Jira | Points | Story-lead | Branch | Notes |
| --- | --- | --- | --- | --- | --- |
| DEV-2026-11-10-GC-036 | FUCQ-359 Account layout | 8 | Mulan | `dev/DEV-2026-11-10-GC-036` | Owns `blocks/gcsp/account/` and `blocks/gcsp/employee/` until merged |
| DEV-2026-11-10-010 | FUCQ-368 compact preferences | 13 | Shaggy | `dev/DEV-2026-11-10-010` | Server contract and component first; mounts into Account only after GC-036 merges, otherwise reports `blocked` to be resumed |

Their reports come back to the session that started them (this one). A successor finds their state in the branches'
`## Result` blocks.

## Left, in order

1. Merge GC-036 when built (step D: pull, `git merge --no-ff gcsp-poc` in its worktree if base moved, rerun its scoped
   tests, `scaffold_git.py merge --branch dev/DEV-2026-11-10-GC-036`, push), close it (step C), Jira to In Review.
2. Resume Shaggy for the Account mount if they reported `blocked`; merge and close FUCQ-368.
3. Then serially: FUCQ-367 star rating (DEV-2026-11-10-009), FUCQ-369 Same again (011), FUCQ-370 Engage Buddy (012),
   FUCQ-371 recommendations (013). FUCQ-367 can run alongside 369 only if their brief-server edits don't collide.
4. Stop: write the final hand-over, update the directive to STOPPED.

## Constraints

- Gary has claims in flight (GC-037 to GC-045: presenter console, removal of presenter controls from
  `portal-shell.js`, generated stock, presenter releases read, page loading in `server/gcsp/host.js`). Never touch
  them.
- Capacity: `/usr/bin/python3 -I /Users/usget/Claude/agent-scaffolding/tools/capacity --line` before each spawn.
  Russell said to ignore hard limits, so the harness's 8-agent cap is not binding, but free memory is. One full suite at
  a time.
- Jira pull watermark stays at 2026-11-10 15:49 (the import at 21:12 imported 6 Stories). Twelve "can't be built yet"
  comments for Gary's FUCQ-350–366 imports were already posted from his machine, so don't repost them.
- Not done: agent-scaffolding 0.7.3 install (needs Russell's sudo) and marketplace pin (needs Claude Desktop restarted).
