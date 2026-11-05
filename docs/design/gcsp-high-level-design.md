# GCSP demonstration high-level design

FUCQ-6 · 1 November 2026 · Proposed for Russell/Gary's architecture agreement.

Updated 2 November 2026 for the user-approved [FUCQ-74](https://ibm-consulting.atlassian.net/browse/FUCQ-74) capability: recommend Greg's next vehicle order using predicted employee demand. Diagram page **08 Predictive order planning** records the added design; all new components remain proposed/unbuilt.

**Extend the existing canonical [draw.io HLD](high-level-design.drawio) with a GCSP overview and supporting views. The shared recommendation architecture is a child view within that design.** Keep the current implementation, reusable computation, employee transactions, vehicle evidence, planning/lifecycle and deployment views together. No second HLD or separate recommendation service is introduced.

The design supports the 12 November demonstration and the proposed 2027 front-end roadmap discussion. It specifies functioning demo behaviour behind replaceable adapters, with later BMW integration conditions kept explicit. It does not authorise all proposed capability implementation, provision infrastructure or establish BMW production acceptance.

**Later build direction, Russell, 2 November:** apply the [build rules](../gcsp/build-rules.md) to full planned scope and centrally stored, plausible assumptions that can improve through trials. Earlier stretch/defer descriptions are superseded. Architecture agreement and the agreed backlog/execution workflow remain in place.

## Review decisions, 4 November 2026

Gary's architecture review is recorded in [hld-review-gc.md](hld-review-gc.md) and applied to the diagram. Where this record disagrees, the review takes precedence. The main changes:

- **Hosting:** GCSP runs in its own Render environment (static frontend and backend) built from `gcsp-poc`. Pages, `main` and EDS sync stay retail-only until after the demo.
- **State and policy:** managed PostgreSQL. The canonical policy source is dated tables shaped like the target model, seeded from the repo and read through one PolicyService.
- **Background work and mail:** presenter ticks, with no unattended runner. A captured-outbox viewer always ships, with one real transport if ready.
- **Recommendation core:** FUCQ-21 and FUCQ-26 come first. The employee policy calls `rankCars()` until FUCQ-27/28, which follow after the demo.
- **Vehicle identity:** exact stock is keyed by a synthetic order UUID and carries a target-format `configurationId` (Base64 of model code and sorted option codes). A VIN appears only on delivered cars. The VIN lookup is in-process behind a port.
- **Holds:** a short manual cart hold, plus a longer buddy offer hold as a proposed new capability.
- **Integration target:** the target GCSP AWS platform, not the mainframe. The blocks also mount as web components for the target Angular app.
- **Lifecycle:** the demo uses the target's approval and appointment state names.
- **Paula's step 07:** after declining, she confirms one preference change rather than lowering a cash-contribution ceiling (agreed by Russell, `docs/gcsp/hld-agreement-2026-11-04.md`).
- **Predictive planning:** the deterministic baseline drives the demo plan. The learned model is shown alongside, labelled synthetic-trained.

## Design hierarchy and evidence precedence

| Option | Assessment |
|---|---|
| **Add a parent overview inside the existing HLD** | Recommended. Preserves the already agreed FUCQ-8 design and current-code baseline, gives FUCQ-6 a whole-service view, and keeps statuses and deployment assumptions in one artifact. Detail pages represent the same logical modules. |
| New GCSP HLD linking the existing file as a child | Useful if GCSP later becomes a separately owned system/repository. Today it duplicates shared shell, APIs, adapters and release facts and leaves two places to maintain them. |
| Expand the shared-recommendation page to contain everything | Makes the ranker appear to own allocation, orders and fulfilment, and makes the page harder to read. Keep those responsibilities in their own views. |

The [HLD index](README.md) names every view. The new overview links to existing detail pages; it is a navigation and responsibility view, not another deployment. Most boxes inside the backend represent modules in the same Node process. The proposed VIN lookup will expose an actual HTTP endpoint in that backend; immutable vehicle data does not require a second database or microservice.

Read current sources in this order when same-day records disagree:

1. **Russell's direct clarification during FUCQ-6, 1 November: use preference sliders and separate importance weights.** This confirms the [demo brief](../gcsp/demo-brief.md). The saved [blueprint, version 4](../gcsp/service-blueprint.html), [research](../gcsp/service-blueprint-research.md) and [revision record](../gcsp/service-blueprint-review.md) incorrectly remove them; those input-control passages are superseded by this clarification. Retain the blueprint's other service responsibilities and walkthrough unless separately changed. The fourteen-step numbering remains historical context.
2. The [experience contract](../gcsp/experience-quality.md) and [screen index](../gcsp/screens/README.md) establish the agreed header/sidebar/palette and consumer Used Cars body direction. Earlier research saying the reference is missing is superseded. A representative redesigned body still needs early review before parallel body work.
3. [FUCQ-8's assessment](../gcsp/engine-reuse-assessment.md) establishes current functionality and defects; its [agreed shared design](../gcsp/shared-recommendation-design.md) establishes reusable contracts. Its version-2 step numbers do not override the version-4 journey.
4. [FUCQ-5's interface evidence](../gcsp/bmw-interface-research.md) and the [VIN refinement](../gcsp/synthetic-vin-fleet-proposal.md) constrain provider claims. Jira capability numbers identify authorised scope; diagrams do not create additional backlog items.

## Responsibilities and state ownership

| Area | Responsibility | Current or proposed |
|---|---|---|
| Shared entry and shell | Select scenario and brand independently; retain Used Cars modes, links and themes. Employee/Greg navigation uses explicit demo role context initially, later authorised identity. Employee and Greg UI are separate GCSP blocks that import the shared kit; `vehicle-matcher` stays retail-only (review Q8). Each GCSP block also mounts as a standard custom element for the target Angular app, with no inline scripts, inline event handlers or `eval` (Q18). | Existing retail picker/EDS shell; shared launcher FUCQ-13 and GCSP role shell proposed. |
| Shared UI kit | Cards, photographs/fallbacks, facts, comparison rows, conditional controls, preview and feedback mechanics. Scenario view models supply labels, units and actions. | Existing primitives in [COMPONENTS.md](../../COMPONENTS.md); extensions/gallery proposed. |
| Pure recommendation core | Exact-candidate scoring helpers, evidence and result projection. No network access, stock writes, email or lifecycle state. | Existing deterministic retail engine; extraction proposed under FUCQ-8. |
| Retail policy and façade | Preserve existing HTTP/export contracts, six brands, five modes, current blend/tuning and local feedback meaning. | Existing behaviour; compatible internal restructuring proposed. |
| Employee evaluation | Server-selected eligibility/unknown gates, driver/essential/affordability/timing checks, then explained preference ranking over complete relevant stock. | FUCQ-29 stateless service and guarded `POST /api/gcsp/recommendations` implemented over `rankCars()` with canonical policy, exact snapshots and injected context/time. Explicit trusted provider composition is required; scores cannot override a failed or unknown essential. Integrated contract and retail checks plus the authored full suite pass; no lifecycle writes occur. |
| Brief and search activity | Confirmed versioned brief, search/hold permission, pause, meaningful last-check outcome and connection health. Drafts and inferred suggestions are separate from approved changes. | Proposed. FUCQ-8's read-only consumer does not supply durable saving. |
| Allocation and offers | One shared authority for manual and buddy access, exact exclusive holds, current offer reads, decisions, expiry and uncertain-operation reconciliation. | Proposed. Rank order is not a fleet allocation rule. |
| Greg's decision surface | Curate the next best action and proposed order list; explain predicted coverage, unwanted-stock risk, unmet needs, uncertainty and alternatives; edit constraints, recalculate and intentionally submit. | Approved capability FUCQ-74; proposed/unbuilt. Individual optional trip history is not an employer performance score. |
| Demand prediction and learning | Join briefs, choice sets, terms and observed outcomes; train/evaluate offline; estimate choice/acceptance including alternatives and waiting through a replaceable prediction port. | FUCQ-74; synthetic demonstrator permitted, real BMW accuracy unverified. The deterministic fit score remains separate. |
| Constrained order planning | Combine predicted demand with renewal needs, stock/inbound supply, Production availability, lead times, budget and model quantity bounds; compare feasible plans and replan after Production responds. | FUCQ-74; existing Node backend modules, exact model/solver refined through stories. Hard gates remain authoritative. |
| Canonical policy/assumptions source | Shared rules, objective weights, bounds, fallback assumptions and active model reference; every consumer uses the same access interface. | Reviewed seed and file-backed PolicyService implemented and validated by FUCQ-82; dated PostgreSQL policy storage and publishing remain FUCQ-83. Learned coefficients live in the immutable artifact it references. |
| Lifecycle and help | Selection handoff, approval/actions, document status, requested/confirmed appointments, readiness and owned renewal-risk cases. | Proposed boundaries. Detailed implementation requires separate refinement. |
| Durable transaction repository | Brief/policy versions, exact available/held/allocated stock, offers/decisions/history, cases, event receipts, pending operations, notification outbox and versioned forecast/plan snapshots. | FUCQ-81 implements the shared TransactionRepository port, explicit memory provider, PostgreSQL adapter and 17-table foundation migration. Local contracts and driver failure handling are validated; native SQL execution and managed Render connectivity remain pending a provisioned database. |
| Vehicle corpus and descriptions | Versioned configuration facts and images keyed by `configurationId`; exact stock keyed by synthetic `orderUuid`; VINs only on delivered/current cars. | Proposed static corpus/lookup module, separate from the mutable stock and allocation tables. |

## Paula's version-4 blueprint through the architecture

Paula's current-car anchor is the supplied **G21 320i M Sport Touring LCI2, B48 petrol, automatic, Portimao Blue Metallic** record. Treat its equipment as supplied scenario evidence. Its status does not prove a completed real handover, and catalogue fuel figures are not observed personal MPG.

| Blueprint column | Responsible modules and data | Observable state / constraint |
|---|---|---|
| **01 · Personal car and renewal** | Employee/contract, exact current-car and optional usage ports; personal-view projection; reminder policy. | Actual agreement dates and mileage baseline; usage shows period/coverage/update or absence. No unsupported driver score. |
| **01a · Manual gallery** | Same employee eligibility and released-stock projection used by the buddy; shared card/comparison kit. | Browsing does not reserve. Manual claims later use the same allocation/hold authority. Monday is narrative context, not a universal release schedule. |
| **02 · Express preferences** | Draft brief, preference sliders, separate importance/indifference controls and live explained preview. | Preferred values and their weights are distinct. Qualities such as comfort and sportiness may coexist; do not force false opposites. Preserve/change feedback and confirmed must-haves remain separate. Broad space/comfort wishes are preferences, not invented numeric essentials. |
| **03 · Practical check and permission** | Employee/driver/contract prefill, conditional questions, scheme terms and BriefService. | Confirm known facts; resolve missing essentials; contribution only if scheme permits; charging not ready/unknown excludes plug-ins until resolved. Save approved version and explicit search/hold consent. |
| **04 · Activity** | Brief/search controller and persisted activity projection. | Last successful check, active/paused, still searching or delayed source. Pausing prevents new searches/holds; existing offers are shown with their actual state and handled explicitly. |
| **04a · Delegated work** | Full exact-stock evaluation → configured allocation → conditional hold/offer transaction → committed outbox. | Recheck current permission/versions before a hold. No offer or notification without a confirmed exclusive hold. |
| **05 · First offer** | Offer read, exact quote/fact snapshot, current-car comparison, notification dispatcher. | Email and account show one offer; countdown derives from persisted expiry. Unknown equipment and representative images remain visible. |
| **06 · Decline and history** | Offer decision, exact release, historical quote/comparison and typed rejection reason. | Idempotent decline; pending release stays unavailable until resolved; then car returns to ordinary shared eligibility. History cannot restore the hold. No penalty or recovery priority follows from rejection alone. |
| **07 · Confirm one change** | Fixed reason-to-question follow-up, versioned BriefService, reevaluation and decline exclusion. | Change one preference (e.g. body style or an essential) only after Paula confirms (Q16, 4 Nov). Preserve other essentials/priorities; do not reoffer the unchanged declined car. No-match is calculated, not a prewritten outcome. |
| **08 · Help available** | Help projection; owned case only on request or configured renewal-risk trigger; exception-decision port. | Merely opening help changes nothing. Extension or other remedy requires its authorised owner; actual dates remain authoritative. |
| **09 · Next release** | Replayable release/event source, deduplication, full evaluation, allocation and hold transaction. | Uses current brief and permission, including Paula's confirmed preference change and decline history. Failed claims try appropriate remaining candidates; no hard-coded winner. |
| **10 · Second offer** | Same offer/comparison/notification modules plus saved first-versus-second quote projection. | Explain measured changes from the stored quotes and current brief, not an inferred unspoken preference. |
| **11 · Employee selects** | Offer acceptance/selection, entitlement checks, idempotent order handoff. | Stop further holds for this renewal/entitlement. Acknowledged selection, pending handoff and approved order are distinct. |
| **12 · Approval and tasks** | Ordering/approval/document ports and employee-action projection. | Show who owns outstanding work and delays; do not invent approval from a local button. |
| **13 · Handover plan** | Appointment request/acknowledgement, document/readiness status and separate old-car return plan. | Requested differs from confirmed. Signing may follow booking; completed documents and a ready vehicle gate physical handover. |

Physical collection/return, after-use feedback and a later renewal remain outside the main walkthrough. Their ports preserve continuity: only confirmed collection/return changes the current-car relationship; acceptance alone does not. The retained brief is reviewed for changes on the next cycle. These boundaries are shown without adding lifecycle delivery stories to FUCQ-8.

Optional connected summaries use comparable covered totals for MPG and contract start mileage/allowance for remaining miles. No feed, stale feed and zero mileage are distinct. They are optional personal information, do not establish charging readiness and do not affect eligibility/allocation priority. Greg sees aggregated demand/outcomes rather than individual trip history.

## Vehicle evidence and adapter contracts

Every adapter declares source mode (`synthetic`, `dated-snapshot`, `authorised-live`), schema/version, observation/effective date, identity scope, completeness/unknowns and capability/error status. A source failure is distinct from a valid not-found result. The application validates the result rather than interpreting a model default as exact fitted equipment. FUCQ-8's `VehicleSnapshot`/`CandidateDecision` remain the shared internal contracts.

Catalogue/image results retain both requested and resolved market, model/AG identifiers, effective date and complete option selection. Reject or explicitly flag mismatches; the researched 330e-to-320i substitution must not silently enter a recommendation. Preserve units, per-field completeness, placeholder/unknown values and selected-versus-available-versus-verified-fitted options. An image records its role and fidelity (representative model/configuration or exact vehicle), rather than proving equipment from its appearance.

| Capability | Proposed placement and verified limits |
|---|---|
| Catalogue/specification · FUCQ-14, later FUCQ-17 | Dated BMW configuration/model snapshots behind a description port. Live provider requires sanctioned access and contract proof; public website success is not enterprise access. Model facts do not prove exact-car options. |
| Configuration imagery · FUCQ-15, later FUCQ-18 | Dated representative image artifacts behind an image port; normal browser image loading may use published assets. Do not put BMW credentials in static files or public image URLs. Live provider is access-gated. |
| VIN-linked handbook · FUCQ-16 | Separate content/illustration port. The proven Driver's Guide route is not a build-sheet, eligibility, valuation or reservation API. |
| Synthetic vehicle identity · FUCQ-19 | Synthetic order allocator for exact stock (`orderUuid` key, 7-digit `orderNumber`, 8-digit `wholesalerOrderId`), plus a plausible VIN generator (five-WMI profiles, check digit) used only when a car is delivered or is an employee's current car. One lookup module behind an in-process port; an HTTP route wraps it. Explicit not-found/invalid/unavailable outcomes. Synthetic identifiers never reach a real decoder. |
| Distinct configuration corpus · FUCQ-20 | Collector/validator/publisher produces a versioned corpus of genuinely distinct configurations keyed by `configurationId`, with a manifest. For 12 November it holds at least 200 real, constructible configurations covering every scheme model line (FUCQ-77), with synthetic stock shaped by public stock-locator aggregates (FUCQ-78); the 10,000 target (FUCQ-61) follows after the demo. Validate signature counts and load through the same lookup module; never count repeated builds with new identifiers as distinct configurations. Synthetic stock is generated as orders pointing at corpus configurations. Keep documented descriptor/checksum/year/plant and UK/RHD assurance gaps visible. |
| Exact stock and actions | Separate released-stock/claim port supplies the stable `orderUuid` (the exact-car key, as on the target platform), revision, scheme/cohort/release-list visibility, terms and collection readiness. Configuration lookup or catalogue presence never proves availability or exclusive hold authority. |

**FUCQ-54, 5 November:** [immutable artifact publication and lookup](../gcsp/synthetic-vin-service.md) now validate complete configuration/VIN/image candidates, retain original source facts separately from fictional delivered/current VIN associations, and atomically select one version inside the existing backend. Independent durable identity history survives failed activation, deactivation and restart. The packaged 18 KB contract fixture contains one dated GB catalogue configuration and one explicitly fictional US/LHD reference, with one current-car VIN and no approved imagery; it does not establish the later real-configuration coverage target. No stock/order artifacts, public writer/reset route, new service or deployment change are introduced. The later HTTP lookup wrapper remains separate. The text records implemented module boundaries; the canonical diagram topology is unchanged and no fresh diagram-render proof was available.

Keep the immutable corpus and published asset artifacts separate from the SQL store for changing briefs/offers/holds. Synthetic order identifiers and VINs are scenario identifiers linked to independently retained configuration/source provenance, not claims about real orders or registered vehicles. Some evidence can enrich a description without satisfying a decision-critical essential. Unknown essentials stay `needs-confirmation`.

Revised 4 November (review Q7, Q13). Three identities, each with its own key: a **configuration** (`configurationId`, immutable corpus), an **exact stock car** (synthetic `orderUuid`, Postgres, carrying its `configurationId`, stock account and status) and a **delivered car** (VIN attached at handover, plus its order reference). Browsing, matching, holds and allocation use `orderUuid`; the engine scores configuration facts and needs no VIN. The lookup module resolves `configurationId`, `orderUuid` or (for delivered cars) VIN behind one in-process port. A thin HTTP route, `GET /api/gcsp/vehicle-evidence/{configurations|stock|vins}/:id`, wraps the same module for external use and contract tests. Invalid format, unknown record and unavailable/invalid corpus produce distinct 400/404/503 outcomes. No outcome invokes a live provider. The offline generator/publisher is not a public write endpoint.

**Synthetic identifier formats (review Q13, 4 Nov).** Each follows the target platform's format, so a real source can replace the generator without re-keying.

| Identifier | Format | Shown to employees |
|---|---|---|
| `configurationId` | Base64 of `vgModelCode` + `:` + the car's codes, upper-cased, sorted and comma-joined | Never; presenter and debug views show the decoded form |
| `orderUuid` | Random UUID v4; the stock, hold and allocation key | No |
| `orderNumber` | 7 decimal digits with leading zeros, unique per demo run | Yes, as the order reference |
| `wholesalerOrderId` | 8-digit integer | No |
| `vin7` / `vin17` | 7 and 17 characters, delivered and current cars only | Delivered cars only |

Worked example (illustrative): an i5 Touring `T5MJ` with codes `P0300`, `FKSFU`, `S0337`, `S0488`, `S03AC` gives `T5MJ:FKSFU,P0300,S0337,S03AC,S0488`, so `configurationId` is `VDVNSjpGS1NGVSxQMDMwMCxTMDMzNyxTMDNBQyxTMDQ4OA==`. Changing paint to `P0475` gives a different ID; reordering the codes gives the same one. Stock and specification records use the target's field names: `agModelCode`, `vgModelCode`, `modelRange`, `marketingModelRange`, `series`, `modelYear`, `bodyType`, `baseFuelType`, `driveType`, `colors`, `upholsteryCode`, `equipments` (keyed by option code) and `technicalAndEmission`.

Keyed assumptions, where the target is silent: codes are comma-separated; paint and upholstery codes are included in the sorted list; the list is every factory option on the car (paint, upholstery, equipment), not only chargeable extras, and excludes dealer accessories, so it doubles as the collector's distinctness key (FUCQ-59); encoding is standard padded Base64, so routes URL-encode the ID; identifiers never change within a demo run. BMW's retail configurator code forms the same ID from the AG code (`72HH`) rather than the VG code the knowledge base named, so the model-code base is unconfirmed; records keep both. Still open on the target: whether order identifiers survive amendment, whether the fleet application passes the configuration ID to GCSP, and which code eligibility rules and points prices match. Real configurations carry 30 to 60 codes, so IDs run to roughly 250 to 400 characters. The corpus stores one row per ID, and a duplicate specification is one configuration, not two.

**Opening a configuration in BMW's configurator (4 Nov).** Decoding a `configurationId` gives the model code and codes, and together with the stored configurator `modelRange` they make a link, for example `https://configure.bmw.co.uk/en_GB/configure/I20/IXSC/FSACX,P0C4F,...`. The configurator's own link uses the same sorted, comma-separated list, with paint and upholstery as codes, which supports the first two assumptions above. It only works for real codes that are constructible today: unknown codes are dropped and a wrong model is replaced without warning. So the collector stores the configurator range, and a link is offered only for configurations whose resolved list still matches. See the [interface research](../gcsp/bmw-interface-research.md) follow-up.

Publish `manifest.json` and `configurations.jsonl` (indexed by `configurationId`) as versioned backend artifacts, validating them before atomically selecting a corpus version. Keep the source/configuration signature and `identityKind: synthetic` in server-owned records; a browser-supplied flag or valid-looking identifier cannot establish identity kind. Environment wiring and record provenance constrain all provider switches, unknown-record and outage paths. Generated identifiers must never be submitted to BMW, Driver's Guide or any real decoder. Resetting a demo run regenerates stock order identifiers and employee state, not the immutable corpus. The population job must prove its stated count of distinct signatures (at least 200 for the demo, 10,000 for FUCQ-61 after it) without padding unsupported UK/RHD profiles from North American fixtures; the VIN generator must prove five-WMI/profile coverage for the delivered cars it serves.

Provider substitutions pass contract tests with equivalent fixture inputs before enabling the provider. No fallback silently widens eligibility, replaces unknown equipment, turns a failed source into “no cars”, or changes synthetic identifiers into real-world queries.

## Greg's supply loop and the commitment boundary

Greg reads the full saved-demand/evaluation picture, including unmet needs, successful holds, declines, expiries and accepted selections. Do not calculate demand from the small retail display sample or count a score as observed satisfaction. Rejection reasons and affordability constraints inform aggregates without exposing Paula's optional trip history.

`FutureOrderRequest` records Greg's intent. A separate provider acknowledgement creates or updates `ConfirmedSupply`, with expected dates/status and provenance. Only an actual release creates `ReleasedStock` eligible for a hold. A request, an acknowledgement and a physical release are three different facts; a delayed/unconfirmed request cannot satisfy a current offer. Future return volume can be calculated from contract/supply data; used-market prices require an explicit scenario model.

Greg publishes new effective versions of recommendation weights or points through authorised policy/terms operations. Changes steer appropriate cars only; they cannot relax essentials or silently alter an active quote. Stable active-offer terms are the proposed demo policy pending scheme-owner confirmation. Projections distinguish a what-if preview from a published policy and a submitted order request from confirmed supply.

The post-selection lifecycle uses the target platform's state names (review Q19, 4 Nov), each with its own provider reference: employee selection → HR approval (configurable, as the target may drop it) → sales-manager approval → sent to ordering → appointment scheduled → completed (or no-show), with separate document and readiness states. Page 07 shows them. An uncertain external write stays pending and is reconciled before retry/reallocation. A firm commitment point must be defined by the ordering authority. In the demo, state transitions operate through the synthetic adapter; a live adapter must report unsupported writes rather than pretend success.

## Greg's next best order: FUCQ-74

Russell approved learned demand/choice prediction feeding constrained order planning on 2 November. This refines Greg's existing supply loop, with a dedicated **08 Predictive order planning** view in the canonical diagram. The [research record](../gcsp/greg-predictive-research.md) retains the historical ML proposals, available-data limits and candidate approaches. The backlog capability is authorised; algorithm selection and implementation remain to be refined through the normal story workflow.

The dashboard leads with a recommended next action and a proposed model/derivative quantity list. Show expected acceptable coverage before renewal, unallocated-stock risk, unmet needs, binding constraints, uncertainty, reasons and alternative plans. Greg can change quantity bounds or other permitted constraints and recalculate a preview. Publishing policy/points and submitting an order request remain explicit separate actions. A Production response updates confirmed-supply evidence and triggers replanning; only actual release creates selectable exact stock.

| Proposed contract | Required information and boundary |
|---|---|
| Learning records | Renewal cohort and brief/entitlement context, vehicle attributes, eligible/available alternatives and exposure, dated points/contribution terms, offered/selected/wait outcome and timestamps. Acceptance, rejection, expiry and later satisfaction remain distinct. Separate observed records from synthetic generation and retain provenance. |
| `PredictionInput` → `DemandForecast` | Versioned cohort, horizon, permitted choice sets and terms produce choice/acceptance/wait probabilities, aggregate demand and uncertainty, model/data versions and limitations. Shared eligibility/essential checks constrain the choices first. A fit score is not an acceptance probability. |
| Forecast + supply + policy → `OrderPlan` | Account for existing/released and confirmed inbound supply, Production constraints, lead times, budget and model min/max quantities. Return feasible integer quantities, objective trade-offs, unmet needs, uncertainty and baseline/alternative comparisons. Count each employee entitlement once and model competition/substitution. An infeasible request exposes conflicting constraints. |
| Preview → `FutureOrderRequest` | Greg intentionally submits a selected plan after reviewing its current input versions. Retain plan, forecast, policy, model, cohort, stock and supply versions with the request; reject or recompute stale inputs. Submission, provider acknowledgement and release retain the existing distinct states and idempotent action contracts. |

Place training/data validation and held-out evaluation offline. Publish an immutable model artifact containing learned parameters, feature/schema version, training-data manifest, evaluation and provenance. The [one canonical policy source](../gcsp/build-rules.md) owns the active artifact reference, objective weights, bounds and assumptions. Model activation is an explicit versioned reference change; all runtime consumers and synthetic generators use the shared policy interface. Historical plans retain their input/model versions so later changes remain explainable. No second policy registry or employee-state database is introduced.

Inference and planning sit behind ports inside the existing Node backend; no new ML microservice is required by this HLD. An interpretable regularised discrete-choice model is the initial candidate. The precise model, feature specification, training runtime and optimisation solver remain refinement choices supported by evidence. The shared pure ranker retains deterministic preference-fit computation; training, prediction and optimisation do not add stock-write authority to it.

Keep expressed-demand aggregation and shared deterministic-fit baselines for comparison and a visibly identified fallback. Evaluate probability quality on held-out later periods/cohorts, then evaluate complete plans through the same allocation/event services used by the demo. Compare acceptable coverage before renewal, unused vehicles and acceptance with identical feasible inputs and declared commercial assumptions. Synthetic multi-cycle training and separately held-out evaluation may demonstrate a real learned pipeline; report their generating assumptions and avoid claiming validated BMW employee behaviour. The 10,000-configuration corpus supplies vehicle features, not 10,000 employee-choice labels. Counterfactual points/nudge responses remain explicit assumptions until supported by suitable evidence.

Implementation acceptance must show that one central assumption change updates forecasts, plans and Greg's displayed consequences consistently; hard gates still hold; changing constraints recomputes a feasible plan or explains infeasibility; Production responses cause replanning; and intentional submission preserves the request/confirmed/released boundary. Apply the [experience quality contract](../gcsp/experience-quality.md), including rendered desktop/narrow and error/empty/stale-state evidence, to the decision surface.

## The 1,000-employee comparison

Agreed by Gary on 4 November 2026 (readiness item C8). Diagram page **09 1,000-employee comparison** shows it; page 05's simulation node now points there. It answers the [demo brief](../gcsp/demo-brief.md#compare-1000-fictional-employees): does preference-led buddy allocation do better than today's first-come-first-served release, on identical inputs? It must be able to show a benefit, a trade-off or no improvement.

- **Where it runs.** A comparison module inside the GCSP Node backend, not a separate service. The presenter (or Greg) starts a run from the dashboard; it runs in a worker thread so the API stays responsive. A CLI runs the same module for repeat runs and tests. There is no unattended runner (Q3). Each simulated run uses FUCQ-81's in-memory repository, its own simulated FUCQ-85 clock and FUCQ-93's captured transport, so it never touches the live demo run and sends no mail.
- **What it reuses.** FUCQ-29's employee policy for gates and ranking, evaluated once per seed and shared by both routes. The buddy route runs FUCQ-96's tie-break allocation, FUCQ-100's hold and offer, and FUCQ-106's decisions. Today's route runs FUCQ-66's short cart claims, first come first served by modelled access time (Q15). Every rule, duration and assumption is read through FUCQ-82's PolicyService.
- **Seeds and inputs.** A seeded generator builds, per seed, 1,000 synthetic employees (grade and points, renewal date, underlying needs, stated brief), the stock and its release schedule, all from `comparison.*` PolicyService keys, never hard-coded. Keys also cover access and response times, buddy uptake, how accurately a brief states underlying needs, the acceptance threshold, and the manual route for non-participants. Both routes get the same cohort, stock, releases and rules for each seed. A run uses several seeds to show variability.
- **Outputs.** Per route, the mean and range across seeds of: the share of employees with an acceptable car before renewal; unused stock (released cars never allocated, and days held but not taken); decline and expiry counts; failed claims and retries; and outcomes by access group. "Acceptable" means passing the employee's underlying essentials and gates with calculated fit at or above the threshold key. Calculated fit is not observed satisfaction. Each result is stored once, immutable, with its input manifest: policy version, seeds, generator version and code revision.
- **Experiments.** First the process change alone, on identical inputs. Then, separately, Greg's order mix or points as an explicit alternative policy input. Then a buddy hold-duration sweep, the demo's live interaction. An alternative input is a what-if: it never publishes policy.
- **How the presenter shows it.** A route comparison panel in its own region of Greg's dashboard (FUCQ-101). It shows the two routes side by side with ranges, the assumptions behind them (key, value, assumed or verified, basis), the experiment picker and a hold-duration rerun. The latest stored result shows at once, so the walkthrough never waits; a result for an older policy version is labelled as such. Copy calls the baseline "today's release route" and stays respectful of the delivered GCSP (demo-brief positioning).

## Demo access and offer links

The proposed `DemoIdentityAdapter` resolves only configured fictional employees, scheme/entitlement context and presenter roles, behind the demo access gate. The backend owns that context and enforces it on every brief, stock, policy and decision route; a caller cannot gain Greg privileges or act for another employee by changing an ID. The shared password alone is not the employee principal. Keep this adapter replaceable by sanctioned BMW identity/roles.

For an email opened in another browser, use an opaque, unguessable, environment-and-run-bound offer token, stored hashed by the backend and scoped to that exact synthetic offer. Resolve it to the same offer access context before reading or confirming a decision; do not expose the employee fleet or optional usage history through it. Use deployment configuration for the stable landing URL of the GCSP static site (review Q1), then exchange the token through the backend without logging it or embedding private briefs. Repeated/stale links read current state; they never revive a hold. Later BMW operation requires the approved sign-in/offer-access policy rather than promoting this demo mechanism into production identity.

## Transaction and event invariants

The versioned [shared GCSP contracts](../gcsp/shared-contracts.md) record the schemas, state machines, policy keys, repository and port interfaces implementing these invariants.

- Revalidate employee essentials, eligibility, current terms and permission before each claim. Before acceptance, check eligibility, essentials, permission, the current hold and its pinned quote's validity; a newly published points version does not silently reprice that hold. Version conflicts return a clear refresh/review outcome.
- Two hold types share that authority (review Q15). The manual cart hold is short, about two minutes and first come first served, as on the target platform. The buddy offer hold lasts hours, is a proposed new capability and is labelled as one. Both durations are keyed policy values.
- One exact car cannot have two active holders; employee/renewal/entitlement limits are configured explicitly. Manual and buddy commands use the same authority. Allocation/tie-break policy is versioned and inspectable; employee iteration order or mail speed cannot establish priority.
- Demo hold, offer and outbox job commit in one SQL transaction. Mail failures leave a visible account offer and retryable stable job; they do not acquire another car or change priority. Microsoft Graph/Exchange, ACS Email or Brevo is selected behind the transport port after sender/permission setup.
- For remote BMW authority, persist a pending operation and use conditional/idempotent claim/release/selection calls. Local SQL cannot make a remote call atomic. Only a confirmed claim permits an active offer; only confirmed release permits reallocation. Timeouts remain uncertain until reconciliation.
- Offer reads derive current accepted/rejected/expired/pending state from the backend, including old email links and another browser. Browser countdowns and local undo never extend/revive a hold.
- Declining, changing the brief and after-use satisfaction are separate records. The unchanged-declined-car exclusion belongs to employee policy; expiry/missed mail is not dislike or a priority entitlement.
- Release/clock/rule/brief triggers retain event IDs, state versions and processing outcomes. Replaying a release or retrying a decision is idempotent. Startup and explicit demo ticks reconcile outstanding work.
- A scenario reset is an authorised presenter operation over an isolated synthetic environment. It restores versioned input/clock/state coherently and prevents old offer links/outbox jobs from operating on a new run. It must never reset an operational provider.

An always-running or scheduled runner is required for unattended background promises. Explicit presenter ticks can demonstrate the same services on the current host; sleeping Render processes do not establish reliable expiry or watch work. Roughly two hours is a configurable proposal, not a BMW rule.

## Technical deployment and recovery

**GCSP environment (review Q1, Q2, Q12, 4 Nov).** GCSP runs in its own Render environment built from `gcsp-poc`: a Node backend service and a Render static site for the frontend, with managed PostgreSQL. GitHub Pages, `main` and EDS sync stay retail-only until after the demo. GCSP blocks never go to EDS; the demo wraps them in dummy pages hosted in this repository. Background work is presenter ticks, not an unattended runner (Q3).

Retail source facts, which GCSP must not disturb:

- [.github/workflows/pages.yml](../../.github/workflows/pages.yml) publishes the retail static site from `main` or manual dispatch and rewrites **`block.html`**'s `data-api` value. [index.html](../../index.html) resolves its remote default independently.
- [render.yaml](../../render.yaml) declares the existing retail `server/` Node service, `/health` and a free plan. Live branch/revision, plan, ownership and environment settings remain unverified (GC-001). A prior health response proves reachability only.
- [.github/workflows/sync-block.yml](../../.github/workflows/sync-block.yml) publishes `vehicle-matcher` block changes pushed to `main` into `garyscarter-ibm/poc-ret-eds-sites`. It is not a GCSP dependency.

The release path is:

1. Review and integrate bounded stories on `gcsp-poc`; retain FUCQ-8 retail parity and FUCQ-13 URL/brand/API-context guarantees. Do not equate a local integration commit with a deployed release.
2. Provision the GCSP Render backend, static site and managed PostgreSQL from `gcsp-poc`, flagging to Gary any cost beyond the free or lowest tier (Q2). Record API/offer origin, CORS/authorisation, supported contract versions, fixture/corpus versions and enabled scenarios.
3. Apply SQL migrations and seed the policy tables from the reviewed repo file before enabling transaction-backed employee behaviour. Deployment secrets and the chosen mail sender stay backend-only. The configuration corpus uses versioned static deployment artifacts; changing fleet state uses the repository.
4. Deploy an additive compatible backend first, verify employee and Greg capabilities and transaction/restart behaviour, then publish the matching static site. The retail Pages site and Render service stay untouched.
5. Smoke the deployed launcher, employee/Greg shared state, release→hold→outbox/account→offer→decision, stale links, replay/expiry/restart and direct links to the static site. Inspect changed employee/offer/Greg surfaces at desktop and narrow sizes with keyboard controls, gallery/ratchet coverage and the agreed visual reference.
6. Record frontend/backend/schema/policy/corpus versions and recovery commands. Disable employee entry separately if necessary. Preserve/reconcile active holds, offers, quotes and outbox jobs; never roll a backend to code that cannot understand outstanding state without a controlled transition. Schema changes remain additive until recovery is proved.

No deployment, database provisioning, live BMW action or mail send is part of FUCQ-6's design update. [Gary's questions](../gcsp/questions-for-gc.md) retain the owner decisions.

## Later BMW-hosted integration gates

| Gate | Evidence needed before substitution |
|---|---|
| Host and navigation | Sanctioned EDS/front-end host conventions, base paths, CSP/CORS, asset/image policy, deployment pipeline and design-system fit. Reusable components do not establish a drop-in BMW deployment. |
| Identity and roles | Approved sign-in, employee/scheme/entitlement and Greg/administrator roles, server-side resource ownership and secure offer-link access. A shared demo key or public employee ID is insufficient. |
| Authoritative facts and rules | Named source/owner, approved field mappings, dated eligibility/points/contributions, exact equipment assurance, stock freshness and charging/driver/collection rules. October 2024 remains the POC eligibility baseline; Choices contributions are not automatically PCS UKFS BMW terms. |
| Operations and hooks | Supported conditional/idempotent claim/release/selection/approval/appointment contracts, authoritative acknowledgement, release/change events or polling fallback, and reconciliation. Readable web pages/files alone cannot provide exclusive reservations. |
| Persistence and execution | Durable shared repository, schema/recovery strategy, event replay, reliable runner, operational ownership/monitoring and retention/access rules. The immutable configuration corpus needs its own version/provenance manifest, not employee-state semantics. |
| Mail and privacy | Approved sender/transport, permissions, verified recipient, delivery/retry policy, secure environment-bound offer URLs and permitted optional usage summaries. Entra membership does not establish Mail.Send or ACS Email readiness. |

These are capability conditions, not verified BMW API names. Sandeep/owners can supply contracts later without rewriting the experience or domain logic. The [Sandeep questions](../gcsp/questions-for-sandeep.md) and interface research retain source-level evidence.

## Delivery boundaries and open decisions

FUCQ-8's published FUCQ-21–31 stories cover recommendation reuse and a stateless read-only employee consumer. FUCQ-13's FUCQ-32–36 cover compatible routing/launcher/retail continuity and the real FUCQ-7 entry. FUCQ-14–20 cover the distinct provider/corpus capabilities. FUCQ-74 records the approved predictive order-planning capability; its implementation stories are not yet authored. This HLD does not create stories for all lifecycle boxes or nest independent capability Epics. Refine other capabilities with Russell before Jira expansion.

| Decision | Owner / release effect |
|---|---|
| Allocation/tie-break, entitlement hold limits, duration and exact decline-exclusion rule | Scheme owner/Russell for explicit demo assumptions; BMW owner before live operation. Version/configure the selected rule and test competition. No automatic recovery priority. |
| Effective PCS contribution applicability, eligibility and quote stability | Scheme owner/Sandeep. Use explicit synthetic/demo policy until confirmed; never assume Choices' £1/excess-point rule applies to PCS. |
| Selection commitment, approvals, extensions and lifecycle authority | Ordering/fulfilment owner/Sandeep. Distinguish synthetic acknowledgements and approved real operations; keep unconfirmed writes pending. |
| GCSP environment provisioning, Postgres cost, mail sender and recovery route | Gary/platform owner. Hosting, store and runner are decided (Q1–Q3); provisioning and sender setup gate the corresponding deployed capabilities. |
| Representative employee body and Greg density | Russell/Gary under the agreed experience contract. Early rendered review before parallel body implementation; no new reference upload required. |
| FUCQ-74 model, features, objective calibration and solver | Refine against held-out prediction and complete-plan baselines. Plausible central assumptions permit the demo build; usable real observations are required for claims of BMW predictive validity. |

The 1,000-employee comparison is designed in "[The 1,000-employee comparison](#the-1000-employee-comparison)" above. Calculated fit is not observed satisfaction or a validated fleet forecast. Business-model and ZEV research inform scenario questions, not hardcoded wins, universal policy or verified economics.

## Research coverage and FUCQ-6 acceptance

The review covered the repository research to date as a team: the parent read the brief, current blueprint and its research/review records, engine assessment/evidence and shared design; independent reviewers read the business/discovery/deployment/story records and BMW/VIN/scheme/persona records. The current blueprint screen content was read in full; its duplicate print representation adds no different service scope.

| Evidence set | Design consequence |
|---|---|
| [Background](../gcsp/background.md), [discovery](../gcsp/discovery-findings.md), [Mural source](../gcsp/sources/mural/timeline-2024-11-07.csv), [Choices guide](../gcsp/sources/choices-car-scheme-guidelines-v1.6.md), [eligibility](../gcsp/sources/choices-eligibility-matrices-2024-10.md) | Separate dated current-route evidence, authoritative source obligations and explicit demo assumptions. |
| [Business model](../gcsp/business-model-exploration.md), [argument check](../gcsp/business-model-argument-check.md), [ZEV](../gcsp/zev-mandate-research.md), [capability proposals](../gcsp/capability-breakdown.md) | Greg's controllable scenario loop; no unsupported economic/employee-outcome claims or new authorised scope. |
| [Personas/source register](../gcsp/personas/README.md), [blueprint research](../gcsp/service-blueprint-research.md), [v3 history](../gcsp/service-blueprint-review-v3.md), [v4 review](../gcsp/service-blueprint-review.md) | Precise current-car anchor, reuse of known practical inputs, rejection memory, help, acknowledgement and handover boundaries. Input controls follow Russell's FUCQ-6 correction: sliders plus separate weights. |
| [BMW interfaces](../gcsp/bmw-interface-research.md), [adapter scope](../gcsp/bmw-interface-stories.md), [FUCQ-5 proof](../gcsp/evidence/fucq-4/README.md), [VIN proposal](../gcsp/synthetic-vin-fleet-proposal.md), [VIN rules](../gcsp/synthetic-vin-rules.md) | Separate catalogue, representative imagery, handbook, synthetic registry and exclusive stock authority. |
| [Engine reuse](../gcsp/engine-reuse-assessment.md), [FUCQ-8 proof](../gcsp/evidence/fucq-7/README.md), [shared design](../gcsp/shared-recommendation-design.md), [FUCQ-8 stories](../gcsp/fucq-7-stories.md), [FUCQ-13 stories](../gcsp/fucq-12-stories.md) | Pure core, separate policies/workflows, exact decisions, compatible migration and URL/context preservation. |
| [Sandeep questions](../gcsp/questions-for-sandeep.md), [GC questions](../gcsp/questions-for-gc.md), [delivery evidence](../gcsp/delivery-evidence.md), [experience contract](../gcsp/experience-quality.md), [components](../../COMPONENTS.md) | Named operational gates, reproducible delivery/reuse evidence and mandatory rendered acceptance for later UI work. |

FUCQ-6 is ready for architecture review when the canonical diagram and this record agree on these responsibilities; the current/proposed distinction is visible; every blueprint column has an owner; supply stages and source limits are explicit; and release/BMW-hosting conditions are reviewable. Final agreement belongs to Russell/Gary. Keep the issue under review until that agreement is recorded; design agreement does not mark unbuilt components blue or accept undecided operational policies.

Verification and reviewer results are recorded in [FUCQ-6 evidence](../gcsp/evidence/fucq-5/README.md). No application runtime changed, so existing application test results are historical evidence rather than a newly executed product acceptance claim.
