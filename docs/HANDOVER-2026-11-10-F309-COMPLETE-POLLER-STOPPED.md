# F309 development complete; poller stopped — 10 November 2026

FUCQ-309 / DEV-2026-11-10-GC-027 is integrated, pushed and archived. This completes the human's F309-only continuation. General inbox intake remains stopped and the `vehicle-matcher-dev-poller` heartbeat is PAUSED. Historical scheduled messages cannot resume work. No new session is needed to recover this task.

## Delivery and cause

The memory repair uses exact immutable sharing in comparison-private replay storage, narrower completion reads, terminal disposal, and a narrow allocator read/cache/lifetime repair. Original command outcomes, rollback and caller isolation remain intact. Raising the heap alone was not treated as the fix: the 300-person baseline maximum completion/post-GC heap of 134.15 MiB fell to 65.40 MiB after the allocator repair, and store/pool collection was demonstrated with the run still referenced. Those forced-GC observations are scoped lifetime evidence, not natural-GC timing claims.

- Qualified executable source: `e567b9b6a4e6b233ef988aaad88f6ba0a58848ed`, tree `51c5405ce452b59ae5d2ab21e8bbdd60a93aad4e`.
- Frozen built delivery: `f6a224afdd8962901913e7f9073aaf60857b851b`, tree `cba9de67d7e95df03bd2e7407a29cea1aeee50d6`, incorporating shared base `6ae669e8df38ffd3bb17c0450a043d6228d3abdb`.
- Shared merge: `edb3cd2669cfa880574c2c178bfb37e31119de31`; archive: `a8cd24940f90b218e327a7c07a3ee9d682bfc76c`; verified cleanup: `0989d65f754d957a365a7495a4c209d0314aa5ae`. All pushed to `gcsp-poc`.
- Archived claim: `_dev/done/2026-11/DEV-2026-11-10-GC-027.md`, cleanup complete. The four original criteria are checked; their wording is unchanged. Four product-map slices are complete, the observed worker is expired, and native Jira status/timestamps were preserved at the built checkpoint; the later authenticated refresh records In Review. Development completion does not infer collaborator acceptance or Jira Done.

The final delivery differs from the qualified production bytes only at `comparison.jobs.v1` policy `basis` and `sourceDate`. Values remain 512 MiB old generation / 16 MiB young generation / 1,800 seconds, status `assumed`. All three canonical input identities, selected generator policy and plan match. All 65 dependency files, nine frozen artifacts and 590 historical files were verified unchanged; all 215 incoming shared paths were preserved. Active unrelated mockup files were disjoint from the merge and retained byte-for-byte. Other claims, leases, worktrees and untracked documents were left alone.

## Actual canonical result

One clean `clean512-canonical-v1` actual HTTP request completed all 1,000 employees, three seeds and both routes: 6/6 steps, 3/3 seeds, one complete immutable stored result. It used Node 26.7.0 on local Darwin arm64 in isolated memory mode, default policy and no cohort/seed/behaviour overlay. The only inherited hook resolved the installed `pg` dependency; no source transform, observer, forced GC or injected worker stop/yield was used. The isolated proof explicitly enabled reruns; the live default gate remains off.

| Observation | Result |
| --- | --- |
| HTTP elapsed / wall | 1,721.491692 / 1,721.494 seconds (28m41s) |
| Application timeout margin | 78.508308 seconds in this single run |
| Sampled used-heap peak | 422.10 MiB (1,711 finite positive samples) |
| Sampled process / supervisor-group RSS peak | 874.11 / 900.11 MiB |
| Health requests | 1,064, all HTTP 200; p95 1.375 ms, maximum 24.507 ms |
| Maximum heap / host sample gaps | 6.801 / 6.806 seconds |
| Result digest | `f643cb89872b07458abd2422f739576d35a1f9067d608e06dbd7cb9ae0e10028` |

Peaks, headroom and responsiveness are sampled observations, not continuous maxima or future guarantees. The configured old generation is not a total-heap or host-RSS cap. The HTTP execution ran from 18:16:43.629Z to 18:45:25.123Z on 10 November; supervisor child/total durations were 1,721.828192/1,721.928 seconds. Manifests, input hashes, six route digests, totals conservation, measures/aggregates/differences, worker/store/HTTP/file equality and caller mutation isolation passed. Parent separately recomputed the persisted result digest. No canonical rerun was performed.

[Public qualification and evidence](gcsp/evidence/fucq309/canonical512-2026-11-10/report.md), [qualified-source review](gcsp/evidence/fucq309/canonical512-2026-11-10/qualified-source-review.md) and [final delivery review](gcsp/evidence/fucq309/canonical512-2026-11-10/delivery-review.md) retain details. Foxy's independent reviews passed, as did the parent's final identity and cleanup audits. Ralph Wolf used requested/selected Sol/xhigh; Foxy used Sol/high, with no fallback for final delivery.

## Validation limits and cleanup

Candidate worker/job/HTTP, generator and policy checks passed 44/44. Matching affected integration checks passed 14/14; final policy/default-gate checks passed 2/2 plus direct all-three-seed input equality. Earlier private, collision, replay, route/measure and disposal evidence remains scoped and retains actual failures/skips. A 768-MiB final-metadata admission was refused before any test process; the smaller 512-MiB reservation passed. Full-suite fallback was not silently run.

Exact unchanged-baseline equality is demonstrated at 100 and 300 employees. There is no successful unchanged 1,000-person baseline. Full suite, hosted Node 20 and native PostgreSQL/F71 new-process readback remain unrun. This is local memory-mode qualification; no hosting/deployment change was made. The repair introduces no new UI contract, so no visual review was required. Unrelated UI work retains its separate review scope.

All 68 owned supervisor manifests have removed states, absent roots/owners/groups/tokens, measured scratch peak zero, no compatibility exception and no owned leftover. The supported drop-branch helper removed the merged topic, owned worktree and story lease; local/remote refs and worktree registration were independently verified absent. Pre-removal worktree allocation was 1,155,059,712 bytes. Bounded summaries/logs are retained under `.claude/dev-poller-20261110/`; no successful verbose scratch tree or copied input was retained.

## Native Jira and stop state

The collaborator reconnected Jira and explicitly requested another attempt. Authenticated reads then succeeded, and the available workflow transition moved **FUCQ-309 to In Review**, confirmed by the transition response and a fresh native read. Jira reports updated time **2026-11-10T19:06:20.527Z**. Only the F309 transition operation was acknowledged with `jira_sync.py push --mark-done`; other pending operations remain untouched. The product map imported the fresh native status and observation while preserving its four completed slices, expired worker and all 177 other story objects. No Jira Done transition or collaborator acceptance is inferred. The earlier invalid-token failure and child HTTP 422 responses remain historical diagnostic records; they do not verify a credit balance.

The app's automation view was checked and saved heartbeat configuration independently confirms PAUSED. The local directive and run checkpoint now record F309 finished and all polling stopped. Resume intake only on a fresh explicit human instruction. This handover supersedes the earlier stop handover's statement that F309 remained incomplete; the older record is preserved as history.
