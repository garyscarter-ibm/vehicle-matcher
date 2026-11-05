# Synthetic order and delivered-car identity allocation

FUCQ-53 implements the Q7/Q13 identities in the [HLD](../design/gcsp-high-level-design.md#vehicle-evidence-and-adapter-contracts). Stock has an `orderUuid`, an employee-visible seven-digit `orderNumber`, a stored eight-digit `wholesalerOrderId` and an immutable `configurationId`. The allocator creates no configuration and changes no corpus. Only a delivered/current-car request can receive a VIN. All associations are explicitly fictional, including those linked to source-backed catalogue facts.

`server/gcsp/vehicle-evidence/vin-generator.js` constructs a candidate through FUCQ-52's enabled profile registry. `vin-allocation.js` owns deterministic allocation, retained inventory, file publication, stock import and the plain employee presentation projection. These are offline/in-process modules. They add no HTTP route, real-decoder fallback, screen, collection job or deployment.

## Plan and inventory

`allocateSyntheticIdentities(inventory, plan, { expectedRevision })` returns an entire replacement inventory only on `status: ok`. `emptyAllocationInventory()` supplies revision zero. A plan has:

| Field | Meaning |
|---|---|
| `runId`, `seed`, `corpusVersion`, `datasetId` | Explicit stable run and input identities. The dataset identifies the originating publication batch. |
| `generatorVersion?` | Must equal exported `VIN_GENERATOR_VERSION` when supplied. |
| `vehicles` | Stable `vehicleId` keys independent of array order. Each has `configurationId`, `snapshotVersion`, the retained `configuration` identity and `usage`. |
| `usage` | `stock`, `delivered-car` or `current-car`. `corpus` and other usages fail. Stock never receives `vin7`, `vin17`, a serial or a VIN profile. |
| VIN-only options | `profileId`, `referenceOnly: true`; optional `profileVersion` and `registryVersion` must match the published mapping. |

`configurationId` and `snapshotVersion` come from the immutable source/configuration record. The allocator treats the ID as opaque and retains a canonical SHA-256 digest of the complete supplied configuration identity. It neither substitutes a nearby configuration nor claims to validate source constructibility; the collector/publisher owns that validation. It accepts no incoming VIN/serial/assigned-order fields. Real VINs, plates, observed serials and personal lookup data must never enter the plan or seed.

The artifact is schema `1`, with `generatorVersion`, `revision`, finite `limits`, `records` and a canonical `contentDigest`. Each record retains run/vehicle/configuration/snapshot identity, configuration digest, seed, originating dataset, generator version and `identityKind: synthetic`. A VIN record additionally retains its selected serial, canonical VIN17/VIN7, profile and registry versions, source evidence/confidence, unknown facts, model year/production era and unknown production/registration dates. `vinAllocationOrigin` retains its original run, seed and dataset when that physical car is referenced by a later run.

Supply the **whole server-owned retained inventory**, across all datasets and runs, to each publication. Keep one authoritative inventory path and back it up through the existing project procedures. Starting a second empty inventory is a different namespace and cannot establish whole-inventory uniqueness. A missing path plus expected revision zero explicitly starts a new inventory; a stale nonzero expected revision refuses it. Corrupt/unreadable inventories refuse allocation. File integrity checks are corruption detection, not an authority mechanism; browser-provided artifacts are never trusted input.

## Algorithm and immutable replay

The algorithm is `synthetic-identities.sha256-v1`. It hashes JSON arrays containing algorithm version, explicit seed, run ID, corpus version, stable vehicle ID and a domain label. UUID candidates use separate `uuid` and attempt inputs; their version/variant bits are set to UUID v4. Order numbers use a hash-derived offset in 0–9,999,999 and are padded to seven digits. Wholesaler IDs use an independent offset in 10,000,000–99,999,999. New vehicle keys are processed in stable lexical order. No timestamp, ambient randomness or array position influences a published mapping.

The VIN serial domain is independent. Current enabled profiles permit six numeric characters, so a serial starts at a hash-derived offset in 0–999,999, including leading zeros. Finalise WMI, whole descriptor, serial, profile year and allowed plant before calculating position nine. The checksum uses the [documented transliteration/weights and integer modulo eleven](synthetic-vin-rules.md#position-rules-and-exact-checksum); remainder ten becomes `X`. Historical/UK candidates remain unsupported. No US year/checksum rule is imposed on them. Catalogue order/effect dates never become production or registration dates.

Each numeric collision domain probes successive values modulo its finite space without revisiting a candidate. UUIDs use successive attempt inputs. The production default is at most 1,000 attempts per domain, bounded further by its space. Whole-inventory checks cover UUIDs and wholesaler IDs, order numbers within a run, and VIN17/VIN7 across distinct physical cars. `exhausted` identifies the domain, attempted count and collision count. The bounded limits belong to the versioned allocation artifact, with smaller explicit spaces supported for offline regression fixtures; they introduce no scheme-policy assumption or second policy service.

Clean runs with identical complete inputs, seed, versions and limits produce byte-stable canonical content. Reordering changes nothing. Replay/resume retains the existing rows, revision and bytes. Additions retain every previous row; when collisions depend on an earlier publication, that persisted publication order remains authoritative. Changing seed/version/configuration/snapshot/profile for an existing mapping is `version-conflict`. A run cannot silently mix corpus versions. A new run receives new stock references, but a stable physical `vehicleId` reuses its published VIN and original VIN provenance. Reusing that physical key for a different configuration fails. A caller introducing a different physical car must provide a different vehicle key.

One physical car can be referenced from several runs with the **same** retained VIN association. Those rows do not represent multiple cars. A future VIN lookup deduplicates by that immutable physical association, preserving run-specific order references. A new physical car cannot reuse its VIN17 or VIN7. Syntax and checksum validity neither authenticate a vehicle nor guarantee non-collision with real vehicles.

## File publication and command line

`allocateInventoryFile({ path, expectedRevision, plan })` exclusively creates `path + '.lock'`, reads and checks the base revision, constructs the whole result in memory, writes/syncs a private sibling temporary file and atomically renames it. Failure before rename leaves the previous inventory intact. Temporary files and the owned lock are removed in `finally`. A competing writer receives `competing-writer`; a stale revision receives `stale-revision`. A crash can leave a lock: an operator must establish that its owning process is gone before removing that exact lock. The library never steals a lock based on age.

The CLI reads a supplied plan and publishes only this offline artifact:

```sh
node server/scripts/generate-synthetic-vins.mjs \
  --inventory /absolute/owned-output/identity-inventory.json \
  --plan /absolute/owned-input/identity-plan.json \
  --expected-revision 0
```

The output directory must already exist. Reopen the same artifact, use its current revision and retain it for additions/restarts. Exit zero means success, one means a refused/unavailable publication and two means invalid arguments. The CLI prints status, revision/counts and finite collision/exhaustion details, without printing assigned vehicle identities. It performs no database/network operation. The small five-WMI fixtures at `server/test/fixtures/gcsp/vehicle-evidence/five-wmi-reference-configurations.json` are explicitly North American structural references with unknown equipment; they are neither UK corpus rows nor complete factory builds.

## Run-scoped repository publication

`publishStockOrders({ repository, context, inventory, expectedRunVersion, commandId })` consumes a successful retained artifact through the existing TransactionRepository port. Inject `createPostgresRepository(...)` for durable application runs. The memory provider is only the explicit contract-test double. The caller supplies trusted server context and an existing active run. Each stock/delivered-car row for that run is inserted in one transaction; current-car reference fixtures are excluded. Rows start `unreleased`, `available: false`. Release, account/visibility, holds and allocation authority remain with their owning services.

The stock projection stores the three order identifiers, configuration/corpus version and compact synthetic/source-snapshot metadata. It stores no VIN, even when the offline physical-car association has one. Existing rows must match the immutable order/configuration/source association; an import preserves their operational state. The run compare-and-swap enforces `expectedRunVersion`, and command replay uses the repository's original-response receipt. Any conflict, stale version or storage failure rolls back the complete stock batch. `runs.versions.syntheticIdentityInventory` records the inventory revision/digest used for the import.

File publication and stock import are separate stages. There is no distributed transaction between them: a failed import leaves its already-published offline artifact available for a reviewed retry. A file-only CLI success does not claim that PostgreSQL stock exists. No shared schema, retail stock/mapping, payload/signature or cache wiring was changed.

## Presentation and verification

`presentSyntheticIdentity({ status, record?, collisions? })` exposes `orderNumber` as `orderReference`. It hides UUID/configuration/wholesaler/vehicle keys and serials. Delivered cars can expose VIN17/VIN7; a current-car reference remains hidden in this employee-facing projection. Synthetic association, reference-only profile evidence, source confidence/unknowns, resolved collisions and typed failure/exhaustion stay explicit. Unknown dates remain null, and the projection claims no verified factory build or complete decoder success.

The independent offline test checker lives in `server/test/helpers/vin-checker.js`. It imports no generator helper or checksum data. Generator tests verify every transliteration and position weight, the regulatory assigned-value vector (sum 411/remainder 4 without retaining its full VIN), all eleven outcomes including `X`, leading zeros, invalid inputs and deliberately wrong check characters. Equivalent transliterations demonstrate why every possible substitution is not guaranteed to be detected. Allocation tests exercise byte-stable replay, additions, reset reuse, cross-dataset/run uniqueness, bounded exhaustion, competing/stale writers, atomic file failures, repository rollback, employee visibility and the actual CLI.

This backend-only change adds no screen/control/component. The [experience contract](experience-quality.md), [agreed visual reference](screens/README.md) and [component kit](../../COMPONENTS.md) apply to future consumers. No new screenshot is required. The canonical draw.io artifact was not changed or newly rendered in this session: no existing background tab was available, and foreground/tabs/focus were preserved. The HLD text already supplies these identity boundaries; a fresh canonical diagram render remains unverified.
