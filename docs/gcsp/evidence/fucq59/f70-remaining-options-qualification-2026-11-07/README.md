Prepared F70 remaining model-options qualification, 7 November 2026

Capability commit `de1e420458f7ef6485f7f091f403e4369ce55616` adds a separate observation-only source version. Minnie Mouse reviewed the actual diff and found no blocking binding issue. Existing strict-trim qualification is preserved. The model-options source retains full requested model/AG/context separately from the exact line's compact default and unique included variant. It does not construct or admit configurations.

| Requested model / AG | Exact line | Compact default | Included index | Options query |
| --- | --- | --- | --- | --- |
| 1F7A / 82GE | BASIC_LINE | 1F7A / 82GE | 0 | absent |
| 1F7C / 22GE | M_PERFORMANCE_LINE | 1F7C / 22GE | 0 | absent |
| 1F7D / 62GE | S0337 | 1F7B / 82GE | 2 | trim=S0337 |
| 1F7F / 62GE | S033B | 1F7E / 82GE | 0 | trim=S033B |

The first two are observed no-option lines. No generated boolean is asserted. Their no-trim endpoint success is unverified until this new allocation runs. HTTP, identity or shape failure stops the entire series without fallback.

All four registrations pin GB/en-GB/RL, F70 catalogue/raw range, complete aliases `["1"]`, catalogue/order date 1 November 2026, effect date 5 January 2027 and qualification date 7 November 2026. Every context uses one fresh page GET, one settings GET discovered by that page, one exact tree GET and one exact model options GET. Fresh full model/AG/date/range/alias and line/default/included checks precede options. Only directly keyed, typed definitions are retained; the explicit trim definition is required where applicable.

The exact series plan digest is `2c4d05cb669da8238a23c5ace1e0298aa80b4b365b05ea0cab50f8daf8a0616e`. Code, test and executable SHA pins and four per-context plan digests are in `execution-plan.json`. The source capability is at the reviewed commit; the prepared bundle is the later commit containing this file. Run only from worktree035 so its frozen code pins are used.

After root separately releases this exact allocation, the command is:

```sh
F70_REMAINING_OPTIONS_SOURCE_GRANT='f70-model-options-20261107-2c4d05cb669da823' /usr/bin/python3 -I -B docs/gcsp/evidence/fucq59/f70-remaining-options-qualification-2026-11-07/supervise.py live
```

No source traffic has been executed by this preparation. The grant is an allocation identity, never a credential. Live execution is restricted to the pinned UTC qualification day. A durable series once marker and per-context once markers prevent replay. Existing primaries are preserved. No solver, image, browser or source-write operation is allocated. Total ceiling:16GET attempts,16MiB decoded,1MiB per response,1worker,0retries/redirects;40s source and45s child per context,60s chunk,180s series. Live host/child RAM limits are512/448MiB, scratch64MiB. Standard host reservations/finalizers remain active.

Safe primary checkpoints, projections, request/response-hash metadata and receipts are retained in each context directory from the first checkpoint write. Page/settings/tree/options raw bodies and bootstrap header values are not retained. Supervisor summaries and ownership manifests go under `/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-remaining-options/live`; actual scratch roots are recorded in external manifests under `/private/tmp/test-stamp-shard-<token>`. Interrupted source children are stopped/joined before safe exports and scratch teardown. A zero child exit requires a matching complete source receipt and exported checkpoint before the next context starts.

Scoped offline evidence:123production tests pass and4prepared-runner tests pass. The22new protocol tests were verified red first. The supervisor missing-evidence test was also verified red before its guard was added. Earlier failed checks and the fixture resource-budget correction are recorded honestly in `../f70-remaining-options-plan-2026-11-07/offline-results.json`. Production code/test identity was unchanged while the four runner checks were refined; the production checks were not repeated. No full suite was run. The preparation's one nested supervisor fixture reserved1024MiB RAM/128MiB disk; its actual peak was132,202,496B RSS and71,392B outer scratch, with nested scratch0B. All owned scratch and the temporary dependency symlink are absent; no compatibility exception or leftover is recorded.

No source model/configuration capacity credit, corpus publication, whole-story acceptance, G42 activity or 1F7B/1F7E replay is claimed. Root owns release, integration and any next source allocation.
