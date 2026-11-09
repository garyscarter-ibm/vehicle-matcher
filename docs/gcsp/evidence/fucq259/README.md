# FUCQ-259 browser evidence: a missed return opens a case labelled as a missed return

9 November 2026, code base `a6a9fb1b` plus this fix (branch `dev/DEV-2026-11-09-GC-025`). Reduced from `../fucq-110/fucq171/browser-capture.mjs` (its world 4): a memory runtime with `lifecycle.return.outcome.v1` enabled with outcome `missed` before boot, real `buildServer` routes over loopback, headless Chrome on ports 9140 to 9149.

```sh
export TMPDIR=<owned scratch dir>
FUCQ259_SCRATCH=$TMPDIR/desktop FUCQ259_CHUNK=desktop perl -e 'alarm shift; exec @ARGV' 400 node docs/gcsp/evidence/fucq259/browser-capture.mjs
FUCQ259_SCRATCH=$TMPDIR/narrow  FUCQ259_CHUNK=narrow  perl -e 'alarm shift; exec @ARGV' 400 node docs/gcsp/evidence/fucq259/browser-capture.mjs
```

| Run | Result | Checks | PNG |
|---|---|---|---|
| 1280 (`results-1280.json`) | passed | 24/24 | `browser/1280-01-missed-return-case-greg.png` |
| 375 (`results-375.json`) | passed | 24/24 | `browser/375-01-missed-return-case-greg.png` |

Checked in each run: the receipt is keyed `return-missed` (event `<orderUuid>:return-missed`); Greg's queue row reads "Missed return of current car" with the keyed reason; the opened case reads "Opened from Missed return of current car"; Paula's help page shows the same label and reason (text only, no PNG); none shows "Missed handover appointment", `lifecycle-exception` or the general reason. Keyboard reach and focus ring, no page overflow, no em dashes, no console errors or CSP violations. Before the fix: `../fucq-110/fucq171/browser/1280-06-missed-case-greg-queue.png`.
