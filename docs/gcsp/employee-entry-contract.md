# GCSP employee entry contract

Slice 1 of FUCQ-64 (DEV-2026-11-04-037). This is the surface FUCQ-35 consumes. FUCQ-64 does not depend on FUCQ-35, and the public launcher stays unavailable: `ENTRY_REGISTRY.employeeAvailable` in `blocks/demo-launcher/entry-context.js` remains `false`. The entry never reads or writes `window.location` or `history`, and the existing route serializer in that file is the only one.

## Element

Tag `gcsp-employee`, light DOM, defined by `defineGcspEmployee(registry = customElements)` in `blocks/gcsp/employee/gcsp-employee.js` (idempotent; `blocks/gcsp/employee/register.js` calls it). Styles: `blocks/vehicle-matcher/vehicle-matcher.css`, `blocks/gcsp/shell/gcsp-shell.css` and, for the representative body, `blocks/gcsp/employee/gcsp-employee.css`.

| Attribute | Default | Meaning |
|---|---|---|
| `brand` | `bmw` | Anything other than `bmw` renders an honest unavailable state (employee cars are BMW only at first). |
| `view` | `cars` | Active destination key from the navigation. Changing it switches view without remounting. |
| `fixture` | none | Explicit fixture name from `FIXTURE_NAMES` in `fixtures.js`; an unknown name renders the account as unavailable. `representative` (synthetic account, current car and three stock cars), `representative-loading` (account never resolves, still aborts), `representative-unavailable` (account unavailable, body shows a status screen) and `representative-no-images` (same data, every photo absent). |

Property `adapter`: `{ loadAccount({ signal }) -> Promise<account>, renderBody?(main, { view, account, label }) -> cleanup?, navigation? }`. It takes precedence over `fixture`. Account data comes only from an adapter or a named fixture; a URL employee id or shared password is never identity. With neither, the account shows as unavailable.

Account state: `{ status: 'ready', name, initials?, context }`, `{ status: 'unavailable', message }` or `{ status: 'loading' }`.

## Events

All dispatched on the element with `bubbles: true, composed: true`.

| Event | Detail | Notes |
|---|---|---|
| `gcsp:ready` | `{ view, brand }` | After mount, bmw only. |
| `gcsp:navigate` | `{ from, to }` | Cancelable. If not prevented the element sets its `view` attribute. A host that owns routing calls `preventDefault()` and updates its own state. Only available destinations emit it. |
| `gcsp:unavailable` | `{ reason }` | `brand-not-supported`, `no-adapter`, `unknown-fixture` or `account-unavailable`. |

## Function form

`mountEmployee(root, { brand, view, loadAccount, renderBody, navigation, signal, onNavigate, onUnavailable })` returns a teardown function (with `setView(key)` and `getView()`). Teardown aborts the in-flight `loadAccount` signal, runs the body cleanup, destroys the shell and leaves `root` empty. An external `signal` aborting does the same load abort.

## Navigation context

`EMPLOYEE_NAVIGATION` (frozen): `cars` "Your cars" (available), then `order` "New order", `history` "Order history", `drivers` "Drivers and licences", `help` "Scheme guidelines". The last four are honestly unavailable: a `button` with `aria-disabled="true"`, an explanation ("Not available in this demo") and no navigation. Items are `{ key, label, icon, available, unavailableReason }`.

## Embedding rules

No inline script bodies, `on*=` attributes, `eval`, `new Function`, string timers or HTML string injection under `blocks/gcsp/` or in `gcsp-employee.html` (checked by `server/test/gcsp-shell.test.js`). Harness: `npm run serve`, then `/gcsp-employee.html?fixture=representative-no-images`. `blocks/gcsp/employee/harness.js` reads `?fixture=` from the page URL, accepts it only if it is in `FIXTURE_NAMES`, sets the element's `fixture` attribute and registers the element. The element itself still never reads location.

## Representative body

`renderRepresentativeBody(main, { account, data })` in `blocks/gcsp/employee/representative-body.js` is the fixture `renderBody`. Fixture points values carry their policy key and version (`gcsp-policy-v1`), marked assumed and synthetic, and a test checks them against `server/gcsp/policy/seed-v1.json`. Stock cars show a 7-digit order number and have no VIN; only the current car has a (synthetic) VIN. Nothing reserves, orders or saves.
