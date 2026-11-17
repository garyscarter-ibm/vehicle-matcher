# FUCQ-481 HTTP consumer proof (2026-11-17)

This bounded FUCQ-481 increment connects the real HTTP adapters to existing durable consumers. The ten selected cases passed against disposable PostgreSQL16 and loopback HTTP; both original acceptance criteria remain open.

It connects the real HTTP adapters from the previous increment to the existing durable consumers over loopback HTTP and real PostgreSQL:
- `HttpClaimStock` and `HttpRemoteBuddy` are the adapters.
- `ManualClaims` and `OfferDecisions` are the consumers.

This is **component evidence**, not the connected journey. See "What this is not".

## Files
| File | What it is | Author |
|---|---|---|
| `remote/RemoteOperationServer.java` | A test-only loopback stand-in for the GCSP substitute wire | Claude coordinator |
| `claims/HttpClaimLifecyclePgTest.java` | Manual claims over real HTTP and PostgreSQL | Sally Carrera (implementer) |
| `offers/HttpRemoteOfferDecisionPgTest.java` | Remote offer decisions over real HTTP and PostgreSQL | Yosemite Sam (implementer) |

- **Paths:** under `services/gcsp-api/src/test/java/gcsp/api/`.
- **Fixture API:** frozen before the tests were written, in `.claude/results/fucq481-http-consumer-test-interface-15.json`.
- **Unchanged:** production code, the existing fixtures (`ClaimFixture`, `DecisionEnv`, `OffersPg`) and the existing scripted suites (`ClaimRemoteTest`, `RemoteOfferAcceptPgTest`, `RemoteOfferDeclinePgTest`). Those suites still own the broad pending, custody and once-only semantics. These tests repeat a few of their scenarios through the real wire.

## The substitute server
`RemoteOperationServer` implements only the wire agreed in `fucq481-remote-operation-providers-2026-11-17.md`. It is not a BMW service and adds no upstream behaviour.

**Endpoints:**
- **`POST /execute`** applies one effect per call, recorded by operation id. The HTTP `Idempotency-Key` header must name the body's `operationId`.
- **`GET /reconcile`** answers from that record and never applies anything. It reports:
  - `rejected` if the operation was rejected;
  - `confirmed` if any effect was applied;
  - otherwise `not-found`.

**Scripted execute steps** (default `APPLY`):
| Step | Effect | Answer |
|---|---|---|
| `APPLY` | one effect | confirmed |
| `REJECT` | none | rejected |
| `APPLY_THEN_DROP` | one effect | none: the connection closes, so the answer is lost |
| `DROP` | none | none: the request is lost |
| `MISMATCH` | none | confirmed, for another operation id |
| `FAIL_500` | none | HTTP 500 |

**Scripted reconcile steps** (default `LOOKUP`): `LOOKUP`, `MISMATCH` (another run id) or `FAIL_500`.

**Behaviour:**
- Every response sends `Connection: close`, so no pooled connection can replay a POST.
- No GET step drops its connection, because the JDK client may itself retry an idempotent GET.
- State belongs to the instance. `start()` binds `127.0.0.1:0` and `close()` stops the server and its executor. Tests start it in their own lifecycle.

## Cases
There are ten, five per consumer.
- **Claims:** `aConfirmedHttpClaimIsActiveWithOneEffectAndOnePost`, `aLostAnswerIsPendingHoldsTheCarAndReconcileFindsTheOneEffect`, `aLostRequestIsFoundAbsentByLookupAndExecutedOnceMore`, `aMismatchedAckAndFailedLookupsKeepThePendingClaimWithNoExecute` and `aRejectedHttpClaimFailsAndTheCarCanBeClaimedByAnotherEmployee`.
- **Offers:** `anAppliedSelectionOverHttpConvertsTheAcceptOnce`, `aLostAnswerIsConvertedAfterARestartByReconcileWithoutASecondEffect`, `aRejectedSelectionOverHttpRestoresTheActiveOffer`, `anUnconfirmedExecuteAndFailedLookupsLeaveItPendingWithoutAnotherPost` and `aLostRequestIsFoundAbsentByLookupThenExecutedOnceMore`.

In outline:
- **Claims:**
  - An HTTP-confirmed claim is an active durable hold with one remote effect.
  - When the answer is lost, the claim is pending and exclusive, and a same-id GET reconcile settles it with one effect and no second POST.
  - When the request is lost, a lookup finds it absent and the consumer's existing rule executes once.
  - A mismatched or unusable answer keeps the truthful pending, exclusive hold, and no failed lookup ever executes.
- **Offers:**
  - A confirmed employee accept converts to one selection order.
  - When the answer is lost, a restarted consumer's reconcile converts once without another POST.
  - A rejected or mismatched answer restores or keeps the right custody, with no fabricated order.

## Selected validation

- Source checkpoint `604689cfd894150bc9202223593d78f099ba3538`, tree `e6476e901bd2e6d9c12e7bbc4379356b4f830522`. The three Java test sources are unchanged by this documentation receipt.
- Ten exact methods across `HttpClaimLifecyclePgTest` and `HttpRemoteOfferDecisionPgTest`: native exit 0, ten passed, zero failures, errors or skips. Offline Maven, Java21, one capped test worker, isolated disposable PostgreSQL16 and loopback HTTP. Existing adapter/configuration evidence is reused for unchanged code.
- The finite run began 2026-11-17T06:04:42Z and took26.3seconds. Peak sampled RSS779681792bytes; scratch155689408bytes. Parent independently matched method names and source/tool pins, then verified all86recorded process identities, seven groups and owned scratch absent, with the host reservation released.
- Cogsworth3 independently reviewed the four-file source checkpoint and returned PASS with no blocking or major finding. Requested/selected model `gpt-6.1-sol`, effort `high`, no fallback; no reviewer runtime.
- These are component and recovery checks through the actual HTTP adapters, existing consumers and migrated database. They do not establish the connected journey below.

## What this is not
- **Sign-in and offers:** direct service calls with a fixture Principal, plus a seeded remote-offered offer. That is not browser sign-in, real OIDC or an offer produced by a real remote claim.
- **Notifications:** no email is sent.
- **Journey:** this is not the whole claim → signed-in decision → order and status journey. It does not run through a deployed substitute, and it does not use differently shaped employee and stock inputs.
- **Contract:** the wire is GCSP's own. A BMW stock or Buddy service still needs authorised access and real contract evidence.

## Remaining
- **Future runs need PostgreSQL.** Both classes skip when `GCSP_TEST_DATABASE_URL` is unset. The selected run above supplied an owned database and had zero skips.
- **AC1 is still open:**
  - the direct `employee_account_records` readers (`allocation/Prepare.java:100`, `allocation/BuddyRemoteLifecycle.java:315`, `account/ManualDrafts.java:113`);
  - the inventory gaps on other ports;
  - proof that demo preparation cannot bypass the composition.
- **AC2 is still open:** the connected journey above, the read-shape variation and the BMW gap.
