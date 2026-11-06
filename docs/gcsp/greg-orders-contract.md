# Greg order requests and production acknowledgements — FUCQ-104

This implements the existing HLD supply loop inside the Node backend and F81 repository. The service, upstream adapter and repository connection already exist in the agreed architecture; there is no new process, store, queue or live BMW write. A synthetic request is intent; a provider acknowledgement is confirmed supply; existing exact stock and successful F92 receipts establish release.

## Durable records and native startup

Migration `0004_greg_supply.sql` adds two run-scoped JSONB tables without changing migrations 0001–0003. `future_order_requests` retains model, derivative, positive quantity, requested actor/time, policy and stock pins, upstream reference, provenance and request history. Request states are requested, partly-confirmed, confirmed and delayed. The requester/command and upstream reference are unique within a run.

`confirmed_supply` is immutable acknowledgement history, linked to the same run's request. It retains positive quantity, confirmed/expected instants, policy/source versions and a unique upstream acknowledgement reference. Further partial acknowledgements append distinct supply records. These tables never insert stock or change its availability. Pending-operation/queue receipts do not replace either business record.

Both tables join `FOUNDATION_TABLES` automatically. Native startup must apply 0004 before foundation snapshots/transactions can read them. Gary owns native PostgreSQL proof and credentials on his machine. Migration discovery and driver-double compatibility do not establish native execution. Reconcile the migration number with other writers before shared integration; never rename an applied migration.

## Checkpoint validation

Storage acceptance uses `node --test server/test/gcsp-greg-orders.test.js server/test/gcsp-repository-contract.test.js`: 45 passed, two native PostgreSQL skips, zero failures. The new checks prove separate durable rows after memory reopen, run isolation, acknowledgement immutability/reference/idempotency and zero stock creation. The existing contract exercises foundation snapshot/flush and migration-history compatibility through a driver double. Native SQL, service submission/confirmation, producer composition, UI and final authored validation remain separate gates.

Run ownership and exact targeted identity are retained at `.claude/dev-poller-restart-20261105/lead104/validation-plan.json` and `runs/targeted-f7a1599e42932ec46963aaed2b9b51a9227b596646c61ca11d6dffdc26f627d2-default-1793924281545242000.json` in the launching clone. All owned scratch and the audited read-only pg dependency symlink were removed by finalizers. No native database or live ordering operation was attempted.
