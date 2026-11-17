# FUCQ-481 provider shape variation source increment

Authored on 17 November 2026 against source checkpoint `5ce78b9bef513c14adcf1cd05a0d03d43849bf16`.
This is an **uncompiled, unrun test increment** for the differently shaped employee/stock input part of original AC2.
Neither original acceptance criterion nor FUCQ-481 is complete.

The only product additions are `ProviderShapeVariationPgTest.java`, `ProviderShapeVariationSupport.java` under
`services/gcsp-api/src/test/java/gcsp/api/recommendation/`, and this note. Existing account production and fixture
files remain read-only. The F458 reservation and F477 Supply/Clock M1/F515 hold are unchanged; Bugs 513–515
remain capture-only. No Jira, shared map, claim, deployment or production change belongs to this increment.

## Authored component path

`HrSnapshotRecords.open(path)` reads the deliberately different `gcsp-hr-export/1` shape. It is the public
factory used by `AccountSelection.records`, but this test calls the factory directly. The latter method and
`HrExportFixture` are package-private in `gcsp.api.account`; neither is imported or exposed by this increment.
The HR composition is **provider component proof**, pending execution, not an `AccountSelection` or CDI
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

| Method | Controlled input | Assertions against actual computed output, unrun |
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
exactly two eligible baseline candidates. Individual source paths and retained facts support it, but Java
compilation and native execution have not established that combined baseline or the later assertions.

## Validation handover

No JVM, Maven, test, database, service, browser, network fetch, install, reservation or scratch allocation was
run for this assignment. Bounded Python standard-library/source checks inspected resource paths, public API
access, retained policy rows and authored method names. Those checks are not compilation or a test pass.

The selected future native boundary is the exact class `gcsp.api.recommendation.ProviderShapeVariationPgTest`
under the parent's offline Java 21/Maven supervisor. Run only that class initially. `GCSP_TEST_DATABASE_URL`
must identify the parent's disposable PostgreSQL instance; absence throws rather than skips. The helper
creates a unique `gcsp_shape_<uuid>` schema, migrates it, seeds only environment/run identity, and drops it in
`close()`, including the setup failure path. JDBC connections/statements are try-with-resources, connection
and socket timeouts are finite, and JUnit `@TempDir` files must live beneath the parent's owned runtime temp.
No parent-owned database is created or started by this source increment.

The existing source-only resource grant allocates no scratch. Any later native execution needs the parent's
current capacity/budget, ownership manifest, reservation, bounded single JVM and finalizer. Its stated ceiling
is 2 GiB owned local scratch and ten minutes per chunk, with skip-as-fail accounting and verified teardown.
Do not rerun the already retained 65-case or 10-case component runs for this addition. Retain actual failures,
skips and unrun checks; do not convert the three authored methods into pass counts.

This test/doc-only increment changes no rendered surface or production behavior. The experience contract,
`docs/gcsp/screens/README.md` and `COMPONENTS.md` therefore require no new screenshots here. No browser check
was performed or credited.

## Remaining original acceptance

AC1 still needs complete startup composition, the remaining bindings/bypasses and demo-preparation proof.
The direct HR factory and static supply selector above do not establish those lifecycle requirements.
AC2 still needs native execution of this shape-variation increment, connected claim → signed-in decision →
order/status through the remote substitute, real test OIDC/email and the required deployed integration evidence.
BMW identity, HR, stock, service authentication, endpoint/custody/status capabilities and access remain gaps
under the existing inventory and replacement contracts. No live BMW capability is claimed.

For shared dispatcher learnings: the predecessor proposal's inaccessible helper assumption was corrected in
the allocation and avoided in these sources. Explicitly labelling direct factories separately from injected
startup composition applies the existing boundary-evidence learning; this is an authored mitigation awaiting
native validation, not a verified runtime resolution. No new product defect is diagnosed or repaired.
