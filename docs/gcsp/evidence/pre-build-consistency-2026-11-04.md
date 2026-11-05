# Pre-build consistency pass, 4 to 5 November 2026

Job A of the [pre-build handover](../../design/handover-pre-build-2026-11-04.md). The full record is in
[pre-build-consistency-2026-11-04.json](pre-build-consistency-2026-11-04.json).

**Scope.** All 138 FUCQ issues were fetched. The checks covered the 52 Stories under FUCQ-79, 86 to 90, 110, 132, 74
and 75, and the 14 Stories they link to: 231 Blocks links in all. A script ran `_tools/jira_sync.py`'s `parse_issue`,
`issue_blocks` and `missing_fields` offline. No pull or push was run, and nothing was written to `_dev/`.

## Results

- **Cycles:** none.
- **Importable:** every Story has all six sections, valid `kind:` and `size:` labels and the `backlog` label.
- **Header against links:** one mismatch. FUCQ-107's header leaves out FUCQ-30, which a link does have. That is
  harmless, because `jira_sync` builds `depends_on` from the links.
- **Epic as a blocker:** FUCQ-7 (an Epic) blocks FUCQ-35.
- **Priority:** 28 Medium Stories block High ones. The build had already started (a Codex poller had about 30 Stories
  in progress or review), so Gary chose not to raise them: priority only orders the work, and the links gate it.
- **Overlaps between the parallel sessions:** FUCQ-85, 125 and 126 are cleanly split. FUCQ-108, 111 and 131 share
  FUCQ-71's single ordering adapter. Two acceptance items contradicted agreed decisions, and FUCQ-101 reserved no space
  for two later panels. All three are fixed below.
- **Risk:** the longest chain to FUCQ-109 is 14 Stories, and it starts in vehicle evidence (FUCQ-37 → 40 → 41 → 42 →
  60 → 77 → 78 → 92 → …).

## Changed in Jira (Gary, 5 November), all read back

| Issue | Change |
|---|---|
| FUCQ-29 → FUCQ-91 | Blocks link, made first to check the link direction. Both Stories were already In Review. |
| FUCQ-96 → FUCQ-104 | Blocks link: FUCQ-104's acceptance needs FUCQ-96's allocation. FUCQ-104's `depends_on` header updated to match. |
| FUCQ-71 | The approval-status item uses the target names (Q19), replacing "HR/IS/manager". |
| FUCQ-72 | Shows the points cost against the allowance, and cash only if the policy enables it, which it does not for Choices (Q16). |
| FUCQ-101 | Reserves regions for FUCQ-138's comparison panel and FUCQ-122's case queue. |

## Skipped by decision

These were skipped by Gary's decision; the JSON record lists each one:
- the 28 priority raises;
- the FUCQ-107 header;
- the FUCQ-7 → FUCQ-35 rewiring;
- FUCQ-99's cited decisions;
- four further links: FUCQ-66 → 100, 83 → 119, 99 → 127 and 54 → 77.

FUCQ-117 and FUCQ-121's "acceptable coverage" is still undefined. The recommendation is to reuse
`comparison.acceptableFitThreshold` (FUCQ-135); that is for FUCQ-117's implementer and reviewer.

**Links for Gary to delete:** none.
