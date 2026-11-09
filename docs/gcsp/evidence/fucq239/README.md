# FUCQ-239 keyboard walk: new-order handoff wording and Order history

Base: fix commit `ecd4cf9a` (branch `dev/DEV-2026-11-09-GC-008`). Keyboard only (Tab, Arrow keys, Enter, Space; Shift+Tab was not needed), offline host (`GCSP_RUNTIME=1`, `GCSP_REPOSITORY_MODE=memory`, `GCSP_OFFLINE=1`, random demo key, ports 8930 to 8932), headless Chrome with every non-loopback request blocked (none were attempted).

Two fixes under test:

1. Buddy offer page, "Before you accept": the terms paragraph comes from `ordering.terms.v1` `wordingByMode[mode]`, else `wording`. A new-order employee (Jordan) must see the `wordingByMode.new` text, with no "replacement" sentence and no return declaration. A replacement employee (Paula) keeps `wording` and the return declaration. The expected texts are read from `server/gcsp/policy/seed-v1.json` by the script, not typed.
2. Account, "Order history": after an order is placed the section lists it (car name heading, Status, Order reference, Car order number) and no longer says "No order history." Before: `../fucq237/browser/320-10-n237-account-after-order.png`.

## Result in one paragraph

Paula (replacement): handoff wording, declarations and return rows pass at 1280, 375 and 320; her accepted offer shows in Order history. Jordan (new order): Order history after a manual order passes at all three widths. **Jordan's buddy-offer handoff could not be reached in the browser**: see "Blocker". Every step that could run passed, with 0 px horizontal overflow, 0 page errors, no em dash, no coloured side stripe in the two changed sections, and a visible focus indicator on every activated control (60 of 60 keyboard checks per width).

## Steps per width (1280x900, 375x812, 320x700)

Part A, hosted demo, one host:

| Id | Step | 1280 | 375 | 320 |
|---|---|---|---|---|
| a1-access | Demo key, open Presenter controls | pass | pass | pass |
| a1-jordan-brief | Switch to Jordan, save his brief by keyboard (Saloon, five seats, no boot or towbar need, no charging, search and hold) | pass | pass | pass |
| a1-release | Presenter Next release (default scenario, Jordan the only participant) | blocked | blocked | blocked |
| a1-jordan-offer | Jordan: captured email, Open the offer, handoff wording | blocked | blocked | blocked |
| a1-jordan-activity | Evidence for the blocker: Jordan's Buddy activity and brief preview | pass | pass | pass |
| a2-reset | Reset into Main successful journey | pass | pass | pass |
| a2-release | Next release | pass | pass | pass |
| a2-paula-offer | Paula: outbox row, Enter on Open the offer, handoff wording, declarations, return rows | pass | pass | pass |
| a2-paula-accept | Paula ticks three declarations (Space), Accept this offer (Enter) | pass | pass | pass |
| a2-paula-account | Paula's account: Order history lists the accepted order | pass | pass | pass |

Part B, fresh host, Jordan's manual new order:

| Id | Step | 1280 | 375 | 320 |
|---|---|---|---|---|
| b-account | Switch to Jordan; Order history says "No order history." before any order | pass | pass | pass |
| b-setup | Start a new order, setup saved | pass | pass | pass |
| b-gallery | Continue, Next release, released cars | pass | pass | pass |
| b-review | Review this car, active countdown | pass | pass | pass |
| b-order | Continue to order review, tick both declarations, Submit: Order received | pass | pass | pass |
| b-account-after-order | Finish; Order history lists the order, no "No order history." | pass | pass | pass |

## Checks

| Check | Result (all three widths) |
|---|---|
| Paula handoff wording equals `wording`, contains "For a replacement", declarations terms, driver and return, rows Car to return, Contract end date, Recorded odometer | pass |
| Order history entry: car-name heading, Status, Order reference, Car order number (7 digits, equals the outcome page's number for Jordan's manual order) | pass for Jordan (manual order) and Paula (accepted buddy offer) |
| "No order history." absent after an order, present before one (Jordan) | pass |
| Horizontal overflow | 0 px on every step |
| Page errors | 0 |
| Em dash (U+2014) in visible text | 0 on every step |
| Border-left or border-right wider than 1px in a visible colour, or inset side shadow, inside "Before you accept" and "Order history" | none (29 and 25 to 303 elements scanned) |
| Visible focus on the activated control | 60 of 60 keyboard checks per width |
| External requests | 0 attempted |

Console errors and 4xx responses (26 per width) are expected states: 404 on `manual/draft`, `manual/order`, `manual/claim` before they exist, 400 on `manual/stock` before a release, one 409 on `brief/preview` and one on `presenter/controls` around a scenario reset, and the 503 below.

Not shown by this data: the "Vehicle slot" row. It renders only when the slot has a label, and neither employee's slot has one in this demo data, so no entry showed it.

## Blocker: Jordan cannot get a buddy offer

Jordan can save a brief through `/gcsp-brief-live.html` and the preview then lists 5 eligible cars. As soon as he is an eligible contender with hold consent, the presenter's **Next release** answers HTTP 503: handler `buddy-allocation`, code `renewal-deadline-unavailable`. No offer or email is created, so there is no offer page for Jordan. The cause is in `server/gcsp/allocation/index.js` (around line 193): a contender needs exactly one current contract with a `contractEndDate` as its renewal deadline, and Jordan has no current car. Without changing app code or seed data there is no route around it, and nothing was worked around.

The same failure happens in the Main successful journey when Jordan also saves a brief: the release then fails for everyone, Paula included (`results-1280-contention.json`, `browser-contention/`). In both cases Buddy activity reads "Couldn't check for new cars. Stock source unavailable." (`browser/*-01-jordan-buddy-activity.png`).

So Jordan's new-order wording (`wordingByMode.new`) is not browser-verified. It is covered by `server/test/gcsp-offer-access.test.js`. The step results mark a1-release and a1-jordan-offer as `blocker`, and the run state is `passed-with-blocker`. This is a separate defect (a new-order employee cannot take part in the buddy search); it is not part of FUCQ-239's two fixes.

## Keyboard notes

Every button, link, checkbox and radio was reached by Tab (radios by Tab then arrow keys) and pressed with Enter or Space, including the presenter strip (principal switch, scenario reset, Next release) and the outbox row and "Open the offer" link. Page loads of `/gcsp-brief-live.html`, `/gcsp-outbox.html` and `/gcsp-account.html` are by URL, because the demo has no in-app link to them. Setup form fields (selects, date, phone, email) are set with Playwright fill and select, as in the FUCQ-237 walk; their buttons are keyboard.

## Screenshots (`browser/`, `<width>-NN-name.png`)

`01-jordan-buddy-activity` (blocker), `02-paula-offer-handoff` (full page), `03-paula-before-you-accept` (the section), `04-paula-buddy-account-after-order`, `05-paula-buddy-order-history` (the section), `06-jordan-account-before-order`, `07-jordan-outcome`, `08-jordan-account-after-order` (full page), `09-jordan-order-history` (the section). The 320 captures were viewed: no clipping, wrapping as expected, no horizontal scroll.

## Rerun

```sh
export TMPDIR=<owned scratch dir>
WALK_CHUNK=desktop|phone|narrow WALK_SCRATCH=$TMPDIR perl -e 'alarm shift; exec @ARGV' 1500 node docs/gcsp/evidence/fucq239/browser-walkthrough.mjs
WALK_CHUNK=desktop WALK_PART=C WALK_ONLY=contention WALK_SCRATCH=$TMPDIR node docs/gcsp/evidence/fucq239/browser-walkthrough.mjs   # Jordan and Paula both eligible
```

Optional `WALK_PART=A|B` runs one part, `WALK_PORT` (8930 to 8949 only). Each chunk takes about 6 minutes. Results are in `results-<width>.json`.

## Cleanup

Each chunk's Chrome and `node index.js` exited on their own; `pgrep` for the walk's Chrome and `lsof` on ports 8930 to 8949 found nothing afterwards. The scratch directory (Chrome profiles, server logs, stock inventory) was removed by absolute path. Only this folder remains.
