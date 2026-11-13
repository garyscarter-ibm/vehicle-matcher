# FUCQ-412 eligibility compilation delivery

B-Bot leads DEV-2026-11-13-GC-005 on `dev/DEV-2026-11-13-GC-005`, claim `3b8820c8`. The dispatcher owns queue, Jira, guarded publication, integration and closure. This record preserves the original four acceptance criteria; it does not change native status or establish acceptance.

## Scope and plan

Five points, unchanged. Internal `PolicyService.getEligibility` compilation only, with semantic and bounded-operation regressions. The existing PolicyService port/public outputs remain the contract for concurrent allocation work. No provider, seed, publication, pricing, allowance, allocation, recommendation, repository, frontend, build or schema changes. Verified product association: `policy` / Scheme policy and assumptions.

Stable slices: `eligibility` (compile immutable eligibility and prove exact semantics/version boundaries), then `integration` (lead affected-consumer and connected presentation validation). AC1–3 belong to eligibility; AC4 remains a required connected gate. The source currently snapshots and deeply freezes provider inputs; pinned rows are effective at version start, whereas unpinned reads evaluate their actual date. Cache identity must follow that internal immutable snapshot and relevant row context, not a version string shared across runs or external mutable identity.

Technical readiness: existing `server/gcsp/policy/index.js#getEligibility` has the complete agreed input/output interface and no missing prerequisite. FUCQ-434 frozen product `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38` and replacement contracts are binding. FUCQ-413 must wait because it shares this source file. FUCQ-409 allocation source is outside this branch ownership.

## Selected validation before allocation

Changed boundary maps to `gcsp-policy-service.test.js` (exact decisions/provenance/failures), `gcsp-policy-versions.test.js` (activation/pins/reset/providers), `gcsp-policy-consumer-adoption.test.js` (composed policy activation/readback), and narrow F412 semantic/operation regressions. Select one module per supervised chunk using `node --test --test-concurrency=1`. Inspect actual changed callers to select an existing composed allocation/release test, then record its scope before running. No full suite is planned: this preserves a typed internal result, and broader testing needs a concrete reason. Native PostgreSQL is required only for applicable provider paths; unavailable/skipped cases remain explicit. Fixtures/build/source inspection do not satisfy connected acceptance.

No new UI is introduced; reuse the current screens, `COMPONENTS.md`, `docs/gcsp/screens/README.md` and `docs/gcsp/experience-quality.md`. The original connected release/offer/history inspection at desktop and narrow widths includes no-match and conflict/replay. It is not waived by isolated-computation evidence or by the absence of new screenshots.

## Resource ownership and agents

Retained local receipts: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq412`. Existing `_tools/test_resources.py` owns scratch manifests outside each scratch root, host reservations, process-group finalization, time/RSS/disk sampling and filesystem-removal evidence. One worker, initial chunk no more than 2 GiB scratch/ten minutes; expected focused Node module below 64 MiB scratch/512 MiB RAM. Keep a 5 GiB emergency reserve, reduce chunks near 30 GiB. TMPDIR/TMP/TEMP point to owned scratch. Output at least 256 MiB goes directly to configured OneDrive; none is expected. Preserve source, dependencies and worktrees.

Lead B-Bot: requested/selected `gpt-6.1-sol` / `high` from dispatcher; runtime-verified in own turn_context. Title saved as B-Bot in chat `01a1d6d2-0f68-75a2-a2d8-058a471a89b5`; gateway PASS (`api.servicesessentials.ibm.com`). Implementer Melissa Duck: requested/selected `gpt-6.1-sol` / `medium`, no fallback, one slice and no descendants; title Melissa Duck saved in chat `01a1d6d3-fe96-7ee1-88f4-60c030165e2a`; runtime `gpt-6.1-sol` / `medium` verified. Capacity before spawn: can_start=1, running=7.

## Current evidence

The implementation adds a private WeakMap keyed by the service-owned validated, deeply frozen seed. Each seed retains finite effective-row boundaries and lazily compiled interval indexes. Direct scheme/grade/model lookup retains independent rule-table and link-table ordering, exclusion precedence, exact original assumption/rule/link provenance, invalid-context precedence and result cloning. Unpinned reads select their actual interval; pins select the version-start interval. A new snapshot with a reused version label has a different seed identity. Public ports and other typed methods are unchanged.

Lead reviewed change statistics, full diff, callers and semantic edge cases. Focused service checks passed 21/21; new semantic/date/reset/operation regressions passed 5/5. Source SHA-256 `d7d9838f78e6c288ad88056579d7a80426ca9362a4cd9f546127e21ba7e78201`; new test SHA-256 `39a1528e9848dae909229a55d60aeb9bcfc4a6d8917cdb579347033e8e30fee3`. Targeted receipts live under `fucq412/lead`; they are scoped evidence, not a full-suite stamp.

Bounded regression: first compile visits 8 rule entries and 14 link entries; 64 repeated pairs leave counts at 8/14. A second effective interval raises cumulative visits to 14/26; 32 further pairs leave them there. Running the same regressions against the unchanged original source passes four semantic tests and fails the operation case as expected: 7/9 initial visits become 295/489 after 64 pairs. No production diagnostic interface was added.

The prescribed versions module ran as written: 12 passed, one failed, three native PostgreSQL cases skipped (`GCSP_DATABASE_URL` unset). The failure is `additive migration discovery retains existing 0001 and 0003 and includes dated policy tables`, line 205/208: expected IDs stop at 0008; actual includes 0009. No migrations changed. The identical limitation is historically recorded in `presenter-release-db-diagnosis-2026-11-11.md`; fresh baseline reproduction is assigned to The Brain. This failure is not hidden or repaired in F412.

Implementer history retained: missing-pg import attempt executed zero tests; two first-pass operation visit allowances were too tight (4 passed/1 failed each), then corrected; final semantic and bounded-operation assertions pass. Seven implementer scratch roots are removed, reservations released, measured maximum scratch 966,784 bytes and sampled RSS 183,975,936 bytes. Two manifest-owned dependency symlinks remain temporarily for subsequent lead/runner checks; parent removes them after final validation.

The Brain is running read-only integration-baseline verification, consumer-adoption and composed allocation checks, then current local connected rendered inspection. Requested/selected `gpt-6-luna` / `high`, no fallback; saved title The Brain, chat `01a1d6db-5e8f-7423-8571-5be202853f80`. Connected acceptance, final map-slice completion, Bug routing and final cleanup remain open at this checkpoint. No built/accepted/Done or hosted delivery is claimed.
