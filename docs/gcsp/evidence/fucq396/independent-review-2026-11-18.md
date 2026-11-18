# FUCQ-396 independent review — 18 November 2026

Reviewer: Sulley, requested/selected/runtime-confirmed `gpt-6.1-sol/high`, IBM Global, per the existing parent roster; no fallback or descendants. Saved desktop title was not freshly verified. Source and retained-artifact review only: no reviewer test/application/database/browser runtime, install, Git/Jira writes, source edits or OneDrive access. The explicitly requested review report and small observation JSON are outside the product worktree.

## Decision and reviewed identity

**Source/security and all three original scoped acceptance criteria pass. No actionable findings.** Parent retains integration, the covering batch, lifecycle and final acceptance. A green covering batch or live Render recovery is not inferred.

Worktree: `/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-16-039`. Tested/current base `578ace04ff597e38fba66f4782db5e8b32d1606d`, after FUCQ-376 integration. The original production repair `41800d0a2bf7712bf1b27802e6a9887c39001ccd` is already present. The reviewed new source delta is exactly two test lines: repeat the unavailable database setting for the existing-store replay, then retain the empty-environment replay; assert idempotence for both existing-store iterations. This was a working-tree delta at review time, pinned by the receipt hashes rather than represented as an already committed test tree.

Independent rehash at **2026-11-18T02:16:02.007670+00:00** matched all **53** `inputSha256` entries in the final receipt to current files, including all five selected tests, CLI, fixture helper, policy/artifact/registry/publication modules and canonical policy inputs. Key pins:

| File | SHA-256 |
| --- | --- |
| `server/test/gcsp-fleet-artifacts.test.js` | `77f5c9cb1367b228c5ea462ce288f1edbfac8e5f973d324669fc49d06efb16d6` |
| `server/gcsp/vehicle-evidence/fleet-artifacts.js` | `34f3adb0f001786a9877ddf41429ee52f1f0144aaa3f1e04d79ecd2c5acc0938` |
| `server/test/gcsp-policy-service.test.js` | `8fab460802cde4b98e1151e55140a7e7d7e765d2b1c40c596d3b60ada590c24f` |

## Diagnosis, contract and implementation

The original Bug is offline artifact restore accidentally selecting the runtime PostgreSQL policy provider from `GCSP_DATABASE_URL`. The retained 11 November diagnosis/evidence documents the matching `validate-cache / signature-policy-unavailable` reproduction. It does not establish the precise managed-database incident, an independent manifest checksum fault or recovery from OOM. Historical 60/60 proof remains evidence for its original variant; the current changed policy dependencies/tests require the new run and are not covered merely by that historical count.

Read the original Bug, original repair/durable evidence, current proof reconciliation, current-run constraints, canonical defects/code/security/data-design procedures and applicable GCSP purpose/adapter, build and experience contracts. The original criteria are offline real-CLI cold and idempotent restore with unavailable runtime DB; conflict retains its specific reason and selection/inventory; affected five-file checks on exact Node 20.20.2. Live Render recovery is outside those criteria. No shared quality document is used to add a deployment or migration gate.

Data strategy preserves the existing canonical policy records and retained manifest version pins through `PolicyService`; no store, policy bytes, IDs or derived cache is introduced. In `restoreFleetRelease`, explicit `createPolicyService({ provider: new FilePolicyProvider() })` is limited to offline artifact validation. The current factory honors the supplied provider and leaves ordinary configured runtime provider selection unchanged. `FilePolicyProvider` reads the canonical repository policy files; it does not construct a database provider. All cached, staged and existing-store registry paths receive that same explicit policy service. Source review followed the actual CLI dispatch, restore/registry calls, policy factory and file-provider signatures; async restore/load/publish calls are awaited.

The new loop `[unavailableDatabase, unavailableDatabase, '']` performs a cold restore, an existing-store replay with the **same unavailable loopback database URL**, then the retained empty-environment replay. The latter two assert `idempotent: true`; all three require real CLI success, exact active digest, zero artifact external calls, identical inventory and exact manifest/configuration/VIN/image bytes. The CLI subprocess uses `process.execPath`, so the supervisor's exact Node executable also runs each real CLI case. The synthetic fixture substitutes only the isolated code-owned release descriptor/input; it copies the real CLI/restore source and resolves other imports to real production modules. It does not supply a fake restore answer or a permissive policy service.

The conflict case independently constructs valid candidate bytes with a conflicting existing dataset/version, invokes the actual offline CLI with the unavailable DB URL, and requires `publish-existing / store-rejected / dataset-version-conflict`. It compares both `active.json` and `identity-inventory.json` before/after and reloads the prior version. Thus a success-only test or generic refusal cannot satisfy the negative criterion.

## Security assessment

The changed input is a fixed test-only loopback URL without a password. It is supplied through a subprocess argument array/environment, without a shell. No product entry point, permission, credential, dependency or network authority is added. The offline release still comes from the code-owned allow-list; exact asset byte/hash checks, symlink refusal, canonical corpus/signature validation, source admission and prior-selection protection remain active. The fixture descriptor is isolated under owned temporary test input and is not accepted as a caller-provided production approval list. Existing specific-error/URL-free diagnostic assertions remain intact. No newly reachable security weakness was identified.

No screen, markup, styling, control, response shape or product content changes. `design_impact: no` is appropriate; rendered UI critique would add unrelated scope to this test/build-composition Bug. Production UI or managed-database recovery is not claimed.

## Retained current proof

The final selected command is serial, one worker:

```sh
node --test --test-concurrency=1 \
 server/test/gcsp-fleet-artifacts.test.js \
 server/test/gcsp-fleet-build-entry.test.js \
 server/test/gcsp-vin-registry.test.js \
 server/test/gcsp-vin-publication.test.js \
 server/test/gcsp-policy-service.test.js
```

Receipt command uses the owned exact executable `/private/tmp/vm-poller-20261118-f396/runtime/bin/node`. Log confirms **64 tests, 64 pass, zero failures/cancellations/skips**, runner **8.241 s**, supervisor test chunk **8.797 s**. Overall **329.906 s** includes bounded acquisition and waiting for the parent refresh. Final receipt `result: passed`, exit code 0. This supersedes the old combined count for current-tree proof, while retaining its reproduction history.

The supervisor retrieves the exact archive name's checksum from official HTTPS `SHASUMS256.txt`, verifies the downloaded archive before extraction, extracts only the bounded regular `bin/node` member, checks actual `--version`, and records its binary hash before use. Receipt: **v20.20.2**, darwin-arm64; archive SHA-256 `466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6`, binary SHA-256 `38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6`. This is review of retained acquisition/source evidence; the reviewer did not download or rerun the removed runtime.

Five files cover the owned artifact module, build caller, VIN registry/publication and changed policy-provider dependencies. No full suite, production corpus download, Java/Angular execution, live provider/Render deployment or production database check occurred. No measured per-test V8 coverage contexts are claimed; the proof uses explicit affected-boundary selection, exact input pins and behavioral assertions. Full covering batch remains parent-owned and outstanding.

## Resources and independent cleanup check

Plan/ownership were saved outside scratch and supervisor finalizer registered before allocation. Bounded local runtime and synthetic fixture inputs; no OneDrive access. Runtime acquisition/wait did not hold the shared test lane. Existing primary dependencies were supplied through owned, initially absent worktree links, without installation or source/package changes. Finalizer stops/joins the process group, checks owned processes, guards scratch inode/device, removes owned links, releases HostBudget/lane and records absence.

Receipt: peak allocation **131,776,704 B**, peak inclusive RSS **317,603,840 B**; final scratch removal **89,833,664 B**. The archive had already been removed after verified extraction, so final removal is not presented as aggregate deleted bytes. Root absent, both links absent, `cleanupIssues: []`. Bounded local runtime/test working data is the declared compatibility exception; installed dependencies are preserved.

Independent filesystem/process observation at **02:16:02 UTC** confirms all **13 recorded PIDs absent**, `/private/tmp/vm-poller-20261118-f396` absent, both owned worktree links absent, the exact reservation absent and no lane owned by this run. No other owner's allocation was changed. No leftovers were identified. Reviewer created no scratch/runtime/children: **0 B reviewer scratch cleanup**.

Retained primary local evidence beneath `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/`:

- `resources/f396/{plan.json,supervise.py,ownership.json,receipt.json,focused.log}`
- `resources/f396/independent-review-observations.json`
- `f396-proof-reconciliation-0149.md`
- this report, `f396-independent-review.md`

VERDICT: passed
