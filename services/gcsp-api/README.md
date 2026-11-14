# GCSP API (Java 21 / Quarkus)

The separately built and deployed GCSP backend (FUCQ-454, contract in
[`docs/gcsp/migration-replacement-contracts-2026-11-13.md`](../../docs/gcsp/migration-replacement-contracts-2026-11-13.md)).
It runs no Node code. This first slice provides the JVM artifact, external configuration, readiness, graceful
shutdown and `GET /api/gcsp/v1/context`.

## Pinned versions

| Tool | Version | Why |
| --- | --- | --- |
| Java | 21 (release 21; enforcer requires `[21,22)`) | Agreed target (Q03). Built and run locally on Homebrew OpenJDK 21.0.13. |
| Quarkus platform | 3.40.1.2 | Latest patch of the current 3.40 LTS stream (3.33 is the previous LTS). Quarkus 4 is pre-release. |
| Maven | 3.9.16 via the committed wrapper (`mvnw`, wrapper 3.3.4, script-only) | Latest 3.9.x; SHA-256 of the distribution is pinned in `.mvn/wrapper/maven-wrapper.properties`. |
| Build plugins | compiler 3.15.0, surefire 3.5.6, enforcer 3.7.0 | Explicit, so a host's Maven defaults cannot change the build. |
| Container base | `eclipse-temurin:21.0.13_9-jdk-noble` / `-jre-noble`, pinned by digest | Render has no native Java runtime, so it builds `Dockerfile`. |

`project.build.outputTimestamp` is fixed, so two builds of one commit give byte-identical `target/quarkus-app/`.
No BMW build or container standards have been supplied yet (Q22); reconcile them here when Gary provides them.

## Build, test and run

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@21   # any JDK 21
./mvnw -B verify                                  # tests and the fast-jar in target/quarkus-app/
PORT=8080 java -jar target/quarkus-app/quarkus-run.jar
curl -s localhost:8080/q/health/ready
curl -s localhost:8080/api/gcsp/v1/context        # 401 JSON: no bearer token
```

Copy the whole `target/quarkus-app/` directory to deploy; `quarkus-run.jar` needs its `lib/` beside it. SIGTERM
drains in-flight requests for up to `GCSP_SHUTDOWN_TIMEOUT`, then exits. The container image is
`docker build -f services/gcsp-api/Dockerfile -t gcsp-api .` run from the repository root (the pom reads
retained policy data from `server/gcsp`, so the build context is the repository, not this module).

## Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port (Render injects it). Binds `0.0.0.0`. |
| `GCSP_IDENTITY_PROVIDER` | `none` | Identity port: `none` refuses every context call, `oidc` validates bearer JWTs. Unknown values stop startup. |
| `GCSP_ALLOWED_ORIGINS` | empty | Exact CORS origins, comma separated. Empty means same-origin only. FUCQ-435 sets the deployed value. |
| `GCSP_SHUTDOWN_TIMEOUT` | `10s` | Graceful shutdown drain limit. |
| `GCSP_OIDC_ISSUER` | none | oidc: required; exact `iss` match. |
| `GCSP_OIDC_JWKS_URI` | none | oidc: required; https only (loopback http is allowed only in automated tests). |
| `GCSP_OIDC_AUDIENCE` | none | oidc: required; `aud` must contain it. |
| `GCSP_OIDC_AUTHORIZED_PARTY` | none | oidc: optional; when set, `azp` must equal it. |
| `GCSP_OIDC_REQUIRED_SCOPES` | none | oidc: optional, space or comma separated; every scope must be in `scope`. |
| `GCSP_OIDC_ROLE_CLAIM` | `realm_access.roles` | oidc: exact top-level claim name (such as a namespaced URL), else a dot path, to the role list. Default is Keycloak realm roles. |
| `GCSP_OIDC_ACCOUNTS` | none | oidc: required JSON array `[{"subject","roles":["employee"|"greg"|"presenter"],"employeeId"?}]`. Not secret, never commit real subjects. |
| `GCSP_ENVIRONMENT_ID`, `GCSP_RUN_ID`, `GCSP_POLICY_VERSION` | none | oidc: required; interim environment context until later Stories persist run state. |
| `GCSP_ACCOUNT_PROVIDER` | `none` | Account records port: `none` refuses every account read (`account-provider-not-configured`), `hr-snapshot` reads a dated HR export, `repository` reads PostgreSQL (needs `GCSP_DATABASE_URL`; startup stops without it). Unknown values stop startup. The repository provider only reads: seeding `employees`, `entitlement_slots` and `employee_account_records` is scenario preparation (FUCQ-479). |
| `GCSP_ACCOUNT_HR_SNAPSHOT_PATH` | none | hr-snapshot: required path to a `gcsp-hr-export/1` JSON file; checked at startup and re-read on every request, so a file that goes missing or corrupt becomes a 503 source failure. |
| `JAVA_OPTS` | `-XX:MaxRAMPercentage=75` (image) | JVM options for the container start command. |
| `GCSP_DATABASE_URL` | unset | JDBC URL of this environment's own PostgreSQL. Unset leaves persistence off (readiness `not-configured`). |
| `GCSP_DATABASE_USER`, `GCSP_DATABASE_PASSWORD` | empty | Database credentials, from the host's secret store only. |
| `GCSP_EXPECTED_DATABASE` | empty | Must equal `current_database()`, or startup and reset refuse. |
| `GCSP_ENVIRONMENT_ID` | empty | Claimed into the database's immutable identity row on first start; a mismatch later stops startup. |
| `GCSP_RESET_ALLOWED` | `false` | Recorded at first claim. Only a database claimed with `true` (the dev database) can be reset. |
| `GCSP_DATABASE_POOL_SIZE` | `10` | Agroal maximum connections. |
| `GCSP_MAIL_TRANSPORT` | unset (captured) | Unset keeps mail captured in the outbox; `brevo` sends real email; any other value stops startup. |
| `GCSP_PUBLIC_BASE_URL` | unset | https base for absolute emailed offer links; unset keeps them relative. Required with `brevo`: the public https origin/path that serves `/gcsp/offers/:offerId` (the Angular static site). |
| `GCSP_BREVO_API_KEY` | empty | Brevo API key (secret, host secret store only). Required with `brevo`; startup fails without it. |
| `GCSP_MAIL_FROM` | empty | Sender address. Required with `brevo`. |
| `GCSP_MAIL_FROM_NAME` | empty | Sender display name. Required with `brevo`. |
| `GCSP_NOTIFY_DRAIN_INTERVAL` | `5s` | How often pending notifications are drained, from `1s` to `10m`. |
| `GCSP_CLAIMS_SWEEP_INTERVAL` | `5s` | How often due manual claims expire and open remote claim operations reconcile, from `1s` to `10m`. |
| `GCSP_DOCUMENTS_PROVIDER` | `none` | Document provider: `none` and `unsupported` refuse acknowledgement (422), `synthetic` gives fictional evidence. Unknown values stop startup. |
| `GCSP_SUPPLY_PROVIDER` | `none` | Stock source: `none` leaves every pull unavailable (ticks stay pending), `tranche-plan` reads a synthetic plan file. Unknown values stop startup. |
| `GCSP_SUPPLY_TRANCHE_PLAN_FILE` | empty | `tranche-plan` only: path to the labelled synthetic plan. Missing, unreadable or invalid stops startup. |
| `GCSP_APPROVALS_PROVIDER` | `none` | Order approval status provider: `none` leaves every decision unavailable (stages stay pending, never approved by elapsed time), `synthetic` is a labelled scenario input (projections report `provider.synthetic: true`), `live-stub` refuses honestly (no BMW approval system is connected). Unknown values stop startup. |
| `GCSP_APPROVALS_POLICY_FILE` | empty | Explicit override: a retained Node policy file for the lifecycle assumptions. Empty (the default) reads the canonical PolicyService at each order's pinned version. Set but unreadable stops startup. |
| `GCSP_ORDERING_PROVIDER` | `none` | Employee ordering handoff provider: `none` refuses every submit (503 `ordering-provider-not-configured`) while terms and reads still work, `synthetic` is a labelled fictional provider kept in the same database. Unknown values stop startup. |
| `GCSP_SUPPLY_POLICY_FILE` | empty | Retained Node policy file (`policyVersion`, `effectiveFrom`, `assumptions[]`). Empty means no policy, so every release stays pending as `policy-unavailable`. Set but unreadable stops startup. |
| `GCSP_APPOINTMENTS_PROVIDER` | `none` | Appointment provider: `none` answers 503 `appointments-provider-not-configured`, `synthetic` books fictional slots in the database, `live` is an explicit stub that answers 422 `live-appointments-unsupported`. Unknown values stop startup. |
| `GCSP_VEHICLE_EVIDENCE_PROVIDER` | `none` | Vehicle evidence provider: `none` answers every read source-unavailable, `lookup` (in-process) or `alternate-offline` (offline-cards/1). Unknown values stop startup. |
| `GCSP_VEHICLE_EVIDENCE_STORE` | empty | Absolute path of the retained corpus store (for example `<repo>/server/data/gcsp/vehicle-evidence/fleet-source.v1`). Required with either provider; relative, missing or not a directory stops startup. |
| `GCSP_VEHICLE_EVIDENCE_REFERENCE_DIR` | empty | Absolute directory holding `display-images.v1.json` and `configuration-definitions.v1.json` (`<repo>/server/data/gcsp/vehicle-evidence`). Required with either provider. |
| `GCSP_VEHICLE_ASSETS_ROOT` | empty | Absolute directory that contains `assets/gcsp-vehicle-evidence/` (the repository root). Required with either provider. |
| `GCSP_VEHICLE_EVIDENCE_ALTERNATE_FILE` | empty | `alternate-offline` only: absolute path of an offline-cards JSON file. Required for that provider. |
| `GCSP_VEHICLE_IMAGES_PUBLIC` | `false` | Explicit opt-in to serve retained images without a bearer token. Evidence reads always need one. |
| `GCSP_VEHICLE_EVIDENCE_TIMEOUT_MS`, `GCSP_VEHICLE_EVIDENCE_MAX_ATTEMPTS` | `1000`, `1` | Bounds of one provider read (1..5000 ms, 1..2 attempts); anything else stops startup. |
| `GCSP_RETURNS_PROVIDER` | `none` | Old-car return provider: `none` answers unavailable, `synthetic` is fictional and receipts in the database, `live-stub` refuses every call as unsupported. Unknown values stop startup. |
| `GCSP_RETURNS_POLICY_FILE` | empty | Retained Node policy file for the return rules. Empty means every read is unavailable (`return-policy-unavailable`). Set but unreadable stops startup. |

No identity secret is read: the JWKS and the accounts mapping are public data. Mail settings are in
[Notifications (FUCQ-469)](#notifications-fucq-469).
The test provider registration and claim mapping are in
[`docs/gcsp/oidc-test-provider-2026-11-13.md`](../../docs/gcsp/oidc-test-provider-2026-11-13.md).

## Persistence (FUCQ-456)

Design: [`docs/gcsp/java-persistence-design-2026-11-13.md`](../../docs/gcsp/java-persistence-design-2026-11-13.md).
Flyway applies `src/main/resources/db/migration/V<n>__*.sql` into schema `gcsp_app` at start; applied files never
change. `gcsp.api.persistence.TransactionRunner` runs one command per short transaction (receipt replay, explicit
SQL, version CAS, revision bump, receipt and outbox), `RunReset` retires and activates runs after the identity check,
and `PendingOperations` holds external-call intent for CAS finalization.

Native tests need a PostgreSQL 17 you own (never a Render database). Unset URLs skip them:

```sh
GCSP_TEST_DATABASE_URL='jdbc:postgresql://localhost:55456/gcsp_test_dev?user=gcsp' \
GCSP_TEST_RUNNING_DATABASE_URL='jdbc:postgresql://localhost:55456/gcsp_test_running?user=gcsp' \
./mvnw -B test -Dtest='gcsp.api.persistence.**'
```

## Notifications (FUCQ-469)

Each notification is an intent written in the same transaction as the business change it reports, so it exists only if
that state committed. The dispatcher drains pending rows every `GCSP_NOTIFY_DRAIN_INTERVAL`. Delivery moves through
`pending` (no delivery row yet), `sending`, `retrying`, `sent` or `failed`, each by a version-checked update.
Its rules come from `notify.delivery.v1` through `PolicyService` (`PolicyDeliveryRules`). Offer facts are not yet
bound, so each attempt retries as `transport-unavailable` until the Java offer Story binds `OfferFacts`. Unset `GCSP_MAIL_TRANSPORT` keeps mail captured.
With `brevo`, one `pending_operations` row per notification holds the recipient and idempotency key across attempts, so a
retry never changes either. Brevo's idempotency window is 30 minutes of wall time; later attempts fail `provider-window-expired`.
Retryable codes: `provider-rate-limited`, `provider-unavailable`, `provider-timeout`, `provider-unconfirmed`.
Endpoints: `GET /api/gcsp/v1/presenter/outbox` (presenter, read-only) and `GET`/`POST /api/gcsp/v1/manual/notification-email`
(employee, own address only).

## Manual claims (FUCQ-463)

`gcsp.api.claims.ManualClaims` takes the exact car for one employee (employee only; the principal needs an `employeeId`).
Routes under `/api/gcsp/v1`: `GET /manual/claim`, `POST /manual/claim`, `POST /manual/claim/review`, `POST /manual/claim/release`.
Any query is `400 unsupported-query`; a principal from an earlier run is `409 stale-run`. There is deliberately no public
allocate route: `convertSelection` is ordering's backend call (FUCQ-468), with `claimForOrdering` and `ownsActiveClaim`.

- Exclusivity is the `custody_holds` unique indexes; the slot and hold rows are read `FOR UPDATE`, and each command is one
  transaction. Idempotency is the command receipt (a changed body under the same `commandId` is `409
  idempotency-input-changed`) and, remotely, the operation id.
- Remote mode commits an intent, calls `ClaimStockPort` outside any transaction, then finalizes. Only `LocalClaimStock`
  ships; remote is proven with a test double, and no live remote stock authority exists.
- `ClaimSweep` expires due holds and reconciles open remote operations every `GCSP_CLAIMS_SWEEP_INTERVAL` (actor `system:manual-claims`).
- Still unbound: `ManualSelectionPort` (every claim is `503 manual-selection-not-configured` until Java manual
  browse and eligibility, FUCQ-461/442, land) and `SlotOccupancyPort` (to bind to FUCQ-464's `buddy_offers` by `hold_id`).

## Policy (FUCQ-457)

`gcsp.api.policy.PolicyService` (`@Inject`, or `new PolicyService(PolicySource)` in tests) is the one read path for
eligibility, allowance, points cost and assumptions, and returns the same outcome objects as the Node `PolicyService`
(`status`, `code`, `reasons`, `value`, `contractVersion` `1.0.0`, `policyVersion`). Reads take a `PolicyRead(runId,
asOf, policyVersion)`; a null `policyVersion` is unpinned (active at `asOf`), a value pins that version at its own
start. `getPolicySnapshot` is for trusted server code only and is never returned by a route.

Retained data is not copied into this module. The pom adds `server/gcsp/policy/seed-v1.json`, `reviewed/*.json` and
`server/gcsp/predict/records/policy-definitions.json` to the classpath under `gcsp/policy/`. `RetainedFilePolicySource`
reads the seed (validated once, kept for the process), so the default profile needs no database. Source choice is in
`PolicySourceSelection`. The Node fixtures are the behavioural baseline: `src/test/parity/policy-parity.mjs` regenerates
`src/test/resources/policy-parity/cases.json` (`node services/gcsp-api/src/test/parity/policy-parity.mjs` from the
repository root; needs `server/node_modules`) and `PolicyParityTest` replays every case without Node.

### Publication and activation (FUCQ-457 slice 2)

`PolicyService.publishPolicyVersion(Principal, JsonNode changeSet)` ports the Node publish rules (`PolicyPublication`) and
writes through `TransactionRunner` as command `policy.publish` (the change set's `commandId` is the idempotency key).
With persistence on, `PostgresPolicySource` replaces the file source:
tables `policy_documents` (content-addressed by SHA-256 of canonical JSON, immutable), `policy_versions` (per run,
immutable) and `policy_run_activation` (version CAS), added by `V457_1__policy_versions.sql`. A run's base version is
copied from the retained file on its first read, so edits to the file reach new runs only. `PolicyActivation.activate`
records the version in force at the clock's now and `activatedPolicyVersion(env, run)` reads it back.

- Role seam: `PolicyAuthority.mayPublish` requires the `greg` role (`forbidden`, code `role-required`); a principal whose
  environment differs from `gcsp.environment-id` is `forbidden` with code `environment-mismatch`. Integration may replace it.
- Clock: `PolicyClock.now(RunContext)` defaults to the wall clock (`WallPolicyClock`). The presenter demo clock arrives
  in a later story and replaces the bean.
- Conflict code: a reused `commandId` with different input is `conflict` / `command-input-changed` (the persistence
  runner's code), replacing Node's `idempotency-input-changed`.
- The file source stays read-only: publication is `invalid` / `unsupported-operation`, as in Node.
- `principal.policyVersion` is still the configured interim value; consumers wanting the run's activated version call
  `activatedPolicyVersion`.

### Consumers and Greg's policy controls (FUCQ-457 slice 3)

- `PolicyBriefAdapter` is the `BriefPolicyPort` bean (it replaces the brief's `@DefaultBean` refusal). The port has no run, so
  it reads the 7 brief keys pinned at `gcsp.environment.run-id`; any key missing or at another version is the brief's
  unavailable state.
- `PolicyAccountAdapter` implements `AccountPolicyPort` but is not a bean: `AccountSelection.policy()` still returns the
  refusal until integration returns `new PolicyAccountAdapter(policyService)` from it.
- `PolicyReleaseAdapter` is a `ReleasePolicy` over the service (one version for size, lead time and max age); supply still
  selects its file reader in `SupplySelection.select` until integration swaps it.
- `GET /api/gcsp/v1/greg/policy` and `POST .../greg/policy/publish` (greg role only, no query parameters). Preview is `422`
  `preview-unavailable` until Greg demand and fit exist in Java. `heldOffers.count` is `null` (no offers table yet) and
  there is no `clockVersion`. Failures are `{status, code, reason, retryable}` plus `reasons`, `accepted`,
  `expectedVersion`, `currentVersion`, `action` or `operationId`; `src/test/resources/policy-http/outcomes.json` records them.

## Endpoints

| Path | Result |
| --- | --- |
| `GET /q/health/ready` | Readiness, including the selected identity provider. Render's health check. |
| `GET /q/health/live` | Liveness. |
| `GET /api/gcsp/v1/greg/policy`, `POST /api/gcsp/v1/greg/policy/publish`, `POST .../preview` | Greg only. Active policy projection, publish a successor (`200`, `400` with reasons, `403`, `409`, `422` without persistence, `503`), preview is `422`. |
| `GET /api/gcsp/v1/context` | `{"status":"ok","value":{subject,roles,environmentId,runId,employeeId?,policyVersion,capabilities}}` |
| `GET /api/gcsp/v1/presenter/outbox` | Presenter only, read-only. Safe notification fields, never a payload or an address. |
| `GET`, `POST /api/gcsp/v1/manual/notification-email` | Employee only, own address only. POST sets it with `expectedVersion`. |
| `GET /api/gcsp/v1/documents` | Employee only: the caller's own document orders. Any query parameter is 400 `unsupported-query`. |
| `GET /api/gcsp/v1/documents/readiness?orderUuid=` | Employee (own order only), greg or presenter: readiness of one order, or `opened:false` with the reason. |
| `POST /api/gcsp/v1/documents/tasks/acknowledge` | Employee only. Body `{commandId, orderUuid, itemId, expectedDocumentsRevision}`. See below. |
| `GET /api/gcsp/v1/manual/account` | Employee role only, always the caller's own account: `{"status":"ok","value":<account projection>}`. 400 `unsupported-query` for any query parameter; 503 `account-provider-not-configured` or the `manual-source-unavailable` refusal body. Policy stays `policy-not-configured` (503 source `scheme-collection`) until the PolicyService adapter is wired. `gcsp.api.account.BriefAccountAdapter` serves the brief's `BriefAccountPort` (current contract and facts version) from this projection. |
| `POST /api/gcsp/v1/presenter/releases/ticks` | Deliver `{tickId, now, clockVersion}`; presenter only. |
| `POST /api/gcsp/v1/presenter/releases/reconcile` | Finish pending ticks, body `{}` or `{limit: 1..100}`. |
| `GET /api/gcsp/v1/presenter/releases/latest` | The run's latest tranche receipt (inspection only; the presenter screen's richer projection with images and charts belongs to its own Story). |
| `GET /api/gcsp/v1/presenter/releases/ticks/{tickId}` | Tick state, attempts, clock and last outcome. |
| `GET /api/gcsp/v1/presenter/releases/stock?after=&limit=` | Released cars (keyset page, limit 1..500) as the allocator reads them; no VIN, no employee. |
| `GET /api/gcsp/v1/help` | Employee only. What asking for help does; opens nothing. 400 `unsupported-query`; 403 `role-required`, `not-resource-owner`; 503 `case-unavailable`. |
| `GET /api/gcsp/v1/cases` | Employee only, own cases; `?caseId=` for one. 400 `unsupported-query`, `invalid-case-command`; 403 `role-required`, `not-resource-owner`; 404 `not-found`; 503 `case-unavailable`. |
| `POST /api/gcsp/v1/cases` | Employee only. Body `{commandId, reason}` opens the owned case or adds to the active one; a replay returns `replayed: true`. 400 `unsupported-query`, `invalid-case-command`, `renewal-context-required`; 403 `role-required`; 409 `command-input-changed`; 503 `case-unavailable`, `outcome-uncertain`. |
| `GET /api/gcsp/v1/scheme-team/cases` | Greg only; the presenter and employees are refused. Every case of the run with the employee's name. 400 `unsupported-query`; 403 `role-required`; 503 `case-unavailable`. |
| `GET /api/gcsp/v1/scheme-team/cases/options` | Greg only; needs `?caseId=`. The remedies offered for one case. 400 `unsupported-query`, `invalid-case-command`; 403 `role-required`; 404 `not-found`; 409 `renewal-changed`; 503 `case-unavailable`. |
| `POST /api/gcsp/v1/scheme-team/cases/update` | Greg only. Body with `commandId`, `caseId`, `expectedVersion`, `status`, `reason`, `nextAction`, `dueAt` and an optional `remedy`. 400 `unsupported-query`, `invalid-case-command`; 403 `role-required`, `forbidden` (a remedy the policy does not permit); 404 `not-found`; 409 `stale-version` (with `expectedVersion`, `currentVersion`), `renewal-changed`, `command-input-changed`; 503 `case-unavailable`, `outcome-uncertain`. |

Acknowledgement answers: 200 `ok` (provider evidence recorded, item complete); 202 `pending`
(`acknowledgement-pending`, with `operationId`; resend the same body to reconcile) or `uncertain`; 400 invalid body;
403 `not-resource-owner`, `not-your-task`, `role-required`; 404 `document-order-not-found`; 409 `stale-version`
(retryable, `current.documentsRevision`), `task-not-waiting`, `acknowledgement-refused`, `command-input-changed`,
`stale-run`; 422 `acknowledgement-unsupported` (no write); 503 `documents-unavailable`. An item completes only on a
provider answer with object evidence naming its own operation. Until the policy, stage and clock Stories supply real
ports, documents answer unavailable (`DocumentsWiring` default beans).

Every other path, and every refusal, is a JSON body `{status, code, reason, retryable}` (500s add a
`reference`), never HTML. Context refusals:

| Status | Codes |
| --- | --- |
| 401 | `bearer-missing`, `bearer-invalid`, `token-malformed`, `token-algorithm-unsupported`, `token-signature-invalid`, `token-issuer-invalid`, `token-audience-invalid`, `token-expired`, `token-not-yet-valid`, `token-lifetime-invalid`, `token-subject-missing`, `token-client-invalid`, `token-invalid` |
| 403 | `scope-missing`, `role-missing`, `subject-not-mapped`, `role-not-granted`, `role-conflict`; from `Access`: `role-required`, `not-resource-owner` |
| 503 | `identity-provider-not-configured` (mode `none`); `identity-keys-unavailable` (JWKS unreachable, retryable) |

## Supply release (FUCQ-462)

`gcsp.api.supply` ports the Node stock release. `StockRelease` records each presenter tick durably, pulls from the
selected `SupplyProvider` outside any transaction and releases the exact cars in one command; `ReleasedStock` holds
the bounded reads. `SupplySelection` picks the provider and policy once at startup, with no silent synthetic
fallback. `tranche-plan` is a synthetic scenario input, allowed in every launch mode, and every release it makes
carries `source.mode=synthetic`. The policy file reader is a narrow port until the canonical Java PolicyService
(FUCQ-457) replaces it. With persistence on and a provider other than `none`, startup finishes up to 100 delivered
but pending ticks once (it never pulls new releases) and logs a one-line count; a failure is logged, not fatal.
Readiness check `supply-release` is always UP and reports `provider`, `policy`, `pendingTicks` and
`latestTrancheId`; only a database error makes it DOWN. Confirmed-supply queueing has no endpoint here (FUCQ-478).

Trigger reads follow FUCQ-419/420 by design (Java equivalents, not delivery of the Node Stories): pending ticks are
consumed by a keyset cursor over the `supply_release_ticks_pending` partial index, the clock check uses
`supply_release_ticks_clock`, and tranche and tick receipts are read by primary key; no full history is replayed.
The allocator (FUCQ-461/464) consumes `ReleasedStock.page` over `stock_cars_released` plus the `stock-released` outbox event.

All endpoints are presenter-only, scoped to the server's active run (never to the request), and accept no query
parameters except `after` and `limit` on `/stock`; anything else is 400 `unsupported-query`.

| Result | Meaning |
| --- | --- |
| 200 | Delivered or read. A replayed tick returns `replayed: true`. |
| 202 | `outcome-uncertain` with `operationId` (the tick id): inspect the tick before any resubmit. |
| 400 | `invalid-tick`, `invalid-reconcile`, `invalid-query` (with `reasons`), `unsupported-query`. |
| 404 | `tick-not-found`. |
| 409 | `tick-input-changed`, `release-clock-changed`, `stock-identity-changed`, `tranche-input-changed`, `unreleased-stock-occupied`, `stale-run`. |
| 503 | Pending and retryable (`supply-provider-not-configured`, `policy-unavailable`, `stock-source-unavailable`, `stock-source-stale`, `database-unavailable`), with `state: pending`; or refused evidence (`invalid-stock-pull`, `supply-not-queued`, `supply-before-lead-time`) with `retryable: false`, `state: refused`; or `persistence-not-configured`. |

## Appointments (FUCQ-472)

`gcsp.api.appointments` ports the Node handover appointments. Routes, all under `/api/gcsp/v1` and scoped to the
server's active run (never to the request); any unknown or repeated query parameter is 400 `unsupported-query`:

| Route | Who | Meaning |
| --- | --- | --- |
| `GET /appointments?orderUuid=` | owning employee, greg, presenter | Read model `lifecycle.appointments.v1`, with offered slots while nothing is requested. |
| `POST /appointments/request` | employee (own order) | `{commandId, orderUuid, slotId, expectedVersion}`; `expectedVersion` is 0 before the first request. |
| `POST /appointments/accept` | employee (own order) | `{commandId, orderUuid, proposalId, expectedVersion}`: accepts the provider's proposed change. |
| `POST /appointments/complete` | greg | `{commandId, orderUuid, expectedVersion}`: records the handover outcome. |
| `POST /presenter/appointments/ticks` | presenter | `{tickId, now}`: sets the appointment clock, then progresses every actionable appointment; answers `{tick, summary}`. |

Results: 200 `ok`; 202 `pending` (`provider-outcome-uncertain` with `operationId` and the read model, or an uncertain commit
with `outcome-uncertain`), never to be resent as a new command; 400 `invalid-appointment-command` (with `reasons`) or
`unsupported-query`; 403 (`role-required`, `not-resource-owner`); 404 (`order-not-found`, `appointment-not-found`); 409
(`stale-version` with `currentVersion`, `command-input-changed`, `appointment-already-requested`, `appointment-not-eligible`,
`no-change-proposed`, `handover-not-ready` with `readiness` and `appointment`, `appointment-outcome-too-early` with
`availableFrom`); 422 (the provider's own refusal, e.g. `live-appointments-unsupported`); 503 (`appointments-provider-not-configured`,
`appointments-clock-unavailable`, `appointment-policy-unavailable`, `handover-readiness-unavailable`, `persistence-not-configured`).
Every body carries `status`, `code` (when not ok), `reason` and `retryable`; tokens and upstream errors are never echoed.

Ports, each with an explicit unconfigured default that answers unavailable (no silent fallback): `AppointmentProvider`,
`OrderStagePort` (FUCQ-470 replaces it), `HandoverReadinessPort` (FUCQ-471 replaces it), `AppointmentPolicy` and
`AppointmentClock`. Rules come only from the six `lifecycle.appointments.*` assumptions through `PolicyService`
(`PolicyServiceAppointmentPolicy`); any gap or a wrong pin is 503 `appointment-policy-unavailable`, never a default.
Appointment time is the latest presenter tick, never the wall clock.

`AppointmentsWiring` picks the provider once at startup from `gcsp.appointments.provider` and builds the service when
persistence is on. `synthetic` is labelled fictional in every read. A provider answer is checked exactly; a throw or a
timeout (policy `providerTimeoutMs`) is an unknown outcome that stays open and is reconciled before any write is repeated.
Presenter ticks page the `appointments_actionable` partial index by a keyset cursor (100 a page). With persistence on and a
provider other than `none`, `AppointmentsStartup` reconciles open provider writes once (it never writes, confirms or
retries) and logs a one-line summary; a failure is logged, not fatal.

Completion is greg only. It needs the readiness port to say ready (else 409 `handover-not-ready`) and the booked slot to have
started (policy `completeAfterSlotStartSeconds`), then commits the outcome and the outbox event `appointment-completed`
(`orderUuid`, `employeeId`, `occurredAt`, `providerReference`, `slotId`) in one transaction; FUCQ-473 consumes the event.
Not ported: no-show and rebooking, and the return purpose and current-car change (FUCQ-473).

## Identity seam

`gcsp.api.identity.IdentityPort` resolves a bearer token to an `IdentityResult`: `Resolved(Principal)`,
`Rejected` (401), `Unmapped` (403) or `Unavailable` (503). `IdentitySelection` picks one implementation at startup
from `gcsp.identity.provider`:

- `none` (default, every profile): `UnconfiguredIdentity`, refuses all tokens.
- `fixed-test`: `FixedTestIdentity`, one configured token and principal. Startup fails unless Quarkus is in
  test launch mode, so no deployed profile can serve a synthetic employee.
- `oidc` (every launch mode): `OidcIdentity` validates a signed JWT (RS/PS/ES algorithms only, never `none` or
  HS*) against the issuer's JWKS (jose4j; only the key set is cached), then checks issuer, audience, lifetime,
  optional `azp` and scopes, and maps issuer `sub` through `GCSP_OIDC_ACCOUNTS`. Effective roles are the token's
  roles intersected with the mapping; `employeeId` comes only from the mapping and only with the employee role;
  `presenter` never combines with another role. Missing or invalid settings stop startup.

`gcsp.api.auth` holds what later endpoints reuse: `BearerAuthentication.authenticate(header)` returns a `Principal`
or throws `IdentityRefusal` (rendered as the JSON error), `Role` lists roles and capabilities, and `Access`
provides `requireAnyRole`, `owns` and `requireOwner`.

## Brief (FUCQ-460)

Employee only (`employee` role plus an `employeeId`); scope (environment, run, employee, policy version) comes
from the bearer principal, never from the request. Any query parameter is refused. Success is
`{"status":"ok","value":...}` (plus `"replayed":true` when a stored receipt of the same command is returned).

| Path | Result |
| --- | --- |
| `GET /api/gcsp/v1/brief` | Current confirmed brief with activity and validation (404 `not-found` before the first confirmation). |
| `GET /api/gcsp/v1/brief/history` | Every confirmed version, oldest first. |
| `GET /api/gcsp/v1/brief/draft` | Latest saved draft (404 `not-found` before the first save). |
| `GET /api/gcsp/v1/brief/editor` | Account editor read: context, content to show, buddy view, versions, provenance. |
| `POST /api/gcsp/v1/brief/draft`, `/preferences`, `/confirm`, `/engage`, `/disengage`, `/pause-search`, `/resume-search` | JSON commands with `commandId`, `expectedBriefVersion`, `expectedDraftVersion`. |

The Node `/pause` and `/resume` aliases are dropped, and `change-after-decline` and `preview` are other Stories, so
they are the JSON 404. Refusals: 400 `unsupported-query`, `invalid-command`, `invalid-preferences`,
`engagement-minimum` (with `remaining`); 401/403 as above; 404 `not-found`; 409 `stale-version` (with
`expectedVersion`, `currentVersion`, `action: refresh`), `command-input-changed`, `already-engaged`,
`already-disengaged`, `already-paused`, `already-resumed`, `not-engaged`, `brief-read-only`; 503 `brief-unavailable` (no persistence, policy or account facts; retryable)
and `outcome-uncertain` (with `operationId`).

## Greg demand and presenter suitability (FUCQ-475)

| Path | Role | Result |
| --- | --- | --- |
| `GET /api/gcsp/v1/greg/demand` | Greg only | `{"status":"ok","value":<saved-demand projection>}` for the principal's run. |
| `GET /api/gcsp/v1/presenter/suitability?page=&buddyPage=&release=` | Presenter only | Recorded allocation decisions per engaged buddy and released car; cars 8 per page, buddies 4. |

Scope (environment, run, policy version) comes only from the bearer principal. Both responses send
`Cache-Control: no-store`. Demand takes no query parameter. Suitability takes `page` and `buddyPage` (`^[1-9]\d{0,6}$`,
default 1, clamped to the last page) and `release` (`all` or `latest`, default `all`), each at most once. Both read in one
read-only repeatable-read snapshot, and opening them never evaluates, claims or writes anything.

Refusals: 400 `unsupported-query`; 401/403 as above (`role-required` for the wrong role); 409 `stale-run`; 503
`persistence-not-configured`, `demand-unavailable` (incomplete principal context), `privacy-policy-unavailable`,
`evaluation-unavailable`, `brief-owner-unavailable`, `source-invalid`, and `suitability-unavailable` (retryable).

Privacy: a count below N is published as a band ("fewer than N"), and the complementary "N or more" count is withheld
wherever it would let a band be solved by subtraction. N is `greg.demand.smallCountThreshold`, read from the canonical
PolicyService (`PolicyDemandAdapter`, with `offer.declineReasons.v1`, `offer.declinedCar.exclusion`,
`employee.recommendation.v1` and `allocation.tieBreak.rule`). Missing or invalid policy is 503 `privacy-policy-unavailable`.

The default ports are truthful refusals or empty results: demand answers 503 `evaluation-unavailable` until the
FUCQ-461/466 adapters exist (and `privacy-policy-unavailable` while the active policy lacks the reviewed
`offer.declineReasons.v1`), and suitability shows every cell `not-evaluated`
until FUCQ-464 records allocations (`DemandDefaults.NoAllocationRecords`).

## Vehicle evidence (FUCQ-459)

`gcsp.api.evidence` ports the Node vehicle-evidence library: a validated corpus store, retained display imagery, the
configuration definitions, identity routing and the `VehicleDetailsConsumer` contract. `EvidenceSelection` picks the
provider once at startup and builds everything once; there is no silent synthetic fallback. Provider `none` (the
default) and a store whose content fails validation both answer `503 vehicle-source-unavailable`; a bad setting
(unknown provider, a required path unset, relative or missing, bounds out of range) stops startup. A `StockPort` bean
is injected when one exists (slice FUCQ-459 s6 supplies it); without one, `stock` reads are source-unavailable.

| Path | Result |
| --- | --- |
| `GET /api/gcsp/v1/vehicle-evidence/configurations/{id}`, `.../stock/{id}`, `.../vins/{id}` | Employee, greg or presenter. `200 {"status":"ok","value":{contractVersion,status:"complete"|"partial",vehicle}}`, always `Cache-Control: no-store`. |
| `GET /api/gcsp/v1/vehicle-images/{imageId}.webp` | Retained, byte-verified WebP (`Cache-Control: private, max-age=60`, `nosniff`). `imageId` must match `bmw-display-` plus 20 hex digits. Bearer required unless `GCSP_VEHICLE_IMAGES_PUBLIC=true`. |

Refusals are the JSON envelope `{status, code, reason, retryable, action}` (the requested id is never echoed):
`400 invalid` (`invalid-vehicle-identifier`; any query string; a path with more or fewer segments, an empty id or a bad
percent-escape), `404 not-found` (`vehicle-not-found`), `409 conflict` (`vehicle-identity-mismatch`), `422 unsupported`
(`vehicle-profile-unsupported`), `503 unavailable` (`vehicle-source-unavailable`, retryable). Authentication refusals
are the auth package's own (401, 403 `role-required`). Images: `404 image-not-found`, `400 unsupported-query`, `503
vehicle-images-unavailable` (retryable; catalogue unavailable or bytes fail verification). There is no live upstream
image fetch (a deliberate delta from Node).

Configuration ids are standard Base64 and can contain `/`, `+` and `=`. As in Node, the raw path is split first and the
single id segment is percent-decoded (strictly, with `decodeURIComponent` rules; a literal `+` stays `+`). Measured
behaviour: Quarkus/Vert.x leaves `%2F`, `%2B` and `%3D` untouched in the raw path (it neither rejects nor
normalises them), so `%2F` is decoded to `/` inside the id; a literal `/` makes two segments and is `400`. A malformed
escape such as `%zz` is refused by Vert.x itself with a bare `400` (empty body) before any resource runs, whereas a
well-formed escape of invalid UTF-8 (`%C3%28`) reaches the resource and gets the JSON `400`.

Readiness check `vehicle-evidence` (liveness is unaffected): provider `none` is UP with `provider: none`; a configured
provider with an active corpus is UP with `provider`, `datasetId`, `version`, `manifestDigest`, `recovered`,
`catalogue` and `definitions` (`available`/`unavailable`); a configured provider with no active corpus is DOWN with
`state: unavailable` and the failure `code`, so Render's health check gates the deploy as Node's does.

Provider shapes: `lookup` reads the corpus in process; `alternate-offline` reads an `offline-cards/1` file (fictional,
not a BMW schema) and returns the same application contract, with `images.state` `unknown`. Both route through the same
server-owned classification of the corpus identity inventory, so a store is required for both.

Deltas from Node. Runtime integrity: Java verifies publication identity, file checksums, shape, references and the
identity inventory when it loads a store; full row admission stays in the offline JavaScript publisher. Imagery:
only the retained catalogue and `assets/gcsp-vehicle-evidence/` are served, each image verified by size, sha256 and
WebP header on every read.

### Artifacts and hosting

Retained identities (all read in place from the repository, byte identity checked at startup):

| Artifact | Identity | Size |
| --- | --- | --- |
| `server/data/gcsp/vehicle-evidence/fleet-source.v1` selected | dataset `gcsp-source-fleet`, version `2026-11-07.9`, manifestDigest `28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884` (previous `9b514af9f883ce360fe7f42de16bd19d7a74f570e77cc9b6fb094f559aef9043`) | `configurations.jsonl` 45 MB (selected version 45.3 MB) |
| `display-images.v1.json` | sha256 `f12e588c78ca900dc98800697960f7d2857283d982fadd5cde292ba6be27b694` | 2.5 MB |
| `configuration-definitions.v1.json` | sha256 `7327f922585d0a5eabe5dca00363bc2f2e7ed29816c9c91bb17a304beddab939` | 0.3 MB |
| `assets/gcsp-vehicle-evidence/` | 921 files, each named by its sha256 and checked against the catalogue | 85 MB |

The total exceeds 50 MB, so the files are not copied into this module. The Render build already uses the repository
root as its docker context, but the Dockerfile and `Dockerfile.dockerignore` send and copy only policy data, so a
deployed service starts with provider `none` until GC, who owns the blueprint and hosting cost, chooses one of: (a) Dockerfile
and `.dockerignore` lines that copy, read-only and exactly, `server/data/gcsp/vehicle-evidence/fleet-source.v1/{active.json, last-good.json,
identity-inventory.json, versions/<selected>, versions/<previous>}`, `display-images.v1.json`,
`configuration-definitions.v1.json` and `assets/gcsp-vehicle-evidence/` into the image; or (b) a Render disk holding the
same tree. Either way set the `GCSP_VEHICLE_*` variables to the copied absolute paths. Verified minimal copy (exactly
those paths, with only the two versions): 164.4 MiB (172,369,439 bytes), 936 files, and it loads ready with 680
retained images served. Any copy must be byte-exact: a changed catalogue, definitions seed or manifest is refused.

Measured on `fleet-source.v1` (2,425 configurations): the store, catalogue and definitions load in about 0.7 to 0.9 s
at startup and add about 12 MB of heap after a full GC (the s1 measurement of the store alone was about 0.6 s and 3 MB).
Reads then use an index and do not rescan the 45 MB file.

## Order approvals (FUCQ-470)

`gcsp.api.approvals` ports the Node lifecycle approvals. `ApprovalService` records each presenter tick durably, asks the
selected `ApprovalStatusProvider` for a decision outside any transaction and settles it only on a matching confirmation;
elapsed ticks only make a decision due. `ApprovalSelection` picks the provider and policy once at startup with no silent
fallback. Policy comes from the canonical PolicyService (`PolicyApprovalAdapter`, reporting `canonical`) unless
`GCSP_APPROVALS_POLICY_FILE` names an explicit file (`file`). The order source is bound by [Ordering (FUCQ-468)](#ordering-fucq-468) and the handover (FUCQ-472) is a
`@DefaultBean` port (`ApprovalDefaults`): without persistence the order source is `order-source-not-configured`
(503) and until a real handover bean exists no order is ever handed over. Scope is the server's active run, never the request, and must equal the principal's environment and
run (else 409 `stale-run`). With persistence on and a provider other than `none`, startup finishes up to 100 open
decisions once (it never counts ticks or starts orders) and logs a one-line count; a failure is logged, not fatal.

| Path | Result |
| --- | --- |
| `GET /api/gcsp/v1/orders/progress?orderUuid=` | Employee (own orders only, else 403 `not-resource-owner`), Greg or presenter: `{status:"ok",value:<order progress>}` with owner, next step, stages and provider references. 400 `unsupported-query` for any other or repeated key. |
| `GET /api/gcsp/v1/orders/progress/all?after=&limit=` | Same roles; keyset page, limit 1..100 (default 50); an employee sees only their own orders. |
| `POST /api/gcsp/v1/presenter/approvals/ticks` | Presenter only: `{commandId, tickId, now, clockVersion}`. |
| `POST /api/gcsp/v1/presenter/approvals/reconcile` | Presenter only: `{commandId, limit?}` (1..100, default 100). |

`commandId` is required and nonempty but `tickId` is the idempotency identity: the same `tickId` with the same
input replays (200 with `replayed: true`), with changed input it is 409 `tick-input-changed`. No endpoint lets any
role approve or decline directly. Employee or Greg on a presenter endpoint is 403 `role-required`.

| Result | Meaning |
| --- | --- |
| 200 | Read or tick delivered. |
| 202 | `outcome-uncertain` with `operationId`: inspect before any resubmit. |
| 400 | `invalid-tick`, `invalid-reconcile`, `invalid-query`, `invalid-order` (with `reasons`), `unsupported-query`. |
| 403 | `role-required`, `not-resource-owner`. |
| 404 | `not-found` (no such order). |
| 409 | `tick-input-changed`, `approval-clock-changed`, `stale-run`. |
| 503 | `persistence-not-configured`, `database-unavailable`, `order-source-not-configured`, `selection-pending`/`selection-handoff-failed` with `state: not-ready`, `lifecycle-policy-unavailable`, `policy-source-unavailable`, `order-progress-unavailable`. |

## Renewal cases (FUCQ-474)

Package `gcsp.api.cases`: owned renewal cases in the V474_1 tables (`renewal_cases`, `renewal_case_history`).
`CaseService` runs each command as one transaction and `CaseResource` serves the six endpoints above; scope comes only
from the bearer principal. Ports and production defaults: `PolicyCaseAdapter` reads the nine `renewalCase.*` rows
of the pinned version from the canonical PolicyService (any missing or invalid row is 503 `case-unavailable`);
`CaseAccountPort` reads the account records port (`GCSP_ACCOUNT_PROVIDER`, else 503); each change queues outbox event `renewal-case-update` for `gcsp.api.notify` (FUCQ-469) to
deliver. Car suitability is not connected, so alternative-car proposals are 503, and preference relaxation needs a
recorded decline that Java does not hold yet. No automatic recovery priority, and the renewal-risk clock tick is not
ported yet. No new environment variables.

## Returns (FUCQ-473)

Package `gcsp.api.returns`: plan, request and reconcile the return of the employee's current car. `ReturnService` builds
one `ReturnPlans` lazily and `ReturnResource` serves it; scope is the server's active run, never the request. Without
persistence every operation is 503 `persistence-not-configured`.

| Endpoint | Roles and answers |
|---|---|
| `GET /api/gcsp/v1/return-plan?orderUuid=` | Employee (own order only), Greg, presenter. 200 `{status:"ok", value}`; 400 `unsupported-query`; 403 `not-resource-owner`; 404; 503. |
| `POST /api/gcsp/v1/return-plan/request` | Employee only. Body `{commandId, orderUuid, choice, slotId, expectedVersion}`. |
| `POST /api/gcsp/v1/return-plan/accept` | Employee only. Body `{commandId, orderUuid, proposalId, expectedVersion}`. |
| `POST /api/gcsp/v1/presenter/returns/progress` | Presenter only. Body `{commandId}`; reconciles and retries at the demo clock and returns the summary. 503 `clock-unavailable` until a presenter tick has set the clock. |

Results: 200 ok; 202 `pending` with `outcome-uncertain` and `operationId` (reconciled later); 400
`invalid-return-command` with field `reasons`; 403 `role-required` (the presenter and Greg never command employee
actions); 409 `stale-version` with `currentVersion` and the `plan`, or `command-input-changed`; 422 unsupported provider
with the `plan`; 503 unavailable. Startup runs a reconcile-only pass (never a new provider write) when the provider is
not `none`, and the `returns` readiness check reports the provider, policy, source and handover modes plus the open
operation count; it is DOWN only when the database errors.

Config: `GCSP_RETURNS_PROVIDER` and `GCSP_RETURNS_POLICY_FILE` (see the table above). The selection-source
(`ReturnSourcePort`, FUCQ-468) and handover (`HandoverPort`, FUCQ-472) adapters default to unavailable (`none`) until those
Stories supply beans that replace the defaults. The current-car relationship lives in `gcsp.api.returns`;
`gcsp.api.account.CurrentCarPort` (FUCQ-458) can list it later through an adapter.

## Ordering (FUCQ-468)

`gcsp.api.ordering` hands an employee's selection on to ordering exactly once. The operation id is deterministic per
run, employee and entitlement slot; `pending_operations` has a unique idempotency key and `selection_orders_one_per_slot`
makes a second selection impossible. A lease plus a version compare-and-set claim comes before any provider call, a
repeat or restart reconciles before it executes, and the outcome is finalized by compare-and-set. `pending` means the
handoff is not settled (resend the same body or GET to reconcile, never choose again; after an unreachable or unknown
provider a retry is held back for 5 seconds, and inside that window a GET only reads), `acknowledged` carries the provider
reference, `refused` means ordering rejected it. Source converters (`SelectionConversionPort`, one per source type) are
unavailable (`selection-source-unsupported`) until FUCQ-463 (cart) and FUCQ-464/466 (buddy-offer) provide their own bean;
no code here changes. Approvals' order source is now bound to the acknowledged selections (`ActiveOrderSource`, replacing
the `ApprovalDefaults` default). The employee's slot is never sent: it is the `ordering.enabled` slot of their own account
projection (503 `account-unavailable`, 409 `entitlement-unavailable`). Scope is the bearer principal and must equal the
active run (else 409 `stale-run`). No endpoint resumes a draft into an order: every submit is an explicit employee command.
With persistence on and a provider other than `none`, startup reconciles up to 100 open handoffs once (it completes an employee-confirmed
handoff and never creates a new order intent) and logs a one-line count; receipts record the actual driver (the employee,
`presenter:<subject>` or `ordering-startup`); a failure is logged, not fatal.

| Path | Result |
| --- | --- |
| `GET /api/gcsp/v1/manual/order/terms` | Employee only: `{status:"ok",value}` with `termsDigest`, `declarations`, `approvalStages`. |
| `POST /api/gcsp/v1/manual/order` | Employee only: `{commandId, source:{type:"cart",holdId,expectedHoldVersion,expectedDraftVersion}, expectedQuoteId, expectedStockVersion, termsDigest, declarations}`. 200 acknowledged (`replayed: true` on a repeat), 202 `handoff-pending` with `operationId`, 400 `invalid` with `reasons`, 403, 404, 409 (`active-selection-exists`, `terms-changed`, `claim-changed`, `quote-changed`, `stock-changed`, `entitlement-unavailable`, `stale-run`), 503 retryable. |
| `GET /api/gcsp/v1/manual/order` | Employee only: the caller's own selection, reconciling a pending handoff first; 200, 202, 404 `not-found`. Never creates a new selection. |
| `POST /api/gcsp/v1/presenter/ordering/reconcile` | Presenter only: `{}` or `{limit}` (1..100, default 100); `{status:"ok",value:{examined,settled,stillPending}}`. Others get 403 `role-required`. |

Any query parameter is 400 `unsupported-query`. 503 codes: `persistence-not-configured`, `ordering-provider-not-configured`,
`selection-source-unsupported`, `account-unavailable`, `database-unavailable`, `ordering-policy-unavailable`.

## Render

Gary's dev environment does not exist yet. The proposed service block for `render.gcsp.yaml` is in
[`render-service.proposed.yaml`](render-service.proposed.yaml); GC is the single writer for the blueprint.
