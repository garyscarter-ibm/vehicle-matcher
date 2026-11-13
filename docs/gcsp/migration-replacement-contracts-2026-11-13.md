# Replacement application contracts — FUCQ-434

Engineering contract for the authorised 13 November 2026 migration. This records responsibilities and interfaces for implementation; it does not assert that Angular, Java, OIDC, a database or a deployment has passed acceptance. The [kickoff baseline](migration-baseline-2026-11-13.md) identifies the source of each capability. Existing Story acceptance remains fixed.

## File ownership and first connected increment

| Area | Named delivery owner / files | Boundary available for independent work |
| --- | --- | --- |
| Architecture | FUCQ-434: this record, baseline/evidence and `docs/design/gcsp-high-level-design.md` | Capability, API, identity, provider and persistence contracts below. No application changes. |
| Angular foundation | FUCQ-439: new `apps/gcsp-web/` | Angular 21 owns shell, router and views; calls the context endpoint below. Adapt existing framework independent tokens/components in the consuming Story. |
| Java foundation | FUCQ-454: new `services/gcsp-api/` | Java 21/Quarkus 3.x JVM artifact, readiness and context boundary. Establish exact package/build versions here; no Node runtime invocation. |
| Identity | FUCQ-455, coordinated with FUCQ-439: Java identity package and Angular authentication service | Test-provider browser login plus JWT validation; owner allocates exact files after foundations exist. |
| Persistence | FUCQ-456: Java repository package and its new migrations | Scoped SQL/transactions described below; one migration writer. No editing Node migrations as preparation. |
| Shared integration | Dispatcher assigns one writer for `render.gcsp.yaml`, root build/package files, `scripts/assemble-site.mjs`, launcher handoffs, shared kit/catalogue/ratchet and any machine-readable API schema | FUCQ-435/436/437 coordinate these against actual Angular/Java outputs. Workers request a named lane before touching shared files. |
| Native performance | FUCQ-409–425: their existing Node file scopes | Coordinate overlapping `allocation`, `recommendation`, `policy` and `repository` files. Record the reference revision used by Java parity cases. No Java-only waiver. |

Directory ownership is a starting lane, not perpetual ownership of every later file. The dispatcher records each narrower assignment before parallel work. The architecture Story leaves existing sources/contracts/artifacts read-only. FUCQ-439 and FUCQ-454 may start against this contract without waiting for inventory prose polish; their hosted/login acceptance still requires actual integration and external setup.

Delivery order is foundation → real sign-in/account → Buddy matching → real test email → signed-in employee-owned decision → order/status using local substitutes; remaining capabilities and remote transactional proof follow. FUCQ-467 and FUCQ-481 complete the remote boundary before final migration acceptance. There is no interim human checkpoint.

## Browser and API surface

Use a versioned replacement namespace `/api/gcsp/v1`. The static host owns `/gcsp/` routes: `sign-in`, `auth/callback`, `account`, `preferences`, `stock`, `manual/review`, `manual/summary`, `activity`, `offers/:offerId`, `orders`, `help`, `greg`, `greg/cases`, `presenter`, `presenter/outbox`. Greg planning, Production tracking and comparisons remain sections/routes of Greg's application; presenter comparisons are inspection only. A new emailed link targets `/gcsp/offers/:offerId`; optional opaque lookup material does not confer authority. Concrete parameter encoding and deep-link fallback are FUCQ-437/465 implementation evidence. Legacy GCSP aliases are unnecessary. Used Cars routes and brand handoffs remain supported.

`GET /api/gcsp/v1/context` is the first shared application endpoint. It requires a valid bearer access JWT. Success is JSON:

```json
{"status":"ok","value":{"subject":"test-provider-subject","roles":["employee"],"environmentId":"isolated-dev","runId":"server-current-run","employeeId":"server-mapped-id","policyVersion":"retained-version","capabilities":["account:read"]}}
```

`employeeId` is present only for an employee mapping. IDs and role names above are illustrative; the server resolves them from trusted issuer/subject mappings and active environment/run state. Role checks remain authoritative even when capabilities hide UI controls. This projection contains no token or credential. Unknown mappings return a typed refusal, never a synthetic employee fallback. FUCQ-455 defines and proves the selected test registration and exact claim mapping; BMW claims remain unknown.

For the remaining inventory operations, the initial replacement rule is **same method and semantic suffix under `/api/gcsp/v1`**, with the following deliberate changes. This gives every current route a replacement without promising legacy compatibility:

| Operation family | Replacement / responsibility | Story |
| --- | --- | --- |
| Legacy session login/logout/switch/principals | Real browser OIDC login/logout replaces password/cookie endpoints. No principal-switch endpoint. Context uses the endpoint above. | FUCQ-439/455 |
| Account and manual context | `/manual/account`, draft save/discard, released stock; server-owned employee/driver/contract/evidence projections. Notification email remains an owned account update. | FUCQ-440/458/459 |
| Brief/editor/preferences/feedback | `/brief/*` semantic operations including preview, confirm, engagement, history and one confirmed change after decline. Drop old `/brief/pause` and `/brief/resume` aliases in favour of explicit engagement/search operations. | FUCQ-441/460/461 |
| Manual claims/review/order | `/manual/*` with exact stock, current versions, declarations and deliberate submit/reconcile; preview and review remain distinct from final handoff. | FUCQ-442/443/463/468 |
| Buddy activity/recommendations | Existing activity/recommendation semantic reads; release-driven calculation and holds remain backend work. | FUCQ-444/461/464 |
| Offer entry/decision/follow-up | `/offers/:id`, decision reasons, explicit decision and supported follow-up. Remove link-only `/offers/access` session authority; all reads/commands require login and employee ownership. | FUCQ-445/465/466/467 |
| Orders/documents/appointments/return | Existing semantic reads/actions under v1; source acknowledgement drives actual state. Planning does not complete a physical event. | FUCQ-446/470–473 |
| Help and scheme-team cases | Owned employee reads/requests and Greg queue/options/update. Service checks ownership and remedy permission, regardless of route guard. | FUCQ-447/474 |
| Greg demand/policy/planning/orders | Existing reads, preview/publish, constraints, intentional submit and Production tracking. Preview never submits; active quote pins survive new policy activation. | FUCQ-448/449/457/475–478 |
| Presenter clock/scenarios/controls/releases/suitability/production | Dedicated presenter role; reset, release, faults/retry and allowed inspection only. Production stepping is a scenario control, never Greg request submission. | FUCQ-450/479 |
| Notification/outbox | Employee owns their recipient setting; presenter inspection/filtering; configured transport owns delivery. No browser transport credentials. | FUCQ-451/469 |
| Comparison | Existing process/results/job reads for Greg/presenter; POST job start/rerun for Greg only. No public cancel/restart endpoint exists to port. | FUCQ-452/480 |
| Vehicle evidence and image reads | Exact configuration/stock/VIN/image identity and provenance through Java provider/asset projection. Signed-in application access, with any public published image delivery explicitly configured. Never submit synthetic identity to live decoders. | FUCQ-459/481 |

The source route inventory records aliases and conditional availability separately. A registered HTTP route is not proof that its provider is configured or that its business operation succeeds. Follow-up implementation may refine payloads additively with the owning frontend/API Story, preserving business meaning and fixed acceptance. Record that revision with each parity case.

## Requests, errors and recovery

Reads return `{status:"ok",value:...}`; an absent optional projection can retain its documented empty value. Commands include a nonempty `commandId` and the relevant expected versions; the resolved environment/run/subject is never accepted as authority from request fields. A command ID is scoped to the resolved environment/run and actor; same ID plus changed canonical input refuses with conflict. Mutating operations must not be automatically replayed merely because authentication was renewed.

All responses are JSON, except explicitly documented image/binary endpoints. Typed non-success outcomes preserve `status`, stable `code`/`reason`, `retryable`, field `reasons`, current version/action hints and, where applicable, durable `operationId`. Do not leak tokens, private upstream errors or another account's facts. HTTP mapping:

| HTTP | Result semantics / browser handling |
| --- | --- |
| 200 | Confirmed read or command result; a terminal offer read reports its actual state. |
| 202 | Pending/uncertain external operation with stable operation identity; inspect/reconcile status instead of inventing success. |
| 400 | Invalid payload/query/identifier or declared validation failure; retain edits and show field correction. |
| 401 | Missing, invalid or expired bearer token; renew if supported, otherwise sign in and return to the authorized page. |
| 403 | Authenticated role/ownership refusal; stop the action and provide a truthful denied state. |
| 404 | Unknown route/resource, subject to a consistent privacy policy for inaccessible offer IDs; never HTML fallback. |
| 409 | Stale run/version, conflicting command or lost exact-stock authority; refresh authoritative state and require deliberate reconfirmation. |
| 422 | Explicit unsupported provider operation/identity capability; no fallback to successful synthetic execution. |
| 503 | Provider/repository unavailable or invalid required evidence; preserve known pending custody and useful retry advice. |
| 500 | Unexpected server failure; correlation reference and bounded safe message. |

Renewal failure must preserve saved server progress and safe return location. Unsaved input restoration may use browser state only after separating accounts; never persist access credentials in public configuration. Sign-out clears application authentication and uses provider logout where supported. Another account cannot inherit prior private application state. The API validates signature, issuer, audience and lifetime, then roles and resource ownership; a frontend guard is only navigation.

## Providers and application authority

Providers are selected at deployment/startup. Separate upstream authentication, transport, field mapping and source errors from domain decisions. Each result carries source mode, schema/version, observation/effective time, identity scope and completeness/unknowns. `not-found`, `unsupported`, `invalid`, `unavailable`, pending and refused are distinct. No silent synthetic fallback or hard-coded employee outcome is permitted.

| Port / current evidence | Provider responsibility | Application responsibility / Java owner |
| --- | --- | --- |
| Identity (`identity/`, `manual-context/ports.js`) | Real issuer/subject claims and supported logout/renewal; mapped employee/contract/driver facts | Authorization, environment/run context and ownership; FUCQ-455/458 |
| Policy (`policy/index.js`, file/PostgreSQL providers) | Retained dated tables/source records | Single PolicyService for eligibility, allowance, points and assumptions; activation and pinned versions; FUCQ-457 |
| Employee/contract/driver/current car/usage (`manual-context/ports.js`) | Provenance-linked account facts and explicit absence | Account projection, practical gates, employee edits and privacy; FUCQ-458 |
| Configuration/specification/imagery/VIN/handbook (`vehicle-evidence/`) | Exact retained artifacts or authorised source mapping, no synthetic ID leakage | Identity/provenance validation and bounded projection; FUCQ-459 |
| Released stock/supply (`stock/`, `supply/`) | Exact stock/revision/source events, confirmed supply and supported pull | Deduplication, release visibility and stock state; FUCQ-462 |
| Manual/Buddy claim and release (`providers/`, `adapters/manual-stock.js`, `offers/buddy-remote.js`) | Explicit execute/reconcile acknowledgements and authoritative custody | Eligibility, versions, exclusive employee/slot/car authority and durable intent; FUCQ-463/464 |
| Offer decision (`offers/decision.js`, `buddy-remote.js`) | Supported remote accept/conversion/decline/release acknowledgements | Owned explicit decision, pinned terms, current guards, one follow-up/handoff; FUCQ-466/467. Remote decision remains a known missing Node capability, not an already delivered success. |
| Ordering/status (`adapters/synthetic-ordering*.js`) | Durable provider request/status references and actual acknowledgements | One manual/Buddy conversion path, declarations, pending intent and reconciliation; FUCQ-468/470 |
| Documents/readiness (`lifecycle/documents/`) | Available documents and supported acknowledgement capability | Required gates, owned tasks and truthful readiness; FUCQ-471 |
| Appointments/handover (`lifecycle/appointments/`) | Availability, request/confirmation and supported outcomes | Readiness/ownership, requested versus confirmed versus completed; FUCQ-472 |
| Return outcomes (`lifecycle/return-plan/`) | Separate old-car plan and supported physical outcome | Current-car relationship changes only at authoritative outcomes; FUCQ-473 |
| Mail (`notify/transports/`) | Configured capture/Brevo or another authorised transport with actual delivery outcome | Message/recipient/content after committed state, retry, secure offer URL and outbox; FUCQ-469 |
| Production (`supply/synthetic-production.js`) | Request/response shapes, quantities and supported confirmed supply | Greg intentional submission, version checks and response-driven replan; FUCQ-478 |
| Models/comparison (`predict/`, `comparison/`) | Retained immutable model/baseline artifacts; offline preparation allowed | Java inference, planning, runtime jobs and new-run provenance; FUCQ-476/477/480 |
| Scenario preparation (`scenarios/`, fixtures) | Explicit isolated demo seed/preparation only | Separate from provider composition; non-demo configuration does not seed fictional users/data; FUCQ-479/481 |

Paths in this table are relative to `server/gcsp/`. Existing provider descriptors and protocol coverage are indexed in the baseline; implementation must credit those seams. FUCQ-467 must settle actual remote acknowledgement/custody/compensation semantics with its selected substitute before implementation; this record does not invent BMW write capabilities. Persist intent before external I/O, retain exclusive custody for unknown responses, reconcile by the same operation ID, and distinguish original receipt from later operation status. Late old-run acknowledgements cannot mutate new-run authority.

## Persistence contract for FUCQ-456

Use PostgreSQL as authority, an isolated dev connection and a fresh versioned Java schema. Every mutable domain row and durable command/event/job identity is scoped by environment and run; exact car uses `orderUuid`, shared immutable configuration uses `configurationId`, and VIN identifies delivered/current cars only. Retain the established configuration encoding/provenance pending real BMW confirmation. Never confuse two stock cars sharing one configuration.

Use explicit selected SQL reads and transactional writes for the affected aggregates. Small commands must not default to whole-run hydration/fingerprint/diff. Implement optimistic version conditions plus database uniqueness for active exact-car custody and the relevant employee/entitlement occupancy. A transaction atomically commits domain changes, command receipt, event/outbox intent and a monotonic run revision. Failure rolls back all of them; a no-op must not manufacture a mutation. Cache/projection freshness, if used, must follow authoritative revision checks and must not mask a competing instance's write. These are Java design choices meeting the current semantic obligations, not a claim that the Node revision/journal Stories are delivered.

Read the original receipt before repeating an operation. Same command/input returns the original committed result; changed input refuses. For an uncertain commit, inspect the receipt/current durable operation before another submission. External I/O stays outside the database transaction, with durable intent and compare-and-set finalization; timeouts/malformed or mismatched acknowledgements remain pending, retaining custody. SQL transaction rollback remains required despite the accepted absence of old-deployment rollback rehearsal.

Reset retires one run and activates another atomically. It does not delete immutable corpus/reference/model/baseline artifacts, reset the running deployment's database or let stale work acquire new-run authority. Ordinary restart retains replacement-app state, receipts, pending work and new offer references. Legacy operational state may reset only at the agreed final switch. Validate actual database/environment identity before reset; configuration names alone do not prove isolation.

| Native performance contract | Java design alignment / evidence retained |
| --- | --- |
| FUCQ-419 → 420 | Indexed bounded trigger/receipt reads; pending-first/new-or-changed consumption with digest/replay checks. No repeated full history by default. |
| FUCQ-421 | Transactional run revision for reliable freshness; authoritative queries may replace the Node cache mechanism. |
| FUCQ-422 → 423, both → 424 | Explicit mutation operations/SQL update sets, rollback/no-op/replay semantics and scoped small-receipt state. No generic partial-domain hydration or deletion feature is added. |
| FUCQ-425 | Batch immutable evidence retrieval with digest-count and byte bounds; independent of mutation/revision chain. |
| FUCQ-409–418 | Exact-ID/history/occupancy lookup; immutable policy/evidence reuse and compact evaluation boundary. Preserve all candidates, gates, ties and displayed outcomes; FUCQ-417 precedes 418. |

All 17 native Stories remain required on their authored Node paths in this combined run, with original acceptance and live claims intact. Completion of the entire Node refactor is not a migration gate. FUCQ-456 and transactional consumers need native PostgreSQL commit/rollback, failed versions, competing instances, exclusivity, replay, uncertain commit/restart and reset-isolation evidence. Source inspection and doubles do not satisfy those checks.

## Deployment and pending platform inputs

One repository and one Render blueprint define independently buildable/releasable static Angular and Java API artifacts. Keep Used Cars' Node backend, assets and retail deployment supported. Do not edit or trigger the running `gcsp-poc` environment during development. Gary creates the separate dev environment/database and performs the eventual `gcsp-poc` merge after hosted-dev review. No paid tier or domain is selected by this contract.

Deployment supplies public API base URL, OIDC issuer/client/scopes/callback/logout settings and environment identity separately from compiled Angular bundles. No static client secret, database credential or mail key. Java receives database, provider/auth, allowed origins and mail configuration externally. Exact-origin CORS permits required preflights/Authorization headers; credentials are bearer JWTs. Prove HTTPS callbacks, direct entry, API errors distinct from SPA fallback and real emailed return links on the actual chosen hostnames. Changing public configuration must leave compiled Angular bundle hashes unchanged.

Supplied target constraints: Angular 21, Java 21, Quarkus 3.x, bearer access JWT, Render interim delivery, PostgreSQL, existing CSP/browser/accessibility/visual requirements. Precise compatible versions/build tools are foundation work. No further BMW build/deployment standards have been supplied in the read project records. Concrete unknowns: BMW design-system/package availability; Java/Angular build and container conventions; ingress/proxy/base paths; issuer/JWKS/client/audience/claims/scopes/roles, logout/renewal; service authentication, endpoint schemas and transactional custody/acknowledgement; database naming/migration/secret conventions; approved artifact storage/egress; mail sender/recipient/permissions; telemetry and production accessibility/CSP rules. Record and reconcile supplied standards without inventing compliance.

Hosted proof covers the existing scenario/comparison workloads with a few simultaneous demo users and measured resources. Real test OIDC and actual agreed-recipient email are required for local and remote connected proofs. Live BMW activation, deployed-origin checks, chosen paid resources and Gary's final switch remain unrun external work for their own Stories. No application test, browser rendering, send or deployment occurred in authoring this contract.
