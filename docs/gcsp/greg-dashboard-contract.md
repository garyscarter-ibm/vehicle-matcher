# GCSP Greg dashboard contract

> **Migration design overlay — 13 November 2026.** The [current architecture decisions](../design/migration-decisions-2026-11-13.md) and [replacement contracts](migration-replacement-contracts-2026-11-13.md) govern the Angular 21 / Java 21 / Quarkus 3.x target. Greg uses his own OIDC login for fleet/policy/planning/comparison commands. Presenter can inspect authorized read-only views, never execute Greg's actions. Preserve frozen capabilities/visuals; unapproved later Greg mockups are separate product proposals. Java owns business calculations/jobs; no Node execution or permanent legacy controllers. The material below retains its original source, implementation and acceptance evidence; this overlay does not amend a claimed Story's acceptance or prove replacement delivery.

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
| banded | Counts below the policy threshold show as plain "<N" (spoken as "fewer than N"); no number is derived. |
| conflict | The message and Refresh. |
| unavailable | `role="alert"` with Retry; `onUnavailable` is called. |
| refused | `role="alert"`, no figures, no Retry, reserved regions hidden. |

The meta strip shows the demo-clock time, policy and brief versions, the basis ("Expressed saved demand", not satisfaction or a prediction) and the privacy note. Refresh keeps focus on the Refresh button and announces "Figures updated for <time>" in a `role="status"` line.

## Reserved regions

Five empty, labelled `<section>`s below the live figures hold the places for later work, with one honest line each and no figures: `data-region="publish"`, `"order-tracking"`, `"prediction"` (FUCQ-74), `"route-comparison"` (FUCQ-138) and `"case-queue"` (FUCQ-122). `teardown.regions` (and the element's `regions`) is `{ publish, orderTracking, prediction, routeComparison, caseQueue }`, the nodes later stories fill.

## Harness and CSP

`npm run serve`, then `/gcsp-greg.html?fixture=<name>`; `harness.js` accepts only listed names. No inline script bodies, `on*=` attributes, `eval`, `new Function`, string timers or HTML string injection under `blocks/gcsp/greg/`, `blocks/gcsp/kit/` or in the page (checked by `server/test/gcsp-greg-dashboard.test.js`). The element never reads location.

## Portal navigation, 11 November 2026

The shared GCSP sidebar exposes **Employee car ordering** to a ready server-owned account with role `greg`. This is the existing ordering-administrator role; Greg Lawson already has it in the canonical principal configuration. Names and display context do not grant access. Employee accounts keep their employee destinations. Greg Lawson also has the `employee` role and his own `slot-greg` entitlement: his rail combines Your cars, Buddy activity, Order progress and Employee car ordering on both personal and team pages. His personal preferences and Buddy use his existing `operator-greg` identity, separately from Paula. The ordering dashboard shows no role-specific links until its account resolves, and its existing server page/API guards remain authoritative.

The sidebar destination uses `/gcsp-greg.html` through the shared portal route helper. Its six sections are shared-kit tabs in the page, retaining the same header/sidebar and mounted adapters: Next order, Demand and supply, Policy, Order requests, Route comparison and Renewal cases. Next order remains the initial view when its adapter is supplied. Selection preserves the active sidebar icon, all existing region handles, and the stable `gcsp-order-requests` anchor. Tabs retain arrow/Home/End keyboard navigation and have 44px minimum targets below 600px.

Verified delivery and resource evidence: [ordering-navigation-2026-11-11.md](ordering-navigation-2026-11-11.md).
