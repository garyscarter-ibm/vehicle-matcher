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
| `GCSP_DOCUMENTS_PROVIDER` | `none` | Document provider: `none` and `unsupported` refuse acknowledgement (422), `synthetic` gives fictional evidence. Unknown values stop startup. |
| `GCSP_SUPPLY_PROVIDER` | `none` | Stock source: `none` leaves every pull unavailable (ticks stay pending), `tranche-plan` reads a synthetic plan file. Unknown values stop startup. |
| `GCSP_SUPPLY_TRANCHE_PLAN_FILE` | empty | `tranche-plan` only: path to the labelled synthetic plan. Missing, unreadable or invalid stops startup. |
| `GCSP_APPROVALS_PROVIDER` | `none` | Order approval status provider: `none` leaves every decision unavailable (stages stay pending, never approved by elapsed time), `synthetic` is a labelled scenario input (projections report `provider.synthetic: true`), `live-stub` refuses honestly (no BMW approval system is connected). Unknown values stop startup. |
| `GCSP_APPROVALS_POLICY_FILE` | empty | Explicit override: a retained Node policy file for the lifecycle assumptions. Empty (the default) reads the canonical PolicyService at each order's pinned version. Set but unreadable stops startup. |
| `GCSP_ORDERING_PROVIDER` | `none` | Employee ordering handoff provider: `none` refuses every submit (503 `ordering-provider-not-configured`) while terms and reads still work, `synthetic` is a labelled fictional provider kept in the same database. Unknown values stop startup. |
| `GCSP_SUPPLY_POLICY_FILE` | empty | Retained Node policy file (`policyVersion`, `effectiveFrom`, `assumptions[]`). Empty means no policy, so every release stays pending as `policy-unavailable`. Set but unreadable stops startup. |

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

## Ordering (FUCQ-468)

`gcsp.api.ordering` hands an employee's selection on to ordering exactly once. The operation id is deterministic per
run, employee and entitlement slot; `pending_operations` has a unique idempotency key and `selection_orders_one_per_slot`
makes a second selection impossible. A lease plus a version compare-and-set claim comes before any provider call, a
repeat or restart reconciles before it executes, and the outcome is finalized by compare-and-set. `pending` means the
handoff is not settled (resend the same body or GET to reconcile, never choose again), `acknowledged` carries the provider
reference, `refused` means ordering rejected it. Source converters (`SelectionConversionPort`, one per source type) are
unavailable (`selection-source-unsupported`) until FUCQ-463 (cart) and FUCQ-464/466 (buddy-offer) provide their own bean;
no code here changes. Approvals' order source is now bound to the acknowledged selections (`ActiveOrderSource`, replacing
the `ApprovalDefaults` default). The employee's slot is never sent: it is the `ordering.enabled` slot of their own account
projection (503 `account-unavailable`, 409 `entitlement-unavailable`). Scope is the bearer principal and must equal the
active run (else 409 `stale-run`). No endpoint resumes a draft into an order: every submit is an explicit employee command.
With persistence on and a provider other than `none`, startup reconciles up to 100 open handoffs once (it never creates an
order) and logs a one-line count; a failure is logged, not fatal.

| Path | Result |
| --- | --- |
| `GET /api/gcsp/v1/manual/order/terms` | Employee only: `{status:"ok",value}` with `termsDigest`, `declarations`, `approvalStages`. |
| `POST /api/gcsp/v1/manual/order` | Employee only: `{commandId, source:{type:"cart",holdId,expectedHoldVersion,expectedDraftVersion}, expectedQuoteId, expectedStockVersion, termsDigest, declarations}`. 200 acknowledged (`replayed: true` on a repeat), 202 `handoff-pending` with `operationId`, 400 `invalid` with `reasons`, 403, 404, 409 (`active-selection-exists`, `terms-changed`, `claim-changed`, `quote-changed`, `stock-changed`, `entitlement-unavailable`, `stale-run`), 503 retryable. |
| `GET /api/gcsp/v1/manual/order` | Employee only: the caller's own selection, reconciling a pending handoff first; 200, 202, 404 `not-found`. Never creates one. |
| `POST /api/gcsp/v1/presenter/ordering/reconcile` | Presenter only: `{}` or `{limit}` (1..100, default 100); `{status:"ok",value:{examined,settled,stillPending}}`. Others get 403 `role-required`. |

Any query parameter is 400 `unsupported-query`. 503 codes: `persistence-not-configured`, `ordering-provider-not-configured`,
`selection-source-unsupported`, `account-unavailable`, `database-unavailable`, `ordering-policy-unavailable`.

## Render

Gary's dev environment does not exist yet. The proposed service block for `render.gcsp.yaml` is in
[`render-service.proposed.yaml`](render-service.proposed.yaml); GC is the single writer for the blueprint.
