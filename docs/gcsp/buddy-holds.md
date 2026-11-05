# Buddy hold and offer producer · FUCQ-100

This record describes the independent backend implementation on `dev/DEV-2026-11-04-060`.
It is not evidence of actual FUCQ-96 allocation invocation or completed FUCQ-66 service integration.
The authored expiry, remote reconciliation and full-suite checks remain outstanding at this checkpoint.

`server/gcsp/offers/buddy-hold.js` exports `BuddyHoldService` and
`createBuddyHoldService({ repository, policy, clock, identity, adapter })`.
The first slice supports the explicit adapter mode `local-synthetic`; another mode returns unavailable.
It adds no HTTP route, screen, database migration or runtime dependency.

## Allocation candidate input

`allocate(context, input)` currently requires the exact employee context issued by DemoIdentity,
including its run, environment, employee, entitlement, scheme, company, grade and policy version.
A copied context is refused. The allocation command is:

```js
{
  commandId,              // stable logical allocation attempt
  orderUuid,              // exact released car; never configurationId or VIN
  expectedBriefVersion,   // current confirmed BriefService version
  expectedStockVersion,   // repository stock row.version before the claim
  expectedSlotVersion,    // repository entitlement_slots row.version
  expectedEmployeeVersion // repository employees row.version
}
```

All expected revisions are positive integers. Extra fields are invalid, including caller facts,
employee/run authority, a quote, token, digest or a precomputed eligible decision. The service derives
the command digest and stable hold/claim/quote/offer/job identities itself. A successful repeated
command returns its original response; changed input under the same logical command conflicts.

The actual paused FUCQ-96 checkpoint `6f15d4d524e7a207ce705befe1d52d8c54ce1cfa` publishes a
presenter-only `DemoIdentityAdapter.resolveEmployeeContext(controller, employeeId)` seam. It issues
an adapter-branded employee context using stored employee/slot authority and controller expiry;
it mints no cookie/session. That identity extension is not yet on this branch, so no substitute or
broader worker bypass is introduced here. The producer calls `claim.tryClaim(employeeContext, input)`
with `operationId`, `eventId`, `runId`, employee/slot/renewal/car IDs, a pinned quote and
`expectedVersions = { stock, slot, brief, permission, employee, policy, clock }`. `tryClaim` accepts
that exact published shape, validates all seven revisions, and checks the supplied configuration,
snapshot, typed terms, employee facts and explanations against fresh transactional evaluation.
Its operation ID is `allocation:` plus the digest of `[runId, eventId, employeeId, orderUuid]`.
The allocator's whole-pool stock version is distinct from the single-candidate evaluation container;
the exact stock row revision and semantic source pins remain authoritative.

Renewal authority is `brief.renewalId ?? slot.renewalId ?? employee.renewalId ?? null`.
A supplied candidate/context renewal must agree with that stored value. Holds and claims preserve it,
and an allocated record for the same renewal blocks another slot. The tests construct the published
candidate with the real evaluator and DemoIdentity context; they do not load or invoke the paused
producer. Actual pinned-source invocation remains unproved. DemoClock startup's backend identity
remains a separate FUCQ-96 composition edge.

## Atomic authority and presentation shape

One repository transaction checks the current clock/policy, employee authority and repository revisions;
reads the current immutable brief through a transaction-bound real BriefService; checks independent
search/hold consent and pause; obtains released/visible exact stock and stored employee/driver facts;
and calls the real brief/recommendation gate for eligibility, essentials, affordability and availability.
Bound repository reads and the revalidated clock avoid nested repository locks.

The transaction inserts the pinned quote before `conditionalClaim`, because the shared authority
requires that quote reference. It temporarily changes released stock to the repository's `available`
vocabulary, conditionally claims that exact `orderUuid`, then records `state: held`, `available: false`,
`held: true`, `allocated: false`, an active buddy offer and one pending notification. All these writes
commit together. A stale or conflicting attempt creates no quote/hold/offer/job; late failures roll
back the earlier writes, including stock flags and revisions.

The hold is `type: buddy-offer`, `state: active`, with `holdId`, `quoteId`, exact `orderUuid`, employee
and entitlement, policy version and server expiry. The quote retains the exact snapshot, full typed
terms and provenance, confirmed brief version, source revisions and the hold-policy provenance.
The response is:

```js
ok({
  state: 'offered', hold, quote, offer,
  notification: { jobId, state: 'pending' },
  now, clockVersion, proposedCapability: true
})
```

`offer` includes its current state, identity, hold/quote references, brief/policy versions and expiry;
it excludes token hash/metadata and the plaintext link. Conflict says `try-next-candidate`; stale
revisions say `refresh-allocation`. Neither implies that allocation has actually selected another car.
Later page consumers must read actual current offer/hold state rather than revive this original command
response. No offer-page implementation or new browser surface is supplied here, so new screenshots
are unnecessary. The experience contract, shared components and existing Density references remain binding.

Expiry is computed from DemoClock plus PolicyService `hold.buddy.durationSeconds`. The pinned assumption
provenance and `proposedCapability` distinguish this configurable proposal from verified BMW policy.
The service also reads `hold.employee.maxActive`, `hold.deadline.inclusive`,
`hold.pending.blocksReallocation` and `hold.replacement.releaseFirst`; it has no local policy defaults.

## Token and captured notification boundary

`offer-token.js` mints 32 random bytes, encodes them as an opaque base64url token and stores only a
domain-separated SHA-256 hash bound to environment, run and exact offer. Verification uses constant-time
comparison. Plaintext is absent from service responses and offer metadata. The relative landing link
is `/gcsp/offer?offerId=<encoded>#token=<opaque>`; the fragment is for the later offer-access consumer,
not an implemented page or an authentication bypass.

The outbox job has `messageKind: offer`, `messageVersion: '1'`, `offerId`, employee `recipientId`,
`transport: captured`, `state: pending`, `attempts: 0` and `payload.offerLink`. Its stable key is
`offer:<offerId>:notification:offer:1`. The existing captured notification consumer owns rendering,
delivery state and retries; this story sends nothing externally.

The narrow repository repair removes only `payload.offerLink` from the automatic outbox insert
receipt and marks its deliberate reconstruction in `inputVersions`. On the same original input
digest, replay restores that link from validated original insert input while retaining the receipt's
original state, version, timestamps and other payload. It never reconstructs from the mutable job.
Changed input conflicts. Generic insert receipts, link-free outbox jobs, rollback and isolation keep
their existing semantics. Arbitrary callbacks explicitly returning secrets are not sanitised.

**Remaining strict-token consumer issue:** existing `notify:attempt` and `notify:failure` callbacks
return full outbox jobs into their enclosing command receipts. The dispatcher granted a separate
consumer repair and dedicated regressions after the insert/compatibility checkpoint. Until those
paths are repaired and tested, token custody after dispatch remains incomplete. No existing-state
purge or live token inspection is authorised or claimed.

## Validation boundaries

The pre-repair scoped retained-`pg` loader variant reported 24 tests, 23 pass and one failure: the
insert-receipt token regression above. The repaired scoped variant passes 57/57 buddy and dedicated
receipt checks; repository/outbox/renewal-case boundaries pass 80/82 with two configured native
PostgreSQL skips. The boundary run has strict targeted evidence against `4700bb0`. Dependencies are
read-only named retained `pg`/`jsdom` loader resolutions, not an installed/default/full environment.
Receipts and impact identities are retained under shared `.claude/test-runs/fucq100/` and
`.claude/test-runs/impact/fucq100-atomic.json`. The real memory
repository, DemoClock, DemoIdentity, BriefService and PolicyService
exercise atomic success/replay, pinned terms, policy duration, hash bindings, stale revisions, permission,
essential/eligibility failure, rollback after earlier writes and concurrent contention. Raw cart/buddy
`conditionalClaim` tests prove only the common exclusive constraint. Actual completed FUCQ-66 both-way
service proof, actual FUCQ-96 producer invocation, expiry/reconciliation and the authored `npm test`
remain outstanding. No native database or external sending proof is claimed.
