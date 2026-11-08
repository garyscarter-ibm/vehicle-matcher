# FUCQ-121 browser evidence: Greg's next order panel

Keyboard-only capture of the order plan panel on Greg's live dashboard and on the fixture harness, at 1280x900 and 375x812.
Every interaction is a CDP key event (Tab, Shift+Tab, Enter, arrows, typed text, the demo key through the access form).
`Runtime.evaluate` only reads state; scroll gestures frame the screenshots.

- Base: `9066cb5f` (branch `dev/DEV-2026-11-04-093`) with the panel fixes in the same commit as these files.
- Run: 2026-11-08T08:04:36.397Z to 2026-11-08T08:08:20.126Z; overall result `PASS` (25 captures, 0 failed checks).
- Server: `GCSP_RUNTIME=1 GCSP_REPOSITORY_MODE=memory GCSP_OFFLINE=1 node server/index.js`, free port, throwaway `DEMO_ACCESS_KEY` typed by key events (hosted entry, as `server/test/gcsp-hosted-entry.test.js`). Started and stopped by the script.
- Rerun: `SCRATCH=<absolute scratch dir> node docs/gcsp/evidence/fucq121/capture.mjs` (about 4 minutes). Writes `capture-report.json` and the PNGs here.

## What was driven

Reset to **Decline then change** (about 16 s), switched to Greg, then: plan ready; typed Min 2 for "3 Series Touring 320i" and moved its maximum slider (3 to 4) with ArrowRight; **Preview with these limits**; **Back to current plan**; **Reset limits**; an infeasible preview (derivative minimum 2 under a "3 Series Touring" model maximum of 0); a preview again; a second window (same session) pressed **Tick** so the first window's plan went stale; **Request 2 vehicles from Production** gave **Replan needed**; **Replan with the latest inputs**; **Request 2 vehicles from Production** (submit); the row appeared in Order requests with no Refresh press; Synthetic production controls, **Confirm now**, quantity 2, **Save production response**; the plan reloaded itself to "Replanned after a Production response" (5882 ms after the response). A **Tick** in the same window reloaded the plan by itself (5 Nov 2026, 09:31 GMT to 5 Nov 2026, 09:32 GMT). Live employee: the Paula session opens no panel and `GET /api/gcsp/greg/order-plan` returned 403 `forbidden`.

## Captures (all PASS)

Overflow is page / panel horizontal px (0 / 0 means none). Focus is the element focused when the PNG was taken.

| State | Width | PNG | Result | Overflow | Focused |
|---|---|---|---|---|---|
| ready | 1280 | `ready-1280.png` | PASS | 0 / 0 | body:  |
| ready | 375 | `ready-375.png` | PASS | 0 / 0 | body:  |
| limits editor after a typed minimum and a slider move | 1280 | `limits-editor-1280.png` | PASS | 0 / 0 | input: 3 Series Touring 320i maximum slider |
| limits editor after a typed minimum and a slider move | 375 | `limits-editor-375.png` | PASS | 0 / 0 | input: 3 Series Touring 320i maximum slider |
| preview | 1280 | `preview-1280.png` | PASS | 0 / 0 | h2: Order 2 vehicles: 3 Series Touring 320i |
| preview | 375 | `preview-375.png` | PASS | 0 / 0 | h2: Order 2 vehicles: 3 Series Touring 320i |
| infeasible | 1280 | `infeasible-1280.png` | PASS | 0 / 0 | h2: No plan meets these limits |
| infeasible | 375 | `infeasible-375.png` | PASS | 0 / 0 | h2: No plan meets these limits |
| stale | 1280 | `stale-1280.png` | PASS | 0 / 0 | h3: Replan needed |
| stale | 375 | `stale-375.png` | PASS | 0 / 0 | h3: Replan needed |
| submitted | 1280 | `submitted-1280.png` | PASS | 0 / 0 | h2: No new order needed |
| submitted | 375 | `submitted-375.png` | PASS | 0 / 0 | h2: No new order needed |
| order tracking after submit | 1280 | `order-tracking-after-submit-1280.png` | PASS | 0 / 0 | h2: No new order needed |
| replanned | 1280 | `replanned-1280.png` | PASS | 0 / 0 | body:  |
| replanned | 375 | `replanned-375.png` | PASS | 0 / 0 | body:  |
| loading | 1280 | `fixture-loading-1280.png` | PASS | 0 / 0 | body:  |
| loading | 375 | `fixture-loading-375.png` | PASS | 0 / 0 | body:  |
| empty (no demand) | 1280 | `fixture-no-demand-1280.png` | PASS | 0 / 0 | body:  |
| empty (no demand) | 375 | `fixture-no-demand-375.png` | PASS | 0 / 0 | body:  |
| unavailable | 1280 | `fixture-unavailable-1280.png` | PASS | 0 / 0 | button: Retry |
| unavailable | 375 | `fixture-unavailable-375.png` | PASS | 0 / 0 | button: Retry |
| refused (non-Greg) | 1280 | `fixture-refused-1280.png` | PASS | 0 / 0 | body:  |
| refused (non-Greg) | 375 | `fixture-refused-375.png` | PASS | 0 / 0 | body:  |
| plan ready with long derivative names | 1280 | `fixture-long-names-1280.png` | PASS | 0 / 0 | body:  |
| plan ready with long derivative names | 375 | `fixture-long-names-375.png` | PASS | 0 / 0 | body:  |

Fixture states come from `gcsp-greg.html?fixture=populated&plan=<state>` (loading, no-demand, unavailable, refused, ready with a long i5 derivative name). The other states are live. Per capture, `capture-report.json` also holds the checks, page exceptions and console messages (none), failed network requests (none) and every non-2xx response, the focus trail after each key action, and the plan API calls with status.

## Fixes made from the screenshots

- Custom element (`gcsp-greg-order-plan`) took the page-level `.gcsp` rule (min-height 100vh, grey ground), leaving a tall empty box in the harness states. Reset in `plan.css`.
- Empty limits editor drew a stray rule in the loading, unavailable and refused states. Hidden when empty.
- "Unmatched supply by source" repeated "Vehicle already in stock 1" five times. Rows with the same label are merged (`plan-view.js`).
- Alternative plans table broke "recommendation" mid-word at 375. The table now scrolls sideways in its own keyboard region, with the short "Compared" column second.

## Observations and defects not fixed (not this story's code)

| Severity | Origin | Evidence |
|---|---|---|
| Low | FUCQ-119 plan service text | Infeasible preview lists "Budget: Spend GBP 459,000 is over the GBP 200,000 budget" and "3 Series Saloon maximum: Maximum 4." beside the real conflict (`infeasible-1280.png`). The reasons are the service's. |
| Low | FUCQ-119 plan service text | Binding constraints list seven "Quantity meets minimum 0." rows (`ready` state, below the fold). |
| Low | Greg harness (FUCQ-101 / cases queue) | Every fixture page calls `GET /api/gcsp/scheme-team/cases`, which returns 403 without a scheme-team session. Console shows the failed load; the plan is unaffected. |
| Low | FUCQ-104 Order tracking | At 375 the requests table scrolls sideways inside its region (`order-tracking-after-submit-1280.png` shows desktop only). By design of the kit table. |

Expected non-2xx responses in the run: favicon 404, employee `manual/draft` 404, stale submit 409 (`request-from-stale-plan`), employee plan route 403, fixture `scheme-team/cases` 403.

## Limitations

- The stale state needs a second window; a Tick in the same window reloads the plan, so it never goes stale there. This is recorded in the manual scenario.
- The live ready plan proposes no new order ("No new order needed"); an order exists only after a minimum is raised in the editor, as the story anticipated.
- The employee refusal is shown live as the API 403 plus the absence of the panel; the refused panel itself is the fixture capture. JSON error pages were not screenshotted.
- Range slider focus is a thumb ring (no CSS outline), confirmed in `limits-editor-*.png`.
- Contrast and layout were judged by reading each PNG; no automated contrast check was run.
- `limits-editor-1280.png` hits the end of the page, so the row sits mid-frame.
