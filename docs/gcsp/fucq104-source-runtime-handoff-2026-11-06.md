# F104 source and host attachment handoff, 6 November 2026

The owned order panel can now attach to the existing Greg dashboard without a new shell or runtime. Canonical source/bootstrap, native persistence and final acceptance remain open. The dispatcher routes the shared edits below to GC's existing writers; this record requests no new claim and changes no accepted DTO.

## Minimal shared integration

| Existing path/boundary | Additive integration | Responsible lane |
| --- | --- | --- |
| `server/gcsp/runtime.js` | Use the existing opened repository, PolicyService, clock and identity to construct `createSupplyService({repository,policy,clock,identity,production,releases})` and `createGregDemandService(...)`. Inject explicit production and actual F92 release adapters. Expose `createSupplyRoutes(supply)` and `createGregRoutes(demand)` through the existing `dependencies.gcspRoutes` extension. | GC runtime writer, coordinated by dispatcher |
| `server/index.js` | Its existing `deps.gcspRoutes` registration already accepts these authenticated routes. No F104 change is required here. | Existing server writer |
| `server/gcsp/identity/index.js` | Adopt the reviewed trusted `resolveEmployeeContext` from published F96 `d12358bcd02f4c10a5dc9f0851efe94bc2c9d864` before actual allocation registration. | GC identity/runtime writer |
| `scripts/gcsp-demo.mjs` and canonical Greg entry | Bootstrap an actual acting Greg session with the retained presenter control cookie, use the real demand adapter, include the existing order stylesheet and call the helper below. Current local bootstrap only selects an employee; the fixture `gcsp-greg.html` is not an authenticated host. | GC host writer |
| Clock registration | Register actual release/allocation/hold consumers once on the existing clock, in the established order. Supply queues confirmed references; the source provider and F92 alone produce exact stock. | Existing F85/F92/F96/F100 integration owners |

`attachGregOrders(dashboard, {adapter, productionControls, onChanged, signal})` in `blocks/gcsp/greg-orders/runtime.js` returns a teardown. Its default adapter uses the same-origin authenticated order routes; its default change callback refreshes that same demand dashboard. It follows the dashboard's `gcsp:ready` remount event, occupies only `regions.orderTracking`, replaces prior attachment listeners and restores the original reserved region on stop or abort. `productionControls` defaults to false and must come from trusted host disclosure policy. It does not set the demand adapter or choose a browser role/run.

The owned harness calls this helper with its explicit production disclosure. Actual role checks remain in the backend even when controls are visible. Its authenticated isolated proof verifies submit, demand refresh and one replacement panel after an actual dashboard remount; it does not establish canonical host adoption.

## Versioned source mapping needed by F77/F78 and F117

The current production choice DTO contains exactly `{model, derivative}`. Requests preserve those values and production provenance; acknowledgements preserve `sourceVersion`, `policyVersion`, `supplyId`, `requestId` and expected/confirmed dates. These labels cannot establish configuration identity, scheme eligibility or cost.

Before activation, the F77 publication/F78 bootstrap and planner adapter need one agreed, immutable mapping per production source version:

F78 contributes stock aggregates, stock identities and lead times. Configuration costs and eligibility belong to canonical F82/PolicyService policy, keyed by `configurationId`; they are outside F78's scope.

| Mapping fact | Required evidence/use |
| --- | --- |
| Publication identity and digest | The actual retained F77 configuration publication and accepted coverage, not a count inferred from a historical receipt. |
| Stable planner model and derivative IDs | Explicit membership of each `{model, derivative}` production choice in the published model/derivative groups. Never derive IDs by normalising labels. |
| `configurationIds` | Explicit existing configuration IDs that belong to that choice, with source/version provenance. F117 can join its catalog's `production:{model,derivative}` to these IDs. This is an integration requirement, not a newly accepted source schema. |
| Cost and policy pins | Canonical F82/PolicyService configuration costs and eligibility, keyed by `configurationId`, with assumption keys/values/versions and evidence used by F117. Do not fill costs from model names or an unversioned fixture. |
| Exact stock and release relationship | F78/F92 provider must resolve a confirmed `supplyId` into exact source-backed stock. A successful F92 receipt's `eventId`/`trancheId` must match each persisted stock row's `release` provenance before it counts as released. |

Every source revision requires its own retained mapping. Historical requests/confirmations must continue to resolve against their original provenance; a current catalog must not silently reinterpret an old label. Ambiguous or missing membership/cost/source versions remain unavailable integration inputs. A future source shape that cannot satisfy the current strict submit/production ports needs a separately coordinated additive contract change.

The active `lookup-reference.v1` artifact currently has **two configurations**, as verified by the dispatcher/scoper on 6 November; older F58 receipts mention three. Neither the active two nor the historical three establish the required accepted F77 real-configuration coverage. No accepted F77 publication, versioned production/configuration membership mapping or canonical F82/PolicyService configuration cost and eligibility mapping is available to this lead. Small synthetic proof inputs remain explicitly labelled qualification data.

F104's trusted submission remains `submit(gregContext,{commandId,model,derivative,quantity,expectedPolicyVersion,expectedStockVersion})`, with pins from `readTracking.value.versions`. Extra fields are rejected. There is no atomic batch-submit port; any F119 per-row submission and recovery contract must be coordinated separately. This handoff changes neither F117 planning nor predict/plan files.

## Remaining acceptance

Keep F104 blocked until the canonical host/source composition, Gary's native migration0004/foundation transaction and persistence evidence, actual source-backed release/allocation/demand walkthrough, and dispatcher-admitted authored `npm test` pass. The new 74/74 scoped helper/UI/dashboard/ratchet checks and two inspected current viewport captures supplement the historical qualified evidence; they do not close these gates.
