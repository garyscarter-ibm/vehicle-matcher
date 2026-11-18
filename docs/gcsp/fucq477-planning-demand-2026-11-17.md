# FUCQ-477 PostgreSQL planning demand (2026-11-17)

This is a partial increment of original FUCQ-477 acceptance, initially authored without execution. Only DemandCohort, PostgresDemandSnapshot and their tests are integrated here; the live adapter and its test remain on the source branch. Selected validation is recorded below. It ports Node `createExpressedOrderForecastProvider` (`server/gcsp/predict/plan/forecast.js`) to Java, so Greg's order plan can read demand from saved confirmed briefs. Story completion is still open: see "Remaining".

## Files
| File | What it is | Author |
|---|---|---|
| `planning/DemandCohort.java` and `DemandCohortTest.java` | The pure cohort loop: the current brief, the employee/slot/renewal link, the renewal instant, and the horizon and already-selected exclusions | Hugh (implementer) |
| `planning/PostgresDemandSnapshot.java` and `PostgresDemandSnapshotTest.java` | The seven demand tables from one read-only REPEATABLE READ snapshot, in Node field names | Dibble (implementer) |
| `planning/PostgresPlanningDemand.java` | The `PlanningDemand` adapter and its persistence-gated `Wiring` producer | Claude coordinator |
| `planning/PostgresPlanningDemandTest.java` | Adapter cases over scripted rows, clock and evaluator, with the real seed catalogue | Mushu (implementer) |

The paths are under `services/gcsp-api/src/{main,test}/java/gcsp/api/`. The interface was frozen before the build, in `.claude/results/fucq477-demand-interface-12.json`.

## How it decides (as Node)
- **Guards:**
  - Missing ports or policy give `planning-future-choice-evaluator-not-configured`.
  - A bad read gives `planning-forecast-read-invalid`.
  - A clock instant other than `asOf` gives `planning-forecast-clock-mismatch`.
  - A catalogue for another run, policy or instant gives `planning-forecast-catalog-mismatch`.
- **Cohort:** the latest confirmed brief per employee, sorted by employee id.
  - The renewal comes from the exact slot when the employee row has none.
  - A missing link gives `planning-forecast-entitlement-missing`, and a disagreeing one gives `planning-forecast-entitlement-mismatch`.
  - A missing contract end gives `planning-renewal-unconfirmed`. The renewal is UTC end of day, from `PlanningRenewal`.
- **Exclusions:**
  - A renewal after `horizonEnd` is `outside-horizon`.
  - An allocated hold on allocated stock for the same employee, slot and renewal is `already-selected`.
  - Both are recorded in `provenance.excluded` and never evaluated.
- **Evaluation:** each member goes to `FutureChoiceEvaluator` and its result is checked as Node checks it. A refusal passes through, and a bad result gives `planning-future-choice-evaluation-invalid`.
- **Double read:** the rows, clock and catalogue are read again after the evaluations. Any digest or clock change is a `conflict` (`planning-forecast-changed`).
- **Versions:** `version` and `cohortVersion` are `CanonicalJson.digest` over the same inputs Node digests.

## Deviations from Node (recorded in the interface)
- **D1:** Java briefs store no slot, so a brief carries its employee's membership slot.
- **D2:** Java decisions store `versions.briefVersion`, so the snapshot also exposes it as `versions.brief` for the evaluator.
- **D3:** Java employee rows carry no roles. A row in `employees` is the employee membership.
- **D4:** `PlanningDemand` has no Principal. `OrderPlanService.readPlan` checks the greg role before and after, and the evaluator gets a greg Principal for the run.
- **D5:** Node's opt-in `predictionContext` has no Java consumer and is not produced.
- **D6:** an inactive run, where the snapshot is null, gives `planning-forecast-read-invalid`.
- **D7:** Java cart holds store no renewal: `ManualClaims` writes no hold attributes. The snapshot gives such a hold its slot's renewal, or null when the slot has none, as Node's manual claim does with `slot.renewalId ?? null`. A stored `renewalId`, including JSON null, is kept. Without this, a manually selected car was never `already-selected`, so planning counted its employee as demand again (the review's MAJOR finding).

## Binding
`PostgresPlanningDemand.Wiring` produces the adapter when persistence is active, otherwise `PlanningDefaults.UnconfiguredDemand`. This is the same pattern as `PostgresPlanningSupply`.

**Once compiled, the producer is live:** with persistence on, the order plan gets this adapter and the real evaluator. So it must not be merged into a shared branch or claimed complete yet. Two things hold it back:
- The Supply and Clock hold, FUCQ-515 (M1): hold expiry is on wall time while the planner is on the run clock.
- Original connected order-plan acceptance remains unproved; the selected validation below does not resolve the clock discrepancy.

## Selected validation and integration boundary

At source `76837ffe8165210adaf34b4d5a1fb62c4c3cb09b`, the Codex dispatcher executed one finite native PostgreSQL test chunk: all 19 DemandCohortTest, 11 PostgresDemandSnapshotTest and 22 PostgresPlanningDemandTest methods passed, with zero failures, errors or skips. The manual-selected employee regression passed against PostgreSQL. This source was independently reviewed by Mike Wazowski; the original major finding was corrected in the snapshot reader before execution. Hugh authored the cohort, Dibble the snapshot, Mushu the initial adapter tests, and the same Claude coordinator authored the adapter and the review corrections.

This integration copies the exact four tested cohort/snapshot Java blobs. Every pre-existing service file and build input matches the tested source; the only omitted service additions are the explicitly held Demand, Supply and Clock classes and their tests. Neither helper is a CDI bean or producer, has a static initializer, or refers to those held classes. They introduce no live binding. The 30 matching helper passes are reused without another runtime; the other 22 adapter passes remain evidence for the held source.

Run `20261117T040413-fucq477-demand12-db` exited 0 in 27.2 seconds. Parent audit confirmed unchanged pins, all recorded processes/groups absent, scratch removed, reservation released and retained output under its limit. The audit is retained locally; no connected HTTP or rendered acceptance is claimed.

## Remaining

The live PostgresPlanningDemand adapter, Supply and Clock remain outside shared integration under the existing M1/FUCQ-515 hold. Original equivalent order-plan outcomes with connected real demand and supply remain Story work; selected helper validation does not complete the Story.

The independent review's optional fixture-shaped real-evaluator case was not selected. Catalogue guards are defensive with the existing echo catalogue. The explicit-null assertion uses a slot without renewal and therefore does not independently distinguish fallback to null; the implementation preserves a present stored null. These coverage limits remain recorded without adding acceptance gates.
