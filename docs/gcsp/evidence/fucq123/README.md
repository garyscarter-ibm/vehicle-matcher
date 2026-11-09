# FUCQ-123 browser evidence: synthetic-trained model beside the recommended plan

Capture of the new "Synthetic-trained model" section of Greg's order plan on the fixture harness, at 1280x900 and 375x812.
Keys are CDP `Input.*` events; `Runtime.evaluate` only reads (and frames each screenshot with `scrollIntoView`).

- Base: branch `dev/DEV-2026-11-04-094` after slices 1 and 2 (`98e05eae`), with the slice 3 UI.
- Server: `PORT=8951 node scripts/serve.js` (static, no API). Run: 2026-11-09, 6 of 6 captures PASS, 0 console or page errors.
- Rerun: `SCRATCH=<absolute scratch dir> BASE=http://127.0.0.1:8951 node docs/gcsp/evidence/fucq123/capture.mjs`. Writes `capture-report.json` and the PNGs here.

## States and captures

| State | Harness URL | 1280 | 375 |
|---|---|---|---|
| Learned plan beside the recommended plan, with label and evaluation summary | `gcsp-greg.html?fixture=populated&plan=learned` | `learned-1280.png` | `learned-375.png` |
| Fallback, no active model | `...&plan=ready` | `ready-1280.png` | `ready-375.png` |
| Fallback, outside training coverage | `...&plan=learned-coverage` | `learned-coverage-1280.png` | `learned-coverage-375.png` |
| Keyboard focus on the comparison table | `...&plan=learned` | `keyboard-table-focus-1280.png` | `keyboard-table-focus-375.png` |
| Table scrolled by arrow keys | `...&plan=learned` | n/a (fits) | `keyboard-table-scrolled-375.png` |

Each capture checks: expected text, heading "Synthetic-trained model", no page or panel overflow, no clipped text, no em dash, no button inside the section, no console errors. Learned: four column headers and bold changed cells. Fallbacks: no table and no figures.

## Keyboard-only pass (`plan=learned`, same order at both widths)

Tab from the top of the page; every stop inside the panel has a visible focus ring (`capture-report.json`, `keyboard`).

1. **Request 3 vehicles from Production** (first: labelled for the recommended plan, described by "Nothing is ordered until Production confirms.")
2. Proposed order (table region)
3. Order totals by model (region)
4. Unmatched supply by source (region)
5. Binding constraints (region)
6. Alternative plans (region)
7. **Plan comparison** (the learned table's region, focus ring in `keyboard-table-focus-*.png`)
8. The limits editor: Min and Max inputs and a slider per row, then Order budget (pounds), then **Preview with these limits** (27 stops in all).

The learned section itself adds one stop (the table region) and no button. At 375 the focused region scrolls sideways with ArrowRight (scrollLeft 0 to 99, the full overflow).

## Fixes made from the screenshots

- The comparison table used the 520 px minimum of the wide-table class, so Synthetic-trained model and Difference sat off-screen at 375. The class is no longer used and numeric headers may wrap in the panel (one rule in `plan.css`, still inside its cap): 495 px of table became 382 px.
- Caption shortened to "Plan comparison" so it is not clipped when the table scrolls.

## Remaining limitations

- At 375 the table still scrolls about 100 px sideways inside its keyboard region: Synthetic-trained model and Difference are partly off-screen until scrolled, and the row names scroll out of view with it (no sticky first column in the kit table).
- The harness serves the static fixtures only: `/api/gcsp/presenter/controls`, `/api/gcsp/scheme-team/cases` and `/favicon.ico` return 404 from the static server. The plan is unaffected.
- Contrast and layout were judged by reading each PNG; no automated contrast check was run.
- The server-supplied limitation text is shown verbatim, so its wording is the server's.
