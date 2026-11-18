# FUCQ-388 validation checkpoint — 18 November 2026

This checkpoint publishes the additive canonical rule and matching Node/Java allocation implementation for review. The original five acceptance items remain authoritative in `_dev/in-progress/DEV-2026-11-16-034.md`. It is not a completed Story, a covering green batch, a deployment or acceptance evidence for the pending composition and visual work.

## Observed scoped checks

Node: **64/64 passed**, one worker, in 29.069 seconds:

```
node --test --test-concurrency=1 server/test/gcsp-decline-reentry.test.js server/test/gcsp-allocation.test.js server/test/gcsp-allocation-decline-index.test.js server/test/gcsp-offer-journey-adoption.test.js
```

These cover the owned allocator, canonical adoption and historical exclusion boundary. Before the repair, the meaningful exact-car regression observed both the rejected diesel and another combustion candidate as eligible after a linked confirmed EV answer; the expected outcome was ineligible for both. A subsequent malformed saved-confirmation regression also failed before the helper guard was added. Tests cover known fuel/body, equipment evidence, strict size improvement, missing/unchanged/unlinked/stale/inferred answers, repeat declines, charging gates, historical policy absence and policy refusal. Their small immutable repository fixtures do not establish the generated-stock or actual HTTP journey acceptance items.

Java: **14/14 passed**, pure compilation/unit checks, in 11.8 seconds:

```
./mvnw -B test -Dtest=gcsp.api.allocation.DeclineReentryTest,gcsp.api.policy.ReviewedDefinitionsTest,gcsp.api.offers.OfferJourneyPolicyTest -DargLine=-Xmx768m
```

This covers the reason resolver, immutable old/successor definition relationship and adoption selection. It also compiled the new test-local OIDC `DeclineReentryHttpTest`; that HTTP test has not yet run. No Java RED run is claimed. No application, listener or PostgreSQL was launched by this pure check.

The additive `offer-journey-v2` retains the old definition bytes and seed. Node opt-in startup selects v2. Java supports explicitly configured v1 and v2; new Java runs require `GCSP_POLICY_VERSION=gcsp-policy-v1+offer-journey-v2`. Explicit historical versions preserve their behavior.

## Remaining original scope

Run the focused Java packages, affected callers/parity and required startup/wiring checks against an owned native PostgreSQL 17 once the shared composition lane is available. Exercise the real signed-token HTTP follow-up and the generated diesel/EV/PHEV controls, recording exact identities, brief versions, blockers and scores. Inspect the actual affected employee states at desktop and narrow widths, obtain independent substantive visual critique, address findings and reinspect. Obtain independent code review and a later covering green batch. Full suites are deferred to the poller's batch; this change introduces no migration, shared test profile, startup thread, CDI producer, Maven or shared application configuration change.

## Local resource receipt

Node receipt: `.claude/poller/run-20261117-2335/resources/f388-node-green-3-20261118T034913Z-e03ffb60-receipt.json` in the shared checkout. Peak child RSS 357,269,504 bytes; owned scratch 3,174,592 bytes removed. Owned process group, scratch and temporary dependency link were verified absent; reservation released. Compact impact evidence: `.claude/test-runs/impact/f388-node-green-3-20261118T034913Z-e03ffb60.json`.

Java receipt: `.claude/poller/run-20261117-2335/resources/f388-pure-unit-smaller-20261118T034738Z-17003d-receipt.json` in the shared checkout. Peak child RSS 791,642,112 bytes; owned scratch 31,277,792 bytes removed. Owned groups, target link and scratch were verified absent; reservation released. Java source/test identity: `bf90c10fc22e1607350afb58802d027f6c6c333b947fe34d1f01641f495c0e0c`; compact impact evidence is keyed by that identity under `.claude/test-runs/impact/`.

Both used bounded local test working data and finalizers. No OneDrive or CloudStorage access occurred. Retained local receipts and bounded logs are diagnostic evidence, not source inputs or completion gates.

## Independent review corrections

Sulley's independent source review of published `82453d85d645c0c8b9e6ca2e8de2d26d079e3c5b` failed four concrete findings. That failed verdict remains part of the evidence; the corrections below are awaiting a review of their own published pin.

1. Resolve the original immutable saved answer through the latest scoped decision and offer, then check the current confirmed semantic value. A later brief head that omits `postDeclineChange`, including pause/resume, no longer discards a valid answer.
2. Choose the latest decline by actual creation time, then linked offer brief version, with stable IDs only as the final tie. Java's frozen simulated decision timestamp and Node's equal-millisecond timestamps cannot silently prefer an older answered decline in the covered repeat.
3. Advance the retained run clock by exactly one millisecond when the successor would otherwise collide with the active policy's publication instant. This publishes no stock tick and preserves retained versions.
4. Complete offer-journey successor adoption after an old employee-experience refresh, so the first successful restart has the canonical rule.

The new Node regressions first observed the lifecycle/order failures (31 tests, 29 pass, 2 expected failures) and retained-adoption failures (17 tests, 15 pass, 2 expected failures). After correction those chunks passed 31/31 and 17/17. A preceding syntax-error run was a harness failure and is excluded from meaningful RED evidence. The test-local Java HTTP fixture now respects consent-held draft autosave and exercises the actual pause-search/resume-search envelope; it has compiled but still awaits its native PostgreSQL/OIDC execution.

Corrected pure Java check: **14/14 passed**, 10.42 seconds, with the same three selected test classes above. Receipt: `.claude/poller/run-20261117-2335/resources/f388-pure-review-fixed-20261118T040623Z-393404-receipt.json`. Code/test identity `7f468c415ceb5e581e71d0e778d7cd9e7dff351dbc31f3a6903aa76991029c7e`; peak RSS 726,335,488 bytes; 31,236,768 bytes of scratch removed. Owned groups, scratch and target link are verified absent and the reservation was released. This supersedes the earlier Java identity for the corrected source without reclassifying that older observation.

Corrected focused Node graph: **99/99 passed**, 49.415 seconds, one worker:

```
node --test --test-concurrency=1 server/test/gcsp-decline-reentry.test.js server/test/gcsp-allocation.test.js server/test/gcsp-allocation-decline-index.test.js server/test/gcsp-offer-journey-adoption.test.js server/test/gcsp-employee-experience-adoption.test.js server/test/gcsp-second-offer.test.js server/test/gcsp-scenario-decline-change.test.js
```

This graph adds the actual runtime adoption caller and second-offer/decline-change boundaries to the owned allocator checks; the full Node suite remains deferred to the covering batch. Receipt: `.claude/poller/run-20261117-2335/resources/f388-node-green-review-final-20261118T040650Z-42a08e5d-receipt.json`; compact measured module/function contexts are retained alongside earlier impact records. Peak child RSS 422,690,816 bytes; 6,676,768 bytes of scratch removed. Code/input identity was unchanged, owned groups, scratch and temporary dependency link were verified absent, and the reservation was released. No OneDrive or CloudStorage access occurred.
