# FUCQ-481 selected account records for allocation candidates: 17 November 2026

This note covers one adapter. When startup selects recommendation candidates, it now reads each employee's account facts from the selected `AccountRecordsPort`. It no longer uses the record the caller passes in. It was authored from `7f13b0362` (API tree `55023060`). **Nothing has been compiled or run.** It changes no screen.

## Composition

- **Selector.** `CandidatesSelection` (`gcsp.allocation.candidates.provider`) now injects the selected `AccountRecordsPort` from `AccountSelection`.
  - `recommendation` builds `new SelectedAccountCandidates(new RecommendationCandidates(policy), records)`.
  - `none`, unset or blank still gives the refusing `UnconfiguredCandidates`.
  - An unknown value still stops startup.
  - No other construction path remains.
- **Adapter.** `SelectedAccountCandidates` implements `EligibleCandidates` and delegates to the unchanged `RecommendationCandidates`.
  - It builds an `AccountScope` from the request's environment, run and policy version, and from the subject's employee, slot and company, scheme and grade attributes.
  - It calls `readEmployeeContract` and then `readDrivers`. It never reads employment.
- **Composed record.** `recordSetId`, `source`, `account`, `contracts` and `histories` come from the contract read; `drivers` and `employeeFacts` come from the driver read.
  - These are exactly the keys a stored `employee_account_records` row holds (`scenario/demo-preparation-v1.json`).
  - So under `repository` the record rebuilds the stored row, and the calculation's `factsVersion` digest is unchanged.
  - Every other subject field, and the request's policy, time, clock and cars, pass through untouched.
- **Refusals.** It never falls back to the caller's `accountRecord`.
  - `account-records-unavailable`: a read that is not `ok`, a null result, or a thrown error. This covers `none`, which answers `account-provider-not-configured`.
  - `account-records-inconsistent`: either read is out of scope (run, environment or employee); the `recordSetId`s differ or are missing; both reads carry a `repositoryVersion` and the two differ; or `drivers` or `employeeFacts` is missing.
- **Consistency basis.** These are the same checks `AccountService.prepare` (`AccountService.java:98-114`, `driversInvalid` at `:254-262`) and `ReleasedStockRecommendationSource.resolve` (`:55-62`) apply to the same two reads.
  - Like them, it does not claim the reads are one transaction. The `repositoryVersion` and `recordSetId` match is the guard the published contract offers.
- **Not repeated.** The account-screen validation (`accountMismatch`, contract and slot checks, `effectiveFrom`) stays where it is. The calculation already refuses records without `employeeFacts`, and it rejects ambiguous or wrong-slot contracts.

`Prepare.java`, `BuddyRemoteLifecycle.java`, `RecommendationCandidates.java`, the account package and every core file are unchanged. Their direct SQL reads still happen. With `recommendation` selected, the record they pass is now ignored, and the selected provider's facts are used instead.

## Tests (unrun)

- `SelectedAccountCandidatesTest` (plain JUnit, no Quarkus or database) has four methods:
  1. Selected fixture records reproduce the canonical result, and both reads receive the trusted scope.
  2. Selected driver facts win over a conflicting or null caller record, in both directions.
  3. An unavailable, not-found or throwing source refuses despite a complete caller record.
  4. Cross-scope, `recordSetId` or `repositoryVersion` mismatches, and missing facts, are inconsistent.
- `CandidatesSelectionTest` (the existing `@QuarkusTest` with recommendation selected) has four methods:
  1. The injected bean now refuses, because the profile leaves account at `none`.
  2. `select` over fixture records still computes the canonical decisions.
  3. The none default and the unknown-value startup failure are kept.

Proposed selectors: `-Dtest=SelectedAccountCandidatesTest,CandidatesSelectionTest` (8 methods; one Quarkus boot, no database). Other matching evidence: `RecommendationCandidatesTest`, unchanged.

## Retained evidence affected

Retained passes for `CandidatesSelectionTest` no longer match, because its first method's expectation changed. These two journeys select `recommendation` with `gcsp.account.provider=repository` over a seeded row whose record has the stored keys:

- `offers/GeneratedClaimRemoteOfferHttpTest.java`, through `GeneratedClaimRemoteOfferProfile`, which extends `OidcRemoteOfferProfile`.
- `offers/GeneratedClaimRemoteOrderingHttpTest.java`, through `GeneratedClaimRemoteOrderingProfile`.

They should give the same decisions and digest through the repository reads, but their retained passes predate this composition. Each needs a finite rerun before it counts again. No in-tree profile selects `recommendation` with account `none`.

## Still open

- **Not removed.** The two Buddy SQL reads still run; their result is ignored only when `recommendation` is selected.
- **Not proved.** Full Buddy, the order and status HTTP journey, shaped variation across all ports, real OIDC, mail, a hosted environment and BMW.
- **Owned elsewhere.** `AccountPolicyPort` over `PolicyService` belongs to the Russell F458 lead.
- **Holds.** F477 M1 / FUCQ-515 stays held; FUCQ-516 is unrepaired; Bugs 513-516 remain capture-only.
- Neither original acceptance criterion is complete.
