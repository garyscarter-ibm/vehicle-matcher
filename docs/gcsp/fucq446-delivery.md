# FUCQ-446 delivery plan and interface inventory

Plan and first bounded source checkpoint, 14 November 2026. Current state: dispatcher
published plan `11440c7632f3612d6351ab486ef101f6c8d07d3a` and released only the three
pure projection files recorded below. This checkpoint is held for exact-SHA dispatcher
review/publication; the rest of progress-read and every later slice remain unreleased.

Bertie (they/them), Story lead, chat
`01a1d95e-58ac-75b2-a1bc-2a010748c7e3`.

## Original plan authority and delivery boundary

At the original plan checkpoint: **PLAN ONLY; waiting for dispatcher publication and explicit source release.** Commit the
three named metadata paths, then hold the exact commit. No source changes, descendants,
tests, builds, browsers, services, dependency links or runtime allocation are authorised
at this checkpoint. The dispatcher owns publication of the exact SHA; this worker must
not push, sync, merge, deploy or perform the final switch.

Worker: `.claude/worktrees/DEV-2026-11-13-014`, branch
`dev/DEV-2026-11-13-014`, claim/base HEAD
`5f376dd47c625217831e3d6f66cef4752e3464f4`; configured helper base
`gcsp-poc-dev`. Implementation freeze:
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`. Story-authoring revision
`23f6ce3313916f41264c3157d70188d79287d511` is historical authoring evidence,
not the implementation baseline.

Future source ownership is **new `apps/gcsp-web/src/app/orders/**` only**. The dispatcher
owns all existing account/auth/kit/routes/shell/catalogue/COMPONENTS/tokens/build/config
files. FUCQ-445 owns `offers/**`; Russell owns Java/backend/repository work 419–425 and
GC owns computation work 409–418. No implicit ownership transfer. Metadata ownership is
this document, `_dev/in-progress/DEV-2026-11-13-014.md`, and only FUCQ-446's row in
`.product-map/work.json`. The existing `post-selection` component association is sufficient.

The original two Story acceptance criteria are unchanged and unchecked. Plans, source
inspection, fixtures, publication and builds do not establish acceptance. Jira dependency
links are context; pickup depends on concrete interfaces, ownership and explicit holds.
No independent Jira changes or new acceptance criteria are part of this checkpoint.

Apply `AGENTS.md`, `docs/gcsp/build-rules.md` (especially Demo delivery and scope control),
`docs/gcsp/experience-quality.md`, `docs/gcsp/demo-brief.md`, and
`docs/gcsp/technical-readiness-2026-11-05.md`. Jira writes resumed on 13 November;
collaborators have equal authority. False child HTTP 422 credit errors are diagnostic:
continue authorised work while the launcher works, preserving the exact error. Below-High
findings go through the dispatcher for linked backlog Bugs without enlarging this Story;
Critical/High findings require resolution or explicit collaborator deferral.

## Native state and evidence revisions

The dispatcher supplied authenticated native readback in root-local
`.claude/fucq446-native-after-0909.json`: **In Progress; Gary Carter; 13 points;
Start 2026-11-14**. Agent/host labels were preserved; branch comment is `3629447`.
Native `updated` is `2026-11-14T03:24:26.536-0600` (09:24:26.536 UTC).
This is supplied receipt evidence, not a new tracker query by this worker. The earlier
To Do/unassigned observation in `.claude/fucq446-native-before-0909.json` and the
09:21:19.981006 UTC preflight remain historical observations.

All nine preflight source hashes matched the worker: AccountClient, account.preview,
the four Java resources, Node approvals HTTP/service, and replacement contracts. The
following body/current-car files also match the freeze byte for byte:

- `blocks/gcsp/order-progress/order-progress-http.js`
- `blocks/gcsp/order-progress/order-progress-controller.js`
- `blocks/gcsp/order-progress/order-progress-body.js`
- `server/gcsp/lifecycle/current-car/index.js`

Supplemental read-only current-root evidence is pinned separately to
`cdf5db59f06b4f8ca0dbccbab6c06380d2c89ab4`, including FUCQ-468 ordering merge
`bcd258dbd6f5954c5e53828d0c8c8c385a72d160`. The worker has not been synced to it.
`ordering/ActiveOrderSource.java` is a CDI `OrderSourcePort` bean over
`OrderingOrderSource`, selected while persistence is active. It reads acknowledged
selection rows, preserves keyset order, and refuses pending/refused selections as not
ready. Therefore the worker-base missing order producer is historical for that newer
root, not a blanket current-root blocker. Parent-supplied Russell comment `3629446`
records explicit dev `GCSP_ORDERING_PROVIDER=synthetic`; default `none` refuses. No
live configuration or journey was exercised here.

## Read and command contract

All suffixes below are beneath deployment-supplied `/api/gcsp/v1`; Angular uses real
bearer authority from AuthPort. Employee/run/environment/role are never chosen by the
form, URL or fixture. Java remains authoritative for ownership and provider decisions.
Retain producer envelopes separately; a failed section must not hide successful sections.

| Capability | Current Java and Angular seam | Employee boundary and presentation |
| --- | --- | --- |
| Owned orders | Reuse `AccountClient.readOrders()` → GET `orders/progress/all`; Java accepts `after`/`limit`, default 50, max 100 | Preserve `failed`, `failedCount`, `nextAfter`; do not infer an empty or newest order from an incomplete page. |
| Exact order/vehicle | Reuse `AccountClient.readOrder()` → GET `manual/order`; use existing `latestOrder` and exact-order vehicle matching | Never join another order's car or fabricate absent display facts. Snapshot mismatch below needs owner coordination. |
| Stages | GET `orders/progress?orderUuid=...`; `lifecycle.stages.v1`, schema 1 | Server stage order, owner, next step, outcome, blocked reason and policy/revision metadata. Employee has no approval/decline command; Greg/presenter permissions do not confer employee authority. |
| Documents/checks | GET `documents` and GET `documents/readiness?orderUuid=...` | Match the selected order; preserve items/tasks/readiness and documentsRevision. Only waiting-for-employee items with supportsAcknowledgement and provider acknowledgement support expose an action. |
| Acknowledge task | POST `documents/tasks/acknowledge` with `{commandId, orderUuid, itemId, expectedDocumentsRevision}` | Positive observed revision; this is acknowledgement, not a signature. Unsupported/refused/pending never become completed locally. |
| Handover appointment | GET `appointments?orderUuid=...`; POST `appointments/request` with `{commandId, orderUuid, slotId, expectedVersion}`; POST `appointments/accept` with `{commandId, orderUuid, proposalId, expectedVersion}` | Use only supplied offered slots/proposals and observed version. Preserve owner, nextStep, booked, history/previous attempt, pending/blocked and eligibility. Completion is Greg-only; no employee complete or presenter impersonation control. |
| Return plan | GET `return-plan?orderUuid=...`; POST `return-plan/request` with `{commandId, orderUuid, choice, slotId, expectedVersion}`; POST `return-plan/accept` with `{commandId, orderUuid, proposalId, expectedVersion}` | Use supplied choices/slots/version. Preserve applicable, relationship/currentCar, handover, returnMileage, appointment and outcome. Hide return section when not applicable. |

The frozen Node task route is `documents/tasks/complete` with
`acknowledgement: "synthetic"`; Java uses **acknowledge plus expectedDocumentsRevision**.
Frozen Node appointment/return command shapes also lack Java's explicit command/version
fields. Migrate the implemented behaviour through Java's actual DTOs; do not copy Node
wire shapes or execute Node business logic at runtime.

Keep 200 success, 202 pending (including operationId and any returned value), typed
400/401/403/404/409/422/503 and retryability distinct. On stale version, reread and require
a deliberate new choice; do not auto-submit an unfinished command. One deliberate
command at a time; preserve command identity during supported pending reconciliation.
After a command, reread producer facts. Cancel/drop late results after disposal, selected
order change, sign-out or subject/account/environment/run change. Reload reconstructs
pending/refused truth from Java; no optimistic terminal outcomes.

Current-car contract `lifecycle.current-car.v1` changes the relationship only on confirmed
`handover-completed` or `return-confirmed` evidence. A request, proposal, booking or
pending/refused outcome is not physical completion. New car collected means that car is
current; before then the held old contract remains current; old car returned first means
no current car. Do not derive this from plan status alone.

## Concrete coordination gaps and readiness

1. **Account list pagination:** existing `AccountClient.readOrders()` cannot supply
   `after`/`limit`. ApprovalService pages source rows before filtering to the employee, so
   even a page with zero owned orders can have nextAfter. Dispatcher owns the shared
   client evolution; use its agreed complete-list/page contract before claiming newest
   order or empty-state parity. No second account paginator or duplicate snapshot client.
2. **Selection snapshot shape:** at the worker, `validOrderSnapshot` requires
   `selection.stock.orderUuid`; current-root `OrderingProjection.of` emits flat
   `selection.orderUuid` and no selection.stock/display facts. Source-backed interface
   discrepancy; live reproduction, impact/severity and originating defect linkage remain
   unresolved. Dispatcher coordinates the account/backend owners and any backlog Bug.
   Absent car media remains absent; this Story does not fabricate it or edit either owner.
3. **Lifecycle transport reuse:** AccountClient's request/scope methods are private and
   fixed-path. Before implementing orders HTTP code, agree dispatcher-owned shared
   authenticated request support or an explicitly approved lifecycle-only adapter. Reuse
   existing list/snapshot/auth/runtime contracts; do not clone the account filter/transport
   engine. Pure DTO/projection work can proceed independently after source release.
4. **Shared Angular primitives/navigation:** current `routes.ts` still maps `orders` to
   StatePageComponent. Dispatcher integrates the new component with the protected route,
   shell and host navigation. Existing Angular kit supplies intro/button/status/facts/
   fields/media; no Angular stageTracker/taskList/slotPicker was found. Compose domain
   markup with the existing kit/tokens or request dispatcher-owned reusable adaptations;
   no private copied kit, tokens or catalogue edits. Frozen Node primitives remain visual
   and semantic references. Coordinate FUCQ-445 tracking links without editing offers.
5. **Actual Java composition:** at worker `5f376dd`, the only production implementations
   found for document case/clock, appointment stage/readiness and return source/handover
   are unavailable/unconfigured defaults; approvals has NoHandover. Provider selection
   alone does not prove composed availability. This observation is pinned to the worker;
   re-inventory dispatcher-selected current Java before integration and preserve true
   missing-provider refusals. Backend work belongs to Russell. Real OIDC, native
   PostgreSQL, configured providers, persistence/restart/concurrency and actual browser
   journey evidence remain unrun. No Jira dependency-link gate or fixture completion is
   substituted for these concrete checks.

Independent readiness: agreed v1 read/action interfaces support scoped frontend DTO,
projection and component work after dispatcher release. Complete discovery of current
interfaces does not release source ownership or prove the composed demo journey.

## Stable slice plan

Total 13 points; each independently reviewable delivery boundary is below 8 points.
IDs remain stable across retries and replacement agents. All five are **not-started**;
the planning checkpoint earns no implementation/acceptance progress. Integration is
required within the original Story, not optional hardening.

| Stable ID | Points | Delivery boundary and evidence |
| --- | ---: | --- |
| `progress-read` | 3 | Typed lifecycle envelopes, exact owned-order selection and pure projection with partial failures/pending/refused/current-car truth. Reuse account list/snapshot; coordinate pagination/DTO/shared request contracts. Named projection/client checks below before completion. |
| `employee-actions` | 3 | Provider-authorised document acknowledgement, appointment request/accept and return request/accept with revisions, deliberate command IDs, conflict/reread and pending recovery. No employee physical-completion controls. Meaningful command/body/authority/reload checks. |
| `view-parity` | 3 | Orders screen and state presentation using shared Angular kit and frozen design, supplier owner/next steps, conditional return choices, focus/live-region behaviour; dispatcher-owned route/host integration. Actual rendered desktop/narrow and keyboard evidence. |
| `review-proof` | 2 | Lead reviews original AC, rendered Safari/private browsing, CSP/accessibility, affected auth/host states and known findings. Independent findings remain separate under build-rules; no generic validation framework or cosmetic redesign. |
| `java-integration` | 2 | Angular journey against actual configured Java/native PostgreSQL and real OIDC, supported pending/refused/ownership/version/reload/transition scenarios and physical-event relationship proof. Record live-adapter gaps, transaction/restart/concurrency evidence and hosted-dev handoff; original AC remains open until evidence supports it. |

First source files after explicit release, all new under `apps/gcsp-web/src/app/orders/`:
`orders.types.ts`, `orders.projection.ts`, `orders.projection.spec.ts`,
`orders.client.ts`, `orders.client.spec.ts`. Implement the projection first while the
dispatcher settles shared transport/list/snapshot contracts; client execution waits for
that contract. Follow with `orders.controller.ts`/`.spec.ts` for orchestration/actions and
`orders.component.ts`/`.html`/`.css`/`.spec.ts` for the screen. File names are assigned for
ownership; no files are created by this plan.

Selected first-slice check, **planned and unrun**, from the worker root with the authorised
borrowed Node/dependencies when released:

```sh
npm --prefix apps/gcsp-web test -- --include=src/app/orders/orders.projection.spec.ts --include=src/app/orders/orders.client.spec.ts
```

Cases: exact order/vehicle join; latest-order tie; incomplete/empty page stays unresolved;
independent producer failure; supplied stage/owner/next step; 202 value/operation retention;
foreign run/employee/order and late response rejection; confirmed versus planned current-car
changes; supported provider action gating. Action slice adds exact Java bodies/version,
unsupported/refused/pending and same-command replay, one action, stale-reread, auth recovery
and reload reconstruction. These are behaviour checks, not implementation-mirroring tests.

Reuse the service scenarios in `ApprovalEmployeeHttpTest` (owned reads/no employee
commands), `DocumentAcknowledgementTest` (revision, provider evidence/refusal and replay),
`AppointmentsHttpTest` (supported journey/authority), `AppointmentCompletionTest`,
`ReturnHttpTest`, `ReturnOutcomesTest` and `CurrentCarStoreTest`. Their source was inventoried;
none ran for this plan. Dispatcher/backend owner selects bounded existing Java commands
and resources at release; this worker does not start an API or database opportunistically.

## Experience and validation contract

Use `docs/gcsp/screens/README.md` for shell/header/sidebar/palette and the frozen
`order-progress-body.js`, associated copy/CSS/fixtures and COMPONENTS order-progress
contract for the body. Preserve Your order → Handover → Documents and checks → Returning
your current car. Apply the freeze's later UX notes: All times are UTC once; avoid a second
Still to do list; reveal return choices only after handover booking with its reason before
then. Keep supplier ordering and exact authority, clear written status, partial section
failures, section-local feedback, quiet refresh focus/scroll retention and keyboard names.

Render desktop and narrow states, Safari/private-browsing, keyboard/focus, relevant CSP
and accessibility. Cover loading, no order, unavailable/partial failure, denied/expired,
stale/conflict, pending, refused/unsupported, accepted/scheduled, missed/rebooked and
confirmed completed/returned where supported. Real Java employee login must never use a
presenter or Greg token for employee commands. Relevant Used Cars/shared-consumer checks
belong to dispatcher-owned shared changes. Fixtures and isolated checks supplement, not
replace, actual Java/native PostgreSQL/OIDC acceptance.

## Resource and checkpoint contract

**No runtime resources allocated for this plan.** No child agents. Bertie requested and
selected Sol/high, dispatcher independently verified actual runtime Sol/high; no fallback.
IBM gateway session check passed at `api.servicesessentials.ibm.com`.

Before any later allocation, require dispatcher release, manifest and finalizer, named
selected checks, owned scratch/process/port paths and a bounded receipt under root-local
`.claude/test-runs/fucq446/`. One worker initially at most 2 GiB scratch/600 seconds,
5 GiB reserve; adapt chunks below 30 GiB free. Outputs over 256 MiB go directly to
OneDrive `_agent-output/vehicle-matcher/fucq446`, with checkpoint and deletion accounting.
Borrow worker007 Node/dependencies read-only only when authorised; never delete/mutate
that owner's files. No FUCQ-412 runtime or B-Bot repetition. Verify process, filesystem
and port teardown, not only exit status; parent retains responsibility for final receipt.

This checkpoint permits only source/document integrity checks: named diff/whitespace,
unchanged original AC, row/raw-byte preservation and commit scope. No tests, builds,
browsers, services, native database, emails, provisioning, deployment or acceptance
replay occurred. No check is represented as passing when it was skipped or unrun.

## Publication handoff

Commit only this document, the own Story result and FUCQ-446 map row through scaffold_git,
with the Codex co-author trailer. The map helper imports the supplied native state and
creates the stable plan through a row-only serialisation sink; 301 foreign rows, their raw
bytes/order, outer metadata and component registry are preserved. Expire the plan worker
observation at hold; a commit must not imply an active worker or accepted Story.

Dispatcher verifies the exact plan SHA, publishes it through the reserved parent workflow,
and explicitly releases the first slice/any shared contract. This worker remains at its
claim base plus this metadata-only checkpoint until that direction arrives.


## First bounded source checkpoint — 14 November 2026

Dispatcher review receipt `.claude/fucq446-plan-parent-review-0909.json` verified the
frozen plan and native adoption, then confirmed exact remote-tip publication and released
only the new `orders.types.ts`, `orders.projection.ts`, `orders.projection.spec.ts` under
`apps/gcsp-web/src/app/orders/`. No source sync/rebase occurred. Lead continued directly;
no children were spawned. Requested/selected/effective Sol/high remains dispatcher-verified.

Implemented Java v1 read DTOs, source-labelled separate producer envelopes, a pure exact
order/scope join and employee action hints. Existing account types, latestOrder and
orderVehicle are imported read-only. Complete-list evidence requires explicit null
nextAfter, zero failedCount and an empty failed list; missing/incomplete evidence cannot
produce an automatic newest order or an empty-list claim. An exact known owned row can
be selected independently of later pages. Duplicate or explicitly foreign list identities
stay unresolved. This is consistency checking on already authorised reads, not an
HTTP/authentication, recursive ownership filter or pagination implementation.

Stage order/owner/next step and document readiness remain supplied facts. Pending envelopes
retain operationId and any value, but cannot enable actions. Refused/unsupported envelopes
stay distinct and do not become success. Hints expose only supported document task IDs,
offered appointment slots/proposal and return choices/proposal with employee authority,
provider support, state/revision and pending/blocked guards. There are no commands,
transport, controller, components, routes or physical-completion controls.

Only the exact return-plan relationship determines the projected current car. Old-car
selection details, scheduled/returned plan labels and handover labels do not create a
relationship or replace one. Missing display/media/relationship facts stay absent; the
existing flat-Java versus nested-account snapshot gap remains open.

Additional source-only parity observation: worker Java AppointmentService.doRequest returns
appointment-already-requested if an existing row has a different requestedSlot; it exposes
no new-slot rebooking branch. The current hints therefore do not advertise a no-show
rebook command. Frozen Node's rebooking behaviour and actual Java support need dispatcher/
backend coordination in integration. No live reproduction, defect severity, repair or
acceptance claim is inferred from this observation. Historical Low FUCQ-499 full-app
boundary failure remains separate, unchanged and unfixed; it was not rerun here.

### Scoped validation and lead review

**PASS: 18 tests, one spec file**, selected command from worker root:

```sh
npm --prefix apps/gcsp-web test -- --include=src/app/orders/orders.projection.spec.ts
```

The authorised worker007 Node24.22.3/npm11.19.1 toolchain and pinned dependencies were
borrowed read-only. Worker/borrowed package, lock, Angular, spec and Vitest configuration
bytes matched before allocation. The runner is Angular unit-test/Vitest4.0.18, one worker,
watch off, cache disabled. Angular performed its selected-test bundle compilation;
no separate application/production build was run. One test run passed; no failed/skipped
tests were reported. The code pins below still matched at lead review.

Cases establish the pure boundary: newest tie without mutation; incomplete/empty/failed
page truth; exact missing/selected rows; failed/pending list and identity ambiguity;
exact car join and absent data; preserved stage owner/next-step/source; partial-failure
isolation; 202 value/operation retention; refused/unsupported distinction; cross-order/run/
employee join rejection; supported employee task/slot/proposal/return hints; missing
employee authority; blocked/pending/terminal actions; and supplied current-car relationship
versus planned/physical-event facts. Lead reviewed the three files against Java
ApprovalView/ApprovalStore, DocumentView/DocumentOutcome, appointments ReadModel/
AppointmentService/AppointmentResult, Return PlanView/PlanResult and CurrentCarView.

Full suite, client checks, full-app boundary check (FUCQ-499), browsers/rendered desktop/
narrow/Safari/private browsing/keyboard/CSP/accessibility, real Java/native PostgreSQL/OIDC,
transaction/restart/concurrency, email and hosted acceptance are **UNRUN**. No Story AC is
checked. There are no current external callers of the new pure files; shared-account
helpers are consumed without edits. Broader checks belong to later released integration.

### Resource receipt and teardown

Root-local receipt directory: `.claude/test-runs/fucq446/`.
`preflight-projection-001.json` records borrowed identities, command/impact boundary and
budgets before allocation. `run-projection-001.py` registered the supervisor/finalizer;
`ownership/b8ad2588e461439b9562ffd326264499.json` records planned/active/removed ownership.
The shared host reservation was released. `projection-001-result.json` and
`projection-001.log` retain the actual result and bounded useful output.

Measured runner wall time **5.393 seconds**, peak group RSS **953,778,176 bytes**, peak
scratch **10,017,213 bytes**; one worker, 2 GiB RAM/scratch and 600-second limits,
5 GiB emergency reserve, about 158.7 GB free after teardown. Local scratch was the
explicit tool-working-cache/IPC compatibility exception, below the 256 MiB large-output
threshold. No OneDrive output was needed; larger output remains directed to
`OneDrive-IBM/_agent-output/vehicle-matcher/fucq446`.

Vite's temporary config path was preflighted: an owned node_modules facade held package
symlinks into the read-only borrower, so `.vite-temp` writes went to owned scratch.
The owned node_modules/.angular/out-tsc/dist links and
`scratch-projection-001` were removed and independently checked absent. Process group
46214 has no live members or remaining owned ports. Borrowed node_modules' 25,442-entry
metadata identity and selected tool/config/package SHA256/device/inode pins match their
preflight values. No borrowed files were removed or changed. Filesystem teardown is
verified, not inferred solely from the successful exit.

### Tested source pins and remaining hold

| Source | SHA256 |
| --- | --- |
| `orders.types.ts` | `a4c8a19212f436ef5923173f69c9e08ac4c0fd360c7415cc1439c2924171ca78` |
| `orders.projection.ts` | `dfdd8bbcad13668eac1949b788a97929e1772cedd15493b1a697d959cb693c5c` |
| `orders.projection.spec.ts` | `47ef6bd865f5bd4849e58469851aacf6f67507f37e846f40711e7381d1d81d9f` |

`progress-read` is **in-progress/partial**. Shared complete-list, snapshot and request
contracts/client checks are unresolved; the other four stable slices remain not-started.
The map records this transition and expires Bertie's worker observation at the checkpoint
hold. Preserve all 301 foreign map records/raw bytes/order and outside-own-row bytes.
Both original AC and the complete original Story contract remain unchanged. Dispatcher
alone owns native lifecycle updates, exact-SHA publication and the next explicit release.
No worker push/sync/merge/deploy/final switch has occurred.
