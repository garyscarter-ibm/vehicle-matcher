# FUCQ-375 notification bell: live check

Run 10 November 2026 at 1280 x 900, headless Chrome, against the hosted entry (`GCSP_RUNTIME=1`, memory repository) of commit 5f0e9d7f.
Two tabs in one browser: the presenter console and Paula's portal, signed in as Paula. `live-check.mjs` is the scratch script; `live-check-result.json` holds every step.

| Check | Result |
|---|---|
| Bell left of the account, "Notifications, none waiting", on Your cars, Buddy activity, Order progress, Renewal help and Your preferences | Pass |
| Console Release in the other tab: badge "1" appears on Paula's open page with no navigation or reload | Pass |
| Note "Your buddy found a car. BMW 3 Series Touring 320i. Respond by 13:30." shown and announced once by the live region | Pass |
| Panel by keyboard: aria-expanded, aria-controls, offer row with thumbnail, "Reserved for you. Respond by 13:30.", "View your offer" | Pass |
| Escape closes and returns focus to the bell; bell and account menu close each other | Pass |
| "View your offer" opens `/gcsp/offer`; the badge stays | Pass |
| No em dashes on screen; no page errors | Pass |

Screenshots: `1-searching.png` (frame 1), `2-note.png` (frame 2), `3-open.png` (frame 3), `4-offer.png` (frame 4).
Not covered live: frame 5 (accept or expiry clearing the badge) and the 30-second poll; both are covered by `server/test/gcsp-notification-bell.test.js`.
