# FUCQ-111 lifecycle stage port `lifecycle.stages.v1` (pinned for FUCQ-116)

Contract revision 1, 6 November 2026. Implemented in `server/gcsp/lifecycle/approvals/`; asserted by
`server/test/gcsp-lifecycle-approval.test.js`; response shapes in `server/test/fixtures/gcsp-lifecycle-approval-outcomes.json`.
**Agreed** items follow the coordinator decision of 6 November (`lifecycle-parallel-contract-decision`). **Proposed** items
may still be refined with the FUCQ-116 lead; any change bumps the revision here and in the fixtures.

## Port (agreed)

`LifecycleApprovalService.read(context, { orderUuid })`, synchronous, server-owned context only. FUCQ-116 calls it inside its
tick workflow as the authoritative opening-stage input; it does not decode selection internals or replay receipts.
`list(context)` returns `{ contractVersion, asOf, orders: [view] }`, employee-scoped for employees.

- Roles: an employee reads only their own orders (`forbidden` otherwise, checked before readiness is revealed); Greg and the
  presenter read any order in the run. Repository run binding prevents cross-run reads (`not-found`).
- Routes: `GET /api/gcsp/orders/progress?orderUuid=` and `GET /api/gcsp/orders/progress/all`, `browserContext: 'ignore'`, so
  browser employee/run IDs are discarded; any other query key is `invalid`.

## View (agreed shape; field list is revision 1)

`contractVersion: "lifecycle.stages.v1"`, `schemaVersion: 1`; identity `runId, orderUuid, employeeId, entitlementSlotId, route`
(`manual` for `cart`, `buddy` for `buddy-offer`); `renewalId` and `renewalAuthority` (`validated` from the stored employee/slot
row, else `missing` with `renewalId: null`, never invented); `source` (selection `operationId`, `operationType: selection-order`,
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
`lifecycle-documents` (FUCQ-116) by the clock's ordinal ID order. A presenter tick counts one tick per waiting stage (once per
tick ID) and, after the keyed `lifecycle.approval.ticks.v1` count, asks the ordering status adapter for the decision. A startup
tick only reconciles uncertain writes; it never counts or starts stages. A reset run starts with no lifecycle receipts.

## Ordering status (agreed)

`server/gcsp/adapters/synthetic-ordering-status.js` adds a status capability beside FUCQ-71's single `synthetic-ordering:v1`
adapter, with its own receipt namespace `synthetic-ordering-status:v1`; it never touches the selection acknowledgement. The
live-shaped stub returns `unsupported` / `live-ordering-unsupported` for every write and the stage stays where it was.
A thrown or unmatched response marks the operation `unknown`; the next tick reconciles that same ID before any new request.

## Proposed / open

1. Policy rows `lifecycle.approval.{ticks,declineScenario,ownership}.v1` are prepared in
   `server/test/fixtures/gcsp-lifecycle-approval-policy.json` for the serial canonical-policy lane; not yet in `seed-v1.json`.
2. FUCQ-116 opening rule: its own PolicyService key names the opening stage; it opens items when that stage is `approved`,
   binding the observation to `lifecycleRevision`.
3. Integration gaps: FUCQ-71 ed20ca2 is not in this branch base; its selection-acknowledged receipt lacks top-level `renewalId`,
   `orderUuid` and `occurredAt` (uses `at`). Tests inject FUCQ-71-shaped rows, which prove consumer mechanics only.
