# FUCQ-477: run-clock PlanningClock (2026-11-16)

## What and why
Stock release times, Production `confirmedAt` and response `at` are stamped on the presenter run clock. The only `PlanningClock` was `WallPlanningClock` (wall time, constant version `wall-clock`), so `PostgresPlanningSupply` compared run-clock stamps with a wall `asOf` and its version guard compared a constant. Node uses one run clock for both. `RunPlanningClock` makes Java do the same (review D1).

## Mapping
| Planning clock | Source |
|---|---|
| `Observation.now` | `RunClockHolder.clock().now(environmentId, runId)` `.now()` (`run_clocks.clock_instant`) |
| `Observation.version` | `ClockReading.clockVersion()` as a decimal string (`run_clocks.clock_version`) |

The read is one selected read that only returns the active run's clock, so environment, run and active-run authority stay in `RunClock`.

## Semantics
- **Persistence on (`RunClockHolder.available()`):** a run that is not active, has no clock row, or whose clock cannot be read throws (`IllegalStateException`, or `ClockUnavailableException`). `OrderPlanService` and `OrderPlanOperations` turn that into `planning-source-unavailable` or `order-plan-operations-unavailable`; the supply adapter turns it into `planning-supply-unavailable`. It never falls back to wall time.
- **Persistence off:** the same wall semantics as `WallPlanningClock` (`PolicyClock.now`, version `wall-clock`). No second policy authority is created; the `PolicyClock` bean is still the one source.
- **Binding:** `RunPlanningClock.Wiring` is a non-default `@Produces @ApplicationScoped PlanningClock`, so ArC drops the `@DefaultBean` `WallPlanningClock`. Test `@Alternative` clocks (`PlanningHttpSupport.FixedClock`) are enabled by profile and still win.
- **Supply adapter:** `PostgresPlanningSupply` now requires the start observation's instant (millisecond ISO) to equal `read.asOf`, as Node does, and requires the end observation to equal the start in instant and version. The `> now` checks on stock, confirmations, receipts and delays are unchanged.

## Differences from Node
- Node compares `time.value.runId` with the context run; Java's reader is keyed by the context's run, so that is implicit.
- The instant is compared at millisecond precision, because `asOf` is the policy ISO text.

## FUCQ-515
`PostgresPlanningSupply` judges each occupying hold's expiry against the clock that stamped it, so an advanced run clock no longer makes a fresh cart hold look expired.
- Cart hold (`hold_type='cart'`): expired when `expires_at <= ClaimClock.now`, observed once per read and truncated to milliseconds like `ManualClaims`. FUCQ-581 binds persisted claims and ordering to the scoped presenter run clock through `RunClaimClock`; persistence-off keeps `PolicyClaimClock`. The consumer still follows the `ClaimClock` port rather than substituting planning time.
- Buddy-offer hold: expired when `expires_at <= asOf` (the run clock), unchanged. Any other or missing `hold_type`, a missing expiry or slot, or more than one occupying hold stays `planning-held-stock-unresolved`.
- A claim clock that throws or answers nothing is `planning-supply-unavailable`, never a fallback. The claim instant is not part of the double-read conflict check.
- Existing `quote.validUntil` and hold `expiresAt` remain unchanged absolute instants. Their original wall-versus-run provenance is not encoded: FUCQ-581 does not guess a rebase, rewrite timestamps, reset state or claim to repair historical clock provenance. Existing expiry, explicit release and reconciliation compare those retained instants with the corrected scoped authority. Live deployment/cutover remains outside this local repair.

## Unrun
Compiled and run on native PostgreSQL in FUCQ-477 slice A (planning package plus `ProductionPlanCompositionTest`). Not run in the browser. `RunPlanningClockTest` needs no database; `PostgresPlanningSupplyTest` needs `GCSP_TEST_DATABASE_URL`.
