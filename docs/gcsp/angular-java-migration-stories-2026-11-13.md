# GCSP Angular/Java migration — published Stories

**Current design context — 13 November 2026:** the [FUCQ-434 baseline](migration-baseline-2026-11-13.md) now freezes implementation at **`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`**; the [replacement contracts](migration-replacement-contracts-2026-11-13.md) govern implementation. Earlier publication statuses and “not started” statements below are timestamped authoring observations, not current worker/status claims. Gary's [combined run](angular-java-dev-poller-kickoff-2026-11-13.md) includes **all four Epics / 66 Stories**, including all 17 native FUCQ-408 performance Stories. Their Node-specific acceptance remains required; Java-only work does not close them. Completing all Node tuning is not a gate for all migration. Read the [consolidated decisions](../design/migration-decisions-2026-11-13.md); published Story acceptance below is preserved.

**Publication complete, 13 November 2026:** [FUCQ-431–433 and 49 child Stories are published and verified](angular-java-migration-publication-2026-11-13.md), all To Do, unassigned and unestimated. Gary also explicitly lifted the wider Jira-write pause. No implementation has started; FUCQ-408 acceptance and issues remain unchanged.

**Current Jira direction, 13 November 2026:** after requesting publication, Gary explicitly lifted the wider Jira-write pause (“You can stop the wider pause too”). Earlier pause statements below are historical. Current shared policy is in `AGENTS.md`, “Jira updates resumed”. This does not start implementation or amend existing FUCQ-408 acceptance.

13 November 2026. These 49 local Story labels expand the [refinement map and decisions](angular-java-story-refinement-2026-11-13.md) under the [three Epic proposals](angular-api-adapter-epic-proposals-2026-11-13.md). They are local traceability labels, not Jira keys, claims, estimates or implementation authorization. Gary subsequently directed: “Write our new stories to Jira.” This authorizes publication of these three migration Epics and 49 Stories only; Gary has also explicitly lifted the wider Jira-write pause. Existing FUCQ-408 work is unchanged. Publication is complete with verified native read-back.

Every `decided` section inherits the confirmed scope, [demo adapter boundaries](demo-brief.md#binding-boundaries), [build rules](build-rules.md), [experience contract](experience-quality.md), [component catalogue](../../COMPONENTS.md) and [technical-readiness policy](technical-readiness-2026-11-05.md). Freeze the actual `gcsp-poc-dev` capability/visual baseline at implementation kickoff. Preserve implemented behaviour and visuals, subject to the agreed OIDC/presenter changes; preserve Used Cars. Angular 21 owns GCSP; Java 21/Quarkus 3.x owns its runtime/jobs. Offline preparation may remain JavaScript.

Every `validate` section requires actual results and limitations. UI and visible backend outcomes follow the existing desktop/narrow, Safari/private-browsing, keyboard/focus and CSP obligations, with rendered inspection of affected states. Reuse meaningful existing scenarios; avoid creating a separate generic validation framework. A build or fixture alone does not prove an integrated journey, native PostgreSQL or live BMW service.

Implement and validate continuously, committing coherent increments without interim human review gates. Gary checks the completed hosted dev solution at the end and performs the eventual merge into `gcsp-poc`. Implementation order is foundation → sign-in/account → local Buddy journey → remaining capabilities and remote substitution → final hosted proof. Each contributing Story retains its full acceptance. Confirm actual interfaces/ownership and size or split oversized work before pickup; outstanding technical inputs are listed in the refinement map.

Align persistence and calculation choices with [Russell's FUCQ-408 work](database-refactor-migration-alignment-2026-11-13.md). The database design belongs early in E3.S03. The entire existing Node performance Epic is not a migration prerequisite, and these drafts do not replace its native acceptance.

## E1.S01 — Record the target architecture and implemented baseline

### decided

Use the existing HLD and host/runtime/contracts. Inventory implemented scope at kickoff; later product work remains separate. Reconcile FUCQ-408 persistence objectives before fixing the Java repository design.

### acceptance

1. Record the kickoff SHA, capabilities/routes/jobs, visual references, retained artifact identities, workload cases and intentional identity changes.
2. Reconcile the canonical HLD and define replacement API/provider responsibilities, errors and deployment boundaries. Record supplied BMW standards and concrete unknowns; legacy GCSP compatibility is unnecessary.

### validate

Trace the inventory to source/contracts and retained artifacts. Check that each implemented capability has a replacement Story and Used Cars/shared consumers remain accounted for. Record architecture/source evidence; do not infer implementation from a diagram.

## E1.S02 — Call the separately hosted API with bearer authentication

### decided

Use one Angular API configuration/request boundary. Coordinate E2.S01 and E3.S02; the API retains business and resource authority.

### acceptance

1. Actual HTTPS frontend/API origins support required requests/preflights with exact allowed origins and bearer access JWTs; static output contains no secrets.
2. Typed API failures, denied requests and authentication expiry reach useful frontend outcomes. Recovery does not automatically submit an unfinished order.

### validate

Exercise real cross-origin browser calls and direct unauthorized API calls. Inspect configuration/assets, token routing and the affected failure/recovery states.

## E1.S03 — Build and publish the static GCSP artifact

### decided

Build Angular independently from the API in this repository. Use one Render blueprint with separate service/build definitions and deployment-supplied public configuration.

### acceptance

1. A complete static build contains required assets and runs without request-time Node HTML processing; build filters support independent frontend/API releases.
2. Different public API/OIDC settings work with unchanged compiled Angular bundle hashes. Cache, CSP and referrer behaviour follow the supported routes and identity flow.

### validate

Build/serve the artifact and compare bundle identities under two public configurations. Verify actual deployed headers, asset loading and independence from the API build.

## E1.S04 — Enter and refresh replacement frontend routes

### decided

Use Angular-owned routes and the OIDC/offer-entry contract. Legacy GCSP aliases are unnecessary; preserve shared launcher and Used Cars handoffs.

### acceptance

1. Direct entry, refresh, role landing, sign-in return and new offer links reach the intended authorized state.
2. Unknown frontend routes and unavailable/invalid API responses produce distinct useful outcomes. Update shared entry links and preserve brand/context behaviour.

### validate

Replay direct URLs, refresh and email return navigation on the static host. Check unknown routes, API failure responses and shared launcher/retail navigation.

## E1.S05 — Release independent artifacts and hand over the final switch

### decided

Use the refined release boundary in the Story map. Gary merges into `gcsp-poc` after final hosted-dev review; downtime and immediate old-deployment replacement are acceptable.

### acceptance

1. Separate frontend/API releases remain compatible; retained inputs and new-app state/links survive ordinary compatible restarts/releases.
2. Supply final build/configuration evidence and concise merge/Render verification steps. No old-deployment retention or rollback rehearsal is required; development remains isolated until cutover.

### validate

Rehearse releases and fresh-state startup on isolated dev. Record final-switch verification as unrun until Gary performs his future merge; coordinate E3.S29 retirement evidence.

## E2.S01 — Sign in and navigate through the Angular shell

### decided

Pin Angular 21 and its compatible toolchain. Use real test OIDC login and bearer requests, with employee/Greg/presenter roles and no impersonation.

### acceptance

1. Angular owns shell/navigation and handles login, role landing, direct entry, refresh and unavailable/denied states with the baseline visual design.
2. Renew authentication where supported; otherwise restore the authorized page and saved progress after sign-in without automatic order submission. Sign-out clears app authentication and ends the provider session where supported, permitting a different account next time.

### validate

Build reproducibly and use real browser login/API context. Check expiry recovery, logout/account change, private-state separation, roles and affected rendered states under the shared browser/accessibility baseline.

## E2.S02 — Show employee account and current-vehicle information

### decided

Consume E3.S05–S06 projections through the API. Reuse the current account/vehicle visual reference and shared components.

### acceptance

1. Account, current car, image, contract/terms and existing account actions reflect authoritative API facts and the signed-in employee.
2. Missing/unavailable evidence and loading/error states are truthful. Refresh preserves actual saved state and account separation.

### validate

Compare populated and incomplete account cases with the frozen baseline against Java. Inspect the rendered account states and verify another employee's data cannot be obtained.

## E2.S03 — Edit preferences and control Buddy delegation

### decided

Preserve the current feedback, practical requirements, preference/importance/indifference and engagement semantics. E3.S07–S08 own validation/calculation.

### acceptance

1. Employees can edit, confirm and save supported inputs and Buddy engagement; reload reflects the server's saved version.
2. Failed/stale saves preserve truthful outcomes and usable correction. The UI does not calculate authoritative eligibility or manufacture a match.

### validate

Replay existing preference/feedback/engagement scenarios through Java, including stale edits and unavailable saves. Inspect the controls, confirmation and keyboard behaviour.

## E2.S04 — Browse released stock and inspect an exact vehicle

### decided

Preserve supported stock browsing and evidence through E3.S05–S10. Vehicle identity, eligibility and quote remain linked.

### acceptance

1. Existing filters, paging/history and vehicle detail views use actual released-stock/API projections and preserve the selected exact car.
2. Missing facts/images, empty stock, source failure and stale/unavailable selections have the existing meaningful outcomes.

### validate

Replay browse/detail/navigation cases against Java, including two stock cars sharing a configuration. Inspect populated, empty and unavailable views and verify quote/identity continuity.

## E2.S05 — Review and intentionally submit a manual selection

### decided

Preserve current manual review, declarations and order handoff using E3.S10/S15. Submission remains an intentional employee action.

### acceptance

1. Claim, review/edit and submission retain the exact car, quoted terms, draft versions and required declarations.
2. Confirmed, pending, stale and refused submissions display actual backend state. Repeat entry/retry cannot invent confirmation or duplicate a request.

### validate

Replay claim-to-order against Java/PostgreSQL, including stale quotes, declaration failures and lost responses. Inspect review and resulting status; verify recovery requires unfinished-order confirmation.

## E2.S06 — Show Buddy activity and search outcomes

### decided

Preserve current activity/search behaviour through E3.S11–S13. Displayed countdowns do not authoritatively expire or allocate stock.

### acceptance

1. Searching, no match, unavailable, live hold/offer, expiry and supported follow-up reflect actual backend state.
2. Reload and returning navigation show current activity and relevant next actions without reviving a terminal offer.

### validate

Run release-to-activity cases with local substitutes first, including no match and expiry. Inspect each affected activity state and compare reload results with the API.

## E2.S07 — Open an offer and accept or decline

### decided

Preserve current offer presentation, declarations and rejection/follow-up. New email links require sign-in and employee ownership; E3.S12–S15 own decisions.

### acceptance

1. Signed-in employees see the correct vehicle, terms, explanations and actual current state, including when reopening accepted/declined/expired offers.
2. Explicit accept/decline yields truthful pending/refused/confirmed handoff and supported follow-up. Another employee or presenter cannot act on the offer.

### validate

Follow real email links through OIDC to Java, test ownership and decision/reopen cases, then repeat applicable remote-backed outcomes. Inspect affected offer/drawer states at desktop/narrow widths.

## E2.S08 — Track the existing order and lifecycle journey

### decided

Consume E3.S17–S20 status/actions. Preserve only implemented kickoff scope; appointment/return plans do not themselves complete physical events.

### acceptance

1. Supported approval, document, readiness, appointment and return states/actions reflect the provider and employee authority.
2. Ownership, pending/refused work and current-car relationships remain accurate through reload and supported transitions.

### validate

Replay the implemented lifecycle scenarios through Java and inspect progress/action states. Confirm plans versus completed outcomes and missing-provider refusals; split independently owned UI capability before pickup if oversized.

## E2.S09 — Use employee help and Greg's case queue

### decided

Preserve implemented case/help operations through E3.S21, with distinct employee and Greg logins.

### acceptance

1. Users see authorized cases, named ownership, real status and permitted feasible remedies/actions.
2. Empty, unavailable, stale and denied cases remain useful and private; employee and Greg authority are enforced by the backend.

### validate

Replay the supported case journey across the two logins, test resource refusals and inspect queue/help/action states. Unfinished optional case scope remains separate.

## E2.S10 — Show Greg's demand and preview/publish controls

### decided

Use E3.S04/S22 projections, preserving privacy bands, current weighting/points controls and preview versus publication.

### acceptance

1. Greg sees computed demand/evidence and can perform the implemented preview/publish actions with current version checks.
2. Stale/unavailable publication is explicit; new policy activation does not reprice pinned active offers. Display no fabricated dashboard totals.

### validate

Replay changed inputs, privacy boundaries, preview/publish and active-offer pinning against Java. Inspect displayed counts/versions and denied employee/presenter commands; split display/publication if sizing requires.

## E2.S11 — Plan Greg's order and track Production responses

### decided

Preserve E3.S23–S25 forecasting/planning/submission behaviour and the existing visual design; preview never places an order.

### acceptance

1. Forecast explanations, editable constraints, alternatives and infeasible/stale previews reflect current API inputs/results.
2. Deliberate submission, quantity/status tracking and replanning follow actual Production responses, including pending/refused outcomes.

### validate

Replay feasible/infeasible plans, stale inputs, submit/retry and response-driven replan against Java. Inspect explanation and request/status views; split preview/tracking before pickup if oversized.

## E2.S12 — Operate presenter scenarios

### decided

Use the dedicated presenter login and E3.S26. Remove principal switching and all employee/Greg actions from presenter authority.

### acceptance

1. Clock, tick/release, scenario/reset and fault/retry controls operate actual backend state with current outcomes.
2. Outbox/comparison and other permitted inspection are read-only. Employee/Greg actions require the respective account's login.

### validate

Run presenter controls on isolated dev, inspect current outcomes and verify direct API permission refusals. Confirm a reset cannot affect the running deployment and no impersonation remains.

## E2.S13 — Inspect notifications and follow delivered offer links

### decided

Retain outbox filtering/status and E3.S16 capture/delivery semantics. Real mail receipt is required for final acceptance.

### acceptance

1. Authorized inspection shows actual recipient, delivery/capture state and supported filters without granting employee action authority.
2. A newly delivered test email opens the correct replacement frontend offer through sign-in/ownership; an unauthorized account receives refusal.

### validate

Record actual test-recipient receipt and follow the link in the browser, including signed-out and wrong-account cases. Inspect outbox/offer outcomes and retain capture inspection.

## E2.S14 — Inspect and run supported process comparisons

### decided

Use E3.S27 with retained baseline artifacts and resettable old operational history. Greg retains comparison commands; presenter reads only. Do not invent public cancel/restart actions.

### acceptance

1. Retained/new results, assumptions, measures and experiments display actual data; supported start/rerun/progress and interrupted-job states work for Greg.
2. Presenter inspection is read-only and errors/interruption remain honest. Retain seeds and current workload sizes without promising improvement.

### validate

Run the implemented comparison controls against Java and inspect results/progress/interruption and role refusals. Confirm the kickoff inventory's actual supported actions and retained artifact identity.

## E2.S15 — Retire replaced GCSP frontend entry points

### decided

Finish after capability/route parity. Angular owns the final GCSP frontend; preserve Used Cars and supported shared consumers.

### acceptance

1. Every in-scope route/view uses Angular without permanent legacy page-controller wrappers; obsolete GCSP entry/controller code is retired.
2. Launcher/brand handoffs target the replacement routes and assets. Legacy URL aliases are unnecessary; Used Cars remains supported.

### validate

Audit the route/capability matrix against integrated hosted journeys and actual build output. Run relevant shared-consumer/retail navigation checks and record remaining exclusions accurately.

## E3.S01 — Build and run the portable Java API artifact

### decided

Pin Java 21/Quarkus 3.x and compatible build/deployment tooling, reconciling supplied BMW standards. Retain Render delivery; no native-image requirement is added.

### acceptance

1. A reproducible JVM artifact runs the first contract endpoint with external configuration and usable startup/readiness/shutdown.
2. Run it on Render and demonstrate startup outside Render without changing core services. The deployed GCSP backend/jobs require no Node business execution.

### validate

Record tool/artifact identities, builds and actual startup/HTTP results in both settings. List required external dependencies/configuration and unverified BMW standards rather than claiming full BMW deployment acceptance.

## E3.S02 — Authenticate OIDC/JWT users and enforce roles

### decided

Use the chosen real test provider, trusted subject/account/role mapping and bearer access JWTs. Presenter has controls/inspection only; there is no actor impersonation.

### acceptance

1. Validate signature, expected issuer/audience and lifetime, then authorize actual employee, Greg and presenter actions/resources.
2. Invalid, expired, wrong-scope and unsupported identities fail explicitly; account switching changes effective context without manufacturing employee roles or replaying old credentials.

### validate

Exercise real browser login through E2.S01 plus API-level issuer/audience/signature/expiry and role/ownership failures. Capture the test claim mapping and BMW activation gaps; fabricated-token tests alone do not prove login.

## E3.S03 — Persist state in isolated development PostgreSQL

### decided

Use the separate dev database and agreed operational reset. Settle the persistence design early against FUCQ-419–425 objectives; preserve transaction semantics without copying the Node whole-run snapshot/diff implementation into Java by default. Full Node optimization delivery is not a prerequisite.

### acceptance

1. Persist application state, command receipts and authority across normal restart with atomic mutations, version/concurrency checks and honest uncertain outcomes. Identify the selected SQL/schema and freshness strategy.
2. Verify actual connection/reset isolation from the running app. Record how targeted reads/writes, reference evidence and reset work align with existing database Stories, and which optimization evidence remains separate.

### validate

Use native PostgreSQL for commit/rollback, competing instances, failed version checks, idempotent replay, uncertain commit and restart. Inspect representative SQL/query scope; demonstrate a dev reset leaves the running database unchanged. Follow the alignment record for distinct performance acceptance.

## E3.S04 — Read and publish canonical versioned policy

### decided

Preserve the PolicyService contract, retained source versions, canonical assumptions and Greg publication authority. FUCQ-412/413 inform lookup design without becoming automatic prerequisites.

### acceptance

1. All affected services use one policy interface for eligibility, allowance, points and assumptions with source/versioned failures.
2. Publication/activation affects subsequent work while historical records and pinned quotes retain their correct versions; unauthorized publication and missing policy refuse explicitly.

### validate

Change a canonical policy entry and replay affected calculations/displays, activation and retained-quote cases. Check version/provenance, missing/ambiguous inputs and role refusals against the baseline.

## E3.S05 — Resolve employee/account context through replaceable ports

### decided

Carry existing employee/contract/driver/context seams into Java, with backend ownership enforcement and provider mapping outside application logic.

### acceptance

1. Selected providers supply entitlement, drivers, current car/contract and supported account facts through the agreed API projection.
2. A differently shaped source gives equivalent presentation/business meaning without consumer changes. Unknown/unavailable facts and resource refusals stay explicit and source-linked.

### validate

Run equivalent and changed employee-context inputs through actual Java composition and the account view. Verify ownership, missing inputs and source failure without fixture-specific success paths.

## E3.S06 — Serve exact vehicle evidence from retained artifacts

### decided

Retain catalogue/configuration/VIN/imagery/handbook artifacts and their identities. Offline preparation may remain JavaScript; runtime consumption is Java. FUCQ-414/415/425 inform bounded evidence handling.

### acceptance

1. Java providers resolve the exact requested evidence, provenance and available imagery with correct missing/stale/unknown results and synthetic-identifier safeguards.
2. Alternate evidence shapes preserve the application contract. Retained artifacts are packaged/restored with documented identity/version and runtime access requirements.

### validate

Compare both provider shapes and retained reference cases, including exact stock identity versus shared configuration and absent/corrupt evidence. Inspect affected vehicle facts/images and hosted artifact consumption.

## E3.S07 — Save preferences, feedback and delegation

### decided

Port the existing brief/editor/account-feedback contracts, versions and engagement rules through canonical policy; fixtures supply facts rather than named-employee outcomes.

### acceptance

1. Authorized employees save supported preferences/requirements/feedback and engagement with current version checks and consistent saved state.
2. Stale/invalid/unauthorized updates refuse truthfully; restart and reload retain accepted state and the relevant audit/version references.

### validate

Replay existing preference, feedback, indifference and Buddy engagement cases through Java/PostgreSQL and Angular. Verify stale writers, persisted reload and changed inputs affecting subsequent evaluation.

## E3.S08 — Compute equivalent eligibility, quotes and recommendations

### decided

Port current decisions using shared source/policy inputs. Define numeric bounds preserving all displayed values and decision outcomes. Align with FUCQ-409–418 before duplicating calculation/index/cache work; performance improvements retain distinct evidence.

### acceptance

1. Eligibility, units/points, score display, ranking/tie-breaks, explanations and allocation/order outcomes match the baseline within documented tolerances.
2. Unknown/ambiguous facts, policy activation, frozen current-car context and boundary/tie cases retain existing meaning. Used Cars' JavaScript consumer remains supported.

### validate

Run cross-language reference and decision-sensitive cases; record numeric bounds and actual outputs, not just average score error. Inspect representative quoted/recommended presentation and relevant shared-consumer regressions.

## E3.S09 — Release stock through the selected supply provider

### decided

Preserve confirmed supply versus released stock, versioned provider inputs and the existing event/tick path. Align trigger reads/consumption with FUCQ-419/420.

### acceptance

1. Selected supply inputs release the correct exact stock under current versions and source authority.
2. Replayed releases do not duplicate stock; stale/unavailable inputs and unfinished work retain explicit outcomes and restart/reconciliation behaviour.

### validate

Replay actual release events/ticks, duplicate delivery, changed/stale inputs and restart against Java/PostgreSQL. Trace resulting stock and allocator input rather than invoking a fixture-only shortcut.

## E3.S10 — Claim and release manual selections safely

### decided

Preserve existing local/remote exact-stock claim protocols and durable execute/reconcile semantics. E3.S03 supplies transactional authority.

### acceptance

1. Claims enforce exact car, employee/slot and expiry constraints so competing employees cannot acquire the same authority.
2. Local and remote claim/release, retries, pending outcomes and restart converge without duplicate effects or premature release.

### validate

Use native PostgreSQL contention and controlled remote acknowledgements, response loss, expiry and restart. Verify retained operation identities and actual manual review/order projections.

## E3.S11 — Allocate Buddy offers and reconcile holds

### decided

Preserve priorities/tie-breaks, complete fallback candidates, exclusivity and existing remote Buddy claim/expiry support. Local Buddy is implemented first. Coordinate FUCQ-409–411/417–420 on allocator/trigger work.

### acceptance

1. Releases allocate computed eligible offers with one holder per exact car and the current employee/slot limits, retaining quotes and explanations.
2. Remote claims, pending attempts, expiry/release and restart retain truthful custody and reconciliation without duplicate occupancy or silently freeing uncertain stock.

### validate

Replay deterministic contention, fallback, ties, duplicate releases and expiry through real composition/PostgreSQL. Repeat relevant remote claim/response-loss/restart cases and inspect Buddy/offer outcomes.

## E3.S12 — Resolve offer links under OIDC ownership

### decided

Replace legacy link-only authority with sign-in/return and employee ownership. Old emailed links may reset at cutover; newly issued ones survive normal restart.

### acceptance

1. A new email link resolves the intended offer after real login and displays its actual current state to its employee.
2. Another employee/presenter, invalid reference or stale/terminal offer cannot gain decision authority. New links remain valid according to their contract across ordinary restart.

### validate

Follow delivered links signed out/in, with the wrong account and after decision/expiry/restart. Verify API ownership and rendered return/refusal/current-state behaviour.

## E3.S13 — Apply local offer decisions and follow-up

### decided

Preserve existing local accept/decline, source conversion, current eligibility versus retained quote, typed feedback and supported follow-up. E3.S14 owns the missing remote protocol.

### acceptance

1. Authorized explicit decisions revalidate current state, atomically preserve custody/order-conversion guarantees and produce the actual outcome once.
2. Conflicts, expiry, replay and refused/pending downstream work remain truthful. Decline releases authority under existing rules and permits only supported follow-up.

### validate

Replay local accept/decline, duplicate/conflicting commands, stale quotes/versions, expiry and conversion failure against PostgreSQL. Inspect resulting offer/activity/order states and historical receipts.

## E3.S14 — Complete remote offer acceptance and decline

### decided

Implement the missing Java remote decision protocol, preserving the delivered FUCQ-106 exclusion. Use the detailed remote-proof boundary in the refinement map; define custody/conversion/acknowledgement contracts before pickup.

### acceptance

1. Persist authorized decision intent before external I/O. Confirmed accept/conversion or decline/release finalizes once; unknown/malformed/refused outcomes retain truthful custody and the agreed resolution path.
2. Retries, conflicting decisions, lost responses, expiry and restart preserve durable operation identities and original receipts without duplicate order submission or stale-run effects. Removing the current refusal guard alone is insufficient.

### validate

Use the actual Java composition, controlled remote substitute and PostgreSQL for both decisions, contention, uncertain responses, authority changes and restart. Complete the signed-in Angular/mail journey before final acceptance; local proof is insufficient.

## E3.S15 — Submit and reconcile employee ordering handoffs

### decided

Preserve intentional manual/Buddy conversion and one authoritative ordering operation. Coordinate the claim/decision intake seam rather than replaying an accepted event into an incompatible active-hold path.

### acceptance

1. Current versions, terms/declarations and exact selection authorize one handoff with durable provider references and truthful pending/acknowledged/refused status.
2. Response loss, repeated commands and restart reconcile existing intent without a second order or fabricated confirmation.

### validate

Replay manual and Buddy handoff through PostgreSQL and the selected ordering adapter, including declaration/version failures, lost acknowledgements and restart. Verify conversion atomicity and displayed order/status.

## E3.S16 — Capture and deliver notifications through the selected transport

### decided

Preserve the outbox/message contract, capture mode and available Brevo transport behind configuration. Agree actual test sender/recipient for future validation; no sends are authorized by this draft.

### acceptance

1. Notifications follow secured business state and contain the correct recipient, offer and replacement URL; capture/status/retry behaviour remains inspectable.
2. Prove real delivery through the configured adapter to the agreed test recipient and the OIDC/employee-owned offer journey. Outbox capture alone is insufficient.

### validate

Exercise capture, transport refusal/retry and state-before-notification ordering, then record bounded real mail receipt and browser return. Keep credentials outside artifacts and comparison runs free of outbound email.

## E3.S17 — Reconcile approvals and ordering status

### decided

Port supported lifecycle approval/status stages through existing provider ports and canonical policy. Elapsed time alone does not establish approval.

### acceptance

1. Provider acknowledgements/status drive the supported ordering/approval progression with actual references and ownership.
2. Unsupported/refused/pending status and replay/restart remain truthful and cannot skip required gates.

### validate

Replay supported approval/status sequences and failure/reconciliation cases through Java. Verify employee progress projections against actual provider records and relevant permissions.

## E3.S18 — Read and acknowledge documents/readiness

### decided

Preserve implemented source-linked document and readiness behaviour. Check synthetic-specific acknowledgement assumptions against the selected adapter's actual capability.

### acceptance

1. Required documents, ownership, readiness and supported acknowledgements reflect current provider/policy state and correct employee authority.
2. Absent evidence, unsupported writes and stale/refused acknowledgements never become successful completion.

### validate

Replay available/missing documents, required gates, acknowledgement and refused provider cases. Inspect the resulting employee readiness/action contract and supported UI states.

## E3.S19 — Plan supported handover appointments

### decided

Preserve currently implemented availability/booking and completion capabilities only. Planning and physical completion remain distinct.

### acceptance

1. Readiness gates, appointment availability, requests/confirmations and supported outcomes retain actual provider references and employee permissions.
2. Pending/refused/repeated operations and restart preserve the authoritative appointment without invented bookings or newly added lifecycle scope.

### validate

Replay supported appointment scenarios, gating, conflicts, retries and unavailable provider responses through Java; inspect the employee plan/status projection and actual provider state.

## E3.S20 — Plan and reconcile supported old-car returns

### decided

Preserve the separate return journey and implemented outcome/current-car relationship contract. A confirmed plan does not itself complete a return.

### acceptance

1. Authorized return plans and supported outcomes retain their source references, statuses and relationship to the employee's old car.
2. Current-car changes occur only at the existing authoritative outcome boundary; pending/refused/retried work remains consistent across restart.

### validate

Replay supported return planning/outcome sequences, repeated delivery and provider refusal/recovery. Check old/new-car relationships and their rendered plan/progress presentation.

## E3.S21 — Maintain owned help/renewal cases and remedies

### decided

Preserve implemented case ownership, privacy, status and feasible remedies. Do not absorb optional case backlog work or invent automatic recovery priority.

### acceptance

1. Application state opens/updates supported cases with named ownership and only genuinely permitted remedies.
2. Employee/Greg permissions and stale/denied/unavailable operations protect case/resource boundaries and truthful progress.

### validate

Replay supported employee/help and Greg queue/remedy scenarios against Java, including cross-account refusals and stale operations; inspect relevant projections and views.

## E3.S22 — Calculate Greg's demand and operational projections

### decided

Preserve implemented demand, suitability and operational evidence with privacy thresholds, versioned inputs and distinct employee/stock counts.

### acceptance

1. Dashboard projections derive from current application/provider facts and canonical policy without canned totals or double counting.
2. Privacy bands, missing evidence, source/version changes and unavailable results retain existing meaning and permission boundaries.

### validate

Compare baseline and changed-input projections, threshold edges and exact counts under the agreed workload. Inspect Greg/presenter outputs and prevent suppressed-data reconstruction.

## E3.S23 — Consume learned artifacts and capture new learning records

### decided

Retain reusable trained models and active model identity/features/inference. Operational learning history may reset; useful offline training/preparation may remain JavaScript.

### acceptance

1. Java consumes the documented model artifact/version and reproduces required forecasts/uncertainty within defined outcome-preserving numeric bounds, without Node runtime execution.
2. Implemented new-run learning records retain actual exposure/outcome provenance; unknown historical observations and synthetic evaluation limits remain explicit.

### validate

Verify artifact identities and cross-language feature/inference/reference cases, including missing/corrupt models and new record producers. Inspect downstream forecast/explanation results; offline artifact generation alone is insufficient.

## E3.S24 — Calculate Greg's constrained next-order plan

### decided

Preserve current planner/solver contracts, objectives and constraints from canonical policy. Preview does not submit a Production request.

### acceptance

1. Current demand/supply and editable constraints compute the supported quantities, coverage/risk, alternatives and explanations with equivalent decision outcomes.
2. Infeasible/stale inputs, changed constraints and recomputation remain truthful; no new optimisation objective or product rule is added.

### validate

Replay feasible, infeasible, boundary/tie and changed-input cases within agreed numeric bounds and existing workload sizes. Inspect plan explanations and prove preview has no submission side effect.

## E3.S25 — Submit Production requests and reconcile responses

### decided

Preserve intentional submission and the distinction between request, confirmation and released stock. Coordinate E3.S09/S24 without inventing an external supply capability.

### acceptance

1. Current plan/version checks authorize one supported request with durable quantities/references and actual pending/confirmed/refused state.
2. Retries, uncertain responses and restart preserve one authoritative provider operation; real responses update supply and trigger the supported replan path.

### validate

Replay submission, stale plans, lost responses, rejection and response-driven replan through Java/PostgreSQL and the selected substitute. Inspect Greg status and resulting supply/release distinctions.

## E3.S26 — Run clock, scenarios and presenter operations

### decided

Port actual handler order/ticks, releases, resets and fault/retry behaviour. Separate demo preparation from selectable provider composition and remove actor switching. Align receipt/trigger work with FUCQ-419–424.

### acceptance

1. Dedicated presenter operations drive actual state and current projections with idempotent tick/reset/reconciliation semantics; user actions require their respective login.
2. A configured non-demo provider composition does not implicitly seed demo users/data. Development reset is isolated and ordinary runtime restart preserves active new-app work.

### validate

Replay scenario setup, ticks/releases, faults/retries, reset and interrupted work against Java/PostgreSQL. Verify handler order, role refusals, provider composition and actual database targets.

## E3.S27 — Retain comparison results and supported job behaviour

### decided

Preserve agreed baseline artifacts and implemented experiments/start/rerun/progress/interruption. Old operational history may reset. Greg commands; presenter inspection only.

### acceptance

1. Java reads retained results and runs supported jobs with equivalent seeds, assumptions, measures and honest outcomes at existing sizes.
2. Progress, failures and interrupted-job recovery preserve actual status across restart. No public cancel/restart capability is invented, and comparison execution sends no real email.

### validate

Check retained artifact identities and equivalent selected multi-seed/reference results, start/rerun and interrupted work on the hosted resources. Inspect results/progress and direct role refusals; record memory/time evidence.

## E3.S28 — Prove provider composition and complete substitution

### decided

Credit existing ports. Complete the selected local journey first, then full remote transactional proof before final hosted acceptance, using real test OIDC and real test email.

### acceptance

1. Inventory every in-scope external read/action/event port and select providers at startup without changing Angular business presentation or core Java services. Demo preparation cannot bypass this composition.
2. Differently shaped employee/stock inputs alter computed results, while claim → signed-in decision → order/status remains coherent through the remote substitute. Retain each remaining port's contract/failure evidence and identify BMW access/capability gaps.

### validate

Replay connected read/recommendation and transactional journeys through actual runtime composition, including E3.S14 uncertainty/recovery. Distinguish synthetic, recorded, contract-tested and verified-live evidence in the integration handover.

## E3.S29 — Rehearse fresh-state cutover and retire GCSP Node runtime

### decided

Retain reusable source/reference/model/baseline artifacts; reset agreed operational state. Gary reviews all work on hosted dev, then merges into `gcsp-poc`; no interim review, old-environment retention or rollback rehearsal is required.

### acceptance

1. Rehearse retained-input startup and the authorized reset on isolated dev, with all in-scope capabilities accounted for and the final hosted journey evidence available.
2. Document final blueprint/database configuration, readiness/sign-in/journey verification and retirement of in-scope Node execution while preserving Used Cars. Old pending work need not be drained or migrated; normal replacement-app persistence remains required.

### validate

Use actual dev state/configuration and completed capability evidence. Hand over concise final review/setup and merge/build steps with failed/unrun checks and known limitations. Verify the final switch only after Gary's future merge; no deployment is performed by this draft.

## Authoring evidence

This pack adds Story text only. Its acceptance/validation sections are future obligations, not passing results. No application code, dependencies, runtime configuration, data, live services or Jira records are changed. The associated refinement record contains scoped link/label checks and the unchanged historical index-link gaps. Technical pickup assessment, sizing, precise versions/contracts and BMW standards reconciliation remain explicit.
