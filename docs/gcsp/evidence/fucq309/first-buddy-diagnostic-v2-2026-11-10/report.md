# FUCQ-309 corrected first-buddy diagnostic — 10 November 2026

**INSTRUMENTED OOM; the first-claim checkpoint was not reached. This is not a clean reproduction of the reviewed production repair or proof of a retaining cause.** The observer dereferences every WeakRef at each phase; a successful dereference keeps the target alive through the current JavaScript job. In particular, snapshot/plan/wrapper observations can extend transient liveness during the preparation transaction despite having no persistent strong graph roots. No production edit or further proof followed this run.

The parent authorised exactly one corrected `first-buddy-claim-v2` attempt after the preserved v1 observer admission failure. This version kept source-hook observations on bounded stderr and gated runtime port messages on a flag set only after the original worker `plan` post. HTTP admission returned 202, and the six-step plan preceded all runtime observations. The original v1 failure is preserved at `../first-buddy-diagnostic-2026-11-10/` and committed in `54aa281fcb96df28ad5743c18c010f68c8b5e224`.

The run used that clean evidence commit/tree, with all production executable hashes identical to reviewed repair `9bcd3e865be5b4e9df43b031e8742f866f1f9fb2`. Request: actual local HTTP `process-only`, no overlay, 1,000 employees, comparison-a/b/c, current+buddy six steps, 128 MiB old / 16 MiB young, 1,800-second worker/job policy. Fixed scenario time: `2026-11-10T12:00:00.000Z`. Current and buddy each reported 850 stock rows and exactly the same first-seed input hash `53bcb43e78caefd6fef8c5c08e25454b1871c89af65369d624bb39af5b123509` and policy hash `90da819d8ae50fb0a09073e34403abc6c2f411198e8eaaf514302afd014e96b4`.

| Measured boundary | Worker-observer elapsed seconds |
| --- | ---: |
| Current open / ready | 1.121 / 9.172 |
| Current closed / buddy open | 154.046 / 154.046 |
| Buddy ready | 165.820 |
| Buddy preparation starts | 171.068 |
| Snapshot transaction backend start / complete | 171.069 / 171.084 |
| Snapshot normalization start / end | 171.084 / 171.088 |
| Snapshot loaded | 171.088 |
| First plan prepared: 29,016 contenders, 752 evaluated employees/slices | 183.193 |
| Preparation transaction backend-work-start: last marker | 183.194 |

The host harness received `ERR_WORKER_OUT_OF_MEMORY` at 184.263 seconds and the final failed job at progress 1/6, zero completed seeds and **zero queried stored comparison-result rows**. The final reason was the 128 MB allowance. No second backend-work-complete/normalize marker, preparation-helper return, repaired plan read, quote projection/cache or claim return was observed. The exact terminal operation is unknown. `backend-work-start` occurs only after queue acquisition and the shallow draft/table-array copy; it does not mark transaction entry.

The supervisor measured 185.250 seconds and 327,565,312 bytes (312.39 MiB) peak process-group RSS. One-second heap sampling observed at most 116,969,360 bytes (111.55 MiB) used heap; this is a sampled value, not the terminal maximum. All 127 active host samples answered: health max/p95 5.564/1.310 ms, process max/p95 20.346/1.927 ms, latest max/p95 8.649/2.927 ms. The largest observed host-sample gap was 3.804 seconds. These support responsiveness at measured intervals, not continuous responsiveness, a new SLA or a speed comparison.

Current store and pool weak references were dead at buddy ready without forced GC. This excludes only those observed weak objects; it does not exclude all residual current data. Buddy store/pool and preparation snapshot/planned wrapper/plan/slices were alive at the final marker. Their observed liveness does not distinguish necessary live inputs, observer-extended lifetime and a production retainer. No graph walk, forced GC, larger heap, smaller cohort or policy shortcut was used.

The persisted plan reserved one 768 MiB process group and 32 MiB scratch under the shared machine registry. Inner diagnostic cap: 570 seconds. The v2 supervisor explicitly clamps the actual process timeout to its `--seconds 600`, confirmed as `effective_timeout_seconds: 600` in its receipt. This avoids confusing an estimated unit duration with the executor's larger default timeout. The limit was not reached.

Cleanup is independently verified: group 12353 has no members, `/private/tmp/test-stamp-shard-f290e2393b4945149f5358de20a68751` is absent, the external ownership manifest remains as a receipt with state `removed`, and that reservation is released. Peak scratch file allocation was zero. No compatibility exception or owned leftover remains; prior unconfirmed 102,133-byte jira_sync bytecode was preserved. This folder contains only bounded scripts/plan/summary/failure log/receipts.

The original three clean canonical failures remain separate. Their 1/6 progress/zero results, unknown terminal operation, canonical-v3 245.865-second host-sampling gap and unexplained application/supervisor clocks are not resolved by v2. Full suite, native PostgreSQL and F71 native new-process readback remain unrun. Existing Low FUCQ-348 remains separate and unfixed, with its post-CAS assertion unrun. Original acceptance and In Progress status remain unchanged; parent owns integration/merge/closure.

The read-only continuation trace and next-check recommendation are in `post-marker-trace.md`. Independent review should first decide whether the observer liveness effect warrants one uninstrumented actual HTTP canonical acceptance attempt on the reviewed repair before any production change. No such attempt is authorised or launched by this report.

Agent: Ralph Wolf, requested/selected gpt-6.1-sol/xhigh; no fallback or descendants.
