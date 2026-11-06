# Greg order requests and production acknowledgements — FUCQ-104

This implements the existing HLD supply loop inside the Node backend and F81 repository. The service, upstream adapter and repository connection already exist in the agreed architecture; there is no new process, store, queue or live BMW write. A synthetic request is intent; a provider acknowledgement is confirmed supply; existing exact stock and successful F92 receipts establish release.

## Durable records and native startup

Migration `0004_greg_supply.sql` adds two run-scoped JSONB tables without changing migrations 0001–0003. `future_order_requests` retains model, derivative, positive quantity, requested actor/time, policy and stock pins, upstream reference, provenance and request history. Request states are requested, partly-confirmed, confirmed and delayed. The requester/command and upstream reference are unique within a run.

`confirmed_supply` is immutable acknowledgement history, linked to the same run's request. It retains positive quantity, confirmed/expected instants, policy/source versions and a unique upstream acknowledgement reference. Further partial acknowledgements append distinct supply records. These tables never insert stock or change its availability. Pending-operation/queue receipts do not replace either business record.

Both tables join `FOUNDATION_TABLES` automatically. Native startup must apply 0004 before foundation snapshots/transactions can read them. Gary owns native PostgreSQL proof and credentials on his machine. Migration discovery and driver-double compatibility do not establish native execution. Reconcile the migration number with other writers before shared integration; never rename an applied migration.

## Supply service and authenticated routes

`createSupplyService({repository, policy, clock, identity, production, releases})` exposes `submit`, `stepProduction`, `queueConfirmed` and `readTracking`. Contexts come from F84; copied or browser-supplied contexts fail. Submission records the observed policy version and the digest of current run-scoped stock, with a conditional transaction fence for clock, policy, run and stock changes. Command replay returns the recorded result; a changed payload conflicts.

`createSupplyRoutes(service)` is additive registration for the shared handler:

| Method/path | Authority | Operation |
| --- | --- | --- |
| GET `/api/gcsp/greg/orders` | Acting Greg cookie | Tracking and versioned synthetic choices |
| POST `/api/gcsp/greg/orders` | Acting Greg cookie | Submit model, derivative, quantity and observed policy/stock pins |
| POST `/api/gcsp/presenter/production` | Retained presenter control cookie | Confirm a positive quantity or delay the outstanding request |
| POST `/api/gcsp/greg/orders/queue` | Acting Greg cookie | Retry queueing persisted acknowledgements through F92 |

All routes reject query selectors. The common boundary rejects browser identity/run fields. Production and queueing remain separate authenticated actions: the browser can submit a presenter confirmation and then queue with its acting Greg session without forging either role. Queue failure retains the immutable confirmation and allows retry.

`expectedAt` is `confirmedAt + PolicyService supply.leadTimeDays`. A new production acknowledgement supersedes an earlier delay for its confirmed quantity; a delayed outstanding remainder stays visible. This matches F92's published queue date calculation. The adapter does not invent a later acknowledgement date that F92 cannot represent. An eventual provider with another date convention requires an agreed port extension.

`readTracking` retains request, confirmation, outstanding and released quantities separately. Actual successful F92 release receipts must match the persisted stock's supply, tranche, time, source and policy provenance. A double read with a clock/run fence refuses mixed revisions. Adapter failure leaves saved tracking readable and disables fresh requests; unavailable queueing does not remove confirmation history.

## Published producer and shared-runtime gates

F92 pin `15a79957e61d81612311d3aab7dbf77733dc4e0d`, `server/gcsp/stock/index.js:118–145`, accepts a run-bound confirmed reference, not stock rows or a caller-supplied eligibility date. Only its registered release-pull tick writes released stock. The synthetic production adapter requires an explicit versioned model/derivative choice set and performs no live ordering write.

F96 pin `d12358bcd02f4c10a5dc9f0851efe94bc2c9d864`, `server/gcsp/allocation/index.js:75,174,205`, requires `identity.resolveEmployeeContext`. That exact published commit includes the trusted resolver at `server/gcsp/identity/index.js:206–222`; a supported `git show` and empty file diff verified the source. The shared foundation used by this branch does not yet include that method. The integration gate is adopting that reviewed identity capability through GC's shared-runtime ownership. Authenticated service checks here do not prove the canonical allocator/runtime integration. No producer or central-runtime file was changed by F104.

## Checkpoint validation

Storage acceptance uses `node --test server/test/gcsp-greg-orders.test.js server/test/gcsp-repository-contract.test.js`: 45 passed, two native PostgreSQL skips, zero failures at the storage checkpoint. The checks prove separate durable rows after memory reopen, run isolation, acknowledgement immutability/reference/idempotency and zero stock creation. The existing contract exercises foundation snapshot/flush and migration-history compatibility through a driver double.

The submission/confirmation checkpoint uses `node --test server/test/gcsp-greg-orders.test.js server/test/gcsp-clock-reset.test.js server/test/gcsp-greg-demand.test.js`: 46 passed, zero failures/skips. It covers real F84 acting/presenter cookies, refusal/forgery, replay, stale pins, partial and delayed production, lead-time policy changes, concurrent acknowledgement fences and unavailable adapter/queue recovery. F92 queue is an injected contract double in these authored tests. Native SQL, actual producer composition, shared-runtime/Greg embedding, UI and final authored validation remain separate gates.

Run ownership and exact targeted identity are retained at `.claude/dev-poller-restart-20261105/lead104/validation-plan.json` and `runs/targeted-f7a1599e42932ec46963aaed2b9b51a9227b596646c61ca11d6dffdc26f627d2-default-1793924281545242000.json` in the launching clone. All owned scratch and the audited read-only pg dependency symlink were removed by finalizers. No native database or live ordering operation was attempted.

Service/HTTP evidence: `runs/targeted-98b824398506254a6f1b7d6cca536b0e13913d8ba0fdd484a0daab446f513bcf-default-1793924750397558000.json`. Resource roots and overlay cleanup are retained in the same launching evidence directory.
