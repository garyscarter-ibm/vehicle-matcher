# FUCQ-393: reduce PostgreSQL evidence materialization

Gary authorised this implementation on 11 November 2026. Branch `fix/fucq-393-evidence-memory` starts at `6f496149`. His hold on merging to `gcsp-poc` remains binding. The managed PostgreSQL OOM is confirmed; its exact killed query remains unknown. This patch addresses the demonstrated large-payload and broad-read patterns, without claiming verified Render recovery.

## Implementation

- Migration `0009` adds immutable `vehicle_evidence_snapshots` plus owner references with a deletion-restricting foreign key. Neither table participates in whole-run foundation snapshots.
- The PostgreSQL persistence codec shares exact configuration evidence and its selected facts by canonical SHA-256 digest, across stock, quote/decision snapshots and replay receipts. Vehicle identity, mutable operational state, terms and domain versions remain unchanged. Hydration verifies the digest and returns the original public/domain shape. New source/definition content creates a new immutable snapshot; issued quotes retain their original version.
- Validated repository reads/query filters select runs plus the requested table/records. They preserve environment/run checks, typed refusals and the existing opt-in read window. Empty selection caches invalidate on own writes; strict reads and writes still check cross-process fingerprints.
- PostgreSQL JSON arrays are written sequentially under a default 512 KiB serialized-byte target with a secondary 500-row limit, inside the original transaction. A single larger value travels alone; it is never truncated. Evidence and owner references commit or roll back with their row. Existing client disconnect containment remains.
- Transactions retain their existing run-scoped logical snapshot and concurrency rules. This is not a rewrite of all transaction access into direct SQL, nor a bound on total application/DB memory. Cold transaction hydration loads each distinct referenced evidence value once, in an individual query; many unique configurations can add round trips.

## Existing data and rollout

Existing inline rows remain readable and compact on their next ordinary write. An explicit bounded maintenance command handles untouched rows without changing their domain version, timestamps, quote facts or terms:

```sh
# Run from server with the intended GCSP_DATABASE_URL already configured.
node scripts/compact-vehicle-evidence.mjs --state /absolute/persistent/checkpoint.json --schema public --rows 32
```

Rerun with the same state until `done:true`; each invocation processes at most the configured row count. The checkpoint is tied to the configured database URL hash and schema; store it outside a public/static directory. Interrupted work can replay safely. Each row takes the same per-run advisory lock as the repository and commits its representation/reference changes atomically. No maintenance command was run against Render.

Migration `0009` is applied by existing startup migration handling. Before writing the new representation, drain older application processes: old binaries cannot hydrate the private references. A rollback must retain a compatible reader, or restore/expand data using a separately verified procedure; simply reverting to the previous binary after new writes is unsafe. No production rollout, database setting/compute change, data reset or merge was performed here.

## Validation

Node **20.20.2**, local PostgreSQL **16.15**, one test worker, disposable databases only. Targeted tests ran through `_tools/test_stamp.py` with an explicit selection and reason.

- Original adapter fails the new 24-car large-write regression, before the patch's shared storage is exercised: a single JSON operation exceeds the configured 64 KiB test target. Baseline log: `20261111-170018-1si_nbwq`.
- Final evidence/disconnect/read-window selection: **20 pass, zero fail/skip**, 3.1 s (`20261111-170658-a1620rqj`). Includes actual SQL, immutable/delete retention, independent process reopen, catalogue successor versus old quote, failed-flush rollback/replay, legacy rows, bounded compaction/resumption/rollback and CLI checkpoint smoke.
- Real generated-stock → release → recommendation → quote → offer access/projection → successor-definition check passes with the PostgreSQL repository. The 502-car run retains **98** shared evidence snapshots. Logical stock JSON is **24,224,947 bytes**; persisted stock JSON text is **4,031,439 bytes**, plus **4,172,689 bytes** of shared evidence JSON text. The latter combined is about **66% less** than logical stock JSON. These figures exclude reference/replay rows, indexes, TOAST/WAL and physical storage effects; they are not measured RAM savings.
- Combined native producer/repository selection (`20261111-170550-tantncw_`): **122 reported outcomes, 116 pass, 3 fail, 3 skip**, 22.7 s. The three reported failures are the already tracked **FUCQ-395** F71 process-helper/fixture mismatch and its two parent outcomes. Three existing unsupported process readback fixture checks skip. The actual new PostgreSQL producer and all new evidence checks pass. This is not a clean full-suite result.
- Affected Buddy hold, offer access/producer, decision and offer projection boundaries: **204 pass, zero fail/skip**, 18.3 s (`20261111-170725-g5gto_u1`). Production DTO/projection contracts are preserved; no UI source changes or new painted screen are introduced.
- In the combined native run, 100 ms sampling observed peak summed PostgreSQL RSS **100,240 KiB** with 16 MiB shared buffers, 1 MiB work memory and max 16 connections. This macOS sum can count shared pages repeatedly and misses shorter peaks. It is **not** a hard 256 MB limit, a Linux/Render measurement, or proof that Free will fit. No container runtime was available. Exact Render data, concurrent deployment overlap, full corpus restore and live recovery were not retested.

All owned PostgreSQL/test child processes were stopped and disposable scratch removed after each run. Active source worktree and the existing dependency installation remain. Main checkout stays at `6f496149`. Scoped logs/impact/cleanup receipts are retained in ignored shared `.claude/test-runs` and the chat work directory. FUCQ-392 and FUCQ-395 remain outstanding.
