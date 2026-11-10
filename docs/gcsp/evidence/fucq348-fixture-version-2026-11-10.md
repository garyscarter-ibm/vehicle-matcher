# FUCQ-348 fixture repair — 10 November 2026

The allocation identity regression now reads the employee row inside its fixture transaction and passes that row's version to the existing compare-and-swap operation. The shared helper and every production source remain unchanged. Origin FUCQ-96 is verified in the claimed Bug; FUCQ-309 only discovered the lost coverage.

## Original acceptance evidence

- Current fixture version: `tx.get(resource)` must return `ok`; `tx.compareAndSwap(resource, row.value.version, ...)` keeps repository enforcement intact.
- Original authority assertions remain verbatim. The successful fixture write precedes the cross-scheme denial. Full module: **3 passed, 0 failed, 0 skipped**, including forged context, employee/nonpresenter role, unknown principal, cross-run, cross-scheme, expired session and reset run.
- Only `server/test/gcsp-identity-allocation.test.js` changes executable code. Allocation, identity, repository, policy and the shared fixture helper are unchanged.

## Scoped verification

Base/HEAD before repair: `3e7a7d71ffe0c65a29de6cb5e603e087929861ba`; Node `v26.7.0`, default variant, offline memory repository. Automatic targeted selection refuses the unconfigured JavaScript runner with exit 2; no fallback full suite ran.

1. Initial exact focused command failed during module import because this worktree has no installed `pg`. This is retained as an environment preflight failure, not the Bug's regression.
2. Reused the existing resolve-only `fucq309-local-deps.mjs` through `NODE_OPTIONS=--import=/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq309-local-deps.mjs`. It resolves only `pg` to the read-only retained DEV-2026-11-04-069 installation, version 8.23.1; no source transformation, install, symlink, native connection or edits in that claim.
3. `node --test --test-concurrency=1 --test-name-pattern='cohort resolution rejects' server/test/gcsp-identity-allocation.test.js`: **0 passed, 1 failed, 0 skipped**, with `stale-version`, expected 2/current 3 at the fixture write.
4. After repair, `node --test --test-concurrency=1 server/test/gcsp-identity-allocation.test.js`: **3 passed, 0 failed, 0 skipped**; 0.450s Node duration / 0.819s supervised wall. The red and green used the same dependency resolver and policy input.

The reviewed helper callers are `gcsp-allocation.test.js` and `gcsp-allocation-triggers.test.js`. They consume the unchanged fixture; this repair only changes a local test mutation. Their tests, the full suite, native/deployed services and browser checks are excluded because no shared/product path changes. No UI review applies: a Node test setup mutation changes no user-visible behavior or screen. No images were supplied. No post-deploy smoke was authorised or needed for this test-only change.

## Identity and retained proof

- `server/test/gcsp-identity-allocation.test.js`: `55b05d04ced8fdad9bae69dbab9abfc5e199f26912259054da50329686f59734`
- `server/test/helpers/gcsp-allocation.js`: `e202a6118bb62b0485fc628e4835b39ad4ec7efde1c394b16a5793b9614c7a31`
- `server/gcsp/allocation/index.js`: `1c43791983f39e7c791cd846af8b19c119115592cbdb6c5e98b4f9895cf8655f`
- `server/gcsp/identity/index.js`: `ec6af5d8771d59689a25f10d45ed68e13ec221b860d0095ba5fe727a1d47f2b7`
- `server/gcsp/policy/seed-v1.json`: `df662536da13cc1732c093c9969a34a7e3c9452aa9a39bfa63be45f6f6c77b0c`

- Resolver SHA256: `0e01fe0617792787b04b8dc499273b27b044de0850602f0bd5045ca6cf807e26`.
- Retained `pg/lib/index.js` SHA256: `3fad6e6d3d976edbabe0cbc9e1d39f4340bcb719bbbb186a0d3a24f3dbd4a94c`; package metadata SHA256 `b1e53333a3d0c2c47c49a5cb919d221135dc03145df740925b899bc2baacc435`.
- Green test-stamp working code key: `59a81be55c4fb113ebf96c09bd487cc83e857371cb003675ab9eb29169f6a788`; environment digest `1727f24c79e4b17308587e85a60dbdf9e4fbcd315fd7b41f05b905391d81e3ac`. Subsequent edits are delivery metadata/docs only; the tested source hashes above remain the validation boundary.
- Local retained plans, receipts, bounded logs, targeted proof and checkpoints: `/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110/fucq348-*` and `fucq348-supervisor/`. Compact reviewed impact map is under the shared `.claude/test-runs/impact/fucq348-55b05d04ced8fdad.json`. No measured per-line coverage is claimed.

## Resource and review receipt

The existing test-stamp/resource supervisor registered ownership outside each scratch root, used one worker and the machine-wide short-held reservation lock, propagated TMPDIR/TMP/TEMP, stopped/joined each process group and ran context finalizers. Budget: 128 MiB scratch, 512 MiB RAM, 120-second bound per chunk. All three chunks completed; maximum sampled process-group RSS 201244672 bytes, maximum sampled scratch 0 bytes. Three owned roots were removed and independently checked absent; groups 43555, 44284 and 44442 are gone, and their reservations released. No temporary dependency links, descendants, browser profiles, large/cloud outputs or compatibility exceptions exist. Small plans/receipts/logs remain; no disposable successful output tree is retained.

Lead B-Bot reviewed the complete six-line fixture diff, confirmed all original negative assertions and the unchanged helper/product hashes, and accepted both durable repair and scoped integration slices. Chat title set and saved as B-Bot, thread `01a1c640-7711-78c0-9a7f-24dc36b7bd44`. `tiers spawn` default requested Sol/high; explicit human override requested and selected `gpt-6.1-sol`/`xhigh`, no fallback or descendants. Local `turn_context` independently records model `gpt-6.1-sol`, effort `xhigh`.

Parent owns integration, final Jira reconciliation and acceptance. Jira OAuth refresh is unavailable; no native transition or Done claim was made.
