# Dated BMW catalogue adapter

FUCQ-37 introduces an injectable in-process port in `server/vehicle-evidence/bmw-catalogue-adapter.js`. It has no HTTP route or current retail consumer. It reads one versioned curated local artifact and makes no live requests. Existing stock, mapping, images, brand behaviour and retail estimates are separate.

## Use the exact observed sample

```js
import { createBmwCatalogueAdapter } from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';

const catalogue = createBmwCatalogueAdapter();
const request = {
  market: 'GB', locale: 'en-GB', catalogueDate: '2026-11-01',
  orderDate: '2026-11-01', effectDate: '2027-01-05',
  productionDate: '2027-01-05', taxDate: '2027-01-05',
  modelCode: 'T5MJ', agModelCode: '72HH',
  modelRange: 'G61E', rawModelRange: 'G61', trim: 'S0337',
  selectionComplete: true,
  selectedOptions: [
    'FKSFU', 'P0300', 'S0230', 'S02PA', 'S02VB', 'S02VD', 'S0302',
    'S0337', 'S03DK', 'S03G9', 'S03M1', 'S0428', 'S043L', 'S0488',
    'S0494', 'S04T2', 'S04U9', 'S04UR', 'S04V1', 'S0552', 'S05AS',
    'S05AV', 'S05DM', 'S0654', 'S0674', 'S06AE', 'S06AF', 'S06AK',
    'S06C4', 'S06NX', 'S06PA', 'S0704', 'S0710', 'S0760', 'S0775',
    'S0812', 'S0853', 'S0880', 'S08R3', 'S08R9', 'S08SM', 'S08TF',
    'S08TG', 'S08WM', 'S09QV', 'S09T1', 'S09T2',
  ],
  selectedAccessories: [{ code: 'SE000001', type: 'accessory', quantity: 1 }],
};
const result = await catalogue.resolve(request, {
  snapshotVersion: 'bmw-gb-i5-2026-11-01.v1', schemaVersion: '1', providerVersion: '1',
});
```

All date fields, including the catalogue observation date, and the complete selection are required. Array order does not affect identity; duplicate codes are invalid. Accessory codes are separate from configuration options and retain source type and quantity. `selectionComplete: true` is a caller assertion, followed by comparison with the entire retained set. A seed selection, missing accessory, extra towbar or wrong date does not resolve to exact facts.

`loadSnapshot(version, { transport })` may be injected for testing another copy of this curated artifact. The default loader maps an allowlisted version to a fixed local URL. Versions are never filesystem paths. The default exported `rejectOutbound` transport throws on any invocation. Tests inject a throwing transport and verify the production lookup never invokes it; an injected loader that attempts transport fails as `source-unavailable`. This is an offline dependency boundary, not a sandbox for arbitrary injected application code.

## Result and presentation contract

The envelope carries provider `bmw-catalogue-snapshot`, provider version `1`, schema version `1`, snapshot version, source kind `dated-snapshot`, observation/retrieval dates, catalogue validity, requested and resolved identities, facts, equipment and completeness. The adapter only copies explicitly projected fields. No source storage location, raw upstream payload, technical reference name, garage identifier, rule-state identifier or HTML is exported. Unexpected request fields are ignored and never echoed.

Each fact carries `state`, `value`, `definition`, `unit`, `completeness` and `provenance`. FUCQ-38 adds a stable `reason` to unknown facts, plus individual source/date/completeness metadata on retained definitions and technical entries. Known facts use `observed` or `synthetic` provenance; unknown facts have a null value and `unknown` provenance. The observed envelope never promotes a synthetic field to observed. Identity and selection are observed catalogue facts, with provenance alongside their projections. Retrieval is the retained source retrieval on 1 November, not the local file read time.

| Fact | Value | Definition | Unit |
|---|---:|---|---|
| Seats | 5 | SEATS | COUNT |
| Luggage | 570 | NORMAL | LITRES |
| Luggage | 1700 | EXPANDED | LITRES |
| Acceleration | 6.1 | 0–100 KM/H | SECONDS |
| Body length from model tree | Unknown | BODY LENGTH | MILLIMETRES |

The source's `0000` model-tree length is unknown (`placeholder-value`); other model-tree values remain `unmapped-source`. Only the four evidenced OTD meanings/units above are supported. This adapter does not use retail defaults, silently coerce placeholders to zero or infer missing values from another model-level source. Empty, malformed, missing or unrecognised-provenance measurement entries remain unknown with `missing-value`, `placeholder-value`, `malformed-value` or `invalid-provenance` reasons. Hyphens, `0000`, `N/A`, `null` and `unknown` text are placeholders; numeric strings are never coerced. A finite, non-negative numeric value with supported meaning/unit and provenance remains known, including an evidenced zero. Seat counts must also be integers. Missing or different meanings/units remain `unmapped-meaning`/`unmapped-unit`; no conversion is guessed. Unsupported technical references produce unknown `unmappedMeasurements` entries without exporting raw reference names or values. The four scoped technical measurements, their individual completeness and any unmapped entries determine measurement completeness; the additional unknown model-tree length stays explicit. Missing/malformed technical or equipment sections produce a partial result while retaining independently known facts. Invalid core identity still fails closed before any enrichment.

Example consumer copy:

> BMW UK catalogue, observed 1 November 2026. BMW i5 eDrive40 M Sport Touring. 5 seats; luggage 570 litres (normal), 1700 litres (expanded); acceleration 6.1 seconds from 0–100 km/h. Order context 1 November 2026; effect, production and tax context 5 January 2027. This is future January 2027 catalogue context relative to the observation.

`presentBmwCatalogue(result)` provides plain `source`, `context`, `measurements`, `measurementEvidence`, `equipment` and `completeness` text from the public envelope. It preserves the measurement definition and unit, labels each known value as observed or synthetic and renders missing measurements as unknown. `measurementEvidence` supplies each field's source, observation date and completeness; unknown measurement text includes a useful reason. Equipment text states configurable availability, catalogue selection and unknown VIN fitting separately. It returns empty measurement/equipment arrays for unsuccessful resolution. The helper has no UI or route wiring.

This is not a VIN build, not verified fitted equipment, not released scheme stock and not a live lookup. Do not relabel the acceleration measurement as 0–62 mph. A future consumer must show source/date, measurement definitions/units and January 2027 context together with the values. The January context does not update the October 2024 scheme baseline or establish a delivery date.

`equipment.definitions` contains only the retained label definitions. `available` records the retained request's available codes but does not claim a complete catalogue inventory. `selected` is the exact complete configuration selection. `verifiedFitted` is unknown, with a null code list. Towbar `S03AC` is defined and available, and absent from this complete selected configuration. Neither catalogue selection nor a definition proves physical fitting. Incomplete source lists must never become an empty complete fitted list. Source `equipmentEvidence` metadata records whether each section is partial or complete, with its own attribution; a code count never establishes completeness. The required full `selectedOptions`/accessory arrays remain the strict configuration identity binding from FUCQ-37. Equipment section completeness can be partial even when that exact identity is retained. Without attributed selection metadata, selected equipment stays unknown with null lists; attributed partial selection supports positive selected codes but never negative claims for absent codes. Missing or malformed availability/definitions do not discard independently known measurements.

| Status | Meaning |
|---|---|
| `ok` | Exact identity and complete selected-equipment evidence; all four scoped technical measurements complete and known, with usable partial definitions/availability |
| `partial` | Exact identity; technical facts or equipment evidence missing, malformed, unmapped or incomplete; independent known facts survive |
| `invalid-input` | Malformed identity/date/code, duplicates or no complete-selection assertion |
| `unsupported` | Well-formed market, locale, provider/schema version or snapshot identifier outside this provider's support |
| `not-found` | Supported lookup, no retained model record |
| `identity-mismatch` | Model found, but dates, range, AG code, trim or full selection differ |
| `source-unavailable` | Local artifact missing, unreadable or invalid, or injected transport attempt fails |

Only `ok` and `partial` expose attributed specification facts. A mismatch shows requested and candidate resolved identity for diagnosis, with unknown measurements. It never quietly enriches the request from the nearest configuration. Unknown fields remain explicit on failure; source exception details are suppressed.

## Curation and validation

`server/vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json` is a curated observed snapshot, not a complete raw API fixture. Sources are the retained research records under `docs/gcsp/evidence/fucq-4/`:

- `observations-2026-11-01.json`: model/AG/range identity, dates, four technical values, selected label definitions and the model-tree placeholder.
- `requests-2026-11-01.json`: market/language context, trim request, the retail POST body's full 47 options, separately selected accessory quantity and available option codes.
- `response-excerpts-2026-11-01.json`: corroborates the separately typed accessory `SE000001`. No excerpt is promoted into a raw complete response.

Raw production `20270105` stays inside the provider artifact; consumers receive `2027-01-05`. Raw `G61` and configurator `G61E` remain separate identity fields. No speculative policy assumption is introduced. Synthetic-provenance test mutations are illustrative and do not alter the retained observed sample.

Run the scoped adapter regression through `_tools/test_stamp.py` as specified in the story. It reconciles the local artifact with retained evidence, checks all exact values/definitions and exercises mismatch, unavailable, malformed, unknown, synthetic-provenance and safe-projection cases. This story changes no screen or component; presentation assertions replace new screenshots. A future screen follows `experience-quality.md`, the GCSP shell/sidebar/palette reference, Used Cars body direction and `COMPONENTS.md`.


## Equipment claims and complete/partial copy

`describeBmwEquipment(result, code)` projects four independent claim objects for a valid code:

| Claim | States and meaning |
|---|---|
| `definition`, kind `option-definition` | `defined` gives a safe label and its attribution; a label never selects the code. |
| `configurableAvailability`, kind `configurable-availability` | `available` means a retained available code. Absence stays `unknown` because the retained list is partial. |
| `catalogueSelection`, kind `selected-catalogue-equipment` | `selected`, `not-selected` in a complete selection, or `unknown` with `incomplete-selection`/`unavailable-selection`. |
| `verifiedVinFitted`, kind `verified-vin-fitted-equipment` | Always `unknown`, reason `provider-does-not-verify-fitting`. This provider supplies no VIN-fitted evidence. |

Definition, availability and selection carry their own provenance and completeness. The helper does not infer a towbar flag from a label, available code or handbook. Adding P0475 to the request still returns `identity-mismatch` until another complete configuration is separately resolved by an authorised provider.

Complete-selection example, using the observed sample and `presentBmwCatalogue`:

> BMW UK catalogue, observed 1 November 2026. Selection: complete; definitions: partial; availability: partial; measurements: complete. VIN-fitted equipment: unknown.
>
> P0300 Alpine White: configurable: available; selected in this catalogue configuration; VIN-fitted: unknown.
>
> FKSFU Perforated and Quilted Veganza in Smoke White: configurable: available; selected in this catalogue configuration; VIN-fitted: unknown.
>
> P0475 Black Sapphire: configurable: available; not selected in this catalogue configuration; VIN-fitted: unknown.
>
> S03AC Towbar: configurable: available; not selected in this catalogue configuration; VIN-fitted: unknown.

Partial example is an illustrative test mutation of that exact identity, not a second observed configuration: mark the selection evidence partial and replace the normal-luggage value with `-`.

> Selection: partial; definitions: partial; availability: partial; measurements: partial. VIN-fitted equipment: unknown.
>
> P0300 Alpine White: configurable: available; selected in this catalogue configuration; VIN-fitted: unknown.
>
> S03AC Towbar: configurable: available; selection unknown (incomplete selection); VIN-fitted: unknown.
>
> 5 seats (observed). Seats: BMW UK catalogue, observed 1 November 2026, complete.
>
> Luggage (normal): unknown (placeholder value). Luggage (normal): Source unknown, observed unknown, unknown.
>
> 1700 litres (expanded, observed); 6.1 seconds from 0–100 km/h (observed).

An independently attributed zero test uses 0 normal litres, BMW UK OTD, 31 October 2026 and partial field completeness. It stays known with that individual source/date/completeness while the unrelated model-tree `0000` remains unknown. This is a regression example, not a revision to the observed 570-litre sample. The presentation helper returns safe plain text only; it has no HTML renderer. No catalogue, handbook or image supplies connected-use telemetry, scheme eligibility or exact-car fitting.


## Deterministic snapshot identity and explicit failures (FUCQ-39)

`bmwCatalogueLookupIdentity(request, options)` returns the canonical value identity. `JSON.stringify(identity)` is a deterministic cache key; this adapter adds no cache. Its fixed field order contains `provider`, `providerVersion`, `schemaVersion`, `snapshotVersion`, `catalogueDate`, market/locale, separate model code/configurator range/raw range/AG code, trim, order/effect/production/tax dates, sorted **complete** selected options and sorted accessories with type/quantity. Paint is a selected code, so P0300 and P0475 cannot collide. `catalogueDate` is the retained observation date, independent of the four validity dates. Observation/retrieval metadata belongs to the versioned artifact; it is never replaced with today's date. Unknown extra request fields (including garage/share/rule UUIDs and user identifiers) never enter the canonical identity.

The helper returns `null` for malformed input. Well-formed alternate provider/version identities can be compared without becoming supported lookup sources. Runtime `resolve` accepts only the local manifest's provider/version/market. Malformed version values or path-like strings are `invalid-input`; well-formed unknown versions are `unsupported`, and neither loads a file. Options are bounded identifiers, never paths or environment variables. There are no API keys, network configuration, environment switches or network fallbacks. Only the allowlisted default snapshot is enabled. Selecting another supported snapshot would require an explicitly versioned manifest/artifact addition; the adapter never chooses one on a caller's behalf.

A success projection from the exact request above is:

```js
{
  provider: 'bmw-catalogue-snapshot', providerVersion: '1', schemaVersion: '1',
  snapshotVersion: 'bmw-gb-i5-2026-11-01.v1', sourceKind: 'dated-snapshot',
  status: 'ok', failure: null,
  observedDate: '2026-11-01', retrievedDate: '2026-11-01',
  catalogueValidity: {
    orderDate: '2026-11-01', effectDate: '2027-01-05',
    productionDate: '2027-01-05', taxDate: '2027-01-05',
  },
  // requestedIdentity and resolvedIdentity contain the complete request identity.
  // lookupIdentity and resolvedLookupIdentity additionally pin provider/schema/snapshot versions.
}
```

The full envelope retains the facts/equipment/unknown values described above; the example is a projection, not a substitute response schema. `lookupIdentity` describes the request even for a supported but unresolved lookup. `resolvedLookupIdentity` is populated only when the retained model was found, and reports the actual candidate identity rather than relabelling it as the request. Unsupported results preserve the requested version in the envelope and canonical identity; the envelope's provider/schema version fields continue to describe this adapter's response format.

These executable requests show every resolution state:

```js
await catalogue.resolve(request); // ok: exact observed sample
await catalogue.resolve({ ...request, selectionComplete: false }); // invalid-input
await catalogue.resolve({ ...request, selectedOptions: [] }); // invalid-input
await catalogue.resolve(request, { snapshotVersion: 'not-supported' }); // unsupported
await catalogue.resolve({ ...request, market: 'US' }); // unsupported
await catalogue.resolve({ ...request, modelCode: 'T3MQ' }); // not-found
await catalogue.resolve({ ...request, agModelCode: '22FY' }); // identity-mismatch
await catalogue.resolve({ ...request, catalogueDate: '2024-10-01' }); // identity-mismatch
await catalogue.resolve({ ...request,
  selectedOptions: request.selectedOptions.filter((code) => code !== 'P0300'),
}); // identity-mismatch: asserting completeness cannot make an incomplete nearby selection exact

const unavailable = createBmwCatalogueAdapter({
  loadSnapshot: async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); },
});
await unavailable.resolve(request); // source-unavailable, artifact-missing
```

For a partial example, load a copy of the same artifact through the test port, remove `measurements.A_GEPR_V211`, and retain the full identity. The result is `status: 'partial', failure: null`; `facts.luggageNormal` is `{ state: 'unknown', value: null, definition: 'NORMAL', unit: 'LITRES', reason: 'missing-value', completeness: 'unknown', provenance: { kind: 'unknown', source: null, observedDate: null } }`. Seats remain independently observed at 5. A partial source selection is likewise labelled partial, as in the equipment examples above. A partial request is rejected before lookup.

Every failure includes a safe `failure` object with `code`, plain-language `message` and `retryable`. Retryable means the artifact can be repaired and the same explicit request retried; it never authorises a different source, model or date. Normal `ok` and `partial` results have `failure: null`.

| Status | Failure code | Safe consumer meaning | Retryable |
|---|---|---|---|
| `invalid-input` | `invalid-request` | Check the complete vehicle identity, dates and selection. | false |
| `unsupported` | `unsupported-snapshot` | This snapshot or version is not supported. | false |
| `unsupported` | `unsupported-market` | This market or language is not supported by the snapshot. | false |
| `not-found` | `snapshot-not-found` | No snapshot is available for this model. | false |
| `identity-mismatch` | `snapshot-identity-mismatch` | The snapshot describes a different configuration or date. No facts were substituted. | false |
| `source-unavailable` | `artifact-missing` | The local catalogue snapshot is missing. | true |
| `source-unavailable` | `artifact-unreadable` | The local catalogue snapshot could not be read. | true |
| `source-unavailable` | `artifact-malformed` | The local catalogue snapshot is not valid. | true |
| `source-unavailable` | `artifact-incompatible` | The local catalogue snapshot has an incompatible version. | true |

Absent files map to `artifact-missing`; permission/I/O/other loader errors map to `artifact-unreadable`; JSON parse errors or invalid core identity map to `artifact-malformed`; wrong artifact schema/snapshot versions map to `artifact-incompatible`. No file path, exception message, raw JSON/HTML or source payload enters this contract. Failure facts remain explicitly unknown. A mismatch keeps the actual observed source/date and resolved identity for explanation, while exposing no candidate specification facts. A wrong model has no resolved identity. The October 2024 eligibility matrix is never imported or used as a fallback.

`presentBmwCatalogue(result)` exposes `sourceKind: 'dated-snapshot'` and the same bounded failure object on failures, with no measurements or equipment. For example a missing local artifact presents `{ status: 'source-unavailable', source: null, sourceKind: 'dated-snapshot', failure: { code: 'artifact-missing', message: 'The local catalogue snapshot is missing.', retryable: true }, context: null, measurements: [], measurementEvidence: [], equipment: [], completeness: null }`. It never renders raw supplied failure text. No screen is mounted by this story; source/unknown/failure assertions and the complete/partial examples provide the backend presentation review under `experience-quality.md`.

## Reuse without discarding independent facts

`mergeBmwCatalogueFacts(existingFacts, result)` is an optional pure consumer helper. It deep-copies the caller's facts, applies only known catalogue facts on `ok`/`partial`, and leaves existing facts intact on all failures or unknown catalogue fields. It does not send caller facts to a provider or append them to the source envelope. Callers retain responsibility for attributing their own valid facts to the requested vehicle; a failed lookup cannot establish that identity for them.

```js
import { mergeBmwCatalogueFacts } from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';
const prior = {
  connectedMileage: { state: 'known', value: 12000, unit: 'KILOMETRES',
    provenance: { kind: 'synthetic' } },
};
const evidence = await catalogue.resolve(request);
const facts = mergeBmwCatalogueFacts(prior, evidence);
// facts.connectedMileage remains independently synthetic; prior is unchanged.
// An unavailable catalogue returns a copy of prior; it cannot erase unrelated valid facts.
```

FUCQ-15's representative-image adapter can use the same canonical request identity and return its own source/version/date, availability and failure fields alongside this envelope. It must keep its display/retention permission and representative-image caveats. FUCQ-16's handbook adapter can reuse the explicit source/unknown/failure convention while retaining its own VIN-linked identity and coverage; a handbook is not evidence of selected or fitted equipment. FUCQ-19's synthetic registry consumer can keep independently attributed registry facts and merge resolved configuration facts through the helper, preserving source/version/date boundaries and unknown VIN fitting. None of these reuse directions enables those providers, embeds a VIN/user identifier in the catalogue key, or grants live-source permission.
