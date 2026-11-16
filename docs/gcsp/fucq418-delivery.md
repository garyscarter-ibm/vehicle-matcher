# FUCQ-418 static suitability reuse delivery

Lead: Dot, started 14 November and resumed 16 November 2026. Original eight-point Story DEV-2026-11-13-GC-011; branch `dev/DEV-2026-11-13-GC-011`, base `23bc642671a49b30b8d289bfd4b30a68449da44a`. The five original criteria remain fixed. This document records development evidence; collaborator acceptance remains separate.

## Source-backed plan

The existing FUCQ-417 `createAllocationRecommendationEvaluator` exposes compact `evaluate` and detailed `quote`. `createAllocationService` currently constructs an evaluator for every employee calculation, including frozen one-car attempted quotes. A service-owned cache explicitly passed to these ephemeral evaluators can therefore survive consecutive releases without changing provider, policy or quote lifetimes. The Story is already associated with verified `recommendation` and `allocation` product-map components.

Stable slices, declared before delegation, total eight points:

- `static-cache` (six): bounded in-process preference-score reuse, safe reset/eviction/missing-state fallback and focused deep-equivalence/count regressions. Actual scoring inputs determine reuse; pool digests and exact stock identity do not. Cached values contain no stock identity.
- `integration` (two): review consumers and deterministic complete fallback/quote/replay behavior; original four modules plus affected compact consumer; reconcile native and existing connected rendering evidence; retain result and resource receipts.

The cache is limited to invariant `scorePreferences` output. All policy reads, essentials/driver/affordability checks, timing/deadlines/availability, charging gates and typed feedback judging stay per operation. Allocation still reads current permission, declines, holds and occupancy and uses authoritative claim/CAS boundaries. Terms and detailed quote identity/provenance remain reconstructed from frozen operation inputs. No new ranking, top-K, scheduler, persistence, distributed cache, UI or policy behavior is planned.

## Boundaries and selected validation

Exclusive source: `server/gcsp/recommendation/index.js`, `server/gcsp/allocation/index.js`. New regression: `server/test/gcsp-static-suitability-cache.test.js`; named original test edits only if necessary. Lead records only this delivery note, its claimed Story and FUCQ-418 map row. Peer repository/backend/Java/Angular paths stay read-only.

Selected: focused static cache module; original `gcsp-allocation-runtime`, `gcsp-allocation-triggers`, `employee-recommendation-feedback`, `gcsp-clock-reset`; affected direct `gcsp-allocation-compact` consumer. Each uses `node --test --test-concurrency=1`. No full/load suite is justified for this internal bounded change. Native PostgreSQL on the relevant path is required for database acceptance; actual availability/result will be recorded. Small fixtures demonstrate semantics and operation counts, without hosted-latency claims.

Presentation reference: `docs/gcsp/screens/README.md`, `COMPONENTS.md`, frozen `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`. No rendering source changes. Existing F417 acceptance disposition maps release/offer/history/no-match/conflict/replay at desktop/narrow to F415 retained actual native HTTP/browser evidence. Reuse requires current renderer identities, retained result/capture identities and semantic equivalence across this changed calculation; it never converts a historical observation into a fresh execution or a separately rendered conflict message.

## Resources and agents

Absolute human OneDrive prohibition applies to every operation, including audit/cleanup. Historical cloud-aware runners/finalizers are not executed. Only a new finite local runner under shared `.claude/test-runs/fucq418/` may allocate owned `/private/tmp` scratch after canonical resource registration/readback. One worker, aggregate scratch+RAM at most 2 GiB including supervisor and descendants, work at most 480 seconds and total at most 600 seconds including cleanup. Minimum disk reserve 5 GiB; adapt below 30 GiB. Retained evidence stays compact and local.

Dot requested/selected Sol/high; Foxy 2 requested/selected Sol/medium through fresh tiers/capacity, no fallback. Effective execution/title and final resource receipts will be recorded at delivery.

## Reviewed implementation and original criteria

The allocation service owns one cache and explicitly passes it to compact evaluations and recreated detailed quote evaluators. The public recommendation service keeps its existing path. Only `scorePreferences` output is retained: at most 512 entries and 4 MiB of serialized key/value bytes, with LRU eviction. JavaScript object overhead is additional; the entry limit bounds it. Reset, service restart, run/environment transitions, disabled/oversized entries, unsupported data and unrecognized/incomplete cache objects recompute safely. Cached values are detached and frozen; hits return clones.

The key includes vehicle display name, complete facts/provenance, employee facts, preferences, configuration and slider. Canonical object keys permit structurally equivalent facts to share work. Preference order and overlapping option-bundle-family order remain explicit because they affect observable explanations or calculation. Pool/facts/stock wrapper versions, snapshot version and order/VIN identities are excluded. Exact candidates and quote snapshots remain per operation. Source review checked the complete preference calculation and its option-evidence/retail calculation dependencies; no changed calculation input is omitted.

| Original criterion | Lead evidence and disposition |
| --- | --- |
| Unrelated stock/digest reuse; equivalent signatures without identity conflation | Focused case preserves one computation after changing wrapper versions and adding an equivalent twin, while each decision/quote retains its exact stock identity. Subsequent distinct facts add only their own computations. Historical output stays frozen. Supported. |
| Relevant invalidation; fresh operational conditions | Focused comparisons cover display/facts/provenance, preference value/importance/state, employee circumstances, policy weights, slider, order-sensitive policy, run and environment. Clock/terms, deadlines, feedback and availability remain current. Existing allocation/triggers/runtime cases exercise permissions, declines, occupancy, stale/conflicting claims and replay. These operations remain outside the cached function. Supported by source review and selected results below. |
| Reset/eviction/restart/incomplete state; deterministic explanations/fallback | Deep cached/uncached equality for compact and detailed outputs; bounded entries/bytes, reset, restart, disabled and fake cache; actual allocator conflict fallback and successful exact quotes. Replays make no extra claims or scoring. Supported. |
| Consecutive releases score changed inputs | Actual allocation-service fixture, three releases with growing pools: cached computations are exactly **8**; disabled-cache computations are greater than 8. The exact disabled count was not retained and is not inferred. Full outcomes are deeply equal. Direct evaluator case also checks counts after each stock/fact change. These are synthetic computation counts, not latency, query-count or production-memory claims. Supported. |
| Preserve connected desktop/narrow presentation | Unchanged rendering identities, historical native/browser observations and independent reviews are mapped below. Changed backend output is bridged by cached/uncached equality, complete fallbacks and quote/replay cases. Supported at this unchanged presentation boundary; no fresh browser execution is claimed. |

No new product defect was found. Below-High existing findings remain separate and unfixed: the reused F417 disposition records Low F400 and Medium F484/F494; this Story neither repairs nor accepts them.

## Executed validation and source identity

Commands use the verified `/opt/homebrew/Cellar/node/26.5.0/bin/node`, a scratch-owned ESM loader resolving the already installed `pg` package, `--test --test-concurrency=1`, and each named `server/test/<module>.test.js`. No dependency installation or source `node_modules` write occurred.

| Module | Passed | Skipped |
| --- | ---: | ---: |
| `gcsp-static-suitability-cache` | 10 | 0 |
| `gcsp-allocation-runtime` | 7 | 1: native PostgreSQL URL unset |
| `gcsp-allocation-triggers` | 18 | 0 |
| `employee-recommendation-feedback` | 16 | 0 |
| `gcsp-clock-reset` | 21 | 0 |
| `gcsp-allocation` | 23 | 0 |
| `gcsp-allocation-compact` | 6 | 0 |
| Initial selected total | **101** | **1** |

The original four prescribed modules ran. `gcsp-allocation` additionally covers the changed service default's permission/decline/occupancy/replay guards; compact is its affected direct consumer. No full suite, load test, hosted-latency campaign or new screenshots were justified or run. No full test stamp is claimed; this is explicit scoped command evidence.

Native-only continuation passed **1 executed/1 passed**, with seven nonmatching source tests omitted by Node 26's name filter (its report says zero skipped). Exact command adds `--test-name-pattern='native PostgreSQL persists bounded tick and command JSON across six releases'` to the runtime module. Fresh installed **PostgreSQL 16.15**, with its own local cluster/socket/port, exercised six 12-car releases through the actual PostgreSQL repository and composed runtime. SQL maximum tick JSON was **5,342 bytes**, clock receipt/command JSON **5,517 bytes**; canonical allocation evidence remained **388,151 bytes** and the final compact clock outcome **147 bytes**. This closes the missing original database check on the unchanged tested source. The initial URL-unset skip remains an actual historical skip. Overall successful executions are **101 selected cases plus this one native case**; no other selected cases were rerun in the continuation.

All successful selected runs used these unchanged source hashes:

| Path | SHA-256 |
| --- | --- |
| `server/gcsp/recommendation/index.js` | `e2c17346b6a9fbb20f7a87bf2cdd4c385fc1473cce6935f2b94522ae4b182ca2` |
| `server/gcsp/allocation/index.js` | `49d93ba5be97832fa2882d18b153459e0d3038c9cd4296cdd542c18358eeedd1` |
| `server/test/gcsp-static-suitability-cache.test.js` | `a969f6e435d90ad2de998e1b055bf2add3a1c3c4880049be39398ec2942b8571` |

Full input identities, commands, exit statuses and log hashes are in the local receipts below. Parent reports subsequent peer work did not change this Node boundary; the dirty worker was not synchronized or rebased. Dispatcher integration remains separate.

## Connected evidence reuse

Reuse `docs/gcsp/evidence/fucq417/acceptance-disposition.md` and its `acceptance-input-map.md`, which map F415's actual native PostgreSQL HTTP app, 42/42 browser checks and ten independently reviewed captures at 1440×1000 and 375×812. Dot verified the retained result and all ten capture hashes on 16 November; no old runner/finalizer was executed and no fresh browser or independent visual review is claimed.

The five paired states are no-match/history, release, pending offer, conflict/replay resulting accepted offer, and accepted history. The retained conflict proof is API acceptance, identical replay, changed-input 409 and the resulting accepted display; it does **not** show a separately rendered conflict message. F415 lead/Cool Cat inspections are reused with their original observation times. The retained result is `.claude/test-runs/fucq415/henery-hawk/browser/result.json`, SHA-256 `72623bb973535879c8f50a76df53ee2b879f9768da2d6b74f49451b946ad5b5a`.

Final helper comparison against F415 `cb5064ed3090ca61adf90c5ea1fb5accfb3fc250` finds no changes in `blocks`, `assets`, `scripts`, presenter/offer/live-activity HTML or `gcsp-employee.css`. Current Git objects are blocks `d461603d064a78504cdee2605ef39ce1fcee716a`, assets `fb30b145433d7760e743f7de80d5cecd8e34848c`, scripts `d9fef37309094d29e33ab219684995d0bf6c6761`. The source changes introduce no rendering consumer or response contract. Fresh native testing of this source, where performed, is reported separately from historical connected evidence.

## Failures, resources and retained receipts

Local evidence root is `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq418/`; no large evidence is committed. Canonical host reservations were acquired/read back under lock, with explicitly local `/private/tmp` scratch. No OneDrive path was accessed, checked or cleaned. Borrowed Node and 13 installed package trees were read only.

- `foxy-20261116T054243-413992/receipt.json`: first focused run failed before case discovery because `pg` did not resolve in the isolated worktree. A scratch-owned resolver then used the existing authorized server installation; no install was needed.
- `foxy-20261116T060250-9005b3/receipt.json`: focused **7 passed/2 failed**, caused by test assumptions about absent optional preference weights and a missing fixture model-line fact for feedback. Only the new test was corrected. The succeeding focused run `foxy-20261116T061640-05805a` passed **9/9**; the later expanded fixture passed **10/10**.
- `foxy-20261116T061728-d43ee1/receipt.json`: six-module batch **95 passed/1 skipped**, every command exit zero. Measured RSS peak **416,284,672 bytes**, scratch **4,352 bytes**. This earlier runner omitted sampler RSS and retained output bytes from its peak; full historical aggregate peak therefore cannot be established. Strict success predicates were improved afterward without rerunning passed modules merely for reporting.
- The same batch's total realtime deadline **failed**: ownership manifest `created=1794809849.0533812`, `removed=1794811647.0935879`, span **1,798.040 seconds**, exceeding the 600-second total limit. The runner reported `time.monotonic()` duration **290.976 seconds** and used that clock for work deadlines; Node reported runtime **1,142,294.306 ms** and clock-reset **608,572.859 ms**. Clock/suspension cause is unverified. Passing tests do not establish compliance with the resource deadline. Dispatcher learning **DL-20261116-GC-007** records the confirmed failure; dual-clock enforcement is a mitigation for the native continuation, not retroactive resolution.
- `foxy-20261116T064742-21fede/receipt.json`: compact **6/6**, exit zero, **8.542 seconds**, inclusive sampled RSS **332,398,592 bytes**, disk **78,176 bytes** including retained outputs. Original receipt remains `status: failed` because the canonical process-state parser returned `groups_live[28512]=null`. Both later audits prove the owned group absent; the unknown original observation is preserved. No test rerun was used to change this receipt.
- `foxy-final-audit.json`, SHA-256 `385af77e92861d785fe4f54674e22a837df914e0b1c70f7a69fe2987ee1b7768`: worker audit verifies all five batches' owned resources absent, inputs and borrowed files unchanged.
- `dot-final-audit.json`, SHA-256 `b8f4c5345593dc38d32b22080a17e1543ef1d59052c71afe31d973d981c8e587`, observed **16 November 07:49:22 UTC**: independent lead audit verifies all five batches' supervisors, process groups, ports, scratch and canonical tokens absent; **126** borrowed files retain device/inode/hash; current three changed source hashes match. Its own 16 MiB disk/128 MiB RAM reservation was removed; unrelated reservations were preserved. This fresh absence audit does not repair historical telemetry/deadline failures.
- `foxy-native-20261116T075224-54aae1/receipt.json`: native supervisor setup failed before commands/tests because the system Python lacks `hashlib.file_digest`; **zero tests executed**. It removed its owned scratch/reservation. Streaming hashing replaced that unsupported API in the local runner; no product source changed.
- `foxy-native-20261116T075243-90e3a7/receipt.json`, SHA-256 `5684f43122f0690fbd84eaf4a9979b366881070a8ea2cb1d8d081e6ed3ccaf89`: native **1/1**, strict receipt `passed`, UTC **07:52:43.173649–07:52:59.384058**, realtime **16.227804 seconds**, monotonic **16.227862 seconds**. Inclusive sampled RSS **392,019,968 bytes**, disk including retained output **44,509,472 bytes**, cleanup **0.165647 seconds**. It enforces both clocks, full descendant/group accounting and strict teardown predicates. All **815** source/input and **3,939** borrowed identities/hashes remained unchanged; owned processes/groups, port 51305, scratch and canonical token were absent. This verifies the finite mitigation on this native run only; the earlier deadline failure remains unresolved.
- `dot-native-audit.json`, SHA-256 `9935eb04d8e86bbd7fab4081bc346a81bcae7d8a115b3f2553fa6dc50646f96f`, observed **16 November 07:54:15 UTC**: independent lead audit verifies both native attempts' supervisors/groups, port, scratch and tokens absent, selected Node/initdb/postgres/pg identities and current changed-source hashes unchanged. Its own reservation is removed and unrelated reservations preserved. Native runner SHA-256 is `cd8f88fcf570fd37940206eacdd881265d858dee1384236f2433c16b75a1e7ab`.

Other compact evidence: `dot-evidence-reuse.json` SHA-256 `18e429ef4cc08b27864c4ba3be6632bfc7f0166da6197d1d3c27d2d9be3abc98` (initial audit; final renderer comparison is separate); `dot-git-review.json` SHA-256 `51228d4b96af4538c2bddca10d62723e1dec9fabd3543feed6aad31167f3cdaa`; current corrected `foxy-runner.py` SHA-256 `9923a5b74bf294d6c9c838efec7843f303ed9b39570102dbe7521287791df56c`. Original receipt hashes are retained by the lead audit.

Gateway 422 diagnostics from 14 November remain in `dot-diagnostics.json`: cf-rays `a5a7c561ef3d467f-LHR`, `a5a7c82dab09e839-LHR`, `a5a7c5b58f5763dd-LHR`, exact IBM endpoint/error retained. Same Dot/Foxy agents resumed while the launcher worked; no credentials, endpoint, model or effort changed. Dot requested/selected/effective Sol/high and Foxy 2 Sol/medium; no fallback. Both desktop titles were verified. No new writer was started.

## Development disposition

**Built at the original development boundary; HOLD for dispatcher audit/publication.** All five original criteria have supporting evidence above, including the actual native database path and mapped connected presentation inspections. The source and tests are frozen; the two stable map slices are complete and observed worker claims are stopped. Helper configuration is base `gcsp-poc-dev`, merge `auto`; final whitespace check passes. No full acceptance/Done is inferred from this development result. The **prior realtime resource deadline failure is an actual remaining delivery limitation**, despite verified cleanup and the successful finite native mitigation.

Original acceptance text, Story points and allocated files are unchanged. No Jira, push, merge or Done transition is performed by this worker. Dispatcher owns serial publication/integration, the final exact commit identity and collaborator acceptance; review this evidence and the resource failure before integration. No further tests or framework implementation are requested by this handoff.
## Dispatcher integration — 16 November 2026

Parent source and evidence review passed for the frozen `9ce2ff190800a36793c19de8ca0a98760472c4db` checkpoint. The parent independently checked all 815 native inputs, 3,939 borrowed identities, seven attempts' owned resource absence and the retained result hashes. Integrated through `71cc0dd432621d37862707549ab208d6c87ab7e7` and pushed to `gcsp-poc-dev`; native Jira is In Review, and helper branch/worktree/lease cleanup completed. All 301 foreign product-map rows and outer bytes were preserved. Original criteria and collaborator acceptance remain distinct; no Done transition occurred.

The main batch's 1,798.040-second realtime ownership exceeded its 600-second deadline. That actual failure, unknown historical aggregate peak and earlier failed/setup/skipped attempts remain recorded. The later original native case passed dual-clock limits and does not erase them. No tests were repeated for this parent disposition, and no OneDrive location was accessed.

