# Handover: Russell's overnight dev poller, 9 November 2026 (from 00:50 UK)

Written by the session that set up tonight's run. Its conversation passed 300k, so the poller itself runs in a fresh
session that reads this file first.

## Russell's direction for tonight (explicit, 8–9 Nov)

- **Leave every story Gary has claimed to Gary.** Never resume, merge, close or edit a story whose `claimed_by` is
  `garyscarter-ibm`, or one his poller claims later. His poller is running overnight on the same `gcsp-poc` branch.
- **Run the dev poller** ("Run the poller only"): take whatever unclaimed, ready stories the queue lists. **Skip
  Won't-for-demo work:** Jira label `moscow-after-demo` (FUCQ-167/168/169/171), any `post-demo` label
  (FUCQ-178/181), and FUCQ-27/28/46/47/48/149, which are agreed for after 12 Nov or paused. Could work
  (`moscow-could`, FUCQ-170/172/173/174/175/176) is allowed, but Gary said he'd pick up 174/175/176 after
  FUCQ-137/138, so check they're unclaimed at claim time.
- Prefer stories that touch the UI or the user journey when the order is otherwise equal.
- **FUCQ-98 is handled:** the test email needs the hosted `DEMO_ACCESS_KEY`, which Russell doesn't have. It's routed to
  Gary (Jira comment 3627934 and the 9 Nov section of `docs/gcsp/overnight-log-2026-11-08.md`). Don't try to send it.
- **FUCQ-218** waits on Russell's scheme names. Leave it.
- No blocking questions to Russell while he's asleep. Record decisions under "for Russell" in each result block.
- Must stories stay **In Review**. Only a collaborator moves anything to Done.

## State at handover

- `gcsp-poc` at `55e3d19f` (pushed), after this session's Jira pull. It imported FUCQ-181, 184, 185, 190 and 232 as
  DEV-2026-11-09-001 to 005, and noted the FUCQ-178 change on Gary's claim (his poller handles that notify).
- **Jira comments not yet posted.** The pull recorded them in `.claude/jira-sync.json` (`commented`) before they
  were posted. For each key below, post `jira_sync.py`'s missing-headings comment, built with
  `comment_body(key, missing)` from the listed fields, unless the issue already has one:
  FUCQ-181, 184, 185, 190, 207, 218, 226, 232. Check `listJiraIssueComments` first, because Gary's poller may
  have posted them already.
- **Evidence download pending:** FUCQ-150 / DEV-2026-11-06-GC-012, attachment 937236 `03-greg-actual-queue.png`.
  Do it before anyone works that bug.
- **Ready queue, unclaimed** (`dev_mail.py queue --stats` at 00:45):
  - DEV-2026-11-06-GC-012 (FUCQ-150, UI bug, Greg's case queue width). Jira already shows it **In Review**, and
    Gary's commit 3712a143 says "full-width Greg region (FUCQ-150)". Check whether it's already fixed before
    building. `check-story` also fails on a missing `ui:` line.
  - DEV-2026-11-07-GC-001, 003, 004, 005 (FUCQ-151/153/154/155): fleet-tooling bugs, Medium, `check-story` OK.
  - DEV-2026-11-07-GC-002 (FUCQ-152): fails `check-story`, missing headings.
  - DEV-2026-11-04-047 (FUCQ-27), DEV-2026-11-07-001/002/003/005 (FUCQ-167/168/169/171): **skip**, Won't for demo.
  - DEV-2026-11-07-008/009/010 (FUCQ-174/175/176): Could. Gary queued them after 137/138.
  - DEV-2026-11-08-GC-035 (FUCQ-218): **skip**, waiting on Russell.
- Capacity at 00:45 was `can_start=2`, so one story-lead at a time.

## Read first

1. `AGENTS.md`, `CLAUDE.md`, `docs/gcsp/build-rules.md` ("Demo delivery and scope control"),
   `docs/gcsp/experience-quality.md`, `COMPONENTS.md`.
2. `docs/gcsp/backlog-moscow-review-2026-11-07.md`, the priority basis.
3. `docs/gcsp/overnight-log-2026-11-08.md`: Gary's overnight log, including what his poller is doing.
4. The `scaffolding:dev-inbox` skill and its `references/code-poller.md`.
