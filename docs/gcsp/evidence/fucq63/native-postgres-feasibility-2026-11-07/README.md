# F63 minimal native PostgreSQL feasibility — 7 November 2026

This is a read-only feasibility assessment, not an installation grant or native proof. A small isolated local PostgreSQL proof is feasible using the existing production repository and order-reference runner. No database, package installation, bootstrap, source request or proof was attempted. This does not establish deployed-database behavior or Story acceptance.

## Exact proof entry point

`docs/gcsp/evidence/fucq63/order-reference-2026-11-07/prove-orders.mjs` already accepts:

```sh
node <absolute-prove-orders.mjs> --plan <absolute-plan.json> --receipt <absolute-new-receipt.json>
```

The CLI requires an owned `TMPDIR` ending in `/test-stamp-shard-<hex>`. Its plan has `schemaVersion: "native-current-order-proof-plan.v1"`, `repositoryProvider: "postgresql"`, `sourceRequests: 0`, `maxOrderReferences: 32`, an absolute retained corpus `store`, valid ISO `asOf`, a simple lowercase SQL `schema`, a trusted `context` (`runId`, `environmentId`, `principalId`, `roles`) and 1–32 distinct canonical version-4 UUID `stockReferences`. Supply the database connection only through inherited `GCSP_DATABASE_URL`; never print, persist or pass it as a command argument.

The runner constructs the actual PostgreSQL repository with `migrate:false`, opens it, loads the retained corpus and confirms the current run and exact stock rows before installing its source-offline guard. It then compares direct lookup, the application consumer and loopback HTTP for each UUID, including exact order/configuration and synthetic identity associations. It confirms the current run again afterwards. Sequential reads should reuse the warmed connection; only loopback reconnects are allowed by the offline guard. Any blocked reconnect remains a failed proof; there is no memory fallback.

Only a wholly passing PostgreSQL invocation can emit `nativeProof:true`. The runner always emits `acceptance:false`. The existing `order-reference-2026-11-07/supervise.py` launches fixture tests only and cannot supervise this native CLI without a separately reviewed native execution packet.

## Minimum genuine data

Create an owned schema first: the migration runner creates its ledger and tables but does not create a schema. Run the three existing migrations (0001 transaction foundation, 0002 policy tables and 0003 renewal cases) and verify their checksum ledger is current. `public` exists in a fresh private cluster, but a named run-owned schema makes ownership clearer.

Use one current `runs` row plus 1–5 `stock` rows selected from configurations already proved against the exact retained `.9` store. No full demo reset, employee fixture, provider fetch, corpus republication or replacement fixture corpus is required. Seed the current run through `repository.transaction` / `tx.insert`, with matching environment and corpus, `status: "active"`, `current: true`; retain its returned optimistic version. `currentRun(environmentId)` must find exactly this one active current run.

Use the existing allocator rather than hand-written stock rows:

1. `emptyAllocationInventory()` and `allocateSyntheticIdentities(inventory, plan, { expectedRevision: inventory.revision })`. The allocation plan supplies `runId`, deterministic run-owned `seed`, actual `.9` `corpusVersion`, `datasetId`, and selected vehicles with `vehicleId`, exact `configurationId`, source `snapshotVersion`, retained `configuration` and `usage: "stock"`.
2. `publishStockOrders({ repository, context, inventory: allocated.inventory, expectedRunVersion, commandId })`. This exported helper performs a repository transaction, validates corpus/inventory consistency, inserts the stock associations and updates the run's inventory version. It preserves the generated UUID, seven-digit order number, wholesaler order ID, configuration ID and `facts.syntheticIdentity` (`vehicleId`, synthetic kind, generator, dataset, configuration hash and snapshot version).
3. Read back the exact native rows, current run and migration status, then freeze the native runner plan with those UUIDs and the actual retained store/manifest pins. Seed operations and proof operations must have separate receipts; the proof itself is read-only.

`server/test/helpers/offline-vehicle-fixture.js` builds its own fictional corpus and memory repository. Its passing tests are useful scoped fixture evidence, but cannot supply this native claim or replace the retained `.9` input. The runner permits up to 32 UUIDs; starting with 1–5 keeps this a bounded integration sample.

## Smallest proposed installation and runtime

The parent already established that PostgreSQL binaries/Postgres.app are absent and the Docker daemon is unavailable; this lane did not repeat those probes. The proposed route is the Homebrew `postgresql@16` binary formula, using absolute keg binaries. PostgreSQL's macOS download page lists Homebrew, and the official formula documents binary bottles, its keg-only installation and direct server startup. Exact available bottle, operating-system compatibility, dependencies and sizes remain unmeasured and must be pinned before installation. Do not compile from source as an automatic fallback.

Use `initdb` for one private run-owned cluster, then start it directly with `pg_ctl`/`postgres`, loopback binding and a private socket directory. Do not use `brew services`, edit shell profiles or modify a shared database. Account for Homebrew's documented default-cluster postinstall: suppress that step if supported by the inspected installation command, otherwise explicitly inventory any newly created default directory and preserve all pre-existing files. The reviewed install plan must name every side effect and cleanup boundary.

Proposed budgets are admission targets, not measured results:

| Chunk | Proposed limit and checkpoint |
| --- | --- |
| Binary installation | One worker, at most ten minutes; inspect actual bottle/dependencies first, budget up to 2 GiB total installed/download allocation, and stop/replan if actual metadata exceeds it. No compile fallback. Preserve installed package/dependencies. |
| Native bootstrap and proof | One proof worker and one owned PostgreSQL server tree; 120 seconds per independent chunk; 768 MiB aggregate RSS ceiling with orderly termination at 672 MiB. Start with PostgreSQL `shared_buffers=16MB`, `max_connections=8`, `work_mem=1MB`; the repository pool itself permits four connections. Adjust only through an explicit revised resource plan if measurements require it. |
| Working data | At most 256 MiB active local cluster/socket/scratch as a declared bounded live-database working-set exception; monitor WAL and logs. Place all download archives and any expected large retained outputs directly under the project's OneDrive agent-output path, with `HOMEBREW_CACHE` there. |
| Retained output | Compact plan, binary/version identity, migration checksums, selected UUIDs, proof receipt and cleanup receipt; no copied corpus or successful verbose database tree. |

Parent-observed free space during assessment was 44,566,428 KiB (about 42.5 GiB) on the shared APFS volume; this is a point-in-time observation, not a reservation. Check host-wide concurrent reservations, free space and the 5 GiB emergency reserve immediately before each chunk.

Before allocating, create an absolute owned run root and external ownership manifest, register a supervisor finalizer, propagate owned temporary directories, and reserve the host budget. The supervisor must cover installation children and the complete PostgreSQL process tree, enforce bounded output/time/RSS/disk, checkpoint before each phase and stop/join owned processes on success or handled failure. Verify process/open-file absence before deleting only owned cluster/socket/cache scratch, then verify filesystem absence and report measured peak and removed bytes. Preserve installed environments and existing directories. No scratch was allocated for this assessment, so its cleanup receipt is: zero test/database processes, no disposable roots, no leftovers.

## Outstanding release work

A native supervisor, bootstrap/seed script, exact binary/bottle identity, immutable `.9` store/configuration selection, owned paths, phase grants and full finalizer review are still required before execution. This assessment deliberately changes no production or proof script and grants no HTTP, package, source or database activity. A passing local native sample will close only the explicitly sampled current-run/order-UUID integration gap; full F63 acceptance and deployed persistence remain separate evidence obligations.

## Sources and identity

- PostgreSQL macOS packages: https://www.postgresql.org/download/macosx/
- Official Homebrew major-16 formula: https://formulae.brew.sh/formula/postgresql@16
- Public research request: `search_0a4b8ef95332e064d8cad3fd9e84771f` (Parallel fallback after native hosted search returned blank).
- `evidence.json` pins the exact reviewed repository runner, repository, allocator, migration, fixture and guard files. Search metadata was not used to claim a current patch release or installed version.
