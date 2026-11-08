# FUCQ-194 browser evidence: buddy return collected from the home address

8 November 2026. Two checks at 1280 and 375, both on `127.0.0.1` (ports 8860 to 8869), headless Chrome, nothing stubbed, no live external calls.

1. **Live journey** (`results-desktop.json`, `results-narrow.json`, `browser/<width>-NN-*.png`). FUCQ-124's runner `../fucq-110/browser-walkthrough.mjs`, run with `FUCQ110_OUT=docs/gcsp/evidence/fucq-194` so FUCQ-124's own evidence is untouched. Its `return-offered` and `return-scheduled` steps now also require "Collection from your home address" followed by "1 Fictional Way, Example Town, ZZ1 1ZZ", the address `seedManualDemoContext` holds on Paula's account.
2. **Design harness** (`results-harness.json`, `browser/<width>-return-*.png`). `capture-harness.mjs` opens `gcsp-order-progress.html` with the fixtures `return-buddy-home`, `return-buddy-no-address` ("Not supplied") and `return-not-planned` (manual route, "Return place"), and checks the return section text and horizontal overflow.

## How to run

```sh
export TMPDIR=<owned scratch dir> FUCQ110_SCRATCH=<owned scratch dir>
FUCQ110_OUT=docs/gcsp/evidence/fucq-194 FUCQ110_PORT=8860 FUCQ110_CHUNK=desktop perl -e 'alarm shift; exec @ARGV' 1500 node docs/gcsp/evidence/fucq-110/browser-walkthrough.mjs
FUCQ110_OUT=docs/gcsp/evidence/fucq-194 FUCQ110_PORT=8861 FUCQ110_CHUNK=narrow  perl -e 'alarm shift; exec @ARGV' 1500 node docs/gcsp/evidence/fucq-110/browser-walkthrough.mjs
FUCQ194_PORT=8862 perl -e 'alarm shift; exec @ARGV' 150 node docs/gcsp/evidence/fucq-194/capture-harness.mjs
```

## Results

Run against code commit `85e73eb2` (branch `dev/DEV-2026-11-08-GC-003`); the runner change was made in the same commit.

| Run | Result | Steps | Keyboard | Overflow | Console |
|---|---|---|---|---|---|
| Live 1280 (`results-desktop.json`) | passed | 39/39 | 43/43 | 0 | 7 x 404, as FUCQ-110 recorded |
| Live 375 (`results-narrow.json`) | passed (second attempt) | 39/39 | 43/43 | 0 | 7 x 404 |
| Harness 1280 and 375 (`results-harness.json`) | passed | 6/6 | not exercised | 0 | 404s only |

The first 375 attempt lost its browser in the presenter prelude (`Target page, context or browser has been closed`), the transient FUCQ-110 already notes; the retry passed. Only the return screenshots are kept (`*-14` to `*-17` and `*-return-*`); the earlier steps repeat FUCQ-124's evidence in `../fucq-110/browser/`.
