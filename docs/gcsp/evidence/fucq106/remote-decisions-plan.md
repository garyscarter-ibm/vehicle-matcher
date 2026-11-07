# FUCQ-106 remote decisions: next implementation plan

6 November 2026. **Proposal only; documentation allocation.** The dispatcher
accepted the actual 12-case memory integration at `53cbb58` and requested this
finite source/API/ownership plan. No remote code, adapter execution, canonical
policy adoption or consumer integration is allocated by this document. The
original claim/worktree and stopped worker observation remain in place. No
acceptance criterion or product-map slice becomes complete through this plan.

The next implementation should add a decision-owned durable lifecycle while
preserving FUCQ-100's confirmed claim custody. Remote decline can be scoped
separately once its release adapter contract is supplied. Remote accept needs an
agreed source-conversion and FUCQ-71/108 intake seam first: the published ordering
service cannot consume today's accepted event through its public `submit` API.
Keep unsupported remote decisions unavailable until those concrete ports exist.

## Read basis and retained scope

[remote-decisions-sources.json](remote-decisions-sources.json) records immutable
refs, SHA256 identities, byte counts and timestamped remote observations for the
17 source/contract files read for this plan. These were text reads, with no feature
imports. The FUCQ-71 commit was fetched into the object store without changing a
checkout or branch. This manifest is separate from the preserved, reviewed
[integration-source-plan.json](integration-source-plan.json); it is not an
approved execution/import closure.

| Boundary | Immutable read |
|---|---|
| Existing 106 decision service/HTTP | `53cbb58d6b9eeb776dd6e70fb27c862972cfb150` |
| 100 producer, remote custody, repository, clock and BriefService | `a7fc8580efba36c329b2479711d6b66db53962bd` |
| 102 private access service | `4a56d386f031e7cf5a1fdeaefdcc612fb35cbd7b` |
| 71 common ordering implementation/contract | `ed20ca2a774d9368b4fce87a7e69b5e2ae30a7e8` |
| 107/108 authored consumer contracts | shared `329c522f52de5fd7c02497d3a14e96bb9275a6ad` |

The dispatcher's latest native FUCQ-106 description was updated **6 November
2026, 00:09:45.770 UTC** (the source field displays 5 November with offset
`-0600`). Its local read-only notice is recorded by path and description digest
in the manifest. It retains real accept revalidation, pinned quote, typed
PolicyService reason, confirmed release, original command outcome, current
conflict, both access routes, stale-run refusal and separate records. Its Decided
references the foundation, transaction/event invariants, blueprint 06/11 and
Q15/Q16/Q19. Ordering handoff, brief change and UI remain outside 106. No Jira or
foreign story body was changed.

Readiness follows [the technical-readiness direction](../../technical-readiness-2026-11-05.md),
[build rules](../../build-rules.md) and [experience contract](../../experience-quality.md).
The actual interfaces below determine readiness; unfinished Jira journey links
alone do not block independent work. Retain claim ownership and explicit source,
resource and execution limits.

## Current executable APIs

`OfferDecisionService({ repository, policy, clock, access,
createStoredSubjectEvaluator, mode })` exposes `decide(context, command)`,
`readReasons(context, selector)` and
`readOperation(context, { runId, offerId, operationId })`. `decide` validates the
strict existing caller command, authorizes the genuine private one-offer context,
then refuses any mode other than `local-synthetic` with
`remote-decision-protocol-required`. Its transaction loader also refuses any
hold/claim/offer `operationId`; even an active remote-produced offer therefore
cannot enter the current local mutation path. Removing that guard alone is unsafe.

Access remains the same instance's
`authorizeOffer(context, { runId, offerId }, 'decide')`. It rechecks current run,
account write permission or private token/session authority. The resulting
repository scope has `principalId: 'service:offer-decisions', roles: []`.
Reconciliation uses stored intent and current service scope; no token is stored,
no expired credential is replayed and no employee role is manufactured.

`readOperation` currently allowlists only `offer-selection` and
`offer-decline-release`. It checks row/payload offer, run and environment and
returns only schema/run/offer/operation IDs, type, state, lastKnownState,
operationVersion, reconciliationRequired, serverNow and clockVersion. It neither
drives an adapter nor rewrites the historical command receipt. Preserve that
safe distinction; FUCQ-71's internal `selection-order` snapshot is not a public
one-offer DTO.

`BuddyHoldService({ repository, policy, clock, identity, adapter }).start()`
registers `buddy-expiry` at stage `buddy-expiry` and, in remote mode,
`buddy-pending-operations` at `pending-reconciliation`. It requires
`adapter.mode === 'remote'`, `execute(operation)` and `reconcile(operation)`.
Its `BuddyRemoteLifecycle` has `drive(context, operationId)`,
`reconcile({ context })`, and `expire({ context, now, clockVersion, transaction })`.
That lifecycle owns **only `buddy-claim` and `buddy-release`**.

100 prepares/CASes a durable attempt in a repository transaction, calls the
adapter outside it, then reloads the exact attempted operation and current rows
before applying an acknowledgement. Its current acknowledgement binding is
`operationId + runId + orderUuid`, status `confirmed | rejected | not-found`.
It does **not** require an echoed holdId or providerReference. First valid claim
attempt can execute; otherwise it reconciles. Only authoritative `not-found`
returned by reconciliation permits re-execution; execute's absence response
does not. Unknown/malformed/wrong-scope results retain occupied authority.
Rejected release stays pending. This is a useful protocol precedent, not 106
operation support or evidence of a conforming external provider.

`DemoClock.registerHandler({ handlerId, stage, handle })` must run before sealing,
startup or ticks. Handlers receive `{ context, eventId, tickId, now, clockVersion,
operationId, transaction }`; `transaction(work)` carries the clock handler's
durable command. Startup is `reconcileStartup(environmentId)` once per backend
instance. Stage order, then handler ID, determines execution. A pending handler
must return a complete envelope with operationId/type/lastKnownState. Replaying
the same tick returns its historical outcome; a new tick/startup observes later
progress. No private polling timer is needed.

## Custody and storage invariants

A remote-created active hold, its paired claim and offer still point to the
**confirmed original `buddy-claim` operation**. 100 validates its full immutable
quote, subject/slot/renewal/car/deadline/authority pins and the original
`command:transaction` receipt, whose outcome remains the original pending claim.
Its expiry handler processes only active rows still pointing at that confirmed
claim, then creates a `buddy-release`. Its reconciler filters only its own types.

106 must validate that origin before taking decision custody. Persist the origin
ID, digest, receipt identity and relevant pins in the new decision payload;
preserve the original operation and receipt. Attach a distinct decision operation
to all three rows atomically while changing their pending states. Do not relabel
the original claim, clear its history, or submit a 106 row to 100's lifecycle.
While decision-pending, 100's existing active/operation checks exclude expiry;
106 alone reconciles that decision. A refusal that restores active authority
must restore the **original claim operationId on all three rows**, then allow
100 to expire an overdue hold on its normal clock path. Never restore null IDs
or give 106 a competing expiry writer.

Existing schema permits pending rows with `operationType`, `idempotencyKey`,
`inputDigest`, JSON `payload`, `providerReference`, `lastKnownState`, `state`,
`attempts`, `outcome`, `intendedDecision`, `holdId` and `offerId`. The primary key
is `(runId, operationId)` and uniqueness is `(operationType, idempotencyKey)`.
`selection-pending` and `release-pending` are occupying hold/claim states.
Repository CAS requires exact versions, rejects terminal-to-occupying transitions
and rechecks constraints. Transactions commit complete `ok` or `pending`
envelopes and preserve the original command receipt.

No 106 schema change appears necessary for intent/custody. This is not proof of
the separate native active-selection uniqueness/migration gate retained by 71.
106 must also recheck competing car/slot/renewal authority in its transaction;
uniqueness of a decision operation key alone is insufficient.

Persist pending intent in `pending_operations`, **without a `decisions` row
labelled `decline` before release confirmation**. Actual
`BriefService.changeAfterDecline` checks `decision === 'decline'` and the retained
approved brief reference, rather than remote release state. An early decline
decision would therefore authorize follow-up too soon. Insert the final decision,
exclusion provenance and source event together only after confirmed release.

## Proposed smallest owned implementation

These are proposed paths/APIs, not existing exports or a grant to edit them.

| Owned file | Bounded change after allocation |
|---|---|
| `server/gcsp/offers/decision.js` | Reuse private access, authoritative loading, shared evaluator and policy reads; distinguish validated remote origin from local authority; prepare intent, finalize confirmed outcome, and expose explicit pre-seal startup registration. Preserve caller command and original response. |
| new `server/gcsp/offers/decision-remote.js` | Decision-only attempt/CAS/ack lifecycle with `drive(context, operationId)` and `reconcile({ context })`; injected adapter and trusted transaction callbacks into 106 validation/finalization. Filter 106 types only. No copied evaluator, producer lifecycle or timer. |
| new `server/test/gcsp-offer-decisions-remote.test.js` | Dedicated bounded lifecycle and custody tests, using real producer/access/clock at the integration boundary once that exact source closure is approved. |
| own contract/evidence | Update the response/protocol contract and identities after the actual implementation and its checks. |

Add a constructor-injected adapter and proposed `start()` on 106; fail closed
unless the adapter explicitly supports the required **decision operation** and
clock registration succeeds. Proposed handler ID:
`offer-decision-pending-operations`, existing stage `pending-reconciliation`.
Central runtime registration stays with its coordinated writer. Existing
`decision-http.js` already projects pending/current-operation outcomes; change it
only if a demonstrated response-contract gap requires an additional owned edit.

No producer, repository/schema/migration, identity, BriefService, evaluator,
policy seed/registry, central host, ordering adapter or consumer source is in this
minimal 106 edit set. An exact immutable import closure and fresh resource
allocation must be reviewed before feature imports/tests. The 17-file text-read
manifest does not enlarge the accepted first39 closure.

### Durable decision phases

1. Authorize before command replay. Use the existing
   `offer-decision:<offerId>:<commandId>` transaction identity and digest binding
   the validated command plus verified access binding. Derive stable decision,
   event and new operation IDs server-side. Exact replay returns the original
   pending/terminal response; changed intent conflicts. New contradictory command
   on pending/terminal authority returns safe current state.
2. In one transaction, recheck current run/clock, exact offer/hold/claim/quote,
   stock, employee, slot, brief and competing authority. Validate current accept
   eligibility separately from retained quote pricing, or pin the current typed
   reason/exclusion policy for decline. Require a confirmed aligned 100 origin.
   Snapshot original custody plus expected **post-preparation** row revisions,
   immutable quote and subject/brief/policy/clock/deadline pins. Insert intent
   before I/O. Set hold/claim `selection-pending`, offer `decision-pending` for
   accept; all three `release-pending` for decline. Stock stays held/unavailable.
3. Attempt under short transactions; external call runs outside them. Store
   attempt count/phase before dispatch and reload the exact attempt plus current
   authority before applying any response. Process pending rows deterministically.
   After a possible send, reconcile before any resend, including restart. Only
   scoped authoritative reconciliation `not-found` allows the same operation/key
   to execute again. Never generate a fresh key to resolve uncertainty.
4. Apply confirmed outcome and final decision/source event atomically. Preserve
   `originalResponse` and command receipt; mutable operation state is read
   separately. A crash after preparation, provider confirmation, local finalization
   or response loss must converge without a duplicate effect.

**Adapter contract still needed:** `execute(operation)` and
`reconcile(operation)` for `offer-decline-release`, and a decision on whether
`offer-selection` represents a separate source reservation conversion at all.
The proposed stricter ack binds operation/run/environment/order/**hold** and
operation kind or digest; providerReference is optional audit data unless the
adapter contract makes it authoritative. Neither 100's existing weaker ack shape
nor 71's ordering adapter satisfies that proposed contract automatically. Agree
the exact required echoes with the adapter writer and test each mismatch; do
not fabricate provider fields or acknowledgements.

| Observation | Required decision behavior |
|---|---|
| Timeout, exception, malformed or mismatched ack | Pending/unknown, no event or stock release; retain all exclusions. |
| Authoritative reconcile absence | Same ID/key may retry only after live intent/custody validation; execute absence alone cannot authorize retry. |
| Confirmed decline release | Exact authority CAS releases hold/claim/stock and rejects offer; insert typed decline, retained reason/exclusion provenance and one `offer-declined` event. No brief or priority mutation. |
| Rejected decline release | Remain occupied/pending with truthful failure detail; release is not confirmed. |
| Definitively rejected accept with no conversion | Restore original active claim custody/deadline only if unchanged. After deadline, 100 performs expiry; no renewed TTL. |
| Confirmed accept with changed eligibility/deadline | No automatic accepted event or free car. Requires the agreed source adapter's compensation/reconciliation contract, retaining occupancy until confirmed resolution. This path is not executable from current ports. |
| Deadline crossed during an earlier decline release | Refuse new decisions. Reconcile the already authorized intent; a still-aligned confirmed release may complete that stored decline with its original reason pin. An independently expired offer never gains a decline. |
| Run reset or authority divergence during I/O | Refuse old-run/new-run effects and stale finalization; preserve the operation for named reconciliation. Do not free or allocate current-run stock from an old acknowledgement. |

Accept completion must repeat current stored-subject validation without repricing
the retained quote. Decline completion preserves the reason/exclusion policy
accepted with the original intent; a later policy activation does not silently
rewrite it. Provider-confirmed but locally divergent authority needs an explicit
resolution path, not endless blind retries or an optimistic terminal response.

## Actual 71/108 selection boundary

FUCQ-108 is **DEV-2026-11-04-075**; FUCQ-107 is **DEV-2026-11-04-085**.
DEV-076 is FUCQ-111 lifecycle. The inspected shared and 71 trees contain no
executable 107/108 consumer. At the manifest's observation time, no 075/085 branch
or story lease was returned by the exact remote-ref query. The 071 branch and
lease were present. This is timestamped source availability, not an assertion
about subsequent claims or worker activity.

71's actual `ManualOrderService({ repository, identity, clock, policy, terms,
converters, adapter })` exposes `registerClockHandler()`, `readTerms(context)`,
`submit(context, input)` and `readOrder(context)`. Registration uses
`selection-order-reconciliation` at `pending-reconciliation`. Public reads/submit
require a genuine employee role and current context. Submit accepts exactly:

```js
{ commandId,
  source: { type: 'cart' | 'buddy-offer', holdId,
    expectedHoldVersion, expectedDraftVersion },
  expectedQuoteId, expectedStockVersion, termsDigest, declarations }
```

It reads canonical `ordering.terms.v1` and `ordering.approvalStages.v1`, verifies
the explicit applicable declarations and a draft mode `new | replacement`, and
requires an active exact hold and valid quote. Its converter contract is
`prepare(context, source)` plus
`convertSelection(context, allocationInput, { commitSelection })`. The trusted
callback records ordering selection intent/history while the hold is **active**;
the source authority then converts in the **same transaction**. Its retained
`allocate` fallback uses two transactions and does not satisfy final atomicity.
The actual buddy converter is explicitly left to 108.

71 persists one `selection-order` operation with ID/key
`selection:<digest([runId, employeeId, entitlementSlotId])>`, immutable selection
snapshot and phase `allocation-pending`; source hold reference is in payload,
deliberately absent from top-level holdId. It observes hold, single claim, stock
and slot all allocated before phase `handoff-pending`. It calls its **same**
ordering adapter, reconciling before execute. Confirmation binds operation/run/
order, existing seven-digit orderNumber, configurationId and first configured
approval stage. Unknown remains pending; scoped rejection records handoff
failure, keeping allocation. The supplied synthetic adapter accepts only
`selection-order`, stores fictional durable provider receipts and proves no real
BMW acknowledgement. It cannot receive a 106 operation by changing its type.

Concrete integration gaps at these exact versions:

- 106 emits `offer-accepted` **after** it has atomically allocated the hold, claim,
  stock and slot. Replaying that event into public 71 `submit` fails its
  active-hold check. Loosening that check would bypass source conversion.
- 106's private offer scope has no employee role. 71's employee public submit
  cannot be called with it; persisting/minting employee credentials is unacceptable.
- Actual 100 quotes carry `briefVersion`, not a manual `draftVersion`. 71 expects
  quote/draft matching, driver/contact/old-contract choices and declarations.
  106's existing command and event contain none of those selections. A converter
  cannot assert declarations or silently invent a manual draft.
- 71 checks `quote.policyVersion === context.policyVersion`. The accepted 106
  contract deliberately permits older quote prices and separately current
  eligibility. Its buddy intake must preserve that distinction.
- A new 106 external selection write followed by 108's call to the same ordering
  adapter could create two owners of selection. Existing source reservation
  conversion and downstream ordering handoff need explicit distinct semantics.

**Recommended coordinated seam:** 71/108 provide a trusted, event/source-scoped
intake and server-owned snapshot preparation, with actual authority for any
required declarations/driver facts. 106 can invoke a narrow injected transaction
callback while its verified hold is still active, so selection intent and source
conversion commit together; pending remote conversion remains occupied. Once
source conversion is confirmed, 106 emits the existing accepted event. 108 then
idempotently attaches/drives the **already-recorded** common ordering operation,
records selection on the brief through its agreed authority, rechecks allowance
with the pinned quote and projects target states. This avoids initiating another
allocation on event replay. The callback/intake API is a proposal for the 71/108
writers to agree, not an existing callable or new 106 handoff scope.

If owners instead choose an intake for an already-confirmed allocation, they
must explicitly demonstrate the authored same-transaction hold/selection-intent
requirement. Consuming the event later does not itself prove that atomicity.
No 106 accept implementation should choose or fake this shared contract alone.

## Actual 107 decline boundary and event consumption

106 already records confirmed source receipts under
`consumerId: 'offer-decisions:events:v1'`, `eventType: offer-accepted | offer-declined`,
stable eventId/digest, inputVersions and `outcome: ok({ event })`. The internal
event carries employee/slot/renewal/car/hold/quote/decision identities plus typed
reason/exclusion and policy/brief provenance. Public decision DTOs omit that
authority. Source insertion is distinct from downstream consumption.

108 owns accepted-event consumption and the actual buddy/common-ordering seam,
brief selection record, allowance gate, pending/acknowledged projection and
configured target stages. It owns its consumer receipt and the proposed
`server/test/gcsp-buddy-handoff.test.js`; 106 does not write its implementation.

107 owns declined-event consumption, the PolicyService reason-to-question map,
explicit employee confirmation, follow-up/second-offer projection and UI. Its
real BriefService call is:

```js
changeAfterDecline(employeeContext, {
  commandId, expectedBriefVersion, decisionId, change: { path, value }
})
```

The service verifies the employee, recorded decline and approved historical
brief, permits exactly one preference-value/essential change and appends a
confirmed brief version. The decline event is not employee confirmation or a
credential for this call. 107 then integrates actual brief-changed re-evaluation,
presenter release tick, allocator and 100 producer, compares two stored quotes,
and calculates a no-match when appropriate. Its dedicated
`server/test/gcsp-second-offer.test.js` and rendered states remain 107-owned.

Both consumers must validate source run, digest/type/versions and current
authority, record their own idempotent receipt and demonstrate one effect under
duplicate delivery/restart. Pending decision, unknown release and 100 expiry
produce no follow-up/handoff event. 106 neither changes the brief nor manufactures
a second offer or consumer acknowledgement.

## Next finite validation and separate gates

After a specific implementation/source grant, select only the new remote suite
and affected decision regressions. Reuse the accepted unchanged 25/25 service and
12/12 actual-memory evidence; do not rerun them just to restate this plan. New
remote integration must use the actual producer's confirmed remote claim, real
private access and clock; explicit adapter doubles can test protocol failures
but cannot prove an unavailable provider or actual consumer.

The new focused checks should cover preparation/ack rollback; exact replay and
contradiction; origin receipt/custody corruption; simultaneous accept/decline and
expiry; loss before/after send/commit; timeout and every ack binding mismatch;
authoritative absence versus execute absence; rejected selection/restored origin;
rejected release occupancy; late response/deadline/current-eligibility changes;
run reset; new startup/tick convergence; no final decline/brief-change authority
before release; confirmed source event exactly once. Then, under a separately
approved combined closure, prove actual 107/108 consumption and common ordering
atomicity. Their fixtures alone do not close those gates.

Use one worker initially; proposed first remote chunk ceiling is 120 seconds,
768 MiB RAM, 128 MiB combined scratch/output and 2 MiB logs, subject to measured
headroom and fresh HostBudget admission. Before allocation, establish run-owned
scratch and an outside ownership manifest/finalizer, strip database aliases and
NODE_OPTIONS, use only the existing approved dependency installation, record
code/input/loader/test identities, retain bounded failure evidence, remove owned
scratch/links, join owned groups and audit processes/open files/reservations.
Split or replan if the new closure exceeds that budget. No installation, secret,
native database, network/mail, listener, browser or full-suite lane is allocated
here. Central routes/105 page state/desktop and narrow inspection, native SQL and
authored `npm test` remain the dispatcher's coordinated final acceptance work.

The canonical 103 reason registry/same-provider publication and run activation
remain a **separate execution gate**. The reviewed registration patch is still a
proposal; the five proposed 103 modules and 42-module adoption composition were
not imported or run for this plan. Keep reason/current eligibility policy pins
separate from quote-price pins. The existing actual memory proof remains valid
within its explicit alternative-reason-input scope.

This checkpoint creates only this plan and its compact source manifest. It runs
documentation/identity checks, with no feature tests, feature imports, services
or test scratch. Final story status remains blocked, with accepted scoped memory
evidence and the concrete adapter, selection-intake, policy, consumer and runtime
acceptance work above still outstanding.
