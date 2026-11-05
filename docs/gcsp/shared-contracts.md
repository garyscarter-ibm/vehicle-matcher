# Shared GCSP contracts

**Contract version: 1.0.0 · 4 November 2026 · FUCQ-80.** This is the implementation baseline for the [foundation stories](fucq-79-stories.md), not evidence that their services exist. It records the agreed [HLD invariants](../design/gcsp-high-level-design.md#transaction-and-event-invariants), [review decisions Q2–Q19](../design/hld-review-gc.md) and [build rules](build-rules.md). BMW operational APIs, policy and live access remain separate gates.

The current FUCQ-81 and FUCQ-82 acceptance descriptions were checked on 4 November 2026. The repository tables and seed categories below cover their lists. `confirmed` describes an approved employee input; `verified` describes the provenance of a rule or fact. Neither means a synthetic record belongs to a real employee or order.

## Common envelope and compatibility

Identifiers are opaque strings; row versions are monotonically increasing positive integers. Times are UTC ISO-8601 instants from `DemoClock`, and durations have named units. Every command receives server-owned `Context = { environmentId, runId, principalId, roles, employeeId?, schemeId?, companyId?, gradeId?, entitlementSlotId? }`, a caller-stable `commandId` and the expected row versions it changes. Employee/role/run fields supplied by the browser cannot replace this context.

All four ports return a discriminated result using `status` as the outcome field (for example `{ status: 'ok', value, contractVersion: '1.0.0' }`). Methods below are asynchronous unless stated otherwise; no adapter turns a failure into an empty result or a success.

| Outcome | Required content and meaning |
|---|---|
| `ok` | `value`, `contractVersion`; reads/writes include relevant `version`, policy reads include `policyVersion`. Successful command replay returns its original value and versions. |
| `unavailable` | `reason`, `retryable`; the source could not answer. It proves neither absence nor success. |
| `conflict` | `reason`, safe current-state summary; a car/slot is occupied or an incompatible transition already occurred. |
| `stale-version` | `expectedVersion`, `currentVersion`, affected resource; refresh/review before a new command. |
| `pending` | `operationId`, `operationType`, `lastKnownState`, `reconcileAfter?`; an external effect may have happened. Keep ownership blocked until authoritative reconciliation. |
| `invalid` | typed `code`, field/reason list; includes unknown policy key/scheme/grade, malformed input and unsupported operation. No fallback default. |
| `not-found` | resource type; a successful authorised lookup found no record. |
| `forbidden` / `stale-run` | refusal reason; no resource details from another employee/run. A reset never redirects an old command to the new run. |

Identity additionally distinguishes `missing-session`, `unknown-session`, `expired-session` and `unknown-principal`. `pending`, `conflict` and `stale-version` apply only where a method can encounter them; pure file-policy reads do not manufacture pending operations. Transport/HTTP mappings belong to the route stories and retain these semantic codes.

The method names, envelope spelling and storage names are explicit design assumptions `contract.portVocabulary.v1` and `contract.storageVocabulary.v1`: the HLD specifies responsibilities, not JavaScript names or SQL names. Keep them stable across providers. Extend this document additively in the implementing story, record its key and owner in the change log, and retain existing readers and methods. Removing/renaming a field or changing its meaning requires a new major contract and an agreed migration, outside an incidental story edit.

## Brief schema v1

`Brief.schemaVersion = 1`. The persisted approved brief is immutable per `(runId, employeeId, briefVersion)`; `version` is the conditional-write revision of its owning record. Drafts and inferred suggestions never silently replace an approved brief.

| Field | Shape | Authority / use |
|---|---|---|
| `runId`, `employeeId`, `entitlementSlotId`, `renewalId` | IDs | Server-owned context and supplied contract/renewal, not editable identity. |
| `briefVersion`, `schemaVersion`, `previousBriefVersion?` | integers | Approved history; retain the version used by each evaluation/offer. |
| `status` | `draft` or `confirmed` | Only a confirmed brief with current permission can drive a new buddy hold. |
| `preferences` | map of registered preference key → `{ value, importance, valueState, importanceState, source, confirmedAt? }` | Slider position and separate importance weight. `valueState` and `importanceState` are each `draft`, `inferred` or `confirmed`; `source` names employee input or an explained suggestion. |
| `essentials` | map of registered requirement key → `{ operator, value, unit, state, source, confirmedAt? }` | `state` is `draft`, `inferred`, `confirmed` or `needs-confirmation`. Unknown or unresolved decision-critical requirements fail the gate; preference scores cannot override them. |
| `currentCarFeedback` | `{ preserve: [key], change: [key], state, source }` | Separate from must-haves and after-use satisfaction; broad comfort/space wishes do not invent numeric essentials. |
| `buddy` | `{ enabled, paused, permissionVersion, confirmedBy?, confirmedAt?, pausedAt? }` | Explicit search/hold consent is confirmed by the employee. Off and paused both prevent new searches/holds. Existing offers keep their real state; toggling permission does not silently release or accept them. |
| `policyVersion`, `confirmedBy`, `confirmedAt` | version and provenance | Policy used to validate this version and employee confirmation. Synthetic supplied facts retain their source/date. |
| `postDeclineChange?` | `{ decisionId, offerId, fromBriefVersion, path, before, after, confirmedBy, confirmedAt }` | Audit of exactly one confirmed preference/essential change after a decline (Q16). |

Preference keys are extensible registered dimensions such as comfort and sportiness; coexistence is allowed. Numeric slider values and importance are each integers 0–100; zero importance means indifference, not an essential failure. This scale is assumption `brief.slider.scale`, served by the policy keys below, not a BMW fact. A categorical preference such as body style uses its registered enum plus a separate numeric importance. Registry entries declare their type, range/enum and unit; consumers reject unknown keys instead of guessing their meaning. The exact first dimension set is owned by FUCQ-91/94 and the existing employee-control contracts, not added by this document.

FUCQ-91's single-change operation takes `{ decisionId, expectedBriefVersion, change: { path, value }, commandId }`. It permits one registered preference value or one essential, validates the choice, preserves all other essentials and importance weights, creates a new confirmed brief version and records the change above. `path` cannot target identity, permission or multiple fields. An inferred follow-up stays draft until confirmed. Repeating the command returns the same version; a changed payload under the same ID is `conflict`. A decline reason, a preference change and satisfaction are separate records. Do not reoffer the unchanged declined car; a relevant confirmed change makes it eligible for re-evaluation, not automatically suitable or allocated.

### Implemented BriefService binding · FUCQ-91, 5 November 2026

`server/gcsp/brief/index.js` exports `BriefService` and `createBriefService({ repository, policy, clock, identity })`.
`readCurrent(context)`, `readDraft(context)` and `readHistory(context)` require a trusted employee context;
history returns `{ versions }`, current returns `{ brief, activity }`, and absent approved/draft state is `not-found`.
`saveDraft(context, { commandId, expectedBriefVersion, expectedDraftVersion, brief })` saves an append-only
snapshot in `event_receipts` under `consumerId = brief:draft:<employeeId>`, with integer draft version as event ID.
It never inserts or changes an approved `briefs` row. Draft `baseBriefVersion` must still match on confirmation.
This uses the existing transactional repository contract; no SQL migration or parallel draft store is needed.

`confirm(context, { commandId, expectedBriefVersion, expectedDraftVersion, consent?: { search, hold } })`
appends an immutable approved version. Both consent choices are booleans when supplied; omission records both false.
`buddy.searchConsent` enables new searches; `buddy.holdConsent` additionally permits new holds;
`buddy.enabled` projects search consent, and `buddy.paused` prevents both. Resume preserves the saved consent choices.
Inferred values must first be reviewed in a separate draft. Employee confirmation stamps draft values with the
server principal and DemoClock time; unresolved essentials keep `value: null, state: needs-confirmation`.
`knownFacts` is prefilled in the saved draft and is an additive approved brief field populated exclusively from the scoped repository employee record,
with source, sourceVersion, observedAt and `supplied-demo-fact` label. Browser input cannot supply it.

`pause`/`resume` take `{ commandId, expectedBriefVersion }` and append a version. Responses include
`activity = { canSearch, canHold, existingOffersUnaffected: true, existingOffers: [{ offerId, state, briefVersion }] }`.
Only the employee's scoped offers are read; no hold, offer or stock state is changed.
`changeAfterDecline` implements the single-change command above, with a registered path
`preferences.<key>.value` or `essentials.<key>`; an essential value is its complete confirmed requirement object.
The stored decline must belong to this employee and reference an approved historical brief in `versions.brief`.
Unchanged business values are rejected without consuming the decline's change: source/timestamps are excluded from comparison, and `includes` equipment lists compare as sets while stored audit values retain their supplied order.
Each decline can be answered once; a pause/resume does not consume that change. The expected version is the current
brief being changed; all other preferences, weights, essentials and permission remain unchanged.

Confirm/change/pause/resume atomically append a durable `event_receipts` row with `consumerId = brief:changes`,
`eventId = brief:<employeeId>:<briefVersion>`, `eventType = brief-changed`, input brief/policy versions and
an outcome carrying the event's operation, identity, versions and DemoClock instant. Allocation reads these receipts;
this service implements no allocation or hold engine. Commands are namespaced per employee and replay their original
outcome. Changed input under a command ID conflicts; mismatched expected versions return `stale-version` with
`action: refresh` and safe current/expected versions.

The central assumed `brief.lifecycle.v1` registry defines charging readiness (`home`, `work`, `either`, `not-ready`)
and Q16's one-change invariant. `essentials.charging` uses `equals`, null unit and an explicit unresolved null.
`evaluateCandidate(context, { candidate, employeeFacts })` reads current approved permission and delegates
driver, eligibility, points, availability and essential gates to FUCQ-29's employee recommendation service, using
the approved charging input. The existing `eligibility.homeCharging.requiredForPlugIn` remains the labelled
demo assumption controlling the plug-in gate. No contribution question is introduced. The shared validator now
accepts a null essential only in `needs-confirmation`, preserving its fail-closed gate result.

Backend presentation fixtures are `server/test/fixtures/gcsp-brief-outcomes.json`. Future brief/activity screens
must show unknown requirements, explicit independent consent, refresh conflicts, provenance and assumption labels;
they follow the supplied GCSP shell/palette and Used Cars body direction in the experience contract and COMPONENTS.md.
Draft/current/confirmation/state-change responses include `validation = { policyVersion, unknownEssentials, assumptions }`,
with the actual PolicyService provenance and assumed/verified labels for charging, lifecycle and slider keys.

`buildServer({ gcspIdentity, gcspClock, gcspBrief })` registers `createBriefRoutes(gcspBrief)` behind the existing
identity/origin/shared-access gate. `gcspBrief` is the injected service instance; missing configuration returns 503.
`GET /api/gcsp/brief`, `/brief/draft` and `/brief/history` read employee-scoped state. `POST /brief/draft`,
`/brief/confirm`, `/brief/pause`, `/brief/resume` and `/brief/change-after-decline` use the commands above.
Only these routes opt into discarding top-level browser identity/run claims before handling the command;
all context still comes from the authenticated server session. Protected claims nested in brief content are invalid.
Other GCSP routes retain their existing strict rejection. A different employee sees only their own brief/history;
forged service contexts are refused and sessions from a reset run return `stale-run`. Stale version conflicts map to HTTP 409.

## Exact stock, holds and offers

`orderUuid` is the exact-stock UUID v4 and the foreign key for claims, holds, offers and allocations. `orderNumber` is a unique **7-digit string per run**, retaining leading zeros; `wholesalerOrderId` is an 8-digit integer. `configurationId` identifies immutable configuration facts and is never an exclusive-car key. Two cars can share it. VIN is attached only to delivered/current cars, never required for stock browsing, matching or holding (Q13).

The target-format `configurationId` is standard padded Base64 of `vgModelCode + ':' + sortedUpperCaseCodes.join(',')`, including paint, upholstery and every factory equipment code, excluding dealer accessories. Retain both `agModelCode` and `vgModelCode`; the retail configurator's use of AG instead of the knowledge base's VG remains unconfirmed. Record corpus provenance and URL-encode IDs. The [HLD identifier formats](../design/gcsp-high-level-design.md#vehicle-evidence-and-adapter-contracts) contain the worked example; the runtime choices are keyed below. Identifiers remain stable within a run; reset creates new stock identifiers without replacing the immutable corpus.

### One authority and two state machines

Both routes use one exact-stock authority and share car/employee/entitlement constraints. Manual cart claims are first come first served (Q15); the explicit versioned buddy allocation/tie-break rule applies to competing buddy candidates, not manual browsing. Browsing does not reserve. `Hold = { holdId, runId, orderUuid, employeeId, entitlementSlotId, renewalId, type, state, phase?, expiresAt, version, policyVersion, quoteId, operationId? }`, where `type` is `cart` or `buddy-offer`. The pinned quote contains exact facts/terms, their provenance, `briefVersion`/draft version and `policyVersion`. New policy versions govern new work; they do not silently reprice the hold. Revalidate permission, eligibility, essentials, versions and quote validity before claims and selection.

Hold states are `claim-pending`, `active`, `release-pending`, `selection-pending`, `released`, `expired`, `allocated` and `claim-failed`. The first four occupy the car/slot. Pending is an uncertainty state, not success. Terminal states cannot be revived. Stock remains unavailable during a pending release or selection. A local transaction rollback creates no hold; `claim-failed` records only a previously persisted remote attempt whose failure is now authoritative.

| Manual cart transition | Trigger and owner | Presenter tick permitted? |
|---|---|---|
| no hold → `active`, phase `preview` | Explicit employee Review/select; FUCQ-66 conditionally claims released stock in SQL after checks. Default preview is about 2 minutes. | No; a tick cannot choose for the employee. |
| no hold → `claim-pending` → `active` or `claim-failed` | Only a future remote-shaped provider can have uncertain claim acknowledgement. FUCQ-66 persists the operation first; confirmed success starts the hold, definitive failure removes the exclusion. Target cart holds are local and send nothing upstream. | Reconciliation may resolve the recorded operation; it cannot create an unrequested claim. |
| `active/preview` → `active/order-review` | Explicit employee progression after required review fields validate. FUCQ-66 records the phase and server deadline once. | No. |
| `active` → `released` or `release-pending` | Employee cancel/change, explicit leave that cancels review, or an authorised service release. Confirm locally in SQL; remote uncertainty stays pending. Back/reload alone never renews or duplicates the claim. | Only recorded release reconciliation. |
| `active` → `expired` or `release-pending` | FUCQ-66 sees `now >= expiresAt` on a read/command, startup recovery or its expiry handler. A confirmed local expiry frees the car; uncertain remote release does not. | Yes, expiry handler. |
| `active` → `allocated` or `selection-pending` | Explicit employee final Submit through FUCQ-71/72, using the same stock order and a stable operation ID. Saving converts the hold to allocation atomically when confirmed; an uncertain order update stays blocked pending. | Only reconciliation of an already submitted selection. |
| `release-pending` → `released` / `expired`, or back to `active` | Authoritative release result; retain release reason. A definitive refusal restores the last authoritative hold state and must not reset its deadline. | Yes, reconciliation; overdue active state re-enters expiry processing. |
| `selection-pending` → `allocated`, or back to `active` | Authoritative accepted/refused update; refusal retains original deadline, rechecks expiry, and supplies a reviewable reason. | Yes, reconciliation; never infer acceptance from time passing. |

Two manual timing phases are separately configurable (FUCQ-66, SAN-017). Assumptions `hold.cart.orderReview.durationSeconds = 600` and `hold.cart.orderReview.transition = 'once-from-preview'` provide a plausible ten-minute form-review phase after the short preview. Progression must occur before preview expiry; `reviewStartedAt` can be set only once and `expiresAt = reviewStartedAt + duration`. Returning to preview, changing views or retrying cannot restart either phase. Whether the target has this separate phase is unverified and needs trial review. It is not the buddy hold.

`Offer = { offerId, holdId, runId, employeeId, orderUuid, state, version, briefVersion, policyVersion, quoteId, expiresAt, tokenHash? }`. Buddy offer states are `active`, `decision-pending`, `release-pending`, `accepted`, `rejected` and `expired`; their pending operation retains `intendedDecision` and `lastKnownState`. A candidate evaluation or pending claim is not an active offer. A read returns both hold and offer state, any pending operation and the server clock time.

| Buddy transition | Trigger and owner | Presenter tick permitted? |
|---|---|---|
| no hold/offer → `active` hold + `active` offer + pending outbox job | FUCQ-96 allocates from full released stock using confirmed briefs/current consent; FUCQ-100 conditionally claims and commits hold, offer and notification outbox together. Default is about 2 hours. | Yes, after a release/brief/rule trigger runs allocation; it does not accept the offer. |
| no hold/offer → `claim-pending` → active triple or `claim-failed` | Remote-shaped authority only: persist uncertainty, create the active offer/outbox only after confirmed exclusivity. A failed acknowledgement produces no active offer or mail. | Reconciliation can complete/fail this prior operation. |
| `active` offer/hold → `accepted` offer + `allocated` hold | Employee Accept, FUCQ-106 then FUCQ-108's shared ordering adapter, confirmed in one transaction. Stop new holds for the renewal/slot. | No new decision; only prior-operation reconciliation. |
| `active` → `decision-pending` offer + `selection-pending` hold | Employee Accept where ordering authority is uncertain. Confirmation produces `accepted`/`allocated`; definitive refusal restores authoritative active state with the original expiry and reason. | Yes, reconciliation only. |
| `active` → `rejected` offer + `released` hold, or both `release-pending` | Employee Decline through FUCQ-106. Record the typed reason separately. Do not free a remotely held car before confirmed release. | Only reconciliation of the prior release. |
| `active` → `expired` offer/hold, or both `release-pending` | FUCQ-100's expiry handler, or the same deadline check on reads/commands/startup; `now >= expiresAt` refuses a new acceptance. | Yes. |
| `release-pending` → `rejected`/`released` or `expired`/`expired` | Confirmed release, preserving the original decline/expiry intent. A definitive release refusal preserves exclusion and visible pending/error status for reconciliation; it is never treated as an available car. | Yes, reconciliation. |
| terminal offer → same terminal offer | Reopen old link, refresh, duplicate decision/event. Return stored current state/original command outcome. A contradictory later decision is `conflict`. | No revival or replacement decision. |

Pausing/off stops new buddy work while the existing offer is still readable and can be explicitly decided. Mail success, failure or retry does not change hold duration, allocation priority or decision state. Expiry/missed mail is not dislike and gives no recovery priority. A replacement claim first confirms release of the old car and then re-evaluates; it cannot briefly hold two cars. At the exact deadline the server refuses new selection. A selection submitted while valid but left uncertain is reconciled before expiry/reallocation; it cannot be freed merely because its deadline passed. These boundary choices are assumptions `hold.deadline.inclusive`, `hold.pending.blocksReallocation` and `hold.replacement.releaseFirst`.

Post-selection lifecycle is referenced by the target names, **employee selection → HR approval (configurable) → sales-manager approval → sent to ordering**, then appointment **requested → scheduled → completed or no-show**, with separate document/readiness states. See [HLD lifecycle](../design/gcsp-high-level-design.md#gregs-supply-loop-and-the-commitment-boundary) and [FUCQ-110's lifecycle stories](fucq-110-stories.md). This contract does not redefine those stages or treat allocation as approval/collection; only confirmed handover changes the current car.

### Tick ownership and idempotency

FUCQ-85 owns `DemoClock` and its deterministic registry, not the business handlers. Assumption `clock.handler.order.v1` fixes stages as: **release pull → manual expiry → buddy expiry → pending-operation reconciliation → buddy evaluation/allocation → outbox dispatch**. Within a stage use stable handler IDs; register before serving ticks. Release stock can be seen before expiry but cannot be allocated until the later allocation stage. Reconciled releases are likewise visible before allocation. FUCQ-92 owns release pulls; FUCQ-66 manual expiry; FUCQ-100 buddy expiry/reconciliation; FUCQ-71/108 ordering reconciliation; FUCQ-96 allocation; FUCQ-93 outbox dispatch. Each handler is registered by its implementing story; missing later handlers are reported, not simulated as successful work.

Ticks use `(runId, eventId, handlerId)` receipts, retaining event type, payload digest, input versions and outcome. Replaying a completed tick returns its stored outcome; an interrupted tick resumes only incomplete handlers using their stable operation/command IDs. Startup runs pending reconciliation once and the same expiry guard where applicable, without advancing time or manufacturing a release. Read/command guards and presenter ticks are functioning services; there is no unattended scheduling promise (Q3). Browser countdowns never mutate authority.

## Policy catalogue and provenance

FUCQ-82 implements the single reviewed seed at **`server/gcsp/policy/seed-v1.json`** and read-only file provider; FUCQ-83 seeds dated PostgreSQL tables idempotently and makes them runtime authority through the same `PolicyService`. FUCQ-82 records this implemented location and the shared read interface in build-rules.md. There is one active source per deployment, no separately maintained browser/test defaults. Historical versions and pinned quotes are retained.

Every seed entry has `{ key, value, unit, status: 'assumed'|'verified', basis, source, sourceDate }`; dated rows also carry `policyVersion`, `effectiveFrom` and optional `effectiveTo` (exclusive). Sources name a repo record or a documented synthetic fixture, never a private credential. `verified` below means documented supplied evidence, not independent validation of a BMW API. All source dates below are 2026-11-04 unless the October 2024 matrix is named.

The seed shape is `{ schemaVersion: 1, policyVersion, effectiveFrom, source, schemeRuleLinks: [], eligibilityRules: [], pricePlans: [], allowances: [], assumptions: [] }`:

| Collection | Row contract and provenance |
|---|---|
| `schemeRuleLinks` | `linkId`, `schemeId`, `ruleId`, dates, policy version. BMW-only Choices, explicitly distinguish the supplied FS&UK and RR&Production matrices rather than merging their grades/rules. RR&Production is not asserted to be UKNSC; company/scheme identifier mapping is a labelled demo assumption. |
| `eligibilityRules` | `ruleId`, `effect: include|exclude`, `matchField`, typed `operator`/`value` or range bounds, dates/version, source/status. Use the [October 2024 matrices](sources/choices-eligibility-matrices-2024-10.md); match-field selection below bridges their range/model/engine labels to retained stock facts. Explicit exclude wins; no applicable allow or missing decision facts is `needs-confirmation`/ineligible, never implicit eligibility. |
| `pricePlans` | `pricePlanId`, `schemeId`, `configurationId` or declared match field/value, `monthlyPoints`, dates/version, source/status. Matrices contain no points prices: any seeded cost is labelled synthetic/assumed, not transcribed BMW pricing. |
| `allowances` | `allowanceId`, `companyId`, `schemeId`, `gradeId`, `monthlyPoints`, dates/version, source/status. Grade and company determine allowance; unknown context fails explicitly. Seeded numeric allowances require an assumed basis; the policy shape alone is verified. |
| `assumptions` | one row per stable dotted key in the catalogue, dates/version and the common provenance fields. Future stories add keys here before consuming them. |

Key names use lower camel-case dotted namespaces; a suffix states a dimensional unit (`durationSeconds`, `leadTimeDays`, `gbpPerPoint`). Enum and boolean keys state their meaning. These are the complete v1 foundation assumption/configuration keys; prices and eligibility rows remain typed policy tables rather than duplicating them as assumption keys. All values in this table belong in the canonical seed, including choices inferred here. No consumer copies them as a fallback.

| Key | v1 value / unit | Status and basis / source |
|---|---|---|
| `hold.cart.durationSeconds` | `120` seconds | Assumed exact value; target has about 2 minutes (Q15, round-1 findings). |
| `hold.cart.orderReview.durationSeconds` | `600` seconds | Assumed separate form-review phase, FUCQ-66/SAN-017; test in manual trials. |
| `hold.cart.orderReview.transition` | `once-from-preview` enum | Assumed one explicit progression before expiry; never restart on navigation. |
| `hold.buddy.durationSeconds` | `7200` seconds | Assumed new capability; roughly 2-hour proposal in demo brief/Q15. |
| `hold.employee.maxActive` | `1` hold per employee/renewal/slot | Assumed explicit limit from proposed offer-loop policy; all occupying/pending states count, and slot entitlement remains authoritative. |
| `hold.deadline.inclusive` | `true` boolean | Assumed: expiry begins at `now >= expiresAt`; closes deadline races consistently. |
| `hold.pending.blocksReallocation` | `true` boolean | Verified HLD invariant: uncertainty cannot free the car. |
| `hold.replacement.releaseFirst` | `true` boolean | Assumed conservative replace/change sequence; no second active holder/claim. |
| `allocation.tieBreak.rule` | `renewalDueThenFitThenSeededLottery` enum | Assumed demo fairness: earlier renewal due, then higher eligible fit, then seeded tie-break. Not employee iteration/mail speed or verified BMW policy. |
| `allocation.tieBreak.seed` | `gcsp-v1` string seed | Assumed reproducible tie-break; combine run/scenario seed and stable employee/stock IDs and record ordering evidence. |
| `offer.declinedCar.exclusion` | `untilRelevantConfirmedBriefChange` enum | Assumed employee policy per HLD; unchanged declined `orderUuid` excluded, expiry excluded from dislike history. |
| `choices.topUp.gbpPerPoint` | `1` GBP per point | Assumed for target: 2024 Choices guide allows £1/point but target answer conflicts (Q16, round-1). Retain unused. |
| `choices.topUp.enabled` | `false` boolean | Assumed safe demo selection: allowance vs monthly points is the gate; Q16 changes one preference, not a contribution ceiling. |
| `eligibility.homeCharging.requiredForPlugIn` | `true` boolean | Assumed demo practical gate from brief; target has no such BMW rule (round-2). Unknown/not-ready charging prevents a plug-in offer under this assumption. |
| `eligibility.rule.matchField` | `eligibilityModelKey` field name | Assumed bridge of retained series/model/engine labels to matrix rows, since target matching code is undefined (round-3). Exact mapping is versioned/provenanced in the seed; unknown mapping fails. |
| `eligibility.rule.precedence` | `excludeThenInclude` enum | Assumed deterministic include/exclude evaluation; unknowns cannot widen eligibility. |
| `supply.release.size` | `20` cars per synthetic tranche | Assumed plausible small demo release; target sizes undocumented (round-2); scenario may explicitly override with provenance. |
| `supply.leadTimeDays` | `56` calendar days | Assumed eight-week production-to-release planning input; not a BMW delivery promise (round-2). |
| `brief.slider.minimum` | `0` integer slider units | Assumed `brief.slider.scale`; shared position and importance scale. |
| `brief.slider.maximum` | `100` integer slider units | Assumed `brief.slider.scale`; dimensions declare categorical alternatives where required. |
| `stock.configuration.modelCodeField` | `vgModelCode` field name | Assumed use of target knowledge-base format; AG/VG discrepancy remains open (Q13 round-3 and HLD). |
| `stock.configuration.codeSeparator` | `,` character | Assumed target detail, supported by public configurator shape (HLD follow-up). |
| `stock.configuration.includePaintAndUpholstery` | `true` boolean | Assumed target detail, supported by configurator; every factory option included, dealer accessories excluded. |
| `stock.configuration.encoding` | `base64-padded` enum | Assumed target detail (Q13); canonical upper-case sorted list, URL-encode on routes. |
| `stock.identifiers.stableWithinRun` | `true` boolean | Assumed because target amendment stability is unsettled; reset regenerates order identifiers. |

FUCQ-82 adds `eligibility.context.mapping` (assumed, source/date: the supplied matrix transcription, 4 November 2026). Its value maps `choices-fs-uk` / `demo-bmw-fs-uk` to `G1-6`, `G7`, `G8-10`, `G11-14`, and `choices-rr-production` / `demo-bmw-rr-production` to `PG1`, `G8-10`, `G11-12`. These are demo identifiers and source grade bands, not a verified BMW company-code crosswalk. `eligibilityModelKey` is the exact matrix Model cell, a `|`, and one Engine token; comma/slash alternatives expand without inventing engine prefixes. For example `G20 Saloon|320i` and `G21 Touring|320i` remain separate. Unknown/unmapped values never use a nearest match. This assumption is the source for generators and context fixtures; callers do not recreate a second crosswalk.

Allowance, points, release sizes, lead times and tie-break choices remain inspectable assumptions; none establishes real allocation priority or real stock. A routine correction changes the authoritative entry/version and all consumers obtain it through `PolicyService`. Future lifecycle HR flags, scenario timing, Greg weights/bounds and model references are added by their owning stories, not silently defaulted in a consumer. Approved guide/matrix facts retain their distinct effective dates even when imported on 4 November.

## Repository schema and transactions

FUCQ-81 implements both PostgreSQL (`pg`, backend-only `GCSP_DATABASE_URL`) and a memory double with identical transaction/conditional-write semantics. Every mutable business row carries `runId`; every read/write, unique business key and foreign key includes it. `runs.runId` scopes the run row itself. No method can omit run scope. Record IDs alone are insufficient authority; compare the current context/run before acting. Previous runs remain history after reset and cannot send jobs or accept decisions.

All mutable rows also carry `version`, `createdAt` and `updatedAt`; immutable snapshots carry their creation/version provenance. Policy rows are append-only within the run and retain effective dates. Quoted facts and immutable corpus IDs are references/snapshots, not a copied mutable corpus. The initial tables are concrete contract names under `contract.storageVocabulary.v1`:

| Table | Primary / unique keys (always within `runId` unless stated) | Contents / owning story |
|---|---|---|
| `runs` | PK `runId`; one current run per `environmentId` | scenario/fixture/corpus/policy versions, clock instant, active/historical status; FUCQ-81 storage, FUCQ-85 control. |
| `employees` | PK `(runId, employeeId)` | Fictional principals, company/grade/scheme and supplied contract context; FUCQ-81/84. |
| `entitlement_slots` | PK `(runId, entitlementSlotId)`; FK employee | Renewal and old-contract/slot identity, configured capacity; FUCQ-81/65. |
| `briefs` | PK `(runId, employeeId, briefVersion)` | Schema v1, approved and separately labelled draft/inferred inputs, consent/provenance; FUCQ-81/91. |
| `stock` | PK `(runId, orderUuid)`; unique `(runId, orderNumber)` | `configurationId`, `orderNumber`, `wholesalerOrderId`, revision, release/account/visibility, available/held/allocated projection; FUCQ-81/92. |
| `holds` | PK `(runId, holdId)`; FK stock/employee/slot | Type, state/phase, expiry, pinned policy/quote and pending-operation link; FUCQ-81 storage, FUCQ-66/100 rules. |
| `claims` | PK `(runId, claimId)`; FK hold/stock/slot | Active ownership record. Unique `(runId, orderUuid)` for occupying states, plus conditional slot/employee capacity; FUCQ-81. |
| `quotes` | PK `(runId, quoteId)` | Immutable exact-car facts, eligibility/terms, brief/draft and policy versions, quoted time/validity; FUCQ-81 storage, FUCQ-66/100 creation. |
| `offers` | PK `(runId, offerId)`; unique `(runId, holdId)` | Buddy state, quote/brief references, expiry, optional hash and environment/run-bound token metadata; FUCQ-81/100/102. |
| `decisions` | PK `(runId, decisionId)`; unique `(runId, commandId)` | Accept/decline, typed reason, actor and versions, original response; FUCQ-81/106. |
| `pending_operations` | PK `(runId, operationId)`; unique `(runId, operationType, idempotencyKey)` | Claim/release/selection intent, payload digest, provider reference, last state, attempts and reconciled outcome; FUCQ-81 and owning action story. |
| `event_receipts` | PK `(runId, consumerId, eventId)` | Input digest, event type, handler, input versions, processing/completed/pending state and original outcome; command receipts use `consumerId = command:<action>` and `eventId = commandId`; FUCQ-81. |
| `notification_outbox` | PK `(runId, jobId)`; unique `(runId, idempotencyKey)` | Offer/message/recipient reference, captured/real transport, pending/sending/sent/retry outcome; no raw access token in logs; FUCQ-81/93. |
| `forecast_snapshots` | PK `(runId, forecastId)` | Versioned input/policy/model identity, as-of time, output and provenance; FUCQ-81 storage, FUCQ-74 consumers. |
| `plan_snapshots` | PK `(runId, planId)` | Forecast/input/constraint/policy versions and proposed plan output; FUCQ-81 storage, FUCQ-74 consumers. |
| `policy_versions` | PK `(runId, policyVersion)`; seed digest unique per run | Source version, effective date, publisher/time; FUCQ-83. |
| `scheme_rule_links` | PK `(runId, policyVersion, linkId)` | Dated scheme-to-rule links; FUCQ-83. |
| `eligibility_rules` | PK `(runId, policyVersion, ruleId)` | Typed include/exclude/match fields/ranges; FUCQ-83. |
| `price_plans` | PK `(runId, policyVersion, pricePlanId, priceEntryId)` | Scheme/configuration or match-key monthly points; FUCQ-83. |
| `grade_allowances` | PK `(runId, policyVersion, companyId, schemeId, gradeId)` | Monthly allowance and provenance; FUCQ-83. |
| `policy_assumptions` | PK `(runId, policyVersion, key)` | Typed values/units/status/basis/source/date; FUCQ-83. |
| `identity_sessions` | PK `(runId, sessionIdHash)` | Server-issued acting principal/session expiry; FUCQ-84, no raw session credential. |
| `tick_runs` | PK `(runId, tickId)` | Event/command ID, target clock, ordered handler IDs, outcomes; FUCQ-85. |

`priceEntryId` is a stable seed-row ID under `contract.storageVocabulary.v1`; parent price-plan headers and entries may be normalised further without changing `PolicyService`. Greg/presenter principals are configured roles in the per-run identity data, not privileges obtained by editing an employee ID. Cases, supply requests/acknowledgements, lifecycle and learning tables are later additive extensions owned by their stories; the initial snapshot tables do not implement those behaviours.

At database level enforce the active car constraint across `active`, `claim-pending`, `release-pending` and `selection-pending`, not just UI-active holds. Terminal claims release that uniqueness only after confirmed release/failure, or become an allocated stock exclusion. Hold + offer + outbox commits as one SQL transaction. A conversion to allocation and confirmed selection/decision likewise commits once; failure rolls back all local rows. An external request is not inside that SQL guarantee: persist pending intent/idempotency first and reconcile its result before finalisation. The memory double must reproduce rollback, uniqueness, stale version, idempotency and run isolation rather than serial test-only happy paths.

Idempotency keys are explicit strings stored with a canonical input digest. Outbox offer notification uses `offer:<offerId>:notification:<messageKind>:<messageVersion>` (run is a separate uniqueness column); retrying transport reuses that job/key. Event receipts use `(runId, consumerId, eventId)`, with `consumerId` the stable handler ID, so one source event may reach several consumers once. Caller commands use their `commandId`; pending external operations reuse `operationId` as provider idempotency key. Same key and same input returns the original outcome; same key with changed input is `conflict`. Attempt number, current time and mail speed cannot mint a new logical key. These encodings are assumption `transaction.idempotency.keys.v1`.

Migrations live in `server/gcsp/migrations/` as `0001_transaction_foundation.sql`, `0002_policy_tables.sql`, then increasing zero-padded numbered descriptive `.sql` files. FUCQ-81's runner records version, filename, checksum and applied timestamp in an append-only `schema_migrations` ledger; the ledger is deployment metadata, not run-scoped employee state (assumption `repository.migrationLedger.scope`). Apply each migration transactionally and once, reject a changed applied checksum, and report whether startup is current or unavailable. Applied files never change. Add tables/nullable columns/indexes and backfill compatibly; no drop, rename, destructive type change or enum narrowing until recovery and all outstanding old-state readers are explicitly migrated. New SQL comes with a contract/change-log entry. No browser provisioning or connection-string exposure is authorised here.

## Port interfaces

### TransactionRepository · FUCQ-81

`RowRef = { table, key }`, where `table` is an allowlisted table above and composite business keys exclude no required scope. Providers may offer typed wrappers, but these semantics remain shared.

| Method | Input | Outcome/value |
|---|---|---|
| `open(options)` | Backend provider config; no secret in returned/logged diagnostics | `ok` repository handle and migration status, or `unavailable`/`invalid`. |
| `currentRun(environmentId)` | Trusted backend environment | FUCQ-85: the one persisted current active run, `not-found`, conflict or unavailable; no process-local current-run store. |
| `resetRun(context, command, seed)` | Expected current run/version (null current for initial bootstrap), replacement run and employee/slot/stock fixture rows | FUCQ-85: atomically retire the prior run, insert the complete replacement and retain the original reset receipt; any failure rolls back all rows. Only this backend operation crosses run scopes. |
| `migrationStatus()` | none; deployment metadata only | `ok { current, appliedVersions, pendingVersions }` or `unavailable`; no fake current state. |
| `transaction(context, command, work)` | `{ commandId, inputDigest }`; callback with run-bound `tx` | Atomically commit callback result + original command outcome, or rollback. Replay returns original; failures use common outcomes. No arbitrary network effect inside `work`. |
| `tx.get(ref)` / `tx.list(table, filter)` | Run-bound allowlisted ref/filter | Authorised row/list, `not-found`, `unavailable` or scope refusal; no cross-run default. |
| `tx.insert(table, row)` | Row includes context `runId` and expected unique keys | `ok` created row; duplicate identical idempotent operation returns original, different row is `conflict`. |
| `tx.compareAndSwap(ref, expectedVersion, patch)` | Typed allowed changes | `ok` updated row/version, `stale-version`, `not-found` or `conflict`; no lost update. |
| `tx.conditionalClaim(input)` | `orderUuid`, `holdId`, `claimId`, employee/slot, hold type, expiry, quote/policy, expected stock/slot versions | `ok` claim/hold and new versions, `conflict` occupied car/capacity, `stale-version`, `invalid` or `unavailable`. Revalidation/business ranking is performed by the caller; exclusivity is enforced here. |
| `tx.getReceipt(consumerId, eventId)` / `tx.recordReceipt(receipt)` | Stable ID, input digest and outcome | Original outcome on replay or newly recorded receipt; changed input is `conflict`. |
| `tx.enqueueNotification(job)` | Stable outbox idempotency key, offer/message references and input digest | New or original job; changed input `conflict`. Used in the same hold/offer transaction. |
| `close()` | none | `ok` after resources close, or `unavailable` with reason. |

Outside a transaction, `read(context, ref)` and `query(context, table, filter)` provide consistent scoped reads with the same outcomes as `get`/`list`. `pending` is a persisted domain-operation result returned by a transaction/read; a database connection timeout alone is `unavailable`, and uncertain commit status is reconciled by the original command ID before retry. No receipt/outbox duplicate or memory success may mask a failed database. Repository contract tests run the same scenarios on memory and PostgreSQL, reporting an unset-database skip explicitly.

### PolicyService · FUCQ-82 read, FUCQ-83 dated publish

`PolicyRead = { runId, asOf, policyVersion? }`: `asOf` is supplied by `DemoClock`; omitting `policyVersion` selects the version effective then. A pin selects its exact retained version. Every result, including typed rule failures when a version is resolved, carries `policyVersion`; if resolution fails it is explicitly `null`. Never silently switch a missing pin to active policy.

| Method | Input | Outcome/value |
|---|---|---|
| `getActiveVersion(read)` | Run/as-of | `ok { policyVersion, effectiveFrom, source }`; unknown/unavailable explicit. |
| `getEligibility(context, car, read)` | Company/grade/scheme, decision facts, exact stock/configuration and keyed match facts | `ok { eligible, state: eligible|ineligible|needs-confirmation, ruleIds, reasons }`, with version; unknown scheme/grade `invalid`. |
| `getAllowance(context, read)` | Company/grade/scheme | `ok { monthlyPoints, unit: points/month }`, version/source; unknown context explicit `invalid`. |
| `getPointsCost(context, car, read)` | Scheme and declared configuration/match facts | `ok { monthlyPoints, unit: points/month, pricePlanId }`, version/source; unknown/missing price explicit. |
| `getAssumption(key, read)` | Exact registered key | `ok { key, value, unit, status, basis, source, sourceDate }`, version; unknown key `invalid`. |
| `publishPolicyVersion(context, changeSet)` | Greg role, `commandId`, expected active version, effective date, validated changes and provenance | FUCQ-83: `ok { accepted: true, policyVersion, effectiveFrom }`; invalid set `invalid { accepted: false, reasons }`, stale version/refusal/unavailable as above. No partial writes. |

The file-backed FUCQ-82 provider is read-only: publish is explicitly unsupported until FUCQ-83 implements it. Unsupported publishing returns `invalid` with `code: 'unsupported-operation'` and `accepted: false`; it never reports an accepted write. All policy outcomes carry `contractVersion: '1.0.0'` and `policyVersion` (explicitly `null` when no version could be resolved). PostgreSQL selects dated rows through the same reads; future-effective versions wait for the demo clock. Old versions stay immutable and active quotes stay pinned. UI, manual/buddy flows, ranking, Greg, generators, simulations and tests use these reads and the server-owned client projection; tests can supply an explicit alternative seed/provider to prove a one-entry change.

#### File provider binding and presentation evidence · FUCQ-82

`server/gcsp/policy/index.js` exports `PolicyService`, `FilePolicyProvider` and `createPolicyService`. Default construction is `createPolicyService()`; explicit input replacement uses `createPolicyService({ filePath, retainedFilePaths })`, or inject `provider` with asynchronous `loadVersions(read)` returning complete seed snapshots. No consumer reads the JSON file or introduces a second fallback. The default source is `seed-v1.json`; optional retained files are immutable history/explicit what-if inputs, not another active default table. Normal source activation creates a service/provider over the selected reviewed files.

Unpinned reads choose the latest version effective at supplied `read.asOf`; they evaluate row dates then. An exact retained pin bypasses the version's elapsed top-level effective window and evaluates its dated rows at the pinned version's `effectiveFrom`, preserving the terms from activation. Missing pins do not select active policy. Future-effective versions stay inactive until the supplied clock reaches their date. The file provider does not own mutable run/identity state; a supplied context run must match `read.runId`.

`getEligibility` applies the matrix model/grade decision only. FUCQ-29 combines this read with allowance/points, home-charging and other employee practical/essential gates; this read does not rank, reserve or silently implement those downstream capabilities. The assumed monthly price and allowance rows are demonstration inputs, not BMW amounts. A recorded service-result projection in `server/test/fixtures/gcsp-policy-projection.json` demonstrates the client-facing shape without adding a screen or browser defaults. No UI/components change, so new screenshots are unnecessary under the experience contract.

### EmployeeRecommendationService · FUCQ-29

`createEmployeeRecommendationService({ provider, policy, time }).recommend(context, brief)` is a stateless read. `context` is the server-resolved employee/run/environment/company/scheme/grade and retained `policyVersion`; browser data cannot replace it. The injected `provider.resolve(context)` returns an `ok` source with matching `runId`, `environmentId`, `employeeId`, `factsVersion`, `stockVersion`, `employeeFacts` and `stock`. It declares known essentials explicitly, including an empty essentials map where none are known, and provenance-bearing driver qualification, charging and required-by facts. Exact stock records contain `orderUuid`, `configurationId`, an immutable FUCQ-26 snapshot whose stock key equals the order UUID, and versioned availability. No stock VIN is permitted. Provider failure remains unavailable; a successful empty array is no stock.

`time.now(context)` uses the DemoClock outcome `{ status: 'ok', value: { now, runId, clockVersion } }`; no wall-clock fallback exists. The brief is `{ schemaVersion: 1, briefVersion, preferences, essentials, requiredBy? }`, using the shared preference/essential field meanings above. It adds requirements to the provider's known essentials, and can only narrow its required-by date. Unknown keys, retail flags, caller context and supplied financial/stock authority are invalid.

The canonical `employee.recommendation.v1` assumed calibration registers body, fuel, sportiness, comfort, economy and size preferences; supported essential operators; exact-evidence assurances; driver gate selection; fuel/charging/availability vocabularies; meaningful existing curve parameters; display limit; and term validity seconds. It has units, basis, source/date and policy version in the same seed. Existing `brief.slider.minimum`, `brief.slider.maximum` and `eligibility.homeCharging.requiredForPlugIn` are read through PolicyService. Brief schema v1 supports the published 0–100 scale and explicitly refuses inconsistent calibration. Top-up keys remain unused. Matrix, allowance and monthly cost reads retain their full source rows and versions.

All exact candidates receive `eligible`, `ineligible` or `needs-confirmation` decisions before preferences and display caps. Unknown essential evidence never asserts `suitable`. Decisions preserve `orderUuid`, `configurationId`, brief/facts/policy/stock/snapshot/terms/clock/availability versions, typed monthly points evidence, blockers, unknowns, reasons and trade-offs. Top-level evaluation versions survive empty stock. Outcomes distinguish `recommendations`, `no-stock` and `no-viable-stock` within `ok`, with typed invalid/forbidden/stale-run/unavailable failures. The service saves nothing and has no allocation, claim, hold, offer or notification port. `POST /api/gcsp/recommendations` binds this consumer through the existing identity/current-run, employee-role, exact-Origin, shared-key and no-store boundary. Trusted `buildServer({ gcspRecommendations: { provider, policy, time } })` composition is required; no configured provider returns unavailable. Query selectors and browser authority/downgrade fields are invalid. The [endpoint contract and computed evidence](employee-recommendation.md) record the tested presentation states.

### DemoIdentityAdapter · FUCQ-84

| Method | Input | Outcome/value |
|---|---|---|
| `resolveSession(requestContext)` | Access-gate result plus server-issued session cookie/equivalent, current environment | `ok Context` for a configured fictional employee, Greg or presenter; `missing-session`, `unknown-session`, `expired-session`, `unknown-principal`, `stale-run`, `forbidden` or `unavailable`. Shared password alone is insufficient. |
| `switchPrincipal(presenterContext, principalId, commandId)` | Authorised presenter session, configured principal | `ok` new server-owned acting session/context; role and run checks or unknown-principal refusal. Keep presenter authority distinct from the selected acting employee. |
| `requireRole(context, role)` | Resolved context and named operation role | `ok` or `forbidden`/`stale-run`; browser roles are ignored/rejected. |
| `authorizeResource(context, resourceRef, action)` | Run/employee/offer-scoped resource and action | `ok` allowed scope, or `forbidden`/`stale-run`/`not-found`; no cross-employee read leak. |

Sessions use HttpOnly cookies or an equivalent backend-owned mechanism and never appear in URLs/logs. FUCQ-84 records any session lifetime/clock choice as an additional policy assumption before implementation; fixture lifetime is not an undocumented fallback. Offer links are a separate FUCQ-102 adapter: hash the opaque token, bind environment/run/offer, then produce an access context limited to that exact offer and its decisions. It cannot read the employee fleet/brief or gain Greg/presenter roles. This context uses the same resource authorisation boundary. Replacing demo identity with sanctioned BMW identity/roles does not change route consumers.

FUCQ-84 implements this port in `server/gcsp/identity/index.js`. Inject the opened FUCQ-81 repository, `PolicyService`, trusted `currentRun()` returning `{ environmentId, runId }`, and `sessionNow()` returning a server UTC instant. The current run must already exist, be current and carry its policy version. FUCQ-85 owns creating/resetting that run; identity never invents a fallback run or memory provider. `seedPrincipals()` idempotently inserts the configured fictional people into `employees` and employee slots into `entitlement_slots` within that run. Slot/employee occupying capacity initially uses the existing `hold.employee.maxActive` assumption. FUCQ-65 may enrich supplied employee/contract context through its own authorised boundary.

The additional canonical assumptions in `server/gcsp/policy/seed-v1.json`, obtained only through `PolicyService`, are:

| Key | Value and provenance |
|---|---|
| `identity.demo.principals` | Explicit fictional Paula, Alex and Sam employees with company/scheme/grade/slot; Greg; presenter. Assumed demo mapping, 5 November 2026. First names are labelled scenario roles, without real surnames, contact details or licence data. Employee grades are validated against `eligibility.context.mapping`, preserving the separate FS&UK and RR&Production schemes. |
| `identity.session.durationSeconds` | 14,400 seconds, assumed four-hour setup/demonstration lifetime, 5 November 2026. New sessions read this policy value; persisted expiries remain fixed. |
| `identity.session.clock` | `server-wall-clock`, assumed 5 November 2026. Injected server security time is independent of the accelerated/resettable domain clock; expiry is inclusive. |
| `identity.session.sameSite` | `None`, assumed 5 November 2026 for the separate HLD frontend/backend origins. Requires Secure and exact configured-origin credentialed CORS. |

Trusted backend setup calls `createPresenterSession(commandId)` and delivers its `value.setCookie` array through the HTTP response. This is a server composition operation, with no public password-to-presenter bootstrap route. Deployment/presenter setup must arrange that initial trusted cookie; neither the shared password nor a browser principal ID creates it. Bootstrap issues separate `gcsp_presenter` control and `gcsp_session` acting cookies. Both are HttpOnly, Secure by default, policy-selected `SameSite=None`, scoped to `/api/gcsp` and fixed server expiry. This supports the HLD's separate Render static-site and backend origins. `SameSite=None` refuses issuance if Secure is disabled; a local HTTP composition needs an explicit alternate policy selection (`Strict` or `Lax`), never a browser flag. Browser restrictions on third-party cookies still apply and deployment must smoke-test its actual origins. Sessions store a SHA-256 hash, never the credential; command receipts likewise contain no cookie. A repeated issuance command refuses with `conflict` because the backend cannot recover a lost raw cookie; issue with a fresh command ID.

The acting cookie has only the selected person's identity. `Context.roles` always contains only that person's roles: acting as Paula cannot publish policy, request Greg's order or invoke presenter reset/ticks. Switching additionally resolves the separate `gcsp_presenter` cookie with `purpose: 'presenter-control'`; an employee acting cookie alone cannot switch or acquire Greg's powers by changing a principal ID. Presenter control remains available while an employee is selected, without adding presenter permissions to their acting context. Frozen contexts are adapter-owned, and copying browser JSON cannot forge an accepted context. All guards recheck the current run and server expiry.

`buildServer({ gcspIdentity, gcspRoutes })` mounts the shared context boundary for `/api/gcsp` and every `/api/gcsp/*` route after the existing `DEMO_ACCESS_KEY` / `isAuthorized` gate. Missing adapter configuration returns `unavailable`; there is no implicit principal even when local shared-key gating is disabled. `GET /api/gcsp/context` reads the safe context; `POST /api/gcsp/session/switch` accepts only `{ principalId, commandId }`, requires a presenter-controlled session and returns the new context with its credential only in `Set-Cookie`. These responses are `Cache-Control: no-store`. Browser context fields in query/body are rejected, identity headers are ignored, and URL session/token inputs are rejected. GCSP credentialed CORS accepts only exact frontend origins in trusted `gcspAllowedOrigins` or comma-separated backend `GCSP_ALLOWED_ORIGINS`; no wildcard or URL path is accepted. Unsafe GCSP methods additionally require a present, exactly allowed Origin before any command runs, including when the local shared-key gate is disabled; disallowed, `null` and missing command origins fail closed. Originless reads remain available to trusted server/native clients. This is server-side CSRF protection, not just a browser response-read restriction. Configure the actual frontend origin and send browser requests with `credentials: 'include'` plus the existing access-key header when enabled. GCSP OPTIONS performs only the origin/preflight check; other GCSP requests still pass the shared gate before session resolution. Existing retail routes, health and retail OPTIONS retain their contracts.

Registered consumers use `{ method, path, role?, resource?, action?, handle }`; `handle({ context, body, searchParams, identity })` receives the same server-resolved context after any declared role/resource guard. `resource` returns a run-bound repository reference; the adapter reads persisted ownership, permits only that employee's brief/hold/offer and refuses another employee or run without returning its details. Resource command references retain explicit run identity so an old object cannot silently target a new run. Operation stories register Greg (`role: 'greg'`) or reset/tick (`role: 'presenter'`) guards when implementing those operations; FUCQ-84 tests these boundaries with inert probe handlers and implements none of their operations.

The HTTP identity mapping is `missing-session` / `unknown-session` / `expired-session` → 401, `forbidden` → 403, `unknown-principal` / `not-found` → 404, `stale-run` / `conflict` → 409, `invalid` → 400 and `unavailable` → 503. Presentation evidence is `server/test/fixtures/gcsp-identity-outcomes.json`, asserted by `server/test/gcsp-identity.test.js`. No screen/component changes or screenshots are required. A later sanctioned BMW adapter implements the same four consumer methods and returns the same server-owned context without changing the registered routes; trusted demo bootstrap is not part of the consumer port. Offer-link access remains separate.

### DemoClock · FUCQ-85

| Method | Input | Outcome/value |
|---|---|---|
| `now(context)` | Resolved run | `ok { now, runId, clockVersion }`, or stale-run/unavailable. Services inject this instead of calling `Date.now()` for domain time. |
| `advance(presenterContext, command)` | `commandId`, expected clock version, exactly one of positive `bySeconds` or future `to` | `ok` new time/version; stale-version/invalid/forbidden/unavailable. No backward move; reset is separate. |
| `registerHandler(descriptor)` | Trusted startup registration `{ handlerId, stage, handle }` | `ok` registry entry, or `invalid` duplicate/unknown stage. Fixed recorded ordering as above. Not a public employee operation. |
| `tick(presenterContext, command)` | `eventId`, input digest and expected clock version | `ok { tickId, now, handlerOrder, outcomes }`, original result on replay; pending handler outcome is visible, unavailable never presented as complete. Tick uses current time; `advance` followed by `tick` is explicit. |
| `reconcileStartup(environmentId)` | Trusted backend startup/current run | Run registered reconciliation once, same stable operation IDs; report resolved/pending/unavailable work, no new release or time advance. |
| `reset(presenterContext, command)` | `commandId`, `scenarioVersion`, `fixtureVersion`, `expectedRunId`, integer `expectedRunVersion` | `ok { previousRunId, runId, now, versions }`; new run, regenerated stock IDs and employee state, unchanged immutable corpus. Old command replay returns its original outcome without reactivating the old run. |
| `readState(presenterContext)` | Resolved presenter | `ok { runId, now, clockVersion, runVersion, versions, lastTick }`; role/run refusal or unavailable. |

`advance` and `tick` being separate, handler stage names, and monotonically forward time are assumptions `clock.commands.v1` and `clock.handler.order.v1`; later presenter UI can compose them while preserving idempotency. Reset is synthetic-environment-only and cannot reset an operational provider. Old offers/outbox jobs return stale/refused or recorded no-op and cannot act on the new run.

### DemoClock implementation and presenter binding · FUCQ-85

`server/gcsp/clock/index.js` exports `DemoClock`, `createDemoClock(options)` and trusted `createDemoRuntime(options)`. Supply an **opened** repository, PolicyService, explicit `environmentId`, `environmentKind: 'synthetic'`, `policyAsOf`, bootstrap `commandId` and injected security `sessionNow()`. The runtime returns `ok { clock, identity }`; a retained current run is reopened only with a valid persisted clock and matching scenario/fixture/inventory metadata, otherwise it returns unavailable without altering that run. If no current run exists, one initial run is seeded. DemoIdentity's existing `currentRun()` dependency reads `repository.currentRun(environmentId)`, so identity and clock use one persisted authority. No memory provider, environment or initial clock is inferred from missing deployment configuration. An operational environment is refused before seeding/reset. Live PostgreSQL execution remains an explicit unset-`GCSP_DATABASE_URL` skip in local evidence.

The fixture builder `server/gcsp/fixtures/scenario-v1.js` reads `clock.scenario.v1`, `clock.commands.v1` and `clock.handler.order.v1` **only through PolicyService**. Those entries carry units, assumed status, basis, source/date and policy version in the canonical seed. `clock.scenario.v1` currently supplies the small `gcsp-clock-scenario-v1` / `gcsp-clock-fixtures-v1` fixture: 5 November 2026 at 09:00 UTC, named `release` and `expiry` cues, explicit allocation bounds and two labelled fictional configuration references. This proves the mechanics; FUCQ-77/78 owns real constructible corpus/stock publication. It does not claim these reference records are real BMW configurations. Identity people and slot capacity reuse `identity.demo.principals`, `eligibility.context.mapping` and `hold.employee.maxActive`. There is no second employee fixture/default table.

Reset reuses FUCQ-53's whole-inventory allocator and exact UUID-v4/seven-digit order-number formats, with no VIN on stock. The persisted `runs.versions.syntheticIdentityInventory` retains its revision/digest plus an additive immutable `snapshot` of the allocator inventory needed to allocate across historical runs. Public projections omit that snapshot. A bounded retry using the existing allocator attempt policy prevents the same fixture car retaining its previous display number; exhaustion returns unavailable before the repository transition. Corpus/configuration references and images are never written. Existing run identifiers/rows remain stable; reset changes only the prior run's current/status/version metadata and adds a replacement. Fixture failure, stale run/version or concurrent reset cannot partly seed a run. A changed/missing inventory revision is unavailable rather than an invented empty inventory.

Register each `{ handlerId, stage, handle }` before creating the server/starting ticks. IDs are stable lower-case letters/digits/hyphens; duplicate IDs, unknown stages and late registration are invalid. Stage order comes from `clock.handler.order.v1`, then ordinal handler-ID order within each stage. Each stored tick records its actual order and `missingStages`; no later release, expiry, allocation or mail business capability is simulated. `tick` accepts `{ eventId, expectedClockVersion, inputDigest }`; its clock instant/version is fixed at event creation. Reusing an ID with changed input is conflict. The public outcome includes `runId`, `tickId`, `eventId`, `now`, `clockVersion`, `kind`, `handlerOrder`, `missingStages`, `outcomes` and `state: completed|pending`. An interrupted event returns unavailable and remains inspectable/retryable with the same input; completed handler receipts and original transaction outcomes survive reopening.

A handler receives `{ context, eventId, tickId, now, clockVersion, operationId, transaction(work) }`. It runs **outside** a clock-owned transaction, so it can call its service/repository without nesting/deadlocking. The scoped helper commits local work under one stable repository command ID; after a crash between committed work and the handler receipt, retry reuses that original command outcome. The registry stores each handler receipt and tick progress atomically. A handler must return `ok { value }` or a complete persisted `pending { operationId, operationType, lastKnownState }`. Handler services own their external-operation protocol: persist intent first, use the pending operation/job's stable ID for provider retries, and reconcile definitive acknowledgement in their own transaction. Never put arbitrary network effects inside `transaction(work)`. The registry itself contacts no operational provider and sends no email. Read/command consumers recheck current run before acting, including old job/offer references.

`buildServer({ gcspClock: clock, gcspIdentity: identity, gcspRecommendations?, gcspAllowedOrigins })` registers the presenter endpoints below and immediately starts one `reconcileStartup()` promise without a browser. `server.gcspStartup` reports that outcome; GCSP requests await it. Startup runs only the policy's existing expiry/reconciliation stages, never advances time or manufactures a release. Each backend instance starts at most once; a later backend startup gets a new event while handler services retain pending-operation IDs. Missing handlers and pending/unavailable results remain visible. There is no unattended runner. When employee recommendations are supplied, server composition injects this same `clock` as their `time` port. Absent trusted composition continues to return unavailable.

| Endpoint | Command/result |
|---|---|
| `GET /api/gcsp/presenter/clock` | Current run/time/versions and last tick, no query selectors. |
| `POST /api/gcsp/presenter/clock/advance` | `commandId`, string `expectedClockVersion`, exactly one of positive integer `bySeconds` or `to` (configured name/UTC ISO instant); original result on replay. |
| `POST /api/gcsp/presenter/clock/tick` | `eventId`, string `expectedClockVersion`, SHA-256 `inputDigest`; advance and tick remain separate. |
| `POST /api/gcsp/presenter/clock/reset` | Exact current run/version and scenario/fixture versions from read-back, plus `commandId`; original reset result on replay. |

Every endpoint uses the shared access gate, exact-Origin/CSRF checks, no-store responses and FUCQ-84's **presenter control cookie**, independently of the acting employee. Browser principal/role/run authority remains forbidden. Reset issues fresh HttpOnly/Secure presenter/acting cookies for its new current run; raw credentials never enter JSON or receipts. If cookie issuance fails after a committed reset, the successful result explicitly reports `presenterSession.status: unavailable` and asks for trusted backend session bootstrap, without pretending the reset rolled back. The reset route alone can authenticate the **hashed, unexpired** historical presenter cookie for an already-stored reset receipt; changing its command/input or using it for another operation is refused. Replaying an earlier reset cannot issue a credential into a subsequent run. Backend history remains readable through trusted repository contexts; offer access/decisions/outbox commands remain current-run guarded.

Domain time is only `clockInstant`/`clockVersion` from this port. Identity session expiry uses its existing injected wall-clock security authority (`identity.session.clock`), which a presenter cannot extend by slowing/resetting domain time. Repository `createdAt`/`updatedAt` and deployment migration timestamps remain storage/transport metadata, not expiry, policy-effective or employee-evaluation time. Timestamp construction from supplied instants is not a second time source. The backend fixture `server/test/fixtures/gcsp-clock-outcomes.json` and `gcsp-clock-reset.test.js` record actual read/advance/tick/reset/stale shapes, durable retry, concurrent/reset rollback and old offer/decision/job refusals. No screen or component changes; the supplied shell/Used Cars visual references remain binding for FUCQ-75's later controls.

## Ownership and extensions

FUCQ-53's [synthetic identity allocation contract](synthetic-identity-allocation.md) adds offline `allocateSyntheticIdentities` / `allocateInventoryFile` ports, immutable whole-inventory replay, delivered/current-only VIN generation and `publishStockOrders` through the existing repository transaction port. Stock imports start unreleased, carry no VIN and preserve current operational state; `runs.versions.syntheticIdentityInventory` records the artifact revision/digest. Only the seven-digit order reference is exposed by the employee projection. File publication and PostgreSQL import are separate stages with independently atomic failure; this adds no repository table, public write endpoint or scheme-policy source.

| Owner | Implements / consumes |
|---|---|
| FUCQ-80 (FUCQ-79) | This versioned contract, links, assumption keys and extension/change-log rules; no runtime implementation. |
| FUCQ-81 (FUCQ-79) | Repository port, SQL/memory adapters, migrations, initial transaction tables and contract tests. |
| FUCQ-82 (FUCQ-79) | Canonical seed, file-backed PolicyService reads/provenance, source-location entry in build-rules.md. |
| FUCQ-83 (FUCQ-79) | Additive dated policy tables, idempotent seed, PostgreSQL provider, immutable publishing/pinned reads. |
| FUCQ-84 (FUCQ-79) | DemoIdentityAdapter, fictional principals, middleware, acting sessions, role/resource/run boundary. |
| FUCQ-85 (FUCQ-79) | DemoClock, registry/order/replay, startup recovery entry point and synthetic reset. Handler rules belong to the registering stories. |
| FUCQ-66 | Manual claim/release/expiry rules, timing phases, quotes and expiry handler over FUCQ-81/82/84/85; no second repository. |
| FUCQ-29 | Employee eligibility/affordability/essential gates and ranking, reading FUCQ-82/83; no local rule/default table. |
| FUCQ-65 | Manual employee/driver/contract/entitlement context using FUCQ-84 and the shared repository/policy; no separate identity resolver. |
| FUCQ-91/94/95 | BriefService/versioned permission and single-change operation, employee controls and activity projection. |
| FUCQ-92/96/100 | Release pull/replay, shared allocation/tie-break, buddy hold/offer and expiry handlers. |
| FUCQ-93/97/98 | Outbox dispatch/capture, presenter viewer and configured real transport; mail cannot decide allocation. |
| FUCQ-102/105/106/107/108 | Run-bound offer access, truthful offer read/display, decisions, one confirmed change and shared ordering handoff. |
| FUCQ-71/72; FUCQ-110 stories | Shared manual/buddy ordering adapter and post-selection target lifecycle/appointment/document states. |
| FUCQ-99/101/103/104; FUCQ-74/75 | Greg aggregates/publish/supply consumers, forecast/plan extensions, scenarios/presenter controls over the same run/policy/time. |

An implementing story adds its schema/key/method and provenance here in the same commit as the additive implementation, plus a change-log entry identifying the owner, contract version and consumer compatibility. Add fields without changing existing meaning, retain old enum readers during rollout, supply provider parity/affected-consumer evidence and update the seed once. If a reversible assumption needs refinement, record its changed key and basis; do not spread a second active default. Human questions about unverified BMW facts can be queued while a labelled synthetic assumption permits progress under the build rules.

## Change log and reviewable assumptions

| Version / date / owner | Change and keyed assumptions |
|---|---|
| 1.0.0 / 2026-11-05 / FUCQ-85 | Adds repository currentRun/resetRun, persisted DemoClock/registry/startup/reset and presenter HTTP binding. Adds canonical `clock.commands.v1`, `clock.handler.order.v1`, `clock.scenario.v1`; additive inventory snapshot retains allocator provenance. Same identity authority and employee time port; no existing consumer meaning changes. Backend response fixtures and memory/SQL-driver parity; managed PostgreSQL and draw.io rendering remain unverified. |
| 1.0.0 / 2026-11-05 / FUCQ-29 | Adds the stateless employee recommendation consumer and `employee.recommendation.v1` calibration through the existing PolicyService. Reuses exact snapshots/typed terms, context and clock ports; no existing method meanings change. The authorised trusted cash-filter opt-out preserves retail defaults and avoids invented employee prices. |
| 1.0.0 / 2026-11-05 / FUCQ-53 | Implements seeded target-format stock references and enabled-profile delivered/current VIN association, immutable source/version replay and whole-owned-inventory collision bounds. Adds `runs.versions.syntheticIdentityInventory` metadata through the existing repository port, plain visibility/provenance/failure projection and the independent offline checksum checker. Allocation algorithm/bounds are versioned artifact data; no active scheme assumption or existing consumer meaning changes. |
| 1.0.0 / 2026-11-05 / FUCQ-84 | Implements the agreed identity component and shared HTTP context boundary, run-scoped fictional principal/slot/session seeding, presenter-controlled acting cookies, role and persisted resource ownership guards. Adds `identity.demo.principals`, `identity.session.durationSeconds` `identity.session.clock` and `identity.session.sameSite` to the canonical policy seed without changing existing policy values or contract meanings. Backend context/refusal fixtures and deterministic adapter/HTTP tests protect downstream consumers and retail/gate continuity; managed PostgreSQL execution remains unverified. |
| 1.0.0 / 2026-11-04 / FUCQ-81 | Implements the existing TransactionRepository through `createMemoryRepository({ store })` / `createPostgresRepository({ schema?, migrate? })`; `0001_transaction_foundation.sql` creates 17 foundation tables with additive JSONB payloads, generated scoped keys/foreign keys and partial occupying-car uniqueness. Six policy tables remain FUCQ-83 migration `0002`; no interface meaning changes. Backend outcomes: `server/test/fixtures/gcsp-repository-outcomes.json`. Local scoped evidence is 37 passes across the memory contract and SQL-driver doubles, with two explicit unset-URL skips for the live PostgreSQL contract and native constraints; real SQL execution remains unverified. |
| 1.0.0 / 2026-11-04 / FUCQ-82 | Additive clarification: common discriminant is `status`; preserve actual FS&UK and RR&Production source names without asserting a UKNSC mapping. File provider/seed implementation, exact pin semantics, explicit provider injection, the `eligibility.context.mapping` key and presentation evidence are recorded above; no contract meaning or version change. |
| 1.0.0 / 2026-11-04 / FUCQ-80 | Initial foundation contract; all table/method names are draft `contract.storageVocabulary.v1` / `contract.portVocabulary.v1`; brief numeric scale `brief.slider.scale`; transaction key encoding `transaction.idempotency.keys.v1`; deployment migration ledger `repository.migrationLedger.scope`; presenter commands/order `clock.commands.v1` / `clock.handler.order.v1`. Behavioural/identifier assumptions and source dates are catalogued above. |

Morning review should focus on the assumed manual order-review phase and the explicit tie-break/seed choices. They are revisable synthetic defaults, not additional approved BMW behaviour. Numeric monthly prices/allowances require labelled source rows from FUCQ-82; this document does not invent BMW prices from eligibility matrices.

The FUCQ-80 contract baseline was documentation only. The FUCQ-81/82 backend implementations add no screen or UI component; their presentation fixtures and checks are recorded above. The [experience contract](experience-quality.md) and [shell/palette and Used Cars body reference](screens/README.md) remain binding for implementing stories; screenshots are not applicable to this document change.
