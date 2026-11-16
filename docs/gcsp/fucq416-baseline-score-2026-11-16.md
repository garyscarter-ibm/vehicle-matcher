# FUCQ-416 current-car baseline scoring

FUCQ-416 / `DEV-2026-11-13-GC-009` preserves the existing recommendation decision and presentation contracts while reusing current-car preference score components within one employee evaluation. This is a three-point internal computation Story; its authored Node acceptance remains applicable alongside the Angular/Java migration.

## Scope and readiness

The existing `compareImprovement` boundary in `server/gcsp/recommendation/current-car.js` scores the same confirmed current-car facts again for every candidate reaching positive-feedback improvement. `evaluateScopedRecommendation` already captures one cloned provider source, validated policy, employee facts and brief for its candidate loop. That existing interface permits the change without a technical prerequisite or another Story's files.

Only `server/gcsp/recommendation/current-car.js`, `server/gcsp/recommendation/index.js` and the allocated focused tests are product scope. Feedback weights, formulas, Same again rules, policy/version/identity/clock guards, the FUCQ-417 static suitability cache and cross-evaluation or release caching remain outside this change.

## Validation selection

The new service-level multi-candidate regression must count calls to the real baseline scorer and compare complete decisions, explanations and candidate order with the prior uncached comparison path. It also covers evaluation-local lifetime, frozen baseline replay, unknown evidence and lazy inactive paths. The two authored validation modules cover the current-contract projection and existing feedback semantics.

Selected commands, run serially in one finite allocation:

```sh
node --experimental-vm-modules --test --test-concurrency=1 server/test/gcsp-current-car-baseline-cache.test.js
node --test --test-concurrency=1 server/test/gcsp-current-car-comparison.test.js
node --test --test-concurrency=1 server/test/employee-recommendation-feedback.test.js
```

The VM flag supports test-local wrapping of the existing scorer; it adds no production instrumentation. No full suite, database, browser or deployment check is needed for this isolated boundary. The Story's `validate` expressly exempts isolated internal computation from new screenshots. Rendered release/offer/history campaigns are not added to this Story; no screen, response shape, visible copy or user action is intended to change. The applicable reference remains `docs/gcsp/screens/README.md`, approved body reference `a7fc178` in `COMPONENTS.md`, and `docs/gcsp/experience-quality.md`.

## Current evidence

Source preparation and lead diff review are complete. `createCurrentCarBaselineScorer` closes over this evaluation's baseline and scoring inputs, computes components on first use, and reuses them for its remaining improvement comparisons. The supplier belongs to the local feedback context; a new employee evaluation or quote replay creates a new supplier. The existing `compareImprovement` fallback still computes directly for callers that do not supply it. No response fields or rendering code change.

The new five-case module uses test-local VM imports to wrap the real `scorePreferences` function in both source modules. Its uncached reference drops the supplier before calling the same real comparison implementation. The multi-candidate case expects one baseline computation against three in the uncached reference, identical complete results, provider decision order `[1, 2, 3, 4]`, and recommendation order `[4, 1, 2]`. The remaining cases cover nine inactive/lazy variants, repeated/changed/concurrent inputs, unknown facts, and frozen quote replay with the existing static suitability cache retained. The two existing test modules are unchanged. Static expected counts are 5 new + 21 current-contract + 16 feedback = 42 tests, with no subtests or expected skips.

The first and only allocation passed all 42 selected tests: new cache regression 5/5, current-car comparison 21/21, and feedback 16/16, each subprocess return code 0 with no failures, cancellations, skips or todos. Explicit TAP reporting retained the original subprocess return codes before strict count parsing. Lead review found the assertions cover the original acceptance criteria; complete cached/uncached response equality preserves the existing presentation data, unknown/rating/Same again behaviour and explanations. No product source changed after the tested checkpoint.

Tested source is `aa1e8cc1acdd1f5ee8a88352f83d41f5a77e64fb`, tree `fdaeae0301854cfe1531c601634a250dd2fa0675`, on `dev/DEV-2026-11-13-GC-009`; the claimed base is `db6ad821a`. Shared integration, publication, Jira, claims and archive actions remain with the dispatcher. Development completion is separate from collaborator acceptance.

## Runtime ownership and retained evidence

The dispatcher granted one run adapted from the existing successful FUCQ-411 a05 Node recipe. The supervisor asserted the exact approved source identity, pinned 899 source/runtime/dependency inputs, and copied 868 files (20,217,756 bytes) into the owned frozen project. Both original and frozen content checks passed. The selected tests used one worker, owned `HOME`/temporary/cache paths, and no install, database, browser or deployment process.

The allocation's limits were 805,306,368 bytes disk, 1,342,177,280 bytes RSS, 2,147,483,648 bytes inclusive, a 5 GiB free-space reserve, 480 seconds work and 600 seconds total including cleanup, and 2 MiB whole retained output. Independent wall/monotonic deadline checks and the existing watchdog/finalizer covered the run. Sampled observations were 22,399,744 bytes disk, 276,103,168 bytes RSS and 298,498,816 bytes inclusive. Work took 4.651 seconds and total runtime 5.849 seconds; minimum observed free space was 172,765,274,112 bytes. These are sampled measurements, not proof of continuous containment or absence before observation.

The supervisor stopped and joined its owned processes, checked all pinned content, removed `/private/tmp/gcsp-f416-20261116-a01` and released its canonical reservation. Its strict result is true with no monitor or cleanup errors. A separate lead audit at `2026-11-16T21:35:53.187307+00:00` verified the supervisor, all 42 observed PID/start identities and three test process groups absent, the exact scratch root absent and reservation absent. No setup attempt failed, and no passed test was replayed for bookkeeping.

Retained local evidence is under `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq416/a01/`: `plan.json`, adapted `run.py`, external `ownership.json`, `pins.json`, three exact TAP logs, `checkpoint.json`, compressed process history, `receipt.json` and `lead-audit.json`. Receipt SHA-256 is `3a6e10dd98fd61ad9c0c20588316a007ce377e198c9ab37d709545248d99e475`; the pin manifest identity is `7bc65a01efb0ba56a37b4d150d6640f2bb02afc6312f6d5351ef363abbded48d`. The receipt measured 262,592 retained allocated bytes before this final note/impact/audit update; the final bounded output audit is retained alongside it.

The dispatcher's independent audit at `2026-11-16T21:37:04.714519+00:00`, retained in `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/fucq416-parent-audit-2130.json`, rehashed all 899 original pinned inputs (111,693,668 bytes), matched all 42 passing results and verified all 42 historical identities, four groups, root arguments, token environment, exact scratch root and reservation absent. This supplies an independent content rehash; the sampling/continuous-containment limitation remains.

All local work honours the explicit OneDrive prohibition in `AGENTS.md`; no OneDrive location is accessed or used for outputs. Any later validation receipt must distinguish sampled resource observations from continuous containment and retain failed or unrun checks honestly.

## Agents

Cool Cat 2 is the Story lead, requested/selected `gpt-6.1-sol` / `high`, thread `01a1e641-123c-7722-997e-049e9daf7820`. Hugo 2 is the source implementer, requested/selected `gpt-6.1-sol` / `medium`, thread `01a1e642-bc0d-7373-8f5d-0837438aa6dc`. No fallback was used. Both desktop titles and effective `turn_context` model/effort pairs were verified on 16 November 2026. Hugo 2 has no descendants or runtime allocation; Cool Cat 2 ran the exact granted checks directly. Worker claims expire when their respective work returns.
