# FUCQ-481 provider shape variation source increment

Authored on 17 November 2026 against source checkpoint `5ce78b9bef513c14adcf1cd05a0d03d43849bf16`.
The three authored PostgreSQL cases passed on 17 November 2026 for the differently shaped employee/stock input part of original AC2.
Neither original acceptance criterion nor FUCQ-481 is complete.

The only product additions are `ProviderShapeVariationPgTest.java`, `ProviderShapeVariationSupport.java` under
`services/gcsp-api/src/test/java/gcsp/api/recommendation/`, and this note. Existing account production and fixture
files remain read-only. The F458 reservation and F477 Supply/Clock M1/F515 hold are unchanged; Bugs 513–515
remain capture-only. No Jira, shared map, claim, deployment or production change belongs to this increment.

## Authored component path

`HrSnapshotRecords.open(path)` reads the deliberately different `gcsp-hr-export/1` shape. It is the public
factory used by `AccountSelection.records`, but this test calls the factory directly. The latter method and
`HrExportFixture` are package-private in `gcsp.api.account`; neither is imported or exposed by this increment.
The HR composition is **provider component proof**, not an `AccountSelection` or CDI
startup-selection proof. No application is booted by the authored class.

`SupplySelection.select("tranche-plan", planPath, policyPath)` is called through its public API. The selected
provider and selected file policy feed the real `StockRelease`, writing exact released rows in a private native
PostgreSQL schema. `ReleasedStock.page` reads those rows into `ReleasedStockRecommendationSource` with the
existing `StockFactsEvidence`, `AccountService` and `RecommendationService`. This is static supply-selector
and provider composition, not evidence that Quarkus startup injection chose these instances.

The helper reuses same-package `RecommendationDb.resource/golden` and `SourceFixture.policy/accounts/clock`.
It does not import package-private `SupplyFixture` or duplicate recommendation calculations. One Paula golden
is reshaped to the existing HR schema. Its equal current-contract/history rows are asserted before using the
narrow mapping; this is not a general HR fixture converter. Two existing visible 320i source rows become the
stock of the existing retained tranche-plan envelope. These are synthetic contract fixtures, not BMW stock or
constructibility evidence.

All allowance, eligibility, pricing and calibration reads use the existing `PolicyService` over
`RetainedFilePolicySource`. The supply-policy file is a projection of the three successful, same-version
`PolicyService.getAssumption` rows: `supply.release.size`, `supply.leadTimeDays`, and
`supply.stockSource.maxAgeMinutes`. No numeric release, allowance or points default is copied into the test.
The existing fixed fixture clock is used consistently; no clock binding or held production path is changed.

## Exact authored methods and intended observations

| Method | Controlled input | Assertions against actual computed output, all three methods passed |
| --- | --- | --- |
| `sameBriefChangesComputedEligibilityWhenHrDriverEligibilityChanges` | Two HR exports differ only at the first licence holder's `eligible.value`, true to false; its provenance is retained. The brief, policy and released rows are identical. | Two eligible/recommended candidates become zero. Both decisions become `ineligible` with `driver-ineligible`; `employeeFacts.driverEligible` equals the supplied fact. Decision identities and version metadata remain equal, so a digest difference alone cannot satisfy the test. |
| `sameBriefChangesComputedRecommendationsWhenTrancheStockFactsChange` | One tranche-plan stock fact value changes from the existing 320i model key to the existing M340i model key. The HR export, brief and other plan fields remain identical. Each variant has its own sequentially opened/dropped schema. | Eligible count changes from two to one. The changed exact order becomes `ineligible` with `policy-exclude`; the other remains eligible and is the sole recommended order. Both exact order identities remain in decisions and policy/employee-fact versions remain equal. |
| `unreadableHrExportDoesNotReuseEarlierComputedCandidates` | After opening the HR provider and obtaining recommendations, the same runtime export file is made unreadable JSON. | The source returns `unavailable`; the same composed recommendation service returns retryable `employee-source-unavailable` without a prior candidate value. |

The first two methods restore the edited field in a copy and assert equality with the original input. This
checks that each comparison has one deliberate input difference. They also assert the same brief reaches
computed decisions. No employee-specific answer is inserted into a service or result.

Source trace for the selected assertions: `ReleasedStockRecommendationSource.resolve` copies the selected
driver's whole eligibility fact to `employeeFacts.driverEligible`. `Evaluation.decide` checks that fact under
canonical `driverEligibilityRequired`, producing `driver-ineligible` for confirmed false. The retained FS/UK
G7 rules include `G21 Touring|320i` and exclude `G21 Touring|M340i`; both have retained price entries. Driver
facts retain the existing `synthetic-scenario` assurance and provenance required by the recommendation gates.

The **least-certain assertion before runtime** is that the whole HR/account/release fixture composition yields
exactly two eligible baseline candidates. The selected native run established that combined baseline and all subsequent assertions.

## Validation evidence

The source lead returned an uncompiled, unrun increment and performed bounded source checks only. The parent
then froze source commit `7128e26428fc3797f2bcab8847b80a69df55e659` (tree
`dd5d2f9b43b40b4892886a25bceea5b258ecf049`) and ran exactly the three methods above in
`ProviderShapeVariationPgTest`, using offline Java 21/Maven and one disposable loopback PostgreSQL 16 instance.
All three passed: zero failures, errors or skips, native exit 0. The run took 24.3 seconds, with measured peak
aggregate RSS 750,649,344 bytes and scratch 124,361,376 bytes, within the granted 2 GiB inclusive budget.
Existing dependency/tool/source pins matched before and after. Historical 65-case and 10-case runs were reused
at their existing boundaries and were not rerun.

After joining the producer, the parent independently observed all 74 recorded process identities and all seven
owned process groups absent, owned scratch absent and the host reservation registry empty at 06:31:35 UTC.
The bounded native receipt and independent audit are retained in local dispatcher coordination; no raw runtime
output belongs in this document. No OneDrive location was accessed.

Imhotep 2 independently reviewed the exact three additions at the frozen commit: PASS, no blocking or major
finding. Requested and selected model/effort: `gpt-6.1-sol` / `high`, no fallback or descendants. The reviewer
performed source review only. The two Java files retain their tested/reviewed hashes; this later note records
actual validation without implying another runtime or a broader acceptance result.

The helper fails rather than skips when `GCSP_TEST_DATABASE_URL` is absent. It creates a unique private
`gcsp_shape_<uuid>` schema and drops it on close, including setup failure. All temporary files were beneath the
parent's owned local scratch. No application startup, browser, deployed environment, OIDC or email check ran.

This test/doc-only increment changes no rendered surface or production behavior. The experience contract,
`docs/gcsp/screens/README.md` and `COMPONENTS.md` therefore require no new screenshots here. No browser check
was performed or credited.

## Remaining original acceptance

AC1 still needs complete startup composition, the remaining bindings/bypasses and demo-preparation proof.
The direct HR factory and static supply selector above do not establish those lifecycle requirements.
AC2 still needs connected claim → signed-in decision →
order/status through the remote substitute, real test OIDC/email and the required deployed integration evidence.
BMW identity, HR, stock, service authentication, endpoint/custody/status capabilities and access remain gaps
under the existing inventory and replacement contracts. No live BMW capability is claimed.

For shared dispatcher learnings: the predecessor proposal's inaccessible helper assumption was corrected in
the allocation and avoided in these sources. Explicitly labelling direct factories separately from injected
startup composition applies the existing boundary-evidence learning; the three selected runtime cases now verify the component assertions. This does not resolve startup or
connected-journey evidence gaps. No new product defect is diagnosed or repaired.
