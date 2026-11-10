# FUCQ-332 rendered check

Offer page `blocks/gcsp/offer/preview.html` in headless Chrome (playwright-core), static `scripts/serve.js` on port 9560, with the preview's read port swapped for one the capture could hold open and answer. Every check was pressed by keyboard (focus, Enter). Captured 10 November 2026 on branch `dev/DEV-2026-11-10-GC-022`.

| File | State | Line under the button |
| --- | --- | --- |
| `375-pending.png` | read in flight, expired offer | Checking the current offer state. |
| `1280-unchanged.png` | same offer read back | Check complete. Nothing has changed. |
| `375-changed-accepted.png` | pending offer read back as accepted | Check complete. Current state: accepted. |
| `1280-error.png` | readback unavailable | Check not completed. Try again in a moment. (button reads Try again) |

All ten captures (both widths, five states including a recovered retry) showed the expected line, focus-visible on the check control, no horizontal overflow, and the result in the one view status region (the pending text is visible only, so a check is announced once). The only console errors were 404s for `/api/gcsp/context` and `/api/gcsp/presenter/controls`, which the static server does not provide. An independent critique found no layout defect; its wording findings were acted on.
