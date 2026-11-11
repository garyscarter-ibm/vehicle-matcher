# Presenter Next release: database diagnosis, 11 November 2026

**Recommendation:** start with operation-scoped policy reuse, compact allocation summaries in the clock, and fewer outbox checks. These address verified amplification without replacing the repository. Selective SQL access is the next, larger step.

Russell reports very slow Presenter **Next release** actions and two production incidents where the page showed “presenter view unavailable” and Render showed the database service unavailable. The code contains unnecessary database work and repeated storage of historical results. **The cause of the database becoming unavailable remains unconfirmed.** No production release, reset, query or benchmark was executed. Render incident logs and resource metrics were unavailable through this session's existing access; the deployed revision and effective production settings are also unverified.

Diagnosis basis: `gcsp-poc` at `d6292e2c7b114c9cdd1d2478d1346de37c63fa70`. Existing High-priority [FUCQ-177](https://ibm-consulting.atlassian.net/browse/FUCQ-177), observed In Review, covers PostgreSQL demo performance. Its older timings are historical observations, not measurements of today's deployment. No Jira scope, status or acceptance criteria were changed.

## Authorised implementation and delivery, 11 November

Russell subsequently instructed: “go ahead and push, we need this fix in live to test it. Native won't prove much.” The first three bounded changes below were implemented against `c4aa0038`. While pushing local commit `680b6b8c`, remote `gcsp-poc` advanced to `80216747` with a concurrent allocation-memory fix. Integration retains that fix's count-only summaries and legacy clock compaction, together with the local policy and outbox changes. Live testing is authorised instead of a disposable native PostgreSQL performance gate. The original diagnosis and measurements below remain historical evidence; this delivery does not establish the cause of the Render database outages or full FUCQ-177 acceptance.

- Policy reads reuse the immutable pinned run/version within a recommendation or clock operation. Nested scopes and the runtime's publication facade share the same in-flight snapshot; independent services and subsequent operations remain isolated. Unpinned version discovery stays fresh.
- The clock's allocation consumer returns event, offer and evaluation counts. It avoids hydrating historical evaluation slices and repeatedly storing full quote/recommendation graphs; clock boundaries also compact older handler outcomes. Explicit allocation callers still receive full results. Producer payload digests are checked before projection; interrupted claims retain the original durable plan and quote. Presenter reads the new counts and retains compatibility with older results.
- Committed transactions tell observers which tables changed. Notification dispatch runs after outbox changes, while startup and clock handlers retain pending/retry recovery. Rollback, command replay and recursive notification bookkeeping do not cause additional dispatches. Custom adapters without the hint retain the previous behaviour.

Validation is scoped: **272 distinct passing checks**, with nine native-database or unsupported fixture subprocess checks skipped. The unchanged migration-discovery test was explicitly excluded because its hard-coded list stops at 0008 although baseline already includes 0009; no migration changed. No full suite or native performance benchmark was run. The integrated clock/Presenter chunk passed 37/37; allocation passed 51 with one native skip. Unchanged policy/recommendation and outbox/repository module evidence is reused alongside these new integration checks.

The selected modules cover policy results/provenance and publication, recommendation callers, tick/reset and command replay, allocation conflicts and pending receipt variants, real Buddy claim integration, identity/ownership, Presenter counts/controls, outbox recovery and memory/PostgreSQL driver-double repository contracts. The six-release runtime regression retains 388,151 logical JSON bytes of canonical allocation detail while the final Buddy clock outcome is 147 bytes. These are memory-runtime logical JSON measurements, not native storage or production timings. During validation, the existing allocation fixture was restored to its documented three-person population after Greg acquired an employee role; the reset fixture now uses the actual CAS version and asserts success. New counter fixtures initially tried to mutate the frozen repository; corrected wrapper coverage passed, and integration retains the upstream allocation counter regression. Initial failures remain in local evidence.

This backend refactor preserves the existing presentation contract: no markup, styles, controls or calculated recommendation results change. Presenter consumer checks establish equivalent states for compact and older results, with invalid/foreign counts refused; new screenshots are unnecessary for this change. Independent reviewer Cecil Turtle (`gpt-6.1-sol` / `high`, requested and selected, no fallback) found no remaining production shipping blocker after the policy-facade correction and reviewed the concurrent allocation/clock implementation. Cogsworth implemented the policy/recommendation/clock scope and checked the integration (`gpt-6.1-sol` / `medium`, requested and selected, no fallback).

Local evidence: `.claude/test-runs/presenter-release-fix-20261111/summary.json` and `.claude/test-runs/impact/presenter-release-integrated-559eff79528c0acd.json` contain source hashes, selected boundaries, timings, initial failures and reuse limits. All eight supervisor-owned scratch roots were verified absent, all child process groups exited, and reservations were released; sampled scratch allocation was zero bytes. Retained bounded logs total about 56 KiB. No compatibility exceptions or leftovers.

Push to `gcsp-poc` triggers the `gcsp-api` Render deployment. Verify the deployment's exact commit and both `/health` and `/health/vehicle-evidence` before calling it live. Live trial: reopen Presenter against the retained run, note current time/stock/offer counts, press **Next release** once, and check completion plus resulting stock/offers. Record observed latency and any unavailable state; do not infer incident resolution from health endpoints alone. No production reset or release was triggered for local validation.

## What was demonstrated locally

### Follow-up: repeated releases during the demo

Russell asked whether the combined fixes make it safe to advance many releases while waiting for Paula's preferred car. They remove verified amplification; **they do not establish a safe hosted release count or resolve the unconfirmed database-outage cause**.

The six-release regression uses **six batches of 12 synthetic cars**, with one impossible 99-seat brief, in the memory runtime. It verifies small clock/command results, idempotence and preserved canonical detail while the candidate pool grows to at least 72 cars. The equivalent native PostgreSQL case was skipped. This is not six 100-car generated releases or a live capacity/latency result. Retained delivery evidence records successful deployment/health at 21:40–21:41 UTC on 11 November, with `production_release_triggered: false`; it is a historical observation, not current deployment verification.

Each actual release still adds stock and receipts. An active unmatched employee can be evaluated against the cumulative available pool, producing further canonical decision evidence. The PostgreSQL adapter still fingerprints run tables for writes, may hydrate a full run on cache misses, and holds the run lock through write processing. Old large durable receipts were not deleted. Routine clock outcomes are now compact; the whole workload is not constant-cost or bounded independently of history.

For the demo, prefer a rehearsed known matching release or agreed supply adjustment over an open-ended search by repeated releases. A bounded sequence can be assessed through actual completion times and database/application metrics; no safe count is inferred from the local regression. Also, an occupying offer can prevent another allocation for Paula, and advancing releases advances domain time. No live release, reset, benchmark, new test or scratch allocation was performed for this read-only follow-up. Independent source/evidence review: Taz, requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants. Jira writes remain paused.

**Terminology clarification:** a small offer/accept/decline audit linked by IDs is not inherently expensive. The remaining history concern involves allocation evaluations for all considered cars, beyond the employee's final decision. `packEvaluation()` already stores `[orderUuid, variantIndex]` pairs and deduplicated result variants. Those variants contain eligibility status, score, reasons, blockers, unknowns and version references. Contending employees also retain frozen quote inputs. Pending allocation plans hold their candidate pool and version metadata; completion replaces the main plan with outcome references. Selected configuration evidence is separately deduplicated in PostgreSQL. It would be inaccurate to describe this as copying every full recommendation or quote for every car.

The cost to assess is producing successive evaluations of the growing pool, retaining their results, traversing historic triggers, and the repository's broad fingerprint/cache-miss reads. For example, with all cars still available, three 100-car releases can require 100 + 200 + 300 car evaluations for one unmatched employee. ID references to immutable, versioned evidence with selective reads are a valid design direction; simply joining mutable current facts would lose the historical explanation. The 388,151-byte observation measures expanded allocation output returned to an explicit detail caller, not packed stored rows or PostgreSQL storage. It does not establish a database capacity problem. No live measurement attributes an outage to decision-history size.

The probes used real application modules with small synthetic memory/file fixtures and captured-only mail. Counts below are **application calls**, not measured PostgreSQL statement counts. Sizes are **logical JSON bytes**, not PostgreSQL disk, TOAST or WAL usage.

| Probe | Observation |
| --- | --- |
| One consenting employee, six newly released cars | 144 policy loads, including 143 pinned to the same version; 30 transaction calls; 28 outbox scans |
| Exact replay of that command | Identical outcome, no handler re-execution |
| One employee recommendation, 50 candidate cars | Existing implementation: 105 provider loads; operation-scoped prototype: 1; complete output and provenance deeply equal |
| Same prototype at zero and one candidate | Loads fell from 5 and 7 respectively to 1; complete outputs equal |
| Two fresh ticks after a release, before another release was due | Each repeated the same 103,298-byte historical allocation outcome and added 334,736 logical receipt bytes; actual stock-release receipts stayed at one |

Local memory execution time is not evidence of production latency. No native PostgreSQL speedup or outage recovery has been proved.

## 1. Resolve an immutable policy once per operation

Every typed policy read calls `loadVersions` ([policy/index.js:28](../../server/gcsp/policy/index.js#L28)). Even with a warm PostgreSQL policy cache, that performs a database header query ([postgres-provider.js:99](../../server/gcsp/policy/postgres-provider.js#L99)). Recommendation reads allowance plus four assumptions, then eligibility and points sequentially for every candidate ([recommendation/index.js:108](../../server/gcsp/recommendation/index.js#L108), [line 181](../../server/gcsp/recommendation/index.js#L181)). Quote rebuilding can evaluate again.

That is at least `5 + 2 × candidate cars` policy loads per employee evaluation. For illustration, 20 employees and 50 candidates imply at least 2,100 header checks on a warm PostgreSQL provider, before other consumers. This is a code-derived example, not a production count.

Resolve the immutable snapshot once at an operation boundary and let existing typed methods reuse it for the pinned run/version. Preserve validation, missing-version errors, provenance and isolation. Discover the active version afresh between unpinned operations; publication must remain visible according to the existing contract. Avoid a broad time-based policy cache that hides updates. The local prototype demonstrates the call reduction and output equivalence, but independent-instance publication behaviour still needs native validation.

## 2. Keep historical allocation graphs out of new clock receipts

Every tick that runs the allocation handler reconstructs all historical allocation triggers, calls allocation for them, and returns their full results ([allocation/index.js:265](../../server/gcsp/allocation/index.js#L265)). Completed allocations still hydrate per-employee evaluation receipts ([line 109](../../server/gcsp/allocation/index.js#L109), [line 313](../../server/gcsp/allocation/index.js#L313)). The clock stores those expanded outcomes in handler receipts and the tick row; generic command receipts and final tick outcomes copy them again ([clock/index.js:303](../../server/gcsp/clock/index.js#L303), [repository/core.js:399](../../server/gcsp/repository/core.js#L399)).

Consequently, a fresh tick can grow storage without any new allocation. With successive fixed-size release outcomes copied into later ticks, accumulated clock data can grow quadratically in release history. Existing immutable vehicle evidence deduplication removes selected configuration fields, but not the surrounding evaluations, reasons, terms and allocation graphs.

Add a clock-specific consumption mode that returns allocation references and the summary counts/limitations the Presenter needs. Retain the existing full allocation replay API. Map the Presenter deliberately: it currently derives counts from assignment/evaluation arrays ([basic-model.js:31](../../blocks/gcsp/presenter-controls/basic-model.js#L31)).

Do not skip a completed event merely because its ID or producer-supplied digest matches. Reconstruct the source event, recompute its complete digest, compare against the allocation receipt, and resume unfinished work. Existing tests require both full replay equality and rejection when a completed producer's payload changes while its supplied digest stays unchanged ([gcsp-allocation-triggers.test.js:44](../../server/test/gcsp-allocation-triggers.test.js#L44), [line 125](../../server/test/gcsp-allocation-triggers.test.js#L125)). Existing retained history remains readable; deleting old receipts is outside this proposal.

## 3. Trigger notification checks when there is relevant work

The notification observer drains after nearly every non-notification command ([notify/index.js:36](../../server/gcsp/notify/index.js#L36)). Each drain reads the clock, two policy assumptions and outbox before determining whether anything is due ([line 65](../../server/gcsp/notify/index.js#L65)). Commit observers are awaited, so this contributes to command latency ([repository/core.js:406](../../server/gcsp/repository/core.js#L406)).

Use committed outbox changes to request delivery, coalesce repeated requests, and retain startup/tick retry recovery for due or interrupted jobs. Preserve post-commit delivery and durable retry/idempotency semantics. The 28 scans in the tiny release show why this is a useful bounded change.

## Follow-up: let PostgreSQL select and update the required rows

The adapter still executes domain work over run-scoped arrays. Every write fingerprints all 22 foundation tables using `count(*)` and `sum(version)`; a write cache miss loads the full run. The run advisory lock spans write processing and flushing ([postgres.js:43](../../server/gcsp/repository/postgres.js#L43), [line 197](../../server/gcsp/repository/postgres.js#L197)). Cache hits already avoid full hydration; hosted read caching also avoids some probes. It would be inaccurate to say every database operation reloads everything.

Incrementally add indexed receipt metadata/projection reads, explicit transaction write sets, and a transactionally maintained revision in place of repeated table-wide fingerprints. Keep compare-and-swap, occupancy constraints, reset, rollback, cross-instance freshness and uncertain-commit replay. This is broader work than the first three changes.

Evidence hydration also fetches one query per distinct digest ([postgres.js:77](../../server/gcsp/repository/postgres.js#L77)); conflict handling can query existing evidence again ([postgres-evidence.js:82](../../server/gcsp/repository/postgres-evidence.js#L82)). Prefer selected-row hydration first. Any batch optimisation must preserve the current memory safeguards: values may be large, and writes already use a 512 KiB batch budget with oversized rows sent alone.

Keep immutable evidence shared and store references where historical detail is not needed. Policy version, receipt and evidence keys already have indexes in migrations `0001`, `0002` and `0009`. Add indexes only for demonstrated query predicates/plans; indexes cannot eliminate repeated calls or accelerate JavaScript array searches. PostgreSQL's JSON guidance favours manageable atomic documents and notes that updates lock the whole row.[1]

Existing pool/timeouts are safeguards, not missing features: repository maximum 4 connections and policy maximum 2 per runtime, with 5-second connection, 10-second statement and 15-second query timeouts ([postgres.js:247](../../server/gcsp/repository/postgres.js#L247), [postgres-provider.js:23](../../server/gcsp/policy/postgres-provider.js#L23)). Hosted repository read trust defaults to two seconds ([host.js:36](../../server/gcsp/host.js#L36)); policy header checks and write fingerprints remain. Increasing pools or timeouts does not remove this amplification. Actual production settings and instance count need verification.

## Validation and incident evidence still needed

Implement the first three changes as separate reviewable increments. Select the existing policy/recommendation, allocation-trigger/clock/Presenter and notification recovery regressions for their respective boundaries; preserve full outcome equality, changed-payload conflicts and interrupted retries. The actual implementation determines the final test selection. No full suite was run for this diagnosis because application code was unchanged.

Before claiming a PostgreSQL performance fix, use a disposable native database with identical fixtures and revision, comparing cold/warm releases and later fresh ticks. Record SQL statement/round-trip counts, transferred and persisted bytes, transaction/lock duration, end-to-end latency and peak process/DB memory. Check that later tick storage stays proportional to compact references and new work. FUCQ-177's existing acceptance remains binding.

For the production incidents, correlate the actual failure timestamps with Render Postgres logs/events, restart/resource graphs, connection counts and web-service errors. Distinguish a database process restart/resource failure from lock waits or connection failures. PostgreSQL `pg_stat_statements`, if available, supplies calls, execution time, rows and block statistics; compare before/after snapshots without resetting shared production statistics.[2] Render's guide covers long-running queries, wait events, blockers and query plans.[3] Do not reproduce the failure by triggering another production release solely for diagnosis.

Evidence retained locally under `.claude/test-runs/presenter-release-20261111/`: three plans, source hashes, summaries, outcomes, ownership manifests and cleanup receipts. Before publication, all 13 recorded source hashes matched the current files, 22 code links were checked, and the three scratch roots were verified absent. Reservations were released; sampled removed allocation totalled 28,672 bytes, with no compatibility exceptions or leftovers. Recheck source hashes before reusing the evidence after code changes. Independent reviewer: Cecil Turtle, requested/selected `gpt-6.1-sol` / `high`, no fallback, read-only; the report also passed independent accuracy review.

No application, deployment, database or skill instructions were changed. No evidence ties these implementation mechanisms to a specific faulty skill passage, so no skill edit is proposed.

Sources consulted 11 November 2026:

1. [PostgreSQL: JSON Types, Designing JSON Documents](https://www.postgresql.org/docs/current/datatype-json.html#JSON-DOC-DESIGN).
2. [PostgreSQL: pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html).
3. [Render: Troubleshooting Render Postgres Performance](https://render.com/docs/postgresql-performance-troubleshooting).
