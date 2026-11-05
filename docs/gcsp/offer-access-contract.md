# One-offer access · FUCQ-102

Contract proposal, 5 November 2026. Independent modules belong to FUCQ-102;
FUCQ-100 owns token production, FUCQ-103 central registration, FUCQ-105 the page,
and FUCQ-106 decisions. This checkpoint is a contract, not integrated runtime proof.

## HTTP boundary

`POST /api/gcsp/offers/access` accepts exactly `{ runId, offerId, token }`.
The public run/offer coordinates only locate one row. Environment and current run
come from trusted backend composition. The injected, published FUCQ-100
`verifyOfferToken(token, { environmentId, runId, offerId }, tokenHash)` must verify
the complete persisted hash binding before any offer information is disclosed.
Malformed, unknown, cross-environment or tampered credentials have the same generic
`not-found` response. There is no global offer enumeration.

The exchange returns the safe current-state DTO below and sets a fresh random
`gcsp_offer_access` HttpOnly cookie scoped to `/api/gcsp/offers`. The original link
token is never put in a cookie, JSON response, receipt, log, trace or client storage.
The page extracts the fragment into memory, immediately clears it with
`history.replaceState`, submits it only in this POST body, and discards it after
exchange. A failed exchange offers reopening the original email, not storing its token.

`GET /api/gcsp/offers/:offerId?runId=<link-run>` rereads that exact offer using the
access cookie. Omit the run selector for a signed-in account's current-run offer.
Duplicate/unknown selectors and identity/role claims are invalid. Without an offer
cookie, the same handler resolves the real FUCQ-84 acting session and calls
`identity.authorizeResource(context, { table: 'offers', key: { runId, offerId } }, 'read')`.
An invalid presented offer cookie fails closed. The account path does not fabricate
an employee or accept browser-owned identity.

Every response is `Cache-Control: no-store`; the HTTP adapter also sets
`Referrer-Policy: no-referrer`. Exact configured origins, credentialed CORS, the
existing shared access gate and a present allowed Origin on POST precede parsing or
service calls. Neither GET nor the original landing request accepts the raw token.
Central registration must route these paths to this adapter before the normal
employee-only identity handler. No central route edits are in this checkpoint.

## Reload and server context

The approved persistent session namespace is
`event_receipts.consumerId = 'offer-access-session-v1'`. Its `eventId` is a
domain-separated SHA-256 of the fresh cookie credential and exact environment,
run and offer; `outcome` contains only `{ schemaVersion: 1, environmentId, runId,
offerId, expiresAt }`. The transaction command/digest contain hashes and safe
binding data only. Existing receipts are never edited. A repeated token exchange
issues a fresh session; it does not replay an unrecoverable cookie or mutate a hold.

Use PolicyService `identity.session.durationSeconds`, `identity.session.clock`
(`server-wall-clock`) and `identity.session.sameSite` at issuance. Credential expiry
uses injected trusted wall-clock time. Secure is mandatory for deployed cookies;
an explicit test-only local composition may disable it with a non-None SameSite
policy. Domain hold expiry separately uses DemoClock. Sessions survive reload and
process restart because only their hash/binding/lifetime are persisted.

The service privately brands `{ environmentId, runId, offerId }` objects in a
WeakMap. Both verified token sessions and authorised account reads produce this
same one-offer capability. It has no employee roles. It is never serialised as
authority. `authorizeOffer(accessContext, { runId, offerId }, 'read' | 'decide')`
is the future FUCQ-106 port: it rechecks the exact binding, live credential/account
authorisation, current run and current stored offer. FUCQ-106 still owns its
transactional decision validation, eligibility and hold deadline check.

## Safe current-state DTO · schemaVersion 1

An `ok` response has `value`:

```js
{
  schemaVersion: 1,
  offerId, runId,
  state,                 // pending | accepted | declined | expired | superseded
  reason,                // stable state/reconciliation reason code
  serverNow, clockVersion,
  expiresAt,             // authoritative persisted hold deadline, never a new TTL
  offerVersion, holdVersion,
  holdState, offerState,
  availableActions,      // [] or ['accept', 'decline']; no optimistic actions
  quote: {
    quoteId, configurationId, orderUuid, orderNumber, briefVersion, policyVersion,
    revisions,
    quotedAt, validUntil, facts, decision, terms, allowance
  },
  comparison: {
    status: 'unavailable',
    reason: 'pinned-current-car-comparison-unavailable',
    currentCar: null
  }
}
```

`facts` projects the pinned vehicle snapshot's display/fact/media/provenance fields;
`decision` projects `gateStatus`, score, reasons, tradeOffs, blockers and unknowns.
Explanations preserve useful typed evidence while removing employee/session/brief
payloads. `terms` and `allowance` retain the pinned monthly-points units and policy
provenance. The DTO never includes employee identity, other offers, fleet, usage
history, raw brief/employee facts, token hashes, token metadata or credentials.
No live repricing replaces the immutable quote. Unknown facts stay unknown.

FUCQ-100's published quote currently pins `facts`, `eligibility.decision`, `terms`
and `allowance`; it does not publish a pinned current-car comparison. The explicit
unavailable comparison above is the truthful initial contract. A real producer
extension and exact safe comparison fields must be coordinated before claiming
that acceptance edge; a page fixture is not its proof.

| Stored state or boundary | DTO state / reason | Actions |
|---|---|---|
| aligned active offer + active buddy hold, before deadline | pending / awaiting-decision | accept, decline only with eligible pinned decision |
| accepted offer + allocated hold | accepted / accepted | none |
| rejected/declined offer + released hold | declined / declined | none |
| expired offer/hold or aligned active rows at `serverNow >= hold.expiresAt` | expired / deadline-passed | none |
| explicitly superseded offer | superseded / superseded | none |
| decision-pending / selection-pending | pending / decision-pending | none |
| release-pending | pending / release-pending | none |
| mismatched pins, owner, exact car or inconsistent authority | unavailable | none |

Pending-operation responses describe uncertainty; they do not assert an active
offer or released stock. Reads never expire/release/revive/mutate business rows.
FUCQ-100 owns expiration/reconciliation. The exact deadline is non-actionable even
when the persisted row still says active. Terminal states remain terminal.

After full token/session verification, an earlier-run link returns only
`{ status: 'stale-run', reason: 'This offer belongs to an earlier demo run.' }`.
It returns no historical quote, state, identity or timing. An unverified old-run
selector still returns generic not-found. Reset races and changed rows refuse
mixed snapshots, asking the caller to retry rather than disclosing inconsistent data.

## Deployment and validation boundaries

The original landing URL comes from the FUCQ-100 deployment configuration for the
GCSP static site. FUCQ-102 never invents an origin or mints an offer link. FUCQ-100
is adding public `runId` beside `offerId`; the token remains in its fragment.

Independent checks cover real memory repository/PolicyService/DemoIdentity/DemoClock,
the exact published token verifier, every presentation state, no business mutation,
account parity, hash/session persistence, reset/expiry/race refusal and mocked HTTP
streams without a listener. Actual producer-to-read, local expiry lifecycle,
remote uncertainty, central host registration, deployed cookies/origins and the
authored `npm test` remain integration gates until their observed evidence exists.

Backend only: no screen or new component is changed. The inspected shell references
are `docs/gcsp/screens/00-employee-account.webp` and `01-replace-vehicle.webp`;
body reference `docs/gcsp/evidence/fucq-6/README.md`, revision `a7fc178`.
FUCQ-105 follows the shared Density tokens, concise copy, Used Cars hierarchy and
the required rendered keyboard/narrow checks from `experience-quality.md`.
