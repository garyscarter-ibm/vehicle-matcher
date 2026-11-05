# FUCQ-30 browser evidence

Run fucq30-20261105-feedback-actions-browser exercised the actual questionnaire module and /components.html gallery in one isolated, headless Chromium session.

## Source and fixture

- Dispatch baseline: b8bfee75fadd7aff2f7dfa2d7238bc93373ac708.
- Worktree HEAD during the run: 30b9513f314c9eca1548e87961073640fbf696ef, a docs-only advance. The 11 executable and fixture hashes in browser-matrix.json match the dispatch baseline before and after.
- Questionnaire: blocks/vehicle-matcher/modes/questionnaire.js mounted directly, with local loopback stubs for /api/questions, /api/match and /api/nearby. The two groups contain the four listings recorded in the matrix.
- The gallery uses its own source fixtures. Neither surface connected to live inventory, a retailer account, a saved employee brief or an employee application.
- The browser session loaded only worktree assets and the local fixture server. No external requests were allowed.

## Results

The 51 recorded interaction checks completed, covering the three whole-search filters, exact-group rejection, local undo, the explained empty state and reset, and the employee fixture's unknown charging → explicit none → undo to unknown flow. Keyboard Enter opened and applied the questionnaire rejection, and Enter on the named Undo restored the count and original claims.

All 18 desktop/narrow layout snapshots reported no horizontal document overflow or clipped text. The desktop keyboard path showed a visible solid 2px focus outline on Undo Not the blue. There were no console or page errors. The 12 PNGs total about 1.5 MiB.

The baseline run reported two stale grouped claims in the actual questionnaire after regrouping:

- Only manual leaves the Black listing at £31,000 with unknown odometer, while the card still says £31,000–£32,000 and 10,000 miles.
- Fewer than 10,000 miles leaves the White listing at £29,000 and 7,000 miles, while the card still says £29,000–£32,000.

The parent corrected these claims in source commit `85e174e9aff71367472c54f489bea802008a869c`. The post-fix confirmation below exercised both cases against that exact commit.

The baseline fixture supplied `searched` as a number rather than the `{ total, eligible, margin }` shape; that was a harness issue. It also left optional technical figures absent, exposing a product rendering gap: missing values appeared as undefined. The parent added guards in source commit `85e174e9aff71367472c54f489bea802008a869c`. The confirmation uses the valid summary shape, leaves optional technical figures null, and verifies they are omitted from rendered copy.

Visual review of the supplied captures found a clear desktop two-column gallery and a readable single-column narrow layout; scope text wraps without clipping. Repeated option/scope spacing is regular across the menu. No separate pulsing indicator was apparent in these captured states; the visible colour dots are static swatches. The pre-existing questionnaire pending dot was not re-investigated. The earlier Impeccable hook cannot be attributed from these captures alone.

## Post-fix confirmation (5 November 2026)

The bounded headless confirmation passed against worktree commit `85e174e9aff71367472c54f489bea802008a869c` on `dev/DEV-2026-11-04-050`; product source hashes were unchanged during the run. The per-file source SHA-256 values and exact observations are recorded in [browser-confirmation-matrix.json](browser-confirmation-matrix.json).

All 29 checks passed. The desktop `Only manual` case shows the surviving Black listing at £31,000 without the stale £32,000 or 10,000-mile claims. The narrow `Fewer than 10,000 miles` case shows the surviving White listing at £29,000 and 7,000 miles without the stale £32,000 or 10,000-mile claims. Named Undo retained visible keyboard focus and restored the original grouped claims. Desktop and narrow gallery checks found no undefined technical copy. The five checked layouts had no horizontal overflow or clipped text; there were no console/page errors, unexpected API calls or external requests. All four refreshed captures were visually reviewed.

The run replaced only these existing capture paths, leaving 12 PNGs in the evidence directory:

- `gallery-desktop-initial.png`
- `gallery-mobile-initial.png`
- `questionnaire-desktop-keyboard-undo.png`
- `questionnaire-mobile-filtered.png`

The successful run identity is `fucq30-20261105-feedback-actions-browser-confirmation-retry1`. Its [receipt](browser-confirmation-retry1-receipt.json), [log](browser-confirmation-retry1.log), matrix and four capture SHA-256 values are retained here. The file-to-scenario impact record is [fucq30-20261105-feedback-actions-browser-confirmation-retry1.json](/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact/fucq30-20261105-feedback-actions-browser-confirmation-retry1.json). One earlier confirmation launch stopped before starting the browser because the nested shared scratch parent did not exist. Its reservation was released; the incomplete [receipt](browser-confirmation-receipt.json) and shared ownership manifest now record a separate clean resource-reconciliation field while preserving the original error and incomplete run status. The successful retry used a new run identity and created scratch beneath the primary repository's shared `.claude/test-runs/scratch/` root.

The successful run used 1.98 MiB peak local scratch for the headless Chromium profile and temporary files. The process group was empty, `lsof` found no open files, the scratch directory and its empty run-specific parent were removed, and the host reservation was released. The cleanup receipt is [browser-confirmation-retry1-receipt.json](browser-confirmation-retry1-receipt.json).

## Captures

All captures are in this directory:

- gallery-desktop-initial.png, gallery-desktop-menu.png, gallery-desktop-undo.png, gallery-desktop-empty.png, gallery-desktop-reset.png
- gallery-mobile-initial.png, gallery-mobile-menu.png, gallery-mobile-undo.png
- gallery-employee-confirmed-none.png
- questionnaire-desktop-menu.png, questionnaire-desktop-keyboard-undo.png, questionnaire-mobile-filtered.png

## Repeatable reset

The harness reloaded/remounted the questionnaire before each independent operator case, so every case began with all four synthetic listings. Start again clears questionnaire feedback and restores both groups; each action's named Undo removes that action. Reloading components.html restores the gallery fixtures. Its Reset local feedback restores both retail groups; employee fixture reload returns charging to unknown.

Each temporary loopback server and browser profile is closed and removed. Replaying either completed run identity is not supported because its ownership manifest and receipt are retained.

## Resource and tooling record

- Browser: bundled Playwright 1.62.1, Chromium launched with `headless: true`.
- Baseline run duration: 9.704 seconds; one browser worker.
- Baseline browser profile / temporary files: 1.98 MiB peak under the actual worktree-local scratch path `/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-050/.claude/test-runs/scratch/fucq30-20261105-feedback-actions/browser`; the directory is absent after cleanup.
- The original run manifest is /Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-050/.claude/test-runs/ownership/fucq30-browser.json. This run used the worktree-local .claude/test-runs path rather than the mandated shared primary-repository path; its exact receipt is retained for the parent to reconcile. Do not represent it as a run against the shared scratch path.
- The owned process group is empty; lsof +D reported no open files; the shared host reservation token was released. Details are in browser-run-receipt.json.
- The OpenTabs list-only call returned Extension not connected, so draw.io availability is unknown. No tab was opened, focused or screenshotted.
- No product source was edited and no automated test suite was run. The retained one-off files are browser-runner.mjs, browser-supervisor.py, this evidence note, the JSON matrix, receipt/log and 12 small PNGs.
