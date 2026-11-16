# FUCQ-477 PlanningSupply PostgreSQL adapter (2026-11-16)

This is the first slice of original FUCQ-477 acceptance, about 5 points. It is not Story completion: PlanningDemand, the future-choice evaluator, is still missing.
New files:
- `services/gcsp-api/src/main/java/gcsp/api/planning/PostgresPlanningSupply.java`
- `services/gcsp-api/src/test/java/gcsp/api/planning/PostgresPlanningSupplyTest.java`

`PostgresPlanningSupply.Wiring` produces the `PlanningSupply` bean. With persistence active it is the adapter; with persistence off it is `PlanningDefaults.UnconfiguredSupply`, so the defaults profile is unchanged (supply04 found a plain bean shadowed the default).

## Where each Node row comes from

| Node `resolveSupplyRecords` input | Java source (writer) |
|---|---|
| `stock` | `stock_cars`: state, configuration_id and `attributes`. `StockRelease.release` writes `attributes.release{trancheId, windowId, supplyId, releasedAt, policyVersion, sourceVersion, availability{availableFrom,...}}`. `attributes.visibility` is copied from the stock pull |
| `holds` | `custody_holds` (slot_id becomes entitlementSlotId) |
| `future_order_requests` | `production_requests` joined to `production_submissions` (for command_id) |
| request `history` (delays) | `production_responses` rows in seq order; `details.delayUntil` and `details.reason` (`ProductionStore.applyAnswer`) |
| `confirmed_supply` | `production_confirmations` LEFT JOIN `confirmed_supply_queue` on supply_id |
| `event_receipts` (stock-released) | `stock_releases.outcome`, written only on success, so there is no consumer or state filter |

## Semantics that differ, and why
- **Held stock:** Java has no `held` stock state. A car is held when it has exactly one occupying `custody_holds` row; anything else is `planning-held-stock-unresolved`, as in Node.
- **Allocated stock:** a car counts as allocated, and is left out, when `stock_cars.state = 'allocated'` (Buddy conversion) or its hold is `allocated` (a manual claim leaves the car `released`; `ManualClaims` :772).
- **expectedAt and policyVersion:** both come from `confirmed_supply_queue` (eligible_from = confirmedAt plus the policy lead time). This matches Node's expectedAt rule.
  - A confirmation not yet queued into supply has neither value, so the read is `planning-confirmed-supply-invalid`. It is not dated or left out.
  - The queue row's confirmedAt and sourceVersion must equal the confirmation's.
- **Provider provenance:** Java stores only `provider_mode`. `provenance.provider` is `{mode}` as recorded; Node's providerId and label are not filled in.
- **Change detection:** the tables are read in two separate REPEATABLE READ read-only transactions, before and after resolution.
  - A different canonical row digest, or a different `PlanningClock` version, is `conflict planning-supply-changed`.
  - Each snapshot is self-consistent. The second read is what detects a commit in between.
- **Clock and policy:** the adapter does not require clock `now == asOf`, because `WallPlanningClock` moves while its version stays fixed (`OrderPlanService` already pins asOf).
  - The policy version is enforced through `PlanningCatalog.readCatalog`.
  - Greg's role is checked by `OrderPlanService` before and after, because the port is given no principal.
  - A run that is not the active run gives `planning-supply-read-mismatch`.
- **Versions:** `versions.stock` is the digest of the stock and hold rows; `versions.supply` is the digest of the requests, confirmations and receipts. The rows include each `version` column, so a CAS bump changes them. The digests are not byte-equal to Node's.

## Unrun
None of this has been compiled, tested, run in the integrated plan or run in the browser.
