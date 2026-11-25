# FUCQ-576 complete field causality ledger

This tracked record covers every changed expected field. Exact values remain in the six tracked fixtures, whose complete before/after byte hashes are below. Object additions are identified by canonical JSON SHA-256 and their fixture JSON pointer; this avoids duplicating the full policy registry. Prior values are recoverable at the recorded source base.

The complete annotated JSON is retained locally at `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/f555-resume-20261123/f576-validation/run/annotated-field-causality.json` (SHA-256 `e08a75dd6858b7d0c8e175ce956e83dba8c97d32a828e2e56e54ee0e780cb405`). It is evidence, not an executable input.

## Provenance

```json
{
  "decisionDate": "2026-11-23",
  "sourceHead": "361510f6572570a14e8ee2c8a0fd66a203a84c0e",
  "sourceTree": "31873fb752eab20c463782d55410a487a7ef54ce",
  "producerSha256": "251e97a35ebfea82ad74207cb550715aa6a01cf52b1fa73b31db379c9ba9a931",
  "rawLedgerSha256": "042e8969352927bdd722a55378335bc8b0413de1261d3efe8f2178e4c5695647",
  "generationReceiptSha256": "17e3a0fbf252c506fa9bfa1d8521c1380d9baa425b5d7ab1603e2b0f41a7b90a",
  "postrunReassessmentSha256": "81f6dab9a5be49bff245360b5d663276a4b1b140af8034b26f49932fbbb8650f",
  "generationScope": "six deterministic offline producers, not owning-module or full-suite validation",
  "dataStrategy": "default; immutable test input/output refresh only; no production data/schema/query change"
}
```

## Reviewed causes

### current-recommendation-row

Exact field equality to pinned current seed employee.recommendation.v1; source/basis/date plus complete ranking and optionEvidence row values are preserved. Learning retags policyVersion through its existing preparation. No other assumption changed.

Source clauses: `server/gcsp/comparison/generator.js:322`, `server/gcsp/policy/seed-v1.json`, `docs/gcsp/employee-recommendation.md:31`.

### comparison-policy-identity

SHA-256 covers complete loaded assumptions and allowances. The recommendation row change changes the policy identity even when generated arrays/inputHash and evaluated fit are identical.

Source clauses: `server/gcsp/comparison/generator.js:327`.

### unchanged-fit-seeded-lottery

Only cars0/2 assignment recipients/times, their 600-second declined-hold attribution, and employees0/2 orderUUIDs swap. Full generated arrays and every evaluated employee/car fit are identical (direct Buddy evaluation check); policyHash enters run identity, and unchanged allocation lottery hashes that runId. No new fairness or gallery-ranking rule is inferred. All totals and derived measures remain identical.

Source clauses: `server/gcsp/comparison/harness.js:166`, `server/gcsp/allocation/index.js:82`, `server/gcsp/allocation/index.js:95`, `server/gcsp/comparison/routes/buddy.js:111`.

### complete-outcome-digest

Each complete route record includes policyHash; outcomeRecordDigest hashes its entire content except codeRevision. Therefore every recorded route digest changes. Per-seed/arm metrics, aggregate measures, differences and effects remain identical.

Source clauses: `server/gcsp/comparison/experiments.js:24`, `server/gcsp/comparison/experiments.js:147`.

### stored-result-identity

Result ID hashes completedAt, full manifest and perSeed (process) or arms (experiment); changed policy identity and route digests propagate into the stored ID. Store/read wrapper and remaining fields are unchanged.

Source clauses: `server/gcsp/comparison/results.js:41`.

### learning-policy-identity

Learning policy hash independently covers learning assumptions, complete nested comparison assumptions, allowances and candidate policies. Only the nested recommendation row changed; this is not the comparison policyHash. Records, cycles, counts, configurationHash and dataHash are unchanged.

Source clauses: `server/gcsp/predict/records/dataset.js:18`.

### learning-snapshot-identity

Snapshot SHA covers the full learning snapshot, including its nested comparison recommendation row. The same new snapshotHash is recorded in snapshot.snapshotHash and manifest.snapshotHash; records are unchanged.

Source clauses: `server/gcsp/predict/records/generator.js:136`, `server/gcsp/predict/records/dataset.js:17`.

## Every changed field

Canonical value hashes below use UTF-8 JSON, sorted object keys and no insignificant whitespace. `absent` means the field did not exist; full fixture bytes, records, manifests and hashes remain intact.

### gcsp-comparison-representative.json

- Before bytes: `025e89e833beac90726b901dd4ef4503b3959f61b6a0955a6a42f2b777899164`
- Selected current bytes: `8fdef624cd07fb20d1912da2a675b5ef5cd5a1a7f6ef2071fb199086f80c60d4`
- Preparation: `{"input": "retained manifest seed and full overlay", "read": {"asOf": "2026-11-05T09:00:00.000Z", "policyVersion": "gcsp-policy-v1", "runId": "comparison-policy-read"}, "testModule": "gcsp-comparison-generator.test.js"}`
- Reviewed paths: 6; unexplained: `[]`.

| JSON pointer | Before | Current | Reviewed cause |
|---|---|---|---|
| `/manifest/assumptions/19/basis` | `"Read-only employee composition of existing rankCars curves; explicit dimensions, separate importance/indifference, confirmed exact evidence and no retail cash budget. Quote terms are pinned for at least the buddy hold (7,200 s) so a held offer can be accepted for its whole countdown. Demo calibration is revisable, not BMW policy."` | `"Existing rankCars preference curves with separate importance/indifference and confirmed exact evidence. Collaborator direction, 11 November 2026: use more of the allowance among similarly matched eligible cars; five preference-score points defines a revisable similarity band. No retail cash budget. Quote terms remain pinned for the full 7,200-second buddy hold. Demo calibration is revisable, not BMW policy. Collaborator-reviewed option mappings, 11 November: invisible equipment preference at importance 100; desirability weights 0..3. Shared fixed saturation scale (eight desirability points gives 50/100); supporting slider evidence moves five points per reviewed unit, capped at twenty. Unresolved packages use conservative overlapping-capability fallbacks, not inferred contents. Only selected active catalogue configuration/fitted evidence counts. These calibration values are revisable assumptions."` | `current-recommendation-row` |
| `/manifest/assumptions/19/source` | `"docs/gcsp/shared-recommendation-design.md"` | `"docs/gcsp/employee-recommendation.md"` | `current-recommendation-row` |
| `/manifest/assumptions/19/sourceDate` | `"2026-11-05"` | `"2026-11-11"` | `current-recommendation-row` |
| `/manifest/assumptions/19/value/optionEvidence` | absent | object SHA-256 `1b2524f1d4899fc54a1bd177f8cc99936abb20f767e04068b532328d0b82bac8` | `current-recommendation-row` |
| `/manifest/assumptions/19/value/ranking` | absent | object SHA-256 `7e05b6fa71180ed2867772b9e5caf6dd97f19d13fa6704773f1f2e7b295d23b1` | `current-recommendation-row` |
| `/manifest/policyHash` | `"97df1a052794bcb1b8dbd5673a82debbf90c159602b247758f0276e8f9c1dcd5"` | `"c0106882da69259021845df1a26128b218ac7dc7b79d5b528fe3806af7dff994"` | `comparison-policy-identity` |

### gcsp-comparison-current-outcomes.json

- Before bytes: `586cf939c3a264f41bf81b50e13035cb9531db2e60fb620eff889d510d4695d2`
- Selected current bytes: `304b069602fe73d50d95cc0cf99ea45a990a6e960157f18cd7f98affbc389601`
- Preparation: `{"codeRevision": "fucq134-test", "input": "retained outcomeScenario seed/full overlay", "read": {"asOf": "2026-11-05T09:00:00.000Z", "runId": "comparison-fixture-preparation"}, "route": "current", "testModule": "gcsp-comparison-current.test.js"}`
- Reviewed paths: 1; unexplained: `[]`.

| JSON pointer | Before | Current | Reviewed cause |
|---|---|---|---|
| `/outcomeRecord/policyHash` | `"97df1a052794bcb1b8dbd5673a82debbf90c159602b247758f0276e8f9c1dcd5"` | `"c0106882da69259021845df1a26128b218ac7dc7b79d5b528fe3806af7dff994"` | `comparison-policy-identity` |

### gcsp-comparison-buddy-outcomes.json

- Before bytes: `c6aaf78a9dd0d3ddba6bca6eda345548f458d957fe8b64c43c3521d8f12963a7`
- Selected current bytes: `a42303a7f2261f71877f51a0231b3f8014ce35938b7d892812d9ee4f3968d4dd`
- Preparation: `{"codeRevision": "fucq135-test", "input": "retained seed/full overlay", "read": {"asOf": "2026-11-05T09:00:00.000Z", "runId": "comparison-buddy-preparation"}, "route": "buddy", "testModule": "gcsp-comparison-buddy.test.js"}`
- Reviewed paths: 13; unexplained: `[]`.

| JSON pointer | Before | Current | Reviewed cause |
|---|---|---|---|
| `/outcomeRecord/cars/0/allocatedAt` | `"2026-11-05T09:10:00.000Z"` | `"2026-11-06T09:01:30.000Z"` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/cars/0/allocatedTo` | `"fictional-employee-0880d7140e3e8288a74d95d0"` | `"fictional-employee-9a4d3618017e8c0fc57b8df9"` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/cars/0/buddyHeldNotTakenHours` | `0` | `0.166667` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/cars/0/buddyHeldNotTakenSeconds` | `0` | `600` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/cars/0/declines` | `0` | `1` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/cars/2/allocatedAt` | `"2026-11-06T09:01:30.000Z"` | `"2026-11-05T09:10:00.000Z"` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/cars/2/allocatedTo` | `"fictional-employee-9a4d3618017e8c0fc57b8df9"` | `"fictional-employee-0880d7140e3e8288a74d95d0"` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/cars/2/buddyHeldNotTakenHours` | `0.166667` | `0` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/cars/2/buddyHeldNotTakenSeconds` | `600` | `0` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/cars/2/declines` | `1` | `0` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/employees/0/orderUuid` | `"7681091f-329f-4cf1-bb17-bbaf5aa3dc0c"` | `"c73009eb-8ab9-4015-a94a-2cc5f0e505c6"` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/employees/2/orderUuid` | `"c73009eb-8ab9-4015-a94a-2cc5f0e505c6"` | `"7681091f-329f-4cf1-bb17-bbaf5aa3dc0c"` | `unchanged-fit-seeded-lottery` |
| `/outcomeRecord/policyHash` | `"97df1a052794bcb1b8dbd5673a82debbf90c159602b247758f0276e8f9c1dcd5"` | `"c0106882da69259021845df1a26128b218ac7dc7b79d5b528fe3806af7dff994"` | `comparison-policy-identity` |

### gcsp-comparison-process-result.json

- Before bytes: `89da1123ed5c0d144de8023336f5643ce99d859cde086868b333a69bc0df7d63`
- Selected current bytes: `66835f43119e8daa015e638f387b3452df3946c43f3e558758dae7f350c64929`
- Preparation: `{"asOf": "canonical comparison.startsAt", "codeRevision": "fucq136-test", "input": "process-only, canonical three seeds and retained Buddy overlay", "now": "2026-11-08T12:00:00.000Z", "readRunId": "comparison-experiment-preparation", "testModule": "gcsp-comparison-measures.test.js"}`
- Reviewed paths: 8; unexplained: `[]`.

| JSON pointer | Before | Current | Reviewed cause |
|---|---|---|---|
| `/storedResult/result/manifest/policyHash` | `"97df1a052794bcb1b8dbd5673a82debbf90c159602b247758f0276e8f9c1dcd5"` | `"c0106882da69259021845df1a26128b218ac7dc7b79d5b528fe3806af7dff994"` | `comparison-policy-identity` |
| `/storedResult/result/perSeed/0/routes/buddy/recordDigest` | `"51c883ab084453141f6af70bb0885a33ef0b4af4998649fc94351fac3a0ace51"` | `"86824eff35742b50cffd8928fe36c7f25fe323546b34fb7b6f12407f5e27d0de"` | `complete-outcome-digest` |
| `/storedResult/result/perSeed/0/routes/current/recordDigest` | `"6c4da99effac70337683622895d8896b06f98ffd0fc3bc5ce9238bebfbf13f67"` | `"35e258f6c4ab9cd92066db2b8f02c80b4e2e79811123fc7c7b9be3b7d40539a6"` | `complete-outcome-digest` |
| `/storedResult/result/perSeed/1/routes/buddy/recordDigest` | `"a86bccd1dd065932840e1c5d739ddb6ff754a391fd5414dda9f92187339ecf84"` | `"5d533fff4e91266d3739bc8e52d28633dcf46ce7d0c26780009b8bdac83a2174"` | `complete-outcome-digest` |
| `/storedResult/result/perSeed/1/routes/current/recordDigest` | `"fc85899b3ab8b06cc1d4f1f0d2d46e5ecf886c6d92afcf54311cccf91b7a466b"` | `"b4bc8fddeaf4a50501309b66524445e362ad015700bde59528277106d8c43fd2"` | `complete-outcome-digest` |
| `/storedResult/result/perSeed/2/routes/buddy/recordDigest` | `"f756b14b298df9c2c3c765b66fd0ae7427b9b5152609d1fa37996ba5c48c4d41"` | `"e195b89158f9c2fb0b73b52142277c368749ef244403995245ba2917bfe9ec63"` | `complete-outcome-digest` |
| `/storedResult/result/perSeed/2/routes/current/recordDigest` | `"f74f2c8f4cec4ce239a73b347fa9dbf17892a4c20f6f8a26039a2ba66a0c5f42"` | `"1a93fcd2fb58620ea140c5c6ba4a0d5bd03a5f13f63c331949b16ef7b08ca625"` | `complete-outcome-digest` |
| `/storedResult/resultId` | `"process-comparison-09e9e4b53b2fd67e1d752e9253c4080f"` | `"process-comparison-ce8b1e4cf5bc03164a08baf3f9c0d00c"` | `stored-result-identity` |

### gcsp-comparison-experiment-result.json

- Before bytes: `27ebe66556a1e711b867d2a56124793ad09d4a23fec5b67c6a17fc5028aee286`
- Selected current bytes: `51f9384071063951eb28e247bfa6888b8a0845ae6522374c7e21821cc881d1b5`
- Preparation: `{"asOf": "canonical comparison.startsAt", "basis": "Test basis: an illustrative what-if value.", "codeRevision": "fucq136-test", "input": "hold-sweep [900,86400], canonical three seeds and retained Buddy overlay", "now": "2026-11-08T12:00:00.000Z", "readRunId": "comparison-experiment-preparation", "testModule": "gcsp-comparison-measures.test.js"}`
- Reviewed paths: 20; unexplained: `[]`.

| JSON pointer | Before | Current | Reviewed cause |
|---|---|---|---|
| `/storedResult/result/arms/0/perSeed/0/routes/buddy/recordDigest` | `"51c883ab084453141f6af70bb0885a33ef0b4af4998649fc94351fac3a0ace51"` | `"86824eff35742b50cffd8928fe36c7f25fe323546b34fb7b6f12407f5e27d0de"` | `complete-outcome-digest` |
| `/storedResult/result/arms/0/perSeed/0/routes/current/recordDigest` | `"6c4da99effac70337683622895d8896b06f98ffd0fc3bc5ce9238bebfbf13f67"` | `"35e258f6c4ab9cd92066db2b8f02c80b4e2e79811123fc7c7b9be3b7d40539a6"` | `complete-outcome-digest` |
| `/storedResult/result/arms/0/perSeed/1/routes/buddy/recordDigest` | `"a86bccd1dd065932840e1c5d739ddb6ff754a391fd5414dda9f92187339ecf84"` | `"5d533fff4e91266d3739bc8e52d28633dcf46ce7d0c26780009b8bdac83a2174"` | `complete-outcome-digest` |
| `/storedResult/result/arms/0/perSeed/1/routes/current/recordDigest` | `"fc85899b3ab8b06cc1d4f1f0d2d46e5ecf886c6d92afcf54311cccf91b7a466b"` | `"b4bc8fddeaf4a50501309b66524445e362ad015700bde59528277106d8c43fd2"` | `complete-outcome-digest` |
| `/storedResult/result/arms/0/perSeed/2/routes/buddy/recordDigest` | `"f756b14b298df9c2c3c765b66fd0ae7427b9b5152609d1fa37996ba5c48c4d41"` | `"e195b89158f9c2fb0b73b52142277c368749ef244403995245ba2917bfe9ec63"` | `complete-outcome-digest` |
| `/storedResult/result/arms/0/perSeed/2/routes/current/recordDigest` | `"f74f2c8f4cec4ce239a73b347fa9dbf17892a4c20f6f8a26039a2ba66a0c5f42"` | `"1a93fcd2fb58620ea140c5c6ba4a0d5bd03a5f13f63c331949b16ef7b08ca625"` | `complete-outcome-digest` |
| `/storedResult/result/arms/1/perSeed/0/routes/buddy/recordDigest` | `"15a61aea6ff339376df4dffd30455e8db13ae9fdd2559919eddf2aaec0ce4f24"` | `"154643b0aab411472a55ff1f2c7e7d03d1a4b815024b14369f8da0188a5583fd"` | `complete-outcome-digest` |
| `/storedResult/result/arms/1/perSeed/0/routes/current/recordDigest` | `"6c4da99effac70337683622895d8896b06f98ffd0fc3bc5ce9238bebfbf13f67"` | `"35e258f6c4ab9cd92066db2b8f02c80b4e2e79811123fc7c7b9be3b7d40539a6"` | `complete-outcome-digest` |
| `/storedResult/result/arms/1/perSeed/1/routes/buddy/recordDigest` | `"227586848f28a0959210f19994e3de02f18085a3490a1dfbe08cac2bbfc9eed2"` | `"add5b2f75b98325d73b380647b9131763ed54dc9341cf8d061542e2d185b2a63"` | `complete-outcome-digest` |
| `/storedResult/result/arms/1/perSeed/1/routes/current/recordDigest` | `"fc85899b3ab8b06cc1d4f1f0d2d46e5ecf886c6d92afcf54311cccf91b7a466b"` | `"b4bc8fddeaf4a50501309b66524445e362ad015700bde59528277106d8c43fd2"` | `complete-outcome-digest` |
| `/storedResult/result/arms/1/perSeed/2/routes/buddy/recordDigest` | `"7ebec9028388d6442600854209dda286dfd88186b784425ef6fcc2b2a6f0a9b1"` | `"1b7a48ed26bf45370013aa55bd0fcc1f773be48ffa66634dc8a73116c150f6c4"` | `complete-outcome-digest` |
| `/storedResult/result/arms/1/perSeed/2/routes/current/recordDigest` | `"f74f2c8f4cec4ce239a73b347fa9dbf17892a4c20f6f8a26039a2ba66a0c5f42"` | `"1a93fcd2fb58620ea140c5c6ba4a0d5bd03a5f13f63c331949b16ef7b08ca625"` | `complete-outcome-digest` |
| `/storedResult/result/arms/2/perSeed/0/routes/buddy/recordDigest` | `"4cc74955d3f718f036ddced6770790624b5b0a438ae033e87ff537d2f46f02e1"` | `"1f1722dca5915022069d35960b3d1fedf5abcb7d46538216d865498e4e17898b"` | `complete-outcome-digest` |
| `/storedResult/result/arms/2/perSeed/0/routes/current/recordDigest` | `"6c4da99effac70337683622895d8896b06f98ffd0fc3bc5ce9238bebfbf13f67"` | `"35e258f6c4ab9cd92066db2b8f02c80b4e2e79811123fc7c7b9be3b7d40539a6"` | `complete-outcome-digest` |
| `/storedResult/result/arms/2/perSeed/1/routes/buddy/recordDigest` | `"de0b39cd25384f9a1c23d8711d1f11a828e9bcb9ba3c3c87d21c328b55746d76"` | `"96601a9d29f1617cd8d5e59e316fcb920ef122e17a7ad8624acc0eb7a399a3fc"` | `complete-outcome-digest` |
| `/storedResult/result/arms/2/perSeed/1/routes/current/recordDigest` | `"fc85899b3ab8b06cc1d4f1f0d2d46e5ecf886c6d92afcf54311cccf91b7a466b"` | `"b4bc8fddeaf4a50501309b66524445e362ad015700bde59528277106d8c43fd2"` | `complete-outcome-digest` |
| `/storedResult/result/arms/2/perSeed/2/routes/buddy/recordDigest` | `"e33cdfeffffb017c0dcc7b68b6678775b8e551530fcc8c2f5e081adcc00c5795"` | `"d3359a7f198dca2bae167ee34d78fa6eb6bb68bc08298be75b26aa32f3e7d74c"` | `complete-outcome-digest` |
| `/storedResult/result/arms/2/perSeed/2/routes/current/recordDigest` | `"f74f2c8f4cec4ce239a73b347fa9dbf17892a4c20f6f8a26039a2ba66a0c5f42"` | `"1a93fcd2fb58620ea140c5c6ba4a0d5bd03a5f13f63c331949b16ef7b08ca625"` | `complete-outcome-digest` |
| `/storedResult/result/manifest/policyHash` | `"97df1a052794bcb1b8dbd5673a82debbf90c159602b247758f0276e8f9c1dcd5"` | `"c0106882da69259021845df1a26128b218ac7dc7b79d5b528fe3806af7dff994"` | `comparison-policy-identity` |
| `/storedResult/resultId` | `"hold-sweep-comparison-4502a5f0a475c449ee4234a1dd72edbe"` | `"hold-sweep-comparison-e939356bbdb3a9c8172ef01bf87bfe78"` | `stored-result-identity` |

### gcsp-learning-dataset.json

- Before bytes: `454f0b7ca1579868e549f7a885c0dcd78d25e4c3e8b2a0bde741c5bfda9df773`
- Selected current bytes: `bdc347dc2c03b12afb6882057318e1b167ae7102cbd524f992bb47b4473f5b91`
- Preparation: `{"definitionsFileSha256": "c083ed58abcde595ac0cbf077b319b9102795506efb736c980d5f0cdba840143", "input": "existing learningSource enrich=true/single=false, cohort=3/cycles=2", "read": {"asOf": "2026-11-05T09:00:00.000Z", "policyVersion": "fictional-learning-policy-v1", "runId": "fictional-learning-policy-read"}, "seed": "fictional-learning-sample-v1", "testModule": "gcsp-learning-records.test.js"}`
- Reviewed paths: 8; unexplained: `[]`.

| JSON pointer | Before | Current | Reviewed cause |
|---|---|---|---|
| `/manifest/policyHash` | `"765f2efd8cc8f1df40c323e6f2ebb92ce6ceebff8634e8000661665c510558d5"` | `"6f8ea0fabe830e68385b82f209896aee5cf44bf8bbf216ad8909b531070d347f"` | `learning-policy-identity` |
| `/manifest/snapshot/comparison/assumptions/employee.recommendation.v1/basis` | `"Read-only employee composition of existing rankCars curves; explicit dimensions, separate importance/indifference, confirmed exact evidence and no retail cash budget. Quote terms are pinned for at least the buddy hold (7,200 s) so a held offer can be accepted for its whole countdown. Demo calibration is revisable, not BMW policy."` | `"Existing rankCars preference curves with separate importance/indifference and confirmed exact evidence. Collaborator direction, 11 November 2026: use more of the allowance among similarly matched eligible cars; five preference-score points defines a revisable similarity band. No retail cash budget. Quote terms remain pinned for the full 7,200-second buddy hold. Demo calibration is revisable, not BMW policy. Collaborator-reviewed option mappings, 11 November: invisible equipment preference at importance 100; desirability weights 0..3. Shared fixed saturation scale (eight desirability points gives 50/100); supporting slider evidence moves five points per reviewed unit, capped at twenty. Unresolved packages use conservative overlapping-capability fallbacks, not inferred contents. Only selected active catalogue configuration/fitted evidence counts. These calibration values are revisable assumptions."` | `current-recommendation-row` |
| `/manifest/snapshot/comparison/assumptions/employee.recommendation.v1/source` | `"docs/gcsp/shared-recommendation-design.md"` | `"docs/gcsp/employee-recommendation.md"` | `current-recommendation-row` |
| `/manifest/snapshot/comparison/assumptions/employee.recommendation.v1/sourceDate` | `"2026-11-05"` | `"2026-11-11"` | `current-recommendation-row` |
| `/manifest/snapshot/comparison/assumptions/employee.recommendation.v1/value/optionEvidence` | absent | object SHA-256 `1b2524f1d4899fc54a1bd177f8cc99936abb20f767e04068b532328d0b82bac8` | `current-recommendation-row` |
| `/manifest/snapshot/comparison/assumptions/employee.recommendation.v1/value/ranking` | absent | object SHA-256 `7e05b6fa71180ed2867772b9e5caf6dd97f19d13fa6704773f1f2e7b295d23b1` | `current-recommendation-row` |
| `/manifest/snapshot/snapshotHash` | `"bac33ccbfa10099dcec54c8fb25c22b35716248162b0cc4d145b40f9ed1f7ea6"` | `"7d6ba3b2c50a8c9b8e57d55184c612b7b93915b75a548ffd0478f314798f9d88"` | `learning-snapshot-identity` |
| `/manifest/snapshotHash` | `"bac33ccbfa10099dcec54c8fb25c22b35716248162b0cc4d145b40f9ed1f7ea6"` | `"7d6ba3b2c50a8c9b8e57d55184c612b7b93915b75a548ffd0478f314798f9d88"` | `learning-snapshot-identity` |

## Preserved checks

The [six historical exact reproductions](counterfactual-checks.md) and [five complete input/evaluation comparisons](evaluation-checks.md) retain their exact report payloads.

```json
{
  "allSixHistoricalOutputsExact": true,
  "allFiveGeneratedArraysAndFullEvaluationsExact": true,
  "currentTotals": true,
  "buddyTotals": true,
  "learningRecords": true,
  "learningManifestKeys": true,
  "derivedTestLiteralChangesRequired": false
}
```

Unresolved fields: `[]`. Owning-module validation is recorded separately.
