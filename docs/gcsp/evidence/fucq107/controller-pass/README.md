# FUCQ-107 scoped controller14 result

**14/14 PASS**, 6 November 2026. Zero failures, cancellations, skips or todos. This was the single dispatcher-authorised run of frozen product source `94e05ff9070aa19f5deb3e9997dfed96cc268473` through reviewed harness `00900926ee86d380f706726b91892fa6376837ed`. Dispatcher grant: `fucq107-controller14-0090092-0159`. Admission SHA-256: `6dfe2623e3ac0ece6b352abdb336cab59a29a7d535c270a4c68973bf321d6a27`.

The original TAP retains all 14 exact case names, including `authentication loss clears a saved receipt while non-auth source failure preserves it`. The journal proves three application modules and four declared edges (two application and two builtin imports). All seven current source/input files match their immutable source; exact Node and every harness/executable/lock pin were preserved. No installed dependency was borrowed or installed.

The exact pinned read-only audit returned PASS after supervisor exit. Its original receipt records 1,349 checks; the console's 1,350 includes the final receipt-size assertion performed after serialization. The dispatcher subsequently completed its independent final audit: **PASS, 1,313 checks**, at `2026-11-06T02:06:47.745123+00:00`, accepting controller14 only. Its byte-identical receipt is retained as `dispatcher-final-audit.json`. Neither the original audit nor the frozen auditor was altered or rerun to normalize that reporting difference.

## Execution and cleanup

- Original run: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107/controller14-d26530673e474ed69caaa21443acc7ea`.
- Supervisor owner: PID 78998, start `Fri Nov  6 02:02:33 2026`, independently absent after exit.
- Observed direct child: PID 79064, parent 78998, group 79064, start `Fri Nov  6 02:02:35 2026`; observed test child: PID 79076, parent 79064, group 79064, same recorded start. Both exact identities and group 79064 were independently absent. The manifest retains 13 process observations and successful launch/handle/registration flags.
- Owned scratch: `/private/tmp/test-stamp-shard-a549946fa3d6419b934450b44a079e3b`; removed and independently absent. No scratch file allocation was observed (manifest entry sampler peak 0). Token `a549946fa3d6419b934450b44a079e3b` and descendant reservations were absent in the strictly locked validated ledger. The finalizer receipt proves stop/join and PID/group absence before removal and strict release afterward.
- Wall time: 2.485448625 seconds. Peak aggregate RSS: 117,538,816 bytes, including supervisor and measurement processes. Peak scratch plus the entire external retained FUCQ-107 directory: 1,316,416 bytes. The auditor measured 1,320,544 retained bytes before writing its bounded receipt.
- Original combined stdout/stderr: 4,049 bytes; module journal: 3,292 bytes; combined 7,341 bytes. Preserved in full. Limits were 120 s, 384 MiB aggregate RAM, 128 MiB entire retained107 directory plus scratch, 2 MiB combined original log/journal, one worker, 5 GiB disk reserve and 512 MiB host RAM reserve.

The single test command was issued once. The subsequent pinned audit was read-only apart from its own bounded receipt; it ran once and did not launch tests, clean scratch or mutate the host registry. No cancellation was injected, so this result does not claim an exercised cancellation path. The handled-cancellation repair has independent static admission and this ordinary successful lifecycle evidence.

## Original captures

The seven original-run files are byte-identical copies. The eighth capture is the subsequent independent dispatcher receipt. `capture-index.json` binds their hashes and original location. The original manifest is below `ownership/`; its absolute scratch/run paths intentionally retain their real values.

| Capture | Bytes | SHA-256 |
|---|---:|---|
| `plan.json` | 1432 | `df9ab1f3dbf561e07af07f79bec5cd1e45489d835cefeb9fc574714be4aab173` |
| `output.log` | 4049 | `c1afb64e3721a906362c3d7ba61ed7db0bff6cc33a6111b35be7eac0c8d1fbdd` |
| `modules.jsonl` | 3292 | `5c30afb8276fdef33aa8f240e53897608c8aa28304a61e2c90dc9afccf9a50a2` |
| `summary.json` | 2800 | `631eed62df8a58a729ffdb3bc1bc57d7c99e9bfa19ec288db3691ff2d17b84e4` |
| `checkpoint.json` | 343 | `816ef3d6f11f999b5ac36e987edde3d34e5051de8d68abf1ecbe96d395f5edd9` |
| `parent-audit.json` | 2456 | `c85218153180908149b7e972e8e8a4c8c4bb7df9ad3c72cee04271fbbdc21bf5` |
| `ownership/a549946fa3d6419b934450b44a079e3b.json` | 1344 | `da4e8fb8e3a9149d5c352b6810d3fde42c86f2ad2df2387c2ab16d98b7e03a9a` |
| `dispatcher-final-audit.json` | 1419 | `a10608354f7b05a0b12d9bcb16aaa5779e6ca38f856f43bfa5edd131eb439645` |

## Scope still outstanding

This proves only the 14 controller/HTTP-adapter cases. Backend service 12/12 remains separate evidence for old source `1683932` in `../scoped-service-pass/`; the renewal correction at `4b91d4b` is unexecuted and is not covered by that result; prior policy 7/7 is a separate unchanged-graph result. They are not combined or rerun here. The nine renderer cases, canonical policy runtime registration (103 source registration is independently accepted at `f80fc61`), actual102/105/106/100 composition, authoritative navigation/reload, allocation/tick, evaluation/wait/no-match, browser/visual and full integration evidence remain open. Paused allocator 96 was untouched. **FUCQ-107 is not built.** No Jira, shared lane, producer, shared helper or product-map status changed.

Agents: Lego Batman lead requested/selected `gpt-6.1-sol`/high, no fallback; no new agent or descendant was launched. Launcher ownership and the lead receipt remain with the lead; the dispatcher final audit accepted this controller-only result.
