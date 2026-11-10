# FUCQ-361: no presenter controls on Paula's or Greg's pages

Captured 10 November 2026 at 1280 x 900, headless Chrome (playwright-core), same-origin host
`GCSP_RUNTIME=1 GCSP_REPOSITORY_MODE=memory GCSP_OFFLINE=1` on port 9591, signed in through `/gcsp/login`.

| File | Page | Result |
| --- | --- | --- |
| `1280-paula-your-cars.png` | `/gcsp-account.html` (Your cars) | No presenter rail item, flyout or region; no presenter-controls script or stylesheet requested |
| `1280-paula-preferences.png` | `/gcsp-brief-live.html` (Your preferences) | Same |
| `1280-greg-dashboard.png` | `/gcsp-greg.html` (Next order) | Same |

Paula's offer page was not captured: her account had no current offer link in a fresh memory run.

Cross-tab refresh on an open Paula account page: an unrelated `localStorage` key caused 0 API reads;
writing `gcsp:presenter-action` from a second tab caused one re-read (account, draft, current offer,
activity, order progress). The rail ends at its last item with no gap where the Presenter item was.
