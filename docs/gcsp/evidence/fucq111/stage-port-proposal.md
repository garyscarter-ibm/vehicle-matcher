# FUCQ-111 lifecycle stage port `lifecycle.stages.v1` (pinned for FUCQ-116)

Contract revision 2, 6 November 2026 (rev 1 at f824d39). Implemented in `server/gcsp/lifecycle/approvals/`; asserted by
`server/test/gcsp-lifecycle-approval.test.js`; response shapes in `server/test/fixtures/gcsp-lifecycle-approval-outcomes.json`.
**Agreed** items follow the coordinator decision of 6 November (`lifecycle-parallel-contract-decision`). **Proposed** items
may still be refined with the FUCQ-116 lead; any change bumps the revision here and in the fixtures.

## Port (agreed)

Public: `LifecycleApprovalService.read(context, { orderUuid })` and `listOrders(context)` (rev 2 rename of `list`), returning
`ok(view)` and `ok({ contractVersion, asOf, orders: [view], failed: [{ orderUuid, status, code }] (at most 20), failedCount })`. One order with a
malformed source or pinned policy (`selection-source-invalid`, `lifecycle-policy-invalid`, `lifecycle-policy-unavailable`) is listed in `failed` and
skipped; an unavailable policy source, clock or repository, or a foreign run, still refuses the whole list. Employees see only their own diagnostics; they require an employee, Greg or presenter session.
Internal: `service.stagePort()` returns one frozen `{ contractVersion, read, listOrders }` with the same results and no role
check, for DemoClock handlers (presenter tick contexts and startup `clock-startup` contexts with `roles: []`). It has no route;
`clock.now(context)` and run-bound repository reads still refuse another run or environment (`stale-run`). FUCQ-116 receives
it as `lifecycleStages` and calls it synchronously inside its tick workflow; it does not decode selection internals.

- Roles: an employee reads only their own orders (`forbidden` otherwise, checked before readiness is revealed); Greg and the
  presenter read any order in the run. Repository run binding prevents cross-run reads (`not-found`).
- Routes: `GET /api/gcsp/orders/progress?orderUuid=` and `GET /api/gcsp/orders/progress/all`, `browserContext: 'ignore'`, so
  browser employee/run IDs are discarded; any other query key is `invalid`.

## View (agreed shape; field list is revision 1)

`contractVersion: "lifecycle.stages.v1"`, `schemaVersion: 1`; identity `runId, orderUuid, employeeId, entitlementSlotId, route`
(`manual` for `cart`, `buddy` for `buddy-offer`); top-level pinned `policyVersion` (rev 2); `renewalId` and `renewalAuthority`
(`validated` only from the order's own slot: that slot's `renewalId`, or the employee's `renewalId` when the employee's
`entitlementSlotId` is that same slot; if they disagree, or neither exists, `missing` with `renewalId: null`, never invented;
`entitlementSlotId` may still be non-null when `missing`); `source` (selection `operationId`, `operationType: selection-order`,
`sourceType`, `holdId`, `orderNumber`, `configurationId`, `receivedAt`, `quoteId`, `termsVersion`, `termsDigest`, pinned
`approvalStages`, `policyVersion`, `operationVersion`, `providerReference`); `policy` (`policyVersion`, per-key provenance);
`lifecycleRevision` (0 until the first tick, then +1 per transition); `asOf` (DemoClock); `stageList`, `currentStage`, `stages[]`
(`stage, state, at, providerReference, operationId`), `owner`, `nextStep`, `outcome`, `blocked`, `provider`
(`mode, provider, synthetic`).

- `stageList` is `selection received` + the canonical `ordering.approvalStages.v1` array (FUCQ-71 ed20ca2). HR approval is on
  when that array contains it; there is no second HR flag. The order's own pinned snapshot governs it, so a later policy
  never relabels a historical order.
- `state`: `not-started | pending | approved | declined`. `outcome`: `in-progress | declined | sent-to-ordering`.
- `blocked`: `null`, or `{ code: 'live-ordering-unsupported' | 'provider-uncertain' | ..., reason }` while the current stage
  waits on a refused or uncertain provider write.
- Refusals: `not-found` (no selection for the UUID), `unavailable` with `state: 'not-ready'` and code `selection-pending` or
  `selection-handoff-failed`, `unavailable` (missing service, policy or clock), `forbidden`, `invalid`.

## Durable state and events (agreed)

No new table. Each transition appends one completed `event_receipts` row, consumer `lifecycle:approval:<orderUuid>`, event ID
`revision:<000001>`, type `lifecycle-stage-changed`, outcome `ok(view-record)` carrying `transition { transitionId, stage, state,
occurredAt }`. The current record is the highest revision; the transaction re-reads it, so a concurrent writer gets
`stale-version`. Each stage decision is one `pending_operations` row, type `lifecycle-approval-decision`, ID
`lifecycle-approval:<digest(runId, orderUuid, stage)>`, reused for every retry.

A decline also records consumer `lifecycle:exceptions`, event ID `<eventType>:<orderUuid>:<stage>`, type from
`lifecycle.approval.declineScenario.v1.eventType` (`approval-declined`), outcome `ok({ type, employeeId, renewalId, orderUuid,
occurredAt, stage, reasonCode, reason, lifecycleRevision, transitionId, policyVersion, providerReference, fictional })`, written
atomically with the transition. The FUCQ-112 consumer opens a renewal case from it (tested). With `renewalId: null` the
consumer skips it; that is the explicit gap until FUCQ-71 supplies renewal authority.

## Clock (agreed)

Handler `lifecycle-approvals`, stage `pending-reconciliation`, registered by `start()` before startup. It sorts before
`lifecycle-documents` (FUCQ-116) by the clock's ordinal ID order. One failing order is recorded in the handler outcome's `failed[]` (orderUuid, status, code) and
skipped; other orders still advance and the tick replays identically. A presenter tick counts one tick per waiting stage (once per
tick ID) and, after the keyed `lifecycle.approval.ticks.v1` count, asks the ordering status adapter for the decision. A startup
tick only reconciles uncertain writes; it never counts or starts stages. A reset run starts with no lifecycle receipts.

## Ordering status (agreed)

`server/gcsp/adapters/synthetic-ordering-status.js` adds a status capability beside FUCQ-71's single `synthetic-ordering:v1`
adapter, with its own receipt namespace `synthetic-ordering-status:v1`; it never touches the selection acknowledgement. The
live-shaped stub returns `unsupported` / `live-ordering-unsupported` for every write and the stage stays where it was.
A thrown or unmatched response marks the operation `unknown`; the next tick reconciles that same ID before any new request.

## Proposed / open

1. Policy rows `lifecycle.approval.{ticks,declineScenario,ownership}.v1` are in `seed-v1.json` (rev 2); the fixture of the
   same name must equal them (tested). Contract section: `docs/gcsp/shared-contracts.md#lifecycle-approval-stages--fucq-111`.
2. FUCQ-116 opening rule: its own PolicyService key names the opening stage; it opens items when that stage is `approved`,
   binding the observation to `lifecycleRevision`.
3. FUCQ-71 ed20ca2 is integrated (d392120); a test drives the real `ManualOrderService` and `synthetic-ordering:v1` for manual
   and buddy orders. Its selection-acknowledged receipt still lacks top-level `renewalId`, `orderUuid` and `occurredAt` (uses
   `at`), and no validated renewal authority is seeded. Other cases still use injected FUCQ-71-shaped rows (consumer mechanics).
