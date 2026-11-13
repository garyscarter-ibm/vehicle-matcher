# Java persistence design — FUCQ-456 (E3.S03)

Design for the Java API's PostgreSQL repository, settled before transactional consumers build on it. It applies the
[persistence contract](migration-replacement-contracts-2026-11-13.md#persistence-contract-for-fucq-456) and the
[database alignment](database-refactor-migration-alignment-2026-11-13.md). The Node repository
(`server/gcsp/repository/`, its FUCQ-422 mutation journal and `0001_transaction_foundation.sql`) is reference
semantics only. Its whole-run snapshot, fingerprint and diff mechanism is deliberately not ported.

**Data strategy: default.** Exact relational records, keys and transactional invariants: PostgreSQL tables.

## Choices

| Concern | Choice | Why |
| --- | --- | --- |
| Engine and driver | PostgreSQL (17 locally; Render dev version is Gary's), `quarkus-jdbc-postgresql`, Agroal pool | Authority store already agreed (Q12, Q27). Plain JDBC keeps every statement explicit and inspectable. |
| Migrations | Flyway via `quarkus-flyway` and `flyway-database-postgresql`, `db/migration/V<n>__*.sql`, schema `gcsp_app` | Versioned, checksummed, append-only. Migrate at start; a changed applied file stops startup. One migration writer (this package's Story, then each consumer adds its own `V<n>`). |
| Schema | Fresh. Typed columns for keys, state, versions and FKs; `attributes jsonb` only for additive display facts | No legacy operational rows are migrated (Q27, Q37). Constraints, not application scans, protect identity and custody. |
| Isolation level | READ COMMITTED with row locks, version predicates and unique indexes | Each invariant has a native guard; no whole-run serialization or SERIALIZABLE retry storm. |
| Freshness | Monotonic `runs.revision`, bumped in the same transaction as every real mutation | Authoritative reads query current rows directly. No projection cache exists yet; any later cache must check revision (FUCQ-421 outcome). |

## Tables (V1)

Every mutable row is keyed by `(environment_id, run_id, …)`; command, event and job identities are too.

| Table | Key and constraints | Purpose |
| --- | --- | --- |
| `environment_identity` | Single row; immutable; `environment_id`, generated `instance_id`, `reset_allowed` | The database's own identity, claimed by the first start. Startup and reset compare it with configuration. |
| `runs` | `(environment_id, run_id)`; partial unique: one `active` per environment; forward-only trigger; no delete | Run lifecycle and monotonic `revision`. |
| `run_resets` | `(environment_id, command_id)`; immutable | Reset receipts: retired and activated run. |
| `command_receipts` | `(environment_id, run_id, actor_id, command_id)`; immutable | Input digest, original result and committed revision. |
| `outbox_events` | `(environment_id, run_id, event_id)`; FK to its receipt; pending partial index | Event/notification intent, committed with the change. Delivery state changes by version CAS. |
| `pending_operations` | `(environment_id, run_id, operation_id)`; unique `(operation_type, idempotency_key)` | Durable intent for external I/O, finalized by version CAS. |
| `employees`, `entitlement_slots` | Run-scoped keys; slot `capacity` 1–20 | Occupancy owners. |
| `stock_cars` | `(environment_id, run_id, order_uuid)`; index on `configuration_id` | Exact car by `orderUuid`. Many cars share one `configurationId`; VIN is not a stock identity. |
| `custody_holds` | Partial unique per `order_uuid` and per `(slot_id, slot_unit)` over occupying states; terminal states and identity are fixed by trigger | Exclusive exact-car custody and employee/entitlement occupancy, enforced by the database. |

Consumers (FUCQ-457 onward) add their own aggregates in later `V<n>` files under the same keying rules.

## Command transaction

`TransactionRunner.execute(context, command, work)` runs one short transaction:

1. Read the receipt by its full key. Same digest: return the original result with `replayed: true`, no write.
   Different digest: `conflict/command-input-changed`.
2. Run the command's explicit SQL: selected reads, inserts and `UPDATE … WHERE key AND version = ?` checks.
   A CAS that matches no row is `conflict/stale-version` and rolls back everything.
3. If nothing changed, commit nothing: no receipt, no revision, no event. The result says `changed: false`.
4. Otherwise `UPDATE runs SET revision = revision + 1 WHERE … AND status = 'active' RETURNING revision`, insert the
   receipt and outbox rows at that revision, then commit. A retired run is `conflict/stale-run`.
5. Unique violations map to typed conflicts (exclusive custody, slot occupancy, concurrent same command id, which is
   then re-read as a replay or conflict). Any failure rolls back domain rows, receipt, events and revision together.
6. A failure during or after `COMMIT` is `uncertain` with the command id as `operationId`.
   `inspect(context, commandId)` reads the receipt: committed (with the original result) or absent (safe to resubmit).
   Callers never blindly resubmit.

Small commands read and write only the rows they name; statement counts are fixed per command type, not per run size.

## External I/O

Write `pending_operations` intent (and custody) in a command transaction, call the provider outside any transaction,
then finalize with a second command whose `UPDATE … WHERE version = ? AND state IN ('intent','pending')` is the CAS.
Timeouts or malformed acknowledgements leave it pending with custody retained. A retired run refuses a late
acknowledgement, so old-run work cannot gain new-run authority.

## Reset and isolation

`resetRun(environmentId, commandId, actor, expectedActiveRunId, newRunId)` first checks the database's own identity:
`environment_identity.environment_id` must equal the configured `GCSP_ENVIRONMENT_ID`, `reset_allowed` must be true,
and `current_database()` must equal `GCSP_EXPECTED_DATABASE`. Any mismatch refuses before writing. Then one
transaction locks the active run, retires it, inserts the new active run and the reset receipt. Nothing is deleted;
retired-run rows stay as history and immutable artifacts are untouched. Replaying the reset command returns its
original receipt. The running `gcsp-poc` database is never configured with `reset_allowed`, and a dev reset cannot
reach it because the connection, identity row and database name all have to match.

## Alignment with FUCQ-419–425

These are Java design equivalents. They do not deliver or close the Node Stories, whose acceptance stays on their
Node paths.

| Story | Java equivalent here | Remaining separate evidence |
| --- | --- | --- |
| FUCQ-419 indexed trigger/receipt reads | Receipt lookup by full primary key; pending outbox/operations by partial index | Trigger/consumer reads arrive with E3.S11/S26 consumers |
| FUCQ-420 new/changed/pending consumption | Pending-first partial indexes; digest replay/conflict on receipts | Consumption loop belongs to the first Java consumer |
| FUCQ-421 transactional run revision | `runs.revision` bumped in every mutating transaction | No Java cache yet; Node fingerprint cache stays FUCQ-421's |
| FUCQ-422 explicit mutation journal | Explicit per-command SQL; no-op writes nothing; rollback/replay semantics kept | Node journal (merged at `fb995c23`) is unchanged |
| FUCQ-423 flush from explicit sets | Direct SQL update sets; no whole-run comparison | Node flush (DEV-2026-11-13-GC-016) is separate |
| FUCQ-424 scoped hydration | Commands read only named rows; no hydration at all | Node scoped hydration is separate |
| FUCQ-425 batched evidence reads | Not implemented: no evidence reads in this Story | E3.S06/S27 with workload evidence |

FUCQ-409–418 (allocation and recommendation computation) are untouched here.

## Evidence

Native PostgreSQL 17.12, local throwaway cluster, code `0dd710eb`. Full record in the Story result
(`_dev/in-progress/DEV-2026-11-13-024.md`).

- `services/gcsp-api` tests, `gcsp.api.persistence.**`: commit, rollback, failed version, no-op, competing
  connections for one exact car and for one slot unit, capacity refusal, same and changed replay, concurrent duplicate
  command id, uncertain commit (committed and not committed), restart with a new pool, stale run, atomic reset,
  reset all-or-nothing, reset replay, reset refusals (database name, environment identity, `reset_allowed`),
  two-database isolation, intent with CAS finalize and late acknowledgement, app wiring and readiness.
- Running-app proof: two real API JVMs (dev database with reset allowed, stand-in running database without),
  one command in each, a dev reset while both ran. The running database's row digest was identical before and after,
  a dev-configured reset aimed at it and a reset on it were both refused, the restarted dev JVM kept run, receipts and
  holds, and a JVM pointed at the wrong database refused to start.
- SQL scope: a hold command issues eight statements (receipt read, active-run check, car version read, hold insert,
  car CAS, revision bump, receipt insert, commit), independent of run size. Exact-car read and CAS use `stock_cars_pkey` at 5,000 cars;
  receipt lookup uses its primary key; the revision bump uses `runs_one_active`; pending outbox uses its partial index.

The hosted Render dev database does not exist yet. Its connection and reset evidence awaits Gary's dev environment.
