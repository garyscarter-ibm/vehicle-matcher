# Buddy hold and offer producer · FUCQ-100

This record describes the independent backend implementation on `dev/DEV-2026-11-04-060`.
The isolated published-source FUCQ-96 invocation is proved below; merged startup composition and
completed FUCQ-66 service integration remain outstanding.
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
producer. The separate pinned-source proof below now exercises actual invocation. DemoClock startup's
backend identity remains a separate FUCQ-96 composition edge.

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

The separately granted notification repair makes `notify:attempt` receipts retain only job ID,
version, attempt number and state; `notify:failure` retains only state. The dispatcher re-reads the
durable job after the attempt commits or replays, then checks its state/version/attempt and complete
snapshot again immediately before transport and before success/failure bookkeeping. Obsolete work
does not substitute a newer payload or overwrite newer bookkeeping. Captured rendering retains the
link only in the outbox row; provider exception text is discarded. No existing-state purge or live
token inspection is authorised or claimed.

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
service proof, merged FUCQ-96 startup composition, expiry/reconciliation and the authored `npm test`
remain outstanding. No native database or external sending proof is claimed.

The corrected notification scope passes 28/28 tests: actual cryptographic producer through captured
delivery, interrupted recovery/replay, retries and final failure, 16 pre-send races, eight during-send
races and obsolete descriptor replay. Captured outbox, renewal-case and brief boundaries pass 57/57,
with strict targeted evidence against `4700bb0` retained in
`.claude/test-runs/fucq100/strict-notify/targeted-0c4b4200c5f8ecb147b72a873b6d5a0e9ec9fb821023b51410226f89baefb7f0-default-1793918866123269000.json`.
This remains the explicit scoped retained-dependency loader variant; no full/native proof is implied.

The dispatcher-granted isolated proof uses the exact published FUCQ-96 allocator and identity blobs
from `6f15d4d524e7a207ce705befe1d52d8c54ce1cfa` with current real repository/policy/clock/brief/evaluator
and BuddyHoldService at pushed checkpoint `6d6ecf0`. Two tests pass: actual allocation plus same-event
replay, and actual next-candidate fallback after a real stock CAS makes the first claim stale. The
claim wrapper delegates every outcome to the real buddy service. One confirmed claim creates exactly
one hold/claim/quote/offer/outbox, and token-containment checks cover producer output and non-outbox
tables. Exact blobs are hash-verified in owned scratch; the narrow loader remaps only those modules'
relative imports, current identity to the pinned identity, and the named retained `pg` entry. No paused
source, worktree or current product file is changed. Shared evidence:
`.claude/test-runs/fucq100/pinned96-plan-v1.json` and `parent-pinned96-audit.json`.
This proves isolated published-source invocation, not merged runtime/startup, native durability or
actual completed FUCQ-66 integration.
