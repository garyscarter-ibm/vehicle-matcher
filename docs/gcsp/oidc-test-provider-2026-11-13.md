# GCSP test OIDC provider and claim mapping (FUCQ-455)

Record for the Java API's `oidc` identity provider (`services/gcsp-api`, `gcsp.api.identity.OidcIdentity`) and the
Angular shell's login (FUCQ-439). It states what the API validates, what the browser must send, and what still has
to be registered. Nothing here is a deployed registration, and nothing here proves BMW compatibility (Q08, Q33).

## Selected test provider

**Keycloak, self-hosted, one realm for the isolated dev environment.** Reasons:

- Free and open source, with no tenant limits or vendor account; it can live beside the other dev services.
- Standards-only: authorization code with PKCE for a public client, signed JWT access tokens, a published JWKS,
  RP-initiated logout (so sign-out can end the provider session, Q18) and refresh for renewal.
- Realm roles arrive in the access token as `realm_access.roles` without custom code, which is the API default.

Keycloak was not run for this Story: this Mac has no Docker daemon, and no hosted instance exists yet. The API was
proven against real RS256-signed JWTs and a JWKS served in-test (see "Evidence" below).

Hosting it needs Gary's choice. Keycloak wants roughly 512 MB to 1 GB of memory and a durable database, so a
free tier that sleeps or has no disk will lose the realm. If no suitable host is wanted, a free-tier hosted
provider works with the same API settings, because every claim name below is configuration:

| Option | Role claim setting | Notes |
| --- | --- | --- |
| Keycloak (recommended) | `realm_access.roles` (default) | Needs a host and its database; realm export can be kept out of git if it holds user data. |
| A free-tier hosted IdP (for example Auth0, Zitadel Cloud) | the provider's role claim, such as a namespaced URL claim; `GCSP_OIDC_ROLE_CLAIM` takes an exact top-level name or a dot path | Check the free tier allows custom role claims in access tokens and an API audience before choosing. |

## What the API validates

Per request, nothing cached but the JWKS key set:

1. Compact JWS only; algorithm must be RS256/384/512, PS256/384/512 or ES256/384/512. `none` and every HS* are
   refused before any key lookup.
2. Signature against the issuer's JWKS (`GCSP_OIDC_JWKS_URI`, https only; unknown `kid` triggers one refetch).
3. `iss` equals `GCSP_OIDC_ISSUER`; `aud` contains `GCSP_OIDC_AUDIENCE`; `exp` present, not past and at most 24 h
   ahead; `nbf` not in the future; 30 s clock skew; `sub` present.
4. `azp` equals `GCSP_OIDC_AUTHORIZED_PARTY` when set (the browser client id), so tokens minted for another client
   of the same realm are refused.
5. `scope` contains every `GCSP_OIDC_REQUIRED_SCOPES` entry when set.
6. Roles, then the trusted subject mapping (next section).

Refusals are typed JSON (`{status, code, reason, retryable}`); the full table is in `services/gcsp-api/README.md`.

| HTTP | Codes |
| --- | --- |
| 401 | `bearer-missing`, `bearer-invalid`, `token-malformed`, `token-algorithm-unsupported`, `token-signature-invalid`, `token-issuer-invalid`, `token-audience-invalid`, `token-expired`, `token-not-yet-valid`, `token-lifetime-invalid`, `token-subject-missing`, `token-client-invalid`, `token-invalid` |
| 403 | `scope-missing`, `role-missing`, `subject-not-mapped`, `role-not-granted`, `role-conflict`; later endpoints add `role-required` and `not-resource-owner` through `gcsp.api.auth.Access` |
| 503 | `identity-provider-not-configured` (provider `none`), `identity-keys-unavailable` (JWKS unreachable, retryable) |

## Roles and the employee mapping

- **Role claim:** `GCSP_OIDC_ROLE_CLAIM`, default `realm_access.roles`. Recognised values are exactly `employee`,
  `greg` and `presenter`; other values (Keycloak's `offline_access`, `default-roles-*`) are ignored. No recognised
  role gives 403 `role-missing`.
- **Trusted mapping:** `GCSP_OIDC_ACCOUNTS`, a JSON array supplied by the deployment, keyed by the issuer's `sub`
  under the single configured issuer:

  ```json
  [{"subject":"<keycloak user id>","roles":["employee"],"employeeId":"<server employee id>"},
   {"subject":"<keycloak user id>","roles":["greg"]},
   {"subject":"<keycloak user id>","roles":["presenter"]}]
  ```

  It holds no secret, but real subjects and employee ids are deployment data and are not committed. Startup stops
  on invalid JSON, duplicate or blank subjects, unknown roles, `presenter` combined with another role, `employee`
  without `employeeId`, or `employeeId` without `employee`.
- **Effective roles** are the token's roles intersected with the mapping's, so a token cannot grant itself a role.
  A subject not in the mapping gets 403 `subject-not-mapped`, never a synthetic employee.
- **employeeId** comes only from the mapping and only when the effective roles include `employee`. A Greg or
  presenter login never carries one. Presenter is a dedicated role with `presenter:control` and
  `presenter:inspect` capabilities only; there is no impersonation or principal switch.
- **Capabilities** (display hints only; the API re-checks roles): employee `account:read`; greg `greg:read`,
  `comparison:command`; presenter `presenter:control`, `presenter:inspect`.
- `environmentId`, `runId` and `policyVersion` come from `GCSP_ENVIRONMENT_ID`, `GCSP_RUN_ID` and
  `GCSP_POLICY_VERSION` until later Stories persist run state.

## What the Angular side (FUCQ-439) must send

- `runtime-config.json` `oidc.authority` = the realm issuer (`https://<keycloak host>/realms/<realm>`), the same
  string as `GCSP_OIDC_ISSUER`. `oidc.clientId` = the public client id, the same as `GCSP_OIDC_AUTHORIZED_PARTY`.
- `oidc.scope` = `openid profile gcsp-api` (it must include every `GCSP_OIDC_REQUIRED_SCOPES` entry).
- Call the API with `Authorization: Bearer <access_token>`. Never send the ID token: its `aud` is the client id,
  so it is refused 401 `token-audience-invalid`.
- On 401, renew or sign in again; never replay a command automatically. On sign-out use the provider's end-session
  endpoint so another account can sign in. The API holds no session, so a new token is a new context.

## Registration still needed (Gary)

1. A Keycloak host for the isolated dev environment, with a durable database (or a chosen free-tier IdP instead).
2. Realm `gcsp-dev` (name is a suggestion) with realm roles `employee`, `greg`, `presenter`.
3. Public OIDC client `gcsp-web`: standard flow only, PKCE S256 required, no client secret, redirect URI
   `https://<frontend host>/gcsp/auth/callback`, post-logout redirect `https://<frontend host>/gcsp/`, web origin
   the frontend origin.
4. Client scope `gcsp-api` assigned to `gcsp-web`, with an Audience mapper adding `gcsp-api` to access tokens.
5. Test users: at least two employees, one Greg and one presenter, each with exactly one role. Copy each user's id
   into `GCSP_OIDC_ACCOUNTS`, with employee ids that match the environment's employee records.
6. API environment: `GCSP_IDENTITY_PROVIDER=oidc`, `GCSP_OIDC_ISSUER`, `GCSP_OIDC_JWKS_URI`
   (`<issuer>/protocol/openid-connect/certs`), `GCSP_OIDC_AUDIENCE=gcsp-api`, `GCSP_OIDC_AUTHORIZED_PARTY=gcsp-web`,
   `GCSP_OIDC_REQUIRED_SCOPES=gcsp-api`, `GCSP_OIDC_ACCOUNTS`, `GCSP_ENVIRONMENT_ID`, `GCSP_RUN_ID`,
   `GCSP_POLICY_VERSION`. The proposed Render entries are in `services/gcsp-api/render-service.proposed.yaml`.

## Evidence and gaps

- Proven (FUCQ-455 branch, `./mvnw -B verify`): 24 HTTP cases in `OidcContextTest` sign real RS256 JWTs with a
  key generated at test time and served as a JWKS on loopback: employee, Greg and presenter contexts; every refusal
  in the table above except `role-conflict` (unreachable while startup forbids presenter combinations) and
  `identity-keys-unavailable` (proven in `OidcIdentityTest`); account switching A to B to A with no reuse; and an
  expired token for A after the switch.
- Not done: real browser login against a real test provider. It needs the registration above and FUCQ-439's login
  running against it. Fabricated-token tests do not prove login.
- BMW activation gaps (Q08): BMW issuer, client, audience, scopes, role or group claims, subject format,
  logout/renewal and JWKS rotation are all unknown. The settings above are configuration so they can change
  without code, but nothing here claims BMW compatibility.
