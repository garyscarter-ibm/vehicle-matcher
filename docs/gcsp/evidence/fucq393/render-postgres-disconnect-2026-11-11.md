# FUCQ-393 — Render startup PostgreSQL disconnect

Reported by Gary on 11 November 2026. Originating Story FUCQ-81; policy adapter FUCQ-83 shares the lifecycle. High severity: repeated hosted startup crashes prevent the demo opening its port. This failure is separate from FUCQ-392's artifact rejection diagnostic.

## Observed and diagnosed

Gary's Render log checks out d5f4002ea2ab089b9ea140ee2c3997bf6473136a, restores fleet release 2026-11-07.12 successfully, uploads a successful build, then crashes on Node 20.20.2 with an unhandled pg Client error, `Connection terminated unexpectedly`. On the same day Gary confirmed the database is Available and GCSP_DATABASE_URL uses its Internal Database URL. The actual secret was neither requested nor retained.

The installed pg client emits an error when an established connection closes, including when an active query has also been rejected. pg-pool removes its idle error listener when checking out a client. Application pools handled pool errors, but five checkout paths did not handle client errors: migration/status, repository read/write, policy transaction and policy cache header. Promise rejection handlers do not contain EventEmitter errors. A real pg transport regression reproduces this without a live database.

The remote cause of the connection closure remains unknown. Available status and an internal URL do not prove that the deployed process can establish and retain its connection. This repair does not claim to restore database connectivity or verify deployment recovery.

## Repair

A shared client lease attaches an error listener while checked out, checks for failure before/after each query and after awaited work, discards a broken connection, and removes only its own listener after release reinstalls the pool listener. All five checkout paths use it. Existing callers continue to return safe unavailable outcomes, roll back where possible, invalidate affected snapshots and refuse startup when storage is unavailable. A failed migration unlock cannot turn a disconnected session into successful startup. No reconnect/retry of uncertain writes, schema changes, database reset, artifact/cache purge, provider fallback or new dependency is introduced.

## Validation

All commands use the repository test supervisor with one test worker. Node v26.5.0 was available locally; Render's Node 20.20.2 was not used locally.

- Red proof: all seven new regressions fail against the unchanged production adapters at 770538da. Two use real pg and a loopback PostgreSQL protocol stub that authenticates then closes the socket on the first query. Other cases prove final-unlock failure, safe repository reads/fresh-client recovery, no commit after failure during awaited work, policy transaction recovery and cache-header reload.
- Scoped green: `node --test --test-concurrency=1 server/test/gcsp-postgres-disconnect.test.js server/test/gcsp-repository-contract.test.js server/test/gcsp-policy-versions.test.js server/test/gcsp-hosted-entry.test.js`: 110 tests, 102 passed, 0 failed, 8 skipped, about 21 seconds.
- Skips: five native PostgreSQL checks because GCSP_DATABASE_URL is unset in this test environment, plus three existing ordering new-process readback checks unsupported by their fixtures.
- Existing repository contracts exercise rollback, uncertain commit/idempotent reconciliation, migration history, snapshot cache and query count. Policy tests exercise rollback and typed rows. Hosted entry tests exercise startup callers with the explicit memory test provider.
- `git diff --check` passes. Full UI/app suite, managed PostgreSQL SQL behavior, Render deployment recovery and Node 20 parity are unrun; a transport stub and driver doubles do not establish those integrations.

Supervisor receipts and bounded logs are under the shared checkout's ignored `.claude/test-runs/`; the impact map is `impact/fucq393-postgres-disconnect.md`. Red run: `20261111-154102-jp53e3t3`. Green run: `20261111-154123-jf6i59nx`. Both report owned scratch removed. The isolated task worktree is removed after the validated commit is pushed; existing installed dependencies were reused rather than reinstalled.

## Deployment follow-up

Redeploy the latest gcsp-poc commit and check startup/health. With an unavailable database startup must fail safely; this change does not declare the app healthy. If the database keeps disconnecting, inspect the PostgreSQL service logs at the same time as the new startup attempt and verify the service's configured internal URL, region/network reachability and connection settings without sharing credentials. Keep FUCQ-393 open until live recovery is observed.
