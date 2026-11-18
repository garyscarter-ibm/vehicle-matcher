# FUCQ-381 delivery reconciliation — 18 November 2026

This increment reconciles the original allowance-aware recommendation repair and current proof. Product source is already implemented by `94a9eaf0cf715d096544a3b41d2d9870ec4200c3`; no duplicate source, policy, UI or migration change is proposed. The four original Bug criteria and FUCQ-29 recommendation contract remain fixed.

## Current diagnosis and proof plan

The ranking helper is identical to the original repair: after suitability gates, create fit bands anchored to each best remaining preference score, then sort monthly points descending inside each five-point band, fit and stable UUID. The canonical policy remains `similarFitThenPoints` / `fitTolerance: 5`. Saved recommendations, unsaved previews and feedback share the helper. Preference percentages remain unchanged; the points-aware badge remains `Recommended` with an allowance explanation. Older policy pins preserve their former score/UUID ordering; allocation fairness and retail scoring are separate.

| Original acceptance | Existing current test proof selected |
| --- | --- |
| Eligible equally matched cars using more allowance rank higher | `employee-recommendation-order`: fuller-use band, tie ordering, provider-order independence; `employee-recommendation`: actual PolicyService/service equal-fit 1200-before-800 case. |
| Mismatch, essentials, unknown eligibility and excessive points cannot buy recommendation | Ordering test excludes failed/unknown gates and prevents chained near ties; actual recommendation cases exercise matrix/allowance gates, exact essentials, eligibility/points unknowns and central-policy revisions. |
| Recomputed previews and feedback share ranking | Equal-fit service case also calls actual `previewUnsaved`; `feedback-actions` recomputes after exclusions and checks descending points; HTTP/stored-subject/brief transport modules cover the bound service consumers. |
| Scores/badges truthful and retail unchanged | Ordering checks source non-mutation and scored/null separation; points-aware brief render case checks `Recommended`, allowance explanation and no highest-fit/percentage claim; plain-copy and frozen/reference retail compatibility cover affected presentation/shared-engine boundaries. |

Selected existing files are the ten named in `reconciliation-inputs-2026-11-18.md`. The automatic selector has no configured Node mapping; explicit modules follow affected ownership, fixture/subprocess and HTTP/retail boundaries. Actual assertions and their fixture limits are retained: PolicyService/provider/time service fixtures and real local HTTP/memory repository/identity composition prove the original read-only contract; fixture render tests are not fresh visual critique or live-provider proof.

The parent's required serial covering batch is `batch-next-20261118T023236Z`, pinned to `26d73b760ba26cd99610ff738c95c0c1355cc7f3` (tree `99e62499107d8f0f23591455b7b2961b0b638245`): `npm test`, then Java `./mvnw -B clean verify` with fresh native PostgreSQL 17. At the historical pre-refresh check, all 48 compact source pins and all 2,551 retained batch source/input hashes matched the claimed F381 tree. The publication refresh comparison below supersedes that whole-tree identity claim: all 48 compact F381 pins still match, while eight later base inputs changed. Completed cases below remain scoped evidence for the matched boundary. No competing runtime or independent rerun is started.

## Final Node evidence — 03:18:46 UTC observation

The canonical Node phase **completed normally with exit 1**: **5,430 tests, 5,148 passed, 120 failed, 162 skipped, zero cancelled and zero todo**, duration 2,523,076.609583 ms. Its log is complete and its owned Node process count is zero. The 128 records in `failures.json` are diagnostic records, not the final failed-test count. Java21 clean verify was running at this observation; no final Java result, green covering batch or parent cleanup is claimed.

The ten F381 modules account for **305 completed cases: 302 passed, three failed, zero unobserved**. Each complete source-expanded ordered title signature matches one unique ordered block among completed reporter events under `--test-concurrency=1`. Counts are case observations, not successful module exits, measured coverage or a green command.

| Selected module | Passed | Failed | Completed cases | Ledger sequences |
| --- | ---: | ---: | ---: | --- |
| `employee-recommendation-order` | 5 | 0 | 5 | 388–392 |
| `employee-recommendation` | 29 | 0 | 29 | 393–421 |
| `feedback-actions` | 18 | 0 | 18 | 475–492 |
| `gcsp-brief-render` | 24 | 1 | 25 | 1094–1118 |
| `employee-recommendation-api` | 8 | 2 | 10 | 362–371 |
| `gcsp-brief-transport` | 6 | 0 | 6 | 1124–1129 |
| `gcsp-plain-copy` | 8 | 0 | 8 | 3726–3733 |
| `gcsp-recommendation-stored-subject` | 14 | 0 | 14 | 4057–4070 |
| `gcsp-policy-service` | 21 | 0 | 21 | 3772–3792 |
| `recommendation-compat` | 169 | 0 | 169 | 4852–5020 |

The 305 cases consist of 141 literal top-level cases, eight generated top-level cases and 156 nested cases. Stored-subject expands three provider mismatch cases (`runId`, `environmentId`, `employeeId`) after its fourth literal case. Retail expands five perturbation cases and two passes over 67 server plus 11 client fixture keys: 156 nested checks plus 13 completed top-level cases. Its opening parent marker at sequence 4851 is not counted as a pass; the completed parent is sequence 5008, the actual `TASTE_SHARE=0.3` child passes at 5019, and registry tuning completes at 5020. Retail proof covers repeated frozen captures with fixture identity preserved, engine/reference/used-retail parity, deliberate perturbations and the actual changed blend/digest comparison without fetches.

The lapsed-access-key title occurs in six files. The unique ordered activity-transport block is 768–772 and contains sequence 770, which is excluded. The distinct six-title brief-transport block is 1124–1129 and contains 1127, counted once. Sampled `candidateWorkerFiles` labels lag across file boundaries and are not attribution evidence. All ten fully expanded module signatures matched uniquely.

The original fuller-allowance ordering case passed at 388; hard/unknown gates and anchored-band cases passed at 389–392. Sequence 400 passed actual saved recommendation and unsaved preview calls with equal-fit 1200 points before 800. Sequence 485 passed feedback recomputation after exclusions. Sequence 1105 passed the truthful points-aware badge. All 169 retail compatibility cases passed. These are scoped positive observations; the selected boundary remains red.

Final failure stacks confirm the following limits:

- Sequence 362, `employee-recommendation-api.test.js:23`, fails at assertion line 33: Greg returns 200, expected 403 (`ERR_ASSERTION`). The current canonical seed explicitly grants Greg roles `greg` and `employee` (seed lines 11505–11515; the basis at 11528 records the 11 November dual-role authorisation). The fixture uses the canonical identity adapter and the route requires `employee`. This is source/stack evidence of a stale role expectation. The failure occurs before later presenter/origin assertions, which are not claimed as executed.
- Sequence 370, the same module's test at line 271, fails at assertion line 281 with the same Greg 200/403 mismatch. The preceding employee-200 and `customCalls=0` assertions passed; the following custom-call assertion was not reached.
- Sequence 1112, `gcsp-brief-render.test.js:231`, fails at line 233 with `TypeError: Cannot read properties of undefined (reading 'label')`: `PORTAL_NAVIGATION.find(item => item.key === 'brief')` returns no item. This FUCQ-326 editor/rail terminology test fails before later editor/body assertions. The F381 truthful badge case at 1105 passed separately.

No source, fixture, identity role or navigation wording is repaired under this reconciliation. The parent owns separate Bug intake/disposition and the full batch. **All four original acceptance items remain unchecked** until matching complete proof and green covering-batch coverage. There was no Result block at this observation; the later documentation-only `partial` Result records publication of the evidence without an acceptance or Done claim.

The small final scoped receipt is retained at `.claude/poller/run-20261117-2335/f381-final-node-reconciliation.json` (15,619 bytes, SHA256 `94f20f4c147b1dfd8f5ada7d7edb9782b000ec6744e0dd1a9d26a912e569aec4`). `reconciliation-inputs-2026-11-18.md` embeds the selected signatures/results, final failure details and artifact identities. Under the same run's `resources/` directory:

| Artifact suffix after `batch-next-20261118T023236Z-` | Bytes | SHA256 |
| --- | ---: | --- |
| `inputs.json` | 348026 | `10df3d1d7594d8d62416b36d7c5451fcc573fc828cee7c0c9bf2149e1a0b32e7` |
| `node.log` | 844523 | `080147f60490b3fd82dac8e805be4db36689b12f8e5fd0558a4cdae3e57ff358` |
| `node-cases.jsonl` | 1550205 | `034a0fc30b18ffe797122879eed10590f1573971ff3f4141197d0563411bdbe3` |
| `failures.json` | 51923 | `24e9d9f578d3f8dec087317c5bd0244e0524eb868532d3b1e4dc9d267c66dd08` |

## Historical checkpoints

Earlier live observations remain historical: 02:44 UTC observed 90 passed / three failed / 48 literal titles unobserved (ledger limit 1212); 03:06:36 observed 119 / three / 19 (limit 4024); 03:09:23 observed 133 / three / eight literal titles pending (limit 4265), with 169 source-expanded retail cases still expected. The final 305-case expansion resolves those pending cases; the literal checkpoint counts are not directly interchangeable with generated/nested final totals. Their records are retained in the JSON and local impact metadata.

## Historical evidence and limits

The 11 November 297-pass receipt and eight state/width browser checks remain historical. Eight of its ten whole-file input pins changed later, although the ranking helper, policy ranking values and badge selection/constant remain identical. The old result is not current execution evidence. The original red regressions and explicit independent visual-review waiver are retained in `README.md`; this docs-only reconciliation neither reopens that waiver nor claims fresh UI critique. Archived images in restricted storage were not accessed, checked or followed.

Existing persisted runs require an explicitly published successor policy or collaborator-authorised reset after deployment; no publication/reset is performed here. Existing offers/historical terms, points/allowance amounts and allocation fairness remain unchanged. No Java/Angular migration, hosted deployment or BMW integration gate is added to this Bug.

Data strategy: **default, retain the existing canonical FUCQ-29 recommendation/PolicyService contract** in `docs/gcsp/employee-recommendation.md`. Reviewed against canonical scaffolding `plugin/skills/design-with-drawio/data-design.md`: authority is exact vehicle/context identity and versioned policy/terms; the existing operation gates and scores the full supplied candidate set before ranking and display cap. This reconciliation changes no access path, query, persistent representation or operation count. Applicable evidence is the existing bounded synthetic/service/HTTP/ranking cases and matching current input identity; no SQL plan or new persistence workload is introduced.

No measured per-test V8 coverage contexts are claimed. Static ownership/import/fixture mapping describes boundaries, not measured coverage; unobserved paths remain unknown. Full suite belongs to the parent's covering batch, with no acceptance before green batch coverage. Native Jira access is unavailable; no native lifecycle is inferred.

Resources: no new test/build/browser runtime, scratch, dependency link, archive, database or child. Only small durable Markdown evidence and the claimed Bug note are edited. No OneDrive or foreground access. Parent owns the canonical batch allocations/finalizer/cleanup; its final independently hashed cleanup receipt is attributed below. This reconciliation performed no parent cleanup.

## Publication reconciliation — 05:20:15 UTC

Normal parent refresh produced `00a0de8bada56b8ae3c77c3fd54d2bf1d39ae949` over shared base `e45e4cac7`. The branch's only allocated difference is this note, `reconciliation-inputs-2026-11-18.md` and `_dev/in-progress/DEV-2026-11-16-049.md`. The original repair is already in the shared base. No source package, HTTP contract, policy value, UI, database or test harness is changed by this increment; Gary's FUCQ-441 source ownership is preserved.

A fresh read-only hash comparison still matches **48/48 compact F381 inputs**. The older 2,551-input batch manifest now matches **2,543/2,551**, rather than the complete refreshed tree. The eight later differences are five Angular stock component/store/template/spec files, `scripts/build-gcsp-static.mjs`, `scripts/gcsp/fucq443-connected-manual-proof.mjs` and `server/test/gcsp-static-angular.test.js`; exact paths and old/new hashes are in the input note. These are outside the selected ten Node modules and documented recommendation/service/feedback/policy/legacy-brief/retail input boundary. Direct imports and the selected fixture/subprocess boundaries were reviewed. This supports scoped reuse of the existing 305 case observations; it does not extend the original canonical batch to later changes or establish full refreshed-tree equivalence.

The canonical batch at `26d73b760` is final **RED**: Node 5,430 tests / 5,148 passed / 120 failed / 162 skipped, and Java 2,073 tests / 2,053 passed / 12 failed / five errors / three skipped, both normal exit 1. The separate final Java diagnostic composite is 43 exact cases across eight classes: 32 passed / ten failed / zero errors / one skipped. It reuses manual-stock five, isolated single-class 22 and corrected same-JVM phase-pair 16; the original zero-test orderer refusal remains excluded. These variants do not create canonical green or satisfy F381's original acceptance. The shared batch evidence is `docs/gcsp/evidence/batch-2026-11-18-0232.md`; final diagnostic JSON SHA256 is `74b5f6e6088639c7a2adefff6f207fd30c95ea13f35d9515ebe421b621b1243f` (62,581 bytes).

Parent's separate normal-drop receipt at 05:14:51 UTC verifies the canonical batch worktree, registration and local branch absent, with 608,141,312 file-allocated bytes removed and no force, foreign-resource or OneDrive cleanup. The 456-byte local receipt is `.claude/poller/run-20261117-2335/resources/batch-canonical-worktree-cleanup-final.json`, SHA256 `d2935c9b7415d5ddc23b64e3a3a84e7b8b9dc0cafff9a8ff1fb2347d8d1f6825`. The F381 claimed worktree/branch and existing claim are retained for the dispatcher's normal lifecycle; this note neither closes nor drops them.

The dev-inbox procedure B11 permits a truthful `partial` Result when original criteria are unmet. This documentation-only evidence increment can be published as `partial`: all four original AC remain unchecked, the three selected failures remain red, fixture/HTTP limitations remain explicit and no acceptance status is inferred. The publication touches no package named by the red batch. D2 coverage is reassessed as the 48 matching F381 inputs plus the eight explicitly excluded later inputs; the checks selected for this increment are retained-receipt/hash reconciliation, exact three-path diff review and `git diff --check`. No unchanged test is rerun for documentation publication. Parent retains merge/lifecycle authority and separate failing-boundary Bug disposition.

Remaining F381 work is the original contract's proof and rollout: demonstrate the four authored outcomes on the applicable deployed Node composition with its canonical active policy (including a successor publication or authorised reset for an existing persisted run), finish any missing connected assertions, and obtain green covering-batch evidence before acceptance. The passing original ranking/preview/feedback/badge/169-retail observations remain useful but do not waive those requirements. No whole Java/Angular migration, unrelated source fix, new intake or hosted campaign is added to F381. Historical browser/waiver evidence remains historical, with no fresh UI critique claim.
