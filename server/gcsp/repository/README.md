# GCSP TransactionRepository

Implements shared contract 1.0.0. Import the backend factories and helpers from `index.js`.
The retail HTTP server does not open this repository or require database configuration.

```js
import { createPostgresRepository, inputDigest } from './index.js';

const repository = createPostgresRepository();
const startup = await repository.open();
// Inspect startup.status, then startup.value.migrationStatus.current before enabling GCSP writes.
const outcome = await repository.transaction(context, {
  commandId: stableCommandId,
  inputDigest: inputDigest(commandInput),
}, async (tx) => {
  const claim = await tx.conditionalClaim(commandInput);
  if (claim.status !== 'ok') return claim;
  const offer = await tx.insert('offers', offerRow);
  if (offer.status !== 'ok') return offer;
  return tx.enqueueNotification(notificationJob);
});
await repository.close();
```

`GCSP_DATABASE_URL` is backend-only. No configuration, raw driver error or connection string appears in a returned outcome. A connection failure returns `unavailable`; it never switches providers. Startup applies migrations by default. `{ migrate: false }` reports pending versions without applying them. A backend-only `schema` option supports isolated test schemas; it accepts a simple lowercase SQL identifier. Tests may inject a pool that they own and close.

For unit tests, explicitly create a store with `createMemoryStore()` and inject it into `createMemoryRepository({ store })`. Reopening another handle against that store retains state; it is not durable storage across process restarts. PostgreSQL is the durable provider. Both use the same validated transaction engine. Reads and writes are run-bound; a `RowRef.key` includes every primary-key field, including `runId`. Filters and patches accept only the table's registered fields. Business revalidation, role authorization, allocation ranking and expiry decisions remain with consuming services.

Slot rows explicitly configure positive `capacity` and may supply positive `employeeCapacity`. The repository does not invent a policy limit. New conditional claims require `expectedStockVersion`, `expectedSlotVersion`, exact `orderUuid`, `holdId`, `claimId`, employee/slot, `type`, UTC `expiresAt`, `policyVersion` and `quoteId`. They return the hold, claim and new stock/slot versions. Both hold types share uniqueness across active and pending states. Updates use compare-and-swap and cannot revive terminal holds. Consuming services update corresponding hold/claim/stock states together.

Callbacks return a shared outcome and perform no external network effects. A failed mutation poisons the transaction even if the callback ignores its result. A lookup returning `not-found` is an ordinary miss. A thrown callback or malformed success rolls back. Command, event and outbox replays return their original outcome; changed input digests conflict. Use `inputDigest` for canonical JSON digests and keep logical keys stable across retries. An unavailable acknowledgement after COMMIT is uncertain: retry the original command ID and digest to reconcile its stored outcome.

`0001_transaction_foundation.sql` creates the 17 non-policy foundation tables. Rows use JSONB payloads with generated run/key/version columns, scoped foreign keys, uniqueness constraints and partial indexes for occupying holds/claims. SQL transactions serialize per run and persist only changed rows; native constraints also protect exact-car exclusivity. The append-only migration ledger records filename, version, checksum and applied time. Each numbered file commits with its ledger entry; a changed or missing applied file is refused. Applied migrations must remain unchanged. The six policy table names are reserved for FUCQ-83's `0002_policy_tables.sql` and return `invalid/unsupported-table` until enabled.

Run `node --test server/test/gcsp-repository-contract.test.js` from the worktree root. The same suite runs against both providers when `GCSP_DATABASE_URL` is set, creating and deleting isolated test schemas. A separate live test bypasses the port to prove the native partial uniqueness constraints. Only an unset URL skips these checks; an empty, invalid or unreachable configured URL fails. Driver doubles separately verify failure handling and migration orchestration; they do not prove real SQL execution. UI consumers can use `server/test/fixtures/gcsp-repository-outcomes.json` for unavailable, conflict and stale-version response shapes.

Managed Render PostgreSQL provisioning is outside this story. The local unset-URL result does not establish managed integration. Gary must provision the GCSP database and backend connection setting; then run the contract suite there and retain its schema/restart evidence before marking that integration complete.
