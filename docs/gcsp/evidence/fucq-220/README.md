# FUCQ-220 browser evidence: order reference and car order number

Commit tested: 7540439a plus the account order card placement fix committed with this evidence (branch dev/DEV-2026-11-08-GC-037). Memory runtime over local HTTPS, system Chrome, 1280x900 and 375x812.

Rerun (TMPDIR must be an owned scratch dir; FUCQ220_PORT 8990-8999, default 8990; PORT+1 serves static fixtures):
`TMPDIR=<scratch> perl -e 'alarm shift; exec @ARGV' 600 node --test docs/gcsp/evidence/fucq-220/browser-check.test.mjs`
Writes the PNGs and results.json here. Manual order is reached by API to a claimed car, then Resume, Continue to order review, declarations and Submit order in the page.

PNGs (`<width>-<name>.png`, full page): buddy-handoff (1, accepted offer), order-progress (2, live page), account-order-card (3),
manual-confirmation (4, after Submit order; `1280-manual-confirmation-print-media.png` is the same page under print media),
account-order-history (5, history section only), earlier-order-progress and offer-selection-no-hr (6, static fixtures;
the offer fixture is blocks/gcsp/offer/preview.html?fixture=selection-no-hr, since gcsp-offer.html?fixture= is not a fixture host).

Results: 14 of 14 screen/width checks pass, no page errors, no horizontal overflow. Values seen: Order reference GCSP-000001 with a 7-digit car order number.
Print: Print order called window.print once; both identity rows displayed in print media, none in a print-hidden ancestor.
History rows show "Car order number: Not supplied" (demo records carry no number or reference); no reference shown.
Earlier-order fixtures show only "Car order number" (1000001, 0123456).
Keyboard (Tab, cap 40): screen 3 reaches "View order progress", screen 4 reaches "Print order" (tabbed after Submit, not from first load); focus ring visible on every stop.
Screen 1 has only header controls and "Check current state" focusable, so Tab cycles.

Account order card: the first run found the facts flush against "View order progress" (gap 0). Fixed by placing the facts under the title; the rerun records gapFactsToLinkPx 51 (1280) and 48 (375).
Note: the buddy confirmation and the manual confirmation also repeat the car number on the car card ("ORDER NO." / "CAR ORDER" overlay and a Car order number fact).

Cleanup: Chrome profile root removed by the test, scratch tmp empty, no process left matching the profile path.
