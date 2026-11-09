# Handover: Russell's poller, after the 9 Nov overnight run (02:50 UK)

The overnight poller stopped at 02:50: its conversation passed 300k. Nothing of Russell's is in flight: there are no claims, worktrees or story-leads. To resume, start a fresh `scaffolding:dev-inbox` poller and read this first.

## Note from Gary's poller, 9 Nov 07:30 (Gary asked for this)
Why the To Do bugs weren't picked up: `dev_mail.py queue` marks a bug "held" while its intake fields (related_story, story_link_basis, reproduction_steps, expected/actual) are unresolved, and FUCQ-152, 166, 190 and 207 also lacked the Jira headings check-story needs. Gary has asked for all of them to be built. Headings are now in Jira and re-imported; leads do the defect intake as their first step (defects SKILL.md).

- **Gary's poller has claimed and started:** FUCQ-241 (High), FUCQ-190, FUCQ-152.
- **Gary's poller will take next, in capacity batches:** FUCQ-207, FUCQ-242, then the fleet-tooling bugs FUCQ-156 to 165 (DEV-2026-11-07-GC-006..015) and FUCQ-166 (GC-016). FUCQ-184/185 (DEV-2026-11-09-003/004) get closed as already fixed after a check.
- **Russell's poller, when restarted:** the fleet-tooling bugs FUCQ-156 to 166 are your area, so take any that are still unclaimed (run `dev_mail.py queue` and claim before starting; a claim that loses the race fails cleanly). To avoid collisions, work from FUCQ-166 downward; Gary's poller works from FUCQ-156 upward. Check the queue between claims. Held status is not a reason to skip them: do intake first.

- **Update 09:30:** Gary's poller has now built, merged and closed every held bug except FUCQ-166 (Pages publication), which is left for you: FUCQ-152, 156 to 165, 190, 207, 240 to 244 are In Review. FUCQ-184/185 were closed as stale re-imports (already fixed by FUCQ-124). Each Jira comment has a "For Russell" line where your area's design is affected, and four need a run you must authorise: FUCQ-157 (real-evidence proof publication), 161 (fresh G42 inventory allocation), 158 (rerun the bounded consumer audit on corpus .12, expect 2,707 failures to fall to 0) and FUCQ-153 AC5 (unchanged).

## Direction that still holds (Russell, 8–9 Nov)
- Leave every story claimed by `garyscarter-ibm` to Gary.
- Skip Won't-for-demo work (`moscow-after-demo`, `post-demo`, FUCQ-27/28/46/47/48/149). Leave FUCQ-218 (it waits on Russell's scheme names) and FUCQ-98's email (it needs the hosted key).
- No blocking questions overnight. Nothing moves to Done.
- "Work to machine capacity": ignore the one-story-at-a-time rule and follow the live capacity check (Russell, 01:09, for that session; reconfirm before relying on it).
- Jira push: `jira_sync.py push --json` lists about 500 operations for other clones' stories. Apply only the operations for this poller's own claims, then `--mark-done` just those.

## Done tonight
FUCQ-155, 153, 154 and 151 are merged, closed, cleaned up and In Review. Details are in `docs/gcsp/overnight-log-2026-11-08.md`, section "Russell's poller, morning report".

## Open items
- FUCQ-153 AC5 (the >64 MiB proof rerun) and FUCQ-151 AC3 (one finite source chunk) both need a collaborator to authorise the run.
- FUCQ-150: confirm that Gary's 3712a143 fixes it, then close it.
- DEV-2026-11-04-035 and 036: cleanup is pending until someone decides about the untracked evidence JSON in their worktrees.
- DEV-2026-11-09-003 and 004 (FUCQ-184/185) are stale imports of bugs that are already fixed.
- Queue state at 02:50: nothing is eligible for Russell's poller beyond FUCQ-152 (fails check-story). Gary's poller holds the rest.

## Read first
`AGENTS.md`, `docs/gcsp/build-rules.md` ("Demo delivery and scope control"), `docs/HANDOVER-2026-11-09-OVERNIGHT-POLLER.md`, and the overnight log above.

- **Update 11:40:** Gary has asked for the whole backlog to be cleared today, so Gary's poller has claimed FUCQ-166 (DEV-2026-11-07-GC-016) and FUCQ-150 (DEV-2026-11-06-GC-012, verifying 3712a143). Neither will publish to Pages or deploy; anything needing a real publication run comes back to you as a "for Russell" note. Gary's poller will also take the after-demo handover/return stories (FUCQ-167, 168, 169, 171) and FUCQ-27/28 in capacity batches. Check `dev_mail.py queue` before claiming anything.
- **Update 12:40:** FUCQ-166 is merged to gcsp-poc (2dc6049d) and In Review, partly met. The Pages readback check only runs once it reaches main: please merge it there via PR, then compare two same-SHA receipts with the github-pages deployment list (details on the Jira comment). FUCQ-150 is In Review (fixed by 3712a143, no code change).
