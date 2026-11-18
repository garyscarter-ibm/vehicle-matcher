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
| `gcsp-account.html`, `gcsp-manual-setup.html`, `gcsp-manual-gallery.html`; blocks `account`, `manual-setup`, `manual-gallery`, `manual-review`, `manual-summary` | `/gcsp/account`, `/gcsp/stock`, `/gcsp/manual/review`, `/gcsp/manual/summary` | FUCQ-440, 442, 443 done | Ready to retire |
| `gcsp-employee.html`, `gcsp-brief.html`, `gcsp-brief-live.html`; blocks `employee`, `brief` | `/gcsp/preferences` | FUCQ-441 done | Ready to retire. `employee/gcsp-employee.js` stays while `gcsp-greg.html` and the gallery import it |
| `gcsp-activity.html`, `gcsp-activity-live.html`; block `activity` | `/gcsp/activity` | FUCQ-444 done | Ready to retire |
| `gcsp-offer.html`, host alias `/gcsp/offer`; blocks `offer`, `offer-followup` | `/gcsp/offers/:offerId`, follow-up included | FUCQ-445 done | Ready to retire. FUCQ-510 is the Java decline-reason registry: an API gap, not a frontend one |
| `gcsp-order-progress.html`, `gcsp-order-progress-live.html`; block `order-progress` | `/gcsp/orders` | FUCQ-446 done | Ready to retire |
| `gcsp-presenter.html`; block `presenter-controls` | `/gcsp/presenter` | FUCQ-450 done | Ready to retire |
| `gcsp-outbox.html`; block `presenter` | `/gcsp/presenter/outbox` | FUCQ-451 done | Ready to retire. `presenter/http-adapter.js` stays while `greg-orders` imports it |
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

## Why the retirement isn't built yet

The story-lead brief for 18 November says to stop and ask before editing or deleting files Russell Gowers wrote
(`git log --format=%an -- <file>`). Every route that is ready to retire depends on such files:

- blocks with Russell commits: `activity` 13 of 13 files, `brief` 11 of 11, `offer` 12 of 15, `account` 5 of 10, `presenter` 3 of 8;
  `employee`, `manual-setup` and `order-progress` 2 each; `manual-gallery`, `manual-review`, `manual-summary`, `offer-followup` and `presenter-controls` 1 each;
- pages `gcsp-activity*.html`, `gcsp-brief*.html`, `gcsp-presenter.html`, `gcsp-login.html`;
- `server/gcsp/host.js`, `server/gcsp/identity/index.js`, `render.gcsp.yaml`, `scripts/assemble-site.mjs`,
  `scripts/gcsp-demo.mjs`, `blocks/vehicle-matcher/component-gallery.js`, `components.html`.

Russell's lane changed `gcsp-presenter.html` and `component-gallery.js` today (`9fa2b175b`, FUCQ-387), so this
needs coordinating as well as approving. Once approved, the work splits into two slices on this branch:

1. Retire the employee journey (account, manual, brief, employee entry, activity, offer, order progress), with the host,
   identity, blueprint, demo-script and gallery-link changes and their tests.
2. Retire presenter and outbox.

Help, cases, Greg and the legacy login wait for FUCQ-447, 448, 449 and 452. The hosted audit waits for FUCQ-436 and
FUCQ-437, which need Gary's Render dev environment.
