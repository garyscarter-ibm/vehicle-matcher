# FUCQ-396 current-tree proof — 18 November 2026

Status: scoped development validation and independent original-acceptance/source/security review pass without actionable findings. Original Bug scope and acceptance are preserved. Parent owns integration, covering batch, claim lifecycle and native Jira status. No native Done or live Render recovery is inferred.

## Existing repair and exact increment

The production repair `41800d0a2bf7712bf1b27802e6a9887c39001ccd` is already present. `server/gcsp/vehicle-evidence/fleet-artifacts.js` matches that repair byte-for-byte: artifact restore explicitly composes `FilePolicyProvider`, while runtime policy selection and retained manifest validation stay unchanged. No production source is edited in this increment.

Parent refreshed the Story branch to `578ace04ff597e38fba66f4782db5e8b32d1606d`, including F376, before this proof. The sole source delta is two regression lines in `gcsp-fleet-artifacts.test.js`: cold restore with an unavailable database URL is followed by an existing-store replay with that same unavailable URL, then the retained empty-environment replay. Both existing-store replays must report idempotence. This closes a concrete original-acceptance proof gap: the earlier loop only exercised the empty URL for its existing-store replay. No test assertion is removed or weakened.

Prior 11 November evidence remains valid for its original code/environment variant. The five-file 60/60 result is not relabelled as current-tree evidence: policy dependencies and the policy-service test have changed since that repair. The current selected command was rerun once after the integration refresh, with the authorised regression extension.

## Original acceptance evidence

| Original criterion | Current proof |
| --- | --- |
| Actual offline CLI cold restore and idempotent existing-store restore, runtime DB unavailable | Real CLI test passes; each subprocess uses `process.execPath` from exact Node 20.20.2. Both cold and first existing-store replay use the same unavailable loopback PostgreSQL URL. Existing replay reports `idempotent: true`; empty-URL replay remains covered too. Pinned manifest and retained corpus/VIN/image/inventory bytes are compared. `externalCalls` is zero. |
| Conflicting candidate retains the exact failure and selection/inventory | Separate real CLI test passes with the unavailable URL: `publish-existing` / `store-rejected`, validation `existing` / `conflict`, specific `dataset-version-conflict`; `active.json` and `identity-inventory.json` stay byte-equal, prior version remains loadable. |
| Artifact, build-entry, registry, corpus-signature and policy-provider checks on Node 20.20.2 | All five selected files pass: 64 checks, zero failures, errors, cancellations or skips. This includes source/signature admission, immutable identities, previous-selection protection and current scoped policy reads. |

The fixtures are small synthetic stores and retained policy files. No production database or real fleet corpus was used. The unavailable database URL targets loopback port 1; no native PostgreSQL or Render database was started or touched. CLI fixture modules preserve the real restore/CLI implementation and code-owned descriptor boundary; they replace only the synthetic approved fixture descriptor and resolve imports to the current repository modules.

## Command, runtime and identity

```sh
node --test --test-concurrency=1 server/test/gcsp-fleet-artifacts.test.js server/test/gcsp-fleet-build-entry.test.js server/test/gcsp-vin-registry.test.js server/test/gcsp-vin-publication.test.js server/test/gcsp-policy-service.test.js
```

Actual executable: the owned `/private/tmp/vm-poller-20261118-f396/runtime/bin/node`, verified `v20.20.2`, darwin-arm64. No exact local Node20 binary was available in the bounded location probe, so the official Node archive was acquired into supervised local scratch, verified against the official `SHASUMS256.txt` before use, and only `bin/node` was extracted. No package installation or product dependency change occurred.

| Runtime item | Observed value |
| --- | --- |
| Official archive | `node-v20.20.2-darwin-arm64.tar.gz`, 41,511,345 logical bytes |
| Official and actual archive SHA-256 | `466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6` |
| Extracted binary | 89,830,192 logical bytes |
| Binary SHA-256 | `38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6` |
| Test runner duration | 8.241 s |
| Supervised test chunk | 8.797 s |
| Total supervisor duration | 329.906 s, including acquisition and bounded wait for parent integration refresh |

The existing real primary `pg 8.23.1` and `jsdom 30.0.1` installations were used via owned worktree symlinks. No stub or replacement dependency was introduced; both links were removed after validation and primary installations are preserved. No inherited runtime database/policy variable required clearing.

Test input code key (SHA-256 of canonical per-file SHA map): `a1573b2d5b1cb573487f9e4235ca42b4b8bdf7828d655129610fc43164278608`. The receipt pins selected tests and the policy/artifact dependency modules, CLI and corpus helper; all current files were rechecked against those pins after the run.

| Critical file | Tested SHA-256 |
| --- | --- |
| `server/gcsp/vehicle-evidence/fleet-artifacts.js` (unchanged) | `34f3adb0f001786a9877ddf41429ee52f1f0144aaa3f1e04d79ecd2c5acc0938` |
| `server/test/gcsp-fleet-artifacts.test.js` | `77f5c9cb1367b228c5ea462ce288f1edbfac8e5f973d324669fc49d06efb16d6` |
| `server/test/gcsp-policy-service.test.js` (current dependency boundary) | `8fab460802cde4b98e1151e55140a7e7d7e765d2b1c40c596d3b60ada590c24f` |

Syntax check under exact Node20 and `git diff --check` pass. The strict targeted selector was inspected with `--dry-run`; actual execution ran through the bounded external supervisor. No successful test-stamp claim is made. The compact atomic impact map `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact/fucq396-20261118.json` records file/function-to-test ownership, fixture/config/subprocess edges, exact input identity and timings. No V8 or per-worker measured coverage contexts were collected. The impact map records reviewed static ownership plus the actual executed checks; it is not measured coverage and cannot prove unobserved paths irrelevant. No second coverage-only run was performed.

## Scope and presentation boundary

This increment changes a regression environment variant and evidence only. It preserves the real CLI's one-line bounded failure/presentation envelope, exact conflict reason, URL/path omission and build-entry checks in the selected suite. No screen or user-visible product behaviour changes, so a rendered visual critique is not applicable. No unrelated UI completion is claimed.

Full suite: **deferred to parent batch**. No full corpus download, new BMW traffic, live provider, Linux/Render deployment or managed-database recovery proof is included or required by the original bounded acceptance. Live Render recovery remains unknown and is not added as a Bug completion gate.

## Resource receipt

Plan, external ownership manifest and finalizer were established before runtime allocation. One test worker; 2 GiB scratch/RSS bounds; 600 s independent chunk; 5 GiB emergency disk reserve. The HostBudget reservation uses bounded local scratch under the explicit human OneDrive restriction. The supervisor held no shared test lane while waiting for the parent refresh; it acquired that lane only for the final proof and released it on cleanup.

- Peak measured scratch: **131,776,704 allocated bytes**, including simultaneous official archive and extracted runtime.
- Peak measured inclusive process RSS: **317,603,840 bytes**.
- Archive deleted immediately after verified extraction: 41,511,345 logical bytes; its allocated deleted-byte count was not separately measured.
- Final outer scratch removal: **89,833,664 allocated bytes**. Inner test fixtures cleaned their own transient stores; their deleted-byte total is unmeasured. These differently measured figures are not summed as an exact reclaimed total.
- Exact owned `/private/tmp/vm-poller-20261118-f396` absent; both root/server worktree-only dependency links absent; owned children stopped/joined, HostBudget reservation and shared lane released; cleanup issues `[]`. No runtime, archive, scratch or dependency-link leftovers.
- No OneDrive reads, writes, stats, cleanup or indirect output destination. No browser or foreground interaction. The temporary Node runtime and synthetic test working set used the declared bounded local scratch exception under the human restriction; no retained large output or native database was created.

Local evidence: `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f396/` holds `plan.json`, `supervise.py`, `ownership.json`, `receipt.json`, bounded `focused.log` and `summary.json` with the 64-check ledger, identities and resource summary. Source data is not copied into retained evidence.

## Independent review

Sulley independently reviewed all three original acceptance criteria, the sole test delta, existing production repair, security and retained proof: **passed, no actionable findings**. All 53 input pins matched the current files. His independent observation at 2026-11-18 02:16:02 UTC found all 13 recorded PIDs, the exact owned root/links/reservation and this run's lane absent. Reviewer ran no runtime/children/scratch (0 B reviewer cleanup). Exact report: `independent-review-2026-11-18.md`. Parent retains covering batch, integration, claim lifecycle and native acceptance.


## Post-proof refresh reconciliation — 18 November 2026

Parent refreshed the clean Story worktree to `3afcac0167edd41ba92dc649f49c5229f6e06d4e` from root `33807da0b1126bdc6d16f359f5f9b2422bff0dd8`. All **53** tested input/dependency SHA-256 pins still match the final receipt, independently of the changed Git commit ID. The parent-reported root delta is F376 closure/cleanup, F387 claim, product-map metadata and peer F443 manual proof/docs/Story records; no server, package, dependency or runtime source changed. The existing **64/64 exact Node 20.20.2** proof and source/security review are reused with those unchanged identities. No application runtime or duplicate test run was started; Mater owns the separate F387 proof lane. Local exact observation: `resources/f396/post-refresh-reconciliation.json`. Measured V8/per-worker coverage remains uncollected; a static ownership map is not measured coverage. Parent covering batch and acceptance remain outstanding.
