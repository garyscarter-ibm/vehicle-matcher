# FUCQ-481 selected account records for allocation candidates: 17 November 2026

This note covers one adapter. When startup selects recommendation candidates, it now reads each employee's account facts from the selected `AccountRecordsPort`. It no longer uses the record the caller passes in. It was authored from `7f13b0362` (API tree `55023060`). **Parent validation passed: 8 adapter/selector methods and 2 generated-claim journey regressions; zero failures, errors or skips.** It changes no screen.

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

## Authored tests and parent validation

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

They should give the same decisions and digest through the repository reads, but their retained passes predate this composition. The parent reran each exact method against this selected-account composition; both passed. No other integration-journey profile was found selecting `recommendation` with account `none`; `CandidatesSelectionTest.RecommendationProfile` intentionally leaves account at `none` to prove refusal.

## Still open

- **Not removed.** The two Buddy SQL reads still run; their result is ignored only when `recommendation` is selected.
- **Not proved.** Full Buddy, the order and status HTTP journey, shaped variation across all ports, real OIDC, mail, a hosted environment and BMW.
- **Peer binding delivered.** F458 merge `3542ff697` now binds `AccountPolicyPort` to `PolicyAccountAdapter` over `PolicyService`, plus current-car relationships to the returns store. Its peer result reports local composition checks; the parent validates this candidate increment against that current root. Real OIDC, hosted dev and original account-view integration evidence remain unverified.
- **Holds.** F477 M1 / FUCQ-515 stays held; FUCQ-516 is unrepaired; Bugs 513-516 remain capture-only.
- Neither original acceptance criterion is complete.

## Parent validation and limits

The parent froze the exact four Java files from worker `3a80788315194db2f4b7cfb5c14cd8fd2fae38d6` in immutable current-root context `5f1fe1bcbe5d5f8f676e614a873c5e613de9c340` (including F458 merge `3542ff697`). Three sequential finite chunks passed: 8 adapter/selector methods in 22.8 seconds, generated owner-JWT remote-offer acceptance in 25.7 seconds, and generated selected remote ordering/service-read/replay in 24.2 seconds. All ten passed with zero failures, errors or skips; the unit chunk used no PostgreSQL, while each journey used a fresh owned native PostgreSQL16 database. These are scoped checks, not a full suite or live OIDC/browser/email/hosted proof.

Independent Kronk 2 review32 passed with no blocking or major issue (requested/selected `gpt-6.1-sol` / high, no fallback or reviewer runtime). The parent corrected the two documentation qualifiers identified by that review; the four Java files remain identical to the tested freeze.

Parent audits independently verified all recorded child identities plus each supervisor, groups, scratch and reservation absent after each chunk: unit 50 identities/4 groups, offer 75/19, ordering 74/20. The largest observed RSS was 980,795,392 bytes and scratch 103,256,032 bytes. Receipts live under `.claude/test-runs/receipts/fucq481/selected-account-1213/`; parent audits are `.claude/fucq481-selected-account-parent-audit-1213-{unit,offer,ordering}.json`, review `.claude/results/fucq481-selected-account-review-32.json`.

The selected account source now controls candidate inputs and preserves the generated journeys at the fixture instant. Direct Buddy SQL reads still execute; full owner order/status HTTP, shaped variation across all ports and both original Story criteria remain open. The next source-only assignment25 extends the existing generated-ordering test through that real HTTP route; it is separate from these completed checks. No OneDrive access occurred.
