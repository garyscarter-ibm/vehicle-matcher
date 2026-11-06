# FUCQ-134 current-route failure diagnosis and repair proposal

6 November 2026. Author-only source review of published `09aa1c85a22bc6cd1361c1a0a34fa71198bde48c` and its frozen actual66 composition. This note proposes scope for review; it authorizes no repair, target import, probe, test, allocation, retry, new mode or delegate. No runtime success or story acceptance is established.

## Observed result and evidence

The newest once-only execution reached all three selected cases and failed **0 pass / 3 fail**. Root retained controller exit **2** and immediate completion-audit exit **1** (tool session `41589`, completion `2d735a`). The Node process exited **1**. These are actual case failures, independently of the reporter contract failure:

| Case | Observed failure | Boundary not reached |
| --- | --- | --- |
| `isolation` | `ComparisonRunError: Comparison run invalid: snapshot:policy_versions`, test line 52 | Sentinel comparison and subsequent claim |
| `real-claim-review-allocate` | `claimFirst`, test line 39: actual 0 eligible cars, expected 2 | Claim, review, allocation and persisted assertions |
| `untaken-expiry` | Same actual 0 / expected 2 assertion | Claim, deadline tick, expiry and returned-stock assertions |

Retained paths are under the shared checkout's `.claude/test-runs/`:

- `fucq134/first-chunk-4e6c5d279b4e42caa799597a8b292fc7/test.log`: 20,952 bytes, SHA-256 `5fcedac03d9e5e91f0ebd48d863369ed030f86dfc2d5171cee9494a3102aa822`.
- That run's `receipt.json`: SHA-256 `b722e9963f7a07b9321c3c0fd9db2040b3b6b0e15a851bd804acc1d55d7f9d62`; provisional failed receipt, not completion evidence.
- `ownership/fucq134-23afd242e29040db8c7ec9ff2a66e3a1.json`: SHA-256 `81cd23ddb7edc2fe1d598f4e943ebb0cd6d57b3522e7b0acfd6e92697b311aab`; first failure is `RuntimeError`, execution, `Selected three-case TAP contract failed`; `uncertainGroups` is empty.
- Root's independently retained `ownership/fucq134-third-run-root-cleanup-0911.json`: SHA-256 `6284cbd3eed7f31379e5948336a024e71c9b66d6884d4587fbe02b55c609e839`; PASS, 19 checks, 788 fresh process identity rows, no cleanup mutations or ledger writes. It establishes absence of owned processes/groups, scratch and reservation, separately from failed test execution. This author read that report; it performed no new process, open-file or ledger checks.

The log uses spec output (`✖` case lines and `ℹ tests 3`, `ℹ pass 0`, `ℹ fail 3`), rather than the supervisor's required TAP. The supervisor therefore retained empty parsed counts/names as well as the nonzero Node exit. A reporter repair cannot turn these three failures into passes.

## Frozen code basis

`docs/gcsp/evidence/fucq134/first-chunk-admission.json`, SHA-256 `07300f741f8eebc19a8baa68c571a924de4daa8429cbb1e693fdb51e6ba76079`, embeds the authoritative source texts used here. Relevant source hashes were checked before reading. Local upstream files were not substituted for the frozen texts.

- Base `034b56d08fb742d31478218b670552805d5840ab`; actual66 `eb5a677b37c486e3da7c4547803f739e22df8ac3`.
- Source identity `7a982714de7cf74968cabcfbe3712be2ff4c3fe75cf95acda3381044cffa4a82`; 45 sources / 971,783 bytes / 72 accepted edges / 236 physical nodes.
- Origin relationship: these are failures in FUCQ-134's authored current-route mechanics harness, fixture and launch contract, using the pinned actual66 integration. That does not establish a defect in FUCQ-66's claim/review/allocate/expiry implementation: those operations were not reached.

## Snapshot: wrong caller enumeration

The harness creates its own default memory repository at `server/gcsp/comparison/harness.js:143`, with no `supportedTables` override. Its `snapshot()` at lines 205–207 queries `Object.keys(TABLES)`.

`server/gcsp/repository/schema.js:35` defines `FOUNDATION_TABLES` by excluding six policy tables, beginning with `policy_versions`. `core.js:78,90,354–360` applies that supported-table contract to queries and returns `invalid/unsupported-table` for the excluded table. `TABLES` describes known schema; it does not declare this provider instance's capability. The injected PolicyService is a separate authoritative read port (`policy/index.js:78–138`), and the harness's wrapper delegates eligibility, prices and allowances to it (`harness.js:58–64`).

**Proposed responsible caller delta:** snapshot the explicit `FOUNDATION_TABLES` contract for the default repository the harness creates. Retain refusal on any failed supported-table query. Do not enable all tables, persist a second policy copy, swallow unsupported results or treat the policy schema registry as provider capability. If policy isolation needs additional evidence, compare pinned PolicyService reads through that port; an empty repository policy table would prove nothing about its provider.

## Empty eligible input: fixture contract is incompatible with a permitted grade

The mechanics fixture fixes every stock car to `G21 Touring|320i` but retains the canonical employee grade distribution. `generator.js:264–266` expressly forbids a grade-distribution overlay, and lines 275–295 choose the employee grade from the canonical weighted distribution and resolve its actual allowance. `claimFirst` always browses for employee zero and asserts that both generated cars are eligible.

The frozen canonical policy contains these FS&UK facts:

| Context/model | Inclusion and price |
| --- | --- |
| G1–6, 40 of 100 grade weights | 1,000 monthly points allowance |
| G7 / G8–10 / G11–14 | 1,300 / 1,600 / 2,200 monthly points allowance |
| `G21 Touring|320i` | Explicit exclusion for G1–6; inclusion for the other three bands; 1,100 monthly points |
| `G20 Saloon|320i` | The same grade restrictions and 1,100 monthly points; switching to it is insufficient |
| `F70 Sports Hatch|120` | Inclusion for all four generated bands; 800 monthly points |

The live path preserves these gates: `manual-context/ports.js:46–64` supplies released visible exact stock; `manual-context/index.js:283–328` invokes the real recommendation service and returns only eligible decisions. `recommendation/index.js:117–149` applies policy inclusion, affordability, driver, essential, timing and charging gates before eligibility. A G1–6 employee must therefore receive no eligible Touring cars: both explicit exclusion and insufficient allowance independently block them.

The fixture supplies five known seats against the four-seat essential, insurance group 25 against the minimum grade cap 30, a confirmed eligible driver, a car licence valid 2020–2030, petrol stock, day-zero release and a 30-day renewal. Its typed facts carry accepted synthetic provenance. These source paths support the policy/fixture mismatch diagnosis; they do not replace a captured candidate-decision result.

**Evidence limit:** the retained log does not contain employee zero's generated grade or its candidate blocker/unknown codes. Scratch was removed. G1–6 is a source-based explanation consistent with the observed zero, not a directly observed grade. This author did not execute or reproduce the generator, calculate its seeded draw, or manufacture a generated-input receipt. Other unobserved failure reasons must not be declared excluded by runtime evidence.

**Proposed responsible fixture delta:** use an explicitly reviewed synthetic mechanics configuration that the unchanged canonical policy admits for every generated grade, with the stock facts required by the real gates. `F70 Sports Hatch|120` is a concrete policy-compatible candidate. This is more than a one-line model replacement: the frozen `comparison.configurationSet.v1` and `comparison.recordAdapter.v1.stockFactsByModelLine` contain only G20, G21 and G61. `generator.js:163–178` rejects a model absent from that configuration set, while the harness leaves absent model facts unknown.

The narrow fixture repair would consequently add one explicitly synthetic structural configuration and its necessary typed facts to the selected test variant, then select that model in the mechanics overlay. The fixture and its existing test-variant preparation are the responsible writers. Keep canonical eligibility, prices, allowances, grade distribution, generator prohibitions and the expected-two-cars assertion unchanged. Do not relabel a Touring as an eligible hatch, force eligibility, skip the assertion or infer missing facts. Retain provenance and unknown equipment/constructibility limitations. This scope needs review before authoring.

Before claiming the latest zero is fully explained, obtain employee zero's grade and bounded decision blocker/unknown codes in separately authorized validation. Include them in an assertion diagnostic while preserving the non-vacuous expected-two assertion. A corrected fixture passing later would not reconstruct the failed run's discarded inputs.

## Reporter: explicit producer/consumer contract

The supervisor at `first-chunk-supervisor.py:226–228` launches the gated `.mjs` file with no explicit reporter. The launcher installs the frozen guard and directly imports the `node:test` module at launcher line 10. Supervisor lines 266–272 accept only three exact TAP case names and the exact tests/pass/fail/cancelled/skipped/todo counts.

**Proposed responsible launch delta:** explicitly request TAP on the Node command line before the launcher (candidate argument `--test-reporter=tap`) while preserving the stdin gate, guard installation, direct import, single-worker scope, stdout/stderr capture and exact parser assertions. Compatibility with this pinned Node/direct-import route remains to be validated; no Node help command or runtime probe was run here. Do not broaden the parser to accept a spec summary, interpret empty counts as success, add a second execution mode or mask nonzero test exit status.

## Review and prospective validation boundary

Review the snapshot caller, complete fixture/configuration/facts delta, bounded failed-assertion diagnostic and explicit reporter setting as separate responsibilities. Repair authoring and any replacement freeze require approval of that scope first. Every subsequent execution requires current admission and a fresh explicit once-only grant. The newest grant and both earlier grants remain consumed.

After authorized authoring, static review must preserve all three case assertions, real inclusion/affordability/unknown-fact gates, frozen producer identity, source edges, supervisor cleanup/accounting and resource limits. The prospective runtime scope remains exactly `isolation`, `real-claim-review-allocate`, `untaken-expiry`, one worker, 120 seconds whole / 110 execution, 768 MiB aggregate RSS, 128 MiB combined output/scratch, 2 MiB log and 5 GiB host reserve, with the existing internal completion margins. Root owns execution, actual waits, final receipt and independent cleanup audit. No suite, corpus, browser, native database, live integration, comparison outcome or story-completion proof follows from this diagnosis.

The original pre-Node failure's causal row remains UNKNOWN. The separately captured earlier `?` OS-state failure and its historical `uncertainGroups: [34518]` remain preserved in the previous protocol proposal and original manifests. This newest run's product failures do not explain or replace either historical parser failure.

No product, harness, fixture, launcher, tests, admission or map status changed in this diagnosis. No screen or user-visible behavior changed; no new visual acceptance claim. Agents: requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants.
