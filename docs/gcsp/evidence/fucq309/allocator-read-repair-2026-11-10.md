# FUCQ-309 allocator ownership repair checkpoint — 10 November 2026

The optional private allocation read and its narrow allocator consumer are implemented. This is a scoped implementation checkpoint for independent review. The original actual HTTP 1,000-employee, comparison-a/b/c, current+buddy six-step, 128 MiB old / 16 MiB young / 1,800-second acceptance remains open. All three preceding canonical attempts failed after one of six steps with zero result rows. No new canonical attempt has run on this source.

The private adapter validates the same context, environment, reference and run against the same serialized committed state using the unchanged generic repository. A branded modern pending plan reuses its deeply frozen stored row. Unsupported and legacy plans use ordinary detached mutable reads. Quote reconstruction receives only existing quotes/quoteInputs, selected before recursive copying. The allocator keeps only those consumed fields in its cache, and preparation/recording now returns the existing small marker from an awaited helper. Cursor reads, legacy migration, completed reads and full evaluation hydration retain their ordinary behavior. Generic core/memory, hold/offer writers, allocation order/values and worker policy are unchanged.

The pre-implementation plan is `allocator-read-plan-2026-11-10.md`, committed at `6a39cda5f2d4437a70fe8e1273cceab3880a5514`. Exact production and test SHA256 identities, commands, receipt digests, measurements and limitations are in `allocator-read-repair-2026-11-10.json`.

| Scoped check | Result |
| --- | --- |
| New private capability red, then green | Expected 0 pass/4 fail; then 4/4 pass |
| Consumer red, then ownership/legacy replay | Expected detached-read refusal; then 5/5 pass |
| Complete private focused file | 12/12 pass |
| Forced constant hash collision variant | 12/12 pass |
| Selected private repository contracts | 25 pass; 1 existing F71 native new-process skip |
| Allocation/core/trigger/runtime/identity callers | 41 pass; 1 existing identity fixture failure |
| Current/buddy/measures | 62/62 pass |
| Worker/job/HTTP | 25/25 pass; targeted evidence recorded |

The identity failure is separately recorded as **FUCQ-348, Low**, linked to originating Story FUCQ-96 and discovery Bug FUCQ-309. The test's hardcoded employee CAS version 2 is stale against fixture version 3. A diagnostic import substitution of unchanged committed allocator/helper bytes reproduces the exact failure. No product or authority failure is established; the post-CAS scheme-denial assertion remains unrun. This repair leaves that defect unchanged and does not acquire its scope or a merge dependency.

Actual buddy runs at 100 and 300 employees preserve the original input hash, outcome record digest, employee decisions digest, totals and measures exactly. The diagnostic observes modern reads aliasing frozen stored rows without extra plan containers, and quote cache samples containing only quotes/quoteInputs. Snapshot rows, planned-value wrappers and slice arrays are weakly dead after helper return plus two event-loop turns and forced GC. Store and pool are collected after close while the run remains referenced. Receipt-index invalidations are zero.

The instrumented runs took 3.322 and 27.904 seconds. Their maximum sampled post-GC heaps were 22.07 and 65.40 MiB. Forced GC, extra turns and graph walks perturb execution; these observations prove scoped equality and collectability, not natural collection timing, speed improvement or canonical feasibility. The graph comparison accounts for the one tables wrapper present only in combined roots. The canonical-v3 245.865-second host-sampling gap and application/supervisor clock discrepancy remain unexplained.

Each chunk used the registered supervisor, external ownership manifest, shared host reservation, owned TMPDIR/TMP/TEMP, bounded logs and stop/join/cleanup finalizer. A 1 GiB contract reservation was refused before running; a smaller 512 MiB/16 MiB chunk passed. Later checks used 768 MiB/32 MiB reservations and one worker, at most 600 seconds per chunk. Independent filesystem audit finds all 54 supervisor roots and the nested targeted-check root removed and absent (sampled scratch file allocation zero). Bounded evidence is retained outside scratch; the unconfirmed 102,133-byte jira_sync bytecode is preserved. There is no large output or compatibility exception.

The full suite, native PostgreSQL and F71 native new-process readback remain unrun. No UI source/contract changed; exact 100/300 outputs support the proposed rendered-impact exclusion, which independent review must assess. The next gate is independent scoped review of the immutable source checkpoint, then one bounded canonical-scale first-buddy ownership checkpoint before the original actual HTTP canonical proof. No allowance, acceptance or scope increase is authorised by this checkpoint.
