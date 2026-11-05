# Offer decisions · FUCQ-106

Contract checkpoint, 5 November 2026. This is the independent decision boundary;
producer/access/expiry, downstream, runtime and native acceptance remain open.
No screen or policy seed changes are included. Follow `experience-quality.md`,
the supplied account/replace-vehicle shell references and current Density tokens.
FUCQ-105 consumes the outcomes below; an accepted offer is employee selection,
not an approved order or a changed current car.

## Source and ownership

The clean story base is `2b796010f54d1b720e8b13f044496c8e175c07a7`.
Readiness uses actual interfaces, not Jira journey order. Immutable source reads:

| Source | Evidence / required use |
|---|---|
| FUCQ-100 `a7fc8580efba36c329b2479711d6b66db53962bd` | `buddy-hold.js` persists exact hold/claim/quote/offer and current employee/slot/brief pins; `buddy-remote.js` retains exclusion during uncertainty; `recommendation/index.js` exports the internal stored-subject evaluator using the same calculation kernel. |
| FUCQ-102 `ec70522c81e8b9f671a3c92cd46eea4cd0a13000` | Actual privately branded account/token capability; `authorizeOffer(context, { runId, offerId }, 'decide')` checks binding/session/current run/stored offer. Its contract SHA256 is `bc1dcaff59fec98086041ccf9f6701d128a51407e90545eaf5d5d9b199b163f2`. Historical `ec70522` rechecked account `read` for `decide`. Verified newer published `b87653662cb9a9ab5efe148f8f3e985b2ffa4aea` passes the action into its guard and uses real resource `write` for `decide`; the access owner is adding an observer regression test. There is no current write-guard defect claim. |
| Current foundation | Repository `decisions`, `pending_operations`, `event_receipts`, immutable quotes/briefs; occupying hold/claim states; real PolicyService, DemoClock, identity and BriefService. |

Owned new paths: `server/gcsp/offers/decision.js`, `decision-http.js`, dedicated
`server/test/gcsp-offer-decisions*.test.js`, this contract and evidence. Root
coordinates imports of immutable source paths and central runtime registration.
No whole-branch merge, dirty-source copying, schema, producer, identity, brief,
policy seed, evaluator or central-host edits are part of this allocation.

## Commands and presentation

`OfferDecisionService.decide(accessContext, command)` accepts exactly:

```js
{
  commandId, runId, offerId,
  decision: 'accept' | 'decline',
  reasonCode,                 // required only for decline; absent for accept
  expectedOfferVersion, expectedHoldVersion, expectedQuoteVersion
}
```

IDs are nonempty bounded strings; versions are positive integers. Browser input
contains no employee, roles, prices, facts, policy, expiry, operation or event ID.
`access.authorizeOffer(accessContext, { runId, offerId }, 'decide')` precedes all
reads/receipts. Token authority is one offer, never an employee session. The
repository scope is built from the verified binding; the calculation subject is
built only from current persisted employee/run rows and contains no session roles.

Proposed POST `/api/gcsp/offers/:offerId/decision` body is the command without
`offerId`; the path supplies it. Existing shared access gate, exact credentialed
origin check, current account/token resolution and `no-store`/`no-referrer` headers
are required before the adapter runs. No listener is introduced here.

An `ok` or `pending` response has the following safe `value`:

```js
{
  schemaVersion: 1, runId, offerId, commandId, decisionId,
  requestedDecision: 'accept' | 'decline',
  state: 'accepted' | 'declined' | 'pending' | 'expired',
  reason,                    // stable outcome code; no employee facts
  offerState, holdState, offerVersion, holdVersion, quoteVersion,
  quoteId, policyVersion, expiresAt, serverNow, clockVersion,
  availableActions: [],
  operationId: null | '...', reconciliationRequired: false | true
}
```

`pending` means `selection-pending`/`decision-pending` or `release-pending`;
it asserts neither accepted selection nor available stock. Historical command
responses stay immutable. `readOperation(accessContext, { runId, offerId,
operationId })` separately describes current reconciliation and checks the same
one-offer binding. A new command on terminal/pending authority returns `conflict`
with safe current state and `action: 'refresh'`; it never repeats a decision.
Version conflicts are `stale-version`, `action: 'refresh'`. At the exact deadline
new decisions refuse with current `expired` presentation; FUCQ-100 remains the
only expiry mutator. Missing policy or unsupported source/adapter fails closed
as `unavailable`. Malformed input is `invalid`; expired credentials and stale runs
retain FUCQ-102's safe refusal. No raw token, employee record or brief is returned.

HTTP mappings: `ok` 200, `pending` 202, `invalid` 400, `forbidden` 403,
`not-found` 404, `conflict`/`stale-version`/`stale-run` 409, `unavailable` 503.
Account/session refusal mappings remain those of the existing access adapter.

## Transaction and pinned revalidation

Each logical command uses repository command ID
`offer-decision:<offerId>:<commandId>`. Its digest binds the full validated caller
command, verified environment/run/offer and operation schema version, including
decision, reason and every expected revision. Stable decision/operation/event IDs
derive from that identity. Same input replays its original response; changed
input conflicts. Authorisation/current-run checks still precede replay.

Inside one repository transaction recheck the current environment/run, clock
instant/version and current policy pin; load and compare the exact offer, hold,
single claim, immutable quote, stock, current employee, entitlement slot and latest
confirmed brief. Compare owner/car/configuration/quote/policy/brief/deadline pins
across rows, occupying/terminal states and other car/slot/renewal authority. The
expected offer/hold/quote revisions bind employee intent. Current employee/slot/
brief/stock/run revisions are captured and compared before commit/reconciliation.

Accept checks live eligibility, essentials, driver permission and explicit
employee selection authority against the stored subject and shared evaluator.
Pausing background search does not by itself revoke the employee's ability to
decide an existing offer. Current confirmed requirements are authoritative; a
material change asks for review. Evaluate the held exact car as available only in
the internal calculation view after verifying actual ownership. Use the quote's
retained policy version for prices/allowance/terms; a newer active points version
never changes the quote. Check current eligibility rules separately at the current
run policy version. Validate quote time, facts/terms identity and essentials using
the shared kernel; do not mint a role or mutate the quote to make it pass.

Local confirmed acceptance atomically sets offer `accepted`, hold/claim
`allocated`, stock `allocated` with unavailable flags, slot `allocated`, inserts
the decision and emits its typed event. Allocated hold/slot authority stops new
buddy holds for this entitlement/renewal. Failure rolls back the complete write
set. Current-car, approval and handover remain unchanged.

Local decline validates the fixed reason and canonical exclusion rule, then
atomically records a separate `decline` decision, sets offer `rejected`, hold/claim
`released`, stock released/available, and emits the typed event. The decision's
`versions.brief` identifies the approved historical brief for the existing
`BriefService.changeAfterDecline`; its `versions.exclusion` retains key/value and
policy provenance. The declined exact car remains excluded for this employee
until a relevant confirmed brief change under `offer.declinedCar.exclusion`.
No preference, consent, priority, satisfaction or brief row changes on decline.
FUCQ-100 expiry creates no decline/reason/exclusion/priority record.

## Canonical reason registry proposal

Add exactly one assumption entry through the policy owner, not this story's seed
edits. Proposed key **`offer.declineReasons.v1`**, unit `reason-registry`, type:

```js
{
  schemaVersion: 1,
  reasons: [
    { code: 'body-style', label: 'Body style', attribute: 'body' },
    { code: 'size', label: 'Size', attribute: 'sizeClass' },
    { code: 'fuel', label: 'Fuel type', attribute: 'fuel' },
    { code: 'equipment', label: 'Equipment', attribute: 'equipment' }
  ]
}
```

Status `assumed`; source `docs/gcsp/offer-decisions-contract.md`; sourceDate
`2026-11-05`; basis: FUCQ-106's fixed typed list and HLD blueprint 06/07,
plausible demo categories, no BMW policy verification. Activate additively in the
canonical next policy version through the shared policy/activation procedure,
retain historical pins, and read through `PolicyService.getAssumption` at the
current run policy pin. Never introduce a consumer fallback list. FUCQ-105 receives
the server projection of this same registry. A changed label/category is one
canonical source change; an unregistered reason cannot write a decision.

## Remote uncertainty and events

Remote selection/release persists intent **before** any adapter call, using
`pending_operations.operationType = 'offer-selection' | 'offer-decline-release'`,
stable `operationId` as provider idempotency key, digest, attempts, intended
decision, lastKnownState and exact row/quote/clock/subject pins in `payload`.
Selection holds/claims become `selection-pending`, offer `decision-pending`;
release holds/claims/offer become `release-pending`. Stock stays held and the
slot/car exclusion remains. Network calls run outside the repository transaction.
Adapter success must confirm the exact operation/car/hold identity; timeout,
unavailable, malformed or mismatched acknowledgements retain uncertainty.
Reconciliation uses original intent and never renews TTL or converts expiry into
decline. Definitive selection refusal restores prior active state and original
deadline only when authority is unchanged, then FUCQ-100 expiry may act. Decline
release refusal retains exclusion/pending visibility until release is confirmed.

Proposed native event storage uses existing append-only `event_receipts` with
`consumerId = 'offer-decisions:events:v1'`, stable `eventId`, eventType
`offer-accepted` or `offer-declined`, `state: 'completed'`, canonical input digest,
inputVersions and `outcome: ok({ event })`. No mail outbox job represents a domain
event. Each confirmed event has:

```js
{
  schemaVersion: 1, eventId, type, runId, offerId, holdId, quoteId,
  decisionId, commandId, employeeId, entitlementSlotId, renewalId, orderUuid,
  occurredAt, policyVersion, briefVersion,
  reasonCode: null | '...', exclusion: null | { key, value, policyVersion }
}
```

Internal event payloads include scoped employee authority for handoff/second-offer
consumers, never in the public decision DTO. Consumers query the native event
namespace, verify run/type/digest/versions and keep their own consumer receipt.
FUCQ-108 consumes `offer-accepted` idempotently; FUCQ-107 consumes
`offer-declined` only after confirmed release. Ordering selection versus downstream
handoff must agree which adapter confirms which action; unknown consumer wiring
is open acceptance, not replaced with captured mail or a fixture success.

## Stable plan and open integration gates

Product component: existing `offer-journey`; association FUCQ-106 already verified.
Stable slices are recorded through `_tools/product_map.py`:

1. `decision-protocol`: command/result/event/exclusion/idempotency contract and exact source plan.
2. `policy-reasons`: canonical additive fixed registry, provenance, activation and real-policy tests.
3. `decision-service`: independent transactional service/HTTP adapter and meaningful narrow tests.
4. `producer-access-expiry`: actual FUCQ-100 producer, both real FUCQ-102 capabilities and FUCQ-100 expiry.
5. `remote-events`: real remote uncertainty protocol and accepted/declined consumer integration.
6. `runtime`: coordinated central host and handler registration; no competing central writer.
7. `final-validation`: authored acceptance, native/full-suite and integrated response evidence.

Before imports, root must coordinate the minimum immutable producer/evaluator/
access files (and their precise import closure), including the already corrected
account `decide` write guard at `b876536` rather than historical `ec70522`. Policy activation is an exact additive proposal above. Remote adapter
selection/release and downstream consumption need agreed executable ports.
The independent service can progress with injected ports over real memory/
PolicyService/DemoClock/identity; fake capability success never closes actual
access or integration slices. No full suite, native PostgreSQL, browser, listener,
network/mail or installation is granted in this allocation. Root owns serial
integration/full-test admission; the authored `npm test` remains an open gate.

## Independent implementation checkpoint

`decision.js` exports `OfferDecisionService` / `createOfferDecisionService`. Trusted
composition injects `{ repository, policy, clock, access,
createStoredSubjectEvaluator, mode: 'local-synthetic' }`; the evaluator factory
is the actual shared stored-subject export when coordinated. Missing evaluator
refuses acceptance. Remote mode is explicitly unavailable until its separate
protocol is integrated. `readReasons` projects the current-run canonical registry;
`readOperation` returns only exact-offer live progress, without editing receipts.

`decision-http.js` exports `createOfferDecisionHandler({ service, resolveAccess,
allowedOrigins })`. The trusted resolver receives `{ selector, cookie, action }`
and must resolve the real FUCQ-102 token/account capability, failing closed for an
invalid presented offer cookie. It returns `ok({ context })`; nothing serializes
that authority. The handler requires explicit `gateAuthorized: true`, exact Origin
on commands, bounded JSON and no browser identity claims. GET
`/api/gcsp/offers/:offerId/decision-reasons?runId=...` projects the same registry.
Actual central dispatch/resolver composition is still open.

The final independent checkpoint has 23/23 scoped passes and exact code hashes in
`evidence/fucq106/scoped-service-checkpoint.json`. Fixtures use the actual merged
shared calculation with a genuine account bridge; they do not establish the
unimported stored-subject factory or FUCQ-102 capability parity. No source import
expansion has occurred. The real-account guard is verified corrected at
`b876536`; the access owner reports its focused regression published at
`a3fdcdfdc7b5d6c0c4f38744101b355ab6359bed`.

Canonical policy activation is coordinated through FUCQ-103's existing reviewed
assumption bundle and same-provider adoption/CAS path. There is no seed/provider/
schema shortcut or active fallback. All seven slice gates remain unfinished.
