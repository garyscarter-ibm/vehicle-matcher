# FUCQ-60 retained historical integration plan

6 November 2026. Planning checkpoint only. No implementation, test, source request, image operation, browser, SQL or credential call was performed for this plan. FUCQ-60 remains blocked for full delivery. This proposal is for parent/F59 contract review before implementation; it creates no new Jira scope or source allocation.

## Deliverable and evidence boundary

Demonstrate one retained **1 November 2026** BMW GB catalogue configuration passing through an explicit historical ingress stage, the real F59 v2 session, the actual F60 enricher, F54 candidate validation/publication and its read-only configuration lookup. Preserve the original dates, exact selection and unknowns. This is historical source-backed reuse, with no newly collected configuration.

Keep the **6 November 2026** public observation separate: four GET/200 responses, 782,059 decoded bytes, zero additional configurations and **accepted 0**. Its allocation is consumed. Its matching canonical ID does not qualify missing date context, trim/classification or accessory quantity. Do not modify that checkpoint or promote its `sourceObservations`. F77 still requires at least **200 distinct real configurations** with every required scheme line; this single retained sample neither supplies that coverage nor adds a configuration to it.

## Frozen inputs and existing ports

F59 documentation HEAD is `f4c9697e5ee1eecf7cfbf288aae11e266c9f2c72`; executable source remains frozen at `aee5e902a20d82b880694064a10ad9842aaddd3a`. Static reads confirmed these SHA-256 pins:

| Input | SHA-256 |
| --- | --- |
| `scripts/gcsp/collect-fleet.mjs` | `d039d3c8a8acf216204bd83831c70d6001d0e277aec94bd51397a9738341449c` |
| `scripts/gcsp/collection-session.mjs` | `7495084c33c84538beb6ae3a04a292dbc0a800af6c9a10144de8e9728fc4b4b2` |
| `scripts/gcsp/configuration-key.mjs` | `2527393ebb3c0221595200283293ec88c584a1a7178ed1060e2313c0e1998b60` |
| `server/vehicle-evidence/bmw-catalogue-adapter.js` | `06c0910c131fdb0e2e4ef254dc5591f13c90ecb3f36f655aef3cb651aa0052a1` |
| `server/vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json` | `ee1ae6c5cb6ab742f9a2959825ca722007409fa019d15acd44bb4b79984556a3` |
| Retained `configurations.jsonl` below | `9c1fb6a34e324e6e4937baa1e80eabafa44fae394dd138f2f77be9f6867e9855` |
| Retained `manifest.json` below | `c1f8040107f03fa1c25e88d23065bdef3f92a55ca086cd1894655a6c0b0b1709` |
| `server/gcsp/vehicle-evidence/corpus-publisher.js` | `db7e3fd9ff5ff4342872a54c6ca40dd3dda35fc31c51e3dbdb2910b067cd5e49` |
| Existing F60 `scripts/gcsp/enrich-fleet.mjs` | `f6bc477435cb3caada23ddc3113b59e35a39ad7593a1dfd648d491125ea7a900` |

The retained artifacts are under `server/data/gcsp/vehicle-evidence/lookup-reference.v1/versions/c1f8040107f03fa1c25e88d23065bdef3f92a55ca086cd1894655a6c0b0b1709/`. Select exactly the row whose `sourceContext.sourceKind` is `dated-snapshot`; the other reference row is not the historical GB source.

The historical row and owning snapshot agree on GB/en-GB, VG T5MJ, AG 72HH, range G61E/raw G61, trim S0337, catalogue/order date 2026-11-01 and effect/production/tax **catalogue identity** dates 2027-01-05. Preserve all 47 factory codes and the typed accessory `{code: 'SE000001', type: 'accessory', quantity: 1}`. Build `catalogueRequest` by copying the original `catalogue.resolvedIdentity` and adding `selectionComplete: true`; never reconstruct it from the canonical ID or a current-date default.

Actual callable ports already available:

- F39 `createBmwCatalogueAdapter().resolve(request, {snapshotVersion: 'bmw-gb-i5-2026-11-01.v1'})` and `bmwCatalogueLookupIdentity(request, options)`.
- F59 `createConfigurationKey({policyService, policyRead})`, returning the canonical key function and coherent policy version; `createCollectionSession({identity, operations, limits, statePath, initialState, validateState, now, onPhase})`; `session.withCheckpoint(callback, {stage, initialState})`.
- F60 `enrichFleet({session, accepted, catalogueOperation, imageOperation: null, catalogueOptions, asOf, ...})` and the existing pure projection. Its accepted-input equality check is binding.
- F54 `writeCorpusCandidate(directory, {metadata, configurations, images, allocationInventory}, {policyService, policyRead})`, `validateCorpusDirectory(directory, options)`, and `emptyAllocationInventory()`.
- F54 registry `createSyntheticRegistry({root, policyService, policyRead})` provides `publish(candidatePath)` and `getConfiguration(id)`; `createVehicleEvidenceLookup({registry}).resolve({kind: 'configuration', id, expected})` is the existing read-only presentation boundary. No stock repository or VIN path is needed.

The existing F59 regression `retained F39 catalogue identity publishes through F54 without re-keying or inventing missing facts` already proves the preserved ID/F39/F54 seam with zero VIN mappings and unknown body length. It constructs a solver-shaped test response; the production historical ingress proposed here must validate retained evidence directly and must not invent a new solver response.

## Executable composition and ownership

Proposed F60-owned functions below are **missing**, not existing exports. Their proposed home is `scripts/gcsp/historical-enrichment.mjs`, after parent/F59 review. F59 retains its executor and collector ownership; F39 and F54 retain their schemas and providers.

1. `readRetainedHistoricalInput({root, pins})` reads only the named bounded files, verifies hashes and selects the single dated row. Freeze the row, manifest and full catalogue request. Resolve the signature policy through the existing file-backed PolicyService and `createConfigurationKey`; verify key ID/signature, AG/VG and factory selection equal the retained row. Do not duplicate PolicyService defaults.
2. `createHistoricalEnrichmentRun(input, {policyService, policyRead, statePath, limits, now})` creates the **actual** F59 `createCollectionSession`, with a new absolute owned checkpoint, `initialState: {accepted: []}` and one predeclared offline `catalogue` operation. That operation invokes the actual F39 adapter with the pinned snapshot options. Its source ID/version and the run input digest pin the adapter/snapshot bytes. Register no image/HTTP operation and retain `imageRequests: 0`, concurrency 1 and explicit finite operation/retry/cache/checkpoint/deadline limits.
3. `qualifyRetainedHistoricalInput({session, input, key})` enters `historical-ingress` version 1 through `withCheckpoint`. Call `execute('catalogue', input.catalogueRequest)` and require a successful exact F39 requested/resolved/provider/lookup identity, snapshot, source dates and complete typed selection. Compare the original envelope and canonical identity rather than filling missing fields. Persist the accepted record and a qualification receipt in one commit. The receipt states retained historical source reuse, original 2026-11-01 provenance, all input hashes, policy version and accepted digest. It makes no claim of fresh collection or physical fitting.
4. Return a cloned committed accepted array/receipt from the ingress callback and let its checkpoint lease close before calling unchanged `enrichFleet`; never nest checkpoint callbacks. Pass that **same** ordered accepted content, the same `catalogue` operation and byte-equivalent request/options. Its source response can reuse the ingress cache entry. The actual session alone owns retries, lifetime operation counts, cache retention, absolute deadline, writer lease and atomic checkpoint. The F60 stage keeps its own immutable input digest and cursor. There is no second executor or ledger.
5. `projectHistoricalCorpusCandidate({input, ingressReceipt, enrichmentReport})` verifies both refer to the committed accepted digest/ID and retains the original F54 row, including its **original full F39 envelope**. Keep the F60 report and ingress receipt as separate immutable sidecars. F54's closed row/catalogue schema cannot accept an F60 projection, arbitrary `sourceObservations` or qualification extensions.
6. Package one row with `imageIds: []`, `images: []` and `emptyAllocationInventory()` through `writeCorpusCandidate`, then `validateCorpusDirectory`. Reuse only compatible retained manifest metadata; let the publisher derive counts/checksums/signature policy and retain its required `bounded-fixture-or-partial-corpus` qualification. Validate an existing candidate and exact expected manifest before resume reuse; never replace an unexplained existing directory.
7. In a future owned isolated proof store, call `registry.publish(candidatePath)` and resolve the exact configuration through `createVehicleEvidenceLookup`. Verify the read preserves dates, unknowns, selected/available distinction and zero VIN associations. Registry publication has its existing independent filesystem writer protocol; it is not a source request ledger. Record the candidate/active manifest digests in a session packaging stage. On interruption after publish, reopen and verify the same digest; `publish` is idempotent for that digest. This plan grants no publication to the shared runtime store.

The accepted historical entry needs only the actual consumer contract plus provenance: canonical ID/signature/identity and policy version, exact `catalogueRequest`, exact `lookupIdentity`, `sourceKind: 'dated-snapshot'` and retained source references/date. Define and validate this ingress schema explicitly. Do not label an existing `offline-fixture` record historical or attach the 6 November observation to it.

## Run, stage and accepted identity

The session run identity must include consumer/ingress versions, retained file pins, catalogue operation source identity, exact request, policy version/read identity, assessment date and finite limits. Session v2 already binds operation descriptors, limits and its tool version. Use a fresh checkpoint; do not adopt an offline collector or public-observation checkpoint.

The ingress stage input digest covers those immutable source/row/request/policy inputs. Its persisted receipt must bind the accepted digest and F39 envelope digest. `validateState` permits only an empty unqualified accepted array, or the single exact qualified historical entry with its matching committed receipt; any other row, changed order, missing receipt or provenance substitution fails closed. An interruption after the F39 cache write and before admission reuses that cache; an interruption after admission retains one accepted record. Never append the sample twice.

Enrichment's existing stage digest additionally binds the unchanged accepted array, operation names, provider options, retention policy, image view/dimensions and `asOf`. It compares the supplied array with actual `state.accepted`. Source metadata, cache expiry and request identity stay separate from the target canonical ID, which intentionally excludes dates and dealer accessories. A changed source, policy, assessment input or version requires a new compatible run/stage decision, not a count reset or checkpoint edit.

Keep three qualifications visible side by side: the ingress receipt's proposed `retained-historical-source` evidence category; the unchanged F60 report's `offline-session-not-source-qualified`; and F54's required `bounded-fixture-or-partial-corpus`. The first explains the provenance of the retained row; it does not override the latter two or claim the current generic F60 consumer has a source-qualified reporting port. A future generic qualification/reporting API requires an explicit reviewed change and is not needed to preserve this honest sidecar composition.

## Truth and presentation constraints

Preserve `configuration.productionDate`, model, derivative, body, powertrain, drive, transmission, engine code, region, steering, model year, production era and plant as their original null/unresolved values. Catalogue `productionDate: 2027-01-05` does not establish a physical build date. Body length stays unknown/null in millimetres; retain the evidenced units/meanings for the four known facts. Complete selected equipment does not imply complete available definitions or verified fitted equipment.

There is no approved exact F54 image bridge in this sample. Do not download an image, project F42 metadata into a made-up F54 row or claim representative asset coverage. Imagery remains unavailable; valid facts remain partial. No VIN generation, stock, availability, scheme points, eligibility, usage or connected statistics follow from the catalogue selection. Verify those boundaries through the existing lookup response in the future integration proof. No screen change is proposed.

## Design assessment and remaining ports

This assembly stays inside HLD page 06's existing collector/validator/publisher and immutable configuration corpus, with the existing read-only backend lookup. No new service, database, store type or runtime provider connection is proposed. The canonical text remains `docs/design/gcsp-high-level-design.md`; the canonical diagram is `docs/design/high-level-design.drawio`. No topology edit or rendered diagram evidence is claimed. Reassess the design before implementation if a new connection/store/provider is introduced.

| Boundary | Existing capability | Exact remaining work / owner |
| --- | --- | --- |
| Retained source admission | Real session supports initial state, stage state, execution and durable commits | F60 historical ingress schema, qualifier and assembly; parent/F59 review of common-session accepted invariant |
| Collector modes | Offline collector stamps fixture records; public collector requires accepted empty | Preserve both contracts; historical composition uses the reusable session directly |
| Enrichment/reporting | Existing consumer accepts exact session records and reports offline scope | Keep unchanged report plus qualified ingress sidecar; any general source-qualified report API needs a later reviewed port |
| Corpus packaging | F54 accepts original dated row/envelope and empty VIN/image sets | F60 projection/join validation, immutable candidate/receipt linkage and actual isolated end-to-end proof |
| Runtime presentation | Existing F54 registry and lookup ports | Prove exact historical configuration lookup; integrated branch assembly remains separate |
| Real assets and breadth | No sample image approvals; one registered historical snapshot | F42/F58 representative asset evidence; F39 owning registration for additional qualified snapshots; F77 200-configuration/scheme coverage |

## Future validation selection, not executed

Before implementation, record changed paths and inspect the affected-test plan. Proposed owned paths are `scripts/gcsp/historical-enrichment.mjs`, `server/test/gcsp-historical-enrichment.test.js`, this evidence note and the F60 result/map record. Callers are F59 session, canonical PolicyService/key, F39 catalogue, F60 enricher and F54 publisher/registry/lookup. No foreign source file is assigned to F60.

Start with one bounded historical end-to-end case covering ingress → cached enrichment → candidate validation → isolated publication → lookup, plus negative cases for a changed source pin, wrong date/accessory quantity, accepted/receipt mismatch and partial/unknown preservation. Add a crash/reopen case at ingress cache/admission and registry publication boundaries. Reuse the existing matching six-case v2 session proof and 50-case pure/F39/F42 evidence where their code/input/environment identity remains unchanged; do not rerun them solely to populate coverage. The new assembly/projection paths are unobserved and need direct evidence.

The proposed first command is `node --test --test-concurrency=1 --experimental-test-coverage server/test/gcsp-historical-enrichment.test.js`, once that test exists. If its owning boundary changes, select the existing historical regression with `node --test --test-concurrency=1 --test-name-pattern='retained F39 catalogue identity publishes through F54' server/test/gcsp-fleet-collector.test.js` on the assembled F59/F60 identity. Review these selections again after the actual diff; do not silently fall back to a full suite. The authored final `npm test` remains an integration checkpoint requiring the parent's serial grant on the assembled identity. Live/current-date qualification, image evidence, HTTP/browser and native SQL are excluded from this historical proof and remain separate gates.

Use one worker with an initial 128 MiB scratch/384 MiB RAM/300-second chunk. Establish an absolute run-owned scratch root, outside ownership manifest and supervisor finalizer before allocating proof output; propagate owned TMPDIR/TMP/TEMP. Record selected checks, code/input/environment identities and checkpoints outside scratch. Maintain the impact map for observed paths. Account for actual host jobs and preserve the 5 GiB emergency disk reserve; reduce the chunk if needed. No output should approach 256 MiB; if that expectation changes, write large output directly under the required OneDrive project path. Join owned processes, remove only owned scratch/temporary overlays and verify absence on every exit. Retain a concise result and bounded failure log.

This planning checkpoint creates no test scratch. The earlier task-owned shared `scaffold_git.cpython-314.pyc` was attributed and removed by exact inode/hash after an empty opener check; `lead60/bytecode-cleanup-ownership.json` retains the ownership/absence evidence. Unrelated bytecode was preserved. Future Python commands use `PYTHONDONTWRITEBYTECODE=1` and `-I -B`.
