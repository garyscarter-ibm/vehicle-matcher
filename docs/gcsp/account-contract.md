# Employee account and journey entry · FUCQ-67

`blocks/gcsp/account/gcsp-account.js` exports `mountAccount(root, { adapter, brand, onSupport, print })`, its EDS default decorator and the idempotent `defineGcspAccount(registry)` registration for `<gcsp-account>`. The element accepts an `adapter` property and a `brand` attribute. It never reads browser identity or navigation state. Teardown cancels pending presentation and removes the shell; `refresh()` reads the current account and draft again.

The account composes `mountEmployee` through its existing render-body hook. It reuses the approved FUCQ-64 body reference (`docs/gcsp/evidence/fucq-6/README.md`, revision `a7fc178`), shared media/facts/headings/buttons/status/typed terms, countdown and native labelled details. There is no additional kit card: delivered contracts have no stock eligibility decision.

## Adapter and authority

The default `createAccountHttpAdapter` calls GET `/api/gcsp/manual/account`, GET `/api/gcsp/manual/draft` and POST `/api/gcsp/manual/draft`, with credentials included. The backend owns principal, run, entitlement, scheme, exact old contract and permitted action. Server `asOf` drives the countdown; future earliest collection alone does not refuse replacement. Policy comes through the canonical service and `manual.context.v1`.

Startup reads account and draft. A New or Replace click reconciles the current draft before saving an intent, suppresses duplicate pending clicks, and reuses a matching saved journey. The intent contains only `{ mode, oldContractId, slotId, schemeId }`. FUCQ-68 owns subsequent options and stock. The current car remains unchanged. A stale source context cannot resume; after refreshing and reviewing the current account, an explicit permitted action saves against the current context and draft CAS versions. The internal `reviewedContextVersion` adapter argument does not bypass any server check.

After confirmed save/resume, `gcsp:journey-start` bubbles and crosses the custom-element boundary with `{ mode, oldContractId, slotId, schemeId, draftVersion, contextVersion }`. The host may consume it to mount the next journey. The standalone account shows a truthful saved-context summary and Back to account; reload reads the same server draft. This is not an order confirmation, vehicle selection or collection.

`gcsp:support` carries `{ route }` for the logical `hr-support`, `driver-support` or scheme-support consumer. The account displays that no request is sent. History Print opens the selected complete readback only and cleans the temporary print view afterwards; it makes no backend change.

## Fields and unavailable information

The page retains employee/company/grade/contact and override facts; licence categories/validity and additional drivers; current contracts with visible driver/status/end/term/mileage/monthly points and allowance; full order/collection/return and technical details; scheme-grouped history and record counts. Less frequent facts use keyboard-operable labelled details. Source failures, absent HR, no entitlement, unsupported scheme, renewal unavailable, no current car and no history remain distinct.

Missing source data says Not supplied. Delivered VIN, order reference, stock order UUID and configuration identity remain distinct. Representative media retains its source label and uses the shared broken-image fallback; model/handbook evidence does not verify fitted equipment. The initial manual fixture omits exact media, terms and several historical facts, so these are intentionally unavailable rather than fabricated.

## Harness and validation

`gcsp-account.html` uses the real HTTP adapter by default and requires a composed manual service plus an authorised fictional employee session. `?fixture=ready`, `multi-slot`, `missing-image`, `no-current-car`, `no-history`, `absent-hr-account`, `not-yet-eligible`, `unsupported-scheme`, `no-entitlement`, `source-failure`, `refused` and `conflict` are explicit read-only visual snapshots. Their actions cannot fake a saved journey.

Automated coverage is `server/test/gcsp-account-render.test.js`; shared shell CSP checks include the new harness, and the account CSS has a separate ratchet cap. Browser evidence and repeatable setup/click scenarios are retained under `docs/gcsp/evidence/fucq-67/` when completed. No live BMW calls or real source records are used.
