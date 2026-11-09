# FUCQ-238 evidence: compact gallery cards and Renewal cases at 320, 375 and 1280

Base commit 7f3a364d (branch dev/DEV-2026-11-09-GC-007). Code under test: 31de6266 (Renewal cases wrapper reset),
f71410cf and 9099b0da (Car facts disclosure, 2:1 media at 600px and below), 0b1135c9 (3 cars per page at 600px and below).
Walk script: `docs/gcsp/evidence/fucq70/browser-walkthrough.mjs`, `WALK_STORY=fucq238`. Results: `results-<chunk>.json`; PNGs: `browser/`.

## Measurements (gallery first page, then Renewal cases in the Greg harness)

| Width | Cars on page | Page height | Card height | Header | Car facts | Renewal gap (region bottom minus last content) | Queue wrapper |
|---|---|---|---|---|---|---|---|
| 1280x900 | 6 | 3,214 px | 832 px | 56 px | open (6 of 6) | 21 px | min-height 0px, transparent |
| 375x812 | 3 | 3,417 px | 579 px | 56 px | closed | 13 px | min-height 0px, transparent |
| 320x720 | 3 | 3,462 px | 578 px | 56 px | closed | 13 px | min-height 0px, transparent |

The 320 page is over the ~3,000 px target (3,462 px): about 1,440 px sits above the grid (intro, allowance, release history,
series and body chips, filters) and the three cards are 1,783 px. Before this fix the 320 first page was 5,564 px with 6 cards
(7,285 px in FUCQ-223). The page size and the content above the grid were not changed beyond the 3-per-page rule.

## Keyboard

- Tab (5 stops) to the first card's "Car facts" summary and Enter toggles it: closed to open at 320 and 375 (card 578 to 904 px at 320),
  open to closed at 1280. Enter again restores the start state.
- Tab to "Show more cars" and Enter adds a page (3 at 320 and 375, 6 at 1280) and focuses the first new card.

## Renewal cases note

In the offline harness the queue shows its "You cannot open these cases" state (no scheme-team session). The measurement is of that content:
the region ends 13 to 21 px below it, with no empty grey block, and the wrapper `div.gcsp` has min-height 0 and a transparent background.

## Known failing test (pre-existing)

`server/test/gcsp-cases-local-demo.test.js:154` (Greg demand status 'unavailable') fails with these changes stashed as well, on base 7f3a364d.
`final.txt` run: 260 tests, 259 pass, 1 fail (that test).
The walk also logs 404s for `/favicon.ico` and `/api/gcsp/manual/draft` (harness noise, no page errors).

## Rerun

```
WALK_STORY=fucq238 WALK_CHUNK=narrow|phone|desktop WALK_SCRATCH=<owned scratch dir> node docs/gcsp/evidence/fucq70/browser-walkthrough.mjs
```

Ports 8935 (320), 8934 (375), 8933 (1280). The full-page screenshot is the 320 gallery only; the others are viewport size.

## Cleanup

Scratch walk directory and Chrome profiles removed by absolute path after the runs; no Chrome or `node index.js` process left.
