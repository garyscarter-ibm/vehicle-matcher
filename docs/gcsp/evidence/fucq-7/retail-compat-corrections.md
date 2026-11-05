# Retail correction cases kept outside the compatibility baseline

5 November 2026. These are diagnosis and intended-regression evidence for later authorised fixes. FUCQ-21 changes tests/evidence only; it fixes none of these behaviours, creates no Jira defect and introduces no failing default test. Original executable observations remain in [reuse-probes.mjs](reuse-probes.mjs) and [reuse-probes.json](reuse-probes.json). The hanging empty-result HTTP probe is not run by the default compatibility command.

| Case | Existing observed problem | Intended correction and later regression |
|---|---|---|
| Empty matches | `matchCars()` returns no `alternatives` for zero survivors. `handleMatch()` accesses `alternatives.map`, producing an unhandled rejection and an unfinished HTTP request. | Return a complete empty result and a completed HTTP 200 response, with `matches:[]`, `alternatives:[]`, searched totals and explicit flags. Add a bounded, ordinary HTTP regression once fixed; do not snapshot the hang as required behaviour. |
| Selected sibling | Existing probe selects the £39,000 sibling but retains the £30,000 representative's 96% score and budget reassurance; independent scoring of that selected sibling gives 87% and stretch. Group feature unions are also availability across members. | Derive price, identity, photo, equipment, score, stretch, reasons and action link from the same exact selected member. Regression independently scores both siblings and selects each; aggregates must remain labelled as group availability. Baseline group metadata does not endorse retaining representative claims after selection. |
| Obsolete preview | Existing probe receives an in-flight callback after preview cancellation. | An obsolete/cancelled response cannot replace the current brief's preview. Regression controls two deferred responses, changes/cancels the brief, resolves them out of order and proves only current data is shown. Do not freeze stale callbacks. |
| Share context | Existing questionnaire share generation uses origin/path plus answer hash, losing query context such as brand, mode, retailer, scope and configured API. | Preserve supported retail context when generating a share link; existing answer hashes still restore. Regression constructs a non-default-brand/national/retailer/API deep link, shares it and reopens the same context. Restoration tests in this baseline cover old answer shapes only. |
| Motorrad tourer explanation | A matched tourer currently says `The undefined shape you asked for`, because the body label table lacks this bike category. | Supply a legitimate tourer label, preserving score/rank and the other evidence. The narrow baseline projection accepts exact current malformed text or intended `The tourer shape you asked for`; any other shape text still diffs. A future repair needs a raw, unprojected reason assertion. |

## Motorrad raw evidence

Source capture revision: `ae98615dd9aae83146cc842ee15ee9d8f88b1162`. Input version `retail-compat-input-v1`; full frozen raw/mapped input and exact case remain in [inputs.json](../../../../server/test/fixtures/retail-compat-v1/inputs.json), case `motorrad-tour`, mapped Motorrad candidate ID `577045`. Its exact brief is:

```json
{
  "budget": [0, 30000],
  "bodyStyles": ["tourer"],
  "fuel": ["petrol"],
  "charging": "none",
  "ridingStyle": "touring",
  "licence": "a",
  "priorities": ["comfort"]
}
```

Unnormalised production result, captured before the compatibility projection:

```json
{
  "id": "577045",
  "name": "BMW R 1250 RT LE",
  "score": 85,
  "reasons": [
    "The petrol power you wanted",
    "The undefined shape you asked for",
    "Comfortably within your £30k budget",
    "94 litres of boot with all 2 seats up"
  ]
}
```

The malformed explanation is `reasons[1]`. The second tourer, candidate `577236`, has the same body-label boundary. Ranking/fit/taste/score, reason ordering/count and other explanations remain protected. The projection changes only this exact text slot on tourer decisions; the raw defect is not frozen as correct copy. Formal prior issue origin remains unresolved after local story/evidence searches; no backlog change is implied.
