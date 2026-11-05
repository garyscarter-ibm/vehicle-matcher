# Application vehicle-details port

FUCQ-56 follows the leading 4 November Q7/Q13 Jira rescope. The application calls FUCQ-55's public lookup port **in process**. The historical HTTP-adapter criteria are superseded; the real HTTP route remains an external boundary proved by ephemeral contract tests. No new route, screen, service, database or runtime dependency is added.

```js
import { createConfiguredVehicleDetails } from '../../server/gcsp/vehicle-evidence/application-vehicle-details.js';

const vehicles = createConfiguredVehicleDetails({ lookup }); // server-owned composition
const result = await vehicles.resolve({ kind: 'stock', id: orderUuid,
  expected: { configurationId, datasetId, corpusVersion } }, { context });
```

`lookup` is FUCQ-55's read-only `resolve` port. It continues to verify current-run stock via TransactionRepository and immutable configuration/VIN associations via the registry. The consumer accepts canonical padded Base64 configuration IDs, lower-case UUID-v4 stock orders and trimmed/ASCII-uppercased delivered/current VINs using that port's existing identifier function. Stock requires server-owned current-run context. No stock VIN is manufactured; the seven-digit order number remains a display field.

`createVehicleDetailsConsumer({ adapter })` is the application-service interface. It returns `{ contractVersion, status, vehicle, failure, transport }`. Success has a provider-independent `vehicle` projection with requested/resolved identity, synthetic/configuration/vehicle/dataset/origin identity, versions, description, technical values, equipment, images, source evidence, completeness and presentation labels. Failure has `vehicle: null` and a safe typed code/message/action/retryability. Provider storage names and exceptions are not application facts. A malformed/unknown-version payload cannot become a successful empty object.

Trusted `expected` pins support configuration/vehicle/dataset/origin, corpus/snapshot/profile versions, model, market, body, fuel, AG/VG codes and physical/catalogue dates. Wrong or missing pinned evidence is `identity-mismatch`. The consumer also checks requested/resolved lookup identities, canonical configuration codes and source requested/resolved model/market/date/options agreement before accepting facts. It never looks at retail defaults, eligibility, points, terms or usage data.

Provider selection belongs to server construction. `provider: 'alternate-offline'` with `alternateRead` exercises a deliberately fictional card/document shape: composition/order/delivered keys, renamed identities, measurement rows and image cards. The retained test fixture transcribes the two existing tiny FUCQ-55 records and their current-car/stock associations. This demonstrates replaceability and preserves the retained source facts; it supplies no guessed BMW/Outvin schema or production-access claim. Each adapter has a configured timeout of 1–5000 ms and one or two attempts; defaults are 1000 ms and one attempt. Abort signals reach every provider attempt. Transport protocol/status/attempts/outcome remain separate from complete/partial/capability outcomes. There is no HTTP transport in the application adapter or live fallback.

Source catalogue facts retain their own field provenance separately from the fictional identity association. Selected catalogue equipment stays distinct from verified physical fitting, which remains unknown. Missing appearance/technical facts, source dates, measurement meaning/units and physical versus catalogue production dates survive both adapters. Images remain absent or explicitly representative by role/fidelity. The representative-image test uses a labelled fictional contract reference with no asset, rather than introducing unapproved runtime imagery.

This backend capability changes no rendered surface. Under [experience-quality.md](experience-quality.md), [screens/README.md](screens/README.md) and [COMPONENTS.md](../../COMPONENTS.md), contract assertions cover labels, unknowns, units, equipment, dates, image fidelity and actionable failures. Future screens render those fields through the existing shared components and supply their own desktop/narrow/keyboard evidence; this story requires no screenshots.

The [validation plan](evidence/fucq56/validation-plan.json) records the sequential scoped checks, identity, exclusions and resource duties. Final full-suite validation is held for dispatcher admission on the integrated base. No deployment, managed PostgreSQL or live-provider verification is claimed.
