# Database refactor and Angular/Java migration alignment

**Current Jira direction, 13 November 2026:** after requesting publication, Gary explicitly lifted the wider Jira-write pause (“You can stop the wider pause too”). Earlier pause statements below are historical. Current shared policy is in `AGENTS.md`, “Jira updates resumed”. This does not start implementation or amend existing FUCQ-408 acceptance.

Gary requested alignment and a priority call on 13 November 2026 while refining the [migration Stories](angular-java-migration-stories-2026-11-13.md). This is a read-only assessment and delivery recommendation. Jira writes remain paused; no existing Story is reparented, revised, claimed, accepted or closed, and no implementation is started.

## Recommendation

**Settle the database design before implementing the Java repository, then deliver the relevant persistence work with the Java backend.** Start E1's API/static-hosting design and Angular foundations alongside it. Do not make completing the full Node database/performance refactor a prerequisite for the migration.

The relevant published work found is [FUCQ-408 — Improve GCSP matching and release performance](https://ibm-consulting.atlassian.net/browse/FUCQ-408), raised by Russell, with Stories FUCQ-409–425. FUCQ-419–425 cover selected SQL reads, trigger consumption, freshness, explicit writes, scoped hydration and evidence batching. The remaining ten cover allocator/recommendation computation. Reuse these defined objectives and behaviour cases rather than commission a competing refactor.

These improvements substantially overlap the Java implementation. Completing every Node-specific mechanism first, then replacing its repository/runtime, would repeat effort. Conversely, a literal Java port of the current broad snapshot/fingerprint/diff approach would carry known scaling work into the replacement. Use the existing backlog to inform the target design now, and carry only the necessary implementation/validation into the responsible Java slices. Defer optional tuning that is not needed for the agreed workload; retain its existing backlog scope.

## What the current evidence establishes

Read-only native Jira retrieval on **13 November 2026, approximately 20:12 UTC**, found FUCQ-408 and all **17 children FUCQ-409–425**, with complete child descriptions and `isLast: true`. The Epic and children were **To Do**; children were unassigned. These are timestamped Jira observations, not an active-worker/lease audit or authorization to pick them up.

Queries: `project = FUCQ AND issuetype = Epic ORDER BY created DESC` and `project = FUCQ AND parent = FUCQ-408 ORDER BY key ASC`. A targeted database/persistence/repository/schema summary search also found the related existing defects and foundation work. No differently named newer database Epic appeared in the FUCQ Epic inventory. The [12 November publication record](performance-tuning-stories-2026-11-12.md) supplies the original split, estimates and link audit; this assessment does not repeat that publishing work or certify the whole current Jira relationship graph.

Source read at **`a54a546b3874e633e5f66ab4b6106c14cc67dab7`** confirms the remaining structural overlap:

- [PostgreSQL freshness/snapshot queries](../../server/gcsp/repository/postgres.js) still build count/sum(version) fingerprints across foundation tables and provide a full-run snapshot path. Selected reads already exist and must be credited.
- The same backend's write path hydrates a complete run on a cache miss and discovers changes by traversing tables/rows, although unchanged immutable rows already avoid rehashing. This is not the earlier deep-copy implementation or evidence that every request reloads everything.
- Evidence hydration currently looks up each distinct referenced digest separately. [Repository core](../../server/gcsp/repository/core.js) retains command receipts, version/authority checks and transactional reset semantics that the new backend must preserve.

No timing, memory, query-plan, database-outage or native PostgreSQL acceptance claim follows from these text reads. The historical performance diagnoses are inputs, not fresh measurements of the Java replacement.

## Priority relative to the migration

| Order | Work | Relationship to E1–E3 |
| --- | --- | --- |
| **1 — Target design now** | Reconcile repository responsibilities, retained data identities, transaction/concurrency rules, targeted query/write strategy and required indexes. Map FUCQ-419–425 before fixing the new schema/access layer. | E1.S01 and E3.S03 design. E1 transport/hosting and E2 Angular shell work can proceed against an agreed API without waiting for every database optimization. |
| **2 — Java persistence foundation** | Implement the smallest coherent Java/PostgreSQL repository for the first account/Buddy journey. Use authoritative scoped SQL operations and necessary indexes; preserve atomic receipts, versions, exclusivity and reset isolation. Avoid making full-run load/diff the default for small commands. | E3.S03 before transactional claims/decisions/order slices rely on it. FUCQ-421–423 provide freshness/write-set objectives, with Java-appropriate implementation choices. This is not a requirement to build a Node mutation journal first. |
| **3 — Buddy integration and relevant bounded improvements** | Add selected trigger/receipt reads and safe pending-work processing as those Java paths are introduced. Bound evidence retrieval used by the journey. Carry simple calculation/index improvements with the affected port where justified by the implementation. | E3.S06/S08–S11/S26, aligned with FUCQ-409–425 as mapped below. Preserve full candidates, decision parity and recovery. Continue without interim human review gates. |
| **4 — Hosted acceptance before final review** | Measure existing scenario/comparison sizes with a few simultaneous demo users on the selected Render resources. Resolve work actually required for usable journeys, correct persistence and bounded memory. | Integrated E1–E3 validation, including E3.S27/S28. A confirmed capacity/correctness failure needs resolution or an explicit scoped disposition; unrun checks remain open. Do not require every optimization merely because the Epic exists. |
| **5 — Remaining tuning independently** | Independently prioritize optimizations not required for migration acceptance, or Node improvements still desired for the separately running old app. | Preserve FUCQ-408's native scope and status. No automatic cancellation, duplicate implementation or Done transition; any change of its Node-specific acceptance needs explicit collaborator reconciliation. |

The meaningful dependency is **agreed persistence contract/design → Java transactional implementation → connected journey/recovery proof → hosted workload acceptance**. There is no dependency from every Angular screen or the static/API split to completion of all 17 performance Stories.

## Story-by-Story overlap

The timing below is a recommendation for alignment, not a new mandatory acceptance criterion for every migration Story or an amendment to Russell's Stories.

| Existing Story | Existing outcome | Migration alignment and recommended timing |
| --- | --- | --- |
| FUCQ-409 | Direct order-ID lookup of allocation stock | E3.S08/S11: use exact-identity lookup while implementing allocator traversal; preserve deterministic order and existing blockers. No Node-first prerequisite. |
| FUCQ-410 | Indexed decline/offer/prior-brief history | E3.S11/S13: design lookups around the same exclusion/reopen/provenance rules; add bounded-history evidence with the affected Java flow. |
| FUCQ-411 | Identity Sets for allocator occupancy | E3.S11: carry efficient traversal with authoritative transactional claims. Sets are an implementation aid, not a substitute for database exclusivity. |
| FUCQ-412 | Immutable eligibility lookups | E3.S04/S08: design versioned policy reads early; implement relevant lookup reuse with calculation parity. Do not weaken unknown/exclusion handling. |
| FUCQ-413 | Immutable price/allowance lookups | E3.S04/S08: align alongside policy/quote implementation, retaining ambiguity and first-effective-context-match semantics. No artificial dependency on FUCQ-412. |
| FUCQ-414 | Reuse validated immutable stock snapshots | E3.S06/S08/S09: avoid repeated graph materialisation where appropriate; preserve exact stock identity and employee/operational separation. |
| FUCQ-415 | Reuse equipment evidence | E3.S06/S08: carry complete relevant fact/policy signatures if reuse is implemented. Cache expansion remains independently prioritized if not needed for acceptance. |
| FUCQ-416 | Score current car once per evaluation | E3.S08: straightforward alignment during Java calculation work, with the same feedback/baseline and candidate order. |
| FUCQ-417 | Compact allocation evaluation without gallery construction | E3.S08/S11: establish the calculation/presentation boundary before wiring allocation to Java. Preserve full fallback candidates and detailed attempted-claim quotes. |
| FUCQ-418 | Reuse unchanged static suitability across releases | E3.S08/S11: follows an actual agreed static/dynamic boundary. Add only as needed/independently prioritized; always recheck time, permissions, declines, availability and occupancy. |
| FUCQ-419 | Indexed, bounded trigger/receipt reads | E3.S03/S11/S26: target design early, implementation with the first relevant Java receipt/trigger path and native SQL evidence. Existing selected-read support is a starting point. |
| FUCQ-420 | Consume new/changed/pending triggers without repeated full-history replay | E3.S09/S11/S26: implement against the selected-read/consumption contract after its real interface exists; preserve pending-first recovery, digest validation and replay conflicts. |
| FUCQ-421 | Transactional run revision for freshness | E3.S03: decide freshness before dependent writes. If Java retains cached projections, their invalidation must be transactionally reliable; a direct authoritative-query design need not reproduce the Node fingerprint-cache mechanism. Native Story revision/legacy AC remains unchanged. |
| FUCQ-422 | Explicit mutation journal | E3.S03: design changed-row tracking or equivalent explicit SQL updates before persistence consumers. Preserve automatic receipts, composed writes, reset, no-op/rollback/replay semantics; do not introduce domain deletion. |
| FUCQ-423 | Flush PostgreSQL from explicit mutation sets | E3.S03 and each transactional slice: persist actual changes without whole-run comparison as the normal small-command path. Native scope depends on FUCQ-422; Java can use its agreed explicit-operation equivalent. |
| FUCQ-424 | Scoped hydration for small receipt transactions | E3.S03/S11/S26: align with the first receipt operations after safe explicit writes exist. Preserve unselected state; do not require generic partial hydration of every domain command. |
| FUCQ-425 | Bounded batched evidence hydration | E3.S03/S06/S27: consider with selected artifact/history reads, bounding bytes as well as digest count. Implement where actual workload evidence requires it; independent of revision/write-set changes. |

The native technical chains remain **FUCQ-417 → FUCQ-418**, **FUCQ-419 → FUCQ-420**, and **FUCQ-422 → FUCQ-423 → FUCQ-424** (424 needs both journal and safe flush). FUCQ-421 and FUCQ-425 are independent of that write-set chain. These reflect descriptions and the existing publication record; actual Java interface readiness and current file ownership decide pickup.

## Scope and acceptance reconciliation

The migration allows a fresh isolated database and reset of legacy operational state. It does not require porting every Node cache, array, journal or legacy-row compatibility mechanism. Retain reusable source/reference/model/baseline identities and all required new-app transaction/restart guarantees.

FUCQ-408's current Stories explicitly reference Node files and Node validation, with legacy compatibility in several persistence scopes. Java implementation can share their intended outcomes, test cases and design findings, but **does not automatically satisfy those original acceptance criteria**. Record exact overlap and evidence when delivered; keep original claims/acceptance fixed unless a collaborator explicitly authorizes reconciliation. Jira's pause prevents applying native changes now. This assessment creates no duplicate performance Epic or replacement Jira Stories.

For affected Java persistence paths, validation needs native PostgreSQL commit/rollback, version/CAS, competing instances, unique occupancy, original-command replay, uncertain-commit/restart and reset-isolation evidence. For performance objectives actually delivered, retain bounded query/row/byte or operation evidence and equivalent results. Check the connected release/offer/history presentation under the experience contract. Database transaction rollback remains necessary; Gary's decision to omit old-deployment rollback does not waive transaction correctness.

Actual BMW database conventions, exact schema and additional platform standards remain to be supplied/reconciled. The Render development proof still uses its own PostgreSQL database. No live-environment database access, query execution, schema change, runtime test, timing benchmark or Jira write was performed for this assessment.
