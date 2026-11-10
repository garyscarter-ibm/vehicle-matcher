# FUCQ-309: replay memory evidence

Status: internal repair and scoped regressions validated; canonical integration pending. The before/after diagnostics do not establish that the default 1,000-person, three-seed worker request completes.

The claimed source basis is `2bd503e6a1a09d49a0d102c63efcec740906ba61`; the diagnostics ran after the documentation-only checkpoint `8ca9ebe2`. Exact source hashes, input identities, decisions, measures, record digests and compact checkpoint statistics are in `before-census-2026-11-10.json`. Both diagnostics used Node v26.7.0, Darwin arm64, seed `comparison-a`, the real buddy services and the canonical policy with only `comparison.cohortSize` overlaid. The default release cadence was preserved. No source, database or mail request was made.

| Diagnostic | 100 employees | 300 employees |
| --- | ---: | ---: |
| Cars / releases | 85 / 1 | 255 / 3 |
| Duration, instrumented | 3.03 s | 33.91 s |
| Final expanded stored JSON | 17.04 MB | 96.89 MB |
| Command receipts, expanded | 3.78 MB (22.2%) | 16.78 MB (17.3%) |
| Completed allocation receipts, expanded | 3.32 MB | 21.02 MB |
| Heap before first full snapshot, after GC | 23.78 MiB | 77.02 MiB |
| Heap with first full snapshot, after GC | 32.93 MiB | 133.97 MiB |
| Heap after close with run retained, after GC | 24.12 MiB | 77.06 MiB |
| Heap after dropping run, after GC | 13.57 MiB | 13.44 MiB |
| Supervised process-group peak RSS | 204.69 MiB | 524.44 MiB |

Expanded JSON bytes count repeated values each time they appear and are not retained heap measurements. The census also counts distinct object/array containers and already-shared edges by traversing the actual backing store; its container-size model is an estimate, not V8 heap accounting. RSS includes the diagnostic instrumentation and its transient census allocations. Forced GC changes timing. None of those figures establishes a production worker envelope.

The data rules out command receipts as the sole dominant cause at these scales. At 300 employees, completed allocation receipts retain 11.70 MB of assignments and 9.01 MB of attempts; separate attempt receipts retain 9.16 MB. Packed employee evaluation receipts retain 16.21 MB, and quote rows retain 8.81 MB. The insert-quote receipt representation is already mostly shared: 8.93 MB expanded, but only about 0.075 MB of additional modeled containers after the quote rows. Removing that existing sharing or simply deleting command outcomes is not an appropriate repair.

Repeated releases grow the backing store: 26.91 MB expanded after allocation one, 51.40 MB after allocation two and 83.36 MB after allocation three, before later decisions finish. Pending plans contain 8,494, 12,101 and 12,875 contenders. These retained values need exact structural sharing at the private comparison storage boundary; their original JSON and replay outcomes must survive.

Two separate consumer/lifetime costs are demonstrated. Full-table completion snapshots clone receipts and other tables unused by the outcome checks, adding 9.15 MiB at 100 employees and 56.95 MiB at 300 employees. Closing the generic memory repository leaves its private store reachable through the retained run; a weak reference confirms collection after dropping that run and allowing two turns plus GC. This establishes reachability while the run is retained, not a permanent process leak.

The selected internal repair therefore combines exact sharing of immutable repeated subtrees, projections containing only stock/holds or the outbox, and an explicit private disposal boundary that releases the raw repository, store and receipt index. Generic repository semantics, original-outcome receipts, shared allocation/offer writers and generic memory-store reopen remain outside the edit boundary. Existing diagnostic full snapshots remain available.

Both successful chunks used one process, a 600-second limit, a 1,536 MiB RAM reservation and a 64 MiB scratch cap. Their external supervisor ownership manifests report zero scratch bytes and verified removal. The first launch failed before generating inputs because the worktree lacked a resolvable `pg` dependency; a diagnostic-only resolver used an existing installed, fingerprinted pg 8.23.1 without database calls. That failure exited 1 and its scratch was also removed. Detailed plans, scripts, bounded failure log and receipts remain under the shared `.claude/dev-poller-20261110/` run record.

Remaining gates: regression failure then passing repair, unchanged 100/300 decisions/measures/digests, affected contract and job checks, measured retained-data reduction and repository release, and the actual canonical six-step worker request with a complete stored result and responsive host. FUCQ-313 reruns remain off by default. No UI change is planned.

## Repair checkpoint

The comparison now owns a private memory adapter that composes the unchanged generic repository core. It shares exact immutable row subtrees using ordered keys, typed primitive values and canonical child identities. Weak references and finalizer cleanup keep the interning pool from owning dead values. State/table-array versions are not interned. The private adapter retains the existing serialized shallow-draft semantics and updates only its receipt index's final-row identity after normalization; the generic memory/core, allocation and shared offer writers are unchanged. Completion queries only the notification outbox and stock/holds. Full diagnostic snapshots remain available. A terminal forwarding handle drops the raw repository, backing store and receipt index on close, including escaped unsubscribe references.

At 300 employees, the final distinct object/array count fell from 703,240 to 43,524 and the container model from 63.91 to 6.12 MiB. Actual pre-completion forced-GC heap fell from 77.02 to 60.25 MiB; maximum completion heap fell from 134.15 to 60.97 MiB. Node's recorded process maximum RSS fell from 524.56 to 369.13 MiB. Instrumented duration was 33.91 seconds before and 30.21 seconds after. Expanded stored JSON remains 96.89 MB because every original value/outcome is retained. These measures describe different costs and include diagnostic overhead.

Both 100/300 runs exactly match their baseline input hash, outcome-record digest, decision digest, totals and measures. The actual private store is collected after event-loop turns and GC while the run/services are still retained. At 300, 24,427 receipt lookups index 8,377 rows with zero invalidations. Compact checkpoints, exact hashes, projection tables, digests and receipts are in `after-census-2026-11-10.json`.

Meaningful regression failures preceded implementation: sharing, both completion projections and terminal close failed. The final focused checks pass 6/6; real current/buddy/measures checks pass 62/62. The selected unchanged repository contract assertions pass 25 checks against the generic memory provider and 25 against the comparison-private provider through a test-module import substitution. Each provider retains the existing F71 native new-process readback skip; no PostgreSQL validation ran.

The corrected scoped worker/job/HTTP invocation passes 25/25, covering the real worker, saved immutable results, failure/interruption without partial result, responsiveness and the default-off rerun gate. Its first invocation used combined `--test-isolation=none` and a resolver not inherited by a spawned process: 21 passed/four failed, and five earlier HTTP checks were not observed. That failed receipt remains retained. Standard per-file isolation plus inherited dependency resolution passed all 25 without product/test changes. This is targeted evidence, not a full-suite stamp.

The lead reviewed all five implementation/test files, the adapter contract boundary and the matching source hashes. All completed supervisor scratch roots were independently checked absent. A helper-import bytecode file owned by this lead was removed (178,636 bytes); an earlier 102,133-byte `jira_sync` bytecode file has unconfirmed ownership and remains preserved.

Remaining gate: actual canonical request, all 1,000 employees, three seeds and both routes, with full stored result, measured worker/host envelope and responsive HTTP service. The initial proof retains the existing 128 MiB old/16 MiB young worker limits and 1,800-second timeout. Its indivisible 1,900-second supervisor plan reserves 1,536 MiB RAM and 64 MiB scratch, one worker, route/30-second checkpoints and bounded output. A larger heap alone cannot count as the repair. No UI or live-data change was made.
