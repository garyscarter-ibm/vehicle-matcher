# FUCQ-68: order choices evidence

The grouped setup reads trusted scheme, driver, contract and collection context, saves complete draft choices, and refreshes availability against the saved draft/context versions. It uses the existing account HTTP seam, PolicyService and repository port. Events are navigation hints; server session/context remains authority. No stock is reserved by browsing or saving.

## Frozen functional proof

Captured 5 November 2026 at source `0a4ff5ac1e261a42794d040753fb0e98cc23039e`, integrated executable base `90743eed6a086aa8626a3c4ab089d10f6f65b75e`. [Flow matrix](flow/results.json) and [state matrix](states/results.json) include source and PNG SHA-256 hashes. All 16 captures were personally inspected by the story lead against the approved body reference revision `a7fc178`, supplied shell screenshots00/01, experience contract and shared catalogue.

These captures precede the subsequently approved default Density theme. They retain the completed functional proof; current-theme verification below supplies the final rendering evidence.

| Captures | Desktop and 320px cases |
|---|---|
| `flow/01` to `flow/06` | Account Replace, invalid summary focus/link, complete saved replacement, visible changed-choice invalidation |
| `states/01` and `states/06` | New order has no old-car or return-mileage requirement |
| `states/02` and `states/07` | Nominated driver, disabled term/location combinations and closed collection date/location |
| `states/03` and `states/08` | Long account/model/driver names, absent contact and unknown source-owned licence/eligibility |
| `states/04` and `states/09` | Source failure retains local choices and supplies recovery |
| `states/05` and `states/10` | Stale draft retains edits until explicit discard/load-newer recovery |

The flow also asserts Back → reload → Resume persistence, unchanged current car, native select typeahead (`y`, then Tab), native date segments (four Tab presses reach location in this Chrome build), duplicate Continue suppression, exact six-field setup-ready hints, and refreshed versions after changing driver, term, requested date and location. All captures report associated labels and no horizontal overflow. Native select/input values can truncate or scroll within the control at 320px; the page content remains readable. Focus, error summary links, allowance units, source caveat and the requested-date caveat were inspected. There are no unexpected HTTP/console errors, page errors or external requests. Expected initial draft404, injected source503 and stale-version409 are recorded explicitly.

## Current default Density proof

After guarded integration of approved shared base `73bf1f169a71b735fe738ec5ebdc927c35bd0c7b` (including default-theme change `3895eff`), [theme results](theme/results.json) captured source `0af91304d5e0dff516ff3a9aa7d1954e492a2076`. The eight current renders show invalid summary, keyboard field focus, a saved replacement and long/unknown source facts at 1280×900 and 320×740. The story lead personally inspected all eight; no screen correction was needed. The executable delta affects shared CSS/fonts, so the unaffected functional service traces above are retained with their original identities.

The local WOFF2 resource was requested and `document.fonts` reports BMW Group TN Condensed Pro Medium loaded at weight 500. Large titles resolve to that family at 40px desktop / 32px narrow. Actual primary/page colours are `rgb(3,116,147)` / `rgb(245,246,246)`, radius 2px and action height 48px. The header is 56px desktop and 57px narrow: 56px is the shared minimum; the existing 44px menu, padding and border set the narrow height. Desktop navigation is 48px. Scroll widths equal the actual 1280/320 CSS viewports. Keyboard focus is a 2px solid `rgb(2,145,183)` outline. Computed contrast ratios are primary text 5.353:1, body 14.591:1, muted text 7.053:1, focus/white 3.661:1 and focus/page 3.381:1. These selected checks do not constitute a full accessibility audit.

Repeat this qualification with the same bounded command below, `--chunk theme`, and the actual source/base identities. Theme-v2 completed its assertions with exit 0 in 7.92s at 1,350,451,200B peak RSS and 9,584,953B scratch. The first theme attempt stopped at a capture assertion expecting the narrow header to equal its CSS minimum; the correction records existing geometry and changes no product code. Both attempts' immediate supervisor group checks were unresolved; they are not accepted as cleanup proof. Subsequent independent inventory proves all owned groups and sampled PIDs absent, scratch/profile/root arguments absent, listeners closed and tokens released (`final-cleanup-1793896105957351000-receipt.json`, all 27 allocations). All 24 retained PNGs total 4,953,692B, below 12MiB.

## Repeat and reset

Run from the story worktree. The checked-in [capture helper](capture-fucq-68.mjs) composes `createGcspRuntime({mode: 'memory'})`, a canonical local employee session, `ManualContextService` and the real `buildServer` HTTP handler behind one ephemeral same-origin loopback listener. Each scenario creates fresh isolated runtime state; closing/re-running resets it. Source variations use the repository/PolicyService seam. No URL, browser event, cookie text or scenario name is treated as authority. Cookies are synthetic and are never recorded.

A generic static server alone cannot provide the account/manual API or persistent draft proof. The capture helper requires system Chrome and the existing bundled `playwright-core` path recorded in its source. It also requires supervisor-owned `TMPDIR` plus explicit source/base provenance. On this machine the bounded repeat commands are:

```sh
python3 -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq68/lead-supervisor.py command --owner runner --name browser-flow-repeat --command 'FUCQ68_HEAD=0a4ff5ac1e261a42794d040753fb0e98cc23039e FUCQ68_BASE=90743eed6a086aa8626a3c4ab089d10f6f65b75e node docs/gcsp/evidence/fucq-68/capture-fucq-68.mjs --chunk flow'
python3 -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq68/lead-supervisor.py command --owner runner --name browser-states-repeat --command 'FUCQ68_HEAD=0a4ff5ac1e261a42794d040753fb0e98cc23039e FUCQ68_BASE=90743eed6a086aa8626a3c4ab089d10f6f65b75e node docs/gcsp/evidence/fucq-68/capture-fucq-68.mjs --chunk states'
```

Use the actual checked-out source/base identities for a new run, archive existing matrices before a repeat, and do not relabel these original captures as a later revision. The helper blocks every nonlocal network request. Its synthetic clock is 5 November 2026. To walk through equivalent UI interactions in a composed local demo: open account, choose Replace, Continue with missing required choices, follow a summary link, choose self or nominated driver and an allowed term/location, request 20 November 2026, enter replacement mileage, then Save/Continue. Back/reload/Resume retains choices. Change an eligibility choice to see stale availability disappear; Save refreshes it. New orders omit return mileage. The helper's isolated source cases demonstrate closed 20 November, long/unknown facts, an unavailable source, and another writer's newer draft.

## Assumptions and boundaries

`server/gcsp/policy/seed-v1.json` is the single source: `manual.context.v1` supplies explicitly synthetic combinations, licence/collection rules and BMW-only support; the October 2024 eligibility mapping and `getAllowance` supply the monthly points gate. Paula's 1300 points/month is labelled synthetic with provenance. Top-up keys remain unused; there is no guessed points-to-cash conversion, contribution acceptance or policy-confirmation gate. HR/licence facts remain read-only with a support route. The requested date is distinct from availability and a confirmed appointment. No repository migration, stock claim, lifecycle, transport or other-provider behavior is added.

## Checks, resources and limits

Lead independent scoped checks passed: setup/controller/render 22/22; affected account/shell/ratchet 92/92; post-90743eed shell/ratchet 72/72 (overlapping scope, not an additive total). Slice 1 setup/manual 41/41 passed independently. Current default shell/ratchet checks passed 77/77. The story still requires exact `npm test` with same-process strict MATCH after final integration; no full-suite result is claimed here yet.

Every browser attempt used the external bounded supervisor and HostBudget ownership manifest:120s, 2560MiB RSS (minimum 2048), 128MiB scratch, 2MiB logs. Flow-v2 passed in 9.44s at 1,373,667,328B peak RSS/9,695,343B scratch; states-v2 in 12.30s at 1,421,950,976B/9,658,713B. Combined PNG size is 3,216,216B, below 12MiB. The first flow attempt stopped on a capture-harness ArrowDown/Enter assumption; only the native-select capture interaction was corrected, and the failed matrix remains in external records. The earlier five-module scoped chunk exceeded 768MiB and was stopped/cleaned; split checks passed. These are retained as historical attempts, not product regressions or passing claims.

External records under shared `.claude/test-runs/fucq68/` hold all plans, logs, versioned attempt matrices, RSS checkpoints, visual-inspection receipts and independent cleanup. `browser-runner-independent-cleanup-final.json` covers all three original browser attempts: owned groups/sampled PIDs absent; profile/scratch/root arguments absent; listeners 58627/58815/58885 closed; all tokens released. Package/lock hashes stayed unchanged. Retained root/server dependencies are 27,138,292B/858,816B. OneDrive export was unavailable; bounded local evidence is retained. No native PostgreSQL proof is claimed (`GCSP_DATABASE_URL` absent).

Requested/selected/effective models: story lead `gpt-6.1-sol/high`, implementer `gpt-6.1-sol/medium`, browser runner `gpt-6-luna/high`; no fallback. Independent session metadata observations are in `agent-settings-observed.json`.
