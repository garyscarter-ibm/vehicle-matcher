# Buddy normal-runtime integration plan

FUCQ-100 / DEV-2026-11-04-060, 6 November 2026. **Original preparation record at0478b501.**
The subsequently granted local composition and selected evidence are recorded in
[buddy-runtime-integration.md](buddy-runtime-integration.md). The remaining text preserves the reviewed plan. The dispatcher requested this
finite source/lifecycle plan after independently auditing the completed 41 allocation manifests.
No central/runtime, paused allocator, identity, policy, repository/core or other service source is
changed here. No tests, runtime, listener, browser, native database, network provider or full suite
is launched. Claim and In Progress status remain with this story.

This plan follows `build-rules.md`, `experience-quality.md` and `technical-readiness-2026-11-05.md`.
Existing actual-source evidence is retained; synthetic protocol proof does not establish live-provider
or merged-runtime acceptance. There is no screen/component change in this planning checkpoint.

## Frozen inspection and source ownership

The shared inspection base is `329c522f52de5fd7c02497d3a14e96bb9275a6ad`. It matches the observed
shared local HEAD and origin/gcsp-poc. Story HEAD is published `95a475acceff50cdfcabfccc3101a08808264767`.
[evidence/fucq100/runtime-plan-sources.json](evidence/fucq100/runtime-plan-sources.json) records 31
exact Git-blob SHA-256 identities across these immutable refs; it is a read-only source catalogue,
not a test result. Recheck the actual integrated base and overlapping paths before any edit grant.

| Producer/owner | Immutable source | Relevant boundary |
|---|---|---|
| FUCQ-100 | `95a475acceff50cdfcabfccc3101a08808264767`; product bytes unchanged from `a7fc8580efba36c329b2479711d6b66db53962bd` | Buddy local/remote, token, comparison, stored-subject evaluator; published custody repairs in core and notification consumer |
| FUCQ-102 | `4a56d386f031e7cf5a1fdeaefdcc612fb35cbd7b` | access.js/access-http.js and minimal server/index.js registration; actual100 timing proof 32/32 reported and independently routed by root |
| FUCQ-103 | `3f1cc3414d700b1028ff1fec640a40591324b728` | runtime/provider/publication composition, clock and identity activation, Greg routes and reviewed-policy adoption |
| FUCQ-126 | `828c9b71e4fb0dbd2e959e8ddb96a53ccd017cfd` | presenter routes/commands, clock/reset, identity/policy changes; preserve its actual release/time behavior |
| FUCQ-66 | `4336075942b4fc13dfdca76fea167b002ba77831` | manual routes/registration and pending HTTP202 mapping. Claim/context bytes still exactly the proved `eb5a677b37c486e3da7c4547803f739e22df8ac3` modules |
| FUCQ-96 | `6f15d4d524e7a207ce705befe1d52d8c54ce1cfa` | actual allocation/identity contract used by the isolated two-case invocation proof; explicit pause remains binding |

102 has released its minimal index patch for serial integration. Root relayed its handoff: index hash
`2878cdd4c69790572b2458dc1436ae293a14db4dc42ed929da71e803c9ab513b`; access factory is
`createOfferAccessHandler({ service, identity, allowedOrigins })`. Its release does not supersede the
103 lane. Coordination was requested from both 102 and 103. 103's harness preparation remains active;
its published runtime/provider adoption and any further central lane release stay with root's serial
integration decision. No active 103 source edit is inferred, and this document claims no central file.

## Existing normal entry and concrete gaps

1. `scripts/gcsp-demo.mjs:startGcspDemo` calls `createGcspRuntime`, builds an API server using
   `services.dependencies`, awaits `api.gcspStartup`, and refuses startup when that result is not ok.
   It establishes a trusted loopback employee session through the real identity service. Its executable
   PostgreSQL path may read a machine credential; this preparation neither executes it nor reads that file.
2. Shared/story `server/gcsp/runtime.js` constructs one repository, clock, identity, account, brief,
   editor, activity and provider. It does not construct buddy, manual claims, offer access or a notification
   dispatcher. The manual account provider is read context, not the exact claim service.
3. 103's runtime changes replace the file-only default with an owned memory/PostgreSQL policy provider,
   wrap the same provider with publication ports, and expose Greg/policy/repository dependencies. Preserve
   its ownership flag, idempotent close and policy activation/context refresh; do not reintroduce an old
   default policy or create a second policy instance for buddy/access.
4. `server/index.js:buildServer` currently registers cases and notifications and then calls
   `clock.reconcileStartup()`. 66 adds `manualClaims.registerClockHandler()`. 102 adds the separate
   offer-access dispatch. None of those sources registers buddy. Registration must finish before the
   first startup or presenter tick seals DemoClock's registry.
5. The normal host checks startup failure, but `buildServer`'s GCSP request path only awaits its startup
   promise and then dispatches even if that promise resolved unavailable. Its direct executable entry calls
   `buildServer()` with no GCSP dependencies. Constructing services only in a proof does not repair either
   entry. The first source grant must include the narrow GCSP startup-result guard below; the retail entry
   remains an unconfigured GCSP endpoint until the trusted GCSP host supplies actual dependencies.
6. 102's safe projection reads current state; it does not expire/release authority or register lifecycle
   handlers. Its per-instance capability branding requires one shared access service for HTTP and future
   106 decisions. Session expiry uses real wall time; offer/hold expiry uses DemoClock. Keep secure cookies.

## Proposed minimum serial source change

After root selects the exact integrated base, adopt the already reviewed producer modules and retain
all overlapping 66/102/103/126 composition changes. This is source integration under their existing
owners, not permission to overwrite a whole older central file. The 100 adoption set is exactly the
four offers modules plus recommendation/index.js and its already published core/notify custody deltas;
new changes to core, identity, policy or the allocator are not requested by this plan.

The new composition delta requests only `server/gcsp/runtime.js`, `server/index.js` and a new dedicated
`server/test/gcsp-buddy-runtime-integration.test.js`, plus this story's documents/map. It is not granted yet.

| File | Proposed new delta after the reviewed source adoptions |
|---|---|
| `server/gcsp/runtime.js` | Construct one `createBuddyHoldService` using the same repository/policy/clock/identity and explicit `{ mode: 'local-synthetic' }` stock-action adapter. Construct actual manual claims around the existing account and the same local adapter. Construct one `createOfferAccessService` with the same dependencies/environment/sessionNow and actual `verifyOfferToken(token, binding, expectedHash)`. Construct captured-only notification dispatcher on the same repository/clock/policy/environment. Return those service instances and expose `gcspBuddy`, `gcspManualClaims`, `gcspOfferAccess`, `gcspNotify`, `gcspOutbox: { repository }` alongside all existing dependencies. Keep account as account; preserve 103's provider wrapper and close ownership. |
| `server/index.js` | Preserve 66 manual route/registration, 102 separate offer-access dispatch, 103 publication and 126 presenter routes. Add awaited `deps.gcspBuddy.start()` before notification startup and `clock.reconcileStartup()`. If a configured GCSP clock's startup result is not ok, return the existing shaped unavailable result as HTTP503 before ordinary or offer-access dispatch. Preserve preflight/origin/shared-key/identity guards and dependency-free retail behavior. |
| New dedicated test | Exercise the actual composed services through ordinary imports on the integrated base, using buildServer's in-process request stream and awaited startup; no socket/browser or copied-source loader. Scope and resource admission remain a separate review. |

Capture-only notification construction is explicit: no real transport configuration or external send
is included. The existing service defaults to CapturedTransport; preserve 100's published token-free
receipts. Enqueue remains atomic with the offer. FUCQ-98 owns a real mail transport and actual delivery.
106 service construction is not invented; once published, its owner must receive this same access
service instance and the same authority dependencies. No new public buddy allocation endpoint is needed.

## Registration, ticks, reset and shutdown

`createGcspRuntime` constructs services; `buildServer` owns starting the returned instances. Use one
instance of each service. Do not construct another buddy inside HTTP, Greg's held-quote proof or future
allocation. Proposed startup order:

1. Actual manual `registerClockHandler()` → `manual-claim-expiry` at `manual-expiry`.
2. Buddy `start()` → `buddy-expiry` at `buddy-expiry`; remote mode additionally registers
   `buddy-pending-operations` at `pending-reconciliation` (remote composition is a later gate).
3. Existing case `start()` when supplied by its host → `renewal-risk-cases` at `pending-reconciliation`.
4. Notification `start()` → `captured-outbox` at `outbox-dispatch`, commit observer and initial captured drain.
5. Await every registration result, then await `clock.reconcileStartup()` exactly through the same
   clock instance. Abort configured GCSP startup/dispatch on unavailable or invalid registration.

Registration order is distinct from tick execution order. The canonical PolicyService keys already
supply `clock.handler.order.v1 = release-pull, manual-expiry, buddy-expiry, pending-reconciliation,
buddy-allocation, outbox-dispatch` and `clock.commands.v1.startupStages = manual-expiry, buddy-expiry,
pending-reconciliation`. DemoClock orders handlers by stage, then handler ID. Startup expires/reconciles
persisted authority; it does not allocate new stock or run release-pull. Notification.start's initial
drain is separate from that startup tick. Advance and tick remain separate commands under current policy.
Do not hardcode a new order or add a timer to make the demo appear active on a sleeping host.

Reset retains the backend's sealed registry and service instances. The existing reset changes current
run and reseeds authorised synthetic state. Do not rerun service registration or reconstruct access/buddy
on reset. Handlers receive the current run at each event; old employee/access contexts and tokens fail
against the retired run. A new runtime/backend gets a fresh clock/registry and reconciles persisted
state before serving. Recreating a memory repository on a retained test store proves instance startup,
not durable process/PostgreSQL recovery.

Buddy/access own no timer, listener, pool or close hook. Await startup and all initiating requests,
allocation calls, ticks and their returned promises before closing shared storage. Repository commits
await their afterCommit observers; keep that contract. NotificationDispatcher.close removes its commit
observer; invoke it after work is settled and before runtime closes the repository. Preserve 103's
idempotent repository close and finally-close of the runtime-owned policy provider. Do not close an
externally supplied policy provider or construct per-service pools. The trusted host owns stopping and
joining its listeners/in-flight calls; buildServer itself does not own repository lifetime.

Remote shutdown needs a separate reviewed adapter ownership/cancellation/drain contract if external
work can remain in flight: current buddy/access have no stop/drain API, and closing a socket alone
cannot establish that an awaited provider call settled. This first local composition does not claim
remote normal-runtime lifecycle or concurrent-close evidence.

## Actual allocator and remote integration gates

The published96 service is `createAllocationService({ repository, policy, clock, identity, claim })`.
Future normal composition must give it this same buddy instance as `claim`, not a second claimant.
Its real `tryClaim` input pins stock/slot/employee/brief/permission/policy/clock and derives the stable
allocation operation ID from run/event/employee/car. The isolated actual96 invocation/replay/fallback
proof (2/2) is valid evidence at its frozen source; it does not prove normal event wiring.

The actual96 source requires a branded presenter and `identity.resolveEmployeeContext`. That resolver
exists in the pinned96 identity delta, not the inspected shared or 103 identity. Neither the allocator
nor that identity seam is adopted or changed here. Startup's roles-empty backend context cannot be
made into a presenter. Preserve the explicit96 pause and obtain its source/ownership grant before
adopting the resolver, adding its event consumer or changing its protocol.

FUCQ-92's real `stock-release` completed receipts and BriefService's real `brief:changes` completed
receipts are the future event inputs. Preserve their eventId/run/source versions and persisted allocator
plan. The inspected normal host has no released-stock producer composed; a directly inserted proof row
cannot satisfy the release-to-allocation acceptance. A later allocation-stage consumer must be owned
and reviewed with92/96; it must not allocate during excluded startup stages or forge identity.

Remote96 has a concrete missing port: current `tryClaim` accepts only ok/conflict/stale-version as
progress; pending/unavailable retains the same candidate. The original buddy command must keep its
historical pending result. After reconciliation, replaying that command cannot become a new result.
The existing authenticated `buddy.readOperation(context, { operationId })` provides a current safe
projection; 96's owner must explicitly consume it on a pending-plan resume. Do not advance another
candidate while claim/release is uncertain, extend deadlines or alter historical receipts.

100's remote module already persists intent before execute, reconciles before retry, confirms only
matching bound acknowledgements, and retains uncertain release exclusion. Its 49/49 dedicated and
later 193/193 affected-source checks are reusable at their recorded identities. Runtime remote adapter
injection, actual96 status-read adoption and finite real composed remote proof remain unexercised.
No operational adapter endpoint/access/credentials or live remote evidence was inspected or assumed.

## Finite validation proposal and pending acceptance

No command below runs as part of preparing this plan. After a separate exact-base/source grant, use
one new in-process memory test file with these selected behaviors:

- Normal runtime constructs and shares the real buddy/manual/access/captured services. buildServer
  registers each stable handler before sealing. Repeated start on the same instances is idempotent.
- With actual confirmed brief/consent and valid stock input, the composed buddy creates one shared
  hold/claim/pinned quote/offer/outbox; actual access exchanges/reads that producer's token. Preserve
  102's 32/32 timing/security evidence; between quote expiry and hold expiry, access permits decline
  only, and after hold expiry no action. This does not claim actual106 decision behavior.
- Normal presenter advance/tick expires real local authority at the exact server deadline; normal
  access reflects expiry and no decline/priority is introduced. Startup of a fresh backend over the
  retained memory store reconciles existing overdue authority before request dispatch.
- Actual manual claim and buddy claim still exclude each other through the normal runtime dependencies.
  Reuse the completed four-case pinned-source proof for its exact boundary; select fresh normal-composition
  cases because service construction and integrated dependencies now differ.
- Reset preserves registrations, invalidates old employee/offer-access/token authority and lets the new
  run use the same service instances. Publication activation preserves old quote pins and fresh policy
  reads through 103's same provider; use103's actual scenarios rather than duplicate its algorithm.
- A real invalid/late buddy registration produces startup failure and HTTP503 without calling access
  or ordinary business routes. Close removes the captured observer and closes owned providers once;
  caller-owned policy stays open. Include an awaited in-flight local commit/observer boundary.

Review the affected-test selector and exact source/import/fixture/environment map first. Likely affected
boundaries are buddy local/remote/expiry/token custody, clock/reset, brief/runtime, actual manual HTTP,
offer access, Greg publish/activation and presenter controls. Select exact files only after the integrated
base is frozen; preserve finite default tests that bind a socket as excluded until that lane is granted.
Existing 19/19 projector, 193/193 boundary, 4/4 actual66 and 32/32 actual100+access evidence is reused
where source/input/environment/variant still matches. Changed composition/downstream policy source
requires new relevant boundary evidence, not a redundant full run of unchanged isolated proofs.

Proposed memory limits remain120s/768MiB RSS/128MiB scratch/2MiB logs/one worker, fresh HostBudget,
external ownership manifest, registered finalizer, owned TMPDIR/TMP/TEMP, all DB aliases/NODE_OPTIONS
removed, recursively owned PID/start/PGID identities and final join/delete/absence/dependency audit.
Retain small summaries; OneDrive is unavailable. Root separately owns browser/native/full lanes. The
authored npm test and repository contract/native evidence remain required on the integrated source;
this targeted proposal does not satisfy a full stamp, deployed smoke or live external operation.

The first local runtime composition is technically possible using published interfaces; no new human
business-rule decision or external data access is needed to prepare or implement that bounded scope.
Current blockers are the explicit central edit/test grant and serial source ownership, the paused96
resolver/event/status-read contracts for actual producer integration, and ungranted final/native/live
lanes. Credentials are not claimed missing or invalid; their availability was not tested. Full105
current-car specification comparison still lacks an authenticated employee-to-specification association.
No new BMW rule, fake success, collaborator ratification requirement or Jira dependency gate is added.
