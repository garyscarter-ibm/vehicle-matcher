# FUCQ-16 live catalogue provider setup (FUCQ-46)

Date: 9 November 2026. Status: implemented behind the C13 snapshot contract, fixture-proven only. Live access is an
UNSUPPORTED DEMO ROUTE that uses the public configurator website key. It is not a BMW-supported API or a production entitlement.

## What is implemented

Module: `server/vehicle-evidence/bmw-live-catalogue.js`. Exports: `createBmwLiveCatalogueProvider`, `createBmwCatalogueProvider`,
`bmwCatalogueProviderSelection`, `selectBmwCatalogueSnapshot`, `presentBmwLiveCatalogue`, and the constants
`BMW_LIVE_CATALOGUE_PROVIDER`, `BMW_LIVE_CATALOGUE_SOURCE`, `BMW_CATALOGUE_PROVIDER_ENV`, `BMW_UCP_KEY_ENV`.

Four GET read families, all under the single UCP origin, one attempt each, in this order:

1. Matrix: `/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/{catalogueDate}/order-dates/{orderDate}?gfs-policy=none&cluster=default&model-ranges={modelRange}&future-models=true&closest-fallback=true`
2. Rule solver: `/rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb/effect-dates/{effectDate}/order-dates/{orderDate}/models/{modelCode}?included-elements={sorted options and accessories}&mandatory-elements={trim}&add-rules-for-mandatory-element-classes=fabric,paint,rim&application=connext`
3. Option definitions: `/localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/{effectDate}/order-dates/{orderDate}/applications/connext/models/{modelCode}/options/languages/en?trim={trim}`
4. OTD: `/otd/country-groups/eu27+/ag-models/{agModelCode}/validity-dates/{effectDate}/otd-for-configuration?included-options={sorted resolved codes}`

Included elements and options are sorted. The chain stops at the first mismatch: a matrix difference ends it after read 1, a solver
difference or not-constructible result ends it after read 2, so options and OTD are only read for an exact identity.

## Deliberately not requested

Garage or anonymous-configurations writes, `configuration-state/{uuid}` routes (the solver state token is never read, echoed or reused),
marketing-texts HTML, pricing, the accessories catalogue and COSY images.

## Identity and resolution rules

- Exact means the live model, range, raw range, AG model, order/effect/tax/production dates, trim, the complete sorted option list and
  option/accessory typing all equal the request. Anything else is reported as a mismatch with per-field differences.
- G21 T3MQ resolving to T3SK is rejected before any specification or image join; the resolved identity is shown beside the requested one.
- Market and locale are scoped by the request path (GB, en-GB only); other markets return `unsupported-market`.
- Accessory quantity basis is recorded as `source`, `request`, `assumed` or `not-applicable`, never silently invented.

## Mapping

- Only the four `BMW_OTD_MEASUREMENT_MAPPING` codes map (seats, two luggage volumes, 0-100 km/h). Other OTD values are counted as
  unmapped and unknown. `'0000'`, `'-'`, null and malformed values are unknown with the adapter reasons.
- Option definitions are produced only for selected options. Available equipment is the option-definition codes for the model and date,
  marked partial. Verified VIN fitting is always unknown. No prices and no GCSP points are produced.
- `presentBmwLiveCatalogue` renders plain text in the C13 shape: requested and resolved identity lines, source and date, completeness,
  difference lines and fixed failure messages. Live data is labelled "Live catalogue (unsupported demo route)" and snapshot data
  "Dated snapshot"; the labels never cross. It mounts nothing.

## Configuration

| Knob | Behaviour |
| --- | --- |
| `GCSP_CATALOGUE_PROVIDER` | unset, empty or `snapshot` selects the snapshot (default). `bmw-ucp-live` selects live. Anything else fails closed as `source-not-selected`. |
| `GCSP_BMW_UCP_API_KEY` | Backend env only, read at resolve time. Never in source, command arguments, logs or responses. |
| `transport` (injected) | Required. No default network transport ships, so nothing calls BMW until a caller injects one. |
| `clock` (injected) | Supplies the retrieved date. Defaults to the system clock. |

| Failure code | Labelled non-automatic snapshot choice offered |
| --- | --- |
| `source-not-selected`, `transport-unavailable`, `credentials-unavailable`, `source-failed` | Yes |
| `invalid-request`, `unsupported-market`, `live-not-found`, `live-identity-mismatch`, `live-not-constructible` | No |

The snapshot choice is a separate explicit call (`selectBmwCatalogueSnapshot`); a live failure never falls back to it.

## Status and open items

- Validation is fixture proof through an injected transport only: 0 live requests in FUCQ-46. Live verification is pending FUCQ-48.
- FUCQ-47 owns timeout, retry, cache and the failure taxonomy at the single `read()` seam.
- Nothing is wired into `server/index.js` or the demo journey; the retail feed and consumer screens are unchanged.
- Fixture assumptions not yet proved live: the matrix tree shape (model nodes found by `modelCode`); solver change-list keys other
  than `addedElements` (removed, ignored and invalid are anticipated, not observed); and that the G21 substitution is modelled at the
  solver step.

Verification: `node --test server/test/bmw-live-catalogue.test.js server/test/bmw-catalogue-adapter.test.js`
