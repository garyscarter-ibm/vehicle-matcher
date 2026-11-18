# FUCQ-477 policy future terms port (2026-11-16)

Standalone partial increment, originally authored without execution. Story points for this increment: 2. Selected native validation is recorded below.

## What it ports

`createPolicyFutureTermsProvider` in `server/gcsp/predict/plan/terms.js`: the canonical monthly points and
allowance for one employee and one configuration, valid from the read instant to the planning horizon, quoted
as employee-scheme terms with `synthetic-scenario` provenance. It is a standalone class. It has no CDI
annotation, is not a bean, has no default and is wired nowhere. It adds no future-choice evaluator, forecast
binding or renewal-policy change.

## Files

- `services/gcsp-api/src/main/java/gcsp/api/planning/PolicyFutureTerms.java` (new)
- `services/gcsp-api/src/test/java/gcsp/api/planning/PolicyFutureTermsTest.java` (new)
- this note (new)

No existing file was edited (`Vehicles`, `PolicyService`, `Prepare` and the CDI defaults are untouched).

## Node to Java mapping

| Node | Java |
| --- | --- |
| `createPolicyFutureTermsProvider({ policy })` | `new PolicyFutureTerms(PolicyService)` |
| `readFutureTerms(context, request)` | `readFutureTerms(RunContext, PlanningRead, JsonNode request)` |
| `request.read` | `PlanningRead` (asOf, policyVersion, horizonEnd; run from its `RunContext`) |
| `unavailable(code)` | `Outcomes.unavailable(code)`: status, code, contractVersion `1.0.0` |
| `text`, `instant` | `Js.text` and `JsTime.parse` rules (same as `PlanInput`) |
| `policy.getPointsCost / getAllowance` | `PolicyService.getPointsCost(PolicyContext, car, PolicyRead)` and `getAllowance(PolicyContext, PolicyRead)` |
| `createEmployeeTerms` | private `employeeTerms`: same checks and key order, `contribution` null, `kind` `employee-scheme` |

Refusal codes are unchanged: `planning-future-terms-not-configured` (no policy service),
`planning-future-terms-input-invalid` (run mismatch, blank or over 512 character policy version, invalid asOf or
horizon, missing employee, brief, catalog version, configuration id or facts) and
`planning-future-terms-unavailable` (any non-ok points or allowance read, a policy answer carrying another
version, or any exception while building the terms).

The car passed to the price lookup holds only facts with status `known`, then `configurationId`. No default is
invented for an unknown or absent fact; the price read then reports not found and the outcome is unavailable.
The `PolicyContext` takes company, scheme and grade from the employee and the run from the context. A
non-string identifier becomes null, which the policy refuses (Node passes the raw value, which also never matches).

## Semantics that differ, and why

- `readFutureTerms` is synchronous. The Java policy reads are synchronous, so the Node `Promise.all` has no equivalent.
- The Node `read` is one object; Java uses `PlanningRead` (which already carries the `RunContext`). The policy read
  rebuilds `PolicyRead(runId, asOf, policyVersion)` from it.
- `entitlementSlotId` and `roles` are Node context fields with no `PolicyContext` slot. The policy never reads them.
- Terms validity uses the planning `JsTime` rules, then the strict vehicles date (UTC, `Z`, optional three digit
  millis). An offset instant such as `+01:00` passes the read check but fails the terms check, so it is
  unavailable, exactly as in Node.
- Absent `renewalId` or `briefVersion` is omitted from the value (JSON drops Node's `undefined`).

## Selected validation, 17 November 2026

All 15 `PolicyFutureTermsTest` methods passed in the finite native run at source `bd8204652071cc343d6d6c947c64421318c14bcd`, with native exit 0 and no failures, errors or skips. This confirms the selected seed-policy and stale-version cases, including the constructor assumptions recorded during authoring. The class and test blobs are unchanged at source `96cf69785424838a02c439f00aed1d71ee0f982b` and in this integration; existing dependencies and policy fixtures also match.

The standalone FutureChoiceEvaluator and PlanningRenewal increment contributes 38 matching native passes. The combined 53 passes cover these three classes and their authored tests. They do not establish connected journey acceptance. No new screenshots are required for this unwired class; user-visible presentation and connected acceptance remain Story work.

Supply/Clock wiring remains outside this integration under the known M1/FUCQ-515 hold. No existing class, policy value, default or CDI binding changes here.
