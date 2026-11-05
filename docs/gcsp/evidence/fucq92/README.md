# FUCQ-92 isolated release checkpoint

Prepared on 5 November 2026 in `dev/DEV-2026-11-04-058`, starting from claim/base `7f0131abff9c94485c2718c9f60f8ae65ccd01bd`. This is backend implementation work; the story is not built. The [contract](../../stock-release-contract.md) records the agreed FUCQ-96 receipt/availability seam and the remaining provider/composition gates.

## Selected validation

The explicit first command is `node --test server/test/gcsp-release.test.js`. The test module exercises real DemoClock, PolicyService, identity and TransactionRepository memory implementations, and both synthetic and target-shaped pull providers. The 16 named tests cover actual pull release, tick/tranche/car replay, policy size changes, exact seeded-row promotion, occupied-car preservation, immutable identity/unique-write rollback, source windows/startup separation, confirmed-supply lead time/appearance, run scope, provider parity/errors, missing policy, concurrency, restart and source expiry. Timestamp-offset scenarios compare actual instants.

Boundary checks selected next: `node --test --test-concurrency=1 server/test/gcsp-clock-reset.test.js server/test/gcsp-repository-contract.test.js`. Node's worker cap is one for every chunk. The repository's affected selector supports Python, not this Node project (`_tools/test_stamp.py`); explicit regression/boundary commands are selected instead of its legacy whole-suite fallback.

`npm test` remains an explicit final story requirement, excluded from the first checkpoint pending serial dispatcher admission. FUCQ-77/FUCQ-78 data/provider integration, FUCQ-104 actual acknowledgement hookup, startup/next-release composition and manual/buddy end-to-end consumption remain incomplete. No native PostgreSQL proof, new screen, browser review, live provider or canonical diagram-render proof is claimed.

## Retained proof and pending refinements

An initial 14-test version passed all 14 tests in 4.756 seconds, sampled peak RSS 218,955,776 bytes, no scratch allocation. Its exact retained execution identity is `73cde122f7638093e0d452212fe098c6eaafa2f0dc0bfa90d78d508494c8ea89`. The initial attempt before dependency reuse failed at import because `pg` was absent; it ran no business test. A subsequent registry-stage mismatch was corrected to canonical `release-pull` before the 14-test pass.

The prepared 16-test refinement changes production code: source-expiry preservation, immutable revision conflicts, explicit available status, metadata allowlists and timestamp-offset handling. **It has not yet run:** shared HostBudget refused admission while other projects' reservations used available RAM. The earlier 14-test proof is not reused for changed code. Current code/fixture/test hashes and selected IDs are retained under the shared `.claude/test-runs/impact/fucq92-20261105-release-core.json` and run directory.

The backend presentation contract is `server/gcsp/stock/fixtures/presentation.json`, asserted against the actual event/pool/error outcomes. `tranche-plan.json` and `real-shaped-pull.json` are labelled TEST FIXTURES. They contain five exact fictional orders, minimal configuration references and no VIN. They do not establish real BMW configuration facts, FUCQ-78 stock completion or FUCQ-29 decision-complete availability/facts.

## Resources and cleanup

Run identity: `fucq92-20261105-release-core`. The external plan, launch/finalizer, checkpoint, bounded logs, per-file hashes and ownership manifests are under `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/fucq92-20261105-release-core/`. Each launched process group is stopped/joined before its owned `/private/tmp/test-stamp-shard-<token>` is removed; completed receipts verify absence. No large output or local compatibility exception was required.

Initial chunks used one worker, 512 MiB RAM, 32 MiB scratch and 300 seconds. A 256 MiB refinement was refused before allocation. The dispatcher prepared a subsequent finite 128 MiB/120-second single-process variant (`node --max-old-space-size=48 --test --test-isolation=none --test-concurrency=1`); it has not run and requires actual admission. No further admission attempt is authorised while the external reservation state is unchanged. Large output, if ever needed, must go directly to `/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/_agent-output/fucq92-20261105-release-core/`.

Tests reused the existing 139-file dependency tree at `DEV-2026-11-04-069/server/node_modules` through the owned `DEV-2026-11-04-058/server/node_modules` symlink. The external dependency manifest records the exact overlay/target and dependency tree hash `10195441734c41efe671ffff4d2d3baa169809431fe6f49139c3da2c29f37dbf`. While waiting for admission, its finalizer removed only that exact symlink, verified its absence, and verified identical before/after hashes for the installed tree. The installed environment was never copied, modified or deleted. Pending tests must recreate/audit an owned overlay; there is currently no dependency overlay or scratch left behind.

Agents: story lead requested/selected `gpt-6.1-sol` / `high`, no fallback; runtime unverified. No descendants spawned; actual tool slots were occupied. The lead performed the permitted bounded slice directly.

## Restart validation — 5 November 2026, 23:10 UTC run

The retained sixteen-test implementation was validated afresh with `node --test --test-concurrency=1 server/test/gcsp-release.test.js`: 16 tests passed, 0 failed, 5.038 seconds. Tested identity: `f6466ce9c4dd07de96a344082fad2bb0534640114a0251816d2a7f8e80e7cf4d`; base `7f0131abff9c94485c2718c9f60f8ae65ccd01bd`. This supersedes the earlier pending-refinement/admission note; the fourteen-test result remains historical only.

The launcher selected the release regression before execution, with one worker, 384 MiB RAM, 128 MiB scratch, a 300-second timeout and a 2 MiB log cap. The shared HostBudget admitted it with 65,673,867,264 bytes free. Sampled peak RSS was 224,362,496 bytes; allocated scratch peak was zero. The external ownership manifest, exact per-file hashes, dependency identity, bounded log, checkpoint and supervisor/finalizer are retained under `/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-restart-20261105/lead92/`. The owned `/private/tmp/test-stamp-shard-1a44d701728c4f838b1da8b4b6a2e31b` was removed and absence verified; the reservation was released. The run-owned dependency symlink was removed and its target tree's before/after digest was identical (`10195441734c41efe671ffff4d2d3baa169809431fe6f49139c3da2c29f37dbf`). No large output, compatibility exception or leftovers.

The exact persisted consumer receipt is `event_receipts`, `consumerId: stock-release`, `eventType: stock-released`, `eventId: trancheId`, `state: completed`, with `outcome.value.orderUuids` containing only newly inserted/promoted cars. `visibleOrderUuids` identifies the full source tranche. Consumers use their own receipt for replay; manual and buddy routes read the same run-scoped `stock`. No expiry is inferred when `release.availability.availableUntil` is absent.

FUCQ-77/78 source-backed provider/corpus integration, actual confirmed-supply producer hookup, shared startup and consumer end-to-end integration, and serially admitted full `npm test` remain outstanding.
