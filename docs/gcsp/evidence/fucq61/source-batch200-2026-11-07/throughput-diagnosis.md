# F61 checkpoint throughput — Medium Bug intake

Stable intake marker: `f61-repeated-source-binding-checkpoint-20261107`. Origin: FUCQ-61 bulk source collection, using FUCQ-59 generic batch capability (commit e07feb890c3ec6e0a0dfbd2b9df3b3247d045c40). This is an independent Medium backlog Bug and does not block or expand those Stories.

Reproduction: compare first/last solver-start intervals in the actual32 source trace, then run the finite actual200 allocation with one worker and no retries. Actual32 mean intervals rose from 327.6 ms for its first eight starts to 1198.3 ms for its last eight. Actual200 reached only 53 requests in 119.241 s and its supervisor stopped at 492,797,952-byte child RSS. The source transport returned all 57 HTTP 200 responses; the observed slowdown occurs in source processing/checkpoint work.

Diagnosis: `scripts/gcsp/collect-fleet.mjs:createPublicBatchCollector.validateState` rebuilds and qualifies every existing source binding on every checkpoint, then `register()` rebuilds it again; accepted membership checks use pairwise full-record canonical digests. The common session commits at multiple request phases. Cost therefore grows with retained rows. Memory growth is observed; its exact allocation attribution remains unmeasured. Source settings, rate and capacity are not established causes.

Expected: bounded source batches retain exact source integrity while processing and memory scale sufficiently for their registered budget. Validation target: compare bounded chunk elapsed time/RSS and retained tamper-refusal semantics on the same code/input identity.

Temporary authorised workaround: independent 32-candidate (or 16 if needed) chunks, each with fresh alias/definition qualification, exact limits and cross-chunk canonical dedup. No production hot-path repair is included. The separate operational interruption-retention error is documented in this allocation's receipt and will be fixed before further source traffic.

Jira intake attempted 7 November 2026: existing-Bug search and FUCQ-61 origin/type read both failed with `unauthorized_client: refresh_token is invalid`; no Jira write occurred. Root receives this exact diagnosis for creation/reuse through its authenticated lane.
