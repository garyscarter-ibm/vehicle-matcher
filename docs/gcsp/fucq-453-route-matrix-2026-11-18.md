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
| `gcsp-account.html`, `gcsp-manual-setup.html`, `gcsp-manual-gallery.html`; blocks `account`, `manual-setup`, `manual-gallery`, `manual-review`, `manual-summary` | `/gcsp/account`, `/gcsp/stock`, `/gcsp/manual/review`, `/gcsp/manual/summary` | FUCQ-440, 442, 443 done | Retired (d87422fcc; `gcsp-manual-gallery.html`, its controllers and the gallery link in bc566e79f). `gallery-model.js` and `fixtures.js` stay for the component gallery |
| `gcsp-employee.html`, `gcsp-brief.html`, `gcsp-brief-live.html`; blocks `employee`, `brief` | `/gcsp/preferences` | FUCQ-441 done | Retired (d87422fcc). `employee/gcsp-employee.js` stays for the gallery; `harness.js` for `docs/gcsp/density/preview.html` |
| `gcsp-activity.html`, `gcsp-activity-live.html`; block `activity` | `/gcsp/activity` | FUCQ-444 done | Retired (4ce3fbc50) |
| `gcsp-offer.html`, host alias `/gcsp/offer`; blocks `offer`, `offer-followup` | `/gcsp/offers/:offerId`, follow-up included | FUCQ-445 done | Retired (5a7c596c3). FUCQ-510 is the Java decline-reason registry: an API gap, not a frontend one |
| `gcsp-order-progress.html`, `gcsp-order-progress-live.html`; block `order-progress` | `/gcsp/orders` | FUCQ-446 done | Retired (4ce3fbc50) |
| `gcsp-presenter.html`; block `presenter-controls` | `/gcsp/presenter` | FUCQ-450 done | Retired (4f940fea8, bc566e79f): the page, `harness.js`, `console.js`, `basic-console.js`, `basic-model.js`, the happened-feed, release and suitability sections. `controls.js` stays for the component gallery and now hands off to `/gcsp/presenter` |
| `gcsp-outbox.html`; block `presenter` | `/gcsp/presenter/outbox` | FUCQ-451 done | Retired (4ce3fbc50) |
| `gcsp-help.html`; block `cases` (`harness.js`) | `/gcsp/help` | FUCQ-447 done | Retired (b53fce9d6 page and harness, 3600bca22 the `cases` block) |
| `gcsp-case-queue.html`; block `cases` (`queue-harness.js`) | `/gcsp/greg/cases` | FUCQ-447 done | Retired (bc566e79f page, 3600bca22 `gcsp-case-queue.js`) |
| `gcsp-greg.html`; blocks `greg` (demand, `plan`, `publish`, `comparison`), `greg-orders` | `/gcsp/greg`, `/gcsp/greg/plan`, `/gcsp/comparison` | FUCQ-448, 449, 452 done | Retired (b53fce9d6 page and harness, 3600bca22 `gcsp-greg.js`, demand view, `greg-orders`, the custom-element wrappers). The plan, publish and comparison views stay for the component gallery |
| `gcsp-login.html`, host `/gcsp/login`; block `login` | `/gcsp/sign-in`, `/gcsp/auth/callback` | FUCQ-439 done | Retired (b53fce9d6 page, host `/gcsp/login`, blueprint redirects; 3600bca22 view, controller, CSS). `login/http-adapter.js` stays: the shared shell's sign-out uses it |

## Kept because something still uses it

These are not entry points or page controllers, so FUCQ-453 doesn't retire them.

- `blocks/gcsp/shell/`: the Angular build loads `gcsp-shell.css` (`apps/gcsp-web/angular.json`); the launcher and the kept pages use it too.
- `blocks/gcsp/kit/`: `server/gcsp/clock/start-day.js` and `server/gcsp/notify/templates.js` import it, and so do `blocks/vehicle-matcher/gcsp-kit.css` and the component gallery.
- Body and fixture modules imported by the shared component gallery (`blocks/vehicle-matcher/component-gallery.js`, `components.html`):
  `activity/activity-body.js`, `activity-offer.js`, `activity-fixtures.js`, `activity-copy.js`; `order-progress/order-progress-body.js`, `fixtures.js`;
  `manual-gallery/gallery-model.js`, `fixtures.js`; `offer/fixtures.js`; `presenter/message-list.js`, `fixtures.js`;
  `presenter-controls/controls.js`; `employee/gcsp-employee.js`; `greg/plan/`, `greg/publish/`, `greg/comparison/` views, fixtures and `greg/demand-copy.js`.
  Retiring them means changing the gallery, which is a separate decision.

## Handoffs and aliases (AC2)

| Place | Now | Change for the retired pages |
| --- | --- | --- |
| `blocks/demo-launcher/employee-entry.js`, `entry-context.js` | Employees go to the Angular `/gcsp/` | None needed |
| `render.gcsp.yaml`, `gcsp-site` | Copied `gcsp-employee.html`/`.css` and redirected 13 legacy paths to `gcsp-api` | Done: no redirects left; it copies only `gcsp-employee.css` for the gallery |
| `server/gcsp/host.js` | `SESSION_PAGES`, `presenterPage`, `landing` and `publicPath` listed the legacy pages | Done: the host serves only `/blocks/`, `/assets/` and `gcsp-employee.css`; `GET /` answers 404 |
| `server/gcsp/identity/index.js` | Login `redirectTo` was a legacy page | Done: employee `/gcsp/account`, otherwise Greg `/gcsp/greg`, as Angular's `landingFor` |
| `scripts/gcsp-demo.mjs` | Printed legacy page addresses | Done: prints the API origin |
| `blocks/vehicle-matcher/component-gallery.js` | Links to `./gcsp-manual-gallery.html?fixture=available` | Remove the link |
| `scripts/assemble-site.mjs` | `demoPages` expected legacy direct pages | Done: none required |
| `blocks/gcsp/employee/portal-navigation.js`, `shell/portal-shell.js` | Rail keys and sign-out went to `/gcsp/login` or legacy pages | Done: Angular routes and `/gcsp/sign-in` |

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

## Built on 18 November 2026, after Russell's lane agreed (MSG-2026-11-18-GC-002)

- `4f940fea8`: `gcsp-presenter.html` and its page-only presenter-controls modules, the host presenter-page branch and
  `SESSION_PAGES` entry, the blueprint redirect, the demo-script line and the form-controls gallery hrefs (now
  `/gcsp/offers/gallery-1` and `/gcsp/activity`). `console.js`, and with it the PORTAL link to `gcsp-account.html`
  and its test, are gone. `/gcsp-presenter.html` now answers 404.
- `cad5dafed`: the hosted startup line names this host's `/gcsp/login`.
- `bc566e79f`: `gcsp-manual-gallery.html` and the gallery link, `gcsp-case-queue.html`, `basic-model.js`, seven
  orphaned stylesheets of retired blocks with their `ui-ratchet.json` caps (removed only), and the `COMPONENTS.md`
  rows for retired mounts.
- The hosted-entry journey that reset, ticked and released over the legacy origin needed the retired page's presenter
  cookie, so it now covers the 404, Paula's sign-in and the brief only. The in-process tests still cover reset, tick
  and offer. `createPresenterControlSession` (runtime and identity) has no production caller left; it is backend
  code, left for a later clean-up.

## Built on 19 November 2026, after FUCQ-447, 448, 449 and 452 merged

Parity checked on base 09945ec67 by route (`apps/gcsp-web/src/app/routes.ts`: `help`, `greg`, `greg/cases`,
`greg/plan`, `comparison`, `sign-in`, `auth/callback`) and by an import scan from every kept root (gallery, retail
pages, launcher, server and build scripts).

- `b53fce9d6`: `gcsp-help.html`, `gcsp-greg.html`, `gcsp-login.html` and their harnesses; the host's page gates and
  `/gcsp/login`; the four `gcsp-site` redirects; the identity `redirectTo`; the portal rail and sign-out routes.
- `3600bca22`: 32 page-only modules under `blocks/gcsp/{cases,greg,greg-orders,login}`, five ratchet caps (removed
  only), the retired `COMPONENTS.md` rows and the gallery links to the Greg harness.
- No legacy GCSP root page is left. Used Cars (`index.html`, `block.html`, retail API) is unchanged.

## Still to do

- The hosted audit is Gary's end-of-build review (FUCQ-436/437, step 7 of `docs/gcsp/fucq438-release-handover-2026-11-18.md`).
- Backend clean-up outside this Story: the Node password login and session API (`identity/`), `createPresenterControlSession`
  and the host's static serving have no browser page left; `blocks/gcsp/account/*` and `shell/account-runtime.js` are
  reached only by tests.
- These evidence scripts under `scripts/gcsp/` still name retired pages:
  - `capture-account-prefs.mjs`
  - `fucq371-offer-capture.mjs`
  - `walk-buddy-engagement.mjs`
  - `walk-fucq371-feedback.mjs`
