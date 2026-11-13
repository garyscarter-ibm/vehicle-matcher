# Static Angular frontend, Java backend and replaceable adapters — Epic proposals

Gary's refinement request, 13 November 2026. **Draft for discussion; no Jira items published and no implementation started.** Jira writes remain paused. These proposals preserve existing Story contracts, claims and acceptance decisions.

The intended outcome is a GCSP experience delivered as a static Angular application, calling a separately deployable **Java 21 / Quarkus 3.x backend API** whose external dependencies can be replaced through explicit adapters.

## Recommended boundaries

| Proposed Epic | Outcome | Completion question |
| --- | --- | --- |
| **E1 — Run GCSP through an independently hosted frontend and backend API** | Restore the planned deployment and responsibility split while retaining working sessions and journeys. | Can we publish the frontend separately, with all application data and actions crossing the API boundary? |
| **E2 — Deliver the GCSP experience in Angular** | Angular owns the application's screens, navigation and presentation state, preserving the existing experience and behaviour. | Can employees, Greg and the presenter complete the existing supported journeys in the Angular application? |
| **E3 — Run the GCSP backend on Java 21 and Quarkus 3.x with replaceable adapters** | Replace the Node backend runtime while preserving API behaviour, business decisions and durable state; complete and prove the existing provider boundaries in Java. | Can the same frontend journeys run against Quarkus, with equivalent results, proven transactional behaviour and demonstrably replaceable providers? |

Recommend these three bounded outcomes. A static/API split can work before Angular, and the Java port needs its own parity and adapter-substitution evidence. Implement through small connected journeys. This document proposes Epic-level acceptance; implementation Story slicing and estimates follow refinement.

**Confirmed by Gary, 13 November 2026:** the migration covers **GCSP only**, and **Angular owns the frontend**, including screens and navigation. Existing custom elements may support the migration. Used Cars remains a separate consumer of shared assets and logic, with its existing frontend and behaviour preserved. These two scope decisions do not constitute acceptance of every proposed criterion below.

**Additional direction, Gary, 13 November 2026:** port the backend to **Java 21 using Quarkus 3.x**. The initial draft did not include a backend language migration; the subsequent four-Epic draft labelled the Java port E4 and adapter completion E3. This is authoring scope, not an instruction to begin the port.

**Consolidation recommendation, 13 November 2026:** Gary questioned whether the adapter work still warrants its own Epic after reviewing the delivery order. This revision recommends folding it into the Java/Quarkus Epic, now numbered **E3**. The former standalone adapter Epic becomes an explicit workstream with retained acceptance and substitution evidence. Remote offer acceptance/decline remains a separately visible, bounded Story proposal within that Epic. This is a refined draft, not a confirmed change to existing Story acceptance, implementation authorization or Jira records.

## The claim we should be able to demonstrate

> The Angular frontend obtains application data and performs business actions through our Java 21 / Quarkus backend API. Every external system dependency sits behind a dedicated backend adapter contract. Our demonstration uses synthetic or recorded providers where live services are unavailable. A conforming live adapter can replace a provider without changing the frontend or core application logic, provided the live service supplies the required data and capabilities.

This is the target completion claim to prove, not a statement that the current application already satisfies it. The Java port changes the backend implementation once; later provider substitutions should preserve that implementation's application logic.

There are two different boundaries: **Angular API clients** connect the browser to our backend; **backend service adapters** connect application services to external systems. The frontend never selects a real or mock upstream provider. External authentication redirects and approved image/static-asset delivery may use their own hosts; application data and business commands still follow the backend boundary.

“All data is mocked” would misdescribe the current foundations. There is a PostgreSQL repository, a Brevo mail transport implementation, source-backed vehicle snapshots and synthetic operational providers. This proposal does not claim that any particular live transport is currently enabled or that BMW services are integrated.

Application-owned state, employee-entered preferences and calculated recommendations also need a clear home: the backend repository and application services. They do not require invented external services or one adapter per field. Adapter boundaries follow coherent upstream capabilities; one real service can implement several ports, and one capability can need several sources.

## E1 — Run GCSP through an independently hosted frontend and backend API

**Intent:** As the team maintaining GCSP, we can release a static frontend independently of the backend while users retain the same authenticated journeys and durable state.

### decided / proposed scope

- Publish the complete GCSP frontend as static HTML, JavaScript, CSS and assets. Move request-time asset preparation into the frontend build. The backend supplies APIs and application services rather than employee/presenter HTML pages.
- Give every frontend consumer one consistent API configuration and request boundary. Keep credentials and provider configuration on the backend; public frontend configuration identifies only the application API and public presentation settings.
- Replace HTML-request session redirects and presenter-cookie setup with explicit API bootstrap/session operations. Keep authorization, eligibility, ownership and business transitions enforced by the backend.
- Preserve deep links, refresh, old offer/email entry links, token exchange, role navigation and brand/context handling. Define route compatibility and asset caching for independent releases.
- Retain Render as the hosting direction and PostgreSQL as the durable store. Proposed hosting is sibling HTTPS domains under a controlled domain, or a proved same-origin routing arrangement with separate static/API deployments. The final domain/routing choice remains open; a custom domain does not itself complete this Epic.
- Record frontend/API compatibility, release order and rollback so a frontend rollout does not depend on bundling its pages into the API deployment.

### acceptance

1. The frontend build can be served by a static host without a Node frontend process or per-user HTML generation. Static assets contain no private employee or presenter state.
2. Supported application reads and commands use the backend API. No frontend code accesses PostgreSQL, upstream operational services or server secrets directly. Backend authorization still refuses an unauthorized request made outside the UI.
3. Login, logout, expiry, account context, employee/Greg role separation, presenter controls and offer-link access work under the chosen deployed origin/cookie arrangement, including direct entry and refresh.
4. The agreed route inventory resolves to the correct frontend state. Invalid routes, unavailable APIs and expired sessions have usable recovery states; API errors never turn into an HTML fallback response.
5. Frontend and API artifacts can be built and released separately. A demonstrated compatible release and rollback preserve saved application state and existing links.

### validate

Use the existing route inventory and manual acceptance scenarios. Exercise the selected HTTPS topology in supported browsers, including Safari and private browsing, rather than relying on loopback or CORS inspection alone. Cover login/context, presenter setup/reset, saved preferences, manual claims, offer exchange/decisions and Greg's operations; retain server authorization checks. Record actual results, failures and unrun cases. E2 supplies Angular-specific routing acceptance when its screens replace the current frontend.

**Boundary:** backend language conversion and adapter completion belong to E3. E1 introduces no microservices, repository split, database migration or Cloudflare move. It preserves existing behaviour and does not absorb performance tuning or new product features.

## E2 — Deliver the GCSP experience in Angular

**Intent:** As an employee, Greg or the presenter, I can use the existing GCSP capabilities through a coherent Angular application, with the same decisions, data and outcomes.

### decided / proposed scope

- Create a client-rendered Angular application delivered through E1's static hosting/API boundary. Angular owns routes, views, forms and presentation state; backend services retain authoritative identity, policy and transactions.
- Migrate the currently supported GCSP surfaces: sign-in/entry and shell; employee account, brief, manual selection and Buddy; offers and supported order progress; Greg's operational/planning views; presenter controls and captured outbox. Freeze the precise implemented route/capability baseline at Story authoring so existing unfinished features do not become migration scope.
- Reuse framework-independent logic, shared components and semantic design tokens according to [COMPONENTS.md](../../COMPONENTS.md). Adapt reusable components where needed; custom elements can support incremental migration. Completion requires Angular-owned views and navigation, rather than a permanent wrapper around the old page application.
- Preserve the agreed visual language, concise product copy, accessibility and desktop/narrow behaviour under the [experience quality contract](experience-quality.md). Map migrated components into the shared catalogue and relevant quality checks. Framework migration is not a new visual redesign.
- Use Angular API services against the real application backend for integrated acceptance. Component-test doubles remain useful, but browser-only fixtures do not establish migrated journey completion.
- Select and pin the Angular/toolchain version against the known target-platform constraints at refinement. Record what has actually been proved about target Angular/design-system compatibility; do not infer BMW platform acceptance from running Angular locally.

### acceptance

1. An explicit migration matrix maps every in-scope existing route/capability to its Angular replacement, expected states and validation evidence. Each works against the existing backend; unimplemented backlog capabilities are separately identified.
2. Employees can retain and edit preferences, use manual/Buddy journeys, open an emailed offer, accept or decline it and inspect supported progress. Greg and the presenter can perform their in-scope operations with the correct role separation and persisted outcomes.
3. Navigation, refresh and deep links retain context. Loading, empty, unavailable, validation, accepted/rejected and expired states reflect actual backend responses. Displayed countdowns and optimistic UI do not establish a business outcome.
4. Migrated views meet the existing component, visual, responsive and keyboard requirements and the target content-security constraints. Client route guards improve navigation; backend permissions remain independently enforced.
5. Angular owns the migrated screens and routing; obsolete page controllers/entry paths are retired after parity. Shared consumers, including Used Cars, retain their agreed behaviour and styling.

### validate

Replay the agreed journeys against the backend, with retained state across reloads and relevant error/expiry cases. Inspect the actual Angular screens at desktop and narrow widths and use keyboard interaction for migrated controls. Apply existing UI ratchets to the new Angular paths, adapting their coverage where necessary. Run the relevant shared-component/retail regressions when shared code changes. Record route-by-route evidence and remaining limitations; a successful build or a wrapped legacy screen alone is insufficient.

**Boundary:** no adoption of new business rules, wholesale redesign, implementation of unfinished lifecycle/planning features or Angular migration of Used Cars. Adopting a particular BMW design-system package requires its actual availability and integration scope to be established.

**Design delta:** [HLD review Q18](../design/hld-review-gc.md) and the experience contract currently require custom elements embeddable in a future Angular host. This proposal goes further: Angular becomes our GCSP frontend. Reconcile the canonical HLD and embedding requirement before implementation; do not silently treat the old custom-element acceptance as equivalent to the new end state.

## E3 — Run the GCSP backend on Java 21 and Quarkus 3.x with replaceable adapters

**Intent:** As the team maintaining and integrating GCSP, we can operate its backend on the requested Java platform, replace external providers through explicit adapters, and retain the same frontend contract, business decisions, data and working journeys.

Adapter completion and proof are part of this Epic's completion contract. The workstream below retains the former standalone adapter Epic's coverage and evidence requirements; a successful language port alone does not satisfy them.

### decided / proposed scope

- Implement the GCSP backend runtime in Java 21 with a pinned Quarkus 3.x release. Include the supported API routes, application services, policy/recommendation/allocation logic, repository, provider adapters and existing clock, notification and job responsibilities. Maintain static frontend delivery under E1; Quarkus does not become an HTML-rendering frontend.
- Establish an explicit API/behaviour baseline from the currently supported Node implementation. Preserve paths, methods, payloads, status/error meanings, identifiers, dates, session/cookie and offer-token handling, role/resource checks and applicable version/command semantics. Any necessary incompatible change is separately agreed and sequenced.
- Retain PostgreSQL data and schema compatibility wherever practical. Prove the existing guarantees for exclusive claims/holds, pinned policies/quotes, idempotent commands, pending external outcomes and recovery. Document and rehearse any necessary data/schema transition and rollback; do not reset employee state to simplify the port.
- Translate decision logic with shared reference inputs and expected outcomes. Preserve eligibility, ranking/tie-break decisions, explanations and calculations. Retail's JavaScript implementation remains supported; cross-language contract/parity evidence replaces assumptions that Java can import the existing JavaScript modules.
- Replace Node-specific runtime facilities where they are used, including comparison workers and filesystem-backed corpus/model reads. Preserve the supported capabilities and lifecycle; introducing an autonomous scheduler or new event platform is separate scope.
- Carry the existing adapter boundaries into Java interfaces and trusted Quarkus composition, completing the provider-selection and demo-preparation gaps identified below. A temporary Node coexistence route can support migration, but the final in-scope backend runs in Java; permanently forwarding business operations to Node does not complete the port.
- Supply a reproducible JVM build, runtime configuration, health/readiness and Render deployment/rollback path. Pin Java 21 and the chosen supported Quarkus 3.x version at implementation refinement. A native-image build is not required by this proposal.

### acceptance

1. The in-scope backend builds and runs on Java 21 / Quarkus 3.x. A capability matrix accounts for all currently supported Node backend responsibilities and their Java replacements; omitted or unimplemented backlog work is identified explicitly.
2. The same supported frontend journeys pass against Quarkus using the agreed API contract. Session expiry, authorization denials, offer entry, errors and source-unavailable cases retain their observable meaning. No frontend business rewrite is needed merely to change backend language.
3. Reference inputs produce equivalent eligibility, rankings, allocations, explanations and persisted transitions. Numeric representation differences are resolved against the existing contract; no silent rule changes or per-employee exceptions are introduced.
4. PostgreSQL integration proves competing claims, duplicate/retried commands, uncertain writes, expiry/reset and interrupted-work recovery preserve existing guarantees. Persisted records, active offers and historical policy/quote references remain readable and correct across the rehearsed cutover.
5. The Java runtime meets the adapter-completion acceptance below, including complete provider composition, separation of demo preparation and a connected substitution demonstration. Mock-backed journeys function through Java application services; API-compatible Node forwarding is identified as a temporary migration state.
6. A representative hosted workload demonstrates usable existing journeys and jobs within the selected Render resources. Release, readiness, compatible-state rollback and retirement of the in-scope Node runtime are demonstrated. Any required hosting-plan/cost change is made explicit before provisioning; no performance improvement is claimed without measurement.

### validate

Reuse current API contracts, manual scenarios and decision fixtures as the baseline. Run the same HTTP/journey checks against Node and Quarkus on isolated equivalent state; compare business outputs and error behaviour. Add Java service/repository checks where existing JavaScript tests exercise implementation directly, rather than treating those old tests as proof of the Java code. Use actual PostgreSQL for transaction/concurrency/restart evidence and replay provider refusal/uncertainty paths without live external actions. Rehearse deployment and rollback on non-production state, then record the actual hosted smoke/workload results and limitations. Existing checks remain authoritative evidence of intended behaviour, not a mandate to create a new general validation framework.

**Boundary:** the port preserves implemented GCSP capabilities and introduces no new product rules, BMW integration, database-engine change, AWS move, microservice split, native-image requirement or Used Cars backend migration. Java/Quarkus does not by itself prove production-platform compatibility or resolve the separately tracked performance/reliability work.

### Adapter completion and proof within E3

**Intent:** As the team integrating GCSP, we can connect an authorized external service by implementing its adapter and configuring the backend, while preserving the Angular API contract and the application's existing decision logic.

**Existing baseline, assessed 13 November:** [the adapter-readiness assessment](adapter-readiness-assessment-2026-11-13.md) confirms substantial implementation and passing selected substitution/protocol tests. Employee/identity reads, vehicle evidence, policy/storage, remote manual/Buddy claims, ordering and mail already have boundaries. Remaining work includes full provider composition separated from demo preparation, remote offer acceptance/decline and connected replacement evidence. This workstream credits that existing work; it does not commission a new adapter architecture or claim every criterion starts unbuilt. Constructing a synthetic provider in the composition root is not itself a coupling defect.

#### decided / proposed scope

- Keep remote offer acceptance/decline as a separate bounded Story proposal within E3. It completes a missing provider protocol rather than mechanical cleanup; preserve prior delivered Story exclusions and do not make it a prerequisite for unrelated read or local-provider migration slices.
- Inventory every external source and operation used by the implemented journeys. For each, identify the authoritative system, application-facing contract, present provider, source/provenance, capabilities and known live-service gaps. Reuse existing ports and contracts rather than introduce a parallel adapter framework.
- Cover reads, commands and relevant events/status reconciliation. “Fetch all data through adapters” alone would miss exclusive claims, order submission, uncertain writes, approvals and notifications.
- Make provider selection explicit in trusted backend composition. Remove required service-code edits merely to select an alternative provider; keep provider field names, transport and authentication inside its adapter. No implicit switch to synthetic success when a live provider fails.
- Keep mock/recorded providers functional: they supply inputs and perform real scenario state transitions through the same application services. Recommendations, allocations and aggregates are computed from those inputs.
- Define required and optional capabilities honestly. Unsupported actions, absent facts, source delays and uncertain outcomes have explicit results that existing application services can handle. A replacement cannot fabricate authority that the upstream service does not provide.

Initial capability inventory to reconcile with the actual implementation:

| Boundary | Examples of information/actions | Ownership to preserve |
| --- | --- | --- |
| Identity and employee context | Principal/roles, entitlement, drivers, current car/contract and available usage facts | Backend resolves the principal and enforces employee/resource access. |
| Scheme policy and reference inputs | Dated eligibility, allowance, points and approved assumptions | One PolicyService remains the application contract; internal policy storage need not become an external system. |
| Supply and stock | Inbound/released stock, release/status inputs, claim/reservation/release capabilities | Explicit authority for exact stock and exclusive holds; no competing upstream/local owner. |
| Vehicle evidence | Catalogue/specification, configuration/VIN relationships, imagery and available handbook data | Preserve exact identity, source/freshness and synthetic-identifier routing protections. |
| Ordering and lifecycle | Requests, status, approvals, documents, appointments and return outcomes used today | Preserve provider references, pending reconciliation and the actual commitment boundary. |
| Notifications | Captured delivery and available real transport outcomes | Notification delivery follows business state; transport success does not allocate a car. |

This is a coverage checklist, not a requirement for six services or six adapters, nor authorization to add new telemetry or implement every future integration.

#### acceptance

1. Every in-scope external read, action and event path is mapped to a backend port and selected adapter. Direct upstream calls, fixture imports and demo seeding cannot bypass that boundary in a live configuration. Application-owned state and derived results are separately identified.
2. In-scope providers can be selected through backend composition without changing Angular components, public API payloads or core application services. The same services handle synthetic, recorded and conforming external inputs.
3. Each required port has contract evidence for its supported operations and relevant failure/capability states. Existing contracts cover identity, units, missing/stale facts, provenance and command/reference semantics as applicable; do not invent generic fields that no consumer needs.
4. A substitution demonstration replaces providers at the backend boundary and replays representative read-only and transactional journeys. Changed source inputs change the computed recommendations/results. Refused, expired or uncertain commands remain truthful, and retries/reconciliation preserve exclusive claims and avoid duplicate external actions.
5. The inventory distinguishes **synthetic implementation**, **recorded/source-backed evidence**, **contract-tested replacement** and **authorized live integration verified**. Two test providers can prove interchangeability, but cannot establish that an unavailable BMW service supports the contract. Actual live activation requires the relevant service's authorized access and positive integration evidence.

#### validate

Reuse existing adapter, service, HTTP and journey checks. Exercise the actual runtime composition, not just constructors in isolation. Include at least an employee-context/stock-to-recommendation flow and a claim-to-order/status flow, plus the relevant failure/retry cases. For ports not used by those two journeys, retain focused contract evidence and an explicit coverage record. Keep fixture reset and synthetic-identifier protections isolated from any real integration. Contract mismatch or missing upstream capability is a recorded integration gap, not a passing mock test.

**Boundary:** this workstream establishes and proves replacement seams for existing capabilities. It does not commission every live BMW adapter, invent missing APIs, migrate hosting to AWS or establish production readiness. Its implementation and evidence belong to E3 alongside the Java port; actual live integrations remain separately scoped capabilities, including the existing live catalogue/imagery work.

## Existing foundations and overlap

Observation baseline: `gcsp-poc` at `d4e9518ea`, 13 November 2026. These are code/document observations, not a fresh Jira status audit.

- [The static/API assessment](static-frontend-api-assessment-2026-11-13.md) identifies existing page hosting, mixed API transports, presenter-cookie setup and the 9 November same-origin decision. E1 supplies the remaining migration outcome. Its earlier 4–8 day indication excludes Angular migration, adapter-completeness work and the Java backend port; it is not an estimate for these three Epics.
- [Runtime composition](../../server/gcsp/runtime.js) already accepts identity/stock and other dependencies, but directly constructs synthetic manual-stock, ordering, status, document, appointment and return providers. [Manual context](../../server/gcsp/manual-context/index.js) has source-aware ports, with [scenario fixture preparation](../../server/gcsp/manual-context/fixtures.js). E3's adapter workstream should complete/select existing seams before proposing new ones.
- [The repository](../../server/gcsp/repository/index.js), [PolicyService](../../server/gcsp/policy/index.js) and [mail transport configuration](../../server/gcsp/notify/config.js) demonstrate that adapters have different purposes and evidence levels. Preserve existing authority and failure behaviour.
- [FUCQ-6 / the HLD](../design/gcsp-high-level-design.md) owns architecture agreement; [FUCQ-8](shared-recommendation-design.md) owns shared recommendation contracts; [FUCQ-13](fucq-12-stories.md) owns compatible entry/routing. [The vehicle-adapter map](bmw-interface-stories.md) retains FUCQ-14–20, including access-gated live catalogue/imagery. Reconcile overlap at Story authoring; retain their acceptance and avoid duplicate delivery claims.
- [Performance work](performance-tuning-stories-2026-11-12.md) and [new client capabilities](bmw-client-feedback-proposals-2026-11-12.md) keep their own scope. These migration proposals do not pick up their unfinished work or change product policy.

## Refinement and delivery order

Gary has confirmed GCSP-only scope and Angular-owned screens/navigation. Align the canonical [draw.io HLD](../design/high-level-design.drawio) and its existing design records with that delta before architecture rewiring. This proposal document is not a replacement HLD.

The additional Java/Quarkus direction also changes the backend implementation baseline. Carry the same API, provider and state responsibilities into that HLD update; the language change does not relocate business authority into Angular.

Use an initial connected slice to prove Angular sign-in/context against the separate API and the chosen HTTPS session arrangement. Continue by supported journey, sharing E1's transport work and E3's API/provider contracts. Provider inventory and backend contract work can proceed independently of screen migration where the interfaces already exist. Do not require completing every Epic before a coherent increment can be integrated.

Establish the API/decision baseline before rewriting its implementation. Prove an initial Quarkus read/context slice against the same frontend contract, then migrate transactional journeys and background responsibilities with explicit state ownership. Specify application-facing provider behaviour independently of JavaScript types; complete the remaining provider seams within E3's Java slices where practical rather than requiring two complete adapter refactors. Avoid two runtimes independently mutating the same live business state during migration.

### Recommended priority and technical dependencies

Gary requested a sequencing recommendation on 13 November. The order below is a proposal for delivery planning, not approval to start implementation or an amendment to any claimed Story.

**Start with E1's API/session foundation; then progress E2 and E3 against the same contract, completing the remaining adapter work within the Java journeys.** Provider inventory and contract clarification start early. Completing all adapter criteria is not a prerequisite for starting either migration.

| Priority | Epic contribution | Reviewable outcome and dependency |
| --- | --- | --- |
| **1 — Establish the shared boundary** | E1 foundation and E3 provider inventory/behaviour baseline | Reconcile the canonical HLD; record the implemented route/capability baseline, API/session/error contract, selected hosting topology and required provider capabilities. Retain reference inputs and expected decisions from Node. These give the frontend and Java work an agreed interface. This is the foundation of E1, not a claim that its full hosting/release acceptance is complete. |
| **2 — Prove the target stack together** | A small connected slice across E1, E2 and E3 | A separately hosted static Angular sign-in/account-context view calls Quarkus using the chosen HTTPS session arrangement, and Quarkus selects an existing mock/recorded provider through its port. Check the same observable API behaviour against the Node baseline. This proves the intended deployment and responsibility split before expanding either migration. |
| **3 — Resolve transactional risk early** | E3, including the relevant provider seams | Prove an existing claim-to-order path on actual PostgreSQL, including competing claims, retries, uncertain outcomes and restart/reconciliation. Carry provider selection and separation of demo preparation into Java as those services move. Give remote offer acceptance/decline its own bounded Story: it is substantive protocol work, required before claiming a complete remote offer-to-order substitution, but does not block unrelated read or local-provider journeys. |
| **4 — Expand by supported journey** | E2 and E3 can progress alongside one another; adapter work accompanies each backend slice | Migrate the remaining employee, Buddy, Greg and presenter capabilities in coherent increments. Angular can use the agreed Node API for a journey until its Quarkus replacement passes parity; a Quarkus capability can be checked against the contract before its Angular screen is ready. Track the backend that owns each state-changing capability and keep temporary coexistence explicit. Preserve the working demonstration and Used Cars throughout. |
| **5 — Complete integration and cutover** | Acceptance across E1–E3 | Replay the agreed Angular journeys against Quarkus, demonstrate provider substitution, and rehearse hosted deployment, state continuity and compatible rollback. Retire the in-scope legacy frontend and Node backend only after their replacements meet the relevant acceptance. Mock substitution still does not prove an unavailable live BMW service. |

The logical dependency is **agreed API/provider contracts → first target-stack slice → complete journey replacements → integrated cutover**. Neither all of Angular nor all of Java must finish before the other can start. If delivery has only one implementation stream, favour **E1 foundation → first Angular/Quarkus slice → E3, including adapter completion → remaining E2 screens → integrated cutover**; that exposes backend/state risks before investing in the full screen migration.

Avoid a complete legacy JavaScript hosting/adapter rewrite merely as preparation for replacing it. Make only the Node changes needed to establish the boundary and keep supported journeys working; place lasting provider-composition changes in Java where practical. Keep remote-decision work visible rather than estimating the whole adapter workstream as mechanical cleanup. Actual live BMW integrations and optional performance work retain their separate scope.

Before Story pickup, agree the route/capability baseline, target Angular/toolchain constraints, Quarkus 3.x version/build constraints, domain/routing topology and the required capabilities for each provider. Assess technical dependencies from actual interfaces under [the readiness policy](technical-readiness-2026-11-05.md); Jira links alone are not automatic gates. Capture any separate live-service access gap without making all mock-backed migration work depend on it.

Apply the [build rules](build-rules.md), [demo brief](demo-brief.md) and [experience contract](experience-quality.md) when refining Stories. Retain canonical policy, pinned quotes, backend permissions, durable state and the existing synthetic-data boundaries. No existing claimed Story's acceptance changes through this document.

## Authoring validation

The subsequent three-Epic consolidation is documentation-only. It moves the existing adapter requirements into the Java Epic, updates the recommendation and index, and leaves runtime code and existing Story contracts unchanged.

Initial Epic authoring was documentation-only: local Markdown links, proposal/scope consistency and `git diff --check`, without application tests, browser trials, deployed-origin checks or provider substitution runs. The subsequent adapter-readiness assessment above records its separate focused 11-test run against unchanged runtime code. The acceptance sections describe future delivery evidence, not results achieved by authoring the Epics. No Jira writes, service provisioning, dependency installation, application-state changes or external messages are part of this work.

The initial draft's 21 local file links passed. A wider initial check of this document and the index checked 122 links and failed on seven existing index targets, all also missing at baseline `d4e9518ea`: `evidence/{fucq-6,fucq-79,fucq-86-90,fucq-110,fucq-132,fucq-74-75,fucq-13-19}/story-publication.json`, relative to `docs/gcsp/`. Expected: index links resolve to evidence files. Observed: those targets are absent in this checkout; the links are unchanged by this task. Provisional severity: Low, documentation navigation only; originating Story unresolved from this bounded check. Retain for separate reconciliation/repair; Jira Bug capture is deferred by the explicit write pause. This is not a passing whole-index check or a repaired defect.

Technical reference checked on 13 November 2026: Angular's official deployment guidance supports static client-rendered delivery and requires deep-link fallback configuration; its routing guidance requires server-side authorization in addition to client guards. References: `https://angular.dev/tools/cli/deployment` and `https://angular.dev/guide/routing/route-guards`. No Angular version has been selected by this draft.

Quarkus's official 3.x overview identifies Java 21 support, and its datasource/transaction guides describe PostgreSQL and Jakarta transaction facilities. These establish available framework facilities, not compatibility of our unported code. References: `https://quarkus.io/quarkus3/`, `https://quarkus.io/guides/datasource/` and `https://quarkus.io/guides/transaction/`, checked on 13 November 2026. No precise Quarkus 3.x release, Java build or deployment artifact has been selected or tested by this draft.
