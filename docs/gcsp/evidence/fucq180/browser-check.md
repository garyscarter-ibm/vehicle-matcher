# FUCQ-180 browser check (hosted entry, memory runtime, port 8791)

Worktree: DEV-2026-11-07-GC-019 at 5d086ccf. Server started as `node index.js` with GCSP_RUNTIME=1, GCSP_REPOSITORY_MODE=memory, DEMO_ACCESS_KEY (throwaway), PORT=8791, GCSP_PUBLIC_ORIGIN=http://localhost:8791, GCSP_OFFLINE=1 (as the test sets). No mail or Brevo variables set.

Screenshots: the browser tool returns images inline and cannot write PNG files, so no `NN-step-width.png` files were saved. What each screenshot showed is listed below.

| Step | Result | Evidence |
|---|---|---|
| 1 Presenter at 1280 | PASS | Access key form accepted; presenter page loaded (title "GCSP presenter workspace"). Screenshot: Paula's "Your cars" view, Presenter controls collapsed, "Fictional BMW 320i Touring", contract ends 1 Dec 2026. |
| 2 Reset and tick to an offer | FAIL (partial) | "Main successful journey" is listed as "Not available yet" and its Reset button stayed disabled. Selected "Decline then change" (Available) and Reset ran (POST /presenter/scenarios/reset 200). Afterwards no acting principal was set ("Choose an acting principal in Presenter controls"). Switching to Paula was blocked (the radio sat in a clipped panel, not clickable). Tick POST not seen. No offer was created. |
| 3 Paula offer page, no fixture | FAIL | /gcsp-offer.html shows "Offer not found. The current offer could not be loaded." Not "Workspace unavailable". No presenter link to Paula's page exists. /gcsp-employee.html returns 401 `{"error":"Unauthorized"}` when opened directly. |
| 4 Greg and outbox | PASS (outbox partial) | /gcsp-outbox.html shows live data: 1 captured email, "Paula (fictional), Your vehicle offer is ready to review, 5 Nov 2026 09:30 GMT+0, Sent". This predates the reset. /gcsp-greg.html shows live figures: 28 active briefs, 9 with no suitable car, 30 offers, 7 selected, as at 5 Nov 2026 09:40. |
| 5 Keyboard | PARTIAL | On the presenter page, Tab x4 focused the "Presenter controls" summary with a visible 2px solid outline. Tab x7 reached the "Show labels" button, also outlined. Reset, Tick and offer actions were not reached by keyboard. Paula's offer page was not testable (no offer). |
| 6 375 x 812 | PASS (no overflow) | Presenter: scrollWidth 375 = innerWidth 375, no overflowing elements. Offer page: same, showing "Offer not found". No overlap was checked visually. |
| 7 Restart with old cookies | PASS (presenter) / FAIL (offer) | Server stopped (pid 89407), restarted with the same command (new pid 91281), /health 200. Same tab: presenter loaded straight into the workspace with no access-key prompt and no "Workspace unavailable" or 409. Offer page still "Offer not found" (no offer, not a restart failure). One 403 on GET /api/gcsp/manual/account was seen earlier in the request log. |
| 8 Console errors | see below | Tab-level console errors: 404, 401, 403, 403, 404. These are not attributed per page. |
| 9 Desktop preset | PASS | Viewport emulation cleared. |
| 10 Stop and lsof | PASS | Server SIGTERM'd, `lsof -nP -iTCP:8791` returns nothing. |

Console errors (tab session, not per page): Failed to load resource 404, 401 (from the direct /gcsp-employee.html load), 403, 403, 404. The GET /api/gcsp/manual/account 403 was seen in the request log.

Not done or not verified: the offer flow (steps 2, 3, 5 on Paula's offer page), a real captured offer after restart, and visual checks at 375 wide.
