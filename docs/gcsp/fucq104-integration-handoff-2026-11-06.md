# FUCQ-104 integration handoff, 6 November 2026

F104 is blocked at canonical integration and final validation. The additive supply records/service/routes and shared-kit tracking block are reviewable on `dev/DEV-2026-11-04-089`. Storage checkpoint: `a53d711fe800625ab070b443a0bba69ebd7748d4`; service checkpoint: `6f57a05c538fa34361ba8594f152440ece851ed4`. The later UI/evidence checkpoint is the commit containing this record. The dispatcher owns publication/merge/Jira/claim routing. This document creates no new claim or story scope.

## Route the remaining work through existing ownership

| Boundary | Relevant owning story keys | Required handoff |
| --- | --- | --- |
| Order service and dashboard host | FUCQ-104, FUCQ-101 | GC owns central `server/index.js`, `server/gcsp/runtime.js` and canonical Greg host. Adopt the additive exports/routes and mount in the existing `orderTracking` region. F104 has not edited those files. |
| Trusted allocator identity | FUCQ-84, FUCQ-96 | Review/adopt `DemoIdentityAdapter.resolveEmployeeContext` from exact F96 `d12358bcd02f4c10a5dc9f0851efe94bc2c9d864`, where it already exists. Do not substitute caller-created contexts. |
| Canonical release and allocation registry | FUCQ-85, FUCQ-92, FUCQ-96, FUCQ-100 | Register actual release/allocator/hold handlers on the one DemoClock before serving ticks; inject the actual release port into supply. Preserve handler order and idempotency. |
| Versioned source inputs | FUCQ-77, FUCQ-78, FUCQ-92, FUCQ-104 | Bootstrap the explicit production choices and exact-stock provider from the agreed real-configuration/synthetic-stock route. The F104 proof's small synthetic exact-stock inputs are qualification evidence only. |
| Native migration and transactions | FUCQ-81, FUCQ-83, FUCQ-104 | Route to Gary's credential-owning machine under the existing PostgreSQL handoff. Reconcile migration number0004 before adoption, apply without editing applied files, prove new foundation tables/snapshot/flush/immutable acknowledgement/run-scope constraints and persistence/reopen/rollback. Preserve F83's current claim and credential location. |
| Canonical journey and final acceptance | FUCQ-104 with FUCQ-92/96/100 and FUCQ-101 | After composition/native gates, run the canonical walkthrough and the authored `npm test` in a dispatcher-admitted serial resource turn. No final full run is claimed here. |

## Concrete composition

Create `createSupplyService({ repository, policy, clock, identity, production, releases })` with the same opened repository and canonical PolicyService, identity and clock used by the runtime. The explicit synthetic production adapter takes a nonempty versioned model/derivative choice set; it performs no live ordering write. Its source convention must match the selected F77/78 inputs. `releases` is the actual F92 service, whose `queueConfirmedSupply` accepts immutable confirmed references, not stock rows.

Append `createSupplyRoutes(supply)` to the shared authenticated handler. GET/POST `/api/gcsp/greg/orders` and POST `/api/gcsp/greg/orders/queue` use acting Greg; POST `/api/gcsp/presenter/production` uses the separate presenter-control cookie. No query selector or browser identity/run field is accepted. `confirmedAt + supply.leadTimeDays` is both expected and queued eligibility; a provider with a later convention needs an agreed port extension.

For the browser, use `mountGregOrders(region, { adapter: createGregOrdersHttpAdapter(), productionControls, onChanged: () => dashboard.refresh() })`, or the separate registered custom element. Decide presenter disclosure from the trusted host role/session context. The owned `blocks/gcsp/greg-orders/harness.html` and external `harness.js` demonstrate composition using real authenticated routes; they are an isolated harness, not a claim that the canonical host is integrated. All scripts/styles remain external under the existing CSP.

## Preserve evidence and complete the canonical check

The final product source passed119 scoped assertions, copy2, actual pinned producer1 and seven-state browser checks at1440/390. Exact F92 `15a79957e61d81612311d3aab7dbf77733dc4e0d`, F96 above and F100 `b4154ce3bfe195564a2d9f17980309d76e545eba` were composed with memory and explicit synthetic inputs. [Evidence/visual review](evidence/fucq104/README.md), [resource summary](evidence/fucq104/validation-summary.json) and [contract](greg-orders-contract.md) qualify the limits. Focused normal viewport shell captures supersede two invalid repeating fullPage artifacts; live DOM is singular and continuous.

On the composed native target: Greg submits model/derivative/quantity with observed pins; replay preserves one request; presenter partially confirms, delays the remainder, then confirms it; no available stock appears before the keyed lead time; actual F92 tick releases; actual F96/F100 allocate/hold/offer/outbox; Greg demand and tracking update; retry/tick replay adds no effects. Reopen/reload must preserve distinct facts and stage/count/date/provenance. Exercise unavailable production/queue recovery and forged-role/run refusal. Capture relevant canonical desktop/narrow/keyboard proof and run the authored full suite after the code/input/environment freeze. Synthetic proof, native skips and scoped tests leave this acceptance open.

No GC/runtime/producer/package file, credential or native database was edited by this lead. No descendant agent was used. Existing claims and collaborator authority remain unchanged.
