# Handover: Russell's poller, after the 9 Nov overnight run (02:50 UK)

The overnight poller stopped at 02:50: its conversation passed 300k. Nothing of Russell's is in flight: there are no claims, worktrees or story-leads. To resume, start a fresh `scaffolding:dev-inbox` poller and read this first.

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
