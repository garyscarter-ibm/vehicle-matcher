# FUCQ-411 allocation occupancy Sets — 16 November 2026

`DEV-2026-11-13-GC-004`, five points (cap eight); branch `dev/DEV-2026-11-13-GC-004`.
Source checkpoint: `6522de21a`; claim/base `89bb17803bfeac9bff4d880afe6ccf705dc34c2e`, base tree `f4f28b20cebb9ae81004cf6397cee50651999bc7`.
The parent dispatcher owns audited publication, integration into `gcsp-poc-dev`, Jira and collaborator acceptance. No merge, deployment or final switch is included.

## Original scope and implementation

Only `server/gcsp/allocation/index.js` changes in production. After modern successful attempt rows have been reconstructed, or legacy inline assignments have been restored, four invocation-local Sets hold employee, entitlement slot, renewal and car identities. Traversal uses Set membership instead of scanning every assignment. A successful authoritative `tryClaim` appends its assignment and then records its identities; conflict, stale and uncertain results add no occupancy. The existing complete contender list, deterministic ordering, fallback, quote, attempt, stable operation ID, cursor save, CAS and completion paths remain intact.

`Set` equality is compatible with the former strict comparisons except for `NaN`, which is deliberately omitted from the Sets. Missing, empty, null, numeric, string and object identities retain their previous equality; renewal membership remains guarded by the contender's original truthiness test. Sets live for one invocation and are rebuilt on retry. Claim/CAS remains authoritative; this is no replacement claim mechanism or shortlist.

The existing agreed rows/claim/CAS interfaces permit this independent internal performance change. `AGENTS.md`, the demo brief's purpose and adapter boundaries, build rules, experience contract, technical-readiness direction and shared exact-stock/atomic buddy contracts govern the work. Visual references remain `screens/README.md` and `COMPONENTS.md`; no screen, copy, state projection, response shape, policy or presentation component changed.

## Validation and original acceptance

| Selected command | Observed result |
| --- | --- |
| `node --test --test-concurrency=1 server/test/gcsp-allocation-occupancy.test.js` | a03: 6 passed, 0 failed/cancelled/skipped; complete raw summary retained. Supervisor reporter parser failed afterward; Node exit code was not persisted. |
| `node --test --test-concurrency=1 server/test/gcsp-allocation.test.js` | a05: 23 passed; rc 0; no failures/skips |
| `node --test --test-concurrency=1 server/test/gcsp-allocation-ownership.test.js` | a05: 5 passed; rc 0; no failures/skips |
| `node --test --test-concurrency=1 server/test/gcsp-allocation-runtime.test.js` | a05: 7 passed, 1 existing optional native PostgreSQL skip; rc 0 |

41 passing assertions and one explicit skip across the four selected modules. This is scoped evidence, not a full-suite stamp; `.claude/scaffolding.json` has no tests configuration. No full suite, load run, browser, build, Java, Angular, email, database process or deployment was allocated.

- AC1: focused modern attempt-row and legacy inline-cursor cases compare assignments and attempted candidates with the original scan oracle. Existing pending-replay modules also pass. Only restored successes seed occupancy and only successful new claims update it.
- AC2: focused conflict/stale fallback and uncertain-operation retry match the scan oracle. The original allocation tests preserve tie policy and reversed-source determinism; composed runtime checks exercise real conditional-claim conflict/stale fallback, one hold/offer/outbox and replay.
- AC3: restoration, shared identities, competing employees, ties and retries preserve assignments and exclusivity. The operation regression uses eight restored assignments and forty skipped contenders; identity reads stay below 320 including persistence reads. The old repeated traversal scan exceeds that bound. Production traversal has no `assignments.some` call.
- AC4: isolated internal computation preserves visible contracts, so the original `validate` explicitly exempts new screenshots. No fresh rendered evidence was allocated or claimed. A future connected visible change still requires the authored desktop/narrow release/offer/history/no-match/conflict/replay review.

The lead reviewed stat, full production/test changes, restoration/caller order, exact identity semantics, fallback and CAS before marking both durable slices complete. `git diff --check` passed. No original internal-computation criterion remains unfinished. The optional native-PG case reports `native PostgreSQL URL unset`; composed memory checks establish their own boundary and do not claim native PostgreSQL/live BMW acceptance. Collaborator acceptance remains separate.

## Runtime evidence and failures retained

All retained runtime paths below are local to this Story worktree. No OneDrive location was accessed, including for discovery, existence checks or cleanup. Every attempt retained `plan.json`, `run.py`, `ownership.json`, `receipt.json` and `process-identities.json.gz` under `.claude/fucq411-runtime-20261116-a0N/`.

| Attempt | Actual outcome | Complete observed identity count |
| --- | --- | --- |
| a01 | Setup failed: initial installed-pg path was wrong. Zero tests; no scratch created. | 12 |
| a02 | Setup failed: nested native `@rpath` was resolved from Node rather than its referring dylib. Zero tests; no scratch created. | 19 |
| a03 | Focused six passed; TAP-only result parser rejected Node 26's default `ℹ` summary afterward. Node rc was not retained; the parser control flow does not prove rc 0. Raw failure is unchanged. | 30 |
| a04 | Original allocation module failed during import, before its 23 assertions, because the frozen fixture lacked `blocks/vehicle-matcher/feedback-actions.js`. One file-load failure, zero product assertions passed. | 27 |
| a05 | All three original modules passed after selected-root relative import closure was copied. Strict receipt true. | 77 |

These were supervisor/input-fixture failures, not observed production regressions. No successful focused checks were replayed merely to repair a receipt. `a03/focused-reconciliation.json` preserves the exact six-pass summary and its limitation; the a03/a05 manifests share **895 identical input entries**, with a05 adding three read-only static dependencies and its two own control files. This supports reuse of the unchanged focused boundary. Its earlier 151-entry counter excluded source paths because this worktree itself has `.claude` in its ancestry; the complete immutable-manifest comparison is recorded explicitly.

The a05 run pins 900 original source/config/helper/installed-package/Node/native-library files (111,711,248 bytes) before creating scratch and copies 870 source/package files (20,373,542 bytes) into owned scratch. Both original and frozen byte audits passed afterward. It uses installed Node 26.5.0 and its pinned Homebrew dylibs read-only; macOS shared-cache libraries remain supplied by the OS. No installs, dependency symlinks or installed-environment edits occur. HOME/TMP/cache are owned. Selected modules are one worker at a time.

Limits are unchanged: 768 MiB aggregate disk, 1280 MiB aggregate RSS, 2 GiB inclusive, 5 GiB free reserve, 480 seconds work / 600 seconds total with 120 reserved for cleanup, 2 MiB whole retained Story output. The canonical HostBudget registry is `/Users/garycarter/.cache/agent-scaffolding/test-resources`. Each attempt owns only `/private/tmp/gcsp-f411-20261116-a0N` and its token. Manifests precede scratch. An independent deadline thread compares both realtime and monotonic clocks through setup/work/finalization; a realtime alarm also interrupts main-thread work and is reset to the remaining total deadline for cleanup. Resource sampling includes the supervisor, recursive descendants, recorded groups and newly discovered processes carrying the unique inherited token. Full **observed** PID/start/parent/group histories survive in bounded compressed artifacts; samples cannot prove continuous peaks or detect every process between snapshots.

For a05: 17.684 seconds work / 19.056 seconds total; sampled disk 23,101,600 B, RSS 398,721,024 B, inclusive 421,822,624 B; minimum observed free 172,650,782,720 B. Whole retained output at that receipt was 804,256 B, before the small final delivery metadata. All five receipts report process/group teardown, exact owned scratch absence and canonical token absence, with no cleanup or sampler errors. The supervisor attempted stop/join, retained bounded output, audited inputs and removed identity-checked roots independently on failure and success. Parent audit remains independent; no continuous/native containment claim follows.

The selected file/function-to-test map is retained under `.claude/test-runs/impact/fucq411-<allocation SHA prefix>.json`. Final retained allocation and exact receipt/history hashes are in `.claude/fucq411-delivery-index.json`. Disposable source copies and owned HOME/TMP/cache were removed. No source, user document or installed package was removed.

## Tested identities

| Input | SHA256 |
| --- | --- |
| `server/gcsp/allocation/index.js` | `20f678a71675f1f7132ad8c43c6ad344431ccbde052ae0badafcea5b52ad621c` |
| `server/test/gcsp-allocation-occupancy.test.js` | `9ae0b082a34f88eb4d12dc0e5c384924c0c31adc38b366362b17bcfc32d74ceb` |
| `server/test/gcsp-allocation.test.js` | `60cd8c14ffb15b8277f84e0556d2ef7237576b4713dc26f6047f60c3c7bc46f9` |
| `server/test/gcsp-allocation-ownership.test.js` | `704ebd5da29280e8cb6a90dd702e29f700423e8f0a7e28177686379fb6983301` |
| `server/test/gcsp-allocation-runtime.test.js` | `98af37411bbc4a768b1a8000ce4811aad10497129ca397ce4671eeb3f9ec1c74` |

## Handoff and shared learning

Lead Captain Flack 2: requested/selected `gpt-6.1-sol` / `high`, no fallback. Implementer Foxy 3: requested/selected `gpt-6.1-sol` / `medium`, no fallback; saved chat title verified, thread `01a1e61f-37c9-7193-b068-e2ed2c57b82d`. They prepared source only; the lead ran the supervised checks and completed delivery review. Worker claims are expired; native Jira status/observation fields remain untouched for the parent lifecycle sync.

For the dispatcher learning log: retain the wrong installed-pg path, referring-dylib `@rpath`, Node 26 reporter parser and incomplete frozen relative-import closure failures with their distinct actual outcomes. Applied local mitigations are verified by a05's original-module success and cleanup. Focused a03 remains usable assertion evidence with its honest missing-rc limitation. Proposed framework improvement: a small reviewed Node supervisor should resolve installed dependency/native-library/static-source closure before launching a module and persist rc before parsing version-appropriate reporter output. No framework or policy file was changed by this Story.

## Dispatcher integration and retained evidence

Published refreshed worker `62a2b3429c59a72e6e79e052a41db2f2a01e148b` and integrated/pushed `74d9de062` into `gcsp-poc-dev`. The base refresh added disjoint Java and documentation changes; all selected Node input hashes still match. Parent independently matched 897 a03, 897 a04 and 900 a05 input hashes, the five exact receipt/history sets, all current owned identity/group absences, exact scratch absences and canonical token absences. Both original Story contract and 301 foreign map rows are preserved. No successful checks were repeated for integration or receipt repair.

Before the normal branch/worktree cleanup, the eight owned local evidence artifacts were renamed into `.claude/test-runs/fucq411/retained-2041/`. Their original receipt bytes/hashes are unchanged; `relocation.json` maps the historical absolute paths. Parent audit: `.claude/fucq411-parent-audit-2041.json`. The 41-pass/1-optional-skip evidence and a03 missing Node exit-code caveat remain as recorded above. In Review means developed for review, with collaborator acceptance separate. No deployment/final switch or OneDrive access.
