# Manual claims backend · FUCQ-66

Implementation contract, 5 November 2026. This adds manual rules to the existing transaction authority; it adds no repository, schema, migration, runtime dependency, screen or buddy behaviour. The canonical [shared contracts](shared-contracts.md), [build rules](build-rules.md), [manual context](manual-journey-refinement.md#implemented-manual-context-contract--fucq-65) and [experience contract](experience-quality.md) remain binding. Managed PostgreSQL execution is still a completion gate: an unset `GCSP_DATABASE_URL` is explicitly remaining work, regardless of memory/driver-double passes.

## Composition and authority

Create `ManualClaimsService` with the opened repository, PolicyService, DemoClock, DemoIdentityAdapter, existing ManualContextService as `manual`, and an explicitly injected stock-action `adapter`. `createSyntheticManualStockAdapter()` selects `mode: local-synthetic`: all effects are local repository transactions and nothing is sent upstream. Missing storage, clock, identity, policy or adapter yields unavailable; there is no inferred memory provider or reservation success.

Compose `buildServer({ gcspIdentity, gcspClock, gcspManual, gcspManualClaims, gcspAllowedOrigins })`. The claims wrapper supplies the existing account/draft/browse routes so reads and draft commands reconcile manual expiry. The server registers stable handler `manual-claim-expiry` at the existing `manual-expiry` clock stage before startup reconciliation. Failed or late registration leaves claims unavailable. Register it explicitly with `service.registerClockHandler()` when using the services without HTTP. Startup and presenter ticks reconcile without a browser; no unattended runner or sleeping-host scheduling is promised.

All methods require the same server-issued employee context and current run. Client principal, employee, grade, scheme, role and run fields cannot grant authority. Claim/quote reads scope to the employee and entitlement, and terminal reads retain their original pinned quote. Presenter reset remains the existing clock's explicit synthetic-only operation; there is no new reset endpoint or operational reset path.

## Public routes and backend port

| Method | Payload / result |
|---|---|
| GET `/api/gcsp/manual/stock` | Existing eligible, unranked browse projection, plus each eligible car's `claimInput`. Reading creates no reservation. |
| POST `/api/gcsp/manual/claim` | `commandId` plus the exact returned `claimInput`: `orderUuid`, numeric `expectedStockVersion`, `expectedDraftVersion`, `expectedContextVersion`, `expectedTermsDigest`. |
| GET `/api/gcsp/manual/claim` or `/quote` | Current state, owned hold, pinned quote, pending-operation summary, current domain time/clock version and presentation action. No query selectors. |
| POST `/api/gcsp/manual/claim/review` | `commandId`, `holdId`, `expectedHoldVersion`, `expectedDraftVersion`; explicit once-only progression to order-review. |
| POST `/api/gcsp/manual/claim/release` | Same expected versions plus `reason: cancel|change|back`; explicit cancellation/release. |
| `service.allocate(context, input)` | Backend-only port with the same hold/draft versions. Converts the existing stock order to allocation atomically. FUCQ-71/72 must validate their declarations/order-handoff contract before invoking it. No public final-submit shortcut is exposed here. |

The existing origin/access/session/current-run/role/no-store boundary applies. Outcomes preserve `status`: ok 200, pending 202, invalid 400, forbidden 403, absent 404, stale/conflict 409, unavailable 503. Pending means the operation needs authoritative reconciliation, not that a reservation or submission succeeded. An allocated stock order is not approval, confirmed collection or a new current car.

## Exact claim and pinned quote

Review re-runs current employee/driver/licence/insurance, eligibility, typed monthly-points versus company/grade allowance, entitlement, draft, availability and terms gates through ManualContextService/PolicyService. It checks employee, slot, draft, exact stock and clock revisions inside the transaction. A changed authoritative employee record cannot borrow the earlier session's grade. Two employees or tabs can produce only one occupying hold on an exact `orderUuid`; two cars sharing a `configurationId` remain distinct. Employee-facing `orderNumber` stays seven digits. No stock VIN is created.

One transaction pins the immutable quote and exact facts, conditionally creates the paired hold/claim, changes stock to held, bumps the entitlement CAS revision and appends a current-claim receipt. The foundation's internal `available` precondition is normalized from eligible `released` stock inside that transaction; it is never exposed as an intermediate availability window. Any failure rolls everything back. Quote JSON uses existing fields: `eligibility` carries context/driver/source/stock-version evidence, semantic terms digest and the resolved timing entries. `terms`, facts, policy, draft version and provenance remain pinned. `quote.validUntil`/`quote.expiresAt` are the quote validity boundary; the hold's current `expiresAt` is the authoritative reservation deadline.

The existing `event_receipts` table also carries `manual:claim-current:<employeeId>:<entitlementSlotId>`, with a monotonically numbered event and `{ holdId }` outcome. Commands use `manual-claims:<employeeId>:<entitlementSlotId>:<commandId>` inside their run. Identical retries retain the original receipt response and its original timestamp, while first reconciling current expiry/pending work; use the read route for current state. Changed input under the same command ID conflicts.

Draft context dependency hashing excludes storage-only slot version/timestamps. The numeric slot revision remains a write precondition. Semantic changes to the entitlement still invalidate the draft. Draft saves reject an occupying or allocated manual hold inside their own transaction, including a claim that raced a previously prepared draft edit. Release first, then save changed choices and select from freshly read stock.

## Timers, change and expiry

The service reads `hold.cart.durationSeconds`, `hold.cart.orderReview.durationSeconds` and `hold.cart.orderReview.transition` through PolicyService and pins their provenance in the quote. The current canonical defaults are a short 120-second preview, separate 600-second order-review phase and `once-from-preview`; these are revisable demo assumptions pending SAN-017, not screenshot countdowns or the separate buddy rule. The seed remains the only active source.

Claim stores preview expiry once. Explicit review before that deadline revalidates the current draft, driver, terms, quote validity and held stock, then stores `reviewStartedAt` and the separate review deadline once. New command IDs, back/forward views, reload, retry and navigation never renew either deadline. Exact `now >= expiresAt` is expired. Quote/stock/driver/context changes refuse further review/allocation but do not prevent explicit cancellation.

Explicit cancel, change or cancelling back releases the existing claim. Replacement is release-first: wait for confirmed release, browse again, then issue a fresh versioned claim. The service never creates a second hold or briefly frees a remotely uncertain car. Local release/expiry changes paired hold/claim and exact stock together. Successful allocation changes the same pair, stock and entitlement atomically, preserving the current-car record. Allocation is irreversible through the cart release port.

Expiry runs on current reads, commands (including identical command retries), startup and explicit ticks. Pending claims, releases and selections occupy stock/entitlement after their original deadline until reconciliation. A late successful claim acknowledgement triggers overdue release; an uncertain selection submitted while valid is reconciled before expiry can free it. Reads detect a concurrent hold revision while projecting quote/pending data and return a refresh refusal instead of a torn success.

## Remote-shaped adapter protocol

An explicitly injected `mode: remote` adapter implements bounded `execute(operation)` and `reconcile(operation)` calls. This story supplies contract doubles, not an operational transport. The provider must enforce conditional exclusivity and idempotency using the exact persisted `operationId`; HTTP timeout alone cannot supply an acknowledgement.

Before any effect, one repository transaction persists `pending_operations` and the matching `claim-pending`, `release-pending` or `selection-pending` hold/claim. The existing operation payload retains run, employee/slot, exact stock, quote, intended terminal state/reason, original deadline and expected stock/slot/hold revisions. The adapter runs outside repository transactions. A retry/restart reconciles first; only scoped authoritative `not-found` may resend the same operation ID. Concurrent identical command receipts cannot launch a second fresh intent.

Acknowledgements must carry `status: confirmed|rejected`, matching `operationId`, `runId` and `orderUuid`; authoritative absence carries those same scope fields. Unknown, malformed, wrong-scope, thrown or uncertain results leave the operation pending. Confirmation atomically records the outcome and changes the existing hold/claim/stock as appropriate. Claim refusal becomes terminal `claim-failed`; release/selection refusal restores active authority with its unchanged deadline, and normal expiry is then checked. No quote is silently repriced. Reopening uses persisted intent and the provider's stable operation ID, without in-process locks as a substitute for authority.

## Repeatable backend trials and evidence

Use the existing DemoRuntime and presenter-controlled fictional employee context. Prepare `seedManualDemoContext`, then two small typed released stock rows using the existing repository fixture pattern in `server/test/gcsp-manual-claims.test.js`; clock corpus references alone are not released stock. The test helper reads all active timing/policy values from the shared source and labels facts synthetic. No screenshot personal data is copied.

1. Save supplied manual choices, browse and retain a `claimInput`; verify no holds exist. Claim and reload `/claim` and `/quote` with the same session: exact order, facts and original expiry remain.
2. Submit the same exact-car claim from Paula and Alex (the named fixture uses an eligibility/allowance-compatible F70 120 model key) or two Paula tabs. Observe one winner and a stale/conflict loser. Cross-employee quote/command access is refused.
3. Progress explicitly to order-review, advance the existing demo clock, reload, retry and progress again. The stored review deadline stays fixed. Advance exactly to it, then tick/read: expired stock is released locally.
4. Explicitly cancel/change/back, confirm release and claim another released exact order. Attempt a draft edit or second claim before release: `release-required`; no leaked second hold.
5. Inject the remote contract double returning pending/throw, then reload/reopen and advance beyond expiry. Stock remains excluded. Confirm or reject via reconciliation and inspect the persisted result. Pending selection never turns into availability at the deadline.
6. Close/fail the repository or inject a failure after writes. Observe unavailable/pending with no fake success, partial quote/hold or external effect. Reset only through the existing synthetic presenter reset and obtain new sessions; old commands are stale-run.

The actual asserted presentation fixture is `server/test/fixtures/gcsp/manual-claims-presentation.json`: quoted, released, expired, conflict, unavailable and pending. Backend-only deterministic fixtures/trials replace screenshots for this slice. FUCQ-70/72 own rendered desktop/narrow/keyboard review against the supplied shell/sidebar/palette and Used Cars body direction; FUCQ-64's representative actual-body human review remains required for later body fanout. No browser/deployed/live-provider parity is claimed.

The configured SQL repository contract adds manual quote/intent atomic rollback, pending exclusion, idempotent reopen and a separate Node process reopen reader. Existing contract cases cover concurrent exact uniqueness and native occupancy constraints. The 5 November local native attempt reached its 600-second resource limit without a final result; its exact synthetic namespace was cleaned. The [transfer record](evidence/fucq-6/fucq-66-native-transfer.md) records the bounded diagnosis and remaining native proof. Configuration stays in the approved private backend environment route, and native execution remains dispatcher-coordinated. See [the evidence record](evidence/fucq-6/fucq-66-manual-claims.md).

Background design check on 5 November returned `plugin_list_tabs(drawio): state closed, tabs []`. Existing manual/stock-action/repository/clock topology governs. Diagram status changes and render inspection remain unverified; no open, focus or raw XML workaround was used.
