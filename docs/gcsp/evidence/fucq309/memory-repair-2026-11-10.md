# FUCQ-309: replay memory evidence

Status: repair in progress. These are scoped diagnostics of unchanged production code, not proof that the canonical 1,000-person, three-seed worker request completes.

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
