# F39/F54 readiness after the 6 November observation

The retained 1 November catalogue supports an existing truthful historical route. Missing 6 November source-context evidence does not block that route. This static assessment changes no adapter, source evidence or accepted record and authorises no further traffic.

## Existing historical route

`server/vehicle-evidence/bmw-catalogue-adapter.js` registers `bmw-gb-i5-2026-11-01.v1`. Its exact request requires catalogue date, market/locale, VG/AG and both range fields, trim, order/effect/production/tax dates, the complete selected factory options, positive-integer typed accessory quantities and `selectionComplete: true`. It compares the entire normalised identity with the registered snapshot; no nearest-date substitution exists.

The snapshot and dated F54 reference row retain catalogue/observed/retrieved date **1 November 2026**, GB/en-GB, T5MJ/72HH, catalogue range G61E/raw range G61, order date 1 November 2026, effect/production/tax catalogue dates 5 January 2027, trim S0337, 47 selected factory codes and accessory SE000001 quantity 1. Snapshot `prodDate: 20270105` is the adapter's catalogue production-date identity. It does not establish an actual vehicle build date. Snapshot definitions separately classify FKSFU as fabric and P0300 as paint; trim and accessory quantity are explicit snapshot fields, even though their definitions are absent.

A caller can pass the original dated row's `catalogue.resolvedIdentity` plus `selectionComplete: true` to `createBmwCatalogueAdapter().resolve` with that registered snapshot version. The existing passing regression `retained F39 catalogue identity publishes through F54 without re-keying or inventing missing facts` in `server/test/gcsp-fleet-collector.test.js` demonstrates that the preserved identity passes collector validation and F54 publication with the same canonical configuration ID, zero VIN mappings and unknown body length retained. Current matching scoped evidence is 60/60, including 29 F39/F54 tests; no new run was needed for this assessment.

The retained row lives at `server/data/gcsp/vehicle-evidence/lookup-reference.v1/versions/c1f8040107f03fa1c25e88d23065bdef3f92a55ca086cd1894655a6c0b0b1709/configurations.jsonl`. Its `configuration.productionDate`, steering, model year, plant and physical specification remain null and unresolved. Demonstrating this historical sample must preserve those unknowns, 1 November provenance and partial catalogue coverage. A catalogue selection does not verify VIN fitting, a physical build or scheme eligibility.

## Relation to the 6 November observation

The sole allocated pilot retained a separate **6 November 2026** source observation of the same canonical factory selection. It consumed four GET/200 responses and 782,059 decoded bytes and added zero configurations. The allocation is consumed. The six pinned model literals and both actual groups 5/I corroborate the observed mapping only within the [collector contract](collector-contract.md).

The canonical ID intentionally ignores catalogue dates and accessory-only differences. Matching that ID does not let the 6 November response assert historical production/tax dates, trim role, paint/upholstery classification or accessory quantity. The fresh response lacks qualified evidence for those fields. `RL` is a recorded source literal; it does not establish a universal right-hand-drive mapping, UK VIN profile or model year.

The existing APIs do not automatically compose these evidence dates. The public collector enforces `accepted: []`. Actual F60 `enrich-fleet.mjs` requires its accepted list to equal the common session's accepted list and requires valid exact F39 lookup identities; it does not consume `sourceObservations` or recorded group keys. F54 validates a closed configuration schema, with no arbitrary `sourceObservations` extension. Keep the 6 November corroboration as separate evidence; do not overwrite the historical row's observation date or insert unsupported fields.

An explicit, reviewed qualification/integration adapter could later bind historical context with transparent provenance, but no such automatic promotion is claimed here. The currently usable route is reuse of the retained historical row and its owning snapshot, rather than relabelling the fresh observation as accepted. The F39 adapter registers only this one snapshot, so additional model/date routes need qualified evidence and owning adapter/registration work.

## Concrete remaining boundaries

For the historical sample, the F39/F54 exact identity and publication seam already work and can progress the authorised demo. The source-backed current-session publication slice remains blocked: qualify exact context and classifications/accessory quantity, then explicitly integrate accepted records through the existing ports. No remaining source allocation exists for that work in this lane.

Broader real-source model/profile coverage remains open. F77 still needs at least 200 distinct real configurations and every required scheme line; refreshing one known selection contributes zero. F60 integration must distinguish offline fixture proof, historical source-backed reuse and newly qualified live collection. No native SQL, browser or full consumer assembly evidence is created by this note.

The canonical policy source `server/gcsp/policy/seed-v1.json` contains signature decisions (VG field, separator, inclusion of all factory codes including paint/upholstery, padded Base64 and stable IDs). Those assumptions provide no production/tax/trim/classification/accessory-quantity defaults. Runtime consumers continue to use PolicyService; static inspection of the seed here creates no alternative provider or invented BMW facts.

## Independent reviews

Road Runner's code review and Pugh's security review passed the immutable range `5780479252cdea3fc3dd52469d49b3e104765149..aee5e902a20d82b880694064a10ad9842aaddd3a`, with no blocking or major findings. Their nonblocking group-provenance ambiguity is addressed by documentation only in [collector-contract.md](collector-contract.md). Both reused matching scoped evidence and performed no tests or source requests. External reports are `pass-1103/f59-code-review.json` and `pass-1103/f59-security-review.json` under the shared `.claude/dev-poller-resume-20261106/` directory. Requested/selected model for each: gpt-6.1-sol/high, no fallback or descendants; parent verified effective runtime.
