# FUCQ-481 remote ordering into the durable consumer: 17 November 2026

This note covers one component test. It links the real `HttpOrderingProvider` to the existing durable `OrderingService` on native PostgreSQL, across a lost acknowledgement and a service restart. It was authored from `45d1c1afc05858c6f2d123d1958dd86ed625214a`, whose API tree matches integration `234856497`. **The test has not been compiled or run.** It changes no screen and no production source.

The semantic authority is [the ordering contract](manual-order-contract.md#durable-state-and-external-shaped-protocol): reconcile before every send, execute only after an authoritative not-found, and keep unknown outcomes pending while the allocation stays occupied. [The standalone adapter note](fucq481-remote-ordering-adapter-2026-11-17.md) covers the wire mapping. This test reuses that mapping rather than repeating its 13 transport cases.

## What the test is

`services/gcsp-api/src/test/java/gcsp/api/ordering/RemoteOrderingConsumerPgTest.java`, one method:

`lostAcknowledgementReconcilesSamePersistedSelectionWithoutSecondExecute`

It uses only existing APIs:

- **`OrderingFixture.create()`.** A fresh Flyway schema with one active run, employees e1 and e2, a cart hold and car each, the retained policy seed, and the fixture's `TestConverter` cart source. `newService(pool, OrderingPort)` builds a real `OrderingService` with zero retry backoff.
- **`HttpOrderingProvider`.** Its settings come from `OperationHttpTransport.Settings.parse` (loopback HTTP allowed, as in the adapter test) and its client from `OperationHttpTransport.newClient`. A private `Delegate` record forwards each `OrderingProviderPort` call unchanged, so that the adapter fits the fixture's `OrderingPort` type. It changes no meaning.
- **A private in-process JDK `HttpServer` on 127.0.0.1.** It keeps its own ledger keyed by `operationId`:
  - `GET /reconcile` answers not-found, or the stored operation's confirmation.
  - `POST /execute` records the effect once, counting any duplicate. It then declares the full confirmation length, writes half of it and closes, so no valid acknowledgement arrives.

## The flow and what it asserts

1. **Submit.** `submit` on the first service sends GET (not-found), then one POST. The result is `Pending` with `OrderingService.operationId(scope)`. The database then holds:
   - `pending_operations` in state `pending`, with outcome `unknown`. The reason is the adapter's transport, malformed or timeout code: a cut-off body may surface as any of these.
   - One `selection_orders` row and one `ordering.selection-received` event, with no acknowledged event.
   - An order source answering `selection-pending`.
   - Hold `hold-e1` and car `car-e1` both `allocated` (occupied order authority).
2. **The POST body.** It is exactly the persisted operation:
   - The operation id, which is also the stored `idempotency_key`, sent as the header and in the body.
   - The stored `input_digest` and the car (`car-e1`, `1000001`, `cfg-1`).
   - The first approval stage from the stored selection terms.
   - The fixture's environment, run, employee, slot and policy version, and the bearer token.
3. **Restart.** A second `OrderingService`, with a new adapter and HTTP client, runs over the same schema. `reconcileOpen(ctx, 10)` examines 1 operation and settles 1. The remote sees exactly one more GET, carrying the same `operationId`, `runId` and `orderUuid`. That GET returns the ledger's complete typed confirmation, using the original identity.
4. **After the restart:**
   - The remote saw GET, POST, GET: **one execute effect, no second POST, no duplicate**.
   - `pending_operations` is `acknowledged`, with provider reference `remote-receipt-1` and a fictional outcome.
   - There is one acknowledged outbox event, carrying that reference.
   - The order source returns `Ready` with the same operation and reference. `read(scope)` reports acknowledged.
   - The hold and car are still allocated. The converter ran once.
   - A single SQL projection is byte-identical before and after the restart. It covers the selection's operation id, order reference, order UUID, received-at and full selection JSON, plus the pending operation's type, idempotency key and input digest.

The test uses no sleeps and no timing thresholds. The 2-second client timeout is only a bound against hanging on the cut-off body. Cleanup is try-with-resources, in reverse order:

1. `Remote.close()` shuts down each `HttpClient`, stops the server and stops the single-thread executor. It awaits the executor and fails if the worker does not stop within 2 seconds.
2. `OrderingFixture.close()` drops the schema.

Both run on success and on failure.

## Running it (proposed, not run)

The test needs `GCSP_TEST_DATABASE_URL`; without it, `OrderingFixture` skips the test. The proposal is one plain-JUnit chunk on retained tooling: one worker, owned PG16 and the existing supervisor pattern. The selection is:

`-Dtest=RemoteOrderingConsumerPgTest#lostAcknowledgementReconcilesSamePersistedSelectionWithoutSecondExecute`

It needs no Quarkus boot. The expected peak is under the existing per-chunk grant, and earlier ordering PG chunks measured about 1 GB RSS. Scratch is one schema, dropped by the fixture.

## What it does not prove (original AC remain open)

- The fixture's converter and policy are test doubles of the source authority. They do not prove account or startup composition, real sign-in, email, the whole claim-to-order journey or BMW integration.
- `HttpOrderingProvider` is still **unbound at startup**. The ordering selector belongs to FUCQ-468: `OrderingSelection.java` is foreign, and `OrderingServiceHolder.java` was released by the Claude lane in assignment 17. The binding waits on MSG-2026-11-17-GC-001. The full order/status path still reaches the refusing FUCQ-458 `AccountSelection.policy()`. This test neither changes nor waits on either selector.
- The FUCQ-477 M1/FUCQ-515 live-binding hold remains, and Bugs FUCQ-513 to 516 stay capture-only.
