# FUCQ-7: recommendation intelligence reuse for employee cars

1 November 2026. Assessment against version 2 of [Paula's service blueprint](service-blueprint.html), the [employee persona](personas/employee-car-chooser.md), [demo brief](demo-brief.md) and [experience contract](experience-quality.md). [Jira scope](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-7) and its single subsequent comment were read. This is investigation and proposed refinement, not additional authorised implementation scope or BMW operating policy.

**Blueprint revision note:** the assessment's step numbers refer to the fourteen-step version 2 baseline. Version 3 combined brief setup and expanded the recommendation / rejection narrative. Version 4 keeps those main labels, adds 01a / 04a, simplifies inputs and ends the primary walkthrough at 13. The [blueprint review record](service-blueprint-review.md) provides the crosswalk; these editorial revisions do not change the assessment's implementation scope or findings below.

## Recommendation

**Reuse the deterministic recommendation core and the strongest interaction patterns. Adapt their inputs, rules and state ownership for the scheme. Build the continuing employee service and shared-fleet transactions around them.**

There is substantially more to borrow than a scoring formula: structured preference capture, partial-answer previews, reasons derived from scores, honest ties and trade-offs, attributed rejection, visible reversible refinements, per-listing selection, comparison rows, manual filtering, brand configuration and an existing test/adapter seam. A runtime language model is unnecessary for this baseline.

The existing product helps a visitor discover approved-used cars during a visit. Paula's blueprint describes a continuing service that remembers her, watches for supply, secures an exact car, handles her decision and follows through. The existing matcher covers useful parts of steps 03–04 and 07–09; it does not already supply that continuing service. Backend stock warming is not a buddy watching an employee's saved brief, and a selected card is not a reservation.

The most important change is to separate **permission and suitability**, **employee preference ranking**, and **fair allocation of a shared fleet**. A high weighted score cannot compensate for an ineligible employee, an unaffordable contribution, an unmet essential, unverified essential equipment or arrival after the required date.

## Evidence and method

- Reviewed checkout: `27cf841e1af6ea1c0598bcd63700145138fdb947` on `gcsp-poc`, including the working-copy blueprint and GCSP context already present. Existing unrelated local changes were preserved.
- Primary evidence: [README](../../README.md), [system description](../how-it-works.md), production server/client modules and existing tests. Code takes precedence where prose or comments have drifted.
- `npm test`: **234 passed, zero failed/skipped**, 1 November. This establishes the existing test baseline; it does not establish employee-scheme acceptance.
- Executed [offline probes](evidence/fucq-7/reuse-probes.mjs); their actual output is saved in [reuse-probes.json](evidence/fucq-7/reuse-probes.json). They exercise the real engine, injected HTTP server and real card DOM with synthetic cars. No upstream stock calls, paid inference, BMW operations or emails were required.
- Source and DOM checks are the evidence for this assessment. No claim of rendered visual quality, browser-verified interaction or accessibility compliance is made. No application code, Jira records, deployment or dispatcher was changed.

## The current product, function by function

### What “fuzzy matching” means here

It is graded, deterministic suitability scoring. It is not fuzzy text search, an embedding search, a trained recommender or a language model. The inputs are structured answer keys and mapped vehicle attributes.

1. **Capture and normalise answers.** The server supplies brand-specific questions; the client applies matching conditional visibility. Budget and annual mileage have sliders; fuel and body can have multiple choices; priorities are a top-two selection. Some brands translate bespoke answers into shared engine fields. [questions.js:19](../../server/questions.js#L19), [question-ui.js](../../blocks/vehicle-matcher/modes/question-ui.js), [quiz-meta.js](../../blocks/vehicle-matcher/quiz-meta.js).
2. **Fetch and map stock.** Per-brand sources produce the common vehicle shape. Used-car feeds supply some listing facts; model tables, derivative heuristics, parsed feature text and defaults fill other fields. Fixture-backed sources use the same downstream shape. [stock.js:416](../../server/stock.js#L416), [mapping.js:1665](../../server/mapping.js#L1665).
3. **Eliminate a small set of failures.** Current hard filters are a purchase price above 115% of the selected upper budget and brand-configured seat/boot floors for family/crew answers. Fuel, body style and charging are not hard exclusions. There is no scheme eligibility, contribution, collection-date or exact-equipment gate. [engine.js:585](../../server/engine.js#L585).
4. **Score graded fit and taste.** Fit covers budget, body, fuel, practicality, economy and size, with optional doors. Taste covers performance and character, with optional MINI trim character. Weights change with selected answers and brand tuning. The default final score is `round(100 × (0.8 × fitRatio + 0.2 × tasteRatio))`; the `TASTE_SHARE` environment override changes this blend and must be captured in an extraction baseline. Priorities boost the active taste weights; historical priority boosts aimed at fit dimensions do not apply in this path. [engine.js:505](../../server/engine.js#L505), [engine.js:512](../../server/engine.js#L512), [engine.js:620](../../server/engine.js#L620), [brands.js:36](../../server/brands.js#L36).
5. **Sort and explain.** The actual sort is blended score, then taste, lower price and name. Despite the “Fit first, then taste” comment, this is not lexicographic fit-first ranking. Up to four positive reasons come from strong contributing dimensions; a stretch adds a warning. Structured per-car trade-offs cover fuel and body only. Pool-level unmet wants also cover only those two, measured against fetched stock rather than affordable survivors. [engine.js:643](../../server/engine.js#L643), [engine.js:684](../../server/engine.js#L684), [engine.js:713](../../server/engine.js#L713), [engine.js:741](../../server/engine.js#L741).
6. **Group and present choices.** Listings are grouped by model line, body, fuel, 0–62 and trim character. A representative holds the score; the group carries counts, price spread and equipment union. Cars within three score points form a cluster. A taste gap can justify naming a favourite; otherwise the UI admits a tie. Results are capped, with additional alternatives held back. [engine.js:779](../../server/engine.js#L779), [engine.js:823](../../server/engine.js#L823), [engine.js:869](../../server/engine.js#L869).
7. **Let the visitor narrow and choose.** Refinement applies to individual listings within returned groups. Selecting a copy updates its photo, price, mileage, gearbox, equipment and listing link. The questionnaire recalculates its headline from surviving results, including tied, closest, weak and empty states. This remains discovery within a bounded returned pool. [questionnaire.js:397](../../blocks/vehicle-matcher/modes/questionnaire.js#L397), [questionnaire.js:449](../../blocks/vehicle-matcher/modes/questionnaire.js#L449), [result-card.js:470](../../blocks/vehicle-matcher/modes/result-card.js#L470).

**Borrow the scoring machinery, but recalibrate what it means.** Its percentage is a heuristic fit score, not a probability of satisfaction or a validated measure of employee welfare. Retail thresholds were calibrated against used-stock pools and personas, not the employee scheme.

For Paula, several current assumptions are especially weak. Boot need is inferred from passengers and a single main-use answer, although she can travel alone with bulky luggage. Size is also used as a comfort proxy despite her parking concern. Annual mileage does not describe her longest regular office day. Charging is a coarse availability answer, not a checked plan. Comfort and sportiness are presented as opposing choices, while the brief explicitly allows qualities to coexist. Preserve her stated requirements and corrections instead of treating those proxies as facts. [engine.js:259](../../server/engine.js#L259), [engine.js:374](../../server/engine.js#L374), [questions.js:88](../../server/questions.js#L88), [questions.js:151](../../server/questions.js#L151).

### “Don't like this” is several different mechanisms

| Current mechanism | What actually changes | Employee-car judgement |
|---|---|---|
| Questionnaire: reject with a reason | Adds a local predicate for another colour, a price strictly below this listing, fewer odometer miles or the other gearbox, where a surviving alternative exists. Does not call the ranker again. | Reuse attribution, conditional reasons, visible constraints and undo. Persist an explicit brief amendment and re-evaluate full eligible stock. Retail purchase price and used odometer thresholds need different scheme meanings. |
| Questionnaire: “just not this one” | Hides the whole grouped model card, including sibling listings. It is not just exclusion of one exact VIN. | For offers, default to the declined exact car. Ask before generalising to the model, body, fuel or all future stock. |
| Questionnaire: positive refinements | Offers equipment, gearbox or paint axes only while they split the current set; predicates are evaluated on each listing, avoiding a false combination of equipment across siblings. | Strong pattern for helping Paula discover preferences. An essential must be checked over full stock and saved even when no current car meets it. |
| Podium dismissal | Can hide a car/colour or ask for a revised price, fuel, body or mileage answer and refresh ranking; available reasons depend on the brand's question set. | The most useful existing pattern for “what should I change in your brief?” Keep the employee's confirmation and save the change. |
| Swipe | Keeps or passes cars, with undo, then derives answer fields from liked cars. | Optional taste elicitation. A pass has no attributed practical reason and cannot prove a hard restriction. |
| Head-to-head | Records tournament choices and derives taste signals; the user-selected champion remains their hero even if the engine prefers another. | Borrow comparison anatomy and optional taste input. A tournament winner is not a suitability check or an offer. |
| Guess Who dismissal | Changes local price/fuel/body/colour/mileage/age/distance filters or removes one listing; supports snapshot undo. It does not invoke the weighted scorer. | Borrow explicit filtering and undo for manual selection. Persist employee brief amendments separately from a temporary browse filter. |

Evidence: [questionnaire.js:494](../../blocks/vehicle-matcher/modes/questionnaire.js#L494), [podium.js](../../blocks/vehicle-matcher/modes/podium.js), [mingle.js](../../blocks/vehicle-matcher/modes/mingle.js), [knockout.js](../../blocks/vehicle-matcher/modes/knockout.js), [match-signal.js:291](../../blocks/vehicle-matcher/modes/match-signal.js#L291).

The questionnaire's price/mileage rejection uses **hard local thresholds**, despite earlier refinement prose proposing soft reweighting. Its “whole pool” means returned matches and alternatives, potentially joined by nearby results; it does not mean every vehicle in national stock. Feedback is not a durable server-side learning model. Shared questionnaire links encode answers and fetch current matches again; they do not preserve all rejection/refinement state or a fixed offer. Head-to-head inference includes losers as well as winners, weighted by wins plus one; it is not simply a list of endorsed cars.

For the employee service, keep these records distinct:

- **Declined exact offer:** release that car and suppress an unchanged repeat offer to this employee under an agreed rule.
- **Changed brief:** an employee-confirmed preference, importance or essential, with its scope and version. “Too much contribution”, “not ready in time” and “cannot make charging work” are different causes.
- **Administrative outcome:** expiry, a missed email or delayed response is not evidence of dislike. Rejection is not evidence of entitlement to recovery priority.
- **After-use satisfaction:** whether the car worked in real life. Keep this separate from acceptance, inferred taste and accepted compromises.

These are proposed semantics for steps 09, 13 and 14, not changes to agreed BMW policy.

## Reuse across all fourteen blueprint steps

“Adapt” means preserve functioning code or an interaction pattern while changing its contract. “New” means the current application does not supply the business capability.

| Blueprint step | Evidence of current coverage | Reuse recommendation and remaining capability |
|---|---|---|
| **01 · A reminder, before the rush** | Brand shell and general display primitives; no employee, contract, deadline or reminder service. | **New business capability.** Employee/contract adapter, renewal case and calculated planning window. Use actual dates and separate entitlements. |
| **02 · Start with her Touring** | Vehicle mapping, imagery and card/specification presentation. No current-car account or satisfaction record. | **Adapt display and normalisation.** Add exact current-vehicle linkage, fact provenance, corrections and preserve/change feedback. Another version of a loved Touring can remain a good answer. |
| **03 · Describe a real week** | Real structured questions, conditional controls and partial-answer previews. No natural-language understanding or connected-use service. | **Adapt capture.** Ask about carrying, longest regular day, parking, drivers and charging; optional observed summaries remain separately sourced. |
| **04 · Agree her search brief** | Answer summary, multi-selects, budget/mileage sliders and top-two priorities. | **Adapt widgets; new brief/policy model.** Save essentials separately from preferred values and importance. Add authoritative eligibility and points/contribution calculations. Retire retail budget stretch from scheme affordability. |
| **05 · Let the service keep looking** | Local preview requests and stock cache warming. Completed questionnaire answers can be restored from a shared URL. | **New continuing service.** Durable versioned brief, search/hold permission, pause/resume, triggers and useful status. Greg's demand view is also new. |
| **06 · Get help if time is running out** | Weak/no-match presentation patterns and some unmet-want facts. No renewal risk or assigned case. | **Adapt explanation; new case management.** Persist blockers, owner, agreed action and update date. No-match should preserve essentials and support an authorised remedy. |
| **07 · A suitable car becomes available** | Common stock shape, deterministic ranking, fixture/real dependency seam and grouping. | **Adapt ranker; new eligibility, event, allocation and reservation services.** Rank eligible exact cars before presentation grouping. An exclusive confirmed hold is a separate transaction. |
| **08 · Review a useful offer** | Real cards, photos/fallbacks, reasons/trade-offs, listing selector and comparison rows. | **Adapt presentation and comparison.** Add comparison with current Touring, exact quoted terms, date, provenance, expiry and current offer state. Mail and offer-link service are new. |
| **09 · Make the choice herself** | Local rejection, undo and preference editing; external used-listing links. No acceptance/release operation. | **Adapt attributed feedback; new decision state machine.** Revalidate terms/hold, record once, release exact stock on decline/expiry and resume search. A card click never becomes an order implicitly. |
| **10 · Move the order forward** | No order, approval or document workflow. | **New integrations/state.** Preserve the boundary between accepted selection and acknowledged/approved order. Full administration is beyond the currently proposed confirmed-allocation demo endpoint. |
| **11 · Arrange a workable handover** | Dealer location/distance can support travel context; no slots or readiness service. | **New fulfilment capability.** Requested versus confirmed appointments, documents/readiness gates and renewal escalation. Retailer distance is not a collection promise. |
| **12 · Collect, return and close the loop** | No collection/return receipts, contract transition or financial reconciliation. | **New lifecycle capability.** Confirm old-car return and replacement collection separately through authorised providers. |
| **13 · Find out whether it really works** | Choice-based taste signals exist, but no after-use feedback or help routing. | **Adapt structured controls; new feedback/history.** Record actual experience, essentials met, compromises and assigned help. Acceptance is not satisfaction. |
| **14 · Make the next renewal easier** | URL answer replay and deterministic calculations; no employee history or renewal cycles. | **New continuity model.** Refresh retained needs, actual contract dates and rules; aggregate outcomes for Greg. Do not encode six-month cycles or automatic recovery priority as facts. |

The complete blueprint is the assessment baseline. It is not an instruction to implement all fourteen steps for 12 November. Steps 10–12 in particular expose future service boundaries beyond the brief's proposed demo allocation endpoint.

## Other useful pieces to preserve

| Existing asset | Concrete value for employee cars | Boundary to respect |
|---|---|---|
| **Manual hard-filter mode (“Guess Who”)** | Already filters the decoded full display pool by price, body, fuel, gearbox, age, seats, mileage, equipment and, when available, distance; supports removing constraints. Useful starting point for the retained manual route. | It runs in the browser over stock display data. Feed it the same eligible shared scheme pool and revalidate exact-car actions on the server. [guess-who.js:846](../../blocks/vehicle-matcher/modes/guess-who.js#L846), [index.js:347](../../server/index.js#L347). |
| **Partial-answer preview** | Shows the effect of a preference while editing, using the same engine and HTTP boundary. Useful for “I get to have my say”. | Partial defaults are provisional. Cancellation needs strengthening; do not persist a stale preview as a confirmed brief/offer. [preview-feed.js:31](../../blocks/vehicle-matcher/modes/preview-feed.js#L31). |
| **Honest ties, weak results and trade-offs** | Admits uncertainty and avoids declaring an arbitrary winner; useful buddy explanations when supply is thin. | Extend explanations beyond fuel/body to actual essentials, unknowns, cash and timing. Current thresholds are used-car heuristics. [questionnaire.js:449](../../blocks/vehicle-matcher/modes/questionnaire.js#L449). |
| **Comparison anatomy** | Existing head-to-head rows compare known listing metrics and suppress missing ones. Reuse row construction and the distinction between listing and model metrics. | Replace tournament semantics with current-car versus offered-car comparison. [knockout.js:450](../../blocks/vehicle-matcher/modes/knockout.js#L450). |
| **Brand registry, tokens and mode shell** | Six brands already share a configurable core. Employee and used-car surfaces can share a visual/component language without copying the retail journey. | Do not treat the mode switcher as employee identity/role navigation or assume all six brands are scheme-eligible. [brands.js](../../server/brands.js), [vehicle-matcher.js](../../blocks/vehicle-matcher/vehicle-matcher.js), [COMPONENTS.md](../../COMPONENTS.md). |
| **Vehicle cards, imagery and missing-data fallback** | Already displays real listing photos and selected-listing facts. | Catalogue images can be representative; model defaults and parsed equipment are not VIN build facts. Use the established FUCQ-4 limits and FUCQ-18/19 VIN work as separate inputs. |
| **Dependency injection and fixture shape** | `buildServer(deps)` lets offline and real sources exercise the same production logic; a good basis for the brief's replaceable adapters and reproducible scenarios. | Static fixture loading is not a replayable release-event source. Add event identity, clock/reset and versioned state if those demo behaviours are selected. [index.js:827](../../server/index.js#L827), [dom-harness.js:115](../../server/test/dom-harness.js#L115). |
| **Audit/persona and render tests** | Existing question/refinement sweeps and behavioural tests provide a starting method for measuring whether a preference changes the result. | Add employee-specific cases and shared-fleet outcomes. Passing retail tests does not validate scheme fairness, actual satisfaction or visual quality. [scripts](../../scripts), [server/test](../../server/test). |

Shortlisting language and “Your Shortlist” copy should not be mistaken for a durable saved shortlist service. Sharing is URL-based, not an authenticated employee record. There is no existing outbound mail, renewal reminder, Greg dashboard, demand aggregation, future ordering, scheme finance, reservation, acceptance, post-use feedback or fleet simulation service in the reviewed routes.

## Material findings from executable checks

These findings constrain reuse; this investigation has not fixed them. The reproduction inputs and outputs are in the linked evidence files.

| Finding | Observed result | Consequence |
|---|---|---|
| **Essentials cannot be implemented as weights alone.** | A sole EV estate survives a diesel/SUV brief with `charging: none`, returning a score of 49 and fuel/body trade-offs. A £39,000 car survives a £35,000 ceiling and scores 87, flagged as a stretch. | Expected retail closest-match behaviour, unsuitable as scheme hard gating. Keep non-negotiable eligibility, cash, equipment and timing outside the weighted blend. [engine.js:585](../../server/engine.js#L585). |
| **Selected listing can retain another listing's score and reasons.** | In one synthetic group, a £30,000 listing scores 96; a £39,000 sibling scores 87/stretch. Selecting the latter updates the visible specification to £39,000 but retains “96%” and “Sits right in your £25k–£35k budget”. | Material correctness defect for exact-car decisions. Re-evaluate the selected exact car and its explanation; do not quote group-representative results as exact offer facts. [result-card.js:184](../../blocks/vehicle-matcher/modes/result-card.js#L184), [result-card.js:374](../../blocks/vehicle-matcher/modes/result-card.js#L374), [result-card.js:500](../../blocks/vehicle-matcher/modes/result-card.js#L500), [questionnaire.js:397](../../blocks/vehicle-matcher/modes/questionnaire.js#L397). |
| **An empty match can fail at the API boundary.** | With a valid answer object and empty stock, the engine's result omits `alternatives`; `/api/match` subsequently calls `alternatives.map`. The injected request produced an unhandled rejection and no response before the one-second test timeout. | Material existing defect, particularly relevant to an honest no-suitable-car journey. The empty response shape must be consistent and the API must complete normally. [engine.js:890](../../server/engine.js#L890), [index.js:578](../../server/index.js#L578). |
| **Taste inference can overwrite an explicit charging answer.** | Two liked EVs turn `charging: none` into `charging: either`. | Do not reuse game inference as authority for practical feasibility or essentials. Confirm inferred tastes visibly and retain stated facts. [match-signal.js:333](../../blocks/vehicle-matcher/modes/match-signal.js#L333). |
| **Local refinement is not a full-stock search.** | Thirteen equally scored distinct models produce six shown and six alternatives. The thirteenth, the only towbar-equipped car in the synthetic pool, is absent from those returned listings. Groups themselves carry at most 24 sampled listings. | Apply saved needs before truncation; do not infer no supply or zero demand from a UI sample. [engine.js:792](../../server/engine.js#L792), [engine.js:800](../../server/engine.js#L800), [engine.js:905](../../server/engine.js#L905). |
| **Preview cancellation does not invalidate a dispatched request.** | Cancelled a real preview helper after dispatch, then resolved its mocked response: its callback still ran. | Some callers guard their own runs, but a reused helper needs an explicit invalidation/abort contract for employee edits and navigation. [preview-feed.js:31](../../blocks/vehicle-matcher/modes/preview-feed.js#L31). |

Grouping's equipment union needs careful interpretation, but it is **not** evidence that the current card blindly claims every sibling has all equipment. Listing refinements test each real listing and the card renders selected-listing equipment. The confirmed defect above is the retained representative score/reasons. Keep exact fitted facts, group availability summaries and representative model information separate.

## Data and integration constraints

The mapper deliberately substitutes model-level seats, boot, performance and some estimates/defaults; it also derives tags and parses feature descriptions into concepts. `advert_id`, a VIN fallback or a title/price fallback is not a uniform authoritative scheme vehicle identity. For employee use, introduce a stable exact-car key and attach source, observation/effective date and assurance to decision-critical facts. An unknown essential should produce “needs confirmation”, not a fabricated pass. [mapping.js:105](../../server/mapping.js#L105), [mapping.js:1530](../../server/mapping.js#L1530), [mapping.js:1665](../../server/mapping.js#L1665).

Stock caching, cold fixture fallback and stale national snapshots are useful discovery resilience. They cannot confirm exclusive availability. Reuse fetch/cache/normalisation patterns for descriptions, with clear freshness. Availability, eligibility, quoted terms and reservation require an authoritative recheck and acknowledged transaction. [stock.js:376](../../server/stock.js#L376), [stock.js:1066](../../server/stock.js#L1066).

The optional shared demo key is a gate on the existing API, not employee identity, role authorisation or authority to accept an offer. The API is otherwise request/response discovery with no durable employee/offer ledger. Retain these as HLD boundaries rather than assuming the existing transport provides them. [index.js:51](../../server/index.js#L51), [index.js:132](../../server/index.js#L132), [index.js:841](../../server/index.js#L841).

## From a personal ranker to a shared scarce fleet

The reusable computation is **employee × eligible exact car → score, reasons and trade-offs**. The current engine ranks one pool for one answer set. It does not decide which employee should receive the same car when several want it, or lock stock.

An illustrative example shows why independent rankings are insufficient:

| Employee | Car A | Car B |
|---|---:|---:|
| Paula | 94 | 92 |
| Another employee | 91 | Ineligible |

Giving Paula her top result immediately can leave the other employee without a suitable car. Allocating B to Paula and A to the other employee can serve both. This is a synthetic explanation of contention, not a selected allocation policy or a claim that raw scores are comparable welfare across employees.

The HLD should preserve this sequence:

1. Read a versioned employee brief, authoritative policy/terms and released exact-car snapshot.
2. Evaluate eligibility, confirmed essentials, contribution ceiling, driver constraints and timing; retain explicit exclusion/unknown reasons.
3. Rank viable employee–car pairs using configurable, explainable preferences. Keep the employee's desired values separate from importance and any visible BMW steering objective.
4. Apply an agreed allocation/tie-break policy across delegated and manual access. Decide treatment of urgency, multiple entitlements and any authorised recovery policy. Iteration order, email delivery speed and repeated rejection must not accidentally establish priority.
5. Secure one exclusive hold through the reservation boundary, then create the offer and notify. Rejection/expiry/acceptance operate on the exact car and current underlying offer state, with idempotent decisions and explicit quoted terms.

The per-employee price/name tie-break is not a fleet fairness rule. Neither a three-point cluster nor a 90% badge establishes that a car meets all essentials. Greg's weights may steer suitable alternatives; they must not make an unsuitable car eligible or silently rewrite an employee's stated needs.

## Implications for FUCQ-5 and later refinement

The [shared recommendation design](shared-recommendation-design.md) expands this assessment into concrete module/contract boundaries, migration stages and regression checks for both scenarios. The [canonical HLD and guide](../design/README.md) show the current implementation alongside the proposed shared core, independent policies and employee workflows. They specify an implementable target; no application extraction has been performed by this review.

Preserve shared components and the used-car routes. Prefer small domain services around the existing pure ranker over putting employee lifecycle state into a questionnaire mode. HLD contracts should explicitly own:

- **Employee/current-car context and versioned brief:** current facts, corrections, essentials, preferences, importance, dates, spending ceiling and separate search/hold permission.
- **Exact-car catalogue, stock and scheme terms:** distinguish model description from fitted facts, released stock from future requests/confirmed supply, and points from cash contribution.
- **Matching decision:** hard outcomes, component scores, grounded reasons/trade-offs and the policy/brief/data versions used. Score exact cars before optional display grouping.
- **Allocation, reservation and offer state:** fairness policy, exclusive hold, clock/expiry, stable quoted terms, idempotent acceptance/release and reconciliation of uncertain outcomes.
- **Notifications and follow-through:** notification transport after hold success; renewal/help cases; explicit downstream order/approval/appointment/return boundaries.
- **Grouped demand and outcomes:** derive Greg's views from saved needs and actual match/offer outcomes, not from the few cards shown. Keep after-use satisfaction separate. A future simulation must use the same services and declared assumptions.

Useful bounded follow-on candidates for discussion are a saved employee brief/current-car comparison, scheme-safe exact-car matching, attributed offer rejection with brief correction, and shared-stock reservation/decision handling. These are proposals to refine alongside existing foundation findings, not new Jira items created by this review. A component gallery and agreed GCSP visual reference remain necessary before parallel UI implementation under the experience contract.

The highest-value unresolved questions are:

1. Which essentials and unknown facts must block a firm offer, and which alternatives may the buddy ask Paula to consider?
2. Who supplies effective eligibility, contribution calculations and authoritative exclusive-hold confirmation?
3. What allocation principle governs manual and delegated users, renewal urgency, multiple entitlements and any recovery treatment?
4. When does a rejection mean “this exact car”, a changed brief or a temporary timing issue, and what prevents an unchanged immediate reoffer?
5. Where does demo acceptance end, and what acknowledgement starts the separate real order/approval journey?

## README and design-record reconciliation

The README is valuable context and already calls the engine deterministic, but several details lag implementation. It describes two endpoints despite the additional preview, field, pool, nearby and geocode routes; “browser only sees top matches” does not describe the full-pool manual mode. Its tie-break omits taste. Its extension section suggests LLM prose and “real images” as future work, while the current product already has photos and score-derived explanations, with no runtime LLM. The refinement plan starts “designed, not built” yet later records completed features; its proposed soft price/mileage reweighting differs from current local predicates. [README:239](../../README.md#L239), [README:284](../../README.md#L284), [README:363](../../README.md#L363), [refinement-plan](../refinement-plan.md).

Use the production paths and evidence above as the current baseline. Updating those older descriptions can accompany later authorised changes; the assessment does not silently rewrite them.

## Review roster

Both independent reviewers were dispatched using the authoritative `tools/tiers spawn reviewer --harness codex` output: requested tier Opus; requested and selected `gpt-6.1-sol` / `high`; `fork_turns: none`; no fallback or descendants. Effective runtime settings were not independently inspected.

- `matching_logic_review`: scoring, constraints, grouping, rejection variants and executable edge cases.
- `capability_reuse_review`: wider capabilities, manual route, adapters, components, persistence and blueprint coverage.

The parent reviewed and reproduced material probes and ran the full suite. IBM Global gateway check passed. Scaffolding doctor/install were run; installation staged its metadata refresh. Privileged apply and app restarts were not performed.
