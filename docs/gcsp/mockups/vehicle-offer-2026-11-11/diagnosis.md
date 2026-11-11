# Why offer details are missing

Source investigation, 11 November 2026. Epic [FUCQ-380](https://ibm-consulting.atlassian.net/browse/FUCQ-380); Medium Bug [FUCQ-382](https://ibm-consulting.atlassian.net/browse/FUCQ-382), To Do and discussion only. No production repair, deployment check or application test pass is claimed.

The offer is showing a reduced **pinned quote snapshot**, rather than resolving the full configuration for display. The loss happens upstream of the card renderer:

1. [`run-stock-generation.js:73`](../../../../server/gcsp/stock/run-stock-generation.js) receives a registry record, but its `factsForConfiguration` returns only an eligibility key and `modelBrowseFacts`. That model projection has body, fuel, seats and boot facts; it has no exact paint, upholstery or selected options.
2. [`stock-generator.js`](../../../../server/gcsp/vehicle-evidence/stock-generator.js), `ensureExtra` (229–232) and generated row (363–371), stores that enrichment plus operational/identity facts. The configuration ID survives, but its richer evidence is not carried into the vehicle facts.
3. [`allocation/index.js`](../../../../server/gcsp/allocation/index.js), `toCandidate`, passes stock facts into the recommendation. The decision snapshot becomes the pinned quote in [`offers/buddy-hold.js`](../../../../server/gcsp/offers/buddy-hold.js), around line 290; [`offers/access.js`](../../../../server/gcsp/offers/access.js), 412–420, reads that quote.
4. [`offer-projection.js`](../../../../blocks/gcsp/offer/offer-projection.js), `cardFor` (181–193), already reads colour, options/equipment, interior and gearbox/transmission when present. It cannot render details omitted from the quote.

The admitted `fucq77-demo-selection-2026-11-08.jsonl` source has **198 of 198 records with known, non-empty selected option sets: 9,775 codes in total**. Every `catalogue.equipment.definitions` array is empty. Paint and upholstery also have known codes. Thus configuration selections exist upstream, but their readable names are not established by this dataset. Selected catalogue configuration is distinct from verified delivered-car equipment; `verifiedFitted` remains unknown in the inspected sample.

Resolving by unique ID is the right direction, but an existing lookup is not automatically sufficient. [`vehicle-lookup.js`](../../../../server/gcsp/vehicle-evidence/vehicle-lookup.js), 58–68, requires `stock.facts.syntheticIdentity`. The generated-stock path writes a different identity shape. The repair must reconcile that association and retain exact configuration/provenance, then enrich the snapshot **before quote creation**, preserving historical quote terms. Readable option definitions need a supported source; generic model equipment cannot supply exact vehicle options.

## Diagnose-and-fix assessment

The verified originating Story [FUCQ-105](https://ibm-consulting.atlassian.net/browse/FUCQ-105) already requires the exact car's colour and options. This is an unfulfilled integration requirement and a source-definition gap, not evidence that a generic design skill needs a new rule. The historical agent/skill chain that produced the gap is not reconstructable from this session; no responsible skill passage has been invented and no skill was edited. FUCQ-316/277 address missing-value presentation; FUCQ-337 covers additional meaningful configuration comparisons. Keep those scopes distinct.

The read-only check counted the actual retained records and traced the writer/reader functions above. No source data or code was changed. Future repair validation should follow a real configuration through generated stock, recommendation, pinned quote, response and comparison; include a same-model contrast, unknown definitions/identity and unchanged historical quote terms. Current live run/build identity remains unverified.
