# Manual review details — FUCQ-70

This additive backend slice stores contact and returning-car inputs independently of the immutable claimed quote and its pinned draft. It consumes the frozen FUCQ-66 claim contract at `f81855fe1814657b8a2b0bbd949ac8e204dec44e` (implementation inspected at `abed0960618fd67a160d857b65029c0f64c9a2a7`). It does not integrate that producer or FUCQ-71. Actual browse/claim/review, submission freeze/readback, native PostgreSQL, browser and full-suite acceptance remain outstanding. Follow [technical readiness](technical-readiness-2026-11-05.md), [build rules](build-rules.md) and [experience quality](experience-quality.md).

Construct `ManualReviewDetailsService({ repository, policy, identity, manualClaims })` with the existing opened repository, canonical PolicyService, DemoIdentityAdapter and authoritative `manualClaims.readClaim(context)`. Public operations are `readReviewDetails(context)` and `saveReviewDetails(context, input)`. Identity requires employee role before either operation, and the service requires the current run. The additive `createManualReviewDetailsRoutes(service)` factory exposes GET and POST `/api/gcsp/manual/review-details`, employee role, no query selectors. Existing host origin/session/no-store enforcement still applies; this module does not register itself in the central server. Release/cancel/change remains the separate claim service operation and must be available even while these form inputs are invalid.

POST accepts exactly:

```json
{
  "commandId": "review-save-1",
  "holdId": "server-hold-id",
  "quoteId": "server-quote-id",
  "expectedHoldVersion": 1,
  "expectedDraftVersion": 1,
  "expectedReviewDetailsVersion": 0,
  "details": {
    "contact": { "phone": "01632 960001", "email": "chooser@example.invalid" },
    "expectedReturnMileage": 6700,
    "specialRequirements": ""
  }
}
```

Command, quote and hold IDs are nonempty strings of at most 100 characters. Hold/draft versions are positive safe integers; metadata versions are nonnegative safe integers. No employee/run/slot/policy selectors are accepted. A stable command ID belongs to one exact payload. Unknown command, detail or contact fields are invalid. Telephone uses the existing manual-context pattern `^\+?[0-9 ()-]{7,30}$`; email is required, at most 254 UTF-16 code units, and uses the existing basic format. Replacement mileage is a required safe integer from zero to the policy maximum, in miles. New order mileage is absent or null. Special requirements is a string, empty when unused, bounded by the policy maximum in UTF-16 code units; existing canonical forbidden controls U+0000–0008, U+000B–000C and U+000E–001F are rejected. Requests never change stock or terms.

GET reconciles through `manualClaims.readClaim` and projects the current claim, then fences against concurrent metadata, hold, clock and lock changes. It writes no receipts. Revision zero comes from exactly `manual:draft:<employeeId>` / event `String(quote.draftVersion)`, never the latest draft. The complete pinned receipt must match run, employee, entitlement, draft version and policy. The metadata consumer is `manual:review-details:<employeeId>:<entitlementSlotId>:<holdId>` with numeric event IDs starting at one. Commands use the existing `command:transaction` consumer and command key `manual:review-details:<employeeId>:<entitlementSlotId>:<commandId>`.

A successful GET or POST uses shared `{ status: 'ok', contractVersion: '1.0.0', value }`. `value` contains:

| Field | Meaning |
| --- | --- |
| `binding` | `{runId, employeeId, entitlementSlotId, holdId, quoteId, expectedHoldVersion, expectedDraftVersion}` from trusted authority |
| `reviewDetailsVersion`, `details` | Independent revision and complete safe inputs, retaining historical inputs after expiry |
| `constraints` | `maximumSpecialRequirements`, `maximumReturnMileage`, `mileageUnit: 'mi'`, `textLengthUnit: 'UTF-16 code units'`, full `provenance` assumption row |
| `mode`, `currentContract`, `oldContractId`, `contract` | Exact pinned draft context; unavailable contract context remains null |
| `requestedCollection` | `{ date, locationId }` from the pinned draft; a request, not a confirmed appointment |
| `orderNumber` | Seven-digit employee label from the exact bound stock row; order/configuration must still match the pinned quote |
| `hold`, `quote` | Existing authoritative hold and exact pinned quote; images/facts retain their producer fidelity |
| `now`, `clockVersion` | Persisted run `clockInstant` and numeric-string clock version |
| `frozen`, `editable`, `canContinue` | Current metadata lock and claim authority; `canContinue` permits the save/continue attempt, not final selection acceptance |
| `view` | `{state, editable, action, supportOwner:'employee'}`; state review, locked, pending, expired or the producer's terminal hold state |

Read `manual.context.v1` using `{runId, asOf: persistedRun.clockInstant, policyVersion: quote.policyVersion}`. Validate the returned policy/version, positive integer bounds and assumption provenance. No copied defaults or active-policy substitution is allowed; a later active policy does not rewrite the quote pin. Policy source failures refuse new reads/saves. An unchanged command/payload retry returns its original successful save response even after later revisions, expiry or policy-source failure, while identity and current-run checks still apply. That response is historical; the client must GET current authority before continuation.

Save first reconciles the claim, validates all fields, then atomically verifies persisted employee/slot ownership, current-claim pointer `manual:claim-current:<employeeId>:<entitlementSlotId>` (latest numeric event), hold/quote/draft binding, expected hold and metadata revisions, active state and exact persisted clock. The initial policy read is fenced by clock version and instant inside the save transaction. `now >= hold.expiresAt` or `now >= quote.validUntil` refuses saving. A frozen receipt, selection-pending/allocated hold, or pending `manual-allocate` operation for that hold refuses edits. Only a new metadata receipt and the repository command receipt are written. No draft/quote/stock/hold/policy/expiry is changed, and the service never calls saveDraft, beginReview, claim, release or allocation. Validation cannot save partial fields.

## Submission port

`freezeReviewDetails(tx, binding, expectedDetailsVersion)` is a trusted backend port. `binding` is **exactly** the seven fields in the table above, including expected hold/draft versions; the run, employee and entitlement must be derived from trusted context by the caller. `expectedDetailsVersion` is the exact nonnegative integer revision. The caller must use its existing selection-intent repository transaction, call freeze before persisting selection, and return any refusal to roll back the entire transaction. No nested transaction, PolicyService, identity or network operation occurs in this port.

A successful explicit details save is required before continuation: revision zero returns conflict `review-details-not-saved`. Freeze verifies current persisted binding/ownership/clock/hold/current metadata inside the supplied transaction, requires active/unexpired authority and the exact saved revision, and writes `manual:review-details:<employeeId>:<entitlementSlotId>:<holdId>:freeze` / event `selection`. Its value is an immutable copy of `{binding, reviewDetailsVersion, details, constraints, savedAt, clockVersion, frozenAt, frozenClockVersion}`. This includes the validated policy provenance from the save. A repeat for the same exact binding and revision while authority remains valid returns the original snapshot; another revision, stale binding or deadline is refused. The immutable lock survives pending uncertainty. There is no unlock API. Order readback and print must consume the frozen snapshot. FUCQ-71 adoption in the same selection-intent transaction is an outstanding integration gate; merely calling the read port before submission is insufficient.

## Refusals and recovery

Shared statuses retain the producer's HTTP mapping: ok 200, pending 202, invalid 400, forbidden 403, not-found 404, stale-version/stale-run/conflict 409, unavailable 503. Claim/identity/repository outcomes may pass through unchanged, including pending. Pending is never a held/submitted success.

Integration prerequisite: the starting shared revision `7270827` has no pending-to-202 entry in `server/gcsp/identity/http.js`; frozen FUCQ-66 source `abed096` supplies it. The route factory alone does not prove this HTTP status. Retain that producer change during central composition; FUCQ-70 does not edit the identity boundary.

| Status / code | Exact additional shape / action |
| --- | --- |
| invalid / `invalid-review-details` | `reasons:[{field,reason}]`, view validation/editable/correct-fields; field is command, an exact command field, details, contact, contact.phone, contact.email, expectedReturnMileage, specialRequirements or binding |
| invalid / `unsupported-query` | `reasons:[{field:'query',reason}]` |
| stale-version / `stale-review-details` | `resource:'hold'|'manual-draft'|'review-details'|'clock'`, `expectedVersion`, `currentVersion`, action refresh, view conflict/refresh-review |
| conflict / `idempotency-input-changed` | Changed payload for a used command; choose a new ID only for a new deliberate save |
| conflict / `claim-binding-changed`, `quote-binding-changed`, `stock-binding-changed`, `review-read-changed` | Refresh current claim/review authority |
| conflict / `review-details-locked` | Submission/freeze/pending/allocated authority prevents editing |
| conflict / `review-details-not-saved` | Save valid details before freeze/continue |
| conflict / `claim-not-active`, `claim-expired` | Preserve inputs, disable continuation and offer refresh stock; no reacquisition or extension |
| unavailable / `manual-review-source-unavailable` | `source`, `retryable:true`, `reason`, view unavailable/editable false/retry/scheme-support |
| forbidden / no new code | `reason` identifies entitlement ownership; no cross-employee quote/details projection |
| not-found / no new code | `resourceType:'manual-claim'` when no current pointer; repository lookup statuses otherwise pass through |

Conflict outcomes include `reason` equal to the code, `action:'refresh'` and view conflict/editable false/refresh-review/employee. Clients focus the shared error summary for invalid fields, retain entered safe values for a recoverable failure, and use the shared truthful pending/expired states and server clock rather than restoring a held flag locally.

The scoped test `node --test --test-concurrency=1 server/test/gcsp-manual-review.test.js` uses real memory repository, canonical PolicyService, DemoIdentity and presenter advance/tick. Its explicitly named claim-read double exercises this boundary only; it proves no unavailable live producer or submission integration. It covers pinned versus newer draft, reopen, concurrent revisions, stable and changed historical retries, exact deadline, bounds and malformed fields, ownership/binding refusals, pinned policy constraints, save/freeze ordering, rollback and pending/allocated locks. No screen or browser acceptance is claimed by this slice.
