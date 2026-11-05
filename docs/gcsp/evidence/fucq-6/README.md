# FUCQ-64 representative employee body: review reference

Story DEV-2026-11-04-037 (Jira FUCQ-64, Epic FUCQ-7). This folder holds the rendered evidence for the shared GCSP shell and the representative employee body. Consuming stories use it as the body-design reference once Russell or Gary has reviewed it.

## Reference

- **Path:** `gcsp-employee.html` (harness), `blocks/gcsp/shell/` (shell, tokens), `blocks/gcsp/employee/` (entry, representative body, fixtures). Gallery section: `components.html`, "GCSP".
- **Revision:** source commit `a7fc178` on `dev/DEV-2026-11-04-037` (base `gcsp-poc`). `fucq-64-browser-matrix.json` records the full HEAD, SHA-256 of each source file and every check result.
- **How to reproduce:** `npm run serve` (and `npm run server` for the API), then open `http://localhost:3000/gcsp-employee.html?fixture=<name>`, where `<name>` is `representative`, `representative-no-images`, `representative-loading` or `representative-unavailable`. `capture-fucq-64.mjs` re-runs every capture in headless system Chrome; set `PLAYWRIGHT_CORE` to a playwright-core `index.mjs` and `BASE` to the static server.
- **Data:** synthetic throughout and labelled so on screen. Points come from `server/gcsp/policy/seed-v1.json` (`gcsp-policy-v1`): allowance `allowance.choices-fs-uk.G7` 1,300 points a month; cost keys `price.choices-fs-uk.015`/`.016` 1,100 and `.027` 1,400. All are assumed values, not BMW figures. Stock cars carry an `orderNumber`/`orderUuid`/`configurationId` and no VIN; only the current car has a (synthetic) VIN. The single photo is the committed BMW brand image `assets/brand-hero/bmw.jpg`, captioned as a brand image rather than the model shown.

## Captures (1280x900 desktop, 320x740 narrow)

| File | Shows |
|---|---|
| `representative-desktop.png`, `representative-narrow-320.png` | Full page: slim header with account context, icon sidebar (Menu disclosure at 320px), current-car feature with countdown and facts, points allowance, three exact stock cards (long name, missing image, missing WLTP figure, one over allowance), selection summary, synthetic-data note. |
| `representative-no-images-desktop.png`, `representative-no-images-narrow-320.png` | Every image absent, including the current car: "No image for this car yet" placeholders with no false caption. |
| `representative-loading-desktop.png`, `representative-loading-narrow-320.png` | Account loading: busy account placeholder in the header and a "Loading your account and cars" status in the body. |
| `representative-unavailable-desktop.png`, `representative-unavailable-narrow-320.png` | Account could not load: header message with Retry, body explains what is hidden. |
| `keyboard-skip-link-desktop.png` | First Tab: visible "Skip to content" link with a 2px focus outline. |
| `keyboard-unavailable-nav-desktop.png` | Focus on an unimplemented destination: "New order: Not available in this demo"; it is a disabled button, not a link. |
| `keyboard-selected-desktop.png`, `selected-summary-desktop.png` | Enter on "Choose a replacement" moves focus to the selection heading; Tab and Enter select the first car (`aria-pressed=true`); the summary shows cost, allowance and points left, with Reserve disabled and its reason ("Reserving is not part of this preview"). |
| `narrow-menu-open-320.png` | 320px Menu disclosure opened by keyboard, with labels and unavailable reasons. |
| `reduced-motion-labels-desktop.png` | `prefers-reduced-motion: reduce`, sidebar labels expanded; computed transition durations are 0s. |
| `gallery-gcsp-desktop.png`, `gallery-gcsp-narrow-320.png` | The single gallery's GCSP section: screenIntro, button, statusScreen, factList, mediaWell placeholder, portalShell in three account states, accountNavigation collapsed and expanded. |

All 16 captures reported no horizontal overflow, no console or page errors, no failed requests and no external requests (the run blocks anything outside the local server). The tab order and focus outlines are recorded in the matrix.

## Body composition decisions for review

- The body follows the Used Cars direction rather than the portal's grey form grids: one large current-car feature, a points allowance band, then image-led exact-car cards and a running selection summary. The seven-step stepper is gone, and the breadcrumb shows only the current view.
- Points are always shown with units and against the allowance. Choices has no cash top-up in this preview, and no list price is shown.
- A car over the allowance stays visible with the reason in text and an icon (not colour alone), and cannot be selected. Nothing reserves, orders or saves.
- The employee cards are page composition from kit primitives. FUCQ-31 owns the shared decision-card contract, and these cards should move onto it when it lands.

## Review record

Awaiting the internal design review by Russell or Gary (acceptance 4 of FUCQ-64). Record the reviewer, date, revision reviewed and observations here; consuming stories then cite this file and revision as the body reference.

| Date | Reviewer | Revision | Observations | Follow-up |
|---|---|---|---|---|
| | | | | |
