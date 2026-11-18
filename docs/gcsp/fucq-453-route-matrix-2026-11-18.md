# FUCQ-453 route and capability matrix (18 November 2026)

Story DEV-2026-11-13-021 (FUCQ-453, E2.S15): retire the legacy GCSP entry pages once Angular serves the same route.
This matrix is the plan for that retirement. It is checked against the actual build output, not against a diagram.

- Tested tree: `86eab38d2` on `dev/DEV-2026-11-13-021`. `origin/gcsp-poc-dev` at `02e60b476` adds only inbox commits.
- Build: `_tools/test_stack_build.py build web` produced `build/web/eeed34a44eec…/browser` with 31 JS files.
  Every route below appears as a `path:"…"` entry in that bundle.
- Source of the legacy-to-replacement mapping: `docs/gcsp/migration-baseline-2026-11-13.md`, "Pages and route ownership".

## Legacy entry to Angular route

| Legacy entry (root page and block) | Angular route in the build | Replacement Story on base | Disposition |
| --- | --- | --- | --- |
| `gcsp-account.html`, `gcsp-manual-setup.html`, `gcsp-manual-gallery.html`; blocks `account`, `manual-setup`, `manual-gallery`, `manual-review`, `manual-summary` | `/gcsp/account`, `/gcsp/stock`, `/gcsp/manual/review`, `/gcsp/manual/summary` | FUCQ-440, 442, 443 done | Retired (d87422fcc). `gcsp-manual-gallery.html` and its block stay: the protected component gallery links to it |
| `gcsp-employee.html`, `gcsp-brief.html`, `gcsp-brief-live.html`; blocks `employee`, `brief` | `/gcsp/preferences` | FUCQ-441 done | Retired (d87422fcc). `employee/gcsp-employee.js` and `harness.js` stay: `gcsp-help.html`, the gallery and `docs/gcsp/density/preview.html` use them |
| `gcsp-activity.html`, `gcsp-activity-live.html`; block `activity` | `/gcsp/activity` | FUCQ-444 done | Retired (4ce3fbc50) |
| `gcsp-offer.html`, host alias `/gcsp/offer`; blocks `offer`, `offer-followup` | `/gcsp/offers/:offerId`, follow-up included | FUCQ-445 done | Retired (5a7c596c3). FUCQ-510 is the Java decline-reason registry: an API gap, not a frontend one |
| `gcsp-order-progress.html`, `gcsp-order-progress-live.html`; block `order-progress` | `/gcsp/orders` | FUCQ-446 done | Retired (4ce3fbc50) |
| `gcsp-presenter.html`; block `presenter-controls` | `/gcsp/presenter` | FUCQ-450 done | Kept: Russell's lane changed `gcsp-presenter.html` on 18 Nov (9fa2b175b). Coordinate with that lane |
| `gcsp-outbox.html`; block `presenter` | `/gcsp/presenter/outbox` | FUCQ-451 done | Retired (4ce3fbc50) |
| `gcsp-help.html`; block `cases` (`harness.js`) | `/gcsp/help` | FUCQ-447 waiting | Keep until FUCQ-447 |
| `gcsp-case-queue.html`; block `cases` (`queue-harness.js`) | `/gcsp/greg/cases` | FUCQ-447 waiting | Keep until FUCQ-447 |
| `gcsp-greg.html`; blocks `greg` (demand, `plan`, `publish`, `comparison`), `greg-orders` | `/gcsp/greg` is still a placeholder state page; `/gcsp/comparison` | FUCQ-448, 449 blocked; FUCQ-452 blocked (Greg runs) | Keep until all three |
| `gcsp-login.html`, host `/gcsp/login`; block `login` | `/gcsp/sign-in`, `/gcsp/auth/callback` | FUCQ-439 done | Keep: still the only sign-in for the kept legacy pages (help, cases, Greg). Retire with the last of them |

## Kept because something still uses it

These are not entry points or page controllers, so FUCQ-453 doesn't retire them.

- `blocks/gcsp/shell/`: the Angular build loads `gcsp-shell.css` (`apps/gcsp-web/angular.json`); the launcher and the kept pages use it too.
- `blocks/gcsp/kit/`: `server/gcsp/clock/start-day.js` and `server/gcsp/notify/templates.js` import it, and so do `blocks/vehicle-matcher/gcsp-kit.css` and the component gallery.
- Body and fixture modules imported by the shared component gallery (`blocks/vehicle-matcher/component-gallery.js`, `components.html`):
  `activity/activity-body.js`, `activity-offer.js`, `activity-fixtures.js`, `activity-copy.js`; `order-progress/order-progress-body.js`, `fixtures.js`;
  `manual-gallery/gallery-model.js`, `fixtures.js`; `offer/fixtures.js`; `presenter/message-list.js`, `fixtures.js`;
  `presenter-controls/controls.js`; `employee/gcsp-employee.js`. Retiring them means changing the gallery, which is a separate decision.

## Handoffs and aliases (AC2)

| Place | Now | Change for the retired pages |
| --- | --- | --- |
| `blocks/demo-launcher/employee-entry.js`, `entry-context.js` | Employees go to the Angular `/gcsp/` | None needed |
| `render.gcsp.yaml`, `gcsp-site` | Copies `gcsp-employee.html`/`.css` and redirects 13 legacy paths to `gcsp-api` | Remove the copy and the redirects for retired pages |
| `server/gcsp/host.js` | `SESSION_PAGES`, `presenterPage`, `landing` and `publicPath` list the legacy pages | Drop the retired pages. Employee landing moves off `gcsp-account.html` |
| `server/gcsp/identity/index.js` | Login `redirectTo` is `gcsp-account.html` for employees | Same change as `landing` |
| `scripts/gcsp-demo.mjs` | Prints the `gcsp-account.html` and `gcsp-presenter.html` addresses | Print the replacement routes |
| `blocks/vehicle-matcher/component-gallery.js` | Links to `./gcsp-manual-gallery.html?fixture=available` | Remove the link |
| `scripts/assemble-site.mjs` | `demoPages` expects `gcsp-offer.html` and `gcsp-outbox.html` | Drop those rows |

Used Cars is unaffected: `blocks/vehicle-matcher/vehicle-matcher.js`, `server/index.js` retail routes, `render.yaml` and the launcher's retail path need no change.
140 `server/test` files import one of the blocks that are ready to retire. Each is deleted or trimmed with its module.

## Built on 18 November 2026

The dispatcher ruled that this Story may retire files Russell co-wrote, except files his lane changed in the last 24 hours.
Commits on `dev/DEV-2026-11-13-021`:

- `ae69e6f6b`: host, identity, login landing, blueprint aliases, demo script and assembler. Employees now land on `gcsp-help.html`.
- `d87422fcc`: account, manual, brief and employee entry.
- `5a7c596c3`: offer and follow-up.
- `4ce3fbc50`: activity, order progress and outbox.
- `442dd26c1`: the manual-review proof script.

Body, fixture and stylesheet modules stay where a kept file uses them: the gallery, the `ui-ratchet.json` stylesheet caps, or the kept pages.

## Coordinate with Russell's lane

These items aren't retired, because the files involved changed in the last 24 hours:

- `gcsp-presenter.html` and `blocks/gcsp/presenter-controls/`.
  - `console.js` still links `gcsp-account.html`, which `gcsp-presenter-console.test.js` asserts.
- `blocks/vehicle-matcher/component-gallery.js` still links `gcsp-manual-gallery.html`, so that page stays.
- `blocks/gcsp/kit/form-controls-gallery.js` has example hrefs to `gcsp-offer.html` and `gcsp-activity-live.html`.
- `server/test/ui-ratchet.json` caps stylesheets of retired blocks, so those CSS files stay.
- `COMPONENTS.md` still describes the retired mounts:
  - `mountBrief`, `mountAccount`, `mountManualSetup`, `mountManualReview` and `mountManualSummary`;
  - `mountOffer`, `mountActivity` and `mountOutbox`.

## Still to do

- Help, cases, Greg and the legacy login wait for FUCQ-447, 448, 449 and 452.
- The hosted audit waits for FUCQ-436 and FUCQ-437, which need Gary's Render dev environment.
- These evidence scripts under `scripts/gcsp/` still name retired pages:
  - `capture-account-prefs.mjs`
  - `fucq371-offer-capture.mjs`
  - `walk-buddy-engagement.mjs`
  - `walk-fucq371-feedback.mjs`
