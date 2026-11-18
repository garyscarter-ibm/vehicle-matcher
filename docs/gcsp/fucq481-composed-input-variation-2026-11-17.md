# FUCQ-481 composed input variation: 17 November 2026

One new test, aimed at the second original acceptance criterion. The test changes the employee and stock source rows, and shows that the selected candidates' computed eligibility changes. It then restores both rows and runs the retained generated journey through the owner's order and status read. It was authored from `8a3d00762`, reading ROOT `887b2bad6`. The worker returned uncompiled source at 13:00:29 UTC; the parent subsequently compiled and ran the exact method successfully. It changes no production source, no existing test and no screen.

## Paths

- `services/gcsp-api/src/test/java/gcsp/api/offers/GeneratedClaimInputVariationHttpTest.java`, method `changedSourceFactsAlterComputedEligibilityAndRestoredSourcesDriveTheOwnersOrder`.
- `services/gcsp-api/src/test/java/gcsp/api/offers/GeneratedClaimInputVariationProfile.java`.
  - This is an empty subclass of `GeneratedClaimRemoteOrderingProfile`, so the test gets its own Quarkus lifecycle: a fresh schema, stubs and JWKS.
  - Every setting is inherited, including the fixture policy clock, `gcsp.account.provider=repository`, `recommendation` candidates, remote Buddy and remote ordering.
- The body is a bounded copy of the retained `GeneratedClaimRemoteOrderingHttpTest` (ROOT `887b2bad6`), with the variation block added before the allocation.

## Boundary exercised

1. **Selected seam.** The test injects the startup-selected `EligibleCandidates` (`SelectedAccountCandidates` over `RecommendationCandidates`) and the selected `AccountRecordsPort` (`RepositoryAccountRecords`).
   - It builds each request from the same rows `allocation/Prepare.java` reads: the employee and version, the brief head and content, and the released `stock_cars`.
   - The scope is `DecisionEnv.POLICY`, `DecisionEnv.NOW` and clock version 1, the same as the allocation.
   - **The caller's `accountRecord` is always the canonical stored record.** If the selected provider were ignored, the employee variant would stay eligible and the test would fail.
2. **Employee variant.** In `employee_account_records.record`, only the employee driver's `eligible.value` changes (true to false). Its provenance is unchanged, and the test asserts that the two records differ only there.
   - The selected repository `readDrivers` returns the changed fact.
   - Expected: car `...0001` becomes `ineligible`, with blocker `driver-ineligible`.
   - The quote's `employeeFacts.driverEligible` is the changed fact.
   - Policy and stock versions are unchanged.
3. **Stock variant.** The account row is restored first. Then, in `stock_cars.attributes.facts.facts.eligibilityModelKey`, only the value changes, from `G21 Touring|320i` to `G21 Touring|M340i`, and the test asserts that this is the only difference.
   - This is the same source-backed change as `RecommendationCandidatesTest` and `ProviderShapeVariationPgTest`.
   - Expected: `ineligible` with blocker `policy-exclude`; the quote snapshot carries the changed key.
   - The facts and policy versions are unchanged.
4. **Restoration.**
   - Each row is written back through the same table.
   - The stored record is checked to equal the canonical one.
   - A fresh evaluation equals the canonical `Evaluated` result exactly.
   - `allocation_runs`, `buddy_quotes`, `custody_holds`, `buddy_offers` and `selection_orders` are all empty, so the denied variants left no workflow output.
5. **Retained journey on restored sources.**
   - The application generates the claim, then the owner's RS256 JWT decision through JWKS, then the selected remote ordering acknowledgement, then the owner's `GET /manual/order`, with exactly one execute and replays.
   - The assertions are unchanged.
   - In addition, the single durable `buddy_quotes.quote` matches the canonical computed quote's `orderUuid`, `configurationId`, `snapshot`, `terms`, `employeeFacts` and `versions`. The comparison uses a JSON round trip, because jsonb can change how numbers are typed.
   - The hold, the selection and the input digest are checked by the retained assertions.

## Finite run, parent-owned

`-Dtest=GeneratedClaimInputVariationHttpTest`: one method, one Quarkus boot, native PostgreSQL (`GCSP_TEST_DATABASE_URL`), JWKS and the two loopback stubs. It should run on the latest ROOT composition.

At 13:04 UTC the parent ran the one named method from immutable validation commit `9ae454b7164ed82684b03f72243b9e2417075208`, tree `e9792378f9e78119796df5f6f0fe4722e18c5e37`: current root `b9041a040` plus the worker's exact three files from `df44a34f568bebbb05a634140de9cf24271ee087`. Result: **1 test passed, zero failures, errors or skips**, native exit 0, 26.4 seconds. This confirms the employee denial, stock denial, full canonical evaluation restoration and durable quote comparison before the retained owner HTTP journey.

Independent source review 35 (Hiccup 2, requested and selected `gpt-6.1-sol` / `high`, no fallback or descendants) passed without blocking or major findings. Parent cleanup audit at 13:06:55 UTC independently found all 76 owned process identities, the supervisor, 19 process groups, scratch and reservation absent; source and tool pins were unchanged. Peak measured process RSS was 958,676,992 bytes and scratch 103,514,816 bytes. Local receipts are `.claude/results/fucq481-input-variation-review-35.json`, `.claude/test-runs/receipts/fucq481/input27-1259/20261117T130400-fucq481-input27-1259-ordering.json` and `.claude/fucq481-input27-parent-audit-1259-ordering.json`.

This run used the retained isolated PostgreSQL 16 setup. The newly published `AGENTS.md` Story test set requires PostgreSQL 17 and a covering green batch for Story acceptance; this single method is bounded increment evidence and does not satisfy that complete set or batch. Root advanced to `80e340829` with instructions/settings only, leaving the tested API source unchanged. Neither original acceptance criterion is complete.

## Least-certain points

- **Request assembly.** The test reads the same rows `Prepare` reads, but does not call `Prepare` itself. Under `recommendation`, `Prepare` still makes its own direct SQL read of the account record; the selected adapter then ignores that record.
- **Quote equality after the claim.** `Claim` copies the contender's quote and only adds `gateStatus` and `decision`. The parent's passing run confirmed equality of the compared keys after the JSON round trip for this fixture.
- **Clocks.** The fixture policy instant and same-instant allocation are kept unchanged. The account projection's system clock (unpinned `gcsp.account.fixed-now`) is not touched. FUCQ-516 is not addressed.

## Still open

- **Not removed.** The direct SQL reads in Buddy prepare and lifecycle; removing them needs a release of those allocation files.
- **Not proved.** A registered real OIDC issuer or browser login, real mail, the hosted environment, any BMW service, shaped inputs varied across all ports, and later-clock recovery.
- **Holds.** F477 M1 / FUCQ-515 stays held; Bugs 513-516 remain capture-only; FUCQ-516 is unrepaired.
- **Not complete.** Neither original acceptance criterion.
