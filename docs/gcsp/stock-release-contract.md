# Stock pull and release — FUCQ-92

Isolated backend checkpoint, 5 November 2026. This implements the existing HLD stock-pull responsibility inside the existing backend. It adds no screen, store, queue, service process or live BMW connection. The source fixtures are explicitly small TEST FIXTURES; they establish neither FUCQ-78 synthetic stock delivery nor FUCQ-77 real configuration coverage.

## Composition and shared authority

`createStockReleaseService({ repository, policy, clock, identity, provider })` is exported from `server/gcsp/stock/index.js`. All dependencies are injected; no implicit memory store, source, policy defaults or environment exists. Call `service.register()` before DemoClock startup/ticks. It registers `stock-release` on the existing **`release-pull`** stage in `clock.handler.order.v1`. Startup excludes this stage. Calling register again on the same service returns its original registration.

The existing normal presenter tick is the explicit next-release cue. Each normal tick pulls the next eligible source tranche, with the policy size cap; advancing time alone releases nothing. The current clock command has no cue payload, so this checkpoint introduces no separate `next-release` HTTP command. A presenter UI can label the existing tick accordingly. Shared startup/HTTP wiring remains for coordinated integration.

The handler uses DemoClock's fixed `{ now, clockVersion }`, rechecks the current run and clock before committing, and calls its provided `transaction(work)` helper. The source pull happens outside that transaction; no network effect is hidden inside SQL work. Tick command replay, crash recovery and ordered receipt persistence remain DemoClock's authority. No clock, repository, migration registry or PolicyService implementation changes are required.

## Pull-provider port, version 1.0.0

```js
provider.pull({
  runId, asOf, eventId, policyVersion, releaseSize, leadTimeDays,
  released: [{ trancheId, orderUuids }],
  queuedSupply: [{ runId, supplyId, state: 'confirmed', confirmedAt,
    sourceVersion, eligibleFrom, policyVersion }],
})
// -> { status: 'ok', value: {
//   schemaVersion: '1.0.0', runId, observedAt: asOf,
//   source: { providerId, mode, version, label },
//   tranche: null | { trancheId, windowId, availableAt, supplyId: null | string,
//     orderUuids: [exactUuid] },
//   stock: [StockPullCar],
// }}
```

The result is the scheme's pulled visible stock list. A new release is the appearance of exact cars in that list, attributed to the reported tranche. It is never a pushed stock event. `released` and `queuedSupply` are persisted server-owned simulation inputs; a future target adapter can ignore the simulation inputs and report its actual list. A source failure is `unavailable`, distinct from a valid empty list with `tranche: null`.

`StockPullCar` carries exact UUID-v4 `orderUuid`, seven-character decimal `orderNumber` with leading zeroes, and unchanged opaque `configurationId`. Optional fields are `wholesalerOrderId` (eight-digit integer), positive `revision`, `account`, `visibility`, `agModelCode`, `vgModelCode`, immutable `facts`, `corpusVersion` and `availability: { availableUntil }`. Configuration source/constructibility assurance belongs to the existing immutable corpus/provider boundary, not this consumer. No VIN is accepted, including inside facts; no source state/hold/allocated flag or request/confirmation row is accepted as a car.

Root/source/tranche fields are allowlisted. Validation rejects duplicate exact UUIDs/display numbers, wrong run/observation time, missing/malformed tranches, future release windows and an unseen car outside the reported tranche. Source-provided expiry must still be future when a new car is released. Older visible rows may retain expired source intervals without becoming available again.

`createSyntheticStockProvider({ runId, version, label, windows })` is an offline, run-bound provider. Each window supplies `{ windowId, availableAt, supplyId: null | string, stock }`. It reconstructs prior visibility from committed receipts, selects at most `supply.release.size` previously unexposed cars in the next eligible window and returns the cumulative visible list. Tranche IDs are `<source-version>:<window-id>:<first-index>`; a smaller policy cap produces successive tranches rather than dropping cars. There is no mutable process cursor. Window instants are source data, not locally assumed weekly timers. The launcher's demo provider (`createDemoStockProvider({ policy })`) reads its windows from `supply.release.windows`, as minute offsets from the `clock.scenario.v1` release cue, so the presenter Next release always lands on its first window; a missing or invalid key is unavailable. The final FUCQ-78 adapter must provide the actual run's generated identities and window data, including after reset; the static TEST provider intentionally refuses another run.

`createStockPullFixtureProvider(readSnapshot)` implements the identical `pull(request)` method for a target-shaped snapshot fixture. Both providers go through the same validator and release handler. There is no live adapter in this checkpoint.

## Released pool and event

The transaction compares each exact car with the current run's `stock` rows. Previously absent cars are inserted. A matching `state: 'unreleased'` row from the existing identity/reset importer is promoted with conditional version matching. UUID, order number, configuration, wholesaler order, corpus version and source revision must match existing identity. Existing facts/account/visibility remain unchanged; imported rows retain the supplied values. Previously released, held, allocated or otherwise operational rows are never overwritten or freed. An identity conflict or failed conditional write rolls back every car and the receipt.

Released rows have operational `state: 'released'`, `status: 'available'`, `available: true`, `held: false`, `allocated: false`, with:

```js
release: {
  trancheId, windowId, supplyId, releasedAt, policyVersion, sourceVersion,
  availability: { state: 'available', availableFrom: releasedAt,
    version: trancheId, availableUntil /* only when supplied by source */ }
}
```

`availableFrom` is the successful actual pull/tick instant. No expiry is invented. FUCQ-29 currently needs both interval ends for a suitable timing decision; an absent end remains unknown, so final FUCQ-78 supply must provide a genuine versioned synthetic interval or a coordinated canonical policy assumption. Minimal release fixtures deliberately do not claim decision-complete vehicle facts.

Manual browsing and buddy allocation read this one existing run-scoped `stock` table. The release service supplies no duplicate stock store or reservation authority.

Operational `released` matches the existing manual/Greg readers and F100 hold port. The nested `release.availability.state: 'available'` remains the eligibility fact. F100 alone may transition released stock through its repository claim protocol; this producer does not rewrite existing operational rows. Missing source visibility still makes the manual projection unavailable; missing source expiry still makes decision-critical timing unknown.

The earlier checkpoint wrote operational `available`. Replaying its completed receipt does not repair those already-known rows. Local validation here used transient memory repositories; native/deployed exposure has not been inspected. Before reusing an affected persistent synthetic run, audit F92 provenance/receipt identities and current occupancy, then use an authorised controlled scenario reset or a separately reviewed conditional data migration. Preserve exact identities, immutable facts, receipts, occupied/allocated state and history. Do not mass-change all `available` rows or silently repair them during a pull; unrelated repository workflows also use that value inside their own claim transactions.

The persistent-run audit is read-only before any reset/migration decision: for each exact run/order, retain operational state/version, the F92 tranche/source/version and completed receipt, then cross-check all holds and claims (including pending states), allocations and offers before declaring an unoccupied candidate. The PostgreSQL foundation stores these values in each table's JSON `data`; it has no stock-state enum that would identify or migrate affected rows automatically. This audit has not been run against a native or deployed database.

A separate consumer boundary remains: the current `cases/index.js` alternative-car remedy tests operational `available`. It is not an F92 producer or F100 claim transition. This repair preserves that consumer and reports its released-pool compatibility to the integration owner; the narrow release regression does not prove the case-remedy journey.

In the same transaction, `event_receipts` receives:

```js
{
  runId, consumerId: 'stock-release', eventId: trancheId,
  eventType: 'stock-released', handlerId: 'stock-release',
  inputDigest, inputVersions: { clock, policy, source }, state: 'completed',
  outcome: { status: 'ok', value: {
    kind: 'stock-released', runId, trancheId, windowId, supplyId,
    tickId, releasedAt, orderUuids, visibleOrderUuids, policyVersion, source
  }}
}
```

`orderUuids` contains only newly inserted/promoted cars; `visibleOrderUuids` preserves the exact source tranche. Already known cars can yield an empty `orderUuids`. The digest binds the tranche, exact source cars and source identity. The same tranche/digest returns the original outcome; a changed tranche is conflict. Allocation consumes completed receipts with `consumerId: 'stock-release'` and `eventType: 'stock-released'`, keyed by exact tranche/event ID. Its own consumer receipt controls allocation replay. This shape was coordinated directly with the FUCQ-96 lane.

## Authenticated visible release-history read

`createStockReleaseHistoryPort({ repository, identity, clock })` is exported directly from `server/gcsp/stock/history-port.js`. Its only operation is `read(context)`. It authenticates the actual identity adapter's employee context and validates the current active run and DemoClock before and after repository reads. A reset is stale-run; a changed clock observation is conflict. It creates no command, receipt, stock change or HTTP route.

On the existing status/value envelope, a successful value is:

```js
{
  runId, observedAt,
  history: {
    state: 'none-visible' | 'released',
    releasedCarCount, releaseCount, latestReleasedAt: null | releasedAt,
    sourceVersions: [confirmedHistoricalVersion]
  },
  source: { state: 'current-version-unknown' }
}
```

The reader first obtains retained exact stock, including held/allocated and legacy operational available rows, then reads completed successful F92 stock-release receipts. Each newly released exact UUID must match its retained tranche/window/supply/releasedAt/policy/source-version provenance. Every retained release must have a matching confirmed receipt. Malformed or missing provenance/visibility yields typed unavailable, never a zero count. Pending, failed and unrelated receipts do not establish a release.

Company, scheme and employee visibility use the existing stock visibility dimensions. Counts include only visibility-qualified confirmed cars and distinct nonempty visible tranches. Multiple cars in one tranche count as one release; repeated/empty tranches add no history. Latest instant and sorted source versions come only from those visible confirmed releases. The value contains no exact car IDs, employees or raw receipts. `none-visible` means no confirmed release visible to this context; it says nothing about other employees' releases.

This history is independent of current suitable/matching availability: occupied, allocated, unsuitable or filtered cars can leave confirmed visible history after the current matching list is empty. The existing browse/decision projection owns current availability and filter results. `source.current-version-unknown` remains explicit even when historical versions exist: the pull-only provider supplies no current metadata/health read, including before the first release.

Minimal trusted composition, behind the existing authenticated manual read boundary:

```js
import { createStockReleaseHistoryPort } from './gcsp/stock/history-port.js';
const releaseHistory = createStockReleaseHistoryPort({ repository, identity, clock });
const history = await releaseHistory.read(authenticatedEmployeeContext);
// Preserve typed non-ok outcomes. Combine successful history with the separately
// authoritative browse result; never infer current availability from history.
```

Shared manual/HTTP/startup wiring remains with its integration owner. `docs/gcsp/evidence/fucq92/gallery-release-history-handoff.md` records the immutable producer pin, source hash, actual executability and remaining external gates.

## Confirmed supply and policy

`service.queueConfirmedSupply(gregContext, { commandId }, confirmation)` is an internal backend seam for FUCQ-104, not a public endpoint. The existing identity adapter must authorise Greg. The confirmation reference is exactly `{ runId, supplyId, state: 'confirmed', confirmedAt, sourceVersion }`, contains no stock rows, cannot be future, and must belong to the current run. Final producer integration must pass an actual acknowledged supply record, never client JSON or a request treated as an acknowledgement.

The service stores only a `confirmed-supply-queued` receipt under `consumerId: 'stock-supply-queue'`, `eventId: supplyId`. Its retained outcome adds `eligibleFrom` and `policyVersion`. Same confirmation replay returns its original result; changed acknowledgement input conflicts. This receipt creates no stock. The provider must later expose actual exact cars with that `supplyId`, at/after both the source window and the queued eligible date, before the release transaction makes them holdable. A missing provider appearance, even after the lead time, produces no stock.

Both rules are read through PolicyService at DemoClock time and one pinned resolved version:

| Key | Use |
|---|---|
| `supply.release.size` | Positive integer cap per new synthetic tranche; oversized source tranches fail. |
| `supply.leadTimeDays` | Nonnegative calendar-day offset from confirmed supply to earliest eligible release. |

Missing/invalid policy produces unavailable, never local defaults. Previously queued dates/receipts retain their policy provenance. There is no second policy, duration default or assumed BMW release window.

## Checkpoint gates and experience evidence

The fixture files in `server/gcsp/stock/fixtures/` retain the synthetic tranche plan and target-shaped pull. `docs/gcsp/evidence/fucq92/` records the emitted event, pool and failure presentation states. This backend checkpoint adds no new screen or user control, so no screenshots/component changes are needed. Existing HLD topology remains unchanged; no fresh canonical diagram status/render proof is claimed.

Remaining final gates are real FUCQ-77/FUCQ-78 provider/data integration, FUCQ-104 acknowledgement hookup, shared startup/next-release control composition, manual/buddy integration and the story's serially admitted `npm test`. Native PostgreSQL execution remains unproved without a provisioned test database. This checkpoint is scoped implementation evidence, not a built story or permission to merge/close/release the claim.

## Source selection and fallback (FUCQ-92)

`createRunStockProvider` (`server/gcsp/stock/run-stock.js`) is the launcher's pull provider. It chooses each run's source once and caches the choice per run, so a run never mixes sources.

1. A run that already holds demo stock (`synthetic:demo-synthetic-stock-v1`) stays on the demo provider.
2. A run whose scenario declares a `published-demo-stock` tranche source (the named scenario replays) uses the demo provider and its `release` cue.
3. Otherwise (the startup run, or a reset to the mechanics scenario) it uses generated stock: the FUCQ-78 generator runs once for the run (`prepareRun`, also called after composition and after every scenario reset), then `createGeneratedStockProvider` serves the rows. Next release then follows the run's cadence windows (`supply.release.cadence`) from `versions.stockGeneration`.
4. If generation is not configured or returns a non-ok status, that run falls back to the demo provider, one line naming the run and the reason is logged, and `describe(runId)` returns `{ source, reason }`. A repository read failure is `unavailable` and cached nothing, so it never triggers the fallback.

Generated cars carry `eligibilityModelKey` and the model-line browse facts only where `stock.eligibilityModelKeys.v1` maps their AG code (today `72HH` only); other cars release but are not eligible. `GCSP_STOCK_SOURCE=demo` forces the demo provider; it is meant for a fresh run, because forcing it mid-run mixes sources. `GCSP_STOCK_INVENTORY_PATH` sets the allocation inventory file, default `<tmpdir>/gcsp-stock-inventory/<environment>.json`.
