# GCSP implementation kickoff baseline — FUCQ-434

Observed 13 November 2026. The product baseline is **`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`** on `gcsp-poc-dev`, before migration implementation. `ff7ad0c4e` changes the launcher helper only; `ef21d7cb51b89293afc701784583e37e28cbbc0f` records the FUCQ-434 claim. Neither changes the frozen product. The earlier `23f6ce3313916f41264c3157d70188d79287d511` in Story cards is authoring evidence, not this freeze.

This is source and retained-artifact evidence. A route, provider implementation, screenshot or historic receipt does not establish a currently configured provider, deployed version, passing journey or accepted Story. Preserve the implemented behavior at the freeze, subject to the intentional identity changes below; unfinished backlog features remain separate. The [replacement contracts](migration-replacement-contracts-2026-11-13.md) and [canonical HLD](../design/gcsp-high-level-design.md) define the migration architecture.

## Reproducible evidence

[inventory.json](migration-baseline-2026-11-13/inventory.json) contains every method/path, route factory/custom handler, replacement Story and deliberate delta; SHA-256 and byte size for source, current visual references, local corpus/model/reference assets; all eight code-approved fleet release descriptors; workload defaults; and the stored comparison manifest. [collect.mjs](migration-baseline-2026-11-13/collect.mjs) imports route factories without starting services and streams file hashes. It does not connect to a database, invoke providers, restore a corpus, send mail or launch a browser. [validation.json](migration-baseline-2026-11-13/validation.json) records the scoped checks and resource cleanup.

The inventory has 26 route factories and **100 unique GCSP method/path operations**: 87 factory routes plus 13 custom identity, offer and vehicle-evidence/image handlers. `server/index.js` imports and registers those factories and invokes the custom handlers. `/health` and `/health/vehicle-evidence` are separate shared infrastructure reads, outside the 100. The list is finite; no public comparison cancel/restart operation is implied.

## Capability, view and replacement coverage

Source paths below are repository-relative. Each row identifies concrete implementation, not diagram status. The complete route enumeration and hashes are in the inventory rather than duplicated by hand here.

| Implemented capability / source | Observable behavior to preserve | Replacement Stories |
| --- | --- | --- |
| Hosting, shell, identity: `server/gcsp/host.js`, `identity/`, `blocks/gcsp/shell/`, `gcsp-login.html` | Session-gated page hosting, role landing, account navigation, brand context, direct/recovery entry and unavailable states; identity authority changes as recorded below. | FUCQ-435–439, FUCQ-454/455 |
| Account, driver/contract/terms, email and exact current car: `manual-context/`, `notify/delivery-email.js`, `blocks/gcsp/account/` | Server-owned account facts; Your Cars/current car; exact source/version; owned recipient setting; missing evidence remains unknown. | FUCQ-440/458/459 |
| Brief, preferences, feedback and engagement: `brief/`, `recommendation/`, `blocks/gcsp/brief/` | Draft versus confirmed versions, sliders and separate importance, Same again/feedback, preview, engagement prerequisites, save/discard/history and post-decline confirmed change. | FUCQ-441/460/461 |
| Manual setup and released-stock gallery: `manual-context/`, `manual-gallery/`, `blocks/gcsp/manual-setup/`, `blocks/gcsp/manual-gallery/` | Setup within Account, complete eligible stock, filters/detail and exact-car selection; browsing does not reserve. | FUCQ-440/442/458/459/462 |
| Claim, review and final handoff: `manual-claims/`, `manual-review/`, `manual-order/`, corresponding `blocks/gcsp/` modules | Exclusive versioned hold, pinned quote, explicit release/replacement, preview/review/declarations, deliberate submit and pending reconciliation. | FUCQ-443/463/468 |
| Evaluation and allocation: `recommendation/`, `allocation/`, `offers/buddy-hold.js`, `server/scenarios/employee/`, `server/recommendation/` | Exact candidates; eligibility/unknown gates before scores; deterministic global order and all fallback contenders; no gallery top-K cap; one authoritative manual/Buddy custody. | FUCQ-461/464; native FUCQ-409–418 |
| Buddy activity: `brief/activity.js`, `blocks/gcsp/activity/` | Current engagement and search health, last check/no match/offer outcomes; pause does not invent release or erase an existing offer. | FUCQ-444/460/464 |
| Offer access, decisions and follow-up: `offers/access*.js`, `decision*.js`, `followup*.js`, `blocks/gcsp/offer/` | Current owned offer, exact terms/details, accepted/declined/expired/stale state, reason policy, explicit local decision and follow-up; remote gap distinguished below. | FUCQ-445/465/466/467 |
| Approval/order progress: `lifecycle/approvals/`, `manual-order/`, `blocks/gcsp/order-progress/` | Acknowledged stages, review/order identity, actions and truthful pending/unavailable status. | FUCQ-446/468/470 |
| Documents, readiness, appointments, return: `lifecycle/documents/`, `appointments/`, `return-plan/` | Owned documents/actions, supported requested/confirmed appointments and separate old-car plan/outcome; planning alone completes no physical event. | FUCQ-446/471/472/473 |
| Help and renewal cases: `cases/`, `blocks/gcsp/help/`, `blocks/gcsp/case-queue/` | Employee-owned request; Greg queue, options and explicit remedy/update; no hidden allocation priority change. | FUCQ-447/474 |
| Greg demand/policy: `greg/`, `greg/publish/`, `policy/`, `blocks/gcsp/greg/` | Saved-demand aggregation/privacy, unmet constraints, supply and outcomes; preview then intentional versioned publication; retained quotes stay explainable. | FUCQ-448/457/475 |
| Prediction and next-order plan: `predict/forecast/`, `predict/plan/`, `predict/learning/` | Retained model inference versus deterministic baseline, evidence/uncertainty, constraints and feasible plan; preview does not submit. Offline training remains separate. | FUCQ-449/476/477 |
| Supply and Production: `supply/`, `stock/`, planning submit routes | Exact release/pull identity, intentional Production request, response-driven tracking and replan. Absent providers remain unavailable. | FUCQ-449/462/478 |
| Clock, scenarios, presenter release/controls/suitability: `clock/`, `scenarios/`, `presenter-*/`, `blocks/gcsp/presenter/` | Advance and tick separate; named preparation/reset, release, controlled faults/retry, suitability and inspection. Presenter authority narrows below. | FUCQ-450/479 |
| Notifications/outbox: `notify/`, `blocks/gcsp/outbox/` | Atomic intent after business state, capture and configured real transport, retry/result, filtering and navigable delivered offer link. Captured does not mean delivered. | FUCQ-451/469 |
| Comparisons: `comparison/`, Greg/comparison UI | Stored process/results reads, supported start/rerun/latest job progress and interrupted/failed states; isolated simulation state and captured mail only. | FUCQ-452/480 |
| Evidence/provider composition: `vehicle-evidence/`, `server/vehicle-evidence/`, `manual-context/ports.js`, `stock/port.js`, `notify/port.js` | Exact configuration/stock/VIN/image identity and provenance, explicit transport/capability failure, deployment-selected replaceable providers. | FUCQ-459/481 |
| Repository/policy/receipts: `repository/`, `policy/`, `runtime.js` | Durable versioned domain state, command/event receipts, custody, uncertainty, outbox, restart and run isolation; no silent PostgreSQL-to-memory fallback. | FUCQ-456/457; native FUCQ-419–425 |
| Retirement, routing and deployment: `server/index.js`, `render.gcsp.yaml`, root GCSP pages, `scripts/assemble-site.mjs` | Independent Angular/API outputs and final fresh-state switch after parity; preserve Used Cars/shared consumers. | FUCQ-435–438/453/454/482 |

`server/gcsp/` prefixes backend paths in the table unless explicitly shown otherwise. Registered APIs can refuse because a provider, source, role, current version or capability is absent. In particular, the existing remote offer decision path does **not** implement remote accept/decline completion; FUCQ-467 supplies that separately. Manual claims and Buddy holds already have remote execute/reconcile seams (`manual-claims/index.js`, `offers/buddy-remote.js`), which must not be discarded in a new transport wrapper.

## Pages and route ownership

The freeze includes 17 root GCSP HTML files. Hosted `host.js` maps protected live pages and the login/offer aliases; other files also support local fixture/harness entry. A fixture page is not evidence that it is a hosted capability. Angular owns the replacement routes and screen controllers, including manual panes currently embedded in Account.

| Frozen entry files | Replacement surface / Stories |
| --- | --- |
| `gcsp-login.html` | `/gcsp/sign-in`, `/gcsp/auth/callback`; FUCQ-439/455 |
| `gcsp-account.html`, `gcsp-manual-setup.html`, `gcsp-manual-gallery.html` | Account/Your Cars, setup and stock panes/routes; FUCQ-440/442 |
| `gcsp-employee.html`, `gcsp-brief.html`, `gcsp-brief-live.html` | Preferences/editor within employee journey; FUCQ-441 |
| `gcsp-activity.html`, `gcsp-activity-live.html` | Activity; FUCQ-444 |
| `gcsp-offer.html` | Owned `/gcsp/offers/:offerId` and manual review/summary where applicable; FUCQ-443/445 |
| `gcsp-order-progress.html`, `gcsp-order-progress-live.html` | Orders/progress/documents/appointments/return; FUCQ-446 |
| `gcsp-help.html`, `gcsp-case-queue.html` | Help and Greg cases; FUCQ-447 |
| `gcsp-greg.html` | Greg demand/policy/planning/Production/comparison; FUCQ-448/449/452 |
| `gcsp-presenter.html`, `gcsp-outbox.html` | Presenter controls, allowed inspection/outbox; FUCQ-450/451/452 |

The exact HTTP operation mapping is `routes[]` in the inventory, including methods, factory, source, replacement namespace and Story. Replacement business APIs use `/api/gcsp/v1`; old GCSP URLs/API aliases need not remain compatible. This does not remove existing Used Cars links, routes, API/export contracts or supported shared launcher handoffs.

## Jobs, ticks and workloads

No unattended scheduler is assumed. `server/index.js` registers clock consumers and `clock/index.js` orders stage first, then stable handler ID. Canonical `seed-v1.json` specifies stages `release-pull → manual-expiry → buddy-expiry → pending-reconciliation → buddy-allocation → outbox-dispatch`. Startup runs only expiry and pending reconciliation stages; it does not pull new stock, allocate new offers or dispatch new mail.

| Handler identity | Source / behavior | Replacement |
| --- | --- | --- |
| `stock-release` | `stock/index.js`: explicit pull and release visibility | FUCQ-462 |
| `manual-claim-expiry` | `manual-claims/index.js`: expire manual custody | FUCQ-463 |
| `buddy-expiry`, `buddy-pending-operations` | `offers/buddy-hold.js`: expiry and uncertain custody reconciliation | FUCQ-464 |
| `selection-order-reconciliation` | `manual-order/index.js`: same pending handoff identity | FUCQ-468 |
| `lifecycle-approvals`, `lifecycle-documents` | `lifecycle/approvals/index.js`, `lifecycle/documents/index.js` | FUCQ-470/471 |
| `lifecycle-appointments`, `lifecycle-return-appointments` | `lifecycle/appointments/index.js`; return-plan `start()` registers return consumers | FUCQ-472/473 |
| `lifecycle-return-outcomes` | `lifecycle/return-plan/outcomes.js`: authoritative physical outcome | FUCQ-473 |
| `renewal-risk-cases` | `cases/index.js`: keyed renewal trigger | FUCQ-474 |
| `buddy-allocation` | `allocation/index.js`: all valid contenders, authoritative claim | FUCQ-464 |
| `captured-outbox` | `notify/index.js`: selected transport dispatch | FUCQ-469 |

Comparison jobs are separate explicit workers (`comparison/jobs.js`, `worker.js`, `job.js`), with persisted job status, timeout, latest progress/result and restart interruption. Supported experiments are `process-only`, `order-mix`, `points`, `hold-sweep` (`comparison/experiments.js`). Existing permissions allow presenter job start; replacement allows Greg commands and presenter reads. Runtime jobs/inference move to Java; offline corpus generation and model training may remain JavaScript.

Preserve these bounded cases using existing scenarios/tests rather than a new generic framework:

| Case / existing evidence | Required equivalent observation |
| --- | --- |
| `scenarios/main-successful-journey.js`, `server/test/gcsp-scenario-main-journey.test.js` | Real sign-in → account/preferences/Buddy → release/offer → delivered test email → owned decision → order/progress, local substitute first, then remote transactional substitution. |
| `decline-then-change.js`, `offer-expires.js`, `no-suitable-match.js`, `data-unavailable.js`, `uncertain-handoff.js` under `scenarios/` | Decline then deliberate saved change; expiry; truthful no-match; source unavailable/retry; pending/uncertain handoff, same operation after restart. |
| Manual claims/order/lifecycle existing service and HTTP cases | Exact-car conflict, stale writer, replay, rollback, exclusive slot/car custody, review/declarations and explicit submission; documents/appointments/old-car outcome. |
| Greg planning, policy and Production scenarios | Preview/read separate from publish/submit; pinned historic quote survives activation; confirmed response drives supply. |
| Default comparison policy | 1,000 employees, seeds `comparison-a/b/c`, 90-day horizon; supported six-step default request and experiment variants, complete result/provenance and bounded worker resources. |
| `docs/gcsp/evidence/fucq309/canonical512-2026-11-10/report.md` | Historic Node default qualification: 1,721.492s, 422.10MiB sampled worker heap, 874.11MiB worker RSS, 900.11MiB supervisor group RSS. Java/hosted measurements remain required; these numbers select no Render tier. |
| `stock/run-stock-generation.js`, retained demo-fleet | Generation uses the selected 240-configuration demo corpus covering seven scheme model lines; do not substitute the larger source count for this workload. |

Historical Node job defaults are 1,800s timeout, 512MiB old generation and 16MiB young generation. They are policy assumptions, not Java heap requirements or a hosted capacity guarantee. The replacement must prove these scenario/comparison sizes with a few simultaneous demo users and actual measured resources. All 17 FUCQ-409–425 native Node contracts remain required on their own paths; Java does not waive them. See [database alignment](database-refactor-migration-alignment-2026-11-13.md) and the replacement persistence contract.

## Retained identities and visual references

The inventory streams hashes of the locally present corpus records, pointers, version manifests and assets, including `identity-inventory.json`, selected/previous versions, source registration records, image files and policy/reference source. It records code-approved remote release descriptors separately. Content identities below are manifest/artifact identities; a raw file hash can differ from its canonical payload digest.

| Retained item | Exact identity / boundary |
| --- | --- |
| Local `demo-fleet.v1` selected | `7c9cc707ab44b36f9cb5eb64b54170b25d914d5ee7e31722384c737612c45a9c`; dataset `gcsp-demo-fleet`, version `2026-11-08.1`; 240 configurations, 2 image records, 0 VINs. Default stock-generation input. |
| Local `fleet-source.v1` selected | `28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884`; version `2026-11-07.9`; 2,425 configurations, 2,424 qualifying source configurations, 2 image records and 1 VIN. Previous selection remains identified by the pointer/inventory. |
| Local `lookup-reference.v1` selected | `c1f8040107f03fa1c25e88d23065bdef3f92a55ca086cd1894655a6c0b0b1709`; 2 configurations, 1 VIN, 0 images. Demo enrichment/publication-reference manifests and source inputs are also hashed. |
| Render blueprint fleet release pin | `3b2a883cd85a2d0c3f89e36e14561d15996affec972e19bbba0d962cf79cce30`, version `2026-11-07.12`; 31 declared assets totaling 574,382,841 bytes. Descriptor/asset digests are retained from `fleet-releases.json`; this task did not download/restore that release or verify which revision is deployed. |
| Choice model artifact | `sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d`, in `docs/gcsp/models/artifacts/`; raw file SHA-256 `a2ee4271a91a2a02182fa9d5797acd7723a9bc776207aad19f5190cb223ddd86`. Feature `vehicle-preference-v1`; recorded activation command uses `fucq115-trained-choice-v5`. Retain the artifact and activation evidence, not an assertion of currently active hosted policy. |
| Policy/reference versions | Full `server/gcsp/policy/` source and reviewed versions are hashed. `seed-v1.json` provides canonical assumptions through PolicyService; the reviewed FUCQ-115 seed initially declares the model unavailable. Actual active/pinned policy is run state, not inferred from a committed artifact. |
| Stored baseline comparison | `server/data/gcsp/comparison/process-only.json`: raw SHA-256 `c2175ec4fbb762a27c42e94d8e720732c7757062cfb25005739ebae0c26de0a5`; result digest `d388e3371ea4a7f3c3665102e9452e7ccd0940b685b64fa2d623e7e47a3f3027`; manifest code revision `669fbc2f`, policy `gcsp-policy-v1`, generator `comparison-inputs.sha256.v1`. Its complete policy/input/seed identities are retained in the inventory. New Java outputs get their own code/runtime provenance. |
| Shell and palette | Eight supplied images and `docs/gcsp/screens/README.md`, all hashed; preserve slim portal header, icon sidebar, neutral/teal tokens, with current consumer body design. |
| Account/preferences body | Approved reference commit `193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5`, `docs/gcsp/mockups/account-preferences-2026-11-10/`; current freeze and COMPONENTS include later Your Cars/Buddy/Same again/notification decisions. Current implementation governs those later details. |
| Offer body/details | `docs/gcsp/mockups/vehicle-offer-2026-11-11/`, focused-offer and style-alignment evidence; current COMPONENTS approved Option B at `docs/gcsp/mockups/offer-details-2026-11-12/` (480px details drawer, specification/equipment tabs and focused title spacing). Current implementation and COMPONENTS supersede stale proposal wording in historical mockup README. All named files are hashed. |
| Canonical diagram | `docs/design/high-level-design.drawio` is hashed unchanged. Historic Node/custom-element/proposed-state labels are not current migration authority or proof of delivery; the canonical HLD text reconciles them. No new diagram render is claimed. |

Unapproved 13 November Greg concept screens are proposals, not this baseline. FUCQ-434 changes no screen, CSS, component or business behavior, so no new browser/visual pass is claimed. Later implementations still need the experience contract's actual desktop/narrow, keyboard, Safari/private, CSP/accessibility and state evidence.

## Intentional identity and state changes

| Frozen authority / state | Agreed replacement |
| --- | --- |
| Demo login/session cookies, presenter-created control session and principal switch | Real test OIDC browser login; bearer JWT signature/issuer/audience/lifetime validation; trusted subject→roles/employee mapping and server-owned environment/run. Employee and Greg use their own logins. No presenter impersonation. |
| Offer token/cookie may resolve offer authority | New email URL requires sign-in/return and employee ownership; opaque link material confers no authority. Saved progress survives supported renewal/sign-in recovery, with explicit order confirmation. |
| Presenter can initiate comparison jobs and issue acting-person commands | Presenter controls clock/releases/scenarios/reset/faults/retry and permitted read inspection only. Greg retains comparison start/rerun and business commands. |
| Legacy operational employee/scenario state, sessions, active offers/orders, old links, operational learning/comparison history | May reset at the final authorised switch. Corpus, policy/reference versions, reusable model and agreed baseline comparisons remain retained. |
| Replacement app state and newly issued links | Survive ordinary compatible deploys/restarts; receipts, pending operations, ownership and run scope remain durable. Dev reset never targets the running database; stale old-run work cannot mutate a new run. |

Exact stock remains `orderUuid`; `configurationId` identifies shared immutable configuration (retained encoding/provenance); VIN is for delivered/current cars. Equal configurations do not merge distinct cars. Historic IDs/digests remain evidence; new runtime/run/subject identities are explicitly recorded rather than fabricated to match old operational state.

## Used Cars and delivery boundaries

`blocks/vehicle-matcher/`, the retail `server/index.js` routes, `server/engine.js`, `server/scenarios/retail/`, `server/recommendation/`, shared UI consumers, `blocks/demo-launcher/`, retail `render.yaml` and their brand/link contracts remain supported. GCSP migration does not convert or retire retail JavaScript/Node. Shared computation may be ported for GCSP parity while retail keeps its existing contract. FUCQ-453/482 retire only replaced GCSP frontend/runtime after coverage, provider and cutover evidence.

The architecture ownership lanes are proposed directories `apps/gcsp-web/` and `services/gcsp-api/`; dispatcher-confirmed file ownership/leases govern parallel work. Render/root build/launcher/assembler/shared kit/schema files require a named writer. The separate dev environment/database is Gary's provisioning responsibility. FUCQ-434 does not provision, deploy, reset, run external acceptance, change native ACs or mark acceptance from this inventory.
