# FUCQ-309: measured canonical qualification, 10 November 2026

The original four acceptance criteria are met for the documented local memory-mode envelope. The one clean default 1,000-employee, three-seed process comparison completed all six route/seed steps and stored one complete result. The independent qualified-source review and the parent's independent exact-byte/result audit passed. Delivery is built for parent integration and lifecycle handling; this record performs no Jira or Done transition.

The executed source is **`e567b9b6a4e6b233ef988aaad88f6ba0a58848ed`**, proof `clean512-canonical-v1`. Its result digest is **`f643cb89872b07458abd2422f739576d35a1f9067d608e06dbd7cb9ae0e10028`**. [The exact result](result.json), [compact evidence](evidence.json), [qualified-source review](qualified-source-review.md), [final validation](final-validation.json) and [metadata equivalence](metadata-equivalence.json) retain the relevant identities. Later delivery commits integrate shared UI/docs/test work and update current policy provenance and delivery metadata; they are not relabelled as the executed proof HEAD.

## Measured local envelope

The default FilePolicyProvider, no cohort/seed/behavior overlay, `comparison-a/b/c`, real current/buddy services and actual HTTP job/result routes were used on Node **26.7.0**, Darwin arm64, isolated memory mode. The worker had **512 MiB old generation / 16 MiB young generation**, with the unchanged **1,800-second application timeout**. One supervisor group reserved 1,536 MiB RAM, 32 MiB scratch and a 1,900-second outer bound. The sole inherited import only resolves the existing `pg` dependency; no database connection, worker source transform, diagnostic observer, forced GC, inspector, injected phase/stop or extra worker yield was used. The isolated proof opted into reruns; the default live gate remains **off**.

| Observation | Measured value |
| --- | ---: |
| Worker positive finite heap samples | 1,711 |
| Sampled worker used-heap peak | 442,601,960 B / **422.10 MiB** |
| V8 heap size limit at that sample | 562,036,736 B / 536 MiB |
| Limit minus used heap at that sample | 119,434,776 B / 113.90 MiB |
| V8 total available size at that sample | 136,503,080 B / 130.18 MiB |
| Sampled total process RSS peak | 916,570,112 B / **874.11 MiB** |
| Sampled supervisor-group RSS peak | 943,833,088 B / **900.11 MiB** |
| Group budget minus sampled peak | 666,779,648 B / 635.89 MiB |
| Actual elapsed / wall duration | **1,721.491692 / 1,721.494 seconds** |
| Single-run application timeout margin | **78.508308 seconds** |
| Supervisor child / total duration | 1,721.828192 / 1,721.928 seconds |
| Health probe count; p95 / maximum | **1,064; 1.374875 / 24.506583 ms** |
| Maximum heap / host sample gap | **6.800677 / 6.806321 seconds** |

Wall execution ran from `2026-11-10T18:16:43.629Z` to `2026-11-10T18:45:25.123Z`; elapsed and wall sample clocks are retained. The sampled heap peak occurred at elapsed 587,728.474 ms / wall `2026-11-10T18:26:31.359Z`. Every sampled health/latest request returned HTTP 200; process reads returned the expected pre-result 404 while running. The complete [8,478-byte raw log](canonical.log) has SHA-256 `a21efe276132be4a10516d3117b72789bf965103bef55564c68da0b4e9f997c5`, with no cap/resource issue.

MiB means 1,048,576 bytes. Configured old generation is not a total V8 heap or host-RSS cap. Peaks and headroom differences are sampled observations, not continuous maxima, future capacity guarantees or a claim about natural-GC cause/timing. Probe success does not establish continuous responsiveness during the gaps or a new latency SLA. The observed timeout margin is from one local run.

## Acceptance evidence

1. **Canonical completion and complete result:** 3/3 seeds, 6/6 steps, worker exit 0, succeeded/closed HTTP lifecycle and exactly one stored result. Canonical input hashes, six route record digests, integer totals and person/car conservation, route measures, aggregates and differences passed. Worker/store/HTTP/file result and digest equality plus caller mutation isolation passed; the parent separately recomputed the canonical result digest.
2. **Actual memory/lifetime repair:** exact immutable sharing, narrow completion projections, compact collision-checked weak pool storage, private terminal disposal and the narrow allocator ownership/read repair have separate retained-data evidence. The [initial repair evidence](../memory-repair-2026-11-10.md) measured the 300-person container model falling from 63.91 to 6.12 MiB and completion heap from 134.15 to 60.97 MiB. The [allocator evidence](../allocator-read-repair-2026-11-10.md) confirms frozen modern-plan aliasing, quote-input-only caches and collectability of wrappers/store/pool while run/services remain referenced at 100/300. These instrumented/forced-GC observations are scoped; the clean canonical run crosses all six `finally` close boundaries without those observers. A larger heap alone is not the repair.
3. **Semantics, replay and isolation:** full baseline/repaired records, decisions, totals and measures are exactly equal at **100 and 300 employees**. Meaningful original-response replay after later writes, rollback/retry, caller mutation/isolation, scope rejection and modern/legacy allocation readers passed. There is **no successful unchanged 1,000-person canonical baseline**, so full-size baseline equality is unavailable and unclaimed. The six canonical route digests are retained as the successful result's identities.
4. **Failure, saved results and live gate:** retained throw/OOM/timeout/interruption checks require zero partial results; saved reads remain immutable/readable. The default-off gate forbids a worker/row/start, and the final selected gate check passed again after policy metadata changed. The proof's explicit isolated opt-in did not alter the default.

## Integration, checks and retained limits

The topic integrated `f99de401` and then **`6ae669e8df38ffd3bb17c0450a043d6228d3abdb`**. All **215** incoming path bytes are preserved; the later 27 paths concern mockup/configuration/docs only. All qualified server production bytes match except the explicit JSON allowlist `assumptions[66].basis` and `.sourceDate` for `comparison.jobs.v1`. Values **512/16/1800**, status `assumed`, selected generator policy, experiment plan, snapshot digest and complete three-seed input identity remain equal. All **590** historical files preserve hash, size and nanosecond mtime; old candidate/failure reports remain historical snapshots. No canonical repeat was needed.

The earlier affected HTTP/authority/storage/preflight integration remains **14/14 passed**, reused only after production/dependency and selected-test identity checks. Final metadata validation directly regenerated all three canonical inputs and passed **2 existing policy/default-gate tests, 0 failed/skipped**, under one 600-second / 512-MiB / 32-MiB supervised chunk. The first 768-MiB admission was refused before a test process started; its receipt is preserved, then the smaller reservation was admitted. The completed chunk took 1.343620 seconds, sampled group RSS 167,723,008 B, scratch peak zero and full log 2,542 B.

Historical checks retain their actual outcomes: 62 route/measures passes, 25 corrected worker/job/HTTP passes, private contracts 25 passes plus an existing F71 skip, and the then-stale identity fixture failure tracked separately as Low FUCQ-348. Its later shared fixture repair and matching 14/14 integration cover the original post-CAS authority assertion; historical failed/skipped records are unchanged.

Full suite, native PostgreSQL/F71 new-process readback and hosted **Node 20** remain unrun. Local Node 26/memory evidence does not qualify a hosted PostgreSQL deployment. Unrelated incoming UI work has its own review evidence; this change adds no screen or interaction. No deployment, new scope, algorithm or live gate change is included.

The parent additionally reconciled all 68 F309 supervisor ownership manifests: absent owners/groups/roots/tokens, state removed, scratch zero and no exception/leftover. Canonical owner PID 82913/group 82951 and final-validation owner PID 66185/group 66208 are absent; both owned scratch roots and reservation tokens are absent, with external manifests `removed`. Peak scratch/removed file allocation is zero bytes; there is no compatibility exception or owned leftover. Concise reports and bounded logs remain outside scratch. Existing other-session reservations/data are preserved. General poller **STOPPED**, heartbeat **PAUSED**.

Ralph Wolf retained requested/selected `gpt-6.1-sol` / `xhigh`; qualified-source reviewer Foxy requested/selected `gpt-6.1-sol` / `high`; no fallback or new agents for final delivery. Parent/Foxy own focused final metadata review, shared integration and subsequent lifecycle/archive work.
