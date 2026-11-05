# GCSP Greg dashboard contract

FUCQ-101 (DEV-2026-11-04-064). Greg's demand and supply view over FUCQ-99's projection ([greg-demand.md](greg-demand.md)). It reads only; nothing is published, ordered or saved.

## Element

Tag `gcsp-greg-dashboard`, light DOM, `defineGcspGregDashboard(registry = customElements)` in `blocks/gcsp/greg/gcsp-greg.js` (idempotent; `register.js` calls it).

| Attribute or property | Meaning |
|---|---|
| `fixture` | Name from `FIXTURE_NAMES` in `fixtures.js`: `populated`, `after-release-decline`, `refresh` (populated, then after a release and a decline), `empty`, `no-stock`, `banded`, `unavailable`, `refused`, `conflict`, `loading`. An unknown name renders unavailable. |
| `adapter` | `{ loadDemand({ signal }) -> Promise<state> }`; takes precedence over `fixture`. `createGregHttpAdapter({ base, fetchImpl })` in `http-adapter.js` is the HTTP one. |

Events (`bubbles`, `composed`): `gcsp:ready` `{ view: 'dashboard' }` and `gcsp:unavailable` `{ reason }` (`no-adapter`, `unknown-fixture`, `source-unavailable` or `malformed-projection`). Methods: `refresh()`; getter `regions`.

`mountGregDashboard(root, { loadDemand, signal, onUnavailable })` is the function form. It returns a teardown with `refresh()` and `regions`. Teardown aborts the load and empties `root`.

## States

State is `{ status: 'ready', projection }`, `{ status: 'conflict' | 'unavailable' | 'refused', message }`. `toDashboardView` turns a projection into display data; a malformed one counts as unavailable.

| State | Shows |
|---|---|
| loading | A "Loading the demand figures" note. |
| ready | Meta strip, headline tiles, demand, unmet needs, offers and stock. |
| empty (`flags.noBriefs`) | A status explanation that no employee has confirmed a brief; meta strip and stock stay. |
| no stock (`flags.noStockReleased`) | Stock table row "No stock has been released yet"; unmet gates still show. |
| banded | Counts below the policy threshold read "fewer than N" and are described as a privacy band; no number is derived. |
| conflict | The message and Refresh. |
| unavailable | `role="alert"` with Retry; `onUnavailable` is called. |
| refused | `role="alert"`, no figures, no Retry, reserved regions hidden. |

The meta strip shows the demo-clock time, policy and brief versions, the basis ("Expressed saved demand", not satisfaction or a prediction) and the privacy note. Refresh keeps focus on the Refresh button and announces "Figures updated for <time>" in a `role="status"` line.

## Reserved regions

Four empty, labelled `<section>`s below the live figures hold the places for later work, with one honest line each and no figures: `data-region="publish"`, `"order-tracking"`, `"prediction"` (FUCQ-74) and `"route-comparison"` (FUCQ-132). `teardown.regions` (and the element's `regions`) is `{ publish, orderTracking, prediction, routeComparison }`, the nodes later stories fill.

## Harness and CSP

`npm run serve`, then `/gcsp-greg.html?fixture=<name>`; `harness.js` accepts only listed names. No inline script bodies, `on*=` attributes, `eval`, `new Function`, string timers or HTML string injection under `blocks/gcsp/greg/`, `blocks/gcsp/kit/` or in the page (checked by `server/test/gcsp-greg-dashboard.test.js`). The element never reads location.
