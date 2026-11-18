# FUCQ-481 remote operation providers (2026-11-17)

This is a bounded, component-validated increment of FUCQ-481. Its initial source checkpoint was uncompiled; the corrected product source at `55d161477` subsequently passed the 65 selected tests below. It adds HTTP adapters for the two existing remote-operation ports, `ClaimStockPort` (manual claim stock) and `RemoteBuddy` (Buddy claim and release). It also adds a startup selector that picks local or remote for each port.

This is a GCSP substitute transport, **not a BMW protocol**. It completes neither acceptance criterion: see "Remaining".

## Files
| File | What it is | Author |
|---|---|---|
| `remote/OperationHttpTransport.java` and its test | The shared transport: request shape, acknowledgement validation and error codes | Claude coordinator |
| `remote/RemoteOperationProviders.java` and its test | The startup selector and producers | Claude coordinator |
| `claims/HttpClaimStock.java` and `HttpClaimStockTest.java` | The `ClaimStockPort` adapter | Grub (implementer) |
| `allocation/HttpRemoteBuddy.java` and `HttpRemoteBuddyTest.java` | The `RemoteBuddy` adapter | Minnie Mouse (implementer) |
| `application.properties` | The ten `gcsp.claims.stock.*` and `gcsp.buddy.*` keys | Claude coordinator |

- The paths are under `services/gcsp-api/src/{main,test}/java/gcsp/api/`.
- The interface was frozen before the adapters were built, in `.claude/results/fucq481-remote-operation-interface-14.json`.
- Unchanged: the port interfaces, `ManualClaims`, `BuddyRemoteLifecycle`, `OfferDecisions`, `RemoteOfferDecisions`, Angular, and all business rules.

## Transport contract
- **Execute:**
  - One `POST` of the operation JSON to the execute URL, with `Content-Type` and `Accept` set to `application/json`.
  - `Idempotency-Key` carries the operationId, and `Authorization: Bearer` is sent only when a token is set.
  - It is never retried. The configured deadline covers response headers and body; timeout cancels the original exchange.
  - A bounded subscriber retains at most 64 KiB plus one sentinel byte and cancels oversized responses without draining them.
- **Reconcile:**
  - A `GET` to the reconcile URL with `?operationId=..&runId=..&orderUuid=..`: the same ids, in that order, UTF-8 percent-encoded.
  - It never sends the operation, so it can never execute it.
- **Acknowledgement:**
  - Only HTTP `200` with a JSON object of at most 64 KiB counts. Its fields are `status` (`confirmed`, `rejected` or `not-found`), `operationId`, `runId`, `orderUuid` and an optional `providerReference` of at most 256 characters.
  - The three ids must equal the ids sent.
  - Duplicate keys and trailing content are malformed.
- **Errors:** everything else throws `RemoteOperationException`. Its message is only the code, with no URL, token or upstream body. The codes are:
  - `remote-operation-invalid`: blank ids, a non-visible-ASCII operationId (the header value), or a non-object body, refused before any request.
  - `remote-timeout`
  - `remote-transport-failed`
  - `remote-http-status`: any non-200, including a 404 with a not-found body and an unfollowed redirect.
  - `remote-ack-malformed`
  - `remote-ack-status-unknown`
  - `remote-ack-mismatch`
  - `remote-interrupted`
- **How the consumers treat a throw:** the existing consumers already treat any thrown exception as an unknown answer. So an unknown answer keeps the operation open for a later reconcile, and nothing new decides retries.
- **Adapters:**
  - `HttpClaimStock` maps the three statuses to `Confirmed` (with the provider reference), `Rejected` and `NotFound`.
  - `HttpRemoteBuddy` returns `Ack(status, ids)` and drops the provider reference, which `RemoteBuddy.Ack` has no field for.

## Selection and config
`RemoteOperationProviders` is `@Startup`. It produces `ClaimStockPort` and `RemoteBuddy`, replacing the `@DefaultBean` `ClaimDefaults.claimStock()` and `LocalSyntheticBuddy`. There is one non-default bean per type, so there is no ambiguity. Its `@PostConstruct` builds both ports, so bad settings stop startup.

| Key (environment variable) | Default | Values |
|---|---|---|
| `gcsp.claims.stock.provider` (`GCSP_CLAIM_STOCK_PROVIDER`) | `local` | `local`, `remote` |
| `gcsp.buddy.provider` (`GCSP_BUDDY_PROVIDER`) | `local-synthetic` | `local-synthetic`, `remote` |
| `<prefix>.execute-url`, `<prefix>.reconcile-url` (`..._EXECUTE_URL`, `..._RECONCILE_URL`) | unset | https, with no user info, query or fragment |
| `<prefix>.token` (`..._TOKEN`) | unset | optional bearer, visible ASCII |
| `<prefix>.timeout` (`..._TIMEOUT`) | `10s` | more than 0 and at most 60s |

- An unknown provider name, or `remote` with a missing or invalid setting, throws `IllegalStateException`. The message names only the property keys, never a value.
- Remote never falls back to local.
- Selection makes no network call.
- Plain `http` is accepted only to loopback, and only in the Quarkus test launch mode.
- The settings' `toString` shows only whether a token is set.
- Neither `render.gcsp.yaml` nor `render.yaml` sets these keys, so deployed behaviour is unchanged until someone sets them.

## Remaining
- **Selected validation, 17 November 2026:** all 65 exact selected cases passed with zero failures, errors or skips: 54 new cases (13 transport, 7 selector, 15 claims adapter and 19 Buddy adapter), plus 11 existing default-profile regression cases. The remote selector profile boots Quarkus and checks both injected remote modes without a reachable provider. Two existing default-profile neighbours supply 11 regression cases. A direct configured-instance `@PostConstruct` check covers refusal of unknown/missing settings; a full invalid-configuration application launch has not been run. The transport tests include headers plus partial body followed by a stall. The other adapter tests use loopback `HttpServer` on port 0.
- **Independent review:** Mater 2 identified the streamed-body timeout defect and missing remote CDI coverage. Codex applied the bounded-subscriber/deadline and test-profile corrections inside this allocation; Mater 2 then found no blocking or major source issue. Codex ran the exact six selected classes through the existing Java 21/Maven wrapper in offline mode with capped JVMs, one fork and local isolated scratch. All 65 cases passed in a 28.4-second supervised run; process/scratch/reservation teardown and unchanged input pins were verified. This is component/configuration evidence, with no database or connected live integration.
- **AC1 is still open:**
  - The direct `employee_account_records` SQL readers bypass the account port: `allocation/Prepare.java:100`, `allocation/BuddyRemoteLifecycle.java:315` and `account/ManualDrafts.java:113`.
  - The other ports in `fucq481-provider-inventory-2026-11-17.json` keep their recorded gaps.
- **AC2 is still open.** Claim, then the signed-in decision, then order and status, through a running remote substitute: nothing has shown this yet. It needs:
  - a substitute server that implements this contract;
  - the selected tests passing;
  - a connected journey check with differently shaped employee and stock inputs.
- **BMW gap:** this contract is GCSP's own. A BMW stock or Buddy service still needs authorised access and its real contract evidence before a BMW adapter can replace it.
