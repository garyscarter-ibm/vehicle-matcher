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

Lead B-Bot: requested/selected `gpt-6.1-sol` / `high` from dispatcher; runtime effort requires separate session evidence. Title saved as B-Bot in chat `01a1d6d2-0f68-75a2-a2d8-058a471a89b5`; gateway PASS (`api.servicesessentials.ibm.com`). Implementer Melissa Duck: requested/selected `gpt-6.1-sol` / `medium`, no fallback, one slice and no descendants; title/runtime confirmation pending. Capacity before spawn: can_start=1, running=7.

## Current evidence

Implementation and validation are in progress. No passing tests, connected review, acceptance or cleanup are claimed by this planning checkpoint.
