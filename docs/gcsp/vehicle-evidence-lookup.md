# Local vehicle-evidence lookup

FUCQ-55 implements one read-only in-process lookup and an HTTP wrapper in the existing Node backend. Gary's Q7/Q13 rescope of 4 November 2026 governs this contract; the old `/synthetic-vins/:vin` route is superseded. The immutable FUCQ-54 registry supplies configuration and current/delivered VIN associations. Exact stock comes from the existing run-scoped TransactionRepository; `orderNumber` is a display field.

Source checkpoints, 5 November: the lookup, response contract, handler, `buildServer`/entry wiring and named test sources are present. Selected packaged-store preparation, test execution and integrated validation remain pending the dispatcher's release. These checkpoints are not working-route or passing-test claims.

## Read port and identities

`createVehicleEvidenceLookup({ registry, repository }).resolve({ kind, id, expected? }, { context? })` is the same-process port. The HTTP wrapper calls this port, so a backend consumer needs no self-HTTP call. `registry` is the existing `createSyntheticRegistry` read port. `repository` is the existing TransactionRepository, not another allocation inventory or database. The returned port has no publication, generator, deletion, live-provider or write operation.

| Route | Port kind | Identifier |
|---|---|---|
| `GET /api/gcsp/vehicle-evidence/configurations/:id` | `configuration` | Standard padded Base64 of `vgModelCode:CODE,CODE,...`; unique upper-case codes sorted and comma-joined |
| `GET /api/gcsp/vehicle-evidence/stock/:id` | `stock` | Canonical lower-case UUID v4 `orderUuid`, resolved only in trusted current-run context |
| `GET /api/gcsp/vehicle-evidence/vins/:id` | `vin` | Exactly 17 permitted VIN characters after outer trim and ASCII uppercasing |

Callers URL-encode the complete ID segment. The router splits the **raw path before decoding one segment**, preserving encoded `/` and `+` in standard Base64. It decodes once. Unsorted, lower-case, duplicate-code, unpadded or otherwise noncanonical configuration IDs return `invalid-input`; they do not alias an existing record. VIN normalization applies only to VINs. An arbitrary well-formed unknown VIN is not assigned a US market/year/checksum profile and returns `not-found` when the registry is available. Registry publication retains FUCQ-54's profile and checksum validation.

Stock reads require a server-owned `runId`, `environmentId`, principal and roles, and recheck the repository's current run before returning. The stock row's UUID/run, immutable configuration, snapshot and digest must agree. Reset changes stock identities; it does not regenerate the immutable configurations or delivered/current VIN associations. A stock result never invents a VIN. Delivered/current-car results retain the original physical vehicle and originating dataset.

An optional `expected` object belongs to trusted in-process callers. Its supported constraints are `configurationId`, `market`, `bodyType`, `profileId` and `snapshotVersion`; a different result is `identity-mismatch`. The HTTP API has no query-parameter contract. Browser attempts to select provider, run, dataset or identity kind are rejected.

## Response and failure contract

The envelope has `contractVersion: 1.0.0`, `schemaVersion: 1`, and `provider: local-vehicle-evidence`. HTTP status and evidence completeness are separate:

| Outcome | HTTP | Action |
|---|---:|---|
| `complete` / `partial` | 200 | Inspect individual field evidence/completeness |
| `invalid-input` | 400 | Correct the identifier and route |
| `not-found` | 404 | Check the identifier and selected dataset |
| `source-unavailable` | 503 | Restore/configure the validated local source and retry |
| `unsupported` | 422 | Review the supported profile/dataset |
| `identity-mismatch` | 409 | Refresh current context and review the association |

`complete` describes the source's supported catalogue evidence subset; it does not assert a complete physical factory build. `identity.identityKind: synthetic` labels the server-owned demo identity association. Source facts independently retain `observed`, structural-reference or unknown provenance. Known responses carry requested/resolved lookup identity, configuration/vehicle/dataset/origin identities and source requested/resolved market/model/date/options context. Configuration-only records have no invented physical `vehicleId`, order or VIN.

Description fields retain model, derivative, generation, body and powertrain evidence. Paint/upholstery identify selected catalogue codes and their attributed labels. Equipment definitions, configurable availability, selected catalogue equipment and verified VIN fitting remain distinct. VIN fitting is unknown; catalogue selection cannot establish it. Technical values retain definition, unit, completeness, source/date and per-field unknowns. Catalogue effect/production/tax dates remain distinct from an unknown physical production/registration date.

Images retain source date, asset reference, role and fidelity and carry a visible representative-model/configuration label. No image is fetched by lookup. An absent image returns `Images unavailable`; useful facts remain available. Failure envelopes carry an actionable typed code/message, retryability and action. They do not reflect arbitrary requested VINs, underlying exceptions, cookies, credentials or substituted facts.

## Local startup and recovery

The same-entry command is `npm run server:gcsp-offline` (`GCSP_OFFLINE=1 node server/index.js`). It keeps `/health`, the existing shared `DEMO_ACCESS_KEY` gate (`X-Access-Key`) and the same listening backend. The explicit offline profile skips stock/dealer/geocode/colour startup warmers. Ordinary startup retains its current retail behavior. No runtime dependency, infrastructure or credential discovery is added.

`createLocalVehicleEvidenceLookup` reads a **previously selected** FUCQ-54 store from `server/data/gcsp/vehicle-evidence/lookup-reference.v1`, or an explicitly configured backend path. This store is to be packaged from the existing immutable `publication-reference.v1` inputs by FUCQ-54's offline publisher. Startup only loads and validates it. The packaged inputs are a bounded two-configuration/one-current-car reference, with no 200/10,000-corpus claim. They contain one North American structural reference and one exact dated GB catalogue snapshot, without representative assets. A broken/missing selected store returns 503; it does not publish, regenerate, fetch BMW data or return a successful empty fleet.

Exact stock needs an actually configured repository and trusted context resolver. The default local immutable corpus does not fabricate a run or live stock. Without that input, stock lookup truthfully returns 503. Injected repository/context integration must prove a successful stock lookup before story completion.

`buildServer({ gcspVehicleEvidence: { lookup, resolveContext } })` accepts the same-process port and a trusted current-run context resolver. Alternatively supply `{ root, repository, resolveContext }` to use the existing local registry with that TransactionRepository. `gcspIdentity` supplies its ordinary server-owned session context when a separate resolver is absent. `GCSP_VEHICLE_EVIDENCE_ROOT` selects an operator-configured local store at startup; request/query fields cannot choose it. Configuration and delivered/current VIN reads use the shared demo gate; stock also needs trusted run context.

Recovery uses the existing offline publication CLI to validate/publish into an explicit local store, followed by normal restart. The server exposes no load/publish/generate endpoint. Provider routing is closed for known, invalid, unsupported, mismatch, miss and outage outcomes: there is no BMW, Driver's Guide or third-party decoder fallback.

## Validation and experience quality

Planned scoped commands are `node --test server/test/gcsp-vehicle-evidence-lookup.test.js`, `node --test server/test/gcsp-synthetic-vin-api.test.js`, and `node --test server/test/gcsp-offline-start.test.js server/test/api.test.js`. The API tests start real `buildServer` instances on ephemeral loopback ports and compare all three HTTP results with the same-process port. Offline entry tests must cold-start, look up, stop and restart the same published inputs with global fetch/HTTP/TLS transport guards and zero external attempts. These commands are not executed at this source checkpoint; the dispatcher retains admission of each chunk and the final required `npm test` on the integrated base.

This story adds no screen or control. Under [experience-quality.md](experience-quality.md), [screens/README.md](screens/README.md) and [COMPONENTS.md](../../COMPONENTS.md), backend contract fixtures/assertions inspect synthetic labels, source dates, definitions/units, unknowns, representative imagery and actionable errors. Screenshots cannot establish HTTP contract truth and no rendered surface changes here; the future consuming screen supplies desktop/narrow/keyboard evidence against the agreed header/sidebar/palette and Used Cars body direction. No new policy or scoring assumptions are introduced. Signature rules remain sourced through canonical PolicyService during registry validation.
