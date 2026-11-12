# GCSP performance tuning backlog — 12 November 2026

Russell requested a performance tuning Epic if none existed, with the source-derived improvements split into User Stories of at most eight points. This request specifically authorises this Epic/Story publication; the project-wide pause remains in place for unrelated Jira writes. This is backlog authoring only. No implementation, poller, load run or overnight execution is started.

## Basis and overlap

All 31 native FUCQ Epics were inspected on 12 November; none covers this matching/release performance capability. FUCQ-12 concerns strategic EV weighting, not execution performance.

The [release investigation](presenter-release-db-diagnosis-2026-11-11.md#follow-up-efficiency-derived-from-the-code) establishes avoidable work from source revision `81c14be947d4185b65f8ab2042005dbbaf131783`. It does not establish a safe hosted release count or the cause of a database outage.

Existing native items were read for overlap: FUCQ-177 is the related slow-PostgreSQL Bug; FUCQ-247 is the completed performance review. FUCQ-302 concerns memory-repository copies, FUCQ-303 static assets, FUCQ-304 gallery payloads, FUCQ-305 presenter event-loop/readback work, FUCQ-306 presenter mounting, FUCQ-307 frontend bundles, FUCQ-308 Node memory measurements, FUCQ-309 comparison-worker memory and FUCQ-310 planning-catalogue coverage. This publication adds the bounded remaining computation/persistence work without rewriting those tickets or implying acceptance.

Already shipped immutable policy read scopes, compact clock allocation summaries, filtered notification checks and attempted-claim quote reconstruction are baseline behaviour. Retain history through identities and immutable evidence references; deleting audit history is not an optimisation proposal.

## Story split

The [structured publication record](performance-tuning-stories-2026-11-12.json) contains full goals, decisions, acceptance, file areas, exclusions, validation commands and publication receipts. Estimates are provisional Fibonacci estimates, including scoped verification: **17 Stories, 102 points; two at 3, eight at 5, seven at 8**. Re-estimate actual remaining work at pickup while retaining the eight-point cap.

| # | User Story | Points | Interface prerequisite |
| --- | --- | ---: | --- |
| 1 | Resolve allocation stock rows through an order-ID index | 3 | None |
| 2 | Resolve decline exclusions through indexed history | 5 | None |
| 3 | Track allocation occupancy through identity Sets | 5 | None |
| 4 | Compile immutable eligibility rules for direct lookup | 5 | None |
| 5 | Compile immutable price and allowance lookups | 5 | None |
| 6 | Reuse validated immutable stock snapshots across employees | 5 | None |
| 7 | Reuse configuration equipment evidence | 5 | None |
| 8 | Score the current-car baseline once per employee evaluation | 3 | None |
| 9 | Evaluate allocation candidates without building a gallery | 8 | None |
| 10 | Reuse unchanged static suitability across releases | 8 | #9 |
| 11 | Read allocation triggers and receipts through indexed SQL | 8 | None |
| 12 | Consume pending triggers without replaying unchanged history | 8 | #11 |
| 13 | Maintain a transactional run revision for freshness checks | 8 | None |
| 14 | Record explicit row mutations in repository transactions | 5 | None |
| 15 | Flush PostgreSQL changes from explicit mutation sets | 8 | #14 |
| 16 | Hydrate only state needed by small receipt transactions | 8 | #14, #15 |
| 17 | Batch PostgreSQL evidence hydration within memory bounds | 5 | None |

The local lookup, policy and immutable-data changes can be delivered independently, with shared-file ownership coordinated. The genuine chains are compact evaluation → static reuse, selected receipt reads → pending-trigger consumption, and mutation journal → PostgreSQL flush → scoped receipt hydration. Jira dependencies are context; technical readiness is assessed from actual agreed interfaces at pickup.

The eight-point scopes deliberately exclude ranking changes, top-K truncation, dynamic-gate caching, distributed caches, a scheduler replacement, all-at-once legacy removal and general partial hydration of every transaction. Story 16 targets small receipt/cursor commands; broader domain hydration needs separate future scope. Evidence batching is independent and bounds both digest count and bytes.

## Acceptance and validation

Every Story preserves current gates, preference scores, deterministic fleet order, full fallback candidates, exact identities, pinned versions and historical explanations where affected. Transaction stories preserve replay, rollback, CAS, cross-instance freshness and authoritative occupancy. Database changes require native PostgreSQL evidence on the changed paths; skipped or unavailable checks are reported as such.

Stories cite [build rules](build-rules.md), the [demo brief](demo-brief.md) and the [experience contract](experience-quality.md). These backend improvements introduce no new layout. Existing presentation contracts remain binding; connected release/offer/history outcome changes require independent rendered review at desktop and narrow widths, including realistic difficult states.

Authoring verification is limited to payload consistency, estimates, actual source/test paths, dependency references and native Jira read-back. No runtime regression or load tests are warranted merely to create backlog entries.

## Publication and resources

Publication is prepared. The authenticated background Jira UI is available, but click handling pauses in an inactive tab; the Jira connector is unavailable. A request to briefly focus Jira is pending. No Epic or Story has yet been created. Restore the original task tab to the board after publication and preserve the user's other tabs.

Resource plan: retained records under 1 MiB, bounded page extracts under 25 KiB per call, no test workers, no scratch roots or generated large files. No cleanup allocation is required. Independent decomposition and sizing review: Taz, requested/selected `gpt-6.1-sol` with `high` effort, no fallback or descendants; no runtime calls, tests or scratch.

Added by: Russell Gowers, authored with Codex.

