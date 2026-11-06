# FUCQ-107 first renderer run: loader failure

The single granted renderer attempt **failed before any of the nine named cases ran**. Original TAP records one failing file-level test, zero passes, and zero cancellations/skips/todos. This is no renderer-case verdict. Grant `fucq107-renderer9-ed9f619-0236` was consumed once; no repair, retry or variant ran.

The exact reviewed supervisor used admission SHA-256 `f547b6a33e40424af037694ef7d1aaf3b970c91e92d2e208214435b42a78293b` and harness publication `ed9f619148c41b888761b2e226663afd5b43d866`, against unchanged renderer source `94e05ff9070aa19f5deb3e9997dfed96cc268473`. Original run: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107/renderer9-e4b7c26abd294bd78395d59c774ab8d7`.

## Diagnosis and limits

The original loader throws `Unreviewed executable format` at line 101 while loading pinned `tldts/dist/cjs/index.js`, reached through JSDOM → tough-cookie → tldts. The last of 38 original journal events is `refused-load` for that exact file. Its actual returned format was not journalled and remains unknown; no format value is inferred. The failure occurs during dependency loading, before the nine selected case names appear.

The affected owned boundary is the loader's default-load format contract and the corresponding supervisor/auditor journal validators. Product renderer failure is not established. Any compatibility repair requires source-backed diagnosis, a new reviewed freeze and a fresh explicit grant. No package, product, installed dependency or helper was changed during this run or failure capture.

Original TAP: 1,572 bytes, SHA-256 `032ab91d90317cb900c68e43d02f9d86730f3ca5c8252e53b3323ca4e7201412`. Original journal: 10,715 bytes, SHA-256 `66a92a4821317c94fd4ae37c30a32a875a595b9b646b2e91384af3f9fa858c2b`. `capture-index.json` binds six byte-identical original captures and the exact untruncated command-tool result for the separately pinned audit. The original files remain unchanged.

## Cleanup and audit state

The supervisor returned exit 2, with child exit 1, `passed:false`, `pinsPreserved:true` and all cleanup flags true. Recorded wall time was 4.165162167 seconds, peak aggregate RSS 93,847,552 bytes and peak scratch plus the entire external107 retained directory 3,471,296 bytes. The admitted limits were 120 seconds, 384 MiB aggregate RAM, 128 MiB combined allocation, 2 MiB combined TAP/journal, one worker, 5 GiB disk reserve and 512 MiB host RAM reserve. The fresh strict HostBudget was used by the admitted supervisor.

Recorded supervisor PID 6567 started `Fri Nov  6 02:34:53 2026`. Direct child/group 6641 started `Fri Nov  6 02:34:57 2026`; worker 6656 started `Fri Nov  6 02:34:58 2026`. The manifest reports both children joined/absent, group absent, removed scratch `/private/tmp/test-stamp-shard-1082c729a1cf4927adc4e9b4b129e744` and released reservation `1082c729a1cf4927adc4e9b4b129e744`.

The exact separately pinned auditor then ran once. It exited 1 at `reported-success` because this run failed, before its independent process/ledger/scratch checks, and wrote no audit receipt. Its original tool output is retained in `audit-tool-result.json`.

The dispatcher subsequently completed the independent failed-run cleanup audit: **32 checks PASS**, observed at `2026-11-06T02:40:11.044276+00:00`. Its byte-identical receipt is `dispatcher-failed-run-cleanup-audit.json`, 3,640 bytes, SHA-256 `6867d2a016187bb498b4acb6dffec1fc6c3a5f532ebf848daefccf8fa6898e5d`. The audit independently checked a fresh complete process snapshot, recorded PID/start identities and group ESRCH, the strict locked ledger, scratch/token absence, the original failure/log hash and the 38-event final tldts refusal. This closes cleanup only. The original success auditor remains failed and no renderer case passed. This publication reused the dispatcher receipt without performing new probes.

The separately authorised source-backed compatibility authoring is in `../renderer-format-compatibility-proposal/README.md`. It preserves all original reviewed files and failure captures. The old grant is consumed; independent review and a new exact grant remain necessary before any retry.

Separate accepted actual102 mixed11 and unchanged controller14/policy7 proofs remain valid. Own107's sixteen-case backend selection and nine renderer cases remain unproved; actual105/client/browser/full acceptance stays open. **FUCQ-107 is not built.** No Jira, shared lane, product-map or acceptance state changed; allocator96 was neither read nor run.

Agents: Lego Batman requested/selected `gpt-6.1-sol` / high, no fallback or descendants. The launching lead retains the original lifecycle evidence and the separate dispatcher cleanup audit together.
