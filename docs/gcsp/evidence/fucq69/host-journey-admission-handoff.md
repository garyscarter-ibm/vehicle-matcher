# FUCQ-69 root admission handoff · 6 November 2026

**Historical consumed freeze:** root consumed the two `0911` grants once at `6b2b6a0`; the supervisor exited 1 before Node and the original run remains incomplete. Root completed separate cleanup. The [parser diagnosis and new review freeze](host-journey-parser-repair.md) supersede the launch pins below. Those historical pins and command are preserved for provenance and must not be reused. The revised parser has no execution grant.

**State: static PASS only; no mirror, execution, probe, import or allocation grant.** Root reports technical_readiness_review's narrow PASS at `b9a55cdf08d77f737431cc3c394ca3e107032589`: both HOLDs resolved; requested/selected `gpt-6.1-sol` / `high`, no fallback. Author's 3,209 static metadata/carried-pin checks passed. No new helper/provider/syntax/test was executed. This handoff changes no frozen input.

Working directory: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-068`; branch `dev/DEV-2026-11-04-068`. Reviewed source/helper checkpoint: `b9a55cdf08d77f737431cc3c394ca3e107032589`. The 145 F100 sources stay at `9948bff11ed27f847436c6880db035fe8a54a784`; the own test stays at `89fe959752f3437734bb8bf2eef288b9a8510de1`, SHA-256 `29f6f1d5b99472283d0d8586949d625476127ccf7ad28fb983ad8044acb4ae65`. F100's later `6562e596ea8ff55352ee0a60b4c666d09303ff8a` Resume repair is not adopted. The second reload case remains held.

## Exact frozen pins

All four paths below are under `docs/gcsp/evidence/fucq69/` in the working directory.

| Input | SHA-256 |
|---|---|
| `host-journey-supervisor.py` | `61069a537637d6672dec79183384290a42872b19ac4364e0311dac6249d53f08` |
| `host-journey-closure.json` | `b83638eff79babee03a6ea7c3d6f61f18c7b04954a3be80da8415090d55d302d` |
| `host-journey-plan.md` | `1f5d6ea8890a02fed5a7dce2a9fd44a4c4854fd850747147da9f05900088f1fa` |
| `host-journey-source-proposal.json` | `595aa166dadd15d64c12fef07ddc9e6a304fb5ce93790da4e5d6c03795b95eda` |

The closure contains all physical identity fields (device/inode/size/mode/realpath) and every source content/Git blob pin. It freezes 146 source/test files, 122 JS modules, 351 edge records, 52 packages/74 manifest edges/1,971 files, 259 installed directories, 644 candidates, six guard rows and eight tool paths. Source/dependency bytes: 24,949,246. Optional absences: `canvas`, `pg-native`, `@noble/hashes`.

| Additional guard | SHA-256 |
|---|---|
| `_tools/test_resources.py` | `3e2b4d05b1809e5ec481d7ace3d4dcd286e026b31c3a6f6a7673c6184483d32d` |
| `.claude/scaffolding.json` | `c3645062f8dd8ff6aa9f81a794dddc10fe8b9172475fa2d2174e7e6559672160` |
| `_tools/scaffold_git.py` | `ef8db3e5aab5494c6cdd2b6f7d272b325fc15436348cb7724a9f47b37fbc019a` |

| Tool path | SHA-256 |
|---|---|
| `/usr/bin/python3` | `179301dcb41ea78accc3fa0048a7e6f6710d891945a751a34addd622020c1818` |
| `/opt/homebrew/bin/node` | `70851490e028b3d699a8d6d4e1de909af2a989359ae807974c92af9c6580a8e8` |
| `/bin/ps` | `472992c470606d28f577590decfecd7f4a20f832fd92c671bebc6d44790b5d02` |
| `/usr/sbin/lsof` | `28c36d6b6dfcce1f544717b0d1961aa03441ee0a736fee3e1eaeb215c0fbff4c` |
| `/usr/bin/vm_stat` | `04c1ec2d5939843c9a89a26791020d2017a50ff97a2d5b380af69d5fcdae5a63` |
| `/Library/Developer/CommandLineTools/usr/bin/python3` | `ec201019b3d883e095e753405a6fc5c1ae8f3b4905231dfd3dc6b4a1f348056f` |
| `/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9` | `ec201019b3d883e095e753405a6fc5c1ae8f3b4905231dfd3dc6b4a1f348056f` |
| `/Library/Developer/CommandLineTools/usr/bin/git` | `41ae817006c126205f5d908fa351857d3df1ef6e21c9a516c4e9ea8ee2de935d` |

Python must be launched through `/usr/bin/python3 -I -B -S`; the actual executable is `/Library/Developer/CommandLineTools/usr/bin/python3`, resolving to the separately pinned `.../Python3.framework/Versions/3.9/bin/python3.9`, version `3.9.6 (default, Nov 11 2024, 03:15:38) [Clang 16.0.0 (clang-1600.0.26.6)]` (the closure preserves the exact newline). Node resolves to `/opt/homebrew/Cellar/node/26.5.0/bin/node`. Both Python paths and Node's realpath/identity must match the closure.

## Two separate permissions; one reviewed invocation

**Source-mirror admission:** root must separately authorise the exact immutable blob provider and mirror allocation. Verify all 146 path/mode/blob entries against their two immutable trees, preserve every recorded SHA-256/size, check all installed physical identities/full memberships/optional absences, and confirm the exact six guards/eight tools/configuration. No mutable `060` file is a source. Freeze the actual current documentation HEAD/upstream and reviewed file hashes in root's admission record. Require fresh pressure and strict all-reservation HostBudget admission, not historical headroom. Without this permission, do not run the provider or create a mirror.

**Execution admission:** root separately grants exactly one run of the exact case below, tied to the same closure, source-mirror grant, current admission and original wait-capture destination. No retry, syntax-only run, import-only run, audit helper launch, next mode or broader suite is included. A missing permission is not inferred from the other permission.

The reviewed CLI has **no mirror-only mode or standalone provider command**. Its preparation and Node execution are phases of one supervisor invocation requiring both grants. A physically separate mirror-only run would require authoring/refreeze/review of a new interface; do not invent a flag or launch the existing helper twice.

The source phase's exact API command forms run only inside that owned/reserved supervisor. For each source snapshot group, it calls pinned `scaffold_git.git` with `['ls-tree','-r','-z', FULL_SNAPSHOT, '--', *sorted(EXACT_FROZEN_PATHS)]`; for each row it calls `['cat-file','blob', row['gitBlob']]`. The private bounded adapter executes pinned `/Library/Developer/CommandLineTools/usr/bin/git`; it accepts only those exact known arguments, captures binary bytes reversibly, validates tree/mode/blob/size/SHA-256 and writes only the owned mirror. It disables lazy fetch/replacement objects/global/system configuration and has no active-tree or install fallback. These forms are not independent unsupervised launch commands.

## Conditional once-launch command

CWD must be the working directory above. The following command is a **future root-granted template**, not permission. The two shell variables must contain distinct permissions actually issued by root; the `:?` guards refuse absent tokens. Do not set invented tokens to make the command runnable. Root must establish the bounded external actual-exit/stdout/stderr capture before this invocation.

```sh
/usr/bin/env -i PATH=/usr/bin:/bin LANG=C LC_ALL=C TZ=UTC NO_COLOR=1 FORCE_COLOR=0 \
  /usr/bin/python3 -I -B -S \
  /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-068/docs/gcsp/evidence/fucq69/host-journey-supervisor.py \
  --expected-closure-sha256 b83638eff79babee03a6ea7c3d6f61f18c7b04954a3be80da8415090d55d302d \
  --source-mirror-grant "${FUCQ69_SOURCE_MIRROR_GRANT:?root source-mirror grant required}" \
  --dispatcher-grant "${FUCQ69_EXECUTION_GRANT:?root exactly-once execution grant required}"
```

The separate Node phase command is fixed below, with CWD equal to the actual manifest-owned mirror. The supervisor launches it once after successful preparation/admission; **do not run it directly**:

```sh
/opt/homebrew/bin/node --no-global-search-paths --max-old-space-size=512 --test --test-concurrency=1 --test-reporter=tap server/test/gcsp-manual-gallery-review-journey.test.js
```

Exact selected name: `actual released TEST stock reaches the delivered host gallery and one quoted review without reclaim`. Expected original TAP: tests/pass **1/1**, suites/fail/cancelled/skipped/todo **0**, exact one-name ordered plan. TEST supply is prepared for the actual synthetic employee/run; it proves no live/default/reset/BMW supply acceptance.

## Finite budget and owned paths

- Preparation/execution/verification: **120 seconds each**; one worker; Node's test timeout is 30 seconds. No listener, browser/profile/port, database, native service or external network is allocated.
- Aggregate RAM: **768MiB**, minimum admitted **512MiB**; combined scratch plus retained allocation **128MiB**, minimum **48MiB**. Keep **5GiB emergency disk** and **512MiB host RAM** reserves. Strict registry admission validates every row/owner schema and complete acyclic ancestry, preserves foreign rows and fully charges `max(reserved,observed)`; unknown/malformed admission fails closed.
- Original TAP cap **2MiB**; final receipt/inventory caps **1MiB each**; checkpoint/provisional caps **16KiB**. Existing final serializer/output allowance remains **64MiB RAM / 4MiB disk** and requires root postwrite verification.
- All ps/memory/lsof/provider-Git calls share a **60-second / 2,048-call** cap. Per-call total deadline is 3 seconds (5 for lsof), plus protected terminate/kill/wait; combined output cap 2MiB (memory 64KiB). Sticky failure prevents new commands; retained handles receive protected per-call/outer cleanup. No unknown timeout is success.
- External records: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq69-host-journey/host-journey-<unique12>/`. Before the first process: `plan.json`, `checkpoint.json`, `provisional-ownership.json`, `probe-ownership.json`. The real start is initially explicitly unknown, never inferred as authority.
- Owned mirror/scratch: unique `/private/tmp/test-stamp-shard-<token32>` recorded by `ownership/<token32>.json` outside it before allocation. Actual token/PID/start/device/inode/group bindings come only from that run. HOME/TMP/TEMP point at owned home/tmp after allocation. No broad deletion, installed-dependency mutation or source export outside this owned root.
- Registry: `/Users/garycarter/.cache/agent-scaffolding/test-resources/{reservations.lock,reservations.json}`. Exact physical lock/directory and strict schema/full ancestry must match the closure; no ledger access occurred while authoring this handoff.

## Launcher's checkpoint and cleanup duties

Preserve the original supervisor wait/actual exit and bounded stdout/stderr externally, then collect original TAP, plan, scratch ownership, provisional ownership, probe inventory, checkpoint and receipt on every outcome. No credentials/raw principal/contact/command-envelope dumps; retain fixed diagnostics and mutation/event counts only. Preserve all failure evidence without overwriting an earlier run.

Every probe/Git handle remains in its preallocated strong-reference slot until direct joined/returncode proof; exact starts are added only when observed. Per-call and outer finalizers cover the first ps, constructors, admission, preparation and Node. Node stop/join remains independent of telemetry/manifest failures. Before inode-bound scratch deletion and locked exact reservation release, require owned process/group/open-file absence and full live owner/root/allocation binding. The last complete ps must cover every probe/Git command; no new process launches after release. Unknown cleanup retains named inventory/root/reservation where still owned and makes the actual controller incomplete.

Root independently audits postwrite JSON/schema/hashes/sizes/allocation/resource bounds, actual controller exit **0**, exact one-case original TAP, all immutable source/dependency/tool pins, scratch/process/group/open-file/reservation absence, all probe/Git PID/start/joined bindings and final command-sequence proof. A passed inner receipt cannot override an outer-finalizer failure. Do not launch a separate audit helper without its own agreed bounded launch. Report originals first; no automatic retry/repair/publication or story completion.

Accepted history/Back evidence is unchanged and needs no rerun. Active-quote reload, later F100 repair adoption, normal page/bootstrap/reset/principal notifications, visual/keyboard/320px, live/native/deployed and full-suite acceptance remain open. Root owns the final receipt and any next grant.
