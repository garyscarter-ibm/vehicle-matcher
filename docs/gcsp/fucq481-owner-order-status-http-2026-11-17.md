# FUCQ-481 owner order and status over HTTP: 17 November 2026

This extends one existing test. After a generated claim and the owner's accepted offer, the owner now reads their order and status through the real `GET /api/gcsp/v1/manual/order`. It was authored from `3a8078831`; the account and ordering source it relies on was read at ROOT `01965530a`. **The parent ran the exact method: 1 passed, zero failures, errors or skips.** It changes no screen and no production source.

## Path and method

`services/gcsp-api/src/test/java/gcsp/api/offers/GeneratedClaimRemoteOrderingHttpTest.java`, method `generatedClaimAcceptedByOwnerJwtIsAcknowledgedOnceThroughSelectedRemoteOrdering`. Profile, stub and fixture instant are unchanged.

## The boundary now exercised

1. **Unchanged first half.** Generated canonical claim, owner RS256 JWT through JWKS, then the accepted offer. The application persists `selection_orders`.
2. **New: the owner's read.** The same bearer token calls `GET /manual/order`.
   - `OrderingResource.read` authenticates the employee and requires the owner.
   - `OrderingSlots` reads the slot from `AccountService.readAccount`, under `gcsp.account.provider=repository`.
   - At ROOT `3542ff697` and later, `AccountSelection` binds `AccountPolicyPort` to `PolicyAccountAdapter` over `PolicyService`, and `CurrentCarPort` to `ReturnsCurrentCarRelationships`, so this projection can be ready.
   - The route then calls the selected remote Holder's `read`. If the handoff is still pending, it calls `reconcile`.
3. **New assertions on the HTTP body.**
   - 200, status `ok`, value `acknowledged`.
   - The stub's `providerReference`, plus the persisted hold id and quote id.
   - `view.state` = `awaiting-approval`.
   - Exactly one remote execute after the read, and still one after a repeated read.
4. **Ordering.** Before the read, the test only checks that the decision drove at most one execute. It does not call `service.read` or `reconcile` before the route. So the route's own read, and its reconcile when the state is pending, are what settle and show the order.
5. **Unchanged second half.** The explicit `service.reconcile` now answers from the settled record. The POST lineage, pending operation, outbox event, hold, car and replay assertions all stay.

## Finite run, parent-owned

`-Dtest=GeneratedClaimRemoteOrderingHttpTest`: one method and one Quarkus boot, with native PostgreSQL (`GCSP_TEST_DATABASE_URL`), JWKS and the two loopback stubs. It should run on the latest ROOT composition. Its earlier retained pass covers the old method body, not this one.

## Least-certain point

The profile does not set `gcsp.account.fixed-now`, so the account projection uses the system clock, while policy uses the fixture instant `2026-11-14T09:00Z`. The seeded record is effective from `2026-11-05`, so it is effective at any later wall time. If the slot's collection window is closed at real time, the account state would not be `ready`. Then `ordering.enabled` would be false, but the route still finds the slot through the existing selection (`existingSlot`). If the read fails, the parent's run will show the exact code; the test does not mask it.

## Still open

- **Not proved:** a registered real OIDC issuer or browser login; real mail; the hosted environment; any BMW service; shaped inputs varied across all ports; FUCQ-516 later-clock recovery.
- **Holds:** F477 M1 / FUCQ-515 stays held; Bugs 513-516 remain capture-only.
- **Not complete:** neither original acceptance criterion.

## Parent validation — 2026-11-17T12:29:13.413261+00:00

The exact Java source from worker `209bf4f7aabcb6cf84621c5830edeb9e6de42087` passed in immutable current-root context `661185fca372e9a979610572954d468aa97eee50`, which includes the integrated selected-account adapter and F458 bindings. The single native PostgreSQL16 / Quarkus / JWKS / loopback-remote method passed in 26.0 seconds. The real owner bearer `GET /manual/order` returned the acknowledged order with persisted hold/quote/provider lineage and awaiting-approval state; repeated reads retained one remote execute. This uses signed fixture JWTs and a fixture policy instant, not a registered provider browser login or later-clock recovery.

The parent audit `.claude/fucq481-owner-http25-parent-audit-1213-ordering.json` independently verified 77 recorded child identities plus the supervisor, 20 process groups, owned scratch and the reservation absent, with source/tool pins unchanged. Peak RSS was 958,087,168 bytes and scratch 103,432,224 bytes. No profile or production source changed. Both original criteria, real OIDC/mail/hosted/BMW, all-port variation and FUCQ-516 remain open.

Independent Doug the Dog 3 review33 passed with no findings (requested/selected `gpt-6.1-sol` / high, no fallback, descendants or reviewer runtime; title confirmed). Review covered the exact tested Java; this parent validation section replaces the source-only UNRUN headline.
