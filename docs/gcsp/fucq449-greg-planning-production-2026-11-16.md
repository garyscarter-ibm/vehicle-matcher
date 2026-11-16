# FUCQ-449 — Greg planning and Production

Updated partial delivery checkpoint for `DEV-2026-11-13-017`, 16 November 2026. **55 selected assertions passed in four admitted runs.** The guarded lazy `/greg/plan` registration is now present in source. Registered-route runtime coverage, rendered review and actual Java/OIDC acceptance remain unrun. Both original acceptance criteria remain unchecked; the Story stays In Progress and is not built.

The initial source-only checkpoints (`8c81c39e78b3fd4dbcad1a3e12616d3f4ed5094a`, then `e52c38753d7a0217ad54071be28b6b4d74daa561`) recorded 55 authored cases with zero executed at that time. The separately admitted runs below supersede that test status without erasing the initial checkpoint. This latest route/documentation increment admits no application runtime, tests, browser, service, dependency work or new scratch.

## Fixed scope

1. Forecast explanations, editable constraints, alternatives and infeasible/stale previews reflect current API inputs/results.
2. Deliberate submission, quantity/status tracking and replanning follow actual Production responses, including pending/refused outcomes.

The original allocation is the dispatcher's `fucq449-pickup-allocation-20261116-1634.json` observation of 16 November. It allocated 17 new files under `apps/gcsp-web/src/app/greg-planning/`, this record, its Story Result and the FUCQ-449 map row through `_tools/product_map.py`; the dispatcher initially retained shared integration. The dispatcher subsequently allocated only the additive `apps/gcsp-web/src/app/routes.ts` registration plus updates to this record and the Story Result. This increment preserves all peer routes and changes no map, catalogue, gallery, Java, authentication, shared kit, helper, build or dependency source. There is no shared merge, Jira update, claim or closure action.

The implemented body at kickoff `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`, particularly `blocks/gcsp/greg/plan/{panel,plan-view,plan-copy,element,http-adapter}.js`, is the parity reference. `docs/gcsp/screens/README.md` governs the shell/palette. The 13 November Greg concepts remain proposals. Current Angular primitives and semantic tokens carry the existing component language forward.

## Producer boundary

| Capability | Actual Java source and wire contract | Consequence |
| --- | --- | --- |
| Current plan | `GregOrderPlanResource`, `OrderPlanOperations`, `PlanningResponses`: `GET /api/gcsp/v1/greg/order-plan`; `{status:"ok",value:{mode:"current",preview:false,plan,replan,presentation,learned}}` | Read current server inputs; never invent a feasible plan or a zero-filled result. |
| Edited preview | `POST /api/gcsp/v1/greg/order-plan/preview`, body `{changes:[{key,value}]}`; result includes `plan`, `activePlan`, presentation and preview metadata | Nothing is saved, published or ordered. Editors use server editable keys and policy provenance. |
| Production tracking | `ProductionResource`, `ProductionReads`: `GET /api/gcsp/v1/greg/production`; actual submissions, requests, quantities, stages, supplies and response history | Requested, confirmed, queued, released and outstanding are independent producer values. Pending/refused/uncertain stay distinct. |
| Intentional request | `POST /api/gcsp/v1/greg/production/requests`, exactly `{commandId,planId,versions}` | No `/order-plan/submit`, browser identity selector, client quantity command or invented `changes` field. |
| Recovery | Bearer authentication plus current application context | Commands are never replayed merely because authentication recovered. Subject/environment/run changes discard private state. |

`ProductionResource` maps a pending or uncertain result to HTTP 202. A pending result can contain a submission value; an uncertain result can contain only `operationId`. Neither is confirmed success. Advice to send the same request again means intentional retry of the original command, never automatic replay.

`PlanSnapshotPort.current(context)` has no edited-constraints argument. Consequently an edited preview cannot currently be submitted through this Production contract. It stays comparison-only; a new deliberate request requires returning to the current plan. An alternative submission protocol is outside this allocation.

Source review at 2026-11-16T20:51:50Z confirmed unfinished producer implementation/startup wiring: `PlanningDefaults.UnconfiguredDemand` returns `planning-forecast-not-configured`, `PlanningDefaults.UnconfiguredSupply` returns `planning-supply-not-configured`, and `ProductionWiring` selects `UnconfiguredPlanSnapshot`, returning `plan-not-configured`. Pickup observation at 18:17:32Z established no alternate production binding. FUCQ-477 comment 3629648 and FUCQ-478 comment 3629649 record the remaining work. These defaults do not establish an outage of a configured external service; no allowed retained evidence observes such an outage. Route registration and injected fixtures do not close either original criterion. No frontend/Java wire-shape defect was established in the reviewed contracts.

`OrderPlanOperations` always emits `learnedUnavailable()` for current and preview results. The frontend displays that limitation; richer learned-plan comparison/evaluation in the frozen legacy reference remains unsupported by this producer. Draft edits and retained command intent survive a transient same-account authentication interruption in memory. Route destruction or full-page sign-in clears that memory; progress persistence across either remains unimplemented and unproved under the recorded recovery contract.

## Component and integration state

The feature reuses `ScreenIntroComponent`, `ButtonDirective`, `LabelledFieldComponent`, `StatusScreenComponent` and `FactListComponent`. Native captioned read-only tables with column/row headers and named scroll regions avoid the existing shared table's employee-case action. Both sections share a route-owned `PlanningStore` and intentional-action focus events. No shared primitive was added.

| Slice | Evidence and remaining work |
| --- | --- |
| `core` | Client12, projection12 and store15 selected assertions passed. Actual Java acceptance remains open. |
| `screens` | Order-plan6, Production6 and local composition4 assertions passed. Rendered acceptance remains open. |
| `integration` | Guarded lazy `greg/plan` source registration loads the real `PlanningRouteComponent` export with `sessionGuard` and Greg role metadata. Registered-route execution and actual Java/OIDC journey remain unrun; catalogue/gallery stay dispatcher-owned. |

The missing route was planned unfinished dispatcher integration, already reserved by the original allocation, and is not a newly discovered Bug. No slice completion, map transition or Story acceptance is inferred from this source increment or the fixture-based passes.

## Accepted targeted evidence

All four accepted runs used frozen HEAD `e52c38753d7a0217ad54071be28b6b4d74daa561`, tree `ac4080b292950f47d8a1e33f3963c32527fe72e9`. Their exact selected commands, assertion names, source/dependency/control pins, process histories and teardown results are retained in the following worktree-relative receipts. Each records rc0, `strict_result:true`, the expected distinct assertions and no sampler/cleanup errors. The dispatcher independently audited all 256 source pins for each run.

| Run | Selected cases | Receipt beneath `.claude/` | Receipt SHA256 |
| --- | --- | --- | --- |
| core a02 | client12 + projection12 + store15 = 39 | `fucq449-supervisor-a02-20261116/core-a02/receipt.json` | `6b1c0944617f36ec57a7d955f8ea441a826e9c75f6f2752f462c453757f65fad` |
| order c01 | order-plan6 | `fucq449-order-c01-20261116/order-c01/receipt.json` | `d30fde3fc6dab53c3352c8dd5ef8c4fd4087216b85ad7cc5bde9cdaee217aa60` |
| production c01 | Production6 | `fucq449-production-c01-20261116/production-c01/receipt.json` | `8d2c011dd37416dd39f899786a1a7600b4d49d69fb6c44d74f41f2ea330f6f30` |
| local composition c01 | route component4 | `fucq449-localcomposition-c01-20261116/localcomposition-c01/receipt.json` | `b983a35b5b302f608a41121431e54beb2ef43b19924b4a816c26c99bfb0e6919` |

The accepted commands used pinned Node/Angular CLI `test gcsp-web --watch=false`, exact `--include=src/app/greg-planning/<spec>` selections, JSON/default reporters, `--coverage=false --progress=false`, and owned output paths recorded in each receipt. They were separately admitted finite runs, not an unrestricted `npm test` or full suite. The local composition spec mocks `AuthPort` and `PlanningClient` and creates the component directly; its four passes do not exercise the exported application route, actual OIDC or Java.

The feature files tested by those 55 assertions remain unchanged by this route/documentation increment. The new `routes.ts` registration changes the source identity and has not been compiled or executed. Reuse the matching 55-case evidence; it does not establish validity of the new route. No new runtime check or boundary checker ran for this increment.

| Run | Work / total seconds | Sampled disk / aggregate RSS / inclusive bytes |
| --- | --- | --- |
| core a02 | 34.729 / 84.237 | 445,541,568 / 1,183,416,320 / 1,628,941,504 |
| order c01 | 34.202 / 68.197 | 445,578,816 / 1,142,374,400 / 1,578,543,552 |
| production c01 | 33.112 / 72.747 | 445,632,448 / 1,143,717,888 / 1,589,346,240 |
| local composition c01 | 33.701 / 69.781 | 445,681,984 / 1,070,137,344 / 1,506,774,592 |

All accepted runs stayed within the admitted sampled resource/time limits and retained complete process identity histories. Each verified its owned identities/groups, local scratch/output roots and reservation absent after teardown. Accounting used OS snapshots; continuous containment/unsampled peaks are not proven. This records the retained observations, not a new inspection of old scratch.

Preserved failures: core a01 failed compilation before executing any case because the historical dependency subset omitted pinned `oidc-client-ts@3.5.0` and `jwt-decode@4.0.0`; additive dependency preparation for a02 corrected that subset, without app/auth/config changes. Its receipt SHA256 is `081aaec29a7b0426dbf3872758dd5b6879b6215c31a5d7650a9980ed917d4b5c`. Earlier preparation also exceeded the 2 MiB physical retained-output ceiling at **2,466,144 bytes**. Byte-identical gzip retention mitigated allocation; the breach and its original evidence remain preserved. Neither failure is erased by the accepted runs.

The last lead whole-output observation after the local-composition result was 1,939,616 allocated bytes (1,806,323 logical) against 2,097,152 bytes. The dispatcher subsequently appended its audit within the counted allocation; that figure is historical, not a fresh headroom claim. This source increment writes no new ignored runtime artifacts and preserves retained evidence byte-for-byte.

## Remaining acceptance and proposed next check

The smallest meaningful registration check is proposed at the exact, currently unallocated path `apps/gcsp-web/src/app/greg-planning/planning-registered-route.spec.ts`: use the actual exported `routes`, actual `sessionGuard` and router navigation as a Greg identity; navigate to `/greg/plan`, assert both planning and Production sections share the loaded route, and assert entry sends no Production request. Controlled auth/client providers would keep this a registration/composition check, not actual Java/OIDC acceptance. Do not substitute direct component creation. This file is neither created nor run; any future implementation/run needs dispatcher allocation and a bounded admission. Reuse all 55 accepted cases.

Connected acceptance still requires actual Java responses for feasible/infeasible/current-input changes, stale version refusal, submit/retry and response-driven replan. Relevant rendered desktop/narrow, keyboard/focus, Safari/private-browsing and CSP/accessibility observations remain unrun, including affected loading, empty, unavailable, denied, infeasible, stale, pending, refused and success states. These are the existing affected acceptance obligations, not an expanded migration/deployment campaign. Native Angular tests, fixtures and source review do not establish rendered or integrated acceptance. Unimplemented producer/recovery work above remains Story work; unrun checks must not be relabelled as external-service blockers.

Any separately admitted run retains the existing ceilings: disk805306368, aggregate RSS1342177280, inclusive2147483648 and actual free reserve5368709120 bytes; 480 seconds work/600 total including 120 cleanup, one worker, Node heap512 MiB and cumulative whole-Story retained output2097152 bytes. It needs owned local scratch, external manifest, source/input pins, supervised process/group accounting, checkpoint and verified teardown. These ceilings are not a new admission. FUCQ-448 sizing evidence does not test this feature or authorize borrowing its resources. OneDrive remains prohibited for every access, including metadata and cleanup; no evidence here depends on accessing it.

## Source review and agents

Lead review covered actual four-endpoint contracts, bearer transport, defensive projections, scope isolation, preview invalidation, versioned intentional submission and pending/refused/uncertain tracking. Earlier corrections addressed authentication loss during unresolved requests, superseded two-step refreshes, policy/run/plan guards, malformed alternative metrics, current/preview union comparison, concise response history and intentional-action result focus. Limits remain a closed disclosure matching the frozen reference. This increment adds only the guarded lazy route and truthful documentation; exact additive-route inspection and whitespace checks are source-only evidence.

Agents: Mike Wazowski 2, requested/selected `gpt-6.1-sol` / `high`, no fallback; title verified, thread `01a1e5ae-b838-7422-9b7c-1b76e07e78f8`. Lightning McQueen 2, requested/selected `gpt-6.1-sol` / `medium` from fresh tiers mapping, no fallback; title verified, thread `01a1e5b0-3fb3-79d2-98fa-fe6025432173`. One prior source-only child, no new children or descendants for this increment. The dispatcher owns subsequent lifecycle and shared integration decisions.
