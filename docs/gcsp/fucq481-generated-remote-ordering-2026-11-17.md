# FUCQ-481 generated claim to selected remote ordering: 17 November 2026

This note covers one composition test. It follows a generated canonical claim, accepted by its owner through a real RS256 JWT, into the application's own selected remote ordering. It was authored from `2f93f830b`, whose API tree matches integration `3e0235593`. **The parent ran the frozen test successfully: 1 passed, zero failures, errors or skips.** It changes no screen and no production source or configuration.

It proves this partial boundary at the fixed fixture instant. It is not the full HTTP order and status journey, it does not vary shaped inputs across every port, and it involves no hosted, BMW, real OIDC registration or mail service. Neither original acceptance criterion is complete.

## Files

- `services/gcsp-api/src/test/java/gcsp/api/offers/GeneratedClaimRemoteOrderingProfile.java` extends the retained `GeneratedClaimRemoteOfferProfile`.
  - It changes only `gcsp.ordering.provider=remote` and `gcsp.ordering.timeout=2s`.
  - Its test resources are `JwksServerResource`, the unchanged `GeneratedClaimRemoteOfferResource` and the new ordering resource.
  - The only alternative is the inherited `FixturePolicyClock` (same instant, `DecisionEnv.NOW`). The inherited exclusion of `OffersTestPorts.Records` keeps the production PostgreSQL offer reader.
- `.../offers/GeneratedClaimRemoteOrderingResource.java` is a `QuarkusTestResourceLifecycleManager` that owns a 127.0.0.1 JDK `HttpServer`. It returns `gcsp.ordering.execute-url` and `reconcile-url` before CDI starts.
  - **GET `/ordering/reconcile`** answers a fictional `not-found` echoing the three ids, or the stored confirmation.
  - **POST `/ordering/execute`** stores one fictional `confirmed` acknowledgement once per operation id. It echoes `orderNumber`, `configurationId`, `orderStatus` = first approval stage, and `providerReference` = `gcsp-remote-order:<operationId>`.
  - **`/ordering/stats`** reports counts and the observed requests.
  - It stops in `stop()` and on its own start failure.
- `.../offers/GeneratedClaimRemoteOrderingHttpTest.java` has one `@QuarkusTest` method: `generatedClaimAcceptedByOwnerJwtIsAcknowledgedOnceThroughSelectedRemoteOrdering`.

## Data lineage and the application services used

1. **Startup.** Identity is `oidc` and Buddy is `remote`. `OrderingServiceHolder.provider()` and `OrderingProviderBindings.mode()` are both `remote`, and the CDI beans resolve to the production classes. The bindings hold an `HttpOrderingProvider`. `Holder.service()` is present and cached. The stub has had no request.
2. **Claim.** `Allocation.service().allocate(...)` runs over the retained source inputs only. It computes the offer, hold, quote and an acknowledged `buddy-claim` exactly as the retained test does.
3. **Decision.** The owner token (RS256, served by JWKS) reads `/manual/order/terms` and the offer, then POSTs an accept. The application persists `selection_orders` itself (source `buddy-offer`, the quote id), and the decision operation names that selection.
4. **Ordering.** The test calls `service.reconcile(scope, selectionOperation)` on the injected Holder service. This is the boundary `SelectionOrderTickHandler` uses, so no clock is advanced and no account-dependent order route is called. If the decision's own submit already drove the handoff, this call answers from the record.
5. **Assertions:**
   - The result is `Ok` with status `acknowledged` and the stub's `providerReference`.
   - There is exactly **one** remote execute, preceded by a same-id GET lookup.
   - The POST carries the persisted operation id (header and body), the idempotency key, `pending_operations.input_digest`, the stock `orderUuid`, `orderNumber` `1000001`, the configuration, the first approval stage, the run, the employee and the slot.
   - The `selection-order` pending operation is `acknowledged`, with the reference and a fictional confirmed outcome. One `ordering.selection-acknowledged` event carries the reference.
   - The hold and car stay `allocated`. `service.read` shows the hold id, the quote id and `awaiting-approval`.
   - A replayed reconcile does not execute again.

No `OrderingService`, `OrderingProviderBindings`, `HttpOrderingProvider` or `AccountPolicyPort` is constructed or faked by the test. No generated row is altered or reseeded.

## Finite run, parent-owned

`-Dtest=GeneratedClaimRemoteOrderingHttpTest`: one method and one Quarkus boot. It needs native PostgreSQL through `GCSP_TEST_DATABASE_URL` (the retained resource creates and drops its own schema), the JWKS resource and two loopback stubs: the Buddy `RemoteOperationServer` and this ordering stub. It needs the module's JDK 21 tooling.

## Least-certain composition assertion

That the owner's accept leaves the ordering handoff settleable by `service.reconcile` at the fixture instant. The decision flow calls `submitTrusted`, which drives the provider itself, through the same Holder service. So the explicit reconcile may be the first drive or a replay; the test accepts either and still requires one execute in total.

The selected native run resolved these assertions successfully at the fixture instant; later-clock behaviour remains unproved.

## Hashes

At commit time the parent should pin the hashes of the four files from the result JSON. Runtime: **UNRUN** by the author.

## Still open

- Both original acceptance criteria. The full order and status HTTP journey still needs the account policy binding, which the Russell F458 lead owns. The hosted dev environment is absent, per Gary.
- The F477 M1 / FUCQ-515 hold continues; FUCQ-516 later-clock recovery is not repaired. Bugs 513-516 remain capture-only.

## Parent validation, 17 November 2026

Frozen source `20d71cb9f7fec1f5043cf541cf5b53c5feba4c8a`, tree `70f9f78ee0ac3729e0c5493777039f6ba4c7d6c6`: exactly the one named method passed with zero failures, errors or skips in 27.0 seconds. It used actual Quarkus startup, native PostgreSQL16, owner RS256 JWT/JWKS, selected remote Buddy and the production cached Holder service with selected remote ordering. The durable acknowledgement, provider reference, source lineage and single execute survived a reconciliation replay. This does not execute a clock tick or the account-dependent full order/status HTTP route.

Independent Imhotep 2 source review passed (requested/selected `gpt-6.1-sol` / high, no fallback, descendants or reviewer runtime). Parent independently matched the frozen source/tool pins and observed all 77 recorded child identities plus supervisor, 19 groups, owned scratch and host reservation absent. Peak RSS was 951,418,880 bytes and scratch 103,247,328 bytes. Retained receipts: `.claude/results/fucq481-generated-ordering-review-29.json`, `.claude/fucq481-generated-ordering-parent-audit-1111.json` and `.claude/test-runs/receipts/fucq481/generated-ordering-1111/20261117T111309-fucq481-generated-ordering-1111-unit.json`.

The three Java files match the tested freeze byte for byte; this note adds parent validation. The author reports `claude-opus-5-5` / high in the existing watcher; effective settings remain independently unverified. Both original criteria remain open. No OneDrive access occurred.
