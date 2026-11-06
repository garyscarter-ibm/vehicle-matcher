# Offer display contract and delivery gates · FUCQ-105

5 November 2026. Independent delivery contract. Approved FUCQ-102 DTO bindings are implemented below; actual producer/access/decision/host integration and full story acceptance remain open. Earlier requested fields remain historical requirements where the approved DTO does not yet supply them.

## Boundaries

Own `blocks/gcsp/offer/`, dedicated `server/test/gcsp-offer-view*.test.js` and offer evidence. No policy, repository, identity, producer, decision service, central host or launcher mutation. Reuse portalShell, screenIntro, button, statusScreen, matchCard explicit exact-member view, mediaWell, factList, formatTerm and shared tokens. Existing employee countdown formats contract days; offer timing needs server-clock projection and authoritative rereads, not a new business clock. Comparison composes existing factList columns. Shared catalogue/gallery/ratchet additions require precise coordination.

## Requested FUCQ-102 read and secure access protocol

- One discriminated response with current offer/hold state and pending operation (`intendedDecision`, `lastKnownState`, operation ID), current-run versus earlier-run/not-found/refused/unavailable outcomes. Earlier-run is read only.
- Opaque offer/run identity, exact `orderUuid`, seven-digit string `orderNumber` (leading zeros retained), `configurationId`, offer/hold versions and server-owned actionability. Never derive authority from a URL selector.
- Immutable pinned quote: typed points-monthly cost and allowance, model/derivative/colour/options, exact fact values/units/unknowns, representative image source/alt/caption and fact/quote provenance; grounded reasons/trade-offs/decision gate and brief/policy versions. No client repricing or feature inference.
- Original `expiresAt`, server DemoClock instant and version in every authoritative read; explain the presenter refresh/tick readback mechanism. Zero triggers reread; it never means the client declares expired. Reload/back/second browser must retain the deadline.
- Current-car comparison from an authorised server projection (Paula G21 320i M Sport Touring when actually supplied), with unknown equipment and source/provenance. Missing projection stays explicitly unknown, never a fabricated configured car.
- Email fragment token secure exchange, immediate URL fragment removal, server-issued secure refresh/reissue capability for reload and second browser, and account trusted-identity entry. No token query string, logs, evidence or localStorage. Confirm cookie/CSRF/Origin/no-store requirements and exact endpoints before adapter binding.
- Future FUCQ-106 decisions use an explicit injected port, server expected versions/idempotency and readback; pending/uncertain outcomes keep controls blocked. Until published and integrated, actions are visibly unavailable and cannot emit accepted/declined success.

## Full stable slice plan

1. `surface`: exact pinned card, points and side-by-side current-car facts; shared composition and narrow layout.
2. `controller`: one current state, stale-response protection, authoritative clock/deadline reread, truthful decision uncertainty and lifecycle teardown.
3. `access-producer`: reviewed FUCQ-102 protocol and adapter on actual FUCQ-100 output; token/account/reload/second-browser parity.
4. `decision-host`: real FUCQ-106 decisions, readback and delivered host/runtime integration.
5. `browser`: actual 1280px/375px captures for every authored state, keyboard/focus/reduced motion, long names/missing images, expiry/presenter ticks and repeated access.
6. `validation`: authored `npm test`, ratchet/CSP/em-dash checks and final acceptance review on the delivered tree.

Product association is the existing `offer-journey`; no component boundary changes. Model/effort requested and selected: gpt-6.1-sol/high, no fallback; parent-only initially. Chat title verified Hippety Hopper (they/them). Effective gpt-6.1-sol/high verified from own turn_context; root independently verified title/context.

## Reference and validation plan

Read the binding AGENTS, GCSP README/demo brief/build rules/experience contract/technical-readiness/shared contracts, screen index and HLD column 05. Inspected supplied `00-employee-account.webp`, `01-replace-vehicle.webp`, and FUCQ-64 representative desktop evidence; body reference a7fc178. Current default Density tokens apply. Working E2E precedes human layout review; actual rendered inspection remains mandatory.

Select narrow controller/projection/render tests plus affected shared-kit boundaries, CSP and UI ratchet. New code has unknown automatic impact coverage; record explicit source-to-check map. Full suite, browser/listener/native DB and live network proof are reserved for root coordination. Fixtures, if added, are conspicuously presentation-only and prove no producer/decision/runtime acceptance.

Before any proof/build allocation use fresh shared HostBudget, external ownership manifest and supervisor finalizer; one worker, default 120s/768MiB RAM/128MiB combined scratch and output/2MiB logs, smaller on pressure. Shared `.claude/test-runs` summaries, bounded owned `/tmp` scratch, checkpoint and verified teardown. Strip every DB URL alias from ordinary tests. No secret-file access or new runtime dependency. Installed environments are preserved. No descendants currently.

## Reviewed access proposal checkpoint

Root supplied LOCAL immutable102 contract9c124e7f51e8d207cb1847b3cdd64e5e82eddfe7, independently read through scaffold helper with SHA2567a5b98ba217d5c5e502964a04fddc571eb93b013eeaf39dfcfd25407719aaf0d. It defines fragment-body POST `/api/gcsp/offers/access`, fresh HttpOnly hash-only cookie, exact GET `/api/gcsp/offers/:offerId?runId=locator`, account fallback only without an access cookie, and authenticated stale-run with no quote. Exact nested allowlisted fields/sample remain under102 review. Current producer has no pinned current-car comparison; root coordinates a minimal real snapshot. No fabricated G21 equipment, current points or provenance. Published100 token ancestor was inspected;41f995f itself is documentation-only, while executable producer is in its ancestry. Current local token extension ref5d8b01fe16d4cd16b4ff124619f0efe3e099a260 adds runId beside offerId without changing fragment token/hash semantics.

## Approved102 DTO adapter slice · ec70522

Root approved the exact nested allowlist/sample at LOCAL immutable `ec70522c81e8b9f671a3c92cd46eea4cd0a13000`. The contract SHA256 is `bc1dcaff59fec98086041ccf9f6701d128a51407e90545eaf5d5d9b199b163f2`; sample SHA256 is `04272860d8783820235cbc76b25ac1a96898350be2305e81bbbc56ca558f0f1f`. Both were independently verified through the scaffold helper. The exact copied safe sample is `evidence/fucq105/representative-access.json`. It came from the actual evaluator/access over synthetic rows and proves schema compatibility, not the actual100 producer.

`toOfferPresentation(envelope, { reference })` validates the approved schema, exact public locator, stock identity, positive revisions, seven-digit string order reference, finite typed points, pinned allowance agreement, Fact/Provenance shapes, media protocol and explanations. It builds the existing `decisionView`/shared-card contract without policy, feature inference, repricing or synthetic current-car defaults. Unsupported/private fields are omitted; malformed public shapes are unavailable. Display-only caption fallback qualifies an uncaptioned image as representative/unconfirmed. Empty supplied option lists read None listed; missing equipment stays unknown.

The top-level server hold `expiresAt` governs the countdown. Quote `validUntil` is retained as quote evidence and never replaces that deadline. The sample intentionally differs: server12:00, hold14:00, quote validity13:00; the controller shows120minutes. Model/derivative/colour/options are supplied exact facts or explicit unknowns, never parsed from eligibility keys or invented from the scenario name. Monthly cost/allowance retain the pinned points semantics.

`createOfferHttpAdapter()` now defaults to that approved projection. The owned preview's non-fixture entry uses it. HTTPS and exact same-origin no-store/no-referrer/credentialed exchange/read behavior remain; failed exchange asks the user to reopen the original email or use their account, never retaining/replaying its token. An invalid or absent nested projection remains unavailable.

`subscribeClock(listener)` schedules a fresh authoritative read every5000ms, skipping while a request is active. This is a view refresh interval, not a scheme timing assumption or a domain clock: timers cannot decrement remaining time, change a deadline, expire a hold or infer a state. `mountOffer` owns the returned unsubscribe and controller abort; disconnect cancels future work. Host-supplied presenter subscriptions remain supported. Actual server tick/readback and second-browser behavior are still integration gates.

Pending reasons decision-pending/release-pending show uncertainty and disable controls without fabricating an intended decision or operation ID. No106 port is supplied by this HTTP read adapter; a host must inject the actual decision port. The reviewed102 comparison still explicitly reports unavailable/currentCar:null. Root reported published100 `a7fc8580efba36c329b2479711d6b66db53962bd`, but its narrow projection binding is not approved/exercised here.

Selected strict targeted checks passed96/96 with zero skips; exact command, source/input hashes, key and resource receipts are `evidence/fucq105/adapter-scoped.json`. Old80-pass evidence remains the earlier checkpoint. No browser/native/full/live request was run.

## Approved partial comparison extension · a3fdcdf

Root resumed this same chat for display-only binding against immutable FUCQ-102 `a3fdcdfdc7b5d6c0c4f38744101b355ab6359bed`. Independently verified contract SHA-256 `af5fa810a650edd14b99e563ec91d1e1a86c8e28087788c94a826e71e5810042`, representative sample `9a406c67d7785353c941b2ba294593e188e6ef6045bf099fe222a1131f37d884`, comparison sample `e3d8a9065ac85e4088768a27db0cb22b1f4f136b5c6b8f68a960dd5e525ddab6`. Both safe JSON samples are retained exactly in `evidence/fucq105/`. They exercise the access/evaluator over synthetic inputs and reviewed metadata, not an actual100 producer-to-access route.

The comparison accepts only status partial, reason current-car-facts-unavailable, comparisonAvailable false, and exactly the eight reviewed unknown keys. A nonblank model of at most256 characters and source mode synthetic/dated-snapshot/authorised-live, nonblank sourceVersion and valid UTC observedAt no later than quotedAt become a curated partial presentation. UTC validation rejects calendar/hour rollover; fractional future instants also fail. No current configuration, specifications, points, image, internal binding, employee/contract/slot identifiers/revisions, sourceRef or raw records are copied or inferred.

The view reuses heading/text, mediaWell fallback and factList. It clearly labels the comparison partial, shows dated provenance and renders all eight facts Unknown. Invalid/missing/future/unreviewed comparison metadata yields currentCar null while a valid exact offer stays visible. comparisonAvailable always remains false; no106 decision authority is added. Actual full factual comparison remains an acceptance gate.

Scoped own projection/render/HTTP/controller checks pass68/68,0skips under strict targeted key `dce2865f60ebed5a4be446811a91739ab9d91977599a882a43f14e7d0ba6e59f`; full source/input/resource receipts are `evidence/fucq105/comparison-scoped.json`. Shared components, styles and ratchet source are unchanged; their prior proof is reused without unrelated reruns. Rendered1280/375 keyboard/reduced-motion, real100 producer/access, approved106, host/cookie/entry/presenter and authored full-suite gates remain outstanding.

## Verified server action timing · 4a56d38

6 November2026. Root released published102 `4a56d386f031e7cf5a1fdeaefdcc612fb35cbd7b`; remote and exact four hashes were independently read through scaffold helper. Contract SHA1731acc4e8d50873e4f614836626202107c14d581661206ff0e71ef5f48acc88, access SHA134e9d39253e934618f6cf38b334bb7cf0f8912443ee159e6167b949d4fdb34a. Exact safe actual-producer sample hashes are e50f3c56f3df4d3437a6fd2ec91e62fd713e0c1c5a42ce0d44753110a5535080 and c9a63f5b6dacfeb0c3720904ee218c085039903f55a74b551fb463fd70a626f5, retained as producer-access.json and producer-decline-access.json.

Server availableActions are authoritative: eligible aligned active offer/hold exposes accept+decline before quote validity ends, decline-only from quote expiry until the original hold deadline, then none.105 keeps quote validity separate from hold countdown and never calculates new permission from browser time. The existing controller already handles each independent flag and still requires an actual injected decision port. Projection now rejects unsupported accept-only responses. View copy explains decline-only availability and keeps a usable focus target when Accept becomes disabled. No106 port or fabricated success was added.

All73 own projection/controller/HTTP/render regressions pass under strict targeted key9a11cd6977a9eaeec123e61c29c9517e0646e19def5bebbdaa6f22ba86f5f656. Exact sample/metadata boundaries, comparison fallback, no stale car on unavailable access, hold countdown, safe text and decisions absent/contract-spy readback are covered. See evidence/fucq105/timing-scoped.json. No actual producer/access imports occurred; a finite source plan is required before that composition. Browser/native/listener/full/host/deployment/real106 and full factual comparison gates remain open.

## Approved memory composition attempt · 6 November 2026

Root reviewed and approved the exact45-source/eight-overlay producer/access/view plan. Owned test/loader/supervisor identities were recorded before allocation. The first strict targeted attempt failed at loader bootstrap (project guard omitted its own registration entry); no test phase/product module loaded and no strict passing receipt exists. The stop-at-first-failure grant was honored without repair/retry. Independent cleanup and source/dependency audit passed. `evidence/fucq105/producer-proof-result.md` and `producer-scoped.json` retain diagnosis, hashes and resources. Current73-pass consumer source remains unchanged; actual producer-to105 acceptance is still open.

Dispatcher follow-up authorized an owned-helper successor for review. Failed checkpoint `b19bfa6` and its receipts are preserved. Exact loader URL admission/hash verification and explicit `node:` delegation now pass syntax/AST/static source guards; the45 product identities/eight overlays and test body are unchanged. `evidence/fucq105/producer-helper-successor.json` records final hashes/proposed argv. No loader/product evaluation or integration retry occurred. A new root review and execution grant are required before a fresh integration allocation; all acceptance gates above remain open.

## Scoped actual producer/access/view proof · 6 November 2026

After separate root review/grant, the exact helper5f6dab8 executed the approved45-source/eight-overlay composition once: tests1/pass1/fail0/skip0, all seven lifecycle checkpoints. Actual100 allocation/outbox custody, streamed102 exchange,105 controller/shared-card DOM, replay/reconstructed-access cookie-jar reload/account-service parity, real DemoClock quote-expiry decline-only and original hold expiry/released stock, reset/earlier-run and handler refusal/unavailable behavior passed. Current-car facts remain eight unknowns and both controls remain disabled without106. No business state is changed by repeated reads. Strict targeted key6db68bd587762e6c79c02309c198045f5b3710340aefb37bcb154c37f5cf8ee2, executed head5f6dab8/default variant/baseb95b4c8. See `evidence/fucq105/producer-integration-scoped.json` and `producer-integration-result.md` for exact source identities, consistent duplicate hook records, audit correction and independent cleanup. Original failure receipt remains unchanged. This memory HTTP/cookie shim/JSDOM proof leaves actual106/delivered host, full factual comparison, normal browser/email/account-cookie/presenter journeys, rendered1280/375 review, authored full validation and acceptance open. One-run grant consumed; worker parked.

## Planned106 binding and107 reuse · 6 November 2026

Root accepted that scoped proof in `.claude/test-runs/ownership/fucq105-producer-result-0033.json`. The read-only successor plan `evidence/fucq105/decision-host-plan.md` and exact `decision-host-source-plan.json` identify47 existing service/display modules with real106 plus the prospective existing form helper, one access-service instance across both handlers and106, and105-owned quote-revision/reason-input gaps. Canonical accept/refusal can progress independently; successful normal decline needs the policy owner's actual registry adoption. Delivered entry, gated one-offer dispatch, same-origin HTTPS configuration and root122 browser admission are separate concrete prerequisites. No implementation/import/test/allocation is granted by the plan.105 reserves `blocks/gcsp/offer/**`;107 consumes the published b7061e9 projection/view API from its own second-offer wrapper. Exact full refs, hashes, public access quote shape and private stored-quote timing distinctions are in the plan. All acceptance gates remain explicit.
