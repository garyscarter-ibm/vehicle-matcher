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
