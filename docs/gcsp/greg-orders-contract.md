# Greg order requests and production acknowledgements — FUCQ-104

This implements the existing HLD supply loop inside the Node backend and F81 repository. The service, upstream adapter and repository connection already exist in the agreed architecture; there is no new process, store, queue or live BMW write. A synthetic request is intent; a provider acknowledgement is confirmed supply; existing exact stock and successful F92 receipts establish release.

## Durable records and native startup

Migration `0004_greg_supply.sql` adds two run-scoped JSONB tables without changing migrations 0001–0003. `future_order_requests` retains model, derivative, positive quantity, requested actor/time, policy and stock pins, upstream reference, provenance and request history. Request states are requested, partly-confirmed, confirmed and delayed. The requester/command and upstream reference are unique within a run.

`confirmed_supply` is immutable acknowledgement history, linked to the same run's request. It retains positive quantity, confirmed/expected instants, policy/source versions and a unique upstream acknowledgement reference. Further partial acknowledgements append distinct supply records. These tables never insert stock or change its availability. Pending-operation/queue receipts do not replace either business record.

Both tables join `FOUNDATION_TABLES` automatically. Native startup must apply 0004 before foundation snapshots/transactions can read them. Gary owns native PostgreSQL proof and credentials on his machine. Migration discovery and driver-double compatibility do not establish native execution. Reconcile the migration number with other writers before shared integration; never rename an applied migration.

## Supply service and authenticated routes

`createSupplyService({repository, policy, clock, identity, production, releases})` exposes `submit`, `stepProduction`, `queueConfirmed` and `readTracking`. Contexts come from F84; copied or browser-supplied contexts fail. Submission records the observed policy version and the digest of current run-scoped stock, with a conditional transaction fence for clock, policy, run and stock changes. Command replay returns the recorded result; a changed payload conflicts.

`createSupplyRoutes(service)` is additive registration for the shared handler:

| Method/path | Authority | Operation |
| --- | --- | --- |
| GET `/api/gcsp/greg/orders` | Acting Greg cookie | Tracking and versioned synthetic choices |
| POST `/api/gcsp/greg/orders` | Acting Greg cookie | Submit model, derivative, quantity and observed policy/stock pins |
| POST `/api/gcsp/presenter/production` | Retained presenter control cookie | Confirm a positive quantity or delay the outstanding request |
| POST `/api/gcsp/greg/orders/queue` | Acting Greg cookie | Retry queueing persisted acknowledgements through F92 |

All routes reject query selectors. The common boundary rejects browser identity/run fields. Production and queueing remain separate authenticated actions: the browser can submit a presenter confirmation and then queue with its acting Greg session without forging either role. Queue failure retains the immutable confirmation and allows retry.

`expectedAt` is `confirmedAt + PolicyService supply.leadTimeDays`. A new production acknowledgement supersedes an earlier delay for its confirmed quantity; a delayed outstanding remainder stays visible. This matches F92's published queue date calculation. The adapter does not invent a later acknowledgement date that F92 cannot represent. An eventual provider with another date convention requires an agreed port extension.

`readTracking` retains request, confirmation, outstanding and released quantities separately. Actual successful F92 release receipts must match the persisted stock's supply, tranche, time, source and policy provenance. A double read with a clock/run fence refuses mixed revisions. Adapter failure leaves saved tracking readable and disables fresh requests; unavailable queueing does not remove confirmation history.

## Published producer and shared-runtime gates

F92 pin `15a79957e61d81612311d3aab7dbf77733dc4e0d`, `server/gcsp/stock/index.js:118–145`, accepts a run-bound confirmed reference, not stock rows or a caller-supplied eligibility date. Only its registered release-pull tick writes released stock. The synthetic production adapter requires an explicit versioned model/derivative choice set and performs no live ordering write.

F96 pin `d12358bcd02f4c10a5dc9f0851efe94bc2c9d864`, `server/gcsp/allocation/index.js:75,174,205`, requires `identity.resolveEmployeeContext`. That exact published commit includes the trusted resolver at `server/gcsp/identity/index.js:206–222`; a supported `git show` and empty file diff verified the source. The shared foundation used by this branch does not yet include that method. The integration gate is adopting that reviewed identity capability through GC's shared-runtime ownership. Authenticated service checks here do not prove the canonical allocator/runtime integration. No producer or central-runtime file was changed by F104.

## Checkpoint validation

Storage acceptance uses `node --test server/test/gcsp-greg-orders.test.js server/test/gcsp-repository-contract.test.js`: 45 passed, two native PostgreSQL skips, zero failures at the storage checkpoint. The checks prove separate durable rows after memory reopen, run isolation, acknowledgement immutability/reference/idempotency and zero stock creation. The existing contract exercises foundation snapshot/flush and migration-history compatibility through a driver double.

The submission/confirmation checkpoint uses `node --test server/test/gcsp-greg-orders.test.js server/test/gcsp-clock-reset.test.js server/test/gcsp-greg-demand.test.js`: 46 passed, zero failures/skips. It covers real F84 acting/presenter cookies, refusal/forgery, replay, stale pins, partial and delayed production, lead-time policy changes, concurrent acknowledgement fences and unavailable adapter/queue recovery. F92 queue is an injected contract double in these authored tests. These are earlier service checkpoint counts. The final module/UI and actual producer checks below supersede the pending module/UI work; native SQL, canonical shared-runtime/Greg host adoption and final authored full-suite validation remain open.

Run ownership and exact targeted identity are retained at `.claude/dev-poller-restart-20261105/lead104/validation-plan.json` and `runs/targeted-f7a1599e42932ec46963aaed2b9b51a9227b596646c61ca11d6dffdc26f627d2-default-1793924281545242000.json` in the launching clone. All owned scratch and the audited read-only pg dependency symlink were removed by finalizers. No native database or live ordering operation was attempted.

Service/HTTP evidence: `runs/targeted-98b824398506254a6f1b7d6cca536b0e13913d8ba0fdd484a0daab446f513bcf-default-1793924750397558000.json`. Resource roots and overlay cleanup are retained in the same launching evidence directory.

## Embeddable tracking block

`blocks/gcsp/greg-orders/greg-orders.js` exports `mountGregOrders` and a separately registered `<gcsp-greg-orders>` element. It reuses `el`, `button`, `statusScreen`, `labelledField` and `dataTable`; no shared-kit primitive was added. Native forms retain keyboard/focus state during operations and retain an exact pending command for safe retries. Saved tracking remains visible when fresh production choices are unavailable. The stage, requested/confirmed/outstanding/released counts, expected dates and outstanding delay are separate fields.

`harness.html` plus external `harness.js` show the additive block inside the existing Greg dashboard's reserved `orderTracking` region. The harness requires trusted server bootstrap and same-origin authenticated routes. Its optional production disclosure requires the separate presenter cookie. Canonical server/runtime and Greg host registration remain with GC. The new stylesheet has a 23-literal ratchet cap; existing stylesheet caps and baseline were preserved.

## Final scoped evidence, 6 November 2026

The final explicit selection ran serially with `--test-concurrency=1`: orders, orders UI, Greg dashboard, clock/reset, Greg demand and UI ratchet. It passed **119/119**, with zero failures or skips. The two `render.test.js` checks selected by `--test-name-pattern="no em dashes"` also passed. These scoped checks do not constitute the required `npm test` result. An initial six-file parallel attempt exceeded the 512 MiB RAM plan and was stopped, cleaned and recorded as incomplete resource evidence; the same selection passed serially with 257294336-byte peak RSS.

The actual pinned F92/F96/F100 module composition passed **1/1** with the published F96 identity resolver. It proves no stock before the policy lead time, equal expected/queued dates, actual release, one held car/hold/offer/outbox, changed Greg demand and unchanged tick replay. It uses explicitly synthetic exact-stock inputs and the memory repository. This is actual producer composition evidence, with canonical shared runtime, source bootstrap and native database validation still separate.

The authenticated isolated HTTPS browser proof passed all seven states at 1440 px and 390 px. It used real Secure F84 cookies and actual supply/demand/routes and pinned producers. It proves keyboard request and partial confirmation, visible focus, table scrolling without page overflow, strict self-only CSP and zero browser/console/external-request errors. The lead inspected desktop partial, narrow delayed and the seven-state contact sheet. The dispatcher caught repeating content in the two original fullPage shell images. A focused follow-up verified one shell/dashboard/header/orders element and continuous geometry at both widths; all four normal viewport and scrolled-in-shell captures were inspected and pass. Invalid originals are retained as red capture evidence; no product DOM duplication was found. See [the evidence record](evidence/fucq104/README.md).

Exact identities, proof sources and ownership/checkpoint manifests are retained in the launching clone under `.claude/dev-poller-restart-20261105/lead104/`. The final scoped code key is `3ff9d1ca64f2f7fae9def66ac00b81ff0b935c0ab9896f497fc81738a5cce465`. `final-resource-receipt.json` independently verifies all19 scratch roots, owned process groups, reservations and dependency overlays absent. Recorded removed scratch is36765615 bytes across all attempts; successful verbose logs were reduced to concise tails and hashes, removing106843 bytes. The browser's bounded profile/cache and ephemeral HTTPS certificate were the local compatibility exception, latest matrix peak 9167840 bytes; focused shell follow-up 8990465 bytes; all were removed. No leftover is recorded. No credential access, native database or live ordering operation occurred.

The story remains **blocked** for GC-owned canonical runtime/host and reviewed identity adoption, source-backed choice/stock bootstrap, Gary's native migration0004/snapshot/transaction proof, and the authored final `npm test` at the dispatcher-admitted integration point. The additive module and synthetic producer/browser proofs do not close those gates.

Canonical routing and concrete adoption steps: [F104 integration handoff](fucq104-integration-handoff-2026-11-06.md).

## Resumed host attachment, 6 November 2026

`attachGregOrders` in `blocks/gcsp/greg-orders/runtime.js` follows the existing dashboard's reserved region across actual remounts, mounts one registered order element, refreshes the same demand dashboard after a change, and restores the reserved content on replacement/stop/abort. It leaves identity/bootstrap and demand-adapter ownership with the host. The owned harness now uses it. Production disclosure remains an explicit host boolean, false by default.

The helper, orders UI, dashboard and ratchet selection passed **74/74**, serially, with no skips/failures. The static CSP guard was corrected to distinguish a callback default from inline markup/DOM handlers; it retains executable-handler/eval/Function/string-timer checks. Current authenticated headless HTTPS proof submitted a real synthetic request, observed a fresh actual demand-route read, remounted the dashboard and retained one saved request/panel, then captured inspected normal viewports at1440/390 with no page overflow or page/console/external errors. Its first reused proof issued an already-expired absolute cookie; the proof now uses actual session wall time independently of the synthetic DemoClock. Product authentication was unchanged.

Evidence is in [browser-attachment](evidence/fucq104/browser-attachment/attachment-report.json), with [the source/runtime mapping handoff](fucq104-source-runtime-handoff-2026-11-06.md). Scoped source key `a19b72e5fd3b17d9eb53961002d9f5d22ceea289ba06a420c83158c5d51376e9`, base `52663f78635e3194f7ed3f3118f7cddc2c22fb96`, aligned HEAD `f10a3aae94ff4a65463bf3b73962fc91136e0ccc`; exact source hashes and resource manifests remain under launching `.claude/dev-poller-resume-20261106/lead104/`. Canonical/native/source/full acceptance remains blocked.
