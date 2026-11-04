# Handover: pre-build consistency pass and design update, 4 November 2026

For a fresh Claude Code session. Two jobs: (A) a consistency pass over the GCSP backlog in Jira FUCQ, and (B) bring
the draw.io high-level design up to date with it. **Do not start the dev poller** and do not run a Jira pull
(`jira_sync.py pull`): Gary will start the build himself. Story authoring and design only: no application code.

## Before you start

- **Wait for the C7, C8 and C9 sessions to finish.** They are authoring Stories in parallel and push to `gcsp-poc`:
  "Author GCSP C7: lifecycle after selection" (`local_ac589d5f-6e8a-49fc-b57a-83b5c5aaa5d2`), "Design and author
  GCSP C8: 1,000-employee comparison" (`local_7a9939cb-431c-4d88-bbd0-43e517839152`) and "Author GCSP C9: Stories for
  FUCQ-74 and FUCQ-75" (`local_14d01b89-ea42-464e-8d23-b9ef5d2c909c`). Check with
  `mcp__ccd_session_mgmt__list_sessions`; if any is still running, do job B's reading only and come back to A.
- Work in a worktree off `origin/gcsp-poc`, rebase before pushing, and push with `HEAD:gcsp-poc`.
- Read `AGENTS.md` (equal collaborator authority), `docs/gcsp/README.md`, `docs/gcsp/experience-quality.md`,
  `docs/gcsp/build-rules.md` and `docs/design/hld-review-gc.md` (the Q1 to Q19 decisions).
- Jira: site ibm-consulting.atlassian.net, cloudId `9024e134-9d2e-4f15-af8d-4df1fd4c2cb1`, project FUCQ. Record in
  `.claude/scaffolding.json` under `backlog`.

## What exists

- Foundation Epic FUCQ-79, Stories FUCQ-80 to 85: `docs/gcsp/fucq-79-stories.md`.
- Critical-path Epics FUCQ-86 to 90, Stories FUCQ-91 to 109: `docs/gcsp/fucq-86-90-stories.md`.
- Seven existing Stories re-aligned (FUCQ-30, 36, 69, 70, 71, 73, 78):
  `docs/gcsp/evidence/existing-story-alignment-2026-11-04.json`.
- C7, C8 and C9 output (Epics, Stories, and FUCQ-74/75 changes): each session's own story set and publication
  record under `docs/gcsp/`. FUCQ-126 (presenter controls) is one of C9's.
- Publication records: `docs/gcsp/evidence/fucq-79/` and `docs/gcsp/evidence/fucq-86-90/story-publication.json`.

## A. Consistency pass

Read every Story under FUCQ-79, FUCQ-86 to 90 and the C7/C8/C9 Epics, plus the Stories they link to (a runner with
`view: evidence` is the cheap way; transcribe nothing by hand that a script can compare). Check:

1. **Links are the truth.** `jira_sync.py` builds `depends_on` from native Blocks links, not from the header text.
   For each Story, the header's `depends_on` must equal its inward Blocks set. Report every mismatch.
2. **No cycles** across the whole FUCQ Blocks graph, and no Story blocked by an Epic.
3. **Importable.** Load `_tools/jira_sync.py` as a module and run `parse_issue`, `issue_blocks` and
   `missing_fields` over the fetched issues offline. Every Story must have all six sections, a valid `kind:` and
   `size:` label and the `backlog` label. Don't run `pull`, `push` or anything that writes `_dev/` or
   `.claude/jira-sync.json`.
4. **Overlaps between the parallel sessions.** Look for duplicated or contradicting acceptance items:
   - C9's buddy Stories against FUCQ-108, FUCQ-71 and FUCQ-72.
   - FUCQ-126 and the FUCQ-75 work against FUCQ-85 (DemoClock, ticks, reset).
   - C7's lifecycle Stories against FUCQ-92 and FUCQ-104.
   - C8's comparison against FUCQ-99 and FUCQ-101.
5. **Priority against the critical path.** A P3 Story must not block a P2 one.
   - Known case: FUCQ-64 is Medium (P3, inherited from FUCQ-7) but blocks FUCQ-67, 94, 95, 97, 101, 105 and 126.
     Propose raising it to High (P2) with `priority_reason: due 2026-11-12: GCSP demo`.
   - Check FUCQ-21, FUCQ-26 and FUCQ-31 the same way.
6. **Decisions carried.** Each Story that touches state, policy, mail, identity or UI names the HLD decision it
   relies on (Q2, Q6, Q11, Q13, Q16, Q18 and so on) and doesn't contradict it.

Show Gary the findings and the proposed fixes in one message and wait for OK. Then make the fixes with
`editJiraIssue` and, for links, `createJiraIssueLink` through `executeWrite` (inwardIssue blocks outwardIssue).
Check the direction on the first link before doing the rest. **The connector cannot delete links**, so make every
new one carefully; a wrong existing link goes on a list for Gary to delete by hand. Read back what you changed.
Record the result in `docs/gcsp/evidence/pre-build-consistency-2026-11-04.json`, with a short markdown summary
beside it.

## B. Design update

Use the `scaffolding:design-with-drawio` skill. It drives draw.io in Gary's browser through OpenTabs. The design is
`docs/design/high-level-design.drawio` (11 pages, PNGs exported beside it) with `docs/design/gcsp-high-level-design.md`.

1. List the modules and connections the new Stories introduce, and check each against the diagram pages. The prose
   already names PostgreSQL, PolicyService, the outbox and presenter ticks; the diagram has `PolicyService` once
   and no DemoClock, DemoIdentityAdapter or outbox viewer by name. Candidates:
   - Postgres repository and dated policy tables (FUCQ-81, 83), and PolicyService (FUCQ-82).
   - DemoIdentityAdapter and run scope (FUCQ-84).
   - DemoClock, presenter ticks, reset and the presenter controls (FUCQ-85, FUCQ-126).
   - BriefService (FUCQ-91), release and allocation (FUCQ-92, 96), and the hold/offer/outbox transaction (FUCQ-100).
   - Outbox dispatcher, viewer and real transport (FUCQ-93, 97, 98), and offer link access (FUCQ-102).
   - Greg demand aggregation and dashboard (FUCQ-99, 101), plus whatever C7 and C8 add.
2. Propose the additions and rewiring to Gary on the diagram, with *proposed* status colours, and agree them before
   saving. C8's session may already have changed the design; start from the latest `gcsp-poc`.
3. Save, re-export the changed pages' PNGs, update `gcsp-high-level-design.md` if a component's name or role changed,
   commit and push.

## Done means

- Every finding is fixed in Jira and read back, or listed for Gary.
- The consistency record and summary are pushed.
- The design shows every new component as proposed, Gary has agreed it, and the PNGs are re-exported and pushed.
- The poller has not been started.
