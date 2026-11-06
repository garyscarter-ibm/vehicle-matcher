# Presenter HTTP/release integration source plan

6 November 2026. **Planning freeze only; execution is not admitted.** The accepted presenter checkpoint remains `a10ca742d56aa24b6639d5af380fa76316048d11`. No product source is adopted or changed, and no product modules, tests, browser, listener, native database or full suite are executed by this plan.

## Exact source custody

| Source | Pinned checkpoint | Use |
|---|---|---|
| FUCQ-100 | `38be4f5d95823b5f010a56c3d4b6cbda4eca55e8` | Canonical server/runtime graph, including the published eligibility repair. Dispatcher reports selected 25/25 and its 201-check audit; neither is rerun here. |
| FUCQ-92 | `15a79957e61d81612311d3aab7dbf77733dc4e0d` | Actual `stock/index.js`, `stock/port.js` and statically re-exported `stock/synthetic-provider.js`. |
| FUCQ-126 | `a10ca742d56aa24b6639d5af380fa76316048d11` | Accepted controller, HTTP adapter and their literal module dependencies. Existing selected proof is retained unchanged. |

The [machine-readable source plan](http-release-source-plan-38be4f5-2026-11-06.json) records 124 Git blobs and 242 literal module/URL edges, with no unresolved literal path or conflicting same-path content. Every UTF-8 blob is checked against its Git object identity before SHA-256 is recorded. The published 102-row central adoption manifest is an input, not inherited proof: its file rows are reread at `38be4f5`, and additional imports are followed. No old repository/core or copied private fixture brand replaces the canonical graph.

The plan also pins all 1,975 files in the two existing installed dependency trees, their link target/device/inode, Node's executable/target/hash, package manifests/locks and the inspection/resource/Git/selection helpers. Product imports include `pg`; the proposed DOM harness additionally needs existing `jsdom`. No package is installed or copied. Its 28 recorded filesystem/import expressions remain visible for the execution-freeze review; literal paths are included, and nonliteral reads need the route/boundary classification below. Static closure is not observed execution.

`prepare-http-release-source-plan.py` only reads Git objects and installed files, then writes this planning manifest. It imports scaffolding helpers, never product modules. The manifest pins that inspection helper itself. This is not the future integration supervisor.

The current canonical `runtime.js` still has the same bytes as `95d7741`, SHA-256 `6ac589363f8a6c5abc67e7d63d861389265a942b8da8cfa721bb6942a1461fa7`. It returns the shared repository/policy/clock/identity and scenarios, but constructs no stock-release service or run-aware provider. The next FUCQ-100 composed checkpoint must replace this planning reference before an executable mixed-source freeze. FUCQ-100 owns runtime/server wiring; FUCQ-103 owns registry changes.

## Smallest real in-process chain

Use canonical `createGcspRuntime({ mode: 'memory', ... })`. Construct the actual FUCQ-92 release service with that runtime's repository, policy, clock and identity plus an explicitly reviewed source plan; register it before `buildServer` starts startup/seals the clock. Retain the canonical scenarios service and its exact original `readPolicy` binding. Do not construct another PolicyService, ScenarioService, repository, clock or identity merely to satisfy the test.

Reuse the existing no-listener request technique from canonical `server/test/gcsp-buddy-runtime-integration.test.js` lines 17–26: call the real server request listener with a readable request and response recorder. A fetch-shaped bridge feeds this actual response to the unchanged `createPresenterHttpAdapter`, then the unchanged controller mounted in JSDOM. The bridge implements transport and a cookie jar, not routes or business outcomes. It must preserve method, JSON body, status/ok, Origin, Cookie and actual Set-Cookie updates. No `listen`, network fetch, credential extraction or fabricated context is needed.

Issue genuine presenter/acting sessions through the canonical identity service. Perform the real reviewed presenter-step adoption through the Greg-authorized operation if the retained seed lacks the key, then resolve the same cookies again. Use actual controls/configuration readback for versions and future release cue; no client step/date fallback. The previously accepted adoption proof is reusable where unchanged; setup use does not create a new acceptance claim.

## Proposed selected cases

The future owned file is proposed as `server/test/gcsp-presenter-stock-release-http.test.js`. It is not authored or executed in this checkpoint. Freeze its exact names and expected count before admission; do not rerun the unchanged controller unit module merely to restate accepted evidence.

| Case | Actual boundary and required observation |
|---|---|
| Startup and first release | Startup registers handlers but releases no stock. The authenticated presenter `next-release` command invokes the real producer once. Controller count equals the unique newly committed `orderUuids` and exact stock delta; current run, event/tick, handler/stage and receipt identities agree. |
| Original-command replay | Drop only the delivered response after the real POST commits. Retry the exact original body through the controller/adapter. Clock advance, release receipt and stock change occur once; readback/replay preserves the original count. |
| Genuine empty pull | After eligible stock is exhausted, use a fresh ordinary step/tick, not an invented future cue. Actual `no-release` with an empty UUID array renders zero with no stock delta. Cumulative visible stock never becomes the new-release count. |
| Source refusal | An explicitly labelled run-scoped source fault reaches the actual producer validator. The UI reports release unavailable, with no newly released IDs or stock mutation. Clearing the fault and an actual new tick is a separate deliberate action. |
| Malformed pull | A separately pinned malformed source-port response is rejected by the actual producer, with no stock delta or fabricated successful result. Do not replace the successful HTTP DTO to simulate producer behavior. |
| Mechanics reset and old provider | Use the actual scenarios/reset HTTP route with canonical scenario/fixture/policy versions. Accept actual cookie renewal/recovery, resolve the new run, preserve handler/service identity and demonstrate refusal of the old run-bound provider. Do not label refusal as successful post-reset release. |

Any small synthetic plan used for this boundary must be explicit, immutable and hashed, with valid exact identities, facts, visibility, availability and source/version provenance. This demonstrates actual service composition against isolated synthetic inputs. It does not establish the FUCQ-77/78 business source or a prepared business journey.

## Missing source and preparation interfaces

FUCQ-92's real provider contract is `pull({ runId, asOf, eventId, policyVersion, releaseSize, leadTimeDays, released, queuedSupply })`. Its synthetic constructor captures `{ runId, version, windows, label }`; another run returns `stale-run`. The release validator turns an unsupported pull result into a typed failure. No positive reset capability is implied by registering this provider once.

Positive post-reset release therefore needs a reviewed trusted resolver/factory and data handoff keyed by the actual new run: actual generated order/configuration/wholesaler/corpus/revision identities, source windows, facts, visibility and availability must agree with that run's immutable preparation. The existing release handler remains registered and resolves the correct run's source. The exact resolver/factory API, atomic publication/lookup behavior and new-run data are not supplied by `38be4f5`; this plan does not invent them or relabel old-run stock. If a car already exists unreleased, the producer preserves its existing facts/visibility, so a later pull cannot repair missing reset-seed facts.

The reset boundary still permits only employees, entitlement slots and stock rows in `repository.resetRun`. Canonical scenario preparation supplies configuration/selection metadata, not atomic confirmed briefs/offers/pending business operations. Central/scenario owners must supply the additive atomic service contract before enabling any of the six journeys. Sequential service calls after retiring the old run, copied preparation brands or capability flags cannot stand in for that contract. Paused FUCQ-96 remains paused.

Consequently successful new-run release is a later conditional case, admitted only after the actual factory and immutable source/preparation data are pinned. All six business preparation gates remain closed independently of the six proposed boundary cases above.

## Execution-freeze and resource handoff still required

Before any execution, replace the central source ref with its published composed checkpoint; review the exact additive source union and retain a single canonical module identity. Freeze the owned test, source fixtures, request/fetch bridge, loader/read observer and supervisor/finalizer bytes. Recompute the complete transitive source and installed package resolution closure, including all configured data paths and directory membership. The current manifest's empty literal-unresolved list does not waive those missing execution inputs.

Classify the recorded read sites explicitly: memory policy seed and reviewed-definition JSON are intended pinned reads; migrations/PostgreSQL, retail cache paths and vehicle-evidence publication/lookup routes are outside this selected path. They are not automatically irrelevant because their modules are imported. The later read/module journal must match the reviewed allowlist, retain original registrations and flag unexpected reads/imports. Pin any required lookup directory inputs rather than disabling a production safety gate. Confirm no credential or environment selector redirects resolution.

Proposed limits remain one worker, 120 seconds, 768 MiB RAM, **128 MiB combined scratch plus retained output/journals/logs**, and 2 MiB log per independent chunk, with a fresh HostBudget and short reservation lock. No allocation is authorized by this document. Before mkdir/launch, establish an external source/impact/output ownership plan, absolute run root, checkpoint and finalizer. Keep owned TMPDIR/TMP/TEMP and remove Node/npm injection and database/PG environment aliases.

Capture the actual selected case names, totals, pass/fail/skips and bounded original TAP output for independent audit; zero/missing/all-skipped counts are not a successful receipt. Stop/join all owned children on success/failure/cancellation, release reservations, remove exact owned scratch, then independently check recorded PID/start identities, groups, open files, paths and reservations. Retain concise names/counts/source/resource receipts after audit rather than successful verbose trees. No browser/native/full lane follows automatically.

## Checkpoint validation

Only source/documentation inspection and finite hashing occur here. The planning manifest has 124 source blobs, 242 literal edges, 1,975 installed dependency file identities, zero literal unresolved paths and zero content collisions. No new tests or resource reservations are created. Existing accepted `a10ca74` controller/ratchet receipts remain unchanged; dispatcher independently accepted that narrow checkpoint with its 2,097-check source/resource audit. Product controller source and the earlier browser evidence retain their exact bytes and scope.

## Subsequent owned transport authoring

The own `server/test/helpers/presenter-http-proof.js` bridge is now authored separately from
central composition. Its [authoring receipt](http-release-harness-authoring-2026-11-06.json)
pins the exact bytes and records that it has not executed. It imports only `node:stream` and
calls the real server request listener, supplies the explicit host/Origin and actual issued
cookies, applies real Set-Cookie renewal/deletion, and passes status/JSON to the unchanged
adapter. Its deliberate lost-reply variant discards the body after the handler completes and
cookie headers are applied; it does not stand for every network-loss variant. The bounded
transport journal contains method/path/status/byte counts, never credentials or business bodies.

This is a scoped test jar for the actual identity cookies, not browser-cookie acceptance proof.
The six-case test setup, source/read observer and resource supervisor still need the concrete
central composed checkpoint and reviewed source inputs. They are not supplied by the bridge.
No mixed imports, Node execution, tests, scratch or reservations are created for this authoring.
The identity-only bootstrap stock gap remains: the actual release producer preserves existing
row facts, so the future source/preparation owner must supply correct facts before release.
