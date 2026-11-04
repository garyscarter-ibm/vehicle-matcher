# Handover: author the missing GCSP Epics and Stories (section C)

4 November 2026, from the HLD story-readiness session. Branch `gcsp-poc`, head `3525ae6` or later. Jira FUCQ on `ibm-consulting.atlassian.net` (cloudId `9024e134-9d2e-4f15-af8d-4df1fd4c2cb1`).

## Goal

Create the backlog for the demo's critical path, which has no Epics or Stories yet. Start with the **foundation Epic and its Stories**, because every other capability builds on it. Then, if time allows, do the critical-path Epics C2–C6 in the order listed in [the readiness assessment](hld-story-readiness-2026-11-04.md#c-capabilities-with-no-epic-or-story). The demo is on **12 November 2026**. Gary's critical path (review Q9) is Paula's offer → decline → second offer → select, plus Greg's dashboard. It must be green first.

Story authoring only. Don't write application code, start pollers or provision anything.

## Done already

- **HLD agreed:** FUCQ-6 is Done. Russell accepted Gary's five referred recommendations ([hld-agreement](../gcsp/hld-agreement-2026-11-04.md)). All 19 of Gary's review decisions are in [hld-review-gc.md](hld-review-gc.md) and applied to the draw.io diagram.
- **Readiness assessed:** [hld-story-readiness-2026-11-04.md](hld-story-readiness-2026-11-04.md). The verdict was "ready, with conditions". Sections A, B and D are now done.
- **HLD narrative aligned (`1080b54`):** lifecycle names, deployment, the corpus, block placement and the two hold types. `CLAUDE.md` and `build-rules.md` allow `pg`. The experience contract has the CSP rule ("Embeddable blocks").
- **Existing Stories re-aligned in Jira:** FUCQ-29–31, 35, 36 and 64–73 carry the 4 Nov decisions in their descriptions. FUCQ-1 and FUCQ-76 are Rejected.

## Still open, not yours to fix

- **Four stale Blocks links** need deleting in the Jira UI: FUCQ-27→29, FUCQ-28→29, FUCQ-28→30 and FUCQ-28→31. The Atlassian connector cannot delete links. `_tools/jira_sync.py` reads `depends_on` from links, so mention this in your report if it's still outstanding.
- **PNG exports of the diagram** predate the review.
- **Provisioning** the GCSP Render environment and Postgres is Gary's job.

## What to author first: the foundation Epic

One Epic, a bounded capability, not nested under another Epic (Russell, 1 Nov). Suggested title: "Run GCSP transactions, policy and demo control on a shared foundation". Its Stories, each one slice of 8 points or less:

1. **Transaction repository on managed PostgreSQL** behind a port: migrations, an in-memory test double, and contract tests that run against both.
   - Tables for employees, versioned briefs, exact stock by `orderUuid`, claims/holds, offers, decisions, pending operations, event receipts, the outbox, and forecast/plan snapshots.
   - `pg` is the only runtime dependency allowed (Q4).
   - FUCQ-66 currently assumes it builds the manual-claim slice of this repository. Decide whether FUCQ-66 consumes the foundation story (preferred) and edit FUCQ-66 to depend on it.
2. **PolicyService and the seeded policy source** (Q6).
   - Dated tables shaped like the target model: scheme-rule links, include/exclude rules, a per-scheme price plan, and company/grade allowance.
   - Seeded from a reviewed repo file. Greg's publish writes a new dated row.
   - One read interface for every consumer.
   - Holds the keyed assumptions: hold durations (cart about 2 minutes, buddy offer about 2 hours), allocation tie-break, decline exclusion, the unused £1/point top-up, charging rule, release sizes and lead times.
   - `build-rules.md` asks the first such story to record the source's location and interface there.
3. **Demo identity and run scope:** `DemoIdentityAdapter` resolving fictional employees, Greg and the presenter behind the existing demo gate. Server-owned context on every route, and run isolation.
4. **Presenter clock, ticks and reset:**
   - Explicit ticks drive release (stock appearing on the next pull, per the round-1 finding), expiry and reconciliation (Q3).
   - Reset regenerates order identifiers and employee state, but not the immutable corpus.
   - Old offer links and outbox jobs cannot act on a new run.
5. **Shared contracts record:** the brief schema, offer/hold state machine, policy keys and repository schema, written down once so parallel stories don't each invent their own. This can be a docs-kind Story, or the first acceptance item of story 1.

Sequence: 1 and 2 first, in parallel; 3 and 4 depend on 1. Wire FUCQ-29 (policy reads) and FUCQ-66 (repository) to the new keys.

## Then C2–C6 (only if foundation is done and agreed)

These are listed in the readiness assessment, with their HLD homes:
- brief and buddy
- release → allocation → buddy offer hold
- notification: outbox and viewer
- offer page and decisions
- Greg's dashboard

FUCQ-74 already exists as an Epic for the predictive layer on top of Greg's dashboard.

## How to author

- Use the **`scaffolding:backlog`** skill for Epics (Jira mode) and the **`scaffolding:dev-inbox`** Cowork-side "stories from a backlog item" procedure for Stories.
- Copy the shape of existing native Stories such as FUCQ-66 and FUCQ-29:
  - the fenced `text` header (kind, design_impact, requested, epic, priority, priority_reason, size, depends_on, preconditions)
  - then Goal, Acceptance criteria (`- [ ]`), Files or areas, Decided, Out of scope, Validate
  - [`_dev/story-template.md`](../../_dev/story-template.md) has the field rules
  - leave `story_points` out
- Every Story's Decided cites `docs/gcsp/README.md`, `build-rules.md` and `experience-quality.md`, plus the HLD review decisions it relies on.
- Record dependencies as native `Blocks` links. Create them carefully, because they cannot be deleted through the connector.
- After creating them, read back each issue and keep a publication record like `docs/gcsp/evidence/fucq-13-19/story-publication.json`. Also write a markdown story set like `docs/gcsp/fucq-12-stories.md`.
- Show Russell or Gary the Epic and Story titles, with one line each, before creating them in Jira. Equal authority applies (`AGENTS.md`): either can approve.

## Read first, in this order

1. [hld-story-readiness-2026-11-04.md](hld-story-readiness-2026-11-04.md), sections C and D
2. [hld-review-gc.md](hld-review-gc.md), Q1–Q19 and the knowledge-base findings
3. [gcsp-high-level-design.md](gcsp-high-level-design.md): the "Review decisions" summary, responsibilities table, transaction invariants, demo access, and technical deployment
4. [../gcsp/build-rules.md](../gcsp/build-rules.md) and [../gcsp/experience-quality.md](../gcsp/experience-quality.md)
5. Jira FUCQ-66 and FUCQ-29, as format and decision examples
6. [../gcsp/README.md](../gcsp/README.md), for wider context, only as needed
