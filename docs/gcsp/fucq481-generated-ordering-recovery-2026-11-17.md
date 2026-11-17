# FUCQ-481 generated ordering recovery: 17 November 2026

One new method, for the second original acceptance criterion's failure path through the remote substitute. A generated claim and the owner's JWT decision lead to a remote ordering effect that is recorded, but whose acknowledgement is lost. The owner's real `GET /manual/order` then shows the pending handoff until a lookup finds the same recorded operation. It was authored from `e54d6c819`, reading ROOT `ad1763da0`. **It has not been compiled or run.** It changes no production source, no existing test and no screen.

## Paths and selector

- `offers/GeneratedClaimRemoteOrderingRecoveryHttpTest.java`, method `lostAcknowledgementStaysPendingForTheOwnerUntilTheSameRecordedOperationIsFound`.
- `offers/GeneratedClaimRemoteOrderingRecoveryProfile.java` extends `GeneratedClaimRemoteOrderingProfile`. It changes only `testResources`: the retained JWKS and Buddy/source resources, plus the new ordering stub.
- `offers/GeneratedClaimRemoteOrderingRecoveryResource.java` is a copy of the retained ordering stub with three changes:
  1. `execute` records the confirmation, then writes half the declared bytes and closes, the same cut as `RemoteOrderingConsumerPgTest:201-210`.
  2. A lookup of a recorded operation answers `unknown` while a test-only `POST /ordering/control?visible=false|true` switch hides it. The default is hidden.
  3. `/stats` adds `effects`, `duplicates` and `visible`.
- Selector: `-Dtest=GeneratedClaimRemoteOrderingRecoveryHttpTest`, one method with native PostgreSQL, JWKS and the two loopback stubs. The method is meant for latest ROOT, because this branch's production lacks the F458 bindings.

## Boundary and intended assertions

1. **Unchanged first half.** The application generates the claim, quote, hold and offer. The owner signs an RS256 JWT, checked through JWKS, and accepts. The application persists `selection_orders`.
2. **Lost acknowledgement.** The first owner `GET /manual/order` answers 202 with `status=pending`, `code=handoff-pending` and the selection's operation id. Its value shows `status=pending`, `view.state=handoff-pending` and no provider reference.
   - The stub shows one execute and one recorded effect.
   - `pending_operations` is `pending`, with outcome `unknown` and one of the direct test's three transport reasons.
   - No acknowledged event exists, only the received event. The hold and car stay allocated.
3. **Within the retry lease.** A repeated owner read answers 202 from the record, and no remote lookup happens.
4. **After the lease, still hidden.** The owner read makes one lookup, which answers `unknown`. The stored reason becomes `remote-ordering-unknown`, the response is still 202, and there is no second execute.
5. **Released.** After the next lease, the owner read answers 200 `ok`.
   - `status` is `acknowledged`, with the same operation id and the same provider reference.
   - The hold id and quote id are unchanged, and `view.state` is `awaiting-approval`.
   - The input digest is unchanged, with exactly one execute and no duplicate.
   - A further settled read calls nothing remote.
6. **Unchanged second half.** The retained assertions still apply: the explicit reconcile, a lookup before the execute, the execute body lineage (operation id, idempotency key, digest, stock, configuration, first stage), the acknowledged operation and event, the hold, the car, the read and the replay.

## Least-certain points and the one wait

- **The retry lease is a real obstacle to a test with no waits.**
  - After an unknown outcome, `OrderingService` sets `handoff_lease_until` to the wall clock plus its fixed 5 s backoff (`OrderingService.java:93, 421, 452`). Before then, `doDrive` returns the record without calling the provider (`:378`).
  - The holder builds the service with that constructor, so the backoff cannot be configured.
  - The method therefore makes two bounded waits up to the persisted lease (asserted at 6 s or less), with no loop or retry.
  - It does not rewrite the lease column, so no generated state is altered. This adds about 10 s.
  - If the parent rejects any wait, the alternative needs a production change (a configurable backoff), which is out of this scope.
- **Which call makes the first execute.** The decision or the owner's first read may make it. Both lead to the same pending record; the test allows at most one execute before the read.
- **The exact cut reason.** It is accepted from the direct test's set.

## Still open

- **Not proved:** a registered real OIDC issuer or browser login, real mail, the hosted environment, any BMW service, shaped inputs varied across all ports, and later-clock recovery (FUCQ-516, unrepaired).
- **Holds:** F477 M1 / FUCQ-515 stays held; Bugs 513-516 remain capture-only.
- **Not complete:** neither original acceptance criterion. An unrun method is not proof, and a cut-acknowledgement test is not Story acceptance.
