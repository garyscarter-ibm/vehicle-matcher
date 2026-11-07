# FUCQ-100 corrected required npm result — 6 November 2026

**FAIL: 1,590 tests; 1,569 passed; 16 failed; five skipped; no cancelled/todo.** Command and outer supervisor exited 1. This is evidence, not story acceptance or a merge ruling.

`npm test` used the existing one-worker script, `node --test --test-concurrency=1 server/test/**/*.test.js`, on `0a061129f324f9de991327d34a2002f90728e8f7` / tree `22eaba3916234c4b9d18f7314f8ed26f12f758fd`. Product integration remains `ef777c365b1d9d9e9aeed20bba5a0a6a2eb2decd`, product tree `8a8edc30e148715c48e3041fc2da9dce47314118`, base `ecce0b34ffcce2c978d000c76995693ba78a52d4`.

The first immutable [failed attempt](required-npm-result-2026-11-06.json) had 627 tests, 564 pass and 63 fail, including 57 missing-`pg` failures. The dispatcher authorised `npm ci --prefix server --ignore-scripts --no-audit --no-fund`: it added 14 packages and exited 0, changing installed environment only. Manifests/locks/source stayed unchanged. `server/node_modules` is the retained authorised environment. All missing-`pg` errors disappeared in the corrected test; all remaining failures are assertions.

The corrected worker took 200.563 seconds (205.580 seconds including supervision). Sampled aggregate RSS peaked at 472,219,648 bytes; combined charged disk at 9,479,968 bytes, within 2,048 MiB RAM / 256 MiB disk, 4 MiB logs, 1 MiB metadata and 600/660-second bounds. Physical reserves were 512 MiB RAM and 5 GiB disk. Source and dependencies were unchanged during the corrected test. Dependency fingerprint: `f3553fb51f4f01d004343e30618bc3011a194e7c5e0f3f292a6d4823d793ad57`.

## Failure classification

Source-only classification gives ten causes: two **Medium product interaction defects (three failed cases)** and eight **Low fixture/scanner causes (13 failed cases)**. These severities reflect observed impact; none is reduced to clear merge. No new Critical/High cause is demonstrated by these failures. The separate review of FUCQ-140–143 is not repeated. All 16 cases remain failed.

| Cause | Exact failed test locations (declaration → assertion) | Classification / severity |
|---|---|---|
| C1 Root-wide assertions count hidden presenter DOM | `gcsp-account-render.test.js:196 → 231`; `gcsp-greg-dashboard.test.js:179 → 185` | fixture scope mismatch / **Low** |
| C2 Three-handler fixture predates lifecycle composition | `gcsp-buddy-runtime-integration.test.js:119 → 123`; `gcsp-buddy-runtime-integration.test.js:159 → 166`; `gcsp-buddy-runtime-integration.test.js:200 → 213` | stale fixture expectation / **Low** |
| C3 Reviewed-key setup requests a successor after keys already exist | `gcsp-buddy-runtime-integration.test.js:187 → 15` | stale fixture setup / **Low** |
| C4 Greg fixture overwrites required bound manual records | `gcsp-greg-dashboard-data.test.js:15 → 23`; `gcsp-greg-dashboard-data.test.js:59 → 63`; `gcsp-greg-dashboard-data.test.js:104 → 109` | stale fixture source contract / **Low** |
| C5 CSS scanner consumes an import as selector text | `gcsp-greg-dashboard.test.js:377 → 381` | scanner mismatch / **Low** |
| C6 Price error-summary callback loses selection identity | `gcsp-greg-publish-render.test.js:90 → 95`; `gcsp-greg-publish-render.test.js:98 → 106` | actual product interaction defect / **Medium** |
| C7 Resume loses focus when async review heading replaces initial heading | `gcsp-manual-journey-resume.test.js:150 → 156` | actual product focus defect / **Medium** |
| C8 Renewal alternative-car fixture seeds available instead of released | `gcsp-renewal-case.test.js:19 → 204` | known fixture/source-state mismatch / **Low** |
| C9 Employee-element location ratchet scans the offer entry wrapper | `gcsp-shell.test.js:729 → 736` | overbroad source ratchet / **Low** |
| C10 Future-offer fixture now coexists with a real direct offer page | `launcher-package.test.js:48 → 57` | fixture isolation/route-priority mismatch / **Low** |

All locations above are under `server/test/`. Full exact titles are preserved in the [JSON record](required-npm-corrected-result-2026-11-06.json).

### C1 — Root-wide assertions count hidden presenter DOM

portalShell now mounts presenter controls by default. mountPresenterControls creates one text input while its root stays hidden until authorization. presenterBar creates factList([]), an empty dl. These explain the root-wide counts of one input on Account and one dl on refused Greg. Greg refusal clears body figures and metadata; the counted dl is an empty hidden presenter readback.

Test scope changed after composition; the inspected refused fixture does not expose demand figures. No authorization bypass or private demand disclosure is demonstrated. This conclusion covers the counted empty hidden region, not all presenter authorization behavior.

Origin: FUCQ-100 shell composition 112fdfe275fc2019b830ac04976244513a56b642; presenter leaves f179ae6043414a2b07de3edb2b425338299ea37b. Account source/test fcc8e139dd71ebcdec3fe510179cf35e952a13ec and Greg fixture tests acee2bdd26ecadd2842003769c051a307f549499 predate the composition.

Known overlap: Same presenter composition area as FUCQ-143, but counting hidden DOM is not the custom-element registration finding. Unresolved: no confirmed matching Bug ID in the supplied lane record; dispatcher must deduplicate before intake.

Limit: Both cases remain failed. Account assertions after line 231 and Greg reserved-region assertion after line 185 were not reached. No new DOM/browser run was performed.

Source: `blocks/gcsp/shell/portal-shell.js:206`, `blocks/gcsp/presenter-controls/controls.js:45`, `blocks/gcsp/presenter-controls/controls.js:60`, `blocks/gcsp/kit/presenter-bar.js:9`, `blocks/gcsp/greg/gcsp-greg.js:193`.

### C2 — Three-handler fixture predates lifecycle composition

Expected handler IDs are manual-claim-expiry, buddy-expiry, captured-outbox. Actual registration also contains the intentionally composed selection-order-reconciliation, lifecycle-approvals, lifecycle-documents and renewal-risk-cases. All three old expected IDs remain present. Reset reports the four additional IDs in its actual post-reset order.

Exact-list test maintenance; observed differences add composed stages rather than lose the expected handlers. This does not prove all handler effects or ordering semantics.

Origin: Fixture 95d77416361f54eb558bbcb40b382cbb45149c27; added lifecycle composition recorded in 0f46baf7677d7bc4c84f084c66911cac04a6c474 and docs/gcsp/evidence/fucq100/lifecycle-runtime-result.json.

Known overlap: Reset in the title does not establish overlap with FUCQ-140 manual context. Unresolved: no confirmed matching Bug ID in the supplied lane record; dispatcher must deduplicate before intake.

Limit: Cases stop at the exact-array assertions (123, 166, 213); subsequent assertions are not passing evidence.

Source: `server/test/gcsp-buddy-runtime-integration.test.js:123`, `server/test/gcsp-buddy-runtime-integration.test.js:166`, `server/test/gcsp-buddy-runtime-integration.test.js:213`.

### C3 — Reviewed-key setup requests a successor after keys already exist

adoptPresenter calls adoptReviewedAssumptions for presenter-controls-v1 and unconditionally expects ok and runtime-reviewed-v2. Canonical seed already contains the reviewed assumption keys; the actual response is invalid-policy-change: All reviewed assumption keys already exist. No successor was created.

The observed refusal is consistent with already-adopted definitions. The test does not reach its pinned quote/access/publication assertions, so those obligations remain open in this case.

Origin: Fixture 95d77416361f54eb558bbcb40b382cbb45149c27; seed latest change 0f46baf7677d7bc4c84f084c66911cac04a6c474 (FUCQ-100 lifecycle composition).

Known overlap: Unresolved: no confirmed matching Bug ID in the supplied lane record; dispatcher must deduplicate before intake.

Limit: A valid fresh-version publication setup and the remainder of the case are unvalidated here.

Source: `server/test/gcsp-buddy-runtime-integration.test.js:81`, `server/gcsp/policy/seed-v1.json`.

### C4 — Greg fixture overwrites required bound manual records

helpers/greg-demand-run.js replaces employee.contract with manualContext containing only flattened employeeFacts. projectRecommendationFacts now requires manualContext.source, matching account identifiers, recordSetId and drivers, plus bound contracts where the slot has a contract. The helper deletes these fields. Greg readDemand correctly returns unavailable/source-invalid when briefs trigger projection.

Invalid helper input explains all three failures before dashboard values/privacy/shape assertions. This is evidence of a source-contract fixture mismatch; it neither demonstrates a live Greg outage nor supplies the missing aggregate/privacy acceptance proof.

Origin: Helper 9af62b8b23f55af326acc6848a331daf36c9a7db (FUCQ-101); bound-record projector and Greg change 38be4f5d95823b5f010a56c3d4b6cbda4eca55e8 in FUCQ-100.

Known overlap: Unresolved: no confirmed matching Bug ID in the supplied lane record; dispatcher must deduplicate before intake.

Limit: All downstream figures, canonical privacy bands and fixture-shape comparisons in these failed cases remain unverified.

Source: `server/test/helpers/greg-demand-run.js:42`, `server/gcsp/manual-context/recommendation-facts.js:36`, `server/gcsp/greg/index.js:79`.

### C5 — CSS scanner consumes an import as selector text

gcsp-greg.css starts with @import ./publish/publish.css. The selector scanner reports the remaining quoted import path plus the first .gcsp selector as one unscoped selector.

The failing text is an import statement fragment, not evidence of an actual unscoped CSS selector. Later token/side-stripe/reduced-motion assertions in this case are not reached.

Origin: Greg CSS adopted in FUCQ-100 composition 112fdfe275fc2019b830ac04976244513a56b642 from FUCQ-103 c5be593e3f023022f3e6da6e13253d086304d285; scanner fixture acee2bdd26ecadd2842003769c051a307f549499.

Known overlap: Unresolved: no confirmed matching Bug ID in the supplied lane record; dispatcher must deduplicate before intake.

Limit: No scanner repair, CSS parser execution or new rendered review was performed.

Source: `blocks/gcsp/greg/gcsp-greg.css:1`, `server/test/gcsp-greg-dashboard.test.js:377`.

### C6 — Price error-summary callback loses selection identity

Publishing panel emits validationErrors with selectionId=field.id and expects onSelect(id, selectionId) to select the matching price row. Central kit errorSummary calls onSelect(value.id) only. All price rows share the mounted native input, so fallback focus retains price:gallery-cost instead of selecting price:second.

An error-summary link for another invalid price row fails to reveal that row, impairing correction and keyboard navigation. Users can still choose a price row using the native selector. No invalid publish or data mutation is demonstrated; validation returns before preview/publish.

Origin: FUCQ-100 integration gap: panel and tests adopted in 112fdfe275fc2019b830ac04976244513a56b642 from FUCQ-103 c5be593e3f023022f3e6da6e13253d086304d285, whose shared helper passes both arguments. Central helper remains the one-argument version last changed at 2391224708cf28238cce07d6445c95a01bd5e2c9. Read-only Git diff confirms this exact omitted line.

Known overlap: Unresolved: no confirmed matching Bug ID in the supplied lane record; dispatcher must deduplicate before intake.

Limit: Two failures reproduce in the existing corrected run. No repair or rerun; rendered desktop/narrow/keyboard acceptance remains outstanding.

Source: `blocks/gcsp/kit/form-controls.js:34`, `blocks/gcsp/greg/publish/panel.js:30`, `blocks/gcsp/greg/publish/panel.js:139`.

### C7 — Resume loses focus when async review heading replaces initial heading

Real account Resume reaches the review, but document.activeElement is HTMLBodyElement rather than the final main h1. journey mount focuses the first available heading and disconnects its MutationObserver. Async review can replace that initial checking/loading heading; this is the source-supported cause hypothesis for the observed focus loss.

Keyboard and assistive-technology orientation is lost at the review transition. Review content becomes available and no data loss is established. Subsequent no-write/read/quote invariants are not reached, so this failure cannot prove them.

Origin: FUCQ-100 manual Resume change 6562e596ea8ff55352ee0a60b4c666d09303ff8a; journey.js lines 20-24 focus once before asynchronous replacement.

Known overlap: Distinct from FUCQ-141 clock-subscription seam and FUCQ-140 reset/switch context. Unresolved: no confirmed matching Bug ID in the supplied lane record; dispatcher must deduplicate before intake.

Limit: Failure reproduced in corrected full suite; precise async replacement cause is static inference, not independently instrumented. No repair or runtime remains authorised.

Source: `blocks/gcsp/manual-setup/journey.js:20`, `server/test/gcsp-manual-journey-resume.test.js:150`, `blocks/gcsp/manual-review/gcsp-manual-review.js`.

### C8 — Renewal alternative-car fixture seeds available instead of released

Fixture inserts stock state available, while alternative-car remedy requires released before recommendation evaluation. Actual response is invalid-case-command on remedy.orderUuid: This car is unavailable. Review current stock.

Fail-closed stock-state guard, not a demonstrated failed release or allocation corruption. Later eligibility/points/essentials/charging behavior in this case is not reached.

Origin: Existing FUCQ-122 area: test e8bebc6f5244526ba7cbaf1da8fae23bda5f594e and adopted cases source f179ae6043414a2b07de3edb2b425338299ea37b. Already recorded in lifecycle-runtime-result.md and lifecycle-composition-source-plan.json.

Known overlap: Known overlap with existing FUCQ-122 regression, not a new cause. Bug ID unresolved; dispatcher must reuse/deduplicate. FUCQ-142 local release-provider finding is separate from this explicitly seeded state mismatch.

Limit: No baseline rerun or downstream alternative-car acceptance proof. Preserve prior FUCQ-122 diagnosis.

Source: `server/test/gcsp-renewal-case.test.js:196`, `server/gcsp/cases/index.js:243`, `docs/gcsp/evidence/fucq100/lifecycle-runtime-result.md:7`.

### C9 — Employee-element location ratchet scans the offer entry wrapper

Test title requires the employee element not to read location, but its walk scans every GCSP .js except harness.js. It flags offer/entry.js, the deliberate standalone wrapper that captures the offer fragment and supplies location/history to its adapter. The flagged file is not the employee or offer custom element.

The exact match is expected route-wrapper responsibility in existing offer composition evidence. The failure does not demonstrate token exposure or a custom element reading the host URL.

Origin: Offer wrapper introduced in FUCQ-100 bc8a941adbf8bd74089b11b820c489551742ab12; existing employee contract scopes location isolation to the element, with a separate page harness.

Known overlap: Unresolved: no confirmed matching Bug ID in the supplied lane record; dispatcher must deduplicate before intake.

Limit: Ratchet scope/allowed wrapper boundaries still need explicit reconciliation; no global security waiver or new runtime proof.

Source: `server/test/gcsp-shell.test.js:729`, `blocks/gcsp/offer/entry.js:8`, `docs/gcsp/employee-entry-contract.md:39`, `docs/gcsp/evidence/fucq100/offer-runtime-result.md:7`.

### C10 — Future-offer fixture now coexists with a real direct offer page

sourceCopy now includes real gcsp-offer.html. Assembler explicitly prefers an existing direct offer page and falls back to nested preview.html. The test still expects the future-only preview route. The prior assertion confirms the nested preview was included in manifest.pages.

No missing package/page is demonstrated; route priority changed the expected demoPages entry. Later verifySite and missing-file assertions in this case were not reached.

Origin: Assembler/test db4fcbebd360006d81f3efd5fe1ac8d6f136dcea from merged base; real offer page adopted by FUCQ-100 offer composition bc8a941adbf8bd74089b11b820c489551742ab12.

Known overlap: Unresolved: no confirmed matching Bug ID in the supplied lane record; dispatcher must deduplicate before intake.

Limit: Reconcile fixture isolation or intended route priority; no assembler repair or packaging rerun in this lane.

Source: `server/test/launcher-package.test.js:48`, `scripts/assemble-site.mjs:163`.

## Coverage and cleanup

Six of the seven Resume/host/setup selections passed within the corrected full suite; the quoted Resume case reaches review and then fails focus. Its later read/POST/quote invariants were not reached. Other observed passes include both-direction manual/buddy exclusivity, actual capture/token timing and exact expiry, authentic remote pending intent, real cookie Greg navigation, shared runtime/registry memoization and TEST stock pull. These do not turn the suite into a pass.

Five native PostgreSQL cases explicitly skipped because `GCSP_DATABASE_URL` was unset: native parity; rows/dates/seed/reopen; publication rollback; second occupying hold/claim constraints; shared TransactionRepository contract. No credential file was read and no native/live run was made. Desktop/narrow/keyboard rendered acceptance and the native/Render gate remain open.

For both install and corrected test, saved finalizer/collection evidence records joined handles, absent observed processes/groups/launcher and open files, exact owned scratch removal, absent exact reservation token and a locked raw ledger with zero rows. Read-only lane collection did not mutate cleanup state; dispatcher independent collection remains separate. The retained `server/node_modules` environment was not removed. Ordinary process-group polling does not individually instrument every transient synchronous native child or every millisecond RSS peak.

## Retained record identities

| Record | SHA-256 |
|---|---|
| Corrected test receipt | `00c330a36dbcc2f7fc7ff141f578499d25695cd0c1d5c6f238e7e7dd82f6f357` |
| Corrected test originalOutput | `4678439e6f05dae94b7bbc5b0b6f78f4cf2bff85b4d70f2b45c6abd4cdd37b44` |
| Corrected test ownership | `1ba27065ac91966c48cdeb2b39f63d0ed3499998920d71a89d10389d2caceab5` |
| Corrected test laneCollection | `b0b422f95bc9a395fc0e9bd5ae836b2449a55f8c570d6f039491159eae870cbc` |
| Environment install receipt | `027efd745fed352ce9d2d6bbc39b6211237558253eef7c95712339fdb5f02e17` |
| Environment install originalOutput | `095973687ab56722bc70858321dac01737b5b9d9d32a255b3f4aa7af9b138c74` |
| Environment install ownership | `034d3af3b0c2ef6bdd6d6ffc1f9fda211f3b4039efd5f599e28cadebf61a7c0f` |
| Environment install laneCollection | `87b722d28cbc5935145fb0dc1da9ba71c9763b11ea9508d603649ceb3ce00718` |

Corrected run: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq100/required-npm-corrected-9f5484c6a611421eb8ce109685b9ea1a`. Install run: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq100/required-ci-421f4c4dcf4a476482c942c72281f976`. Each contains the immutable receipt, original `raw.log`, ownership manifest and separate `lane-collection.json`; full absolute paths, dependency inventories, helper hashes and execution identities are in the JSON record. Original first-attempt receipt/output/ownership/collection hashes were rechecked unchanged while writing this report.

Corrected scratch `/private/tmp/test-stamp-shard-45cd11acb42644e7b03c4ef9df8296f5` and token `45cd11acb42644e7b03c4ef9df8296f5` were removed by the existing finalizer. Adapter SHA-256: `19ffc2d6d50892c24fe847679fa27f2407ee57b0b854e6e5886afd1f28a3052d`; amendment SHA-256: `4ed7c28abf547d7da3bd4e8db3d633031386aebb1788f54a4731a217801760d7`. No tracked framework changes.

The dispatcher owns backlog Bug deduplication/linking and the merge decision. Existing FUCQ-140–143 deferrals remain; this report neither fixes nor reassesses them. FUCQ-122 renewal-state mismatch is an existing finding. No Jira writes, new agents, product repairs, acceptance/map updates or further test runs were made during classification. Runtime grants are consumed.
