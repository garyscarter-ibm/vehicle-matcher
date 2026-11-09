# FUCQ-280 browser evidence: arrival focus

Commit tested: 89cedf5f (branch dev/DEV-2026-11-09-GC-058). Memory runtime over local HTTPS, system Chrome, Paula's journey, 1280x900 and 375x812.

Rerun (TMPDIR must be an owned scratch dir; FUCQ280_PORT 9460-9464, default 9460):
`GCSP_OFFLINE=1 TMPDIR=<scratch> perl -e 'alarm 600; exec @ARGV' node --test --test-force-exit --test-concurrency=1 docs/gcsp/evidence/fucq-280/browser-check.test.mjs`

Pages (`<width>-<name>.png`, full page): your-cars (/gcsp-account.html), brief (/gcsp-brief-live.html), activity (/gcsp-activity-live.html), offer (pending offer, captured once "Accept this offer" shows), plus `1280-your-cars-keyboard.png`.

results.json records, per capture and with no user input: the focused element (tag, text, whether it is the page h1), its computed outline and the stylesheet rules matching it,
content start x (main, first child, first text block, h1), breadcrumb and kicker text, rail buttons with aria-disabled and visibility, the presenter bar rect and left edge versus the h1, and horizontal overflow.
The keyboard block (1280, Your cars) records Tab, Shift+Tab and the h1 focused by script after keyboard input; each must show an outline.

Notes: the presenter bar is 0x0 for Paula (hidden), so no strip is measured. The rail is hidden at 375. To reuse for a sibling story, change STORY, PORT_ENV, PORT_MIN and PAGES at the top of the script.
