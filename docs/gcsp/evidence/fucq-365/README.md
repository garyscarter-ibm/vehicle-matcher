# FUCQ-365 Today's release: rendered check

Desktop 1280 only (Gary, 10 November 2026). Headless Chrome over CDP against `GCSP_RUNTIME=1 GCSP_REPOSITORY_MODE=memory GCSP_OFFLINE=1` on one local origin (port 9630), tree `dev/DEV-2026-11-10-GC-042` with FUCQ-362, FUCQ-364 and FUCQ-366 merged, using the real `GET /api/gcsp/presenter/releases/latest` route. Fixed run stock releases 6 then 3 cars here; a generated-stock release of 100 fills the 20-column grid to five rows.

| File | State |
|---|---|
| `01-before-release-1280.png` | After Start again: "Waiting for 11:30am", "No cars released yet", all four counters 0. |
| `02-cascade-mid-1280.png` | 300 ms after a keyboard Release: tiles still arriving (1 shown, 4 hidden, none an empty frame); counters still 0, counting up after the cascade. |
| `03-after-release-1280.png` | Grid filled, "Released Fri 6 Nov, 11:30am", Released 6, Model lines 4, Colours 2, On the scheme 5, model-line breakdown, then the What happened feed. |
| `04-keyboard-focus-1280.png` | Grid reached by one Tab from Open the portal; the focused tile has a 2px ring and its label tip ("BMW 3 Series Saloon 320i": no colour on fixed stock, so the model alone). |

Checked: one tab stop in the grid; ArrowRight, ArrowDown (clamped on one row), End, ArrowLeft, Home moved focus as expected; the next Tab left the grid. A second Release under emulated reduced motion showed every tile and final counters at once. A reload showed the existing release filled at once with no cascade. Start again (confirmed) returned the section to the waiting state. The section sits after the Start again confirmation and before the feed. No em dash, none of the banned words, no console errors, no broken images. The gallery's **GCSP release grid** section rendered all 12 images.

An independent critique by a runner led to three fixes: the first row's tip now sits below the tile and clamps inside the grid, the grid area keeps 200px so the counters don't jump after a release, and tiles carry a hairline edge so white cars read on the white card. Not adopted: proportional bars per model line (the story asks for a breakdown, and bars would need a new kit piece; `rangeBar` draws ranges, not counts).
