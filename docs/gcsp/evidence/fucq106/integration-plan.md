# FUCQ-106 finite integration handoff

Recorded 6 November 2026. Status: **blocked**, independent checkpoint published;
this is a read-only source/port proposal awaiting dispatcher review. No additional
source has been imported and no canonical policy has been activated. Jira journey
links are context; the concrete remaining gates below determine completion.

## Immutable composition

`integration-source-plan.json` records every source path, source ref, SHA256, byte
count and relative import edge. It reuses the reviewed FUCQ-102 producer plan
at `.claude/test-runs/fucq102/producer-1793922979495635000/plan.json` rather than
merging branches. All 35 entries were independently re-read at immutable refs and
matched to that plan: 414,203 source bytes. Its six overlays come from FUCQ-100
`a7fc8580efba36c329b2479711d6b66db53962bd`:

| Overlay | SHA256 |
|---|---|
| `server/gcsp/offers/buddy-hold.js` | `b9f1a9be9cf42552a56313492bf0703b49ed715ffe2059f477ee11637c44b3d6` |
| `server/gcsp/offers/buddy-remote.js` | `0284045ab38c22c305019ad4a560724aa233e830c6c37186d5661da430c59e01` |
| `server/gcsp/offers/current-car-comparison.js` | `c5aaf8b2e3123301d50f3dade21e89e4f88abf12ede4e2c7ed801adbc56099cd` |
| `server/gcsp/offers/offer-token.js` | `325b699d7dfdb435cd8713015017aa68bf735582f127d7d64a0e0fc819f7b915` |
| `server/gcsp/recommendation/index.js` | `08acfe895804cf60dcc178591ecbdd1816f12ce70944f832f1ae394902c7e172` |
| `server/gcsp/repository/core.js` | `a6a5ae5f9fe4fd9a9e2d31a4aa38cd99a2ab3a4015c5abefd9a0a229983ad1b0` |

The other 29 modules are hash-identical to published FUCQ-102
`a3fdcdfdc7b5d6c0c4f38744101b355ab6359bed`. They include the exact shared
BriefService, DemoClock, DemoIdentity, repository index/memory/PostgreSQL/schema/
migrations, manual ports, policy providers and recommendation dependencies. The
existing seed is a separately hashed file input. Importing the repository index
loads `pg`; use only the existing read-only package entry recorded in the manifest,
with no native connection, secret or install.

Add only these four modules for the producer/access/decision composition:

| Additional source | Immutable source / identity | Bytes |
|---|---|---:|
| `server/gcsp/offers/access.js` | FUCQ-102 `4a56d386f031e7cf5a1fdeaefdcc612fb35cbd7b`; `134e9d39253e934618f6cf38b334bb7cf0f8912443ee159e6167b949d4fdb34a` | 20,668 |
| `server/gcsp/offers/access-http.js` | same ref; `f37533eeb5309cb4eff6c6dcf0af5ab8a8819afdaa4d08b4baee0147d360e868` | 4,776 |
| `server/gcsp/offers/decision.js` | v9 tested bytes; `a934455a09beb13e3682c1f10ebea95f0549ff2fad8db03d54ff947e7ed7789a` | 23,307 |
| `server/gcsp/offers/decision-http.js` | v9 tested bytes; `223e3358569602145ecb2a5f967abf5a9e3ca78d688667d0e6c8bbb0c1779b96` | 4,782 |

Total addition: **53,533 bytes**, 39 modules including the reused 35. The 106
modules will be available at this checkpoint's final commit; hashes identify the
exact bytes independently of the commit. Their relative import closure is already
inside the 35. The new integration test entry remains to be authored, reviewed
and hashed before execution; this proposal does not manufacture its result.

Preserve one canonical project-relative module URL for every import and re-export.
The loader resolves canonical URLs once, then supplies hash-checked overlay bytes
at load time. Never import the same module through both a scratch URL and its
canonical URL. Journal and reject duplicate identities; use the same repository
core, policy class/provider, BriefService, clock and evaluator throughout. Create
one OfferAccessService instance, so its private WeakMap brands survive from
`exchange`/`fromSession`/`fromAccount` through `authorizeOffer` in the decision
service. Do not copy dirty worktrees or add a second evaluator kernel.

## Exact ports and first integration check

Compose the real memory repository, DemoIdentity, DemoClock and BriefService from
the manifest. The producer is `BuddyHoldService` from `a7fc858`; use its actual
hold/quote/offer writer and register its existing clock expiry consumer. Obtain
the token from the actual producer boundary, then call the same access instance's
`exchange` and `fromSession`. For the account route, resolve a genuine identity
session and call `fromAccount`. Pass only each returned private context to 106.
Authorisation remains `authorizeOffer(context, { runId, offerId }, 'decide')`,
including the account resource write check.

Inject `createStoredSubjectEvaluator: createStoredSubjectRecommendationEvaluator`
from the six-overlay evaluator into `createOfferDecisionService`. The service calls
the factory with `{ provider, policy, time }`; the resulting `.evaluate`
receives only the stored server-owned `runId`, `environmentId`, `employeeId`,
`companyId`, `schemeId`, `gradeId`, `policyVersion` and current confirmed brief.
The service's repository-backed manual ports supply current subject/car facts;
it supplies the captured clock and policy read ports. Never turn token access into
an employee role. The same kernel evaluates retained quote pricing and current
eligibility with separate policy reads; no competing copy is introduced.

For HTTP, inject the same service and a trusted `resolveAccess({ selector, cookie,
action })` into `createOfferDecisionHandler`. An offered cookie is resolved through
`fromSession` and fails closed if invalid; otherwise resolve the account session
then `fromAccount`. Return `ok({ context })` without serializing it. Keep the real
shared gate before `gateAuthorized: true`, exact command Origin and safe headers.
Use in-memory request streams initially. Central server/host registration remains
a separately coordinated writer and is not imported into this proof.

First root check after approval and a fresh resource reservation: a new bounded
`gcsp-offer-decisions-integration.test.js`, one worker, the same reviewed loader,
real producer plus both real capabilities plus actual 106 service. Exercise accept,
typed decline, same-command replay, changed intent, cross-employee/expired
credential/stale-run refusal and actual FUCQ-100 clock expiry. Reuse the 102 producer
setup rather than synthetic offer inserts. At quote expiry assert accept refusal
and decline-only access; at the exact hold deadline assert no new decision and
producer expiry without reason/exclusion/priority. Acceptance must show slot/claim
allocation stopping a second hold and quote prices remaining pinned. A first pass
with an explicitly alternative reason input remains scoped development evidence;
the canonical policy gate below still needs its own real adoption proof.

Current access timing is independently verified at `4a56d386`, contract SHA256
`1731acc4e8d50873e4f614836626202107c14d581661206ff0e71ef5f48acc88`.
Its producer decline representative is
`docs/gcsp/evidence/fucq102/producer-decline-representative.json`, SHA256
`c9a63f5b6dacfeb0c3720904ee218c085039903f55a74b551fb463fd70a626f5`.
The dispatcher reports 32/32 access checks; this is not actual 106 acceptance.

## Canonical reason adoption proposal

Reviewed policy source is frozen at FUCQ-103
`3f1cc3414d700b1028ff1fec640a40591324b728`. The proposal is the exact adjacent
`reviewed-offer-decline-reasons-v1.proposal.json`, definition set
`offer-decline-reasons-v1`, revision `1`, digest
`2d7be8d50ff899dd4c72ed3490bcfc888e092196ef19b44d5d0519de76f00b4d`.
The digest is SHA256 over canonical JSON excluding `digest`, matching `inputDigest`.
Its one assumed entry is `offer.declineReasons.v1`, with the typed four-reason list,
units, basis, source and 5 November source date recorded in the main contract.

The eventual additive file is
`server/gcsp/policy/reviewed/offer-decline-reasons-v1.json`. The exact adjacent
`reviewed-definition-registration.proposal.patch` adds its read/validate/freeze
registration to the reviewed 103 registry, preserving presenter, Greg editor and
learning bundles. It has not been applied. No seed/provider/schema edit or browser
definition-row input is proposed.

For the adoption phase, use the same provider with 103's PolicyService via
`withPublicationPorts({ identity, clock, repository })`. In addition to the
39-module composition, overlay 103's `policy/index.js` and `policy/publish.js`;
add only `policy/adoption.js`, `policy/activation.js`,
`policy/reviewed-definitions.js`. Those five source files total 31,309 bytes and
yield 42 modules after replacing two entries. Retain the FUCQ-100 canonical
repository core for every consumer; 103's older core bytes must not be loaded as
a second identity. All other imported policy/repository modules are identical
to the reviewed closure. The manifest also hashes the three existing reviewed
JSON inputs and seed; add the proposed fourth JSON only after review. The
registration result hash is recorded separately.

Call `policy.adoptReviewedAssumptions(gregContext, { commandId,
expectedActiveVersion, policyVersion, effectiveFrom, definitionSetId:
'offer-decline-reasons-v1' })` using actual current-run clock/version values and a
fresh successor ID. The five-field command is exact; definitions stay server-owned.
The existing provider publication CAS appends missing keys, then `activateRunPolicy`
CAS updates the current run pin. Retry pending activation through that same path;
the file provider's unsupported publication must remain refused.

Verify one provider supplies both activation and all readers, replay adds no
duplicate version/key, current-run reason projection changes after activation,
and a stale run cannot adopt. Read reasons/exclusion at **current run policy**;
retain quote prices at **quote policyVersion**. Persist reason/exclusion provenance
separately from price provenance. A newer reason label must reach 105 through the
server registry projection while old decisions/quotes remain explainable. This
requires actual shared-provider integration; the alternative test input is not
canonical activation evidence.

## Remaining executable gates

Remote decisions currently refuse without mutation. FUCQ-100's existing
`adapter.execute(operation)` / `adapter.reconcile(operation)` serves `buddy-claim`
and `buddy-release`; its successful proof does not implement 106 selection/release.
Agree adapter support for `offer-selection` and `offer-decline-release`, persist
intent/pins before any call, and confirm exact run/operation/car/hold identity in
acknowledgements. Exercise timeout, malformed/mismatched acknowledgement, definitive
refusal, confirmed outcome and reconciliation across clock/run changes. Keep
stock/slot exclusion throughout uncertainty; never renew the deadline or assert
optimistic release/selection. Resolve which adapter confirms selection before
FUCQ-108 handoff to avoid duplicate ownership. No remote implementation is allocated.

Confirmed local domain events are in `event_receipts` namespace
`offer-decisions:events:v1`, with stable identity and typed payload. Actual FUCQ-108
accepted and FUCQ-107 declined consumers must query that namespace, validate run,
digest/type/versions and use their own receipt for idempotency. Prove one downstream
effect under duplicate delivery, no effect for pending/expiry, decline only after
release confirmation, and no obsolete-run work. Source receipt insertion alone
closes none of these consumer gates. Their executable ports are not integrated.

The dispatcher retains central route registration, actual page response/state
integration, serial authored `npm test`, and native PostgreSQL admission. No browser,
listener, network/mail, native database or full-suite execution is authorized here.
After actual integration, preserve the experience contract and inspect the existing
105 desktop/narrow states with truthful accepted/declined/expired/pending actions.
Backend scoped evidence needs no new screenshots; page acceptance still does.

## Parked checkpoint

25/25 scoped passes, zero skips, unchanged behavior hashes:
`scoped-service-checkpoint.json`. Final independent cleanup is in
`final-cleanup-receipt.json`. The seven stable slices remain unfinished and no
authored acceptance is checked. The worker observation is stopped/expired on
parking. Resume only the approved bounded integration scope with fresh headroom
and the normal owned scratch/finalizer contract; do not recreate the claim or
worktree or infer completion from a published branch.
