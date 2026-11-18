# FUCQ-481 standalone remote ordering adapter — 17 November 2026

`HttpOrderingProvider` implements the existing `OrderingProviderPort` against a GCSP HTTP substitute. This is an **unbound source increment**, authored from `fc905752eaf2079ae6136902e68e371583672209`. The adapter and focused tests were compiled and all 13 selected loopback methods passed at frozen source `45d1c1afc05858c6f2d123d1958dd86ed625214a`; actual validation is recorded below. Startup provider selection, connected order/status proof and both original FUCQ-481 acceptance criteria remain open.

The semantic authority is [the ordering contract](manual-order-contract.md#durable-state-and-external-shaped-protocol), [the replacement provider boundaries](migration-replacement-contracts-2026-11-13.md#providers-and-application-authority), `OrderingProviderPort` and `OrderingScope`. The JSON below proposes a mapping of those existing typed facts for this substitute. It is not a verified BMW ordering protocol or a claim of BMW access, approval or execution.

## Request mapping

Construct the adapter with validated `OperationHttpTransport.Settings.parse(...)` settings and a client from `OperationHttpTransport.newClient(...)`. Production settings permit HTTPS; plain HTTP is restricted to explicitly allowed loopback tests. The adapter rejects redirect-following clients. Existing URL/token/timeout validation, reconcile URI encoding, 64 KiB body cap, 256-character reference cap and maximum 60-second timeout are reused without changing the shared transport.

Execute makes one POST to the configured execute URI, with `Accept: application/json`, `Content-Type: application/json`, optional bearer authentication and `Idempotency-Key` equal to the **persisted `ProviderRequest.idempotencyKey`**. It does not replace that key with `operationId`. The current service supplies equal values; the focused test deliberately uses different values to detect substitution. All seven request fields and five scope fields are sent unchanged:

```json
{
  "operationId": "operation-7",
  "idempotencyKey": "persisted-key-7",
  "inputDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "orderUuid": "exact-car-7",
  "orderNumber": "1234567",
  "configurationId": "configuration-7",
  "firstApprovalStage": "HR approval",
  "environmentId": "isolated-dev",
  "runId": "run-7",
  "employeeId": "employee-7",
  "entitlementSlotId": "slot-7",
  "policyVersion": "policy-v7"
}
```

Reconcile makes one GET to `reconcileUri?operationId=...&runId=...&orderUuid=...`, using the same operation, run and exact car, UTF-8 percent-encoded by the existing public helper. It sends no body, content type or execute idempotency header. It never POSTs, including after `not-found`. The unchanged `OrderingService` owns reconcile-before-execute and permits execute only after authoritative matching `NOT_FOUND`; the adapter adds no retry loop, timer or persistence.

Missing scope/request facts, an unsafe header key, a non-seven-digit order number or an invalid stored digest return `UNKNOWN` before any HTTP call. The adapter preserves exact values rather than trimming or reconstructing them. It does not supply a new order number, configuration, VIN, approval stage, clock, employee authority or business decision.

## Acknowledgement mapping

Only HTTP 200 with one strict JSON object can acknowledge the operation. Duplicate keys, trailing values, wrong types and blank required text are invalid. Every usable response must echo the exact textual `operationId`, `runId` and `orderUuid`, and explicitly contain boolean `fictional: true`. The adapter identifies itself as provider `remote-ordering-substitute:v1`, mode `remote`; this transport mode does not assert live BMW verification.

Confirmation supplies all of these facts itself:

```json
{
  "status": "confirmed",
  "operationId": "operation-7",
  "runId": "run-7",
  "orderUuid": "exact-car-7",
  "orderNumber": "1234567",
  "configurationId": "configuration-7",
  "orderStatus": "HR approval",
  "providerReference": "upstream-receipt-77",
  "fictional": true
}
```

`orderNumber`, `configurationId` and `orderStatus` must match the persisted request, including its first configured approval stage. The provider reference must be nonblank and at most 256 characters. The response record copies the remote values and explicit provenance; no missing confirmation field is borrowed from the request. This acknowledges the handoff at the first stage, not completion of an approval.

| JSON status | Typed result | Fixed safe reason |
| --- | --- | --- |
| `confirmed` | `CONFIRMED`, with the full matching acknowledgement above | none |
| `rejected` | `REJECTED`, with echoed identity and fictional provenance | `remote-ordering-rejected` |
| `unsupported` | `UNSUPPORTED`, with echoed identity and fictional provenance | `remote-ordering-unsupported` |
| `not-found` | `NOT_FOUND`, with echoed identity and fictional provenance | none |
| `unknown` | `UNKNOWN`, with echoed identity and fictional provenance | `remote-ordering-unknown` |

Non-confirmed responses omit or null all four confirmation-only fields (`orderNumber`, `configurationId`, `orderStatus`, `providerReference`). Arbitrary remote `reason` text is not propagated into the service or employee-facing result. Unrecognized statuses become `UNKNOWN` with `remote-ack-status-unknown`. An HTTP 404 is not authoritative absence, and an HTTP 422 is not a scoped unsupported acknowledgement.

Malformed or divergent acknowledgements, HTTP errors, connection failure, interruption and timeout return `UNKNOWN` with fixed `remote-*` reason codes, no invented acknowledgement facts and `fictional: false` (no usable remote provenance was obtained). Interruption retains the thread flag. One deadline covers headers and the complete response body. The adapter retains at most 64 KiB plus one overflow byte and cancels oversized/non-200 bodies without draining them. Its local exchange/parser is necessary because shared `OperationHttpTransport.Reply` drops ordering facts and cannot represent `unsupported`; that transport and its existing claim/Buddy consumers remain unchanged.

## Authored evidence and remaining work

`HttpOrderingProviderTest` contains 13 focused methods using an actual in-process loopback HTTP server. They cover the exact 12-field POST/key, escaped non-mutating GET, truthful full confirmation, distinct scoped negative outcomes, wrong identity, absent/divergent order facts, strict JSON/provenance, pre-I/O validation, HTTP/redirect failure, exact/overflow body limits, body/header stalls, connection failure and redirect-client refusal. The stub owns and stops its executor. The author used no compilation or runtime. The parent subsequently ran exactly these 13 methods against frozen source `45d1c1afc05858c6f2d123d1958dd86ed625214a`: **13 passed, zero failures, errors or skips**. The finite offline Maven run exited 0 in 17.0 seconds using one fork and an in-process loopback server; no PostgreSQL was started. Independent Imhotep 2 source review found no blocking or major issue. Requested and selected author/reviewer settings were `gpt-6.1-sol` / `high`, no fallback; effective runtime settings remain independently unverified. Parent separately verified unchanged source/tool pins, all 39 recorded process identities and three groups absent, owned scratch removed and the host reservation released. Peak RSS was 632,504,320 bytes and scratch 49,144,576 bytes. No OneDrive access occurred.

The least-certain authored assertion was that the 400 ms body-stall case observes the stub's first flushed byte before the client deadline. It passed in the selected run; one observation does not establish general scheduling reliability. The 1.5-second delayed tail distinguishes body completion from a correct timeout; the overflow case separately requires `remote-ack-malformed` before its delayed tail rather than accepting timeout as size-limit evidence.

Existing ordering holder/selection/factory, all configuration, core services, shared transport and existing tests were read-only. F468 still owns the overlapping ordering integration files. A future exact-file allocation must bind this adapter at startup and validate the actual consumer; this increment supplies no hidden lookup or alternate global binding. No startup or PostgreSQL consumer tests were added.

This contributes reviewed adapter source and executed contract/failure cases toward AC1's provider-composition boundary and AC2's remote ordering handoff. It does not establish provider selection, complete inventory, demo-preparation isolation, differently shaped input computations, durable remote order consumption or a full journey. The retained generated-claim → owner JWT decision proof remains a same-instant boundary only; it was not rerun. Full `GET /api/gcsp/v1/manual/order` still reaches the refusing account policy. F458 account/core remains unchanged; F477 demand/supply/clock holds and capture-only Bugs FUCQ-513–516 remain untouched, including unrepaired F516 later-clock recovery.

No screen or presentation contract changes are wired by this standalone adapter. The [experience contract](experience-quality.md), [frozen shell reference](screens/README.md) at `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38` and `COMPONENTS.md` remain the visual baseline. No rendered UI, browser/hosted OIDC, recipient email, BMW capability, release/tick/run-clock integration or recovery acceptance is claimed. Both original Story criteria remain open. The selected source review and native run establish the standalone adapter boundary only; startup binding and actual durable consumer integration remain pending.
