# FUCQ-309 scalar preparation diagnostic, 10 November 2026

The one authorised diagnostic **failed with `ERR_WORKER_OUT_OF_MEMORY` at 168.279 host-observed seconds**, after the first buddy preparation had **returned `ok`**. All 752 evaluation receipts, the large-plan receipt, the backend commit and normalization completed. The later failing operation and retaining cause remain unknown. This transformed run is diagnostic evidence only; canonical acceptance remains unmet.

## What the phases establish

The intact log contains three exact source-transform hashes, one matching input identity and 20 consecutive scalar phase lines, below the 60-line phase cap and 2 MiB log cap. The target was comparison-a/buddy with 1,000 employees, 850 cars, input hash `53bcb43e78caefd6fef8c5c08e25454b1871c89af65369d624bb39af5b123509` and policy hash `90da819d8ae50fb0a09073e34403abc6c2f411198e8eaaf514302afd014e96b4`.

| Observed boundary | Worker observer seconds | Outcome |
| --- | ---: | --- |
| Preparation function entry | 130.631 | Entered |
| Preparation built | 139.113 | 29,016 contenders; 752 slices |
| Backend callback before | 139.114 | Reached after acquisition/draft creation |
| Actual allocator callback entry | 139.114 | Entered |
| Cursor receipt complete | 139.116 | `ok` |
| Final evaluation receipt | 139.263 | 752/752; `ok` |
| Large-plan receipt complete | 139.611 | `ok` |
| Backend callback complete | 139.611 | Commit `true` |
| Normalization after | 140.344 | Setter returned |
| Preparation helper returned | 140.345 | `ok` |

The first preparation record and normalization boundary was crossed. The observation intentionally finishes at helper return. The later plan-read, cursor, quote, cache and claim path is **unlocalized**, and absent later markers exclude none of those operations. These markers do not prove natural GC timing, identify an exact clone/retainer, or justify a production fix. Scalar calls, loader overhead and synchronous logging can change timing and GC. Worker observer and host durations have different origins; the table labels its clock explicitly.

## Authorised attempt and result

The parent read all 11 replacements across three files, the observer and inference table, and separately authorised one attempt. Launch waited for the parent's explicit FUCQ-348 reservation-release signal. `parent-decision.json`, `authorization-frozen.json` and `admission.json` preserve that sequence. The original `plan.json`, `plan.md` and observer retain their historical plan-only wording; their reviewed bytes were preserved instead of rewritten after authorisation.

Prelaunch HEAD was clean and pinned at `6a7acab973c88a95371ad355223a30bdc3e2ef4c`, tree `e5080304097c90e7b465742dd98cfa290b673725`. The 303 production files, 65 existing dependency files, Node v26.7.0 binary and executable identities matched before and after the run. The parent-frozen observer, transforms and patch hashes matched. Production files were never edited. The diagnostic load hook changed only the three reviewed in-memory source strings; all exact anchors and original/transformed hashes were checked. There were no business graph arguments, WeakRefs/dereferences, graph walks, forced GC, phase-triggered stops, extra worker yields or diagnostic worker protocol messages. The inherited dependency hook only resolves existing `pg`.

The local actual HTTP request returned **202** at 16:21:40 UTC and the original six-step worker plan was received. The request kept 1,000 employees, three seeds and both routes, no overlay, 128 MiB old / 16 MiB young heap and 1,800-second application policy. A single worker had a 600-second outer command bound, 768 MiB RAM reservation and 32 MiB scratch budget. Fresh admission found an empty registry, 17.51 GiB disk free and 5.85 GiB available RAM headroom. Because disk was below the preferred 30 GiB, the attempt stayed serial and bounded to the small 32 MiB chunk while preserving the 5 GiB emergency reserve.

Current comparison-a completed at 121.013 host seconds. Final job status was truthfully failed at **1/6 steps, 0/3 completed seeds**, with **zero queried result rows**, no stored result and no result file. The supervisor's `complete` state means command and cleanup finished: command exit was 1, without a resource-supervision issue. It refused automatic retry.

The command lasted 169.494 supervisor seconds; the harness measured 169.145 monotonic and 169.145 wall seconds. Sampled worker used heap peaked at **122.62 MiB**, process RSS at **492.89 MiB** and separately sampled group RSS at **492.72 MiB**. Samples have different timestamps; these are observations of this instrumented attempt, not cross-run performance evidence.

All 119 sampled health and job-latest requests returned 200; process-result returned the expected 404. Maximum observed latency was 3.205 ms health, 4.284 ms process-result and 2.694 ms job-latest. Maximum host-sample gap was 3.795 seconds. These samples do not establish continuous responsiveness.

## Validation limits and teardown

Complete-result input/record/totals/measures/digest/immutability assertions were **UNRUN** because no complete result existed. There is no successful unchanged 1,000-person canonical baseline. Existing exact 100/300-person same-input record/decision/totals/measures evidence remains scoped. All earlier clean failures, canonical-v3's 245.865-second sample gap and unexplained clocks, v1's observer protocol failure, and v2's instrumented OOM/WeakRef same-job-lifetime caveat remain separately preserved. This run does not explain those outcomes. Full suite, native PostgreSQL and F71 process readback are unrun. The parent reports FUCQ-348 resolved and independently integrated at `faaa13cb`, with its same-module checks 3/3; this diagnostic did not retest or change that separate fixture repair. Earlier plan and story statements that called it unfixed retain their historical scope. The internal memory-only UI exclusion remains unchanged.

Independent teardown audit at 16:24:41 UTC found group **45977** absent, owned scratch `/private/tmp/test-stamp-shard-af489f3e06ad4b28abea43f49bcf0ed7` absent with manifest `removed`, reservation released and registry empty. All **58** recorded Ralph supervisor roots were independently absent. Peak measured scratch allocation was **zero bytes**; there was no compatibility exception or large output. The pre-existing unconfirmed 102,133-byte `jira_sync` bytecode was preserved. Only bounded evidence is retained here.

No retry, new localisation or production edit followed. Original acceptance boxes and In Progress state stay unchanged. Parent final review owns the next diagnosis/architecture decision, Jira, integration and closure. `phase-audit.json`, `scalar-phases.json`, `failure.log`, `summary.json`, `metrics.json`, the executed sources and cleanup/identity receipts preserve the evidence.
