# Independent generator review: round 2

Reviewer: Edna, Sol/medium, 6 November 2026. Focused read-only recheck of round-1 retained-allocation/privacy findings and the added replay correction. No product/test edits, tests, proofs, network/source collection, descendants, Git mutations or scratch allocation.

Verified SHA256 identities before review:

- `server/gcsp/vehicle-evidence/stock-generator.js`: `e48c256c58362df5768c51e79710aeb8170078568457a8c28df9b1204180f1c1`
- `server/test/gcsp-stock-generator.test.js`: `692c3c080959c978738a35b9f19762c9b084114ef25be560b16476ef77c3ca26`

## Previous findings

1. **Retained allocator occupancy: resolved.** Generator lines 102 and 184-195 require a trusted absolute allocation path, load the whole F53 inventory and pass its revision to the existing locked `allocateInventoryFile`. That existing function rereads the inventory under its exclusive lock and checks the supplied revision before atomic whole-file publication. Other-run occupancy now participates in the unchanged F53 UUID/wholesaler collision checks. The regression at test lines 241-249 constrains the wholesaler space to one run's exact capacity, then proves a second run exhausts without changing either the retained file or first-run stock.

2. **Nested aggregate record retention: resolved.** Exact shapes now apply to lead-time range (line 14), delivery spread (88), cash-price band (90), weekly volume (135) and cadence/slot records (50-53). Share values must be finite numbers (15-16), excluding nested records. Policy provenance uses an explicit top-level projection (130-131). Tests at 252-260 inject nested car records into each aggregate dimension and require invalid outcome, zero stock and identical allocator bytes. The old raw root/nested record mechanism is closed.

## Replay and publication correction

The generator computes a canonical request digest from generator/run/seed/policy/plan/account and the pinned run clock (116-117). Already-generated matching requests return the stored report without reallocating (118-121); changed requests conflict before allocation. Planned vehicle identities include that digest (172). Before allocating an unfinished request, retained generated stock is checked against the planned complete vehicle set, seed, corpus and dataset (186-190). Failed stock publication keeps valid F53 reservations separate from stock state; an identical retry reuses them, while a changed request conflicts. The expanded rollback regression (169-188) asserts the reserved count, unchanged inventory on changed request, successful identical retry and byte-stable reservation reuse. The original F81 transaction still commits all stock rows and the run/report update together (217-231), and its actual repository implementation rolls back non-ok outcomes.

No further actionable defect found in these corrections. Release/delivery algorithms, deterministic Hamilton distribution, immutable registry reads and fixture/observed authority distinction retain their earlier scoped assessment. Replay equality intentionally includes the pinned clock: changing the run clock is a changed request. The configured allocator path remains trusted server composition and must refer to the one authoritative retained inventory in actual integration.

NOTE: the earlier low-priority malformed-plan hardening observation remains: `validPlan` dereferences configuration rows at line 77 before their object-shape check at line 80, and executes before the catch at 106. A trusted plan containing null may throw rather than return invalid. This is unchanged composition hardening, not a reopened finding against the reviewed corrections.

Validation evidence reused: parent-reported supervised `green-allocation-replay` 9/9 passing tests, 2,082,016 bytes measured scratch removed, overlay removed and no leftovers. No identical rerun was performed. This review allocated no scratch or child process groups; its only retained artifact is this small Markdown note.

Limits remain explicit: actual accepted F77 source plan/configuration coverage, live locator sampling, canonical observed-aggregate validator/seed publication, native PostgreSQL and F85/F92 runtime composition, and final authored npm suite are not established by this checkpoint or review. A focused code-review pass is not full FUCQ-78 acceptance.

VERDICT: passed

## Final identity addendum: malformed-null-plan hardening

Read-only review of the two subsequent changes: `validPlan` now reads `row?.configurationId` in its uniqueness map; the subsequent `object(row)` predicate safely rejects null before field dereference. The existing missing/unsupported-data test now supplies `configurations: [null]` and asserts the returned status is `invalid`. This resolves the previous nonblocking hardening note without changing the allocation, privacy or replay behavior already reviewed. No additional finding.

Final SHA256 identities independently read from current files:

- Generator: `2a141a9745d75e0759c7c5dc28fc1572a4b1351c2aed71fa835f5d1dd894f9ac`
- Tests: `631284cc51e2a7434816b70eb61f46cdd0d734fb99875963e0730f472c8c4e05`

No tests, Git operations, scratch or descendants were used for this addendum. The parent's supervised `final-generator` run was in progress when the changes were reviewed; this addendum makes a code-review claim and does not invent its result. All F77/live/canonical/native/runtime/final-npm acceptance limits above remain in force.

VERDICT: passed

Final validation update: parent confirmed supervised `final-generator` **9/9 passing** for the exact final SHA256 identities above, matching this review's independent identity read. Receipt is retained under `/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-resume-20261106/lead78/generator-checks`. The null-plan note is resolved; no new findings. No reviewer test rerun was needed.

VERDICT: passed
