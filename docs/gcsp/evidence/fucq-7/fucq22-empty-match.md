# FUCQ-22: complete empty retail matches

5 November 2026. Source checkpoint `9233760a2f1742ae4e43ebc682da6bb631ba2fdb`; Node v26.7.0, configured retail blend unchanged (default TASTE_SHARE 0.2). This evidence retains the original FUCQ-7 destination required by the Story; filenames identify FUCQ-22.

The FUCQ-8 [original probe](reuse-probes.mjs), its [assessment](../../engine-reuse-assessment.md) and closed prerequisite FUCQ-21's [correction record](retail-compat-corrections.md) establish the origin. The cause remains present on claimed base `8bebc3b1c13a6e5c97bfab178e48ab16179c01f9`: `matchCars` omitted `alternatives` when no ranked cars survived. `handleMatch` called `alternatives.map` during enrichment outside the stock-fetch catch, rejecting without completing HTTP. Empty stock and a nonempty pool wholly excluded by the existing budget hard filter enter the same branch.

The repair adds only `alternatives: []` to that engine branch. Scoring, eligibility, weights, selected listing facts, nearby behaviour and API error conventions are unchanged. No data/cache repair or policy assumption is needed. No UI or shared component changes are needed: the existing results/status controls become reachable through normal completed responses.

This is an intentional corrected R1 outcome, separate from the frozen retail compatibility baseline: a successful empty envelope and completed HTTP 200 replace the historical rejection/hang. The frozen successful nonempty cases and FUCQ-23 exact-member decisions remain unchanged. The baseline never treated the hang as expected output and has not been rewritten.

The test-first scoped command was:

```sh
node --test --test-concurrency=1 server/test/api.test.js server/test/engine.test.js
```

Before repair it ran 90 tests: 86 passed and four failed. Both HTTP cases reported `Cannot read properties of undefined (reading 'map')`; both complete engine-envelope assertions identified missing alternatives. After repair all 90 passed. The bounded HTTP regressions require an actual 200 and exact body, including empty `matches`, `alternatives`, flags, funnel and `unmet`. Their one-second AbortSignal is a failure guard, never an accepted no-match outcome. The Node test runner also fails unhandled rejection. Existing injected stock tests retain 502/500; the 502 case explicitly rejects a `matches` no-car claim.

The [browser script](fucq22-browser.mjs) serves the actual `block.html`, production ES modules/styles, and real `buildServer` with small synthetic empty/over-budget fixtures. Nearby, enrichment, directory and location are inert injected adapters. It launches one isolated headless Chrome context, opens pages sequentially, and rejects all external origins. The script needs the existing Playwright developer tool; `PLAYWRIGHT_MODULE` may identify its package.json. It adds no application dependency.

To replay, run the browser script under a supervisor with owned TMPDIR/TMP/TEMP, one browser, 180 seconds, 64 MiB scratch and 1 GiB aggregate descendant RAM. It writes the ten named PNGs and [machine observations](fucq22-browser.json) here, and closes its own browser/context/servers. `FUCQ22_SOURCE` records the tested revision. Reload/remount resets the public brief; stock/retry state is fixture-local and disappears on exit. No external credentials or runtime providers are used.

The successful replay observed four normal HTTP 200 responses and two injected 502s, zero page errors, zero external requests, and only expected 502 resource console errors. At 1440×1000 and 390×844, the lead personally opened every retained PNG below. Typography, existing component spacing, narrow wrapping, focus outlines and the clear recovery actions are usable; no document horizontal overflow occurs. Reduced motion was enabled. The loading skeleton clears after normal completion; keyboard Tab/Enter reaches **Tweak my answers**, opens the existing answer screen, and reaches **Try again** after an outage. Retry then reaches a normal empty result. The change-answers captures show the existing transient preview skeleton, independently of the completed result request.

| State | Desktop | Narrow |
|---|---|---|
| Deferred match loading | [capture](fucq22-loading-desktop.png) | [capture](fucq22-loading-narrow.png) |
| No match, keyboard focus on changing answers | [capture](fucq22-no-match-keyboard-desktop.png) | [capture](fucq22-no-match-keyboard-narrow.png) |
| Existing answer editor reached by Enter | [capture](fucq22-change-answers-desktop.png) | [capture](fucq22-change-answers-narrow.png) |
| Feed outage, keyboard focus on retry | [capture](fucq22-outage-retry-keyboard-desktop.png) | [capture](fucq22-outage-retry-keyboard-narrow.png) |
| Retry recovered to normal empty result | [capture](fucq22-retry-recovered-desktop.png) | [capture](fucq22-retry-recovered-narrow.png) |

Two earlier browser harness attempts were stopped and cleaned honestly: an incomplete deep-link brief remained at intro; same-document navigation after editing did not remount the outage scenario. Correcting those fixtures required no product change. Their bounded failure logs remain in shared test-run ownership; successful captures above replace incomplete captures.

Resource receipts and selection evidence are retained outside disposable scratch under the shared checkout's `.claude/test-runs/ownership/fucq22-*.json` and `impact/fucq22-empty-match-plan.json`. Successful browser peak aggregate descendant RSS was 932,773,888 bytes, wall 1.883 seconds, and owned profile/TMP peak 6,975,612 bytes removed. All eleven observed owned descendants, process groups, reservation token and exact scratch root were absent at teardown. The profile is the bounded local browser compatibility exception. No archive, large output, deployment, foreground interaction or OneDrive allocation was needed. The single admitted combined-base full suite is complete: [full validation](fucq22-full-validation.json) records 825 total, 823 passed, zero failed and two unconfigured live PostgreSQL skips. It ran the required npm-test-equivalent command with `--test-concurrency=1` before the pattern. Peak RSS was 340,099,072 bytes, wall 33.591 seconds and scratch peak 245,600 bytes. The strict default stamp matches before and after final metadata, with one actual test-file worker observed in 116 samples. The exact successful full-log directory was removed after retaining this summary.
