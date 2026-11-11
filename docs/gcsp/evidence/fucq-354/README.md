# FUCQ-354 UK local time: live check

Run 11 November 2026 at 1280 x 900, headless Chrome, against the hosted entry (`GCSP_RUNTIME=1`, memory repository),
signed in as Paula, after a presenter Release. `live-check.mjs` is the scratch script; `live-check-result.json` holds every step.

| Screen | Result |
|---|---|
| Your cars, Buddy activity (before and with offer), the bell panel, Offer, Order progress, Renewal help, Released cars | No "UTC" text on any screen |
| Buddy activity | "Respond by 12 Nov 2026, 13:30", "Last check 12 Nov 2026, 11:30", no "All dates are UTC." note |
| Bell panel | "Respond by 13:30." |
| Page errors, em dashes | None |

Also checked at 1280 through the fixture harnesses: all 37 order-progress states (no "All times are UTC."; slot days and
times on the UK clock) and Buddy activity with a renewal case (Due reads "6 Nov 2026, 12:00", no "(UTC)").
In November UK time equals UTC, so values on screen match the old ones; the BST/GMT switch is covered by tests
(July against January) in `gcsp-activity-timeline`, `gcsp-plain-copy`, `gcsp-order-progress-kit` and `gcsp-notification-bell`.

Screenshots: `2-activity.png` (Buddy activity with offer), `3-bell.png` (bell panel open).
