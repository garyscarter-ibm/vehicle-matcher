# Handover: Gary's Claude Code dev poller, 5 November 2026

For a fresh Claude Code session that carries on Gary's dev poller in vehicle-matcher. Written at 11:00 UK time, when
the previous session passed 300k tokens.

## Goal

Run the dev poller (`scaffolding:dev-inbox`, `references/code-poller.md`) as Gary's poller (`garyscarter-ibm`, prefix GC),
claiming stories from the shared queue and building each with one story-lead. Merge is `auto` on base `gcsp-poc`. Jira is
FUCQ (`.claude/scaffolding.json`, cloudId `9024e134-9d2e-4f15-af8d-4df1fd4c2cb1`).

## Three pollers share the queue

- **Russell's poller** runs Codex on Russell's Mac. It holds DEV-011 (FUCQ-40), 031 (FUCQ-58), 065 (FUCQ-83) and 069
  (FUCQ-66), all blocked on inputs: the imagery decision, live-source access, and the GCSP Render PostgreSQL URL from
  Gary. Leave them alone.
- **Gary's Codex poller** runs on this Mac (Codex app automation `vehicle-matcher-codex-dev-poller`, every 3 minutes). It
  claimed FUCQ-31 (DEV-2026-11-04-051, shared kit decision cards and controls) at 10:06 and is building it in
  `.claude/worktrees/DEV-2026-11-04-051`. Never touch that worktree or its branch.
- **Gary's Claude poller** is this one. Gary asked for it to run alongside Codex, sharing the capacity check, and to claim
  only stories whose `files_or_areas` don't overlap FUCQ-31's.

Claims are leases on the remote, so no two pollers can take one story. `dev_mail.py team` lists both of Gary's pollers'
claims as `mine`. Tell them apart by the story's `agent:` line (`codex` or `claude-code`).

## Done in the previous session

- FUCQ-64 (DEV-037, GCSP portal shell and representative employee body): merged `0f82181`, closed, In Review. Gary approved
  the body on 5 November; the reference is `docs/gcsp/evidence/fucq-6/README.md` at revision `a7fc178`.
- FUCQ-97 (DEV-062, presenter outbox viewer): merged `4f7c443`, closed `4785a16`, In Review. Its evidence is in
  `docs/gcsp/evidence/fucq-97/`.
- Restored missing `ui:` lines from Jira for FUCQ-64, 31, 33 and 97. Russell has since fixed the importer
  (`docs/gcsp/poller-tooling-2026-11-05.md`); stories imported before that fix may still lack the line. Copy it word for
  word from the Jira description's template block, commit by name, and push.

## What's left and how to choose

Ready stories at 11:00, and why none was claimed:
- **FUCQ-67 (DEV-044, accounts) and FUCQ-95 (DEV-083, buddy activity):** both consume FUCQ-31's shared cards. Wait for
  FUCQ-31 to merge.
- **FUCQ-33 (DEV-007, launcher):** edits `ui.js`, `tokens.css`, `COMPONENTS.md` and the ratchet, which overlaps FUCQ-31.
  Wait for it to merge.
- **FUCQ-46 (DEV-017), FUCQ-44 (DEV-014) and FUCQ-98 (DEV-054):** each needs live BMW access or an email sender that Gary
  hasn't set up or authorised. Don't claim them without his decision.
- **FUCQ-27 (DEV-047):** deferred until after 12 November by the HLD agreement (Q5).

Once FUCQ-31 merges, FUCQ-67, FUCQ-95 and FUCQ-33 become claimable. Run the capacity check before every claim.

## Rules learned this session

- **Jira push:** `jira_sync.py push --json` lists ops for everyone's stories. Apply and `--mark-done` only ops for our own
  story and its Epic; Russell's clone sends his. Set the start date only if it's empty, and read it back.
- **Closing:** `scaffold_git.py commit` refuses a staged deletion. Remove the `in-progress/` file with plain `rm`, then
  commit both paths by name. `drop-branch` deletes only the local branch, so also delete the remote one with
  `git push origin --delete dev/<id>` once it's merged.
- **Done:** a merged story stops at In Review. Only Gary or Russell moves a story to Done.
- **Design review gates:** a story whose acceptance needs a human review (like FUCQ-64's item 4) stops at built. Show Gary
  the screenshots, record his answer in the evidence README, and then merge.
- **Brief each story-lead** with its worktree path, the files FUCQ-31 is editing (keep new UI under `blocks/gcsp/`), the
  reviewed body reference, and the instruction not to merge.

## Read first

1. `CLAUDE.md`, `AGENTS.md`, `docs/gcsp/README.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/build-rules.md`.
2. The dev-inbox skill's `references/code-poller.md`.
3. `docs/HANDOVER-2026-11-05.md` (Russell's), `docs/gcsp/dev-poller-2026-11-04.md` (Russell's overnight log; skim only the
   latest section) and `docs/gcsp/poller-tooling-2026-11-05.md`.
