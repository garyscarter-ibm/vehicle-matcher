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
Central registration routes these paths to this adapter before the normal
employee-only identity handler. Trusted `buildServer({ gcspOfferAccess,
gcspIdentity, gcspAllowedOrigins, gcspClock })` composition is supported; absent
dependencies return unavailable. The normal application bootstrap is a separate
unverified integration boundary.

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
Account capabilities recheck `identity.authorizeResource(..., 'write')` for
`decide`, and `read` for views. The token capability checks its private one-offer
session binding and expiry without creating or consulting an employee identity.

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
  availableActions,      // [], ['decline'] or ['accept', 'decline']; no optimistic actions
  handoff, selection,    // FUCQ-108: pre-accept ordering terms / post-accept stages, else null (shared-contracts.md)
  followup,              // null | { decisionId }; verified completed decline only
  quote: {
    quoteId, configurationId, orderUuid, orderNumber, briefVersion, policyVersion,
    revisions,
    quotedAt, validUntil, facts, decision, terms, allowance
  },
  comparison: {
    status: 'unavailable', // or 'partial' for the reviewed model metadata below
    reason: 'pinned-current-car-comparison-unavailable',
    comparisonAvailable: false,
    currentCar: null,     // or { model, source: { mode, sourceVersion, observedAt } }
    unknowns: ['configuration','body','fuel','seats','boot','mpg','zeroTo62','points']
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

For an eligible offer awaiting decision with matching active offer/hold authority,
the quote deadline gates acceptance. Before `quote.validUntil`, both `accept` and
`decline` are available; at or after it, only `decline` remains available until
the persisted hold deadline. At or after `expiresAt`, no actions are available.
Pending selection/release and final states still expose no optimistic actions.
This presentation never extends a deadline, refreshes a price or mutates authority;
FUCQ-106 owns the corresponding transactional command validation.

The exact nested allowlist implemented by `access.js` is:

| Path | Fields and types |
|---|---|
| `followup` | `null` or exactly `{decisionId:string}`. The persisted FUCQ-106 `offer-decision:<opaque digest>` handle; no event, actor, command, receipt or employee ID is added. It selects a follow-up; it is not authority. The persisted entitlement slot must match run, owner and slot, with a positive revision at least the decision's historical slot pin. A populated slot renewal must agree with the verified hold/native event; null/absent slot renewal uses that existing persisted binding. Null/absent historical brief renewal is unpopulated; every explicit conflicting or malformed renewal refuses the handle. The existing all-null renewal case stays null without inventing an identity. Full slot content and revision join the mixed-read rechecks. |
| `quote.orderNumber` | Seven-digit **string** (leading zeros retained), or null when unavailable; never inferred from configuration/VIN. |
| `quote.revisions` | `quote`: positive integer; optional `brief`, `facts`, `policy`, `stock`, `snapshot`, `terms`, `clock`, `availability`: supplied string/number/null revision. |
| `quote.facts` | `contractVersion: 'vehicle-snapshot-v1'`, `candidateKey`, `sourceNamespace`, `snapshotVersion`, `observedAt`: strings; `identityKind: 'exact-stock'`; `sourceKeys: { stockId: string }`; `display` and `facts` below. No VIN or additional source keys. |
| `quote.facts.display` | `name: string`; optional string `manufacturer`, `model`, `derivative`, `colour`; `photo: string|null`; `images: Array<{src: string, alt?: string, caption?: string, fidelity?: string, sourceRef?: string}>`. Unknown nested image fields are dropped. No display link is copied. |
| `quote.facts.facts` | Map restricted to `eligibilityModelKey`, `body`, `fuel`, `seats`, `doors`, `boot`, `zeroTo62`, `mileage`, `evRange`, `mpg`, `cc`, `year`, `sizeClass`, `tags`, `frontIsofix`, `rearIsofix`, `gearbox`, `transmission`, `colour`, `interior`, `co2`, `power`, `torque`, `electricRange`, `equipment`, `options`, `availableFrom`. Values are the `Fact` below. No other fact name is copied. |
| `Fact` | `{status: 'known'|'unknown', value: string|number|boolean|null|Array<string|number|boolean|null>, unit: string|null, provenance: Provenance}`. Unknown remains `value:null`; unsupported complex values refuse presentation rather than leaking an object. |
| `Provenance` | `{sourceRef: string, observedAt: UTC string, version: string, assurance: 'unknown'|'confirmed-listing'|'confirmed-build'|'model-reference'|'derived'|'synthetic-scenario'}`. |
| `quote.decision` | `gateStatus: 'eligible'|'ineligible'|'needs-confirmation'`, `score: number|null`, `reasons`, `tradeOffs`, `blockers`, `unknowns`: arrays of string or the `Explanation` below. No brief, employee facts, full eligibility result or assumptions payload is copied. |
| `Explanation` | Optional `code`, `text`, `key`, `field`, `keys`, `facts`, `attribute`, `preference`, `direction`, `expected`, `actual`, `target`, `desired`, `observed`, `unit`, `allowance`, `monthlyPoints`, `score`, `weight`, `importance`, `ruleIds`, `requiredBy`, `availableFrom`: supplied scalar/null or scalar arrays. Object-shaped `facts` is restricted to the public vehicle fact names and `Fact` shape. For a public vehicle `field`, optional `fact: Fact` and `requirement: {value?,operator?,unit?}` retain only scalar/scalar-array evidence. Employee/driver/charging fact objects are not copied. |
| `quote.terms` | `kind:'employee-scheme'`, `termsVersion`, `validFrom`, `validUntil`: strings; `points:{value: nonnegative number,unit:'points'}`; `allowanceInputs:{allowance?:{value: nonnegative number,unit:'points'}}`; `contribution:null|{amount:nonnegative number,currency:three-letter string,period:'month'|'year'|'one-off'}`; `provenance:Provenance`. Scheme points and allowance mean points a month. No retail purchase price or independently computed top-up. |
| `quote.allowance` | Same pinned `allowanceInputs` shape. Missing allowance stays missing; no current-policy fallback. |

The committed `evidence/fucq102/representative.json` is a safe sample generated by
the real recommendation evaluator, PolicyService, DemoClock and access service
over explicitly synthetic inputs. It is presentation-schema evidence, not a
claim that the real FUCQ-100 producer or deployed route has been exercised.

FUCQ-100 at published `a7fc8580efba36c329b2479711d6b66db53962bd` pins
`eligibility.currentCarComparison` alongside facts/decision/terms/allowance. Its
reviewed `display` supplies only a partial model label and dated source metadata;
it does not supply authenticated VIN/configuration/specification/current points.
The reader accepts `schemaVersion:'1'`, `comparisonAvailable:false` and
`display.state:'partial'` with a nonempty model of at most 256 characters and
`source:{mode:'synthetic'|'dated-snapshot'|'authorised-live',sourceVersion:string,
observedAt:UTC string}` no later than quote time. It returns only those model/source
fields, `status:'partial'`, `reason:'current-car-facts-unavailable'` and the eight
unknowns listed above. It never copies internal `binding`, contract/employee/slot
identifiers or revisions, `sourceRef`, raw manual records or inferred facts.
Absent/malformed/future/unreviewed metadata returns the unavailable/null fallback.
`evidence/fucq102/comparison-representative.json` shows this additive DTO, generated
by the reader over explicit synthetic pinned metadata matching that reviewed shape.
It is not actual producer-to-access evidence or completed FUCQ-105 comparison.

The later approved immutable composition proof exercises actual FUCQ-100 allocation,
expiry and reset against this reader over synthetic inputs. Its safe samples are
`evidence/fucq102/producer-representative.json` (before quote expiry) and
`evidence/fucq102/producer-decline-representative.json` (at quote expiry, with the
same active hold and only decline available). See `decline-timing-result.md` in that
directory for exact source, strict targeted evidence and remaining integration gates.

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

## Decline follow-up entry · authored 6 November 2026

The approved [entry plan](evidence/fucq102/followup-entry-plan.md) is now authored in
the access-owned service with focused regressions. It has not executed under its
new mixed-source graph; the existing 32/32 result remains evidence for its unchanged
covered paths, not proof of this lookup.

An authenticated current offer read recovers `followup: { decisionId }` only from
one persisted FUCQ-106 decline for that exact offer and its single completed native
`offer-decisions:events:v1` / `offer-declined` receipt. The private lookup verifies
owner/run/car/hold/quote/slot/renewal, typed reason, current policy and quoted-policy
pins, original successful result, event digest and input versions, and immutable
confirmed historical brief. Terminal offer/hold revisions come from the successful
post-write outcome; decision input versions are pre-write. Stock may have been used
again after release. Reads preserve the deadline and never reserve the car again.

All other states return `followup: null`. A consistently read declined offer also
returns null when its follow-up source is missing, duplicate or malformed; the
declined outcome and empty actions remain authoritative. FUCQ-105 should show an
unavailable follow-up with explicit offer refresh, and preserve the new field through
its strict projection. Repository failures and changed query membership, row contents
or clock/run authority return typed retryable `unavailable`. The extra reads extend
the existing consistency refusal; separate reads are not a new atomic snapshot.

Cookie reload and account access reissue a genuine private context using the same
composed access instance injected into FUCQ-106. No new selector endpoint or request
field is introduced. There is no serialised brand or employee-role conversion.
FUCQ-107's existing employee-authenticated read/confirm routes independently verify
the ordinary employee session and decision ownership. Its host can receive the
handle recovered by FUCQ-105 after refresh; the original offer URL retains only its
existing `offerId` and `runId` selectors. Token-only access cannot authorise follow-up.

No lookup read writes a row or command receipt, changes a brief, extends time,
releases a hold or invokes allocation. Actual 106/107 execution, 105 projection/host
adoption, browser and central/runtime integration remain separate open gates.

## Deployment and validation boundaries

The landing URL comes from trusted `createGcspRuntime({ offerLandingUrl })` or,
when omitted, backend `GCSP_OFFER_LANDING_URL`. Configure the GCSP static site's
full HTTPS page URL for email delivery, including any deployment path prefix.
The same-origin local demo defaults to `/gcsp/offer`; an explicit root-relative
path is also supported. Invalid configuration returns `invalid-offer-landing-url`
before storage opens. Neither request bodies nor browser origins choose this value.
Both local and remote FUCQ-100 producers receive the same trusted setting and
retain allowed configured query context. They add public `offerId` and `runId`;
the opaque token remains in its fragment with the unchanged environment/run/offer
hash binding. Notification delivery carries the persisted link unchanged.
See [the implementation and selected evidence](evidence/fucq102/landing-config-2026-11-06.md).

Independent checks cover real memory repository/PolicyService/DemoIdentity/DemoClock,
the exact published token verifier, every presentation state, no business mutation,
account parity, hash/session persistence, reset/expiry/race refusal and mocked HTTP
streams, plus actual `buildServer` registration over one owned loopback listener.
Actual producer-to-read, local expiry lifecycle, remote uncertainty, application
bootstrap, deployed cookies/origins and the
authored `npm test` remain integration gates until their observed evidence exists.

Backend only: no screen or new component is changed. The inspected shell references
are `docs/gcsp/screens/00-employee-account.webp` and `01-replace-vehicle.webp`;
body reference `docs/gcsp/evidence/fucq-6/README.md`, revision `a7fc178`.
FUCQ-105 follows the shared Density tokens, concise copy, Used Cars hierarchy and
the required rendered keyboard/narrow checks from `experience-quality.md`.
