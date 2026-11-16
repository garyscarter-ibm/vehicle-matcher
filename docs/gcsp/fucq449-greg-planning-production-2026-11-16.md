# FUCQ-449 — Greg planning and Production

Source-only checkpoint for `DEV-2026-11-13-017`, 16 November 2026. The Story remains In Progress. Neither original acceptance criterion is complete. No application runtime, dependency installation/copy, service, browser, test or build was allocated for this increment.

## Fixed scope

1. Forecast explanations, editable constraints, alternatives and infeasible/stale previews reflect current API inputs/results.
2. Deliberate submission, quantity/status tracking and replanning follow actual Production responses, including pending/refused outcomes.

The exact allocation is the dispatcher's `fucq449-pickup-allocation-20261116-1634.json` observation of 16 November. This checkpoint owns the 17 new files under `apps/gcsp-web/src/app/greg-planning/`, this record, its Story Result and only the FUCQ-449 map row through `_tools/product_map.py`. The dispatcher retains `routes.ts`, `COMPONENTS.md` and gallery registration. No Java, legacy business implementation, authentication, shared kit, build or dependency source belongs to this allocation.

The implemented body at kickoff `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`, particularly `blocks/gcsp/greg/plan/{panel,plan-view,plan-copy,element,http-adapter}.js`, is the parity reference. `docs/gcsp/screens/README.md` governs the shell/palette. The 13 November Greg concepts remain proposals. The current Angular primitives and semantic tokens carry the existing component language forward.

## Producer boundary

| Capability | Actual Java source and wire contract | Consequence |
| --- | --- | --- |
| Current plan | `GregOrderPlanResource`, `OrderPlanOperations`, `PlanningResponses`: `GET /api/gcsp/v1/greg/order-plan`; `{status:"ok",value:{mode:"current",preview:false,plan,replan,presentation,learned}}` | Read current server inputs; never invent a feasible plan or a zero-filled result. |
| Edited preview | `POST /api/gcsp/v1/greg/order-plan/preview`, body `{changes:[{key,value}]}`; result includes `plan`, `activePlan`, presentation and preview metadata | Nothing is saved, published or ordered. Editors use server editable keys and policy provenance. |
| Production tracking | `ProductionResource`, `ProductionReads`: `GET /api/gcsp/v1/greg/production`; actual submissions, requests, quantities, stages, supplies and response history | Requested, confirmed, queued, released and outstanding are independent producer values. Pending/refused/uncertain stay distinct. |
| Intentional request | `POST /api/gcsp/v1/greg/production/requests`, exactly `{commandId,planId,versions}` | No `/order-plan/submit`, browser identity selector, client quantity command or invented `changes` field. |
| Recovery | Bearer authentication plus current application context | Commands are never replayed merely because authentication recovered. Subject/environment/run changes discard private state. |

`ProductionResource` maps a pending or uncertain result to HTTP 202. A pending result can contain a submission value; an uncertain result can contain only `operationId`. Neither is confirmed success. Its advice to send the same request again is an intentional retry of the original command, not permission for automatic replay.

`PlanSnapshotPort.current(context)` has no edited-constraints argument. Consequently an edited preview cannot currently be submitted through this Production contract. Keep it comparison-only and return to the current plan before a new deliberate request. Wiring the preview into an alternative submission protocol is not authorised here.

Concrete connected obstacles remain `PlanningDefaults.UnconfiguredDemand`, `PlanningDefaults.UnconfiguredSupply` and `ProductionWiring`'s `UnconfiguredPlanSnapshot`. The defaults explicitly return `planning-forecast-not-configured`, `planning-supply-not-configured` and `plan-not-configured`. No alternative production binding was established at pickup. FUCQ-477 comment 3629648 and FUCQ-478 comment 3629649 confirm these remaining obstacles. Route registration or injected test fixtures will not close either original criterion.

## Component and slice plan

Reuse `ScreenIntroComponent`, `ButtonDirective`, `LabelledFieldComponent`, `StatusScreenComponent` and `FactListComponent`, with existing GCSP tokens. Compose read-only planning/Production tables using native caption, column/row headers and a named scroll region: the existing Angular table's employee-case action is not appropriate here. Compose local page sections rather than adding a new shared primitive. The dispatcher owns the necessary additive catalogue/gallery registration with integration.

Stable map slices are declared before implementation:

| Slice | Files/boundary | State at this increment |
| --- | --- | --- |
| `core` | Types, client, projection, store and their scoped specs | Source implementation/review; runtime validation outstanding. |
| `screens` | Order plan and Production status components, local route composition and their scoped specs | Source implementation/review; rendered and runtime validation outstanding. |
| `integration` | Dispatcher route/catalogue integration; actual Java/OIDC journey and affected experience proof | Not complete; no integration claim. |

No slice is complete from an implementer exit or source inspection alone. The map preserves the original Story and foreign rows. Worker claims record observed/expiry times and are not inferred from commits.

## Requested validation, not executed

The affected regression boundaries are the four endpoint shapes, absent/malformed producer facts, superseded reads, scope isolation, edited-preview invalidation, deliberate versioned submit, authentication recovery, and actual pending/refused/uncertain tracking. Specs must distinguish these transitions and truthfulness properties rather than mirror private helpers.

Request one bounded chunk at a time, from `apps/gcsp-web`, using the installed pinned environment only after the dispatcher admits a concrete supervised run:

1. Core: `npm test -- --include=src/app/greg-planning/planning.client.spec.ts --include=src/app/greg-planning/planning.projection.spec.ts --include=src/app/greg-planning/planning.store.spec.ts`.
2. Each component independently: the same command with only `order-plan.component.spec.ts`, then only `production-status.component.spec.ts`.
3. Local composition: only `planning-route.component.spec.ts`. This does not count as actual application-route coverage.
4. After dispatcher integration, actual full-route coverage against the registered `/greg/plan` route separately, plus the existing Angular boundary/component/CSP ratchet checks selected for these files. No full suite is justified by this source-only checkpoint.

FUCQ-448's selected core/component passes can inform sizing but do not test FUCQ-449. Its full-route attempts exceeded the 1280 MiB aggregate RSS grant even after reducing V8 heap; a successful test log did not establish a compliant run. Keep the full-route boundary separate and prepare a materially smaller admitted plan using observed compiler/worker overhead. Do not borrow FUCQ-448 scratch, output, dependencies or reservations. If the indivisible route check cannot fit, retain it as unrun rather than weakening coverage or exceeding the grant.

Any later run must own an absolute local root plus external ownership manifest, supervisor/finalizer, input/source pins and exact process/group cleanup. The existing ceiling is 768 MiB disk, 1280 MiB aggregate RSS (supervisor and all descendants), 2 GiB inclusive allocation, 5 GiB emergency reserve, 480 seconds work and 600 seconds total including 120 cleanup, one worker, and 2 MiB whole retained output. These are ceilings, not an admission. Sample/process-accounting/retention failures must remain explicit. Keep concise summaries and useful failure logs, remove only manifest-owned disposable paths, and verify filesystem absence.

OneDrive is prohibited for all access, including reads, existence checks, archives and cleanup. No check in this source-only increment requires it.

Connected acceptance still requires actual Java responses for feasible/infeasible/current-input changes, stale version refusal, submit/retry and response-driven replan. Relevant rendered checks remain desktop/narrow, keyboard/focus, Safari/private browsing, CSP/accessibility and the introduced loading, empty, unavailable, denied, infeasible, stale, pending, refused and success states. No fixture, source review or build substitutes for that evidence.

## Source review and receipt

Implementation/review results and the commit identity are recorded in the Story Result. Runtime pass count for this increment is **0; all authored tests remain unrun**. Original acceptance remains unchecked. No shared route, catalogue, gallery or producer configuration is changed by this checkpoint.

Agents: Mike Wazowski 2, requested/selected `gpt-6.1-sol` / `high`, no fallback; title verified, thread `01a1e5ae-b838-7422-9b7c-1b76e07e78f8`. Lightning McQueen 2, requested/selected `gpt-6.1-sol` / `medium` from fresh tiers mapping, no fallback; title verified, thread `01a1e5b0-3fb3-79d2-98fa-fe6025432173`. One source-only child, no descendants.
