# Buddy remote lifecycle · review plan

FUCQ-100 / DEV-2026-11-04-060, 5 November 2026. **Proposed, awaiting the dispatcher's remote edit
grant.** This document changes no executable remote behaviour. Existing permission covers the pushed
local producer, notification custody, isolated pinned allocator proof and local expiry only.

## Frozen sources and edit boundary

Current product checkpoint: `b4154ce3bfe195564a2d9f17980309d76e545eba` on
`dev/DEV-2026-11-04-060`. Buddy module SHA-256:
`5b1fb81f461e2cd6f02059fc5064b3799dd9cf0a5a56a1e1c1f778b7db8c05e5`.
Core remains the reviewed insert-receipt repair, SHA-256:
`a6a5ae5f9fe4fd9a9e2d31a4aa38cd99a2ab3a4015c5abefd9a0a229983ad1b0`.

Reuse the actual FUCQ-66 envelope, read-only source
`eb5a677b37c486e3da7c4547803f739e22df8ac3:server/gcsp/manual-claims/index.js`, SHA-256
`32c80ef72d8329fcdbc4a208d9ab911f68156e6234d3917975754415d04ef059`.
Published contract: `f81855f:docs/gcsp/manual-claims-contract.md`, SHA-256
`9c31f6f368ed4ed616c755eed168ae6bd75869cf65c4efc811eb0a2cd0cff294`.
The adapter has `mode: remote`, `execute(operation)` and `reconcile(operation)`. Acknowledgements
are `confirmed | rejected | not-found`, bound to operationId, runId and exact orderUuid.

Requested owned changes: `server/gcsp/offers/buddy-hold.js`, optional private helpers under that
same offers directory, new `server/test/gcsp-buddy-remote.test.js`, owned lifecycle tests and additive
documentation. No manual-service, repository schema/core, identity, policy seed, allocator or central
`server/index.js` edits. Shared BriefService/evaluator remain the eligibility owners; any missing
internal evaluation port is a scope question before editing those modules.

## Proposed transitions

1. The initial employee call still requires the exact real DemoIdentity context. Revalidate all
   current pins, consent/pause, confirmed brief, authority, visibility, eligibility, essentials and
   terms before committing a quote, shared `claim-pending` hold/claim and durable `buddy-claim` intent.
   Persist the originally authorised subject, semantic source pins and permission/brief versions in
   the intent. No offer, plaintext token or notification exists at this point. Stock remains excluded.
2. Persist intent before invoking the adapter outside the transaction. The operation keeps the
   existing envelope fields: operationId, operationType, idempotencyKey, inputDigest, holdId,
   lastKnownState, state, attempts, payload. Payload contains run/car/employee/slot/quote/expiry,
   expected source versions and target/reason. Stable operation IDs derive from the original logical
   command and operation type. Never use a tick ID or retry time to create another claim.
3. Internal tick/startup work may drive only a previously authorised persisted intent. It re-reads
   current run, original subject authority, consent/pause, brief, policy, source facts/terms and
   eligibility. It neither issues a session nor calls an employee write entry with a fabricated
   context. Refactor a private stored-intent validation path using shared read-only eligibility
   calculation; retain public identity guards. If that cannot reuse the current public evaluator
   without fabricating authority, report the missing internal port before broadening scope.
4. A new intent can execute once after validation. Subsequent drives reconcile first. Execute again
   only after a matching authoritative `not-found`, rechecking prerequisites first. Exceptions,
   unavailable responses and mismatched envelopes remain pending and excluded. Provider error text
   is neither persisted nor logged. Re-read the operation/hold versions before accepting an ack.
5. A matching confirmed claim creates active hold/claim, hashed offer and one outbox job atomically
   only if the original sources and consent are still valid and the original deadline is future.
   It never extends the deadline. A matching rejected claim can retire failed local authority.
   Confirmation after source invalidation or expiry must first create a bound `buddy-release` intent;
   retain exclusion until that release is confirmed. An uncertain claim cannot be freed merely
   because local prerequisites changed.
6. Remote active expiry creates `release-pending` hold/claim/offer plus durable release intent.
   Matching confirmed release expires them and restores released stock together with the receipt.
   Rejected, uncertain or mismatched release retains exclusion and exposes a reconciliation outcome.
   No decline or priority is introduced. Local expiry continues its existing behaviour.

Register private handlers before clock sealing: `buddy-expiry` at `buddy-expiry`, and an owned stable
handler at `pending-operation-reconciliation`. The latter handles only `buddy-claim`/`buddy-release`
operations; FUCQ-66 keeps its own operation types. Central composition remains a separate grant.

## Replay edge requiring an explicit integration decision

The exact pinned FUCQ-96 producer at `6f15d4d524e7a207ce705befe1d52d8c54ce1cfa` accepts only
`ok | conflict | stale-version` from tryClaim. On pending it leaves its plan at the same candidate;
it has no operation-status read port. Meanwhile a durable original pending command outcome must stay
historical after reconciliation. Blind replay would return that pending outcome forever.

Keep the original command receipt unchanged. Proposed integration: a separately named, authenticated
current-operation read returns pending or the safe terminal result; FUCQ-96's owner consumes that
projection when resuming its pending plan. This is a future agreed producer-port change, not permission
to edit or resume the paused allocator. The bounded remote service may be implemented independently
with this integration explicitly outstanding. Do not silently make same-command replay change from
pending to offered. If a different settled protocol already exists, obtain its exact source first.

## Selected validation and remaining gates

Proposed scoped synthetic-adapter tests cover confirmed/rejected claims, interruption and repeated
startup, reconcile-before-retry, matching not-found, mismatched bindings, stale ack snapshots,
permission/brief/stock/policy changes, elapsed deadline, invalid-source confirmation followed by
release, uncertain/rejected release, atomic rollback, one offer/outbox and token custody. Exercise
real shared repository and lifecycle workers; adapter fixtures prove the protocol, not a live provider.
Then select current buddy allocation/expiry, notification/token receipts and clock/reset boundaries.

Each allocation requires a fresh HostBudget, external manifest and finalizer, owned TMPDIR, recursive
PID/group start identities, frozen source/dependency checks and parent cleanup audit. Bounds remain
120 seconds, 768 MiB RSS, 128 MiB scratch, 2 MiB logs, one worker. Use only the named read-only retained
dependency loader. No DB credential reads, native/full/network/server listener or large artifact grant.

Actual completed FUCQ-66 both-way service proof, current shared-base adoption, merged FUCQ-96/identity
startup composition, central registration and authored full-suite validation remain separate admission
and acceptance gates. Jira dependencies remain context; these concrete ports and source permissions
determine pickup. Experience/build/readiness contracts remain binding; this is backend-only with
presentation-state proof and no new screen requiring screenshots.
