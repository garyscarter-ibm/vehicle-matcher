# Offer display contract and delivery gates · FUCQ-105

5 November 2026. Independent implementation plan; HTTP fields below are requirements for the FUCQ-102 review, not a claim of a published port or live integration.

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
