# FUCQ-483 independent review — 18 November 2026

Reviewer: Mater, requested/selected/runtime-confirmed `gpt-6.1-sol` with `high` effort, IBM Global; no fallback or descendants. Existing roster supplies runtime confirmation; saved desktop title was not freshly verified. Source and retained-artifact review only: no tests, app/browser, database, dependency installation, product edits, Jira or Git writes. No OneDrive access.

## Decision

**Scoped source/security review: passed. Overall Bug acceptance: partial/red; integration remains held.** No actionable defect was found in the allocated engagement-fixture repair. The original criterion that the lifecycle journey passes is still unmet. A clean repair of its initial refusal does not establish a green lifecycle regression or provide merge/Done authority. Parent's dev-inbox hold is consistent with the evidence.

## Scope and identity

Reviewed worktree: `/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-16-001`, base/claim `6c5b656379f9478172ee95502c48fb3affb21488`.

Reviewed exact current and tested SHA-256 identities:

| File | SHA-256 |
| --- | --- |
| `server/test/gcsp-lifecycle-e2e.test.js` | `ec4bd3fecbe91f296b4e509c154ce0a6aaa8a7f842918bb7d2515544fd53be76` |
| `server/test/helpers/gcsp-journey.js` | `fe556b8287fb2e1b8b2fdec4c9fe2ea75a5e1b94e84f1d9d6ae636b2a6eddba0` |

The Bug retains its two original unchecked criteria: meet the current engagement contract **and pass** the lifecycle journey; determine whether a product route unexpectedly hits this refusal and raise one separately if established. Dispatcher allocation allows the local fixture plus the optional shared-helper callback seam. Product gate, policy, Account and Angular sources remain diagnosis-only, with F441 ownership preserved. This review adds no acceptance gates or unrelated repair scope.

## Source and security assessment

`saveLifecycleBrief` reads `brief.accountPreferences.v1` through PolicyService, supplies Body plus the required number of canonical stop categories at their registered opening value and medium importance, and preserves the existing seat and charging-essential variants. The explicit category-count assertion and authoritative editor readback require the fixture to satisfy the actual gate. Draft and confirmation use the real HTTP routes, expected versions, employee sessions and explicit consent. No server gate, role boundary, validation rule, policy or product response is weakened.

`walkPaulasPath` changes only its optional destructured callback default and the two awaited brief-save calls. The original exported `saveBrief` body is unchanged. Both lifecycle paths opt into the local callback; default consumers in `gcsp-critical-path.test.js` and `gcsp-brief-after-accept.test.js` pass no callback, so source behavior remains the original default. Those consumers were inspected, not rerun. No input is used as executable code; the test-only seam adds no product exposure or persistence boundary.

No rendered UI or user-visible product behavior changes in this checkpoint. A new visual critique is not applicable to this test-fixture diff. This does not substitute for any visual evidence required by a future product repair.

## Retained validation and residual diagnoses

Reviewed the before/after receipts, corrected input hashes, bounded failure log, ownership evidence, final cleanup record, durable validation review and partial Bug Result. The corrected identities above match the receipt and current files.

| Saved run | Result | Supervisor duration |
| --- | --- | ---: |
| Unchanged lifecycle | 79 total; 20 pass, 13 fail, 46 skipped | 77.497 s |
| Corrected lifecycle plus Buddy engagement | 102 total; 58 pass, 10 fail, 34 skipped | 79.765 s |

The corrected run includes Buddy engagement **23/23 passing** and lifecycle **35 pass, 10 fail, 34 skipped**. All four previously refused engagement setup sites pass. Node includes failing parents in the failure total; five distinct leaf failures remain. These results prove the scoped engagement repair, with downstream skipped steps unproven. Full suite remains deferred to the parent covering batch; no green batch is claimed. The changed fixture and unchanged gate own the selected runtime boundary; reviewer ran no additional runtime.

The retained residual diagnoses are supported by the inspected source and failure evidence:

1. Two actor-input equality failures predate this repair. Their diffs add Greg's manual profile/contracts, entitlement and renewal fields with versions/timestamps; they are substantive mutations, not a `createdAt`-only mismatch. `identity/http.js` invokes employee preparation whenever the switched server context includes `employee`, and runtime wires it to `seedManualDemoContext`. Preparing needed actors before an immutable snapshot is a plausible separate fixture repair; it was not applied or validated here.
2. The baseline Greg readiness case expects 409 but receives `503 handover-readiness-unavailable`. `DocumentsService.#employeeOrOperator` tries `employee` before `greg`/`presenter`, then enforces employee ownership for readiness. `AppointmentService.complete` maps a non-ok readiness read to the observed unavailable response. Dual-role Greg therefore has a concrete separate product-route diagnosis; separate Bug intake/repair remains with the parent. The engagement repair does not fix it.
3. Both newly reached Buddy paths stop at `helpers/gcsp-journey.js:225` because the helper reads `.allocations.find(...)` from a clock outcome. Allocation clock registration explicitly requests `consumeTriggers(context, { summary: true })`; detailed allocation reads remain distinct. This supports a previously masked test/contract-shape mismatch. No later scoring, tie-break or lifecycle assertion is established by those stopped paths. No assertion was weakened to hide it.

## Bounded unexpected-engagement audit

The fixture now succeeds over the actual legacy draft/editor/confirm composition. Independently inspected Account controller engagement queue/readback guards, Angular store remaining-category guards, the editor's versioned `engagementGate` and `legacyWrite`, and the service's command/version/gate checks. These support Hugh's bounded conclusion: no unexpected **engagement-minimum** route was established. Sparse direct confirmation is intentionally refused by the existing contract and green Buddy tests. This is source/retained-composition evidence, not exhaustive rendered UI, native-Java parity or live-provider proof. Greg's distinct readiness-route problem is separately retained.

## Resources and handoff

Reviewer created only this small retained report: no scratch allocation, no runtime children, **0 B reviewer cleanup**. Worker receipts show peaks of 12,448 B scratch and 595,279,872 B RSS for baseline, then 12,448 B/561,233,920 B for corrected runtime. Outer removed bytes are **0 B**, because inner fixtures had already removed transient files; peak allocation is not substituted for deleted bytes. Both receipts report scratch absent and no cleanup issues. `final-cleanup.json`, observed `2026-11-18T02:03:16.367962+00:00`, records the exact owned scratch and worktree-only dependency symlink absent, no leftovers and no OneDrive access. Existing dependencies are preserved.

Parent retains integration, residual Bug intake, claim lifecycle and acceptance authority. Hugh can replace the pending-review line with this scoped assessment while preserving partial/red status and original criteria.

VERDICT: failed
