# FUCQ-416 current-car baseline scoring

FUCQ-416 / `DEV-2026-11-13-GC-009` preserves the existing recommendation decision and presentation contracts while reusing current-car preference score components within one employee evaluation. This is a three-point internal computation Story; its authored Node acceptance remains applicable alongside the Angular/Java migration.

## Scope and readiness

The existing `compareImprovement` boundary in `server/gcsp/recommendation/current-car.js` scores the same confirmed current-car facts again for every candidate reaching positive-feedback improvement. `evaluateScopedRecommendation` already captures one cloned provider source, validated policy, employee facts and brief for its candidate loop. That existing interface permits the change without a technical prerequisite or another Story's files.

Only `server/gcsp/recommendation/current-car.js`, `server/gcsp/recommendation/index.js` and the allocated focused tests are product scope. Feedback weights, formulas, Same again rules, policy/version/identity/clock guards, the FUCQ-417 static suitability cache and cross-evaluation or release caching remain outside this change.

## Validation selection

The new service-level multi-candidate regression must count calls to the real baseline scorer and compare complete decisions, explanations and candidate order with the prior uncached comparison path. It also covers evaluation-local lifetime, frozen baseline replay, unknown evidence and lazy inactive paths. The two authored validation modules cover the current-contract projection and existing feedback semantics.

Selected commands, run serially once finite runtime ownership is granted:

```sh
node --experimental-vm-modules --test --test-concurrency=1 server/test/gcsp-current-car-baseline-cache.test.js
node --test --test-concurrency=1 server/test/gcsp-current-car-comparison.test.js
node --test --test-concurrency=1 server/test/employee-recommendation-feedback.test.js
```

The VM flag supports test-local wrapping of the existing scorer; it adds no production instrumentation. No full suite, database, browser or deployment check is needed for this isolated boundary. The Story's `validate` expressly exempts isolated internal computation from new screenshots. Rendered release/offer/history campaigns are not added to this Story; no screen, response shape, visible copy or user action is intended to change. The applicable reference remains `docs/gcsp/screens/README.md`, approved body reference `a7fc178` in `COMPONENTS.md`, and `docs/gcsp/experience-quality.md`.

## Current evidence

Source preparation and lead diff review are complete. `createCurrentCarBaselineScorer` closes over this evaluation's baseline and scoring inputs, computes components on first use, and reuses them for its remaining improvement comparisons. The supplier belongs to the local feedback context; a new employee evaluation or quote replay creates a new supplier. The existing `compareImprovement` fallback still computes directly for callers that do not supply it. No response fields or rendering code change.

The new five-case module uses test-local VM imports to wrap the real `scorePreferences` function in both source modules. Its uncached reference drops the supplier before calling the same real comparison implementation. The multi-candidate case expects one baseline computation against three in the uncached reference, identical complete results, provider decision order `[1, 2, 3, 4]`, and recommendation order `[4, 1, 2]`. The remaining cases cover nine inactive/lazy variants, repeated/changed/concurrent inputs, unknown facts, and frozen quote replay with the existing static suitability cache retained. The two existing test modules are unchanged. Static expected counts are 5 new + 21 current-contract + 16 feedback = 42 tests, with no subtests or expected skips.

No test, parser check, build, proof, dependency copy or runtime scratch allocation has started. Acceptance remains unchecked until the selected runtime evidence is reviewed. The dispatcher owns shared integration, publication, Jira, claims and archive actions.

All local work honours the explicit OneDrive prohibition in `AGENTS.md`; no OneDrive location is accessed or used for outputs. Any later validation receipt must distinguish sampled resource observations from continuous containment and retain failed or unrun checks honestly.

## Agents

Cool Cat 2 is the Story lead, requested/selected `gpt-6.1-sol` / `high`, thread `01a1e641-123c-7722-997e-049e9daf7820`. Hugo 2 is the source implementer, requested/selected `gpt-6.1-sol` / `medium`, thread `01a1e642-bc0d-7373-8f5d-0837438aa6dc`. No fallback was used. Both desktop titles and effective `turn_context` model/effort pairs were verified on 16 November 2026. Hugo 2 has no descendants or runtime allocation.
