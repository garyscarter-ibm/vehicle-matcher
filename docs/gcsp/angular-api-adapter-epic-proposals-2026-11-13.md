# Static Angular frontend and replaceable service adapters — Epic proposals

Gary's refinement request, 13 November 2026. **Draft for discussion; no Jira items published and no implementation started.** Jira writes remain paused. These proposals preserve existing Story contracts, claims and acceptance decisions.

The intended outcome is a GCSP experience delivered as a static Angular application, calling a separately deployable backend API whose external dependencies can be replaced through explicit adapters.

## Recommended boundaries

| Proposed Epic | Outcome | Completion question |
| --- | --- | --- |
| **E1 — Run GCSP through an independently hosted frontend and backend API** | Restore the planned deployment and responsibility split while retaining working sessions and journeys. | Can we publish the frontend separately, with all application data and actions crossing the API boundary? |
| **E2 — Deliver the GCSP experience in Angular** | Angular owns the application's screens, navigation and presentation state, preserving the existing experience and behaviour. | Can employees, Greg and the presenter complete the existing supported journeys in the Angular application? |
| **E3 — Replace external service providers without changing the GCSP experience** | Dedicated backend adapter contracts isolate external data and operations; replaceable providers use the same application services. | Can we change provider implementations through composition, with contract and journey evidence showing the application still works? |

Keep these as three bounded outcomes. A static/API split can work before Angular, and an Angular migration alone would not establish replaceable external services. Implement through small connected journeys rather than three large rewrites. This document proposes Epic-level acceptance; implementation Story slicing and estimates follow refinement.

**Confirmed by Gary, 13 November 2026:** the migration covers **GCSP only**, and **Angular owns the frontend**, including screens and navigation. Existing custom elements may support the migration. Used Cars remains a separate consumer of shared assets and logic, with its existing frontend and behaviour preserved. These two scope decisions do not constitute acceptance of every proposed criterion below.

## The claim we should be able to demonstrate

> The Angular frontend obtains application data and performs business actions through our backend API. Every external system dependency sits behind a dedicated backend adapter contract. Our demonstration uses synthetic or recorded providers where live services are unavailable. A conforming live adapter can replace a provider without changing the frontend or core application logic, provided the live service supplies the required data and capabilities.

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

**Boundary:** no new backend language, microservices, repository split, database migration or Cloudflare move. This Epic preserves existing behaviour; it does not absorb performance tuning or new product features.

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

## E3 — Replace external service providers without changing the GCSP experience

**Intent:** As the team integrating GCSP, we can connect an authorized external service by implementing its adapter and configuring the backend, while preserving the Angular API contract and the application's existing decision logic.

### decided / proposed scope

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

### acceptance

1. Every in-scope external read, action and event path is mapped to a backend port and selected adapter. Direct upstream calls, fixture imports and demo seeding cannot bypass that boundary in a live configuration. Application-owned state and derived results are separately identified.
2. In-scope providers can be selected through backend composition without changing Angular components, public API payloads or core application services. The same services handle synthetic, recorded and conforming external inputs.
3. Each required port has contract evidence for its supported operations and relevant failure/capability states. Existing contracts cover identity, units, missing/stale facts, provenance and command/reference semantics as applicable; do not invent generic fields that no consumer needs.
4. A substitution demonstration replaces providers at the backend boundary and replays representative read-only and transactional journeys. Changed source inputs change the computed recommendations/results. Refused, expired or uncertain commands remain truthful, and retries/reconciliation preserve exclusive claims and avoid duplicate external actions.
5. The inventory distinguishes **synthetic implementation**, **recorded/source-backed evidence**, **contract-tested replacement** and **authorized live integration verified**. Two test providers can prove interchangeability, but cannot establish that an unavailable BMW service supports the contract. Actual live activation requires the relevant service's authorized access and positive integration evidence.

### validate

Reuse existing adapter, service, HTTP and journey checks. Exercise the actual runtime composition, not just constructors in isolation. Include at least an employee-context/stock-to-recommendation flow and a claim-to-order/status flow, plus the relevant failure/retry cases. For ports not used by those two journeys, retain focused contract evidence and an explicit coverage record. Keep fixture reset and synthetic-identifier protections isolated from any real integration. Contract mismatch or missing upstream capability is a recorded integration gap, not a passing mock test.

**Boundary:** this Epic establishes and proves replacement seams for existing capabilities. It does not commission every live BMW adapter, invent missing APIs, convert the backend to Java, migrate hosting to AWS or establish production readiness. Actual live integrations remain separately scoped capabilities, including the existing live catalogue/imagery work.

## Existing foundations and overlap

Observation baseline: `gcsp-poc` at `d4e9518ea`, 13 November 2026. These are code/document observations, not a fresh Jira status audit.

- [The static/API assessment](static-frontend-api-assessment-2026-11-13.md) identifies existing page hosting, mixed API transports, presenter-cookie setup and the 9 November same-origin decision. E1 supplies the remaining migration outcome. Its earlier 4–8 day indication excludes Angular migration and the adapter-completeness work; it is not an estimate for these three Epics.
- [Runtime composition](../../server/gcsp/runtime.js) already accepts identity/stock and other dependencies, but directly constructs synthetic manual-stock, ordering, status, document, appointment and return providers. [Manual context](../../server/gcsp/manual-context/index.js) has source-aware ports, with [scenario fixture preparation](../../server/gcsp/manual-context/fixtures.js). E3 should complete/select existing seams before proposing new ones.
- [The repository](../../server/gcsp/repository/index.js), [PolicyService](../../server/gcsp/policy/index.js) and [mail transport configuration](../../server/gcsp/notify/config.js) demonstrate that adapters have different purposes and evidence levels. Preserve existing authority and failure behaviour.
- [FUCQ-6 / the HLD](../design/gcsp-high-level-design.md) owns architecture agreement; [FUCQ-8](shared-recommendation-design.md) owns shared recommendation contracts; [FUCQ-13](fucq-12-stories.md) owns compatible entry/routing. [The vehicle-adapter map](bmw-interface-stories.md) retains FUCQ-14–20, including access-gated live catalogue/imagery. Reconcile overlap at Story authoring; retain their acceptance and avoid duplicate delivery claims.
- [Performance work](performance-tuning-stories-2026-11-12.md) and [new client capabilities](bmw-client-feedback-proposals-2026-11-12.md) keep their own scope. These migration proposals do not pick up their unfinished work or change product policy.

## Refinement and delivery order

Gary has confirmed GCSP-only scope and Angular-owned screens/navigation. Align the canonical [draw.io HLD](../design/high-level-design.drawio) and its existing design records with that delta before architecture rewiring. This proposal document is not a replacement HLD.

Use an initial connected slice to prove Angular sign-in/context against the separate API and the chosen HTTPS session arrangement. Continue by supported journey, sharing E1's transport work and E3's provider contracts. Provider inventory and backend contract work can proceed independently of screen migration where the interfaces already exist. Do not require completing every Epic before a coherent increment can be integrated.

Before Story pickup, agree the route baseline, target Angular/toolchain constraints, domain/routing topology and the required capabilities for each provider. Assess technical dependencies from actual interfaces under [the readiness policy](technical-readiness-2026-11-05.md); Jira links alone are not automatic gates. Capture any separate live-service access gap without making all mock-backed migration work depend on it.

Apply the [build rules](build-rules.md), [demo brief](demo-brief.md) and [experience contract](experience-quality.md) when refining Stories. Retain canonical policy, pinned quotes, backend permissions, durable state and the existing synthetic-data boundaries. No existing claimed Story's acceptance changes through this document.

## Authoring validation

Documentation-only work. Validation is local Markdown links, proposal/scope consistency and `git diff --check`; application tests, browser trials, deployed-origin checks and provider substitution runs are not performed for this draft. The acceptance sections describe future delivery evidence, not results achieved by authoring the Epics. No Jira writes, service provisioning, dependency installation, application-state changes or external messages are part of this work.

The draft's 21 local file links passed. A wider check of this document and the index checked 122 links and failed on seven existing index targets, all also missing at baseline `d4e9518ea`: `evidence/{fucq-6,fucq-79,fucq-86-90,fucq-110,fucq-132,fucq-74-75,fucq-13-19}/story-publication.json`, relative to `docs/gcsp/`. Expected: index links resolve to evidence files. Observed: those targets are absent in this checkout; the links are unchanged by this task. Provisional severity: Low, documentation navigation only; originating Story unresolved from this bounded check. Retain for separate reconciliation/repair; Jira Bug capture is deferred by the explicit write pause. This is not a passing whole-index check or a repaired defect.

Technical reference checked on 13 November 2026: Angular's official deployment guidance supports static client-rendered delivery and requires deep-link fallback configuration; its routing guidance requires server-side authorization in addition to client guards. References: `https://angular.dev/tools/cli/deployment` and `https://angular.dev/guide/routing/route-guards`. No Angular version has been selected by this draft.
