# Shared recommendation design: used cars and employee cars

1 November 2026. Extends [FUCQ-8's evidenced reuse assessment](engine-reuse-assessment.md) in response to Russell's instruction to make the recommended reuse implementable in both scenarios without regressing either, and to show it on the HLD. Used Cars code changes are permitted where needed. This document specifies the proposed architecture and migration; it does not claim that the extraction or employee service has been implemented.

Canonical diagram: [high-level-design.drawio](../design/high-level-design.drawio). [HLD guide and status](../design/README.md). Business baseline: [Paula's blueprint](service-blueprint.html), [demo brief](demo-brief.md), [experience contract](experience-quality.md), [COMPONENTS.md](../../COMPONENTS.md). FUCQ-6's description/comments were read during the original review, which made no Jira changes. After Russell's approval, [implementation stories](fucq-7-stories.md) were created under FUCQ-8 at his request.

## Decision and alternatives

**Keep the existing used-car interfaces and HTTP contracts behind a retail compatibility layer. Extract a small shared decision core and shared presentation/feedback primitives. Give retail and employee cars separate server-selected policy profiles and workflow owners.** Initially these are modules within the existing Node backend and ES-module frontend, not additional network services or a new framework.

| Approach | Benefit | Cost / risk | Decision |
|---|---|---|---|
| Shared core + separate scenario policies and workflows | Reuses tested calculations, explanations and controls; preserves retail contracts; scheme constraints are explicit. | Requires deliberate internal contracts and compatibility tests. | **Recommended.** Migrate incrementally with the existing retail façade as the first consumer. |
| Copy the engine/UI for employee cars | Fast initial isolation. | Corrections, explanations and components drift; improvements and defects must be maintained twice. | Reject as the steady state. A throwaway investigation is not the product implementation. |
| One universal journey/answer schema with scenario flags throughout | Appears to maximise reuse. | Retail budget and game assumptions leak into scheme rules; controllers become combinations of brand, mode, scenario, role and lifecycle flags. | Reject. Share mechanisms at stable boundaries, not every workflow or business meaning. |

Brand and scenario are independent. `BMW` selects brand language/data calibration; `used-retail-v1` or `employee-scheme-demo-v1` selects rules and semantics. An employee request cannot select the permissive retail profile. Profiles are selected by server application wiring/routes and published versions, not trusted browser fields.

## What is shared, and who owns the differences

| Capability | Shared implementation | Retail owner / behaviour | Employee owner / behaviour |
|---|---|---|---|
| Vehicle facts | Candidate identity, typed facts, source/assurance metadata, immutable snapshots and common attribute access. | Retail adapters retain advert identity, indicative model values and listing prices; existing defaults stay within the compatibility profile. | Scheme adapters supply exact stock/VIN linkage, dated eligibility/terms and explicit unknown essentials. Do not drop vehicles merely because they have no retail cash price. |
| Candidate evaluation | Pure evaluation pipeline, reusable scoring curves, evidence/reason assembly and deterministic ordering helpers. | Preserve current filters, configured blend (default 80/20), brand tuning, rounding and tie-breaks initially. | Apply scheme eligibility, essentials, driver, contribution and timing gates first; then rank stated preferences/importance using a separately versioned calibration. |
| Grouping and result views | Optional display grouping over exact decisions, member selection and derived group summaries. | Preserve grouped models, counts, sampling, clusters, nearby/local framing and manual whole-pool mode. | Group for browsing only. Allocation/holds use exact cars and complete eligible candidates before display truncation. An offer is one exact car. |
| Feedback | Typed actions, predicates/reducer helpers, visible changes and undo controls. | Translate existing local colour/price/odometer/gearbox filters, whole-group shrug and game taste signals without changing their meaning. | Offer decision and brief services persist exact decline versus confirmed brief amendments. An expiry is not dislike; inference cannot overwrite stated facts or scheme rules. |
| Questions and preview | Schema-driven controls, conditional rendering, scheduling/invalidation and draft summaries. | Preserve question keys, defaults, hidden-question rules, game inputs and legacy hashes. | Separate preferred position, importance and indifference; explicitly confirm prefilled facts/defaults. Draft preview is not saved consent or a reservation. |
| Cards and comparison | Image/fact/specification rows, missing-data treatment, per-member decision presentation and action slots. | Used cash price, odometer, dealer provenance and external listing action. | Points/contribution/period, collection timing, comparison with current car, offer status and accept/reject actions. |
| State | Small common version/action types and repository interfaces where meaningful. | Session-local browse state and existing share hashes remain valid. | Account-backed brief/history, allocation, offer/hold, renewal case and notifications live in authoritative backend state. |
| Sources and transport | Dependency-injected adapters and contract-test fixtures. | Existing retail feeds, snapshots, cache, geocode and dealer directory continue. | Synthetic and eventual BMW providers implement the same scheme-facing ports. Catalogue description, exact build, stock and connected-use providers remain distinct. |

Current source locations and limitations are established in the [assessment](engine-reuse-assessment.md). Shared code must not import employee case/offer services or a retail feed; scenario services depend inward on the shared core. No core scorer performs network calls, mutates cached source cars, sends mail or claims stock.

## Internal contracts

These are proposed implementation contracts, not assertions about BMW APIs. Add them as plain ES modules and JSDoc/validation first; no build-system or TypeScript migration is required.

### Vehicle facts and financial terms

`VehicleSnapshot` contains `candidateKey`, `sourceNamespace`, optional `vin`, `snapshotVersion`, `observedAt`, display identity/imagery and typed `facts`. Each decision-critical fact has a value or an explicit unknown, units where relevant, source reference and assurance such as `confirmed-listing`, `confirmed-build`, `model-reference`, `derived` or `synthetic-scenario`.

An advertised listing key, exact stock key, model grouping key and VIN are separate concepts. Preserve original source keys; do not synthesise an authoritative VIN from an advert. Group keys are presentation identities and can never be reservation keys.

Money is scenario-owned: retail terms contain GBP purchase price; scheme terms contain points, allowance inputs and dated cash contribution with currency and period. A missing retail price is not zero, and points are not pounds. `monthlyFrom` fixture text is not scheme finance. Do not feed employee points or monthly contributions into a fake purchase budget merely to satisfy today's `rankCars` interface.

Facts and financial/eligibility overlays are separate. Never write an employee's eligibility, contribution, hold status or score into a vehicle object shared by the retail cache. Prefer immutable evaluation inputs; enrichment of decision-critical facts creates a new snapshot and requires re-evaluation. Representative imagery can load separately without changing the decision.

### Scenario brief and policy

`RecommendationRequest` binds `scenarioId`, `briefVersion`, the validated brief, `policyVersion`, a candidate snapshot/version and evaluation context. The application resolves the profile and permitted stock source; caller-provided scenario/profile strings cannot downgrade that choice.

The common preference representation supports attribute, desired value/range, importance, indifference, provenance (`stated`/`inferred`) and confirmation state. Essentials are explicit predicates rather than large weights. Unknown input differs from indifference. The retail adapter translates legacy answers without inventing new essentials. The employee adapter retains checked needs, spending ceiling and required-by date separately from taste and strategic steering.

A policy supplies input validation, hard/unknown outcome evaluation, dimension selection/calibration and deterministic ordering. `used-retail-v1` must initially reproduce the current algorithms and brand tuning exactly. `employee-scheme-demo-v1` is a separate composition: confirmed essentials and scheme rules constrain the candidate set, while reused score curves rank appropriate attributes. Comfort and sportiness can both matter. Current-car continuity and explicit carrying needs are supported without guessing them from household type.

Version profiles immutably. If Greg changes a weighting or points table, publish a new effective version. Subsequent evaluations use it; an existing offer retains the quoted terms under the proposed offer-stability policy. That policy and its real-scheme validity remain to be agreed.

### Exact candidate decisions

The core produces `CandidateDecision` for every evaluated exact candidate:

- `candidateKey`, brief/policy/stock/terms versions and evaluation time;
- `gateStatus`: `eligible`, `ineligible` or `needs-confirmation`, with structured rule/fact evidence;
- component scores and a profile-defined total where scoring is meaningful;
- structured reasons, trade-offs and unknowns referring to the same exact candidate and inputs;
- the scenario's financial display terms or a reference to them.

Evaluate eligibility before ranking and **before slicing/grouping**. Explain zero viable cars from the complete relevant input set. An “unavailable fuel” inventory statement is distinct from “none meets your rules and budget”. A missing feed is an unavailable-data outcome, not proof that no car exists. The employee service does not offer an essential-unknown car as confirmed suitable; it can surface it separately for confirmation/help.

`buildResultView(decisions, presentationPolicy)` creates grouped retail cards, clusters, alternative samples, previews or employee browsing views. A group contains exact member decisions and a selected member key. Its aggregate feature union is labelled as availability within the group, not as equipment on the selected car. Selecting a sibling changes price, facts, score, stretch, reasons and actions together. No client reimplements server weights to reconstruct a missing exact score.

Scoring percentages remain profile-specific heuristics. Do not compare different profile versions as if the numbers were one calibrated satisfaction scale, or use raw rank scores alone as a fairness rule between employees.

### Feedback and persistence

Use data actions rather than UI-owned predicate closures as the reusable boundary: `excludeCandidate`, `excludeGroup`, `setPreference`, `setEssential`, `removePreference` and `undo`, with source/scope, target identity, reason and expected state version. A common pure reducer/predicate evaluator can serve both consumers. Translators retain each existing mode's semantics; they do not collapse all five modes into one rejection algorithm.

Retail actions continue to update local session state. Whole-group dismissal remains whole-group dismissal; price and odometer thresholds retain existing operators. A Podium mileage edit still means annual driving mileage, not the rejected car's odometer. Existing inferred game answers continue through retail compatibility code; these heuristics are not promoted to scheme facts.

Employee actions go through `BriefService` with expected-version checks, user-visible confirmation and durable storage. Inference proposes a correction; it cannot change `charging: none` to `either`, remove an essential or alter eligibility silently. Employee reasons remain available even when no present alternative exists, because future releases and Greg's unmet-demand view still need that information. Retail's “offer only a currently useful refinement” rule remains a retail presentation policy.

`OfferService.reject` is a separate domain operation. It releases the exact held vehicle and records the decline once. An optional brief amendment is validated/versioned separately; a conflicting edit must not trap an unwanted car in a hold or convert “reject” into “accept”. Rejecting/expiring an offer and undoing a browse filter are different actions. A local undo cannot resurrect an expired hold or reverse a completed allocation.

### Public presentation contracts

Keep `server/engine.js` exports and existing `/api/questions`, `/api/match`, `/api/preview`, `/api/field`, `/api/nearby`, `/api/pool` and `/api/geocode` as the retail compatibility surface. Preserve existing request validation/defaults, brand/scope handling, error conventions and columnar pool encoding. Do not route the full-pool manual mode through a top-match endpoint.

Existing response fields remain stable. Exact-listing display decisions can be additive to `publicMatch.listings`, while preserving the representative top-level fields for old clients. The new card consumes those exact decisions. During mixed-version operation, it must suppress an unsupported exact score/reason after switching listing rather than showing the representative's reassurance as if recomputed. Publish supported contract/profile versions in an additive metadata capability; leave `/health`'s existing response intact.

Employee endpoints use a separate application namespace, for example `/api/gcsp/...`, and derive employee/scheme/role context from the authorised demo or future identity adapter. They never trust an arbitrary employee ID, points value, deadline, exclusive availability or permissive profile supplied by a browser. Offer reads expose the current persisted state. An employee client requiring an unsupported contract fails clearly instead of calling retail endpoints as a fallback.

The UI kit accepts view data and action callbacks, not a scenario flag that triggers HTTP calls or writes. Extend the existing card/question/preview helpers incrementally. Introduce shared comparison rows and feedback-summary controls only when consumed; preserve the catalogue/ratchet and establish the required gallery with component work. Retail mode controllers remain responsible for quiz/game/browse flow. Employee home, offer and Greg controllers own their workflows.

## Target module seams

Names below are proposed destinations to make the design implementable; preserve compatibility re-exports while moving code.

| Proposed module area | Starting source | Responsibility and migration limit |
|---|---|---|
| `server/recommendation/` | `server/engine.js` | Pure candidate evaluation, dimension helpers, structured evidence and deterministic sort utilities. No retail source, employee persistence or HTTP dependency. |
| `server/scenarios/retail/` | `engine.js`, `brands.js`, `questions.js` | Legacy-answer translation, current hard filters/score composition, retail explanation/presentation policy. Retain old exports/brand registry API. |
| `server/scenarios/employee/` | New, informed by FUCQ-8 | Brief validation, scheme hard/unknown gates, contribution/timing context and employee preference calibration. Reuse only meaningful scoring dimensions. |
| `server/vehicles/` and adapter ports | `mapping.js`, `stock.js` | Facts/identity/provenance contract and source adapters. Keep source fetch/cache normalisation separate from employee overlays. Existing mapper signatures can remain façades. |
| `server/gcsp/` | New application services | Brief, release processing, demand, allocation, hold/offer, notifications and renewal cases; downstream lifecycle ports. |
| `server/adapters/` | `buildServer(deps)` seam plus new providers | Retail, synthetic/BMW data, transactional state, clock/events and mail implementations. One use-case path for fixtures and real providers. |
| `blocks/vehicle-matcher/` shared kit | `question-ui.js`, `result-card.js`, `preview-feed.js`, `ui.js` | Preserve public helper APIs initially; add explicit options/view models and pure feedback helpers. New employee views import the same kit. No wholesale mode rewrite. |

Common candidate evaluation and source normalisation remain server-side. Sharing frontend helpers does not ship scoring weights, private briefs or the employee fleet ledger into the browser. The retail manual mode may still receive its current full public display pool; this existing behaviour is not extended to private employee data.

## Employee workflow around the core

The HLD shows these as proposed modules, not existing deployment services:

1. Employee/current-car/contract adapters and optional usage adapter supply facts; `BriefService` saves confirmed needs and separate search/hold permission.
2. A real or replayable synthetic release source changes exact available stock. Brief/rule changes also trigger evaluation. Versioned future order requests, confirmed supply and released stock remain different records.
3. The employee policy and shared core evaluate complete viable pairs. `AllocationService` applies an explicitly configured illustrative policy across manual and buddy routes. Its tie-break, urgency, multiple-entitlement and recovery semantics need scheme-owner agreement; loop order cannot decide them accidentally.
4. `OfferService` conditionally acquires an exclusive vehicle hold and creates the offer. Persist the hold, offer and notification outbox job atomically in the same transaction; dispatch only after commit. This avoids a crash leaving an active offer without a notification job. Availability uncertainty is reconciled before notification or reassignment.
5. A mail adapter delivers through the selected Microsoft route or Brevo; an in-app read shows the same offer. Retried delivery uses a stable notification ID and does not acquire another car or alter priority.
6. Accept/reject/expiry check current hold, terms, ownership and version. The authoritative transaction prevents two holders for one car and enforces the configured employee entitlement/hold limit. Duplicate commands return their prior outcome. Expiry derives from persisted state and the service clock, not the visible countdown.
7. Renewal-risk cases have an owner, next action and update date. Order/approval/document/appointment/collection/return ports represent later blueprint handoffs; they are not silently added to the demo's proposed confirmed-allocation endpoint.

For shared demo state, the target is a **transactional SQL repository**, with PostgreSQL as the proposed reference implementation behind the adapter. Use database transactions/conditional writes and uniqueness constraints; a Node in-memory lock is insufficient across restarts or more than one process. Keep briefs, exact stock/holds, offers/decisions, cases, policy versions and notification outbox logically separate within that store. Host/provider, connectivity and approved cost are deployment decisions for Gary; no database has been provisioned by this design. Tests must exercise real transaction semantics as well as fast in-memory fakes.

The stock/action port exposes current exact availability and conditional `claim`, `release` and `confirmSelection` operations, with expected stock revision and idempotency key. In the demo, the SQL-backed stock/hold implementation is the authority and can join the offer/outbox transaction. If a future BMW system owns reservations, its remote write cannot join that local transaction: persist a pending operation, use the provider's conditional/idempotent operation, and reconcile its acknowledgement before activating an offer or sending notification. A timeout remains pending/uncertain; it is never assumed to mean either a successful hold or a safe release. The adapter must declare unsupported operations explicitly rather than implement a cosmetic success. These are required application capabilities, not claims that BMW currently supplies these APIs.

The replayable demo clock/event source invokes the same release/expiry/case services as eventual live inputs. Store event IDs and processing outcomes so replay does not double-allocate. Startup and explicit demo ticks reconcile expired/uncertain work. Truly unattended background operation requires an always-running/scheduled execution mechanism agreed with the backend host. The declared Render free plan must not be assumed to execute timers while asleep.

## Migration and protection of both scenarios

This is a staged implementation specification. Code extraction and feature work must not be represented as built merely because the HLD is saved.

| Stage | Concrete change | Exit evidence / rollback |
|---|---|---|
| **0 · Capture the contract** | Freeze representative retail outcomes and HTTP payload contracts from all brands/modes; record stock fixture versions and score-affecting environment, including `TASTE_SHARE`. Turn the two confirmed defects, preview invalidation and context-preserving sharing into focused regression cases. | Existing 234-test baseline plus independent expected outcomes. No live feed required for deterministic equivalence. Fix expectations are separate from frozen correct behaviour. |
| **1 · Repair correctness at current seams** | Fix empty-result response/HTTP completion; return exact member decisions and update selected-listing claims together; strengthen preview invalidation; preserve context in generated retail share links. | Each correction has a failing-before/passing-after behavioural case. Relevant visual evidence for user-visible changes under the experience contract. Review these as intentional corrections, not a silent score retune. |
| **2 · Extract without changing retail policy** | Move pure helpers/core and retail composition behind current exports; keep old HTTP/answer serializers. Produce the same scores, reasons, grouping and side effects for fixed inputs. | Differential run against the pre-extraction implementation with zero unexplained changes. Keep the old path available until parity passes; revert the module-wiring commit independently. No scheme rules enter the retail profile. |
| **3 · Add the employee consumer** | Add provenance-aware candidates and separate scheme profile/routes; synthetic providers enter through the intended adapters. Introduce the transactional repository for versioned saved briefs before claiming durable saving. Employee preview/manual/buddy use the same authoritative eligibility evaluation. | Employee constraint/unknown examples, restart/save/reload and concurrent brief-version checks pass, profile-downgrade attempts fail, and retail matrix remains green. Disable employee routing without removing retail modes. |
| **4 · Connect stateful employee actions** | Extend the repository with release/clock processing, allocation, exact holds/offers, transactional notification outbox and cases. | Contention, retries, duplicate events, concurrent brief edits, restart/expiry, atomic offer/outbox writes, release and stale-link tests. Manual and buddy routes contend through the same operation. No browser-local stock authority. |
| **5 · Share presentation and release** | Move only genuinely common view logic into the kit; wire FUCQ-13 launcher and retained deep links. Deploy compatible backend before frontend. | Six-brand/five-mode retail checks, selected employee states, desktop/narrow/keyboard inspection, gallery/ratchet and deployed API/frontend smoke checks. Exact revision pair and rollback recorded. |

The stages are bounded candidate implementation slices, not new Jira items created automatically. They can be refined into the existing `decided`, `acceptance` and `validate` story fields after design agreement. The authorised foundation items and VIN/catalogue work remain dependencies/inputs; the entire employee lifecycle is not bundled into one story.

### Regression matrix

| Contract / invariant | Used Cars protection | Employee protection |
|---|---|---|
| Policy isolation | Current family/crew, budget stretch, soft fuel/body/charging and taste behaviour unchanged under the retail profile. | Eligibility, cash ceiling, essential equipment/space/drivers and required date cannot be compensated by a high preference score. Unknown essentials remain explicit. |
| Brands and modes | BMW, MINI, Ford, Honda, Motorrad, Ferrari × questionnaire, swipe, head-to-head, Podium and Guess Who. Preserve bespoke questions, source routing, dealer/national scope and mode keys. | Only supported scheme brands/entitlement matrix exposed. Brand changes cannot change the scheme or widen its stock permissions. |
| Exact car and grouping | Selected price/image/kit/link/score/reasons all refer to one member. Group counts/union remain aggregate. Existing sampling/caps remain presentation limits. | Eligibility and reservations evaluate exact complete candidates before grouping/truncation; no synthetic “union-equipped” car or omitted viable car determines feasibility. |
| Drafts, feedback and undo | Existing rejection actions retain their mode-specific semantics; old answer hash shapes still decode; context survives new links. | Confirmed facts/essentials survive inference; brief changes are visible/versioned; rejected exact cars do not reappear unchanged under the selected rule; expiry is not a taste signal. |
| API and partial failure | Existing endpoints, payloads, compact pool layout and client error conventions remain compatible. Empty matches complete; nearby failure is distinct from proven unavailability. | A missing capability or stale rule/stock/hold prevents an asserted successful offer; declined/expired/accepted links read current backend state. |
| Shared UI | Native inputs/focus, missing-image/data treatment, reduced motion, readable long names and existing control contracts preserved. No retail price label on a scheme contribution. | Current-car comparison, contribution units/period, loading/no-match/unknown/hold states and narrow offer page are understandable and keyboard usable. |
| State and concurrency | Anonymous discovery never writes employee data or takes a scheme hold. | Two employees racing for one car, two cars racing for one employee, repeated accept/reject, clock expiry, process restart and duplicate event/message handling preserve state invariants. |
| Inputs and providers | Fixed raw/mapped snapshots exercise unchanged retail scoring without provider drift. | Equivalent synthetic and real-shaped adapter fixtures produce the same decisions; no per-employee canned winner. Provenance/clock/policy versions make decisions replayable. |

Run narrow checks during each slice and the complete relevant suites at integration. Existing DOM tests are useful but not visual acceptance. Full browser walkthroughs were unnecessary for this analysis; browser evidence is required when implementation changes user-visible behaviour under the experience contract.

### Deployment and rollback

Keep GitHub Pages and Render as the observed deployment path. `gcsp-poc` work is reviewed and integrated to the repository's actual release branch before publishing; the Pages workflow currently targets `main`. Confirm Render's actual branch, revision, owner and plan with Gary rather than assuming it matches the frontend.

Use additive backend contracts first. Then release clients that consume exact decisions/capabilities. Preserve direct used-car `block.html`/mode/brand/scope/API links and legacy answer hashes; the new root launcher must not reinterpret an old used-car link as an employee account. Offer URLs identify a durable offer and environment; they do not encode private briefs in a public hash.

Rollback switches the employee entry/feature off while retaining compatible retail endpoints. Prefer forward-compatible schema additions and a recorded backend/frontend/profile/schema version set. Rolling back the frontend must not erase active holds or quoted terms. Complete/reconcile active employee state before any backend rollback that cannot understand it. Shared core changes still require retail regression checks even when their rollout flag is employee-only.

Later BMW hosting replaces identity, provider and operation adapters through sanctioned contracts. BMW auth/roles, authoritative data/terms, supported write/events, durable infrastructure, notification sender and operational ownership remain explicit integration conditions. The current demo password and fictional role selection are not production identity. The 1,000-employee comparison stays a stretch consumer of the same decision/allocation services with captured notifications, separate from an operational forecast.

## Decisions still owned outside this analysis

- Scheme owner/Sandeep: effective eligibility and contribution authority, essential-data assurance, exclusive hold/acceptance boundary, allocation/tie-break and multiple-entitlement/recovery policy. The proposed two-hour hold and stable quoted terms remain configurable assumptions pending agreement.
- Gary/platform owner: actual frontend/backend release revisions and branch wiring; PostgreSQL provider/connectivity and durable deployment; reliable background invocation; Microsoft/Brevo sender setup and future BMW identity/host conventions. See [GC questions](questions-for-gc.md).
- Application visual direction is agreed: use the supplied GCSP screenshots for the header, sidebar and palette, optional breadcrumbs, and redesign the body toward the consumer-facing Used Cars experience. Review a representative redesigned body early before parallel body implementation; this is no longer blocked on Russell providing another visual reference. See the [experience contract](experience-quality.md#visual-reference). The blueprint remains the service-journey artifact.

These decisions do not prevent specifying the shared code boundary. They remain gates for the corresponding operational implementation/release, rather than reasons to conflate retail behaviour with scheme policy.

Russell agreed this architectural direction on 1 November 2026 and requested scaffolding-template stories for FUCQ-8. The [published story set](fucq-7-stories.md), FUCQ-21–31, covers reusable recommendation capability and a stateless read-only employee consumer. Durable briefs, allocation, holds/offers, notifications and cases remain separate capabilities; their presence in the wider HLD does not place their implementation inside FUCQ-8.

## Status and review

Original code evidence and probes remain in [FUCQ-8 evidence](evidence/fucq-7/README.md). The analysis changed design documentation and the canonical HLD; the subsequent authorised refinement created eleven Jira stories with dependencies. The migration and regression matrix define what each implementation slice must prove; delivery of one slice does not establish parity for the remaining workflows.

FUCQ-23 implements the bounded exact-listing correction at the existing engine, HTTP, card and local-refinement seams. Each returned member retains its evaluator decision; selecting/refining a sibling updates its facts and claims together, while older-backend members suppress unsupported claims. Existing representative fields, aggregates and mode limits remain compatible. The [focused contract and corrected R1 trial](exact-listing-decisions.md) record the intentional £30k/£39k correction separately from FUCQ-27/28 extraction/parity. No module extraction or scoring calibration is implied.

FUCQ-30 implements the scoped local-feedback seam in `blocks/vehicle-matcher/feedback-actions.js`: serialisable actions, atomic scope/version checks, exact/group exclusions, retail predicates and reversible undo. The current questionnaire consumes it without migrating the other retail state machines. `server/scenarios/employee/feedback.js` replays confirmed changes against a complete authorised recommendation input and returns a new ephemeral draft version. FUCQ-91's saved-brief change operation calls the same canonical confirmed-change helper while retaining its transaction, audit, idempotency and consent boundaries. The shared kit and developer gallery show local scope and undo; they introduce no employee application screen or durable offer operation. The [feedback contract and validation record](feedback-actions.md) describe the precise boundary and evidence.

The HLD distinguishes built current components from proposed extraction, employee workflows, state and integrations. Diagram boxes within the existing backend are logical modules, not an instruction to create microservices. Optional connected data, future BMW integration and stretch simulation are labelled accordingly.

FUCQ-30's implementation status is recorded here in prose. The existing diagram already describes the shared-feedback boundary, but its status styling has not been changed or rendered for this delivery: no background draw.io tab was available at dispatch, and foreground-changing creation or raw XML edits are outside this run's permitted workflow. This is a diagram maintenance gap, not rendered verification.

Independent design review: reviewer/Opus, requested and selected `gpt-6.1-sol` / `high`, no fallback or descendants. Corrected offer/outbox atomicity, durable-brief migration order and configured `TASTE_SHARE` preservation following that review. The parent also made the future remote-reservation acknowledgement boundary explicit. This review does not certify implemented parity.
