# GCSP performance tuning backlog — 12 November 2026

Russell requested a performance tuning Epic if none existed, with the source-derived improvements split into User Stories of at most eight points. This request specifically authorises this Epic/Story publication; the project-wide pause remains in place for unrelated Jira writes. This is backlog authoring only. No implementation, poller, load run or overnight execution is started.

## Basis and overlap

All 31 native FUCQ Epics were inspected on 12 November; none covers this matching/release performance capability. FUCQ-12 concerns strategic EV weighting, not execution performance.

The [release investigation](presenter-release-db-diagnosis-2026-11-11.md#follow-up-efficiency-derived-from-the-code) establishes avoidable work from source revision `81c14be947d4185b65f8ab2042005dbbaf131783`. It does not establish a safe hosted release count or the cause of a database outage.

Existing native items were read for overlap: FUCQ-177 is the related slow-PostgreSQL Bug; FUCQ-247 is the completed performance review. FUCQ-302 concerns memory-repository copies, FUCQ-303 static assets, FUCQ-304 gallery payloads, FUCQ-305 presenter event-loop/readback work, FUCQ-306 presenter mounting, FUCQ-307 frontend bundles, FUCQ-308 Node memory measurements, FUCQ-309 comparison-worker memory and FUCQ-310 planning-catalogue coverage. This publication adds the bounded remaining computation/persistence work without rewriting those tickets or implying acceptance.

Already shipped immutable policy read scopes, compact clock allocation summaries, filtered notification checks and attempted-claim quote reconstruction are baseline behaviour. Retain history through identities and immutable evidence references; deleting audit history is not an optimisation proposal.

## Story split

The [structured publication record](performance-tuning-stories-2026-11-12.json) contains full goals, decisions, acceptance, file areas, exclusions, validation commands and publication receipts. Estimates are provisional Fibonacci estimates, including scoped verification: **17 Stories, 102 points; two at 3, eight at 5, seven at 8**. Re-estimate actual remaining work at pickup while retaining the eight-point cap.

| Jira Story | User Story | Points | Interface prerequisite |
| --- | --- | ---: | --- |
| [FUCQ-409](https://ibm-consulting.atlassian.net/browse/FUCQ-409) | Resolve allocation stock rows through an order-ID index | 3 | None |
| [FUCQ-410](https://ibm-consulting.atlassian.net/browse/FUCQ-410) | Resolve decline exclusions through indexed history | 5 | None |
| [FUCQ-411](https://ibm-consulting.atlassian.net/browse/FUCQ-411) | Track allocation occupancy through identity Sets | 5 | None |
| [FUCQ-412](https://ibm-consulting.atlassian.net/browse/FUCQ-412) | Compile immutable eligibility rules for direct lookup | 5 | None |
| [FUCQ-413](https://ibm-consulting.atlassian.net/browse/FUCQ-413) | Compile immutable price and allowance lookups | 5 | None |
| [FUCQ-414](https://ibm-consulting.atlassian.net/browse/FUCQ-414) | Reuse validated immutable stock snapshots across employees | 5 | None |
| [FUCQ-415](https://ibm-consulting.atlassian.net/browse/FUCQ-415) | Reuse configuration equipment evidence | 5 | None |
| [FUCQ-416](https://ibm-consulting.atlassian.net/browse/FUCQ-416) | Score the current-car baseline once per employee evaluation | 3 | None |
| [FUCQ-417](https://ibm-consulting.atlassian.net/browse/FUCQ-417) | Evaluate allocation candidates without building a gallery | 8 | None |
| [FUCQ-418](https://ibm-consulting.atlassian.net/browse/FUCQ-418) | Reuse unchanged static suitability across releases | 8 | FUCQ-417 |
| [FUCQ-419](https://ibm-consulting.atlassian.net/browse/FUCQ-419) | Read allocation triggers and receipts through indexed SQL | 8 | None |
| [FUCQ-420](https://ibm-consulting.atlassian.net/browse/FUCQ-420) | Consume pending triggers without replaying unchanged history | 8 | FUCQ-419 |
| [FUCQ-421](https://ibm-consulting.atlassian.net/browse/FUCQ-421) | Maintain a transactional run revision for freshness checks | 8 | None |
| [FUCQ-422](https://ibm-consulting.atlassian.net/browse/FUCQ-422) | Record explicit row mutations in repository transactions | 5 | None |
| [FUCQ-423](https://ibm-consulting.atlassian.net/browse/FUCQ-423) | Flush PostgreSQL changes from explicit mutation sets | 8 | FUCQ-422 |
| [FUCQ-424](https://ibm-consulting.atlassian.net/browse/FUCQ-424) | Hydrate only state needed by small receipt transactions | 8 | FUCQ-422, FUCQ-423 |
| [FUCQ-425](https://ibm-consulting.atlassian.net/browse/FUCQ-425) | Batch PostgreSQL evidence hydration within memory bounds | 5 | None |

The local lookup, policy and immutable-data changes can be delivered independently, with shared-file ownership coordinated. The genuine chains are compact evaluation → static reuse, selected receipt reads → pending-trigger consumption, and mutation journal → PostgreSQL flush → scoped receipt hydration. Jira dependencies are context; technical readiness is assessed from actual agreed interfaces at pickup.

The eight-point scopes deliberately exclude ranking changes, top-K truncation, dynamic-gate caching, distributed caches, a scheduler replacement, all-at-once legacy removal and general partial hydration of every transaction. Story 16 targets existing small receipt commands; a future consumption cursor is not a prerequisite or deliverable, and broader domain hydration needs separate future scope. Evidence batching is independent and bounds both digest count and bytes.

## Acceptance and validation

Every Story preserves current gates, preference scores, deterministic fleet order, full fallback candidates, exact identities, pinned versions and historical explanations where affected. Transaction stories preserve replay, rollback, CAS, cross-instance freshness and authoritative occupancy. Database changes require native PostgreSQL evidence on the changed paths; skipped or unavailable checks are reported as such.

Stories cite [build rules](build-rules.md), the [demo brief](demo-brief.md) and the [experience contract](experience-quality.md). These backend improvements introduce no new layout. Existing presentation contracts remain binding; connected release/offer/history outcome changes require independent rendered review at desktop and narrow widths, including realistic difficult states.

Authoring verification is limited to payload consistency, estimates, actual source/test paths, dependency references and native Jira read-back. No runtime regression or load tests are warranted merely to create backlog entries. Scoped local checks passed for all 17 unique keys, the point distribution, publication receipts, dependency references, existing source/test paths, map associations and exact preservation of every prior map record. `git diff --check` passed.

## Publication and resources

Publication is **complete**: [FUCQ-408 — Improve GCSP matching and release performance](https://ibm-consulting.atlassian.net/browse/FUCQ-408), with Stories **FUCQ-409–425**. Native read-back verified all 17 children, exact titles and description content (normalising Jira Markdown rendering), points, parent, labels, To Do status and unassigned state. The five genuine Blocks links are FUCQ-417 → FUCQ-418, FUCQ-419 → FUCQ-420, FUCQ-422 → FUCQ-423, FUCQ-422 → FUCQ-424 and FUCQ-423 → FUCQ-424. Dependent descriptions name the actual prerequisite keys. The final publisher audit was observed at **15:49:37 UTC on 12 November 2026**. Independent native read-back by Cogsworth at **15:51:03 UTC** returned exactly the Epic and 17 children, confirmed the 102-point total and eight-point cap, and verified the five Blocks links with no extra links on the linked children. This independent pass checked metadata and links; Pluto verified full descriptions.

Russell declined foreground browser publication and requested Jira reconnection. The renewed Atlassian authorisation succeeded, and fresh child sessions verified native connectivity. Publication used native Atlassian tools; the original inactive tab was restored to the FUCQ board (2336), with other tabs preserved. The connector rejected an explicit null assignee on the first Epic creation attempt; a duplicate check confirmed no issue was created, and the corrected request created the verified unassigned Epic. There are no unresolved publication failures.

The component registry associates these verified keys with their existing product capabilities. Durable work records retain them as unassigned To Do Stories, explicitly unsliced with no worker claims. This records planned work and does not claim implementation or acceptance. Product-map publication remains under the configured Actions workflow; a served refresh has not been verified by this authoring task.

Agent selections for reconnection/publication: Cogsworth (scoper), requested/selected `gpt-6-luna` / `high`, verified native connectivity and independently audited final fields/links; Pluto (implementer), requested/selected `gpt-6.1-sol` / `medium`, publishes the exact reviewed payload and verifies native fields. No fallback or descendants. The parent retains responsibility for records, product-map associations and commit/push. OAuth processes have exited; no test or scratch process remains from reconnection.

Resource plan: retained records under 1 MiB, bounded page extracts under 25 KiB per call, no test workers, no scratch roots or generated large files. No cleanup allocation is required. Independent decomposition, sizing and payload review: Taz, requested/selected `gpt-6.1-sol` with `high` effort, no fallback or descendants; no runtime calls, tests or scratch. Review corrections preserve current price ambiguity and first-match allowance semantics, exact stock identity (including existing rejection of VIN-bearing stock snapshots), activeCodes invalidation and existing-only transaction mutation scope.

Added by: Russell Gowers, authored with Codex.

