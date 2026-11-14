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
`docker build -t gcsp-api services/gcsp-api`.

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
| `GCSP_ACCOUNT_PROVIDER` | `none` | Account records port: `none` refuses every account read (`account-provider-not-configured`), `hr-snapshot` reads a dated HR export. Unknown values stop startup. |
| `GCSP_ACCOUNT_HR_SNAPSHOT_PATH` | none | hr-snapshot: required path to a `gcsp-hr-export/1` JSON file; checked at startup and re-read on every request, so a file that goes missing or corrupt becomes a 503 source failure. |
| `JAVA_OPTS` | `-XX:MaxRAMPercentage=75` (image) | JVM options for the container start command. |
| `GCSP_DATABASE_URL` | unset | JDBC URL of this environment's own PostgreSQL. Unset leaves persistence off (readiness `not-configured`). |
| `GCSP_DATABASE_USER`, `GCSP_DATABASE_PASSWORD` | empty | Database credentials, from the host's secret store only. |
| `GCSP_EXPECTED_DATABASE` | empty | Must equal `current_database()`, or startup and reset refuse. |
| `GCSP_ENVIRONMENT_ID` | empty | Claimed into the database's immutable identity row on first start; a mismatch later stops startup. |
| `GCSP_RESET_ALLOWED` | `false` | Recorded at first claim. Only a database claimed with `true` (the dev database) can be reset. |
| `GCSP_DATABASE_POOL_SIZE` | `10` | Agroal maximum connections. |

No identity secret is read: the JWKS and the accounts mapping are public data. Mail settings arrive with FUCQ-469.
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

## Endpoints

| Path | Result |
| --- | --- |
| `GET /q/health/ready` | Readiness, including the selected identity provider. Render's health check. |
| `GET /q/health/live` | Liveness. |
| `GET /api/gcsp/v1/context` | `{"status":"ok","value":{subject,roles,environmentId,runId,employeeId?,policyVersion,capabilities}}` |
| `GET /api/gcsp/v1/manual/account` | Employee role only, always the caller's own account: `{"status":"ok","value":<account projection>}`. 400 `unsupported-query` for any query parameter; 503 `account-provider-not-configured` or the `manual-source-unavailable` refusal body. Policy stays `policy-not-configured` (503 source `scheme-collection`) until the PolicyService adapter is wired. |

Every other path, and every refusal, is a JSON body `{status, code, reason, retryable}` (500s add a
`reference`), never HTML. Context refusals:

| Status | Codes |
| --- | --- |
| 401 | `bearer-missing`, `bearer-invalid`, `token-malformed`, `token-algorithm-unsupported`, `token-signature-invalid`, `token-issuer-invalid`, `token-audience-invalid`, `token-expired`, `token-not-yet-valid`, `token-lifetime-invalid`, `token-subject-missing`, `token-client-invalid`, `token-invalid` |
| 403 | `scope-missing`, `role-missing`, `subject-not-mapped`, `role-not-granted`, `role-conflict`; from `Access`: `role-required`, `not-resource-owner` |
| 503 | `identity-provider-not-configured` (mode `none`); `identity-keys-unavailable` (JWKS unreachable, retryable) |

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

## Render

Gary's dev environment does not exist yet. The proposed service block for `render.gcsp.yaml` is in
[`render-service.proposed.yaml`](render-service.proposed.yaml); GC is the single writer for the blueprint.
