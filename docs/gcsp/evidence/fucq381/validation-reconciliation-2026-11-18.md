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

The parent's required serial covering batch `batch-next-20261118T023236Z` is running on `26d73b760ba26cd99610ff738c95c0c1355cc7f3`: `npm test`, then Java `./mvnw -B clean verify` with fresh native PostgreSQL 17. All 2,551 retained batch source/input hashes match the claimed F381 tree. Manifest equality establishes the input boundary; executed cases below provide partial current proof. No competing test/application runtime is started. If the batch does not reach required cases, coordinate only the missing scoped commands after the parent's lane handoff.

## Executed checkpoint — 02:44 UTC

The live `batch-next-20261118T023236Z-node-cases.jsonl` ledger reports the following selected literal test titles. These are case observations, not successful module exit counts or a green full command. The batch is incomplete; no final receipt or Java result exists at this checkpoint.

| Selected module | Observed passed | Observed failed | Titles not yet observed | Ledger sequences |
| --- | ---: | ---: | ---: | --- |
| `employee-recommendation-order` | 5 | 0 | 0 | 388–392 |
| `employee-recommendation` | 29 | 0 | 0 | 393–421 |
| `feedback-actions` | 18 | 0 | 0 | 475–492 |
| `gcsp-brief-render` | 24 | 1 | 0 | 1094–1118 |
| `employee-recommendation-api` | 8 | 2 | 0 | 362–371 |
| `gcsp-brief-transport` | 6 | 0 | 0 | 1124–1129 |
| `gcsp-plain-copy` | 0 | 0 | 8 | Pending |
| `gcsp-recommendation-stored-subject` | 0 | 0 | 11 | Pending |
| `gcsp-policy-service` | 0 | 0 | 21 | Pending |
| `recommendation-compat` | 0 | 0 | 8 | Pending |

The original fuller-allowance ordering case passed at sequence 388; hard/unknown gate and anchored-band cases passed at 389–392. Sequence 400 passed actual saved recommendation and unsaved preview calls with 1200 points before 800 for equal fit. Sequence 485 passed feedback recomputation after exclusions. Sequence 1105 passed the points-aware badge case without asserting the highest preference score. These observed passes do not substitute for pending retail/shared-boundary proof or green covering batch coverage.

Selected failures remain visible: HTTP guard cases at 362 and 370, and the `FUCQ-326` editor/rail terminology case at 1112. The HTTP source expects Greg to receive 403, while the current canonical seed grants Greg both `greg` and `employee`; the fixture seeds that real identity adapter and the route requires `employee`. This is a source-backed stale role-expectation hypothesis; final expected/actual stacks are not yet emitted, so the exact failure cause remains unconfirmed. No source, fixture, identity role or unrelated wording is changed under F381. The parent owns separate Bug triage and the full batch outcome. All four acceptance items remain open.

## Historical evidence and limits

The 11 November 297-pass receipt and eight state/width browser checks remain historical. Eight of its ten whole-file input pins changed later, although the ranking helper, policy ranking values and badge selection/constant remain identical. The old result is not current execution evidence. The original red regressions and explicit independent visual-review waiver are retained in `README.md`; this docs-only reconciliation neither reopens that waiver nor claims fresh UI critique. Archived images in restricted storage were not accessed, checked or followed.

Existing persisted runs require an explicitly published successor policy or collaborator-authorised reset after deployment; no publication/reset is performed here. Existing offers/historical terms, points/allowance amounts and allocation fairness remain unchanged. No Java/Angular migration, hosted deployment or BMW integration gate is added to this Bug.

Data strategy: **default, retain the existing canonical FUCQ-29 recommendation/PolicyService contract** in `docs/gcsp/employee-recommendation.md`. Reviewed against canonical scaffolding `plugin/skills/design-with-drawio/data-design.md`: authority is exact vehicle/context identity and versioned policy/terms; the existing operation gates and scores the full supplied candidate set before ranking and display cap. This reconciliation changes no access path, query, persistent representation or operation count. Applicable evidence is the existing bounded synthetic/service/HTTP/ranking cases and matching current input identity; no SQL plan or new persistence workload is introduced.

No measured per-test V8 coverage contexts are claimed. Static ownership/import/fixture mapping describes boundaries, not measured coverage; unobserved paths remain unknown. Full suite belongs to the parent's covering batch, with no acceptance before green batch coverage. Native Jira access is unavailable; no native lifecycle is inferred.

Resources: no new test/build/browser runtime, scratch, dependency link, archive, database or child. Only small durable Markdown evidence and the claimed Bug note are edited. No OneDrive or foreground access. Parent owns the running batch's allocations/finalizer/cleanup and exclusive runtime lane; this checkpoint makes no resource-cleanup claim for that run.
