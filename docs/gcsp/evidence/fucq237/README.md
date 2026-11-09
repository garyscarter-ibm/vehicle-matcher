# FUCQ-237 keyboard walk for Jordan

Base: fix commit `4c1f9fe9` (branch `dev/DEV-2026-11-09-GC-006`). Jordan (`demo-jordan`, no current car), new-order journey, keyboard only (Tab, Enter, Space), offline host with a random demo key.

## Steps per width (1280x900, 375x812, 320x720)

account, setup saved, empty gallery, released gallery, review, summary wording, summary unticked and ticked, outcome, account after order. All 8 steps passed at all three widths, 0 px horizontal overflow, 0 page errors, one order POST each. Console errors and 4xx responses (12 and 11) match the FUCQ-224 baseline (expected 404s before a draft, claim or order exists, and 400s on stock before a release).

## The three fixes

| Check | Step | 1280 | 375 | 320 |
|---|---|---|---|---|
| Setup text and options have no "Fictional company site" and no "Not available for this driver and contract" | n237-setup | pass | pass | pass |
| "Before you submit" wording has no "For a replacement"; declarations are exactly `terms` and `driver` | n237-summary | pass | pass | pass |
| Account after order shows "Your order is in progress" and not "No current car" | n237-account-after-order | pass | pass | pass |

Visible at 320: `browser/320-02-n237-setup-saved.png`, `browser/320-06-n237-summary-wording.png`, `browser/320-10-n237-account-after-order.png`.

## Keyboard notes

Every control was reached by Tab and activated with Enter or Space (Start a new order, Continue, Review this car, each declaration, Submit, Finish). Submit stayed disabled until both declarations were ticked.

## Rerun

```sh
WALK_STORY=fucq237 WALK_CHUNK=desktop|phone|narrow WALK_SCRATCH=<owned dir> node docs/gcsp/evidence/fucq70/browser-walkthrough.mjs
```

Default ports 8930, 8931, 8932. Results are in `results-<chunk>.json`, screenshots in `browser/`.

## Cleanup

Each chunk's Chrome and `node index.js` exited, no leftover process was found, and the scratch profiles and logs were removed by absolute path.
