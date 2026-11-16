# FUCQ-452 process comparison delivery

Original Story: `_dev/in-progress/DEV-2026-11-13-020.md`, eight points, cap eight. This record preserves both original acceptance items. Source preparation and fixture checks are not actual Java, rendered browser or collaborator acceptance.

## Bounded contract and source basis

Claim checkpoint `e1bb0aafd830ec2eb05553aff64ddc7cb199b77a`, parent `9e565007583c3ebd1d48e53ab948dc537fc19f04`. Migration visual/capability kickoff is `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`. The dispatcher owns route integration, publication, Jira, merging and deployment.

Allocated writes are the seven new `apps/gcsp-web/src/app/comparison/comparison.{types.ts,client.ts,client.spec.ts,component.ts,component.spec.ts,component.html,component.css}` files, this record, the own Story and FUCQ-452's object in `.product-map/work.json` through the existing helper. Existing `route-comparison` already associates FUCQ-452; the registry is unchanged. Java, other Stories, authentication, routes, shell and shared kit are read-only.

Applicable contracts: `AGENTS.md`, `docs/gcsp/README.md`, `demo-brief.md`, `build-rules.md`, `experience-quality.md`, `technical-readiness-2026-11-05.md`, `screens/README.md` and `COMPONENTS.md`. Preserve the approved implemented comparison presentation in `blocks/gcsp/greg/comparison/`, including readable statistics, server verdicts, the fit caveat, assumptions, provenance and policy freshness. No public cancel/restart actions, impersonation, employee commands or new comparison engine.

Component plan: reuse Angular `ButtonDirective`, `LabelledFieldComponent`, `ScreenIntroComponent` and `StatusScreenComponent` and semantic GCSP tokens. The view composes comparison facts, native tables/disclosures and progress, adding no shared primitive. The existing portal shell/header/sidebar/palette and body reference remain binding. No later Greg concept is adopted.

Actual Java read boundaries:

- `ComparisonResource`: Greg/presenter GET `/comparison/results/latest` accepts optional `experimentId`; the no-query envelope lists `process-only`, `order-mix`, `points`, `hold-sweep` in that order with nullable stored results and active policy. GET `/comparison/process/latest` takes no query. Stored identity includes `resultId`, digest, origin, stored/completed time, pinned/active policy and `policyCurrent`.
- `ComparisonJobResource`: Greg-only POST `/comparison/jobs` takes exact `commandId` plus the supported request and no query. Greg/presenter GET `/comparison/jobs/latest` takes only optional `jobId`. Its 200 or empty 404 owns the top-level `reruns` flag. A start response does not supply that flag.
- `ComparisonRequests` and `ComparisonJobs`: process-only takes no change; points/order-mix take a value and basis; hold sweep takes whole-second values and basis. Seeds/overlays are server-owned. A command is idempotent for actor/environment; changed input under the same command is refused. Running/succeeded/failed/interrupted states and progress are durable. Server busy replies can identify the already-running job. No cancel/restart route exists.
- `RetainedComparisonResults`, actual result generator and existing render tests establish result formats and factual presentation. Retained process seeds are `comparison-a`, `comparison-b`, `comparison-c`; controls do not change seeds or workloads or promise improvement.

The binding source obstacle at pickup is concrete: main-source `ComparisonReplay.java` declares the replay interface and `UnavailableComparisonReplay.java` is its only main implementation. `ComparisonJobUnavailableTest.theDefaultReplayFailsTheJobHonestly` expects a started job to fail with `The route replay is not available in this service yet.`, no stored new result and zero completed steps. `ComparisonJobHttpTest` uses its explicit test profile/replay. Its authored synthetic success is not evidence of a configured successful production replay. Successful actual new-run proof remains original Story work and requires the separately owned producer binding; FUCQ-452 does not edit Java or replace the unavailable result with fixture success.

## Delivery slices

Stable helper plan:

1. `inspection`: retained/new identity, actual measures, assumptions, experiments and policy freshness.
2. `jobs`: Greg-only supported start/rerun, durable progress, honest interruption/refusal and session recovery.
3. `integration`: lead source composition, actual Java/role refusals and applicable rendered original acceptance evidence.

Both first slices have prepared source and remain in progress pending lead delivery checks. No slice is complete on agent return or authored tests alone. The integration slice remains incomplete until its required evidence exists. Both original AC checkboxes remain open.

## Proportionate validation and resources

Initial phase is source/test preparation only. No tests, builds, installations, downloads, browser, service, database or runtime allocation has run. The finite candidate reuses the existing tested F450/F451 owned local runner, rather than adding a validation framework. Draft plan/runner are under the dispatcher's local `.claude/test-runs/fucq452/{plan,freeze,runner,receipts}` allocation, whole retained cap 2 MiB. The authored finite selection is 58 cases: 28 client and 30 component. Exact source/check counts and commit/tree pins will be frozen after source review, before a runtime release.

Selected validation is the two new Angular comparison specs, followed by the existing app boundary command. The latter has an already observed inherited case-queue em-dash failure in F450/F451; any repeat remains a real failure, and FUCQ-452 does not repair another Story. Fixture checks cover the new HTTP/presentation boundaries; unchanged Java, shared authentication, Used Cars and a full repository suite are excluded because this source chunk does not modify them. Actual connected Java/OIDC/PostgreSQL, desktop/narrow, Safari/private browsing, keyboard/focus and visual checks remain separately open original acceptance evidence, not waived or claimed by unit tests.

Proposed one-worker runtime chunk: 768 MiB disk, 1,280 MiB sampled process-tree RSS, 2,048 MiB inclusive, Node heap 512 MiB, 480 seconds work/600 total and 5 GiB free emergency reserve. Scratch `/private/tmp/gcsp-f452-<fresh-token>` and output `/private/tmp/gcsp-f452-output-<same-token>` require manifests outside scratch, canonical machine reservation, owned PID/start/group/token discovery, bounded streamed output, both wall/monotonic deadlines and a supervisor finalizer. Retain native exit before report parsing, exact case identities and useful failures. Finalization stops/joins owned processes, checks listeners/groups and exact roots, audits unchanged borrowed/source pins, removes owned scratch/output and releases only its own reservation. Sampled peaks do not prove continuous containment. No test has yet consumed this candidate grant.

All OneDrive operations are forbidden by Gary's explicit 14 November direction, including existence checks or cleanup verification. Bounded authorized local coordination is the only generated output so far.

## Agents and observations

Lead Foghorn Leghorn 2 requested/selected `gpt-6.1-sol`/`high`, no fallback; own desktop title verified. Source implementers Marvin the Martian 2 and Porky Pig 2 each requested/selected `gpt-6.1-sol`/`medium`, no fallback; both desktop titles verified. Shared capacity before the batch reported `can_start=4`, `running=3`, 9.1 GB free at 22:56 UTC. Marvin's actual source start was 22:58:15 UTC, owning only client/spec; Porky's was 22:58:42 UTC, owning only component/HTML/CSS/spec. Their source work overlapped with disjoint files. Lead owns types, metadata, review and resource receipt. Returned workers will not be counted as executing.

Both source workers returned before the source checkpoint; their durable claims are expired. Marvin authored 28 client cases, Porky 30 component cases (27 declarations with parameterized expansions). Lead reviewed the source and tests. One substantive presentation finding was corrected: experiment `arm.differences` compares today's release route with buddy within each arm; the first HTML incorrectly labelled it baseline versus tried value. Corrected arm labels and a discriminating unequal-arm/route test preserve the separate actual `effects` structure. The client also rejects a stored result ID with the wrong experiment prefix. These are source corrections, not verified runtime resolutions.

Shared learning log: `docs/gcsp/dispatcher-learnings.md`, especially DL-20261114-GC-001 and DL-20261116-GCC-003. Source preparation does not establish improved throughput or test delivery. Exact native selected-option state after a loading-template recreation and exact job/result identity are included in the planned interaction checks, following the observed F451/F450 issues.
