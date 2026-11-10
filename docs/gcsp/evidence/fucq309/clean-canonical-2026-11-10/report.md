# FUCQ-309 clean canonical attempt, 10 November 2026

The single authorised clean actual HTTP attempt **failed** with `ERR_WORKER_OUT_OF_MEMORY` at **192.787 seconds**. Current route for comparison-a completed at 135.235 seconds; the job ended at **1/6 steps, 0/3 completed seeds**, with **zero queried result rows**. Canonical acceptance is still unmet. No retry, additional localisation, production edit, Built/Done transition, merge or closure followed the result.

## Exact attempt and unchanged contract

Prelaunch source was clean and pushed at `320e612c8c499e7bd167c2f8dcf36716696aa739`, tree `62ca764b3287e19acef276f153f0da951e806c38`. Both production repair hashes match independently reviewed `9bcd3e865be5b4e9df43b031e8742f866f1f9fb2`. Preflight and post-run audit verified 303 production source hashes, 65 existing dependency hashes, the Node v26.7.0 binary, retained harness/supervisor bytes and policy bytes. The gateway preflight passed IBM Global.

The actual local `POST /api/gcsp/comparison/jobs` returned 202 at 16:05:26 UTC and the original worker emitted its six-step plan. All 1,000 employees, comparison-a/b/c and current/buddy routes stayed fixed, with no overlay. Policy remains 128 MiB old / 16 MiB young and 1,800 seconds. The outer supervisor enforced an explicit 1,900-second hard bound and refused repeat launch. One shared reservation allowed 768 MiB RAM and 32 MiB scratch. The longer indivisible chunk was documented before launch because splitting the requested job changes its acceptance boundary.

The worker URL, source bytes, options and execution path were unchanged. There was no source load/transformation hook, WeakRef or dereference, forced GC, injected stop or added worker yield. The only inherited import hook resolves bare `pg` to its pre-existing installation in the named earlier worktree; it does not load or transform production source. Worker messages and `getHeapStatistics()` were observed on the host, with OS process-group measurements outside the worker. The complete command, dependency location, executable hashes, all canonical assumptions and deterministic input hashes are in `plan.json`.

Preflight generated metadata only, without a worker/replay: each of the three seeds has 1,000 employees, 850 cars and nine releases. Its actual input hashes are in `canonical-inputs.json`. They are planned input identities, not completed-result evidence.

## Measured outcome and responsiveness

The final HTTP job view returned 200 with truthful failed status and the original memory-allowance reason. The repository query returned no partial result. No result file exists. The first buddy route did not complete; its exact failing substage and operation remain unknown because this attempt intentionally had no phase observer.

The command took 193.239 supervisor seconds. The harness measured 193.059 wall seconds and 193.059 monotonic seconds. These clocks describe this attempt only and do not explain the historical canonical-v3 discrepancy. Sampled worker used heap peaked at **124.09 MiB**, host-process RSS at **433.20 MiB**, and the separately sampled process-group RSS at **430.25 MiB**. Samples occur at different times, so the latter is not an upper bound on the host sample. The supervisor reported exit 1 with no resource-supervision issue; its `complete` state means the planned command and cleanup finished, not that product acceptance passed.

All 123 sampled health requests returned 200, all 123 job-latest samples returned 200, and all 123 process-result samples returned the expected 404 because no result existed. Maximum observed latency was 3.541 ms for health, 2.950 ms for process-latest and 3.376 ms for job-latest. The maximum gap between host samples was **3.782 seconds**. These are sampled observations, not a continuous-responsiveness or clean comparative-speed claim.

## Checks, retained evidence and remaining scope

The host harness had pinned success assertions for all six route/seed results, deterministic input hashes, record-digest fields, population/car totals, per-route measures, aggregate summaries/differences, worker/store/HTTP/file digest identity and independent caller-mutation isolation. **Those complete-result success assertions were unrun** because the job failed. A route digest-only payload cannot establish full-record equality. There is no successful unchanged 1,000-person canonical baseline and no such equality claim.

The existing actual 100/300-person same-input record/decision-digest, totals and measures matches remain valid scoped evidence at their recorded identities. Prior original-outcome replay, rollback, isolation, private disposal and affected-reader checks remain separately labelled. They do not make this canonical request pass. Existing Low FUCQ-348 is separate and unfixed, with its post-CAS assertion unrun. Full suite, native PostgreSQL and F71 native new-process readback remain unrun. The internal memory/ownership-only UI exclusion remains unchanged.

All three earlier clean canonical failures, canonical-v3's 245.865-second sampling gap and unexplained clocks, v1's pre-admission observer protocol failure, and v2's instrumented OOM with its WeakRef same-job-lifetime caveat remain preserved separately. This clean failure establishes that the current reviewed bytes can still exhaust the canonical heap without that observer. It does not identify the cause or explain the instrumented v2 result.

## Teardown and next decision

Independent audit at 16:08:45 UTC found owned group 28070 gone, `/private/tmp/test-stamp-shard-c1caad1d50e947a7a2b2d26130584410` absent, its manifest in `removed` state, and the reservation released. The shared registry was empty at audit. All **57** recorded Ralph supervisor roots were independently absent. Peak measured scratch allocation was zero bytes; there was no large artifact or compatibility exception. Bounded plans, summaries, source scripts and useful logs are retained here. The pre-existing unconfirmed 102,133-byte `jira_sync` bytecode remains preserved.

The next diagnosis recommendation, based only on existing evidence, is to distinguish failure during the first buddy large preparation commit/helper return from the later plan-read/cursor/quote/cache/claim path. The retained v2 trace lists these boundaries but cannot prove which clean operation fails. Independent architecture/diagnosis review should choose one separately authorised, bounded scalar-phase observation without WeakRefs/dereferences, graph walks, forced GC, injected stops or extra worker yields before selecting another production change. This is a recommendation, not authorisation for another run.

`metrics.json` gives the bounded result; `summary.json` and `supervisor-receipt.json` preserve actual observations; `identity-audit.json`, `cleanup.json` and `cleanup-audit.json` establish identities and filesystem/process evidence. `http.mjs`, `dependency-resolve.mjs` and `supervisor.py` preserve the executed bytes. The original story acceptance boxes and In Progress state remain unchanged pending parent final review.
