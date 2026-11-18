# FUCQ-481 remote ordering into the durable consumer: 17 November 2026

This note covers one component test. It links the real `HttpOrderingProvider` to the existing durable `OrderingService` on native PostgreSQL, across a lost acknowledgement and a service restart. It was authored from `45d1c1afc05858c6f2d123d1958dd86ed625214a`, whose API tree matches integration `234856497`. **Parent validation compiled and ran the exact method at frozen source `00f600dcd7ff695e1f370d1a6092d037806bea1b`: one passed, zero failures, errors or skips.** It changes no screen and no production source.

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

## Validation observed by the parent

The author ran no compilation or runtime. The parent subsequently ran exactly:

`RemoteOrderingConsumerPgTest#lostAcknowledgementReconcilesSamePersistedSelectionWithoutSecondExecute`

The finite offline Maven/JDK21 run used one fork, owned native PostgreSQL16 and a private loopback HTTP substitute. **One test passed, zero failures/errors/skips**, exit0 in20.8seconds. No Quarkus startup or browser run was selected. Peak RSS was702,611,456bytes and scratch101,989,024bytes, within the retained chunk limits.

The parent independently matched the exact selected method, unchanged source/tool pins, all64 recorded process identities and seven groups absent, owned scratch removed and host reservation registry empty after release. The retained local receipts are `.claude/test-runs/receipts/fucq481/ordering-consumer-1021/20261117T102805-fucq481-ordering-consumer-1021-unit.json` and `.claude/fucq481-ordering-consumer-parent-audit-1026.json`. No OneDrive access occurred.

Imhotep2 independently reviewed frozen source with no blocking or major finding; reviewer runtime was UNRUN. Requested and selected reviewer settings were `gpt-6.1-sol` / `high`, no fallback or descendants. The author reported `claude-opus-5-5` / high through the existing successor watcher, no descendants; effective settings remain independently unverified. This note's validation prose is the only change from the reviewed two-file source; the Java SHA256 remains `3ee2050b710dcd2d586d5b70787dd8c1f4bcac97446b31657a4cebacc41e2226`.

This verifies the service/client recovery component on the same PostgreSQL schema. It does not prove an independently restarted operating-system process or either original Story criterion.

## What it does not prove (original AC remain open)

- The fixture's converter and policy are test doubles of the source authority. They do not prove account or startup composition, real sign-in, email, the whole claim-to-order journey or BMW integration.
- `HttpOrderingProvider` is still **unbound at startup**. The ordering selector belongs to FUCQ-468: `OrderingSelection.java` is foreign, and `OrderingServiceHolder.java` was released by the Claude lane in assignment 17. The binding waits on MSG-2026-11-17-GC-001. The full order/status path still reaches the refusing FUCQ-458 `AccountSelection.policy()`. This test neither changes nor waits on either selector.
- The FUCQ-477 M1/FUCQ-515 live-binding hold remains, and Bugs FUCQ-513 to 516 stay capture-only.
