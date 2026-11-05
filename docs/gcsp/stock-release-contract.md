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

`createSyntheticStockProvider({ runId, version, label, windows })` is an offline, run-bound provider. Each window supplies `{ windowId, availableAt, supplyId: null | string, stock }`. It reconstructs prior visibility from committed receipts, selects at most `supply.release.size` previously unexposed cars in the next eligible window and returns the cumulative visible list. Tranche IDs are `<source-version>:<window-id>:<first-index>`; a smaller policy cap produces successive tranches rather than dropping cars. There is no mutable process cursor. Window instants are source data, not locally assumed weekly timers. The final FUCQ-78 adapter must provide the actual run's generated identities and window data, including after reset; the static TEST provider intentionally refuses another run.

`createStockPullFixtureProvider(readSnapshot)` implements the identical `pull(request)` method for a target-shaped snapshot fixture. Both providers go through the same validator and release handler. There is no live adapter in this checkpoint.

## Released pool and event

The transaction compares each exact car with the current run's `stock` rows. Previously absent cars are inserted. A matching `state: 'unreleased'` row from the existing identity/reset importer is promoted with conditional version matching. UUID, order number, configuration, wholesaler order, corpus version and source revision must match existing identity. Existing facts/account/visibility remain unchanged; imported rows retain the supplied values. Previously released, held, allocated or otherwise operational rows are never overwritten or freed. An identity conflict or failed conditional write rolls back every car and the receipt.

Available rows have `state` and `status: 'available'`, `available: true`, `held: false`, `allocated: false`, with:

```js
release: {
  trancheId, windowId, supplyId, releasedAt, policyVersion, sourceVersion,
  availability: { state: 'available', availableFrom: releasedAt,
    version: trancheId, availableUntil /* only when supplied by source */ }
}
```

`availableFrom` is the successful actual pull/tick instant. No expiry is invented. FUCQ-29 currently needs both interval ends for a suitable timing decision; an absent end remains unknown, so final FUCQ-78 supply must provide a genuine versioned synthetic interval or a coordinated canonical policy assumption. Minimal release fixtures deliberately do not claim decision-complete vehicle facts.

Manual browsing and buddy allocation read this one existing run-scoped `stock` table. The release service supplies no duplicate stock store or reservation authority.

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
