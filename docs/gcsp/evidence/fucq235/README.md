# FUCQ-235 browser evidence: Plan comparison stacks under 640 px

The learned-model "Plan comparison" table (Greg's order plan) now uses `dataTable({ stack: true })`. At 375 and 320 px each row shows as its row header over labelled value lines; at 1280 px it is still a table.
Keys are CDP `Input.*` events; `Runtime.evaluate` only reads (and frames each screenshot with `scrollIntoView`).

- Base: branch `dev/DEV-2026-11-09-GC-004`, code commit `7d414f24`. Run: 2026-11-09, 5 of 5 captures PASS, 0 console or page errors.
- Server: `PORT=8930 node scripts/serve.js` (static, no API). Chrome's debug port is chosen by `lib.mjs` (`freePort`, not settable), so it is a random free port (58641 in this run, recorded in `capture-report.json`) rather than one in 8931-8949.
- Rerun: `SCRATCH=<absolute scratch dir> BASE=http://127.0.0.1:8930 node docs/gcsp/evidence/fucq235/capture.mjs`. Writes `capture-report.json` and the PNGs here.

## States and captures

| State | URL | 1280 | 375 | 320 |
|---|---|---|---|---|
| Learned plan section | `gcsp-greg.html?fixture=populated&plan=learned` | `learned-1280.png` | `learned-375.png` | `learned-320.png` |
| Gallery group "dataTable: stacked rows on narrow screens" | `components.html` | `gallery-stack-1280.png` | n/a | `gallery-stack-320.png` |
| Keyboard focus on the comparison region | `...&plan=learned` | `keyboard-table-focus-1280.png` | `keyboard-table-focus-375.png` | `keyboard-table-focus-320.png` |

## Checks (all pass)

- Comparison region (scrollWidth / clientWidth): learned 1044/1044, 315/315, 260/260 at 1280, 375, 320; gallery 1094/1094 and 204/204 at 1280 and 320. It never scrolls sideways.
- No page or panel overflow and no offscreen elements (the visually hidden `.is-stack thead` is excluded, as is its 1px clip in the clipped-text check).
- 1280: `thead` visible (`table-header-group`), `tbody tr` is `table-row`, no `::before` labels.
- 375 and 320: `thead` visually hidden, `tbody tr` is `block`, each value cell shows its `data-label` through `::before` ("Recommended plan", "Synthetic-trained model", "Difference"); the last cell carries `data-label` "Difference".
- No em dash on screen, no console or page errors, heading "Synthetic-trained model" present.

## Keyboard-only pass (`plan=learned`)

Tab from the top of the page at 1280, 375 and 320: 27 stops inside the panel, identical to FUCQ-123's order (`matchesFucq123: true`), every stop with a visible focus ring. The "Plan comparison" region is still one stop (7th), after Alternative plans and before the limits editor (Min and Max inputs, sliders, Order budget, Preview with these limits). The table gains no extra tab stops.

## Notes

- The first run showed the stacked caption in a narrow box, wrapping onto two lines (five in the gallery). The story-lead added `.is-stack .gcsp-table-caption { display: block; }` to the same kit line and re-ran the capture: the caption now spans the region. All 5 captures pass and the keyboard order still matches FUCQ-123.
- The static server returns 404 for `/api/gcsp/presenter/controls`, `/api/gcsp/scheme-team/cases` and `/favicon.ico` (logged in `badResponses`); the plan is unaffected.
- Layout was judged by reading each PNG; no automated contrast check was run.
