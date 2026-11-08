# FUCQ-170 browser evidence (DEV-2026-11-07-004)

Source commit: `3712a143f031e214623ac717e82901546b95d898` (branch `dev/DEV-2026-11-07-004`), product code unchanged. Run on 8 Nov 2026, headless system Chrome via playwright-core, `locale en-GB`, UTC.
Script: `capture-fucq-170.mjs`. Raw results: `results.json` (every capture's overflow, focused element and indicator, status/alert text, row orders, per-step network, console errors). Not committed by this run.

## Servers and boundary
- 127.0.0.1:8971 `node scripts/serve.js` (static repo root, fixture pages A and B).
- 127.0.0.1:8972 `GCSP_RUNTIME=1 node server/index.js`, memory repository, throwaway demo key, `GCSP_PUBLIC_ORIGIN=http://127.0.0.1:8972` (live composed host, section C). The main checkout's `server/node_modules` (for `pg`) was symlinked into the worktree for the run and removed afterwards.
- All browser requests not to 127.0.0.1 were blocked and counted: **0**. Page errors: **0**.
- Setup by API or key entry (not under test): access-key form, scenario reset to `main-successful-journey` (Paula's brief confirmed, startState ok), one presenter "next release" tick (releases synthetic stock so alternative cars are offerable), principal switch to Greg. Every case interaction under test used Tab / Shift+Tab / Enter / typing only (native selects chosen by type-ahead, because ArrowDown opens the popup in Chrome on macOS; dates typed as digit segments). No mouse clicks, `click()` or `fill()` on case controls.

## A. Fixture harness, Greg queue (`gcsp-case-queue.html?fixture=`): PASS
All 7 fixtures at 1280x900 and 375x812 render, no horizontal overflow. In the table, "focus indicator" is "no" only where focus was on the body (nothing focused when captured).

| State | Desktop | Narrow |
|---|---|---|
| populated | pass, A-queue-populated-desktop.png | pass, A-queue-populated-narrow.png |
| empty | pass, A-queue-empty-desktop.png | pass, A-queue-empty-narrow.png |
| loading | pass, A-queue-loading-desktop.png | pass, A-queue-loading-narrow.png |
| unavailable | pass, A-queue-unavailable-desktop.png | pass, A-queue-unavailable-narrow.png |
| forbidden | pass, A-queue-forbidden-desktop.png | pass, A-queue-forbidden-narrow.png |
| stale-run | pass, A-queue-stale-run-desktop.png | pass, A-queue-stale-run-narrow.png |
| unavailable-options | pass, A-queue-unavailable-options-desktop.png | pass, A-queue-unavailable-options-narrow.png |

unavailable-options: after keyboard open, only "Keep the current remedy" and "Manual decision" are offered; four notes explain Suitable available cars, One preference change, Reviewed later release and Contract extension as unavailable.

Populated flow (identical at both widths, `A-flow-*` in results.json):
- Table scroll region is focusable (tabindex 0) with a visible 2px outline. At 375 it scrolls: scrollWidth 1050, clientWidth 341, ArrowRight x4 moved scrollLeft 0 to 160, ArrowLeft x4 back to 4 (`A-table-keyboard-scroll-narrow.png`). At 1280 no scrolling is needed (1230 / 1230).
- Sort cases by keyboard. Row order (employee | status | deadline):

| "Deadline, active cases first" | "Status, then deadline" |
|---|---|
| Synthetic employee 3 \| Remedy proposed \| 2026-11-18 | Synthetic employee 1 \| Open \| 2026-11-20 |
| Synthetic employee 2 \| In progress \| 2026-11-19 | Synthetic employee 2 \| In progress \| 2026-11-19 |
| Synthetic employee 1 \| Open \| 2026-11-20 | Synthetic employee 3 \| Remedy proposed \| 2026-11-18 |
| Synthetic employee 5 \| Closed \| 2026-11-16 | Synthetic employee 4 \| Resolved \| 2026-11-17 |
| Synthetic employee 4 \| Resolved \| 2026-11-17 | Synthetic employee 5 \| Closed \| 2026-11-16 |

  Switching back restored the first order exactly. Focus stays on the Sort select.
- Case to work (employee 1) selected, Open selected case with Enter; focus goes to the status line.
- Empty submit of the editor: focus moves to the error summary heading "Check your choices" ("Choose a status supplied by the server. Describe why this case is changing.").
- Alternative car: "Proposed car: Synthetic BMW iX1". Review facts: Next status Remedy proposed; Reason; Next action; Due 2026-11-07 12:00:00 UTC; Remedy Alternative car; Proposed car Synthetic BMW iX1; Exact car reference synthetic-exact-car. Focus lands on "Confirm case update". Tab to "Cancel update", Enter: confirmation closes, editor stays, focus returns to "Next case status".
- Preference change (Change body, value suv): review shows Remedy One preference change; Preference Body; Proposed value suv; Employee confirmation Required through the employee brief. Cancel update returns focus to "Next case status".
- No write: 0 POST/PUT/PATCH/DELETE and 0 fetch/XHR requests during the flow (the fixture adapter makes none). The fixture does not expose an `updateCase` call counter, so that is the evidence; Confirm was never reached.

## B. Fixture harness, Paula (`gcsp-help.html?fixture=`): PASS
All 8 fixtures at both widths pass, no overflow.

| State | Desktop | Narrow |
|---|---|---|
| waiting | pass, B-help-waiting-desktop.png, B-help-waiting-confirm-desktop.png | pass, B-help-waiting-narrow.png, B-help-waiting-confirm-narrow.png |
| in-progress | pass, B-help-in-progress-desktop.png | pass, no PNG (facts in results.json) |
| resolved | pass, B-help-resolved-desktop.png | pass, B-help-resolved-narrow.png |
| closed | pass, B-help-closed-desktop.png | pass, B-help-closed-narrow.png |
| trigger | pass, B-help-trigger-desktop.png | pass, no PNG (facts in results.json) |
| loading | pass, B-help-loading-desktop.png | pass, B-help-loading-narrow.png |
| unavailable | pass, B-help-unavailable-desktop.png | pass, B-help-unavailable-narrow.png |
| forbidden | pass, B-help-forbidden-desktop.png | pass, B-help-forbidden-narrow.png |

- waiting: Tab to "Review body change", Enter. Line shown: "Body: estate → suv." Note shown: "This confirms only this preference value in a new brief version. All other preferences, essentials and importance weights stay the same. It does not resolve your case or guarantee a car." Focus lands on "Confirm preference change". "Cancel preference change" closes it with 0 writes, but focus is lost to the page body (defect D1).
- resolved and closed: "Dated case history" opened by keyboard on both, 1 event shown each (fixture has one history entry).

## C. Live composed host (8972): PASS (desktop full; narrow for Greg queue and editor, Paula reload)
Fresh run from `main-successful-journey`, synthetic stock released by one presenter tick (demo clock 2026-11-05 09:30 UTC).

1. Paula (1280) help request by keyboard: open "Get help with your renewal", "Ask for help" (focus into the textarea), type reason, "Review help request", "Confirm help request". Result: status "Your help request was recorded."; case Open, owner Scheme team, next action "Scheme team to review your renewal and contact you.", due 2026-11-06 09:30:00 UTC, 1 history event. 1 POST `/api/gcsp/cases` 200.
2. Greg on the presenter workspace (1280). Brief said Remedy proposed directly, but a fresh Open case only offers In progress or Closed, so two updates were made.
   - FUCQ-150 measurement at 1280: `.gcsp-greg` width **1184 px**, case-queue region width **1184 px** (queue content 1142 px), region `grid-column: 1 / -1` in a 5-column grid whose cells are about 227 px. The region spans the full row: **pass**. (`C2-greg-dashboard-queue-desktop.png`, `results.json` `fucq150`).
   - Keyboard: Case to work selected Paula's case, opened it. Status options: In progress, Closed.
   - 2a: In progress, typed reason, next action, due; review, confirm. 1 POST `/api/gcsp/scheme-team/cases/update` 200, "The case update was recorded."
   - 2b: options now Remedy proposed, Resolved, Closed. Remedy options offered: three alternative cars (names "Synthetic 3 Series Saloon 320i", "Synthetic 3 Series Touring 320i", "Synthetic 3 Series Saloon 320i") and Manual decision. Unavailable reasons shown: One preference change ("A current confirmed brief and an unused recorded decline are required."), Reviewed later release ("No reviewed future release date and source are recorded for this case."), Contract extension ("The current policy does not permit a contract extension."). Chose the first alternative car. Review facts: Remedy Alternative car; Proposed car Synthetic 3 Series Saloon 320i; Exact car reference (a UUID). 1 POST update 200, "The case update was recorded."
3. Paula real `page.reload()`: status Remedy proposed, "Proposed remedy", "Proposed car: Synthetic 3 Series Saloon 320i" (no raw id in the remedy facts), owner Scheme team, next action "Contact Paula about the proposed remedy.", due 2026-11-07 12:00:00 UTC, history 3 events. 0 writes.
4. Greg resolves at 375 via the standalone queue page on the hosted origin: Case to work, open, status Resolved, typed fields, review ("Remedy: Current remedy retained"), confirm. 1 POST update 200. Queue row Resolved.
5. Paula reloads at 1280 and, in a fresh context, at 375: status Resolved, "Recorded remedy", "Recorded car: Synthetic 3 Series Saloon 320i", next action "No further action needed.", due 2026-11-08 12:00:00 UTC, "Dated case history" opened by keyboard: 4 events (Open, In progress, Remedy proposed, Resolved), all dated 2026-11-05 09:30:00 UTC because the demo clock did not advance between steps.
6. Forbidden: Paula's employee session at hosted `gcsp-case-queue.html` shows "You cannot open these cases" (GET `/api/gcsp/scheme-team/cases` 403). Screenshot `C6-paula-at-greg-queue-forbidden-desktop.png`.

POST counts (excluding setup key and switch posts): step 1 = 1, 2a = 1, 2b = 1, 3 = 0, 4 = 1, 5 = 0, forbidden = 0. Non-2xx: only GET `/api/gcsp/manual/draft` 404 (account shell, present on every load, seen in FUCQ-122 too) and the two intended/setup 403s on `/api/gcsp/scheme-team/cases` (the forbidden check, and the first load of the narrow queue page before the setup principal switch). No request to a non-127.0.0.1 host.

## Console errors
20 console errors, all "Failed to load resource" for an HTTP status: 16 are 404 on `/api/gcsp/presenter/controls` on the static fixture host (8971 has no API; the Paula help shell asks for it, every B load), 2 are the 404 `manual/draft` above, 2 are the 403s above. 0 page errors. None attributable to FUCQ-170 code.

## Re-run on the final code, 8 Nov 2026

The same script re-ran on `8fa143a4` (D1, D2 and D4 fixed in that commit) and overwrote the PNGs and `results.json`. A 15/16, B 16/16, C 1/1; no document overflow in 55 captures; every focused control had a visible indicator; 0 external requests, 0 page errors; live POSTs 1, 1, 1, 0, 1, 0 (all 200).
- Cancel preference change now returns focus to "Review body change" at both widths, with 0 writes.
- Paula's reloaded history reads "You" and "Scheme team", not principal ids. Greg's scheme-team view still shows actor ids by design.
- Queue Owner cell reads "Scheme team".
- The one A failure is the script's own scroll-back assertion at 375: ArrowRight moved the table region 0 to 158 px, and ArrowLeft was read at 160 before smooth scrolling settled. The first run passed the same check. Keyboard scrolling works; this is a timing assertion, not a product defect.

## Defects and observations from the first run (3712a143)
- D1, suggested **Medium** (keyboard accessibility): in Paula's help page, "Cancel preference change" (`gcsp-help.js`, relaxation cancel calls `draw()` with no focus target) leaves focus on `<body>`. Keyboard users lose their place; the case-help "Cancel" returns focus to the disclosure summary, this one should return to "Review ... change". Seen in B-help-waiting at both widths (focus `BODY` in results.json `cancel.focusAfter`).
- D2, suggested **Low**: the employee-view "Dated case history" shows raw principal ids as Actor ("demo-paula", "demo-greg") on the live host. The "You" substitution compares `actorId` to `employeeId` (`employee-paula`), which differ live though they match in the fixtures. Visible in C3 and C5 captures.
- D3, suggested **Low**: Greg's remedy select lists two entries with the identical label "Alternative car: Synthetic 3 Series Saloon 320i" (different cars); only the "Exact car reference" shown after choosing tells them apart.
- D4, suggested **Low**: Greg queue Owner cell reads "Scheme team · scheme-team" (role id shown raw), related to GC-021.
- Observation: a fresh Open case offers only In progress or Closed, so a remedy needs two updates (assumed intended by the status model).
- Not verified: the preference-change remedy and later-release/contract-extension on the live host (policy gated: no recorded decline, release date or extension); live preference confirmation by Paula; any value from the Greg dashboard above the queue.

## Files
50 PNGs (about 5.6 MB total, slightly above the 40 target; nine further captures record facts only, no PNG, as listed in `SKIP_PNG` in the script), `results.json`, `capture-fucq-170.mjs`, this README.

## Cleanup receipt
- Servers 8971 and 8972 stopped; `lsof -nP -iTCP:8970..8973 -sTCP:LISTEN` empty.
- Chrome closed in `finally`; `pgrep -fl "fucq170/browser"` empty.
- Temporary `server/node_modules` symlink removed; `git status` shows only `node_modules` (pre-existing symlink) and this directory untracked. Nothing committed.
- Scratch `.../scratchpad/fucq170/browser/` (profile, probe scripts, logs) removed and verified absent.
