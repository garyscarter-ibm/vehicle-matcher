# Handover: align nine existing Stories with the new GCSP backlog

4 November 2026, from the session that authored FUCQ-79 to FUCQ-109. Branch `gcsp-poc`, head `5497f4f` or later. Jira FUCQ on `ibm-consulting.atlassian.net` (cloudId `9024e134-9d2e-4f15-af8d-4df1fd4c2cb1`).

## Goal

Edit seven existing Stories so each one uses the new foundation and critical-path Stories, instead of building its own clock, reset, repository, stock pool, policy source or order tracking. Gary approved these edits on 4 November ("kick off the nine edits"), as written here; you don't need to ask again. If reading an issue shows that an edit no longer fits, ask him before changing it. Story authoring only: no application code.

## Already done

- **Foundation:** Epic FUCQ-79 with Stories FUCQ-80 to 85 ([fucq-79-stories.md](../gcsp/fucq-79-stories.md)).
- **Critical path:** Epics FUCQ-86 to 90 with Stories FUCQ-91 to 109 ([fucq-86-90-stories.md](../gcsp/fucq-86-90-stories.md)).
- **Re-pointed in Jira:** FUCQ-29, 65 and 66, each with a "Foundation, 4 November 2026" paragraph in Decided. Copy that paragraph style.
- **No change needed:** FUCQ-31, 35, 64, 67, 68, 72 and 77.

## The seven edits (corrected targets)

The FUCQ-74 and FUCQ-75 Epic edits moved to the C9 session ([handover-section-c7-c9-2026-11-04.md](handover-section-c7-c9-2026-11-04.md)), because that session also writes their Stories. Their rows stay below for reference only: don't make them.

The keys below are the real Stories, not the Epics. Links read "A blocks B" and are created with `createJiraIssueLink` (`inwardIssue` = A). They cannot be deleted, so check each one before creating it.

| Story | Edit | New Blocks links |
|---|---|---|
| FUCQ-30 | Its confirmed preference or essential change action is consumed by FUCQ-107 (the post-decline change) and FUCQ-91's single-change operation, not re-implemented by them | FUCQ-30 → FUCQ-107 |
| FUCQ-36 | Package every `blocks/gcsp/*` block from a manifest, not a fixed list. Add direct-URL smoke checks for the offer, Greg dashboard and outbox viewer pages. The release checklist records FUCQ-81's migrations and FUCQ-83's seed | none |
| FUCQ-69 | The live path reads only FUCQ-92's released pool (one shared pool with the buddy). Fixtures are for tests and the gallery. Add a "nothing released yet" state | FUCQ-92 → FUCQ-69 |
| FUCQ-70 | The countdown and its tests use FUCQ-85's demo clock and ticks, with the hold length read from FUCQ-82 (`hold.cart`) | FUCQ-85 → FUCQ-70 |
| FUCQ-71 | Replace "future buddy acceptance" with "FUCQ-108 calls this adapter". Its tables become FUCQ-81 migrations, and its repository-contract cases extend FUCQ-81's suite. Reconciliation of unknown or timed-out outcomes registers as a FUCQ-85 tick handler. Add FUCQ-81 and FUCQ-85 to `depends_on` | FUCQ-81 → FUCQ-71, FUCQ-85 → FUCQ-71 (FUCQ-71 → FUCQ-108 already exists) |
| FUCQ-73 | Expiry and reopen scenarios use FUCQ-85 ticks and reset. Stock comes from FUCQ-78 via FUCQ-92. Add FUCQ-85 and FUCQ-92 to `depends_on` | FUCQ-85 → FUCQ-73, FUCQ-92 → FUCQ-73 |
| FUCQ-74 (Epic), C9 session | Add a paragraph (an Epic has no `depends_on`): prediction and the order plan layer on FUCQ-90's dashboard, and FUCQ-99 is the deterministic baseline (Q10). Submission and tracking go through FUCQ-104. Weights, bounds and the active model reference are dated policy rows via FUCQ-83, read through FUCQ-82 | FUCQ-90 relates to FUCQ-74 (Relates, not Blocks) |
| FUCQ-75 (Epic), C9 session | Reset and replay call FUCQ-85, with no reset of their own. Roles and the starting state come from FUCQ-84. Name the presenter control UI (tick, reset, scenario picker) as a child Story still to be authored. FUCQ-109 supplies the first scenario | FUCQ-85 relates to FUCQ-75 |
| FUCQ-78 | Replace the "Postgres stock repository port... in-memory adapter" precondition with `depends_on` FUCQ-81 and FUCQ-82. Stock aggregates become keyed entries in FUCQ-82's seed file, read only through PolicyService. Expose a run-scoped generator that FUCQ-85's reset calls | FUCQ-81 → FUCQ-78, FUCQ-82 → FUCQ-78. **Do not** add FUCQ-78 → FUCQ-85 (no cycle; FUCQ-92 already waits on both) |

Before you edit, read each issue in Jira (`view: evidence`). Keep its migration record and its other links. Send its full description back with `editJiraIssue`. Append to `depends_on`; don't replace it.

## After editing

- Read each issue back and confirm `depends_on` matches its inward Blocks links.
- Add a row to a new `docs/gcsp/evidence/existing-story-alignment-2026-11-04.json`, in the same shape as the other publication records, then commit and push it to `gcsp-poc`.
- The four stale Blocks links (FUCQ-27→29, FUCQ-28→29, FUCQ-28→30, FUCQ-28→31) have been deleted; nothing to do.

## Read first

1. This file.
2. [fucq-79-stories.md](../gcsp/fucq-79-stories.md) and [fucq-86-90-stories.md](../gcsp/fucq-86-90-stories.md), the tables at the top only.
3. Jira FUCQ-66, for the "Foundation" paragraph to copy.
4. [hld-review-gc.md](hld-review-gc.md), only when an edit needs a decision's wording.
