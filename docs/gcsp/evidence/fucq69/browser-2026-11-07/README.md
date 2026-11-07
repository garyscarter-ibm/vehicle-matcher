# FUCQ-69 browser captures, 7 November 2026

Source: branch `dev/DEV-2026-11-04-068` after merging gcsp-poc `7c60e78d` (merge `9534d782`) plus the
label and outage-copy changes committed with this file. Served from the worktree by `scripts/serve.js` on port 3170.

Data: the read-only fixture harness `gcsp-manual-gallery.html?fixture=<name>`, synthetic dated fixture
`fixture:manual-gallery:2026-11-05` (`blocks/gcsp/manual-gallery/fixtures.js`). No live stock or released run.
The loading state is that harness with a never-settling `browseStock`, set on the element's `adapter`.
Empty search is the `available` fixture with the query `zzqx no such car`, typed by keyboard.

Captures were rendered in the page (DOM and computed stylesheets drawn to a canvas) inside the Claude
browser pane, so fonts and images are close to, not identical with, the live render.

| State | 1280 | 375 | 320 |
|---|---|---|---|
| Available, with an ineligible car explained and Review disabled | `available-1280.png` | `available-375.png` | `available-320.png` |
| Vehicle details, all sections open | `detail-1280.png` | `detail-375.png` | `detail-320.png` |
| Loading | `loading-1280.png` | `loading-375.png` | |
| Nothing released yet | `nothing-released-yet-1280.png` | `nothing-released-yet-375.png` | |
| Released, none visible (empty stock) | `empty-stock-1280.png` | `empty-stock-375.png` | |
| No suitable stock (all ineligible) | `no-suitable-stock-1280.png` | `no-suitable-stock-375.png` | |
| Source unavailable | `source-unavailable-1280.png` | `source-unavailable-375.png` | |
| Empty search | `empty-search-1280.png` | `empty-search-375.png` | |
| Car taken since listing | `car-taken-1280.png` | `car-taken-375.png` | |
| Choices need refreshing | `context-refresh-1280.png` | `context-refresh-375.png` | |

Checks made in the browser:
- Every state has its own heading and recovery action, and no capture overflows horizontally
  (`scrollWidth` equals `clientWidth` at 1280, 375 and 320).
- Keyboard at 375: Tab runs chips, search, sort, then each card's Vehicle details (the read-only Review is
  disabled and skipped). Enter opens details with focus on the car heading; Back returns focus to the
  same Vehicle details button. Typing in search keeps focus in the field.
