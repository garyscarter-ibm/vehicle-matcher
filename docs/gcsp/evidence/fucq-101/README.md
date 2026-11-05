# FUCQ-101 Greg demand and supply dashboard: rendered evidence

Story DEV-2026-11-04-064 (Jira FUCQ-101, Epic FUCQ-90). Rendered evidence for Greg's dashboard inside the GCSP shell.

- **Path:** `gcsp-greg.html` (harness), `blocks/gcsp/greg/` (element, view adapter, copy, fixtures, HTTP adapter, styles), `blocks/gcsp/kit/` (`metricTile`, `dataTable`, `gcsp-kit.css`). Gallery: `components.html`, "GCSP Greg kit". Contract: `docs/gcsp/greg-dashboard-contract.md`.
- **Revision:** source commit `3b4660a` on `dev/DEV-2026-11-04-064` (base `gcsp-poc`). `fucq-101-browser-matrix.json` records `head` `3b4660aa...` with `sourceTreeClean: true` and the SHA-256 of each source file, so every capture was taken on exactly that source. The commit after it adds only this folder.
- **How to reproduce:** `PORT=3141 node scripts/serve.js`, then open `http://localhost:3141/gcsp-greg.html?fixture=<name>` with `<name>` one of `populated`, `after-release-decline`, `refresh`, `empty`, `no-stock`, `banded`, `unavailable`, `refused`, `conflict`, `loading`. `capture-fucq-101.mjs` re-runs every capture in headless system Chrome: set `PLAYWRIGHT_CORE` to a playwright-core `index.mjs` and `BASE` to the static server.
- **Data:** synthetic fixtures (`blocks/gcsp/greg/fixtures.js`), shaped like `readDemand` output with the privacy threshold (5) applied once. The real service and HTTP adapter are covered by `server/test/gcsp-greg-dashboard-data.test.js`, not by this browser run.

## Captures (1280x900 desktop, 320x740 narrow; 28 screenshots)

| File | Shows and what was checked |
|---|---|
| `populated-*.png` | Full page: shell header and icon sidebar, meta strip (time, policy and brief versions, basis, figures version, Refresh), four headline tiles, demand by model line, body and fuel, essentials, unmet needs by gate beside stock (desktop), offers tiles and declined reasons, then the five reserved regions. Seven table scroll regions. |
| `after-release-decline-*.png` | Later figures: one more G21 Touring released, unmet seats 5 to 4, declined 12 to 13 with a typed reason. |
| `refresh-before-*.png`, `refresh-after-*.png` | Keyboard only, see "Refresh" below. |
| `empty-*.png` | No briefs: explanation panel, meta strip and stock table stay, "None yet" for brief versions. |
| `no-stock-*.png` | Stock table row "No stock has been released yet"; unmet gate "No stock has been released yet" still shown. |
| `banded-*.png` | Every count below 5 reads "fewer than 5" in a dashed chip or italic cell; no number is shown or derived. |
| `unavailable-*.png`, `retry-after-*.png` | Alert with Retry; after Retry by keyboard (see below). |
| `refused-*.png` | Alert "You cannot open this dashboard", no figures, no Retry, reserved regions hidden. |
| `conflict-*.png` | "The figures changed while loading", Refresh offered. |
| `loading-*.png` | Viewport only: "Loading the demand figures" in the status line and body. |
| `keyboard-table-region-desktop.png` | First table scroll region focused by Tab: 2px teal outline. |
| `keyboard-scroll-narrow-320.png` | Narrow, the Stock table region focused (it overflows its box) after ArrowRight and End. |
| `reduced-motion-desktop.png` | `prefers-reduced-motion: reduce`; computed transition durations are 0s. |
| `gallery-greg-kit-*.png` | The "GCSP Greg kit" gallery group: `metricTile` exact, band and with a note; `dataTable` with a very long model name and a band cell; empty `dataTable`. |

All 28 captures reported no horizontal page overflow, no console or page errors, no failed requests and no external requests (anything outside the local server is blocked and logged). Chrome only.

## Keyboard path

- **Populated, desktop:** 14 Tab stops, none lost: Skip to content, the four navigation items (Demand and supply, Publish stock, Order tracking, Next order), Show labels, Refresh, then the seven table scroll regions in reading order (By model line, By body style, By fuel type, By essential requirement, Briefs with no suitable car by gate, Stock by model line, Declined offers by reason). Every stop has a solid 2px outline in `rgb(10, 96, 112)`. The unavailable navigation items are focusable buttons, as in FUCQ-64.
- **Narrow:** Refresh is reached after Skip to content and Menu (3 stops); three of the seven table regions overflow their box at 320px (essentials, unmet needs, stock) and are the only ones that need scrolling. With the Stock region focused, ArrowRight moved `scrollLeft` 0 to 12 and End to 12 (the region is only 12px wider than its box after the padding fix), so both keys scroll it.
- **Unavailable:** Tab order to Retry recorded (narrow: Skip to content, Menu, Refresh, Retry). Enter reloads: the `gcsp:unavailable` event count went from 1 to 2, the status line still says "Figures unavailable.", the alert is still shown (the fixture stays unavailable). Because the Retry button is replaced by the redraw, focus moves to Refresh rather than being lost.

## Refresh before and after (keyboard only, `?fixture=refresh`)

Tab to Refresh (desktop: Skip to content, four navigation items, Show labels, Refresh), Enter, wait for "Figures updated for ...".

| Item | Before | After |
|---|---|---|
| Status line | Figures updated for 5 Nov 2026, 09:40 GMT. | Figures updated for 5 Nov 2026, 10:25 GMT. |
| Figures for | 5 Nov 2026, 09:40 GMT (demo clock) | 5 Nov 2026, 10:25 GMT (demo clock) |
| Figures version | `fx-popul...` | `fx-after...` |
| Briefs with no suitable car | 9 | 8 |
| Declined | 12 | 13 |
| Policy and brief versions | gcsp-policy-v1, 1, 2, 3 | unchanged |

Focus is still on the Refresh button after the update, on both widths.

## Contrast (computed colour against the effective opaque background, WCAG ratio)

The minimum is 5.87 (table header, muted notes on the page background, status line and region headings, 13 to 15px). No text failed 4.5 at either width. Others: tile label 6.48, table body 14.73, band figure 12.5, band cell 6.48, section heading 13.35, Refresh button text 7.19. All probes found their elements; full list per width is in the matrix under `contrast`.

## Reference comparison

Compared at desktop against `gcsp-employee.html` (FUCQ-64, `docs/gcsp/evidence/fucq-6/`, approved reference rev `a7fc178`) and `gcsp-outbox.html?fixture=messages` (FUCQ-97): header height 56px, sidebar 48px collapsed, body font stack `system-ui, -apple-system, "Segoe UI", Roboto...`, accent `#0b6c7e`, page grey and h1 size (34px) are identical on all three. The dashboard uses the same shell, tokens and component language and differs only in density: 13 to 15px table text and 40px headline figures, no imagery, and tables rather than cards. The Refresh button is the ghost variant (white fill, teal text), the same variant FUCQ-97 uses for Refresh.

## Defects found and fixed during capture (commit `3b4660a`)

- At 320px, tables kept 12px side padding, so the long-name first column squeezed to a few characters per line and the gallery's long model name stacked word by word. Narrow padding is now 8px with a 104px minimum for row headers.
- Gallery tiles stacked as three full-width rows; they now sit in a responsive row (`.gcsp-tile-row`).
- A banded numeric cell could not wrap, adding scroll; it now wraps.
- The reserved regions wrapped 4 plus 1 at 1280px, leaving one box alone; the minimum is now 200px. At 1280px with the shell all five now sit in one row.
- The conflict message repeated "Refresh" twice; it now says it once.
- `server/test/ui-ratchet.json`: `gcsp-kit.css` `max_lines` raised 25 to 28. This sheet is new on this branch (the cap grows only here, no existing sheet grew).

## Limitations

- Fixtures, not a live API browser run. The HTTP adapter, role check and conflict path are tested in `server/test/gcsp-greg-dashboard-data.test.js`.
- Chrome only; no Safari or Firefox check, no screen reader run.
- The loading, refused, conflict and unavailable views show a meta box holding only the Refresh button (no figures to describe). It is intentional so Refresh stays in the same place, but it reads as an empty card.
- The loading view says "Loading the demand figures" twice (live status line and body); the body copy is the visible one.
- The Figures version is shown shortened (`fx-popul`); the full value is the projection's `projectionVersion` and is not shown in full on screen.
- Offers, publish, order tracking, prediction, route comparison and case queue regions are placeholders by design; they hold one honest line each and no data.
