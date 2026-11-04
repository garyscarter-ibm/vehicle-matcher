# Dated BMW catalogue adapter

FUCQ-37 introduces an injectable in-process port in `server/vehicle-evidence/bmw-catalogue-adapter.js`. It has no HTTP route or current retail consumer. It reads one versioned curated local artifact and makes no live requests. Existing stock, mapping, images, brand behaviour and retail estimates are separate.

## Use the exact observed sample

```js
import { createBmwCatalogueAdapter } from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';

const catalogue = createBmwCatalogueAdapter();
const result = await catalogue.resolve({
  market: 'GB', locale: 'en-GB',
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
}, { snapshotVersion: 'bmw-gb-i5-2026-11-01.v1' });
```

All date fields and the complete selection are required. Array order does not affect identity; duplicate codes are invalid. Accessory codes are separate from configuration options and retain source type and quantity. `selectionComplete: true` is a caller assertion, followed by comparison with the entire retained set. A seed selection, missing accessory, extra towbar or wrong date does not resolve to exact facts.

`loadSnapshot(version, { transport })` may be injected for testing another copy of this curated artifact. The default loader maps an allowlisted version to a fixed local URL. Versions are never filesystem paths. The default exported `rejectOutbound` transport throws on any invocation. Tests inject a throwing transport and verify the production lookup never invokes it; an injected loader that attempts transport fails as `source-unavailable`. This is an offline dependency boundary, not a sandbox for arbitrary injected application code.

## Result and presentation contract

The envelope carries provider `bmw-catalogue-snapshot`, provider version `1`, schema version `1`, snapshot version, source kind `dated-snapshot`, observation/retrieval dates, catalogue validity, requested and resolved identities, facts, equipment and completeness. The adapter only copies explicitly projected fields. No source storage location, raw upstream payload, technical reference name, garage identifier, rule-state identifier or HTML is exported. Unexpected request fields are ignored and never echoed.

Each fact carries `state`, `value`, `definition`, `unit` and `provenance`. Known facts use `observed` or `synthetic` provenance; unknown facts have a null value and `unknown` provenance. The observed envelope never promotes a synthetic field to observed. Identity and selection are observed catalogue facts, with provenance alongside their projections. Retrieval is the retained source retrieval on 1 November, not the local file read time.

| Fact | Value | Definition | Unit |
|---|---:|---|---|
| Seats | 5 | SEATS | COUNT |
| Luggage | 570 | NORMAL | LITRES |
| Luggage | 1700 | EXPANDED | LITRES |
| Acceleration | 6.1 | 0–100 KM/H | SECONDS |
| Body length from model tree | Unknown | BODY LENGTH | MILLIMETRES |

The source's `0000` model-tree length is unknown. This adapter does not use retail defaults, silently coerce placeholders to zero or infer missing values from another model-level source. Empty, malformed, missing or unrecognised-provenance measurement entries remain unknown. The four scoped technical measurements determine measurement completeness; the additional unknown model-tree length stays explicit.

Example consumer copy:

> BMW UK catalogue, observed 1 November 2026. BMW i5 eDrive40 M Sport Touring. 5 seats; luggage 570 litres (normal), 1700 litres (expanded); acceleration 6.1 seconds from 0–100 km/h. Order context 1 November 2026; effect, production and tax context 5 January 2027. This is future January 2027 catalogue context relative to the observation.

`presentBmwCatalogue(result)` provides plain `source`, `context` and `measurements` text from the public envelope. It preserves the measurement definition and unit, labels each known value as observed or synthetic and renders missing measurements as unknown. It returns no measurement text for unsuccessful resolution. The helper has no UI or route wiring.

This is not a VIN build, not verified fitted equipment, not released scheme stock and not a live lookup. Do not relabel the acceleration measurement as 0–62 mph. A future consumer must show source/date, measurement definitions/units and January 2027 context together with the values. The January context does not update the October 2024 scheme baseline or establish a delivery date.

`equipment.definitions` contains only the retained label definitions. `available` records the retained request's available codes but does not claim a complete catalogue inventory. `selected` is the exact complete configuration selection. `verifiedFitted` is unknown, with a null code list. Towbar `S03AC` is defined and available, and absent from this complete selected configuration. Neither catalogue selection nor a definition proves physical fitting. Incomplete source lists must never become an empty complete fitted list.

| Status | Meaning |
|---|---|
| `ok` | Exact identity and selection; all four scoped technical measurements known |
| `partial` | Exact identity and selection; at least one scoped measurement unknown |
| `invalid-input` | Malformed identity/date/code, duplicates or no complete-selection assertion |
| `unsupported` | Market, locale or snapshot version outside this provider's support |
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
