# FUCQ-31 shared kit review and validation

Story DEV-2026-11-04-051, branch `dev/DEV-2026-11-04-051`. Final product source `29c5af45e417813457d26c5900fdf9b8c0bfd37e`, including shared base `36aea8b4850e11187eab2e24af3430ca970817e4`. Validation date: 5 November 2026. All story functional and rendered gates passed on this source.

## Scope and references

Existing card, media, fact, question and preview helpers accept additive explicit display data, typed terms and caller-owned callbacks. The single `components.html` gallery demonstrates both consumers. Legacy retail signatures, defaults, visibility, modes, purchase prices, odometer and dealer labels remain covered. Employee page composition, persisted briefs/offers and live BMW integration are outside this story.

Shell/palette reference: `docs/gcsp/screens/README.md`. Body reference: `a7fc178`, approved by Gary Carter on 5 November 2026 and recorded in `docs/gcsp/evidence/fucq-6/README.md`. The lead inspected its desktop and narrow captures directly. Points-only terms, disabled Reserve with a visible reason, representative imagery and a clear synthetic-data boundary are retained.

## Component result

The employee snapshot is generated through actual FUCQ-29 `createEmployeeRecommendationService` / `rankCars` and canonical `PolicyService`, using synthetic exact stock. A contract regenerates and compares the entire fixture, including policy/fact provenance. The client introduces no competing active policy defaults.

`matchCard`, `previewTile`, `listingsOf` and `mediaWell` retain retail adapters and accept an explicit exact-member view. Selecting a member updates facts, typed terms, decisions, media and actions together while preserving the focused picker. Accept/reserve actions fail closed without an eligible exact decision and callback; gallery Reserve stays disabled with its preview reason. Missing and unknown values remain explicit; stale image errors cannot remove a replacement image's caption.

Question helpers accept explicit values, units and callbacks without mutating caller input or emitting mount defaults. Position, importance zero and explicit indifference remain distinct. Legacy mount defaults and callback ordering remain covered. Injected preview loading snapshots requests, suppresses stale success/failure/cancel responses, and keeps transport and saved-state ownership with the caller. The gallery labels its display snapshot unchanged and not recalculated.

CSP checks cover shared imports and gallery: no inline script bodies/handlers, eval, new Function or string timers. Catalogue and ratchet coverage include the new stylesheets, with no existing debt or cap increase. Retail stylesheet cap decreased from 4535 to 4534.

## Integration and visual corrections

Source checkpoints were `d7993e9` (cards/typed terms/canonical fixture), `9e28d33` (controls/preview/narrow heading), `e59e301` and `c43daa4` (selected-state styling). Queue-only base `0cb78ad` entered through `35a9d8c`. Dispatcher then requested the product base `36aea8b`; final checkpoint `29c5af4` integrates it and fixes picker transition contrast.

The outbox integration conflicted only in catalogue cap prose and the ratchet stylesheet list. Both shared-kit and presenter entries were retained, including every cap/debt decrease. Both employee-kit and messageList gallery examples remain. No behavioural conflict or additional scope decision was needed; external DEV-062 source was preserved.

The early rendered gate (`early-fucq31-review.json`, source `d7993e9`) exposed a squeezed long heading at 320px; it now wraps below the score. Later captures exposed selected fill being overridden by GCSP ghost-button CSS; a scoped explicit-card rule restores the accent fill. The c43 browser run then caught transient white-on-white text during keyboard switching: inherited background animation lagged behind the foreground color. Explicit pickers now transition only the border, so foreground and background change together. These are product corrections, and final validation follows the last correction.

## Automated validation

All required commands were repeated after source integration and the contrast correction, with working code identity `58cf2ee46c4f0d0cb5c9047afab7693af9c07970f025adc48dcf8776ee1005cf` (committed as `29c5af4`):

| Command | Result | Supervised wall |
| --- | --- | --- |
| `node --test server/test/shared-kit-contracts.test.js` | 15 passed, 0 failed | 1.4s |
| `node --test server/test/render.test.js server/test/ui-ratchet.test.js` | 59 passed, 0 failed; six retail brands/five modes and all eight stylesheet caps | 5.4s |
| `npm test` | 954 total, 952 passed, 2 skipped, 0 failed | 12.9s |

The two skipped tests require `GCSP_DATABASE_URL`: native PostgreSQL constraints and the PostgreSQL transaction-repository contract. It is unset; no live PostgreSQL integration is claimed.

Full stamp `3cfeff6ab1d986b61c5d2e9054be72ec0fa27f282c6ee223fe6a7e43d38ae571`, variant `default`, records product source `29c5af4`, tree `63bba1efd90069dcbdbe4b2f589cb3635b92eb45`, at 11:02:56 UTC. The generic stamp parser does not parse Node test counts; [fucq31-validation.json](fucq31-validation.json) retains actual counts, the unmodified stamp, execution identity, log paths and resource measurements. Final documentation/evidence paths are T0 and preserve the matching source stamp. The earlier c43 full suite (929 passed, 2 skipped) is historical and superseded.

Additional implementation checkpoints passed 77/77 for card/exact/CSP/ratchet contracts, 87/87 for controls/preview cancellation/CSP/ratchet, and 67/67 after selection styling. They supplement the current final full suite.

Setup initially stopped before test execution because declared `pg` was missing in the isolated worktree. The approved locked dependency was installed with `npm ci --prefix server --ignore-scripts --no-audit --no-fund` (14 packages); manifests and lockfiles were unchanged. Node rejects `--test-concurrency` in NODE_OPTIONS, and appended flags after the npm script's file pattern become filenames; two preflight probes ran no tests. The required exact default-concurrency `npm test` ran under a 4GiB ceiling, after headroom and exclusive host-reservation checks.

## Rendered review

The [combined browser receipt](fucq31-browser-review.json), [gallery receipt](fucq31-gallery-review.json) and [retail receipt](fucq31-retail-review.json) record **28 final screenshots**, product source `29c5af4`, zero defects, zero console/page/failed/external errors and clean runner exits. Actual `PORT=31431 npm run serve`, isolated headless system Chrome, desktop 1280px and narrow 320px were used. Retail stock/matching ran through a real local fixture HTTP API on 31432; local BMW/MINI images are representative fixture images, not exact-stock photographs. No user tabs, credentials or live BMW systems were used.

Gallery checks cover coherent eligible/ineligible/confirmation-needed exact facts, gate/unknown reasons, caption/media fallback, disabled Reserve reason, callback feedback/undo, existing exact-listing/old-backend/refinement examples, typed terms and the injected unchanged preview. The selected picker has 6.07:1 text contrast immediately after keyboard selection and after settling; unselected text is 7.19:1, with a distinct 6.07:1 selected/unselected background. Native focus stays on the selected picker. Home changes importance 50 to 0 while still considered; explicit indifference disables both sliders while retaining 0; restoring consideration preserves 0. Focused native-slider crops visibly show the thumb ring at both widths. Reduced-motion picker and slider thumb report no animation and 0s transition. The merged messageList example retains four sent/retrying/failed synthetic rows and its sandboxed local email, without horizontal overflow.

Retail matrix: BMW questionnaire, swipe, head-to-head, podium and Guess Who at both widths, plus MINI questionnaire at both widths. The BMW questionnaire was driven through native budget/mileage/options to an actual HTTP200 match result showing GBP purchase price, 15,000 miles, Grassicks BMW and loaded local representative imagery. The lead directly inspected final employee card/control desktop and 320px captures, the selected ineligible320 state, focused sliders at both widths, messageList at both widths, the actual retail result pair and representative adjacent swipe/bracket/podium/Guess Who/MINI captures against the approved references. Text, long names, missing imagery, state hierarchy and layout are readable; no new visible defect remained.

Known existing limitation: Guess Who's 320px internal stage has 4px extra width on both `29c5af4` and a direct `7e741b4` git-show overlay using the same browser/API fixture. Document, body and main fit 320px; stage overflow is visible and no content is clipped. This story preserves that behaviour. The historical blocked-image Guess Who pair and compact `fucq31-retail-interim-receipt.json` retain fallback evidence; all earlier evidence is labelled with its own source/supersession.

Harness corrections were kept separate from product findings: waiting for the injected loader's debounce; excluding the new stylesheet from a git-show baseline that predates it; checking TCP LISTEN sockets rather than TIME_WAIT bindability; excluding intentionally visually-hidden accessibility labels from clipping assertions; and using the actual focused-slider screenshots because Chromium's pseudo-element computed-style API reports no thumb shadow despite the visible ring. Final runs pass after those corrections.

## Resources, cleanup and agents

Owned scratch is `.claude/test-scratch/fucq31/`. The configured large-output destination `/Users/garycarter/Library/CloudStorage/OneDrive-IBM/Claude` was unavailable; no large output was created or alternate destination invented. Small bounded logs and captures use owned local scratch/evidence. Targeted commands use 120s, 128MiB scratch and 768MiB RSS limits. Full commands use 600s, 128MiB scratch and a 4GiB RSS ceiling, with bounded logs and host reservations.

Current full-suite peak RSS was **1,710,194,688 bytes** (~1.59GiB), scratch **898,144 bytes**. Lead independently verified its owned root absent, process group 85789 dead, reservation released and matching stamp status. No parallel suite or browser allocation ran during it. The final [independent cleanup audit](fucq31-resources.json) checked 32 ownership manifests and 29 unique process groups: every owned disposable root and profile is absent, every recorded process group is dead, ports 31431/31432/31433 have no LISTEN sockets and no own host reservations remain. No residual disposable directories or cleanup failures remain.

The early browser supervisor used the default `/private/tmp/test-stamp-shard-*` root; it was owned, removed and independently verified absent. Final browser disposables are confined to `browser-final`. Final gallery/retail peaks were 317,095,936  / 534,659,072 bytes RSS and 33,281,388  / 29,129,324 bytes owned scratch plus evidence, within 600s/256MiB/1536MiB/2MiB-log bounds. Useful small scripts, checkpoints, ownership manifests, historical harness/failure evidence and bounded logs remain under the ignored task scratch parent; removed temporary roots and retained metadata are distinguished in the cleanup receipt. Exact retained helpers include `lead/run_validation.py`, `lead/audit_cleanup.py`, and `browser-final/{capture-final.mjs,fixture-api.mjs,baseline-overlay.mjs,run-browser-final.py,test_resources.py}`. Logs, source stamps and ownership manifests remain in their named validation/supervisor subdirectories.

Requested/selected/effective pairs: lead `gpt-6.1-sol` / `high`; cards/controls implementer `gpt-6.1-sol` / `medium`; early/final browser runner `gpt-6-luna` / `high`. Effective settings were verified in session turn_context. No fallback; capacity was checked before dispatch, one child at a time. Latest runner resolver remains Luna/high.

Commits used named task paths and the Codex trailer. Dispatcher authorised an isolated process-local scaffold Git adapter for this story branch, guarded by exact branch/claim, local identity, lock and staged-file checks. It preserves configured remotes and uses ordinary guarded push. No force push, shared-checkout merge, story closure or claim release was performed by this story lead. Jira sync was skipped because Atlassian MCP is disconnected.

## Repeatable shared-kit trial

Run `npm run serve` from the repository root and open `http://localhost:3000/components.html` (or the printed local port). The employee gallery needs no API or credentials. Refresh resets every local example.

1. Find **Exact employee decisions**. Read the synthetic FUCQ-29/policy boundary, monthly points cost and allowance, exact facts, representative-image caption and disabled Reserve explanation.
2. Tab between **Eligible exact car**, **Ineligible exact car** and **Needs confirmation** exact-car choices and press Enter. The same card must update its name, facts, terms, reasons, imagery and gate together while focus stays on the chosen button. Missing images/data stay explicit. Reserve remains disabled.
3. Activate **Not this one**, then **Undo local feedback**. The nearby status describes a local effect; nothing is saved or reserved. Inspect the loading, no-match and unknown examples below.
4. Find **Preference, importance and indifference**. Change the native position slider, then set importance to zero with Home. Its status still says the preference is considered. Select **I am indifferent**; both sliders disable. Select **Consider this preference**; zero is preserved.
5. Activate **Load unchanged display snapshot**. Observe the loading state and then the explicitly unchanged decision. These controls do not recalculate this result.
6. Repeat at 320px and desktop width with keyboard focus visible and reduced motion enabled. The long vehicle name must remain readable, without horizontal overflow. Adjacent retail cards continue to use purchase price, mileage and dealer labels.

This is a reusable-component trial. It does not demonstrate employee page composition, a saved brief, a reservation, or a live BMW integration.
