# FUCQ-481 provider composition handover: 17 November 2026

This is the integration handover for FUCQ-481. It was written from source at `20d71cb9f`, whose API tree `55023060` equals the integration root `23eca515d`, and published at `fc244cc06`. It was corrected at 11:55 UTC after independent review 30, against the same API tree. **It is source reading only; nothing was run for it.** The full per-port detail is in `fucq481-provider-inventory-2026-11-17.json`: see `uniquePortCensus` and `reconciliation.demoPreparation.currentTrace`.

## Startup and configuration map

- **Names are checked at startup.** Every key below is validated once at startup, and an unknown value stops the service.
- **Some providers are built later.** Returns and production build their provider on first use. A selected `synthetic` without active persistence then quietly becomes the unconfigured, refusing provider (`returns/ReturnSelection.java:104-111`, `production/ProductionSelection.java:47-55`). That is a downgrade, not an unknown-mode refusal, and it is an open gap.
- **Six contracts have no key.** `OrderStagePort`, `HandoverReadinessPort`, `HandoverPort` (approvals and returns), `ReturnSourcePort`, `PlanSnapshotPort` and `CaseCarSuitabilityPort` each have only a refusing default, so there is nothing to select. *(Corrected 13:12 UTC: five. F478 binds `PlanSnapshotPort` to the real `PlanningPlanSnapshot` default, whose planner inputs are still unconfigured.)*

| Key (environment) | Default | Modes | Selector |
|---|---|---|---|
| `gcsp.identity.provider` | none | none, oidc, fixed-test (tests only) | `identity/IdentitySelection` |
| `gcsp.account.provider` | none | none, repository, hr-snapshot | `account/AccountSelection` |
| `gcsp.evidence.provider` | none | none, lookup, alternate-offline | `evidence/EvidenceSelection` |
| `gcsp.supply.provider` | none | none, tranche-plan | `supply/SupplySelection` |
| `gcsp.allocation.candidates.provider` | none | none, recommendation | `recommendation/CandidatesSelection` |
| `gcsp.claims.stock.provider` | local | local, remote | `remote/RemoteOperationProviders` |
| `gcsp.buddy.provider` | local-synthetic | local-synthetic, remote | `remote/RemoteOperationProviders` |
| `gcsp.ordering.provider` | none (refusing) | none, synthetic, remote (remote-bound only when set) | `ordering/OrderingSelection` plus `OrderingProviderBindings` |
| `gcsp.documents.provider` | none | none, synthetic, unsupported | `documents/DocumentsWiring` |
| `gcsp.appointments.provider` | none | none, synthetic, live (a refusing stub) | `appointments/AppointmentsWiring` |
| `gcsp.approvals.provider` | none | none, synthetic, live-stub | `approvals/ApprovalSelection` |
| `gcsp.returns.provider` | none | none, synthetic, live-stub | `returns/ReturnSelection` |
| `gcsp.production.provider` | none | none, synthetic, live-stub | `production/ProductionSelection` |
| `gcsp.mail.transport` | captured (unset) | unset (captured), brevo | `notify/MailTransportSelection` |
| `gcsp.scenario.provider` | none | none, demo | `scenario/ScenarioWiring` |

Remote claim stock, Buddy and ordering each read `execute-url`, `reconcile-url`, `token` and `timeout` under their own prefix. Remote settings are validated eagerly with key-only error messages. Plain-http loopback is allowed only in TEST.

## Demo preparation

- **Guarded.** It runs only with `demo` and persistence both on, and only on a database claimed with `reset_allowed` (`ScenarioWiring.java:38, 59, 68, 89-101`).
- **What it writes.** `scenario_runs`, `employees`, `employee_account_records` and `entitlement_slots` (`DemoPreparation.java:126-150`). Reset retires the run and prepares again (`ScenarioService.java:102-121`).
- **Faults.** `scenario_faults` is written (`ScenarioFaults.java:69`) but read nowhere else, so faults reach no selected provider.
- **No provider constructed.** Preparation builds and injects no external provider.
- **The gap.** Buddy prepare (`allocation/Prepare.java:100-116`) and the Buddy remote lifecycle (`allocation/BuddyRemoteLifecycle.java:315-325`) read `employee_account_records.record` straight from SQL. They pass it to candidate evaluation as `accountRecord` (`allocation/EligibleCandidates.java:16-17`), and the recommendation adapter computes from its facts, drivers, contracts and source (`recommendation/RecommendationCandidates.java:32-152`). Neither file consults `gcsp.account.provider`. So with `recommendation` candidates selected, seeded rows reach Buddy results outside the selected account provider. This is the open half of AC1's "demo preparation cannot bypass this composition".
- **Not a bypass: manual drafts.** `account/ManualDrafts.java:99-103` first takes the *selected* account projection and refuses unless it is ready. Under `account=none` it never is. Lines 111-117 then read only the table's version, and only when the projection carries a `repositoryVersion`, to refuse a stale save. Open point: under `hr-snapshot`, that guard would compare a snapshot version with any seeded table row for the same employee. Source does not show whether that combination occurs.
- **Held.** Planning demand (`planning/PostgresDemandSnapshot.java:94-97`) also joins the table. It stays read-only under the F477 M1 / FUCQ-515 hold.

## Evidence to retain

These are native runs, retained and not rerun. They are connected partial boundaries:

- 13 remote ordering adapter methods (`09e224584`).
- 1 durable ordering consumer method: `.claude/test-runs/receipts/fucq481/ordering-consumer-1021/`.
- 8 binding methods, then 11 startup methods (the 8 overlap): `.claude/test-runs/receipts/fucq481/ordering-startup-1053/` and review 28.
- 1 generated claim to owner JWT to selected-remote Holder acknowledgement: `.claude/test-runs/receipts/fucq481/generated-ordering-1111/`, review 29 and audit 1111.
- Earlier claim, Buddy and offer runs, as cited in the inventory history.

## Honest gaps against the original acceptance

- **AC1.** The census has 123 public interface declarations: 34 external, 10 clocks, 38 internal and 41 results or helpers. Every keyed external contract has its name validated at startup. Three gaps remain:
  - the Buddy consumption of demo-seeded account rows bypasses the account selection (above);
  - synthetic returns and production downgrade quietly without persistence;
  - five contracts have only a refusing implementation and no key (six before F478 bound `PlanSnapshotPort`);
  - Production is bound to the real planner, but its planner inputs `PlanningDemand` (FUCQ-475) and `PlanningSupply` (FUCQ-477, under the M1/FUCQ-515 hold) are unconfigured, so a deployed plan submit answers 503 `planning-forecast-not-configured`.
- **Ordering.** `remote-bound` means remote is selectable and connected when `gcsp.ordering.provider=remote` is set. Default startup is `none`, which refuses.
- **AC2.** Claim, signed-in decision and remote ordering acknowledgement are connected. The F458 policy blocker is resolved at ROOT `3542ff697`: `AccountPolicyPort` is bound to `PolicyAccountAdapter`. The owner's order and status HTTP read (`209bf4f7a`) passed its exact native method in context `661185fca`, review33 PASS, integrated `887b2bad6`. Differently shaped employee and stock inputs are shown for HR and tranche plans, not across all ports.
- **Not proved.** A registered real OIDC issuer, browser login, real mail, any BMW service or capability, and the **FUCQ-516** later-clock recovery. The hosted dev environment is absent, per Gary at 08:47 UTC.
- **Holds.** **F477 M1 / FUCQ-515** stays held. Bugs 513-516 remain capture-only.

## Next smallest original-AC increment

Make the two Buddy reads take the account record from the selected `AccountRecordsPort`, so demo-seeded rows reach Buddy candidates only when the account provider supplies them. `ManualDrafts` is out of scope: it already sits behind the selected projection.

- **Files:** `services/gcsp-api/src/main/java/gcsp/api/allocation/Prepare.java` and `.../allocation/BuddyRemoteLifecycle.java`, plus one focused test each. All are read-only to this lane today.
- **Shape risk.** The port answers in two calls: `readEmployeeContract` (account, contracts, histories, slots) and `readDrivers` (drivers, employee facts). The candidates adapter reads one combined record. Whether the two compose to that record is a design point to settle first. It is not established here.
- **Ownership releases needed.** An explicit release of those two allocation files from their current owner, which the coordination files do not name. The account package, `AccountSelection` and `AccountPolicyPort` over `PolicyService` stay with the Russell F458 lead and are not touched.
- **If that is not released.** No other source-only AC1 increment is ready on this lane. The refusing-only contracts need BMW or capability facts that are absent. The returns and production downgrade is in foreign files. A capture-only characterization test would be busywork, so none is proposed.

## Current state, 17 November 2026, 12:32 UTC

Checked against ROOT `b220082c9`.

- **Delivered code.**
  - ROOT `3542ff697` (F458) binds `AccountPolicyPort` to `PolicyAccountAdapter`, and `CurrentCarPort` to the returns store when persistence is on.
  - ROOT `b220082c9` makes selected recommendation candidates read the selected `AccountRecordsPort`.
- **Matching local tests.** 10 parent passes for `b220082c9`: 8 adapter and selector methods, plus the 2 generated journeys. Review 32 passed.
- **Peer-reported.** F458's 146/146 relevant cases, including 11 dev-composition cases. The FUCQ-481 parent has not rerun them.
- **Matching local test.** Owner `GET /manual/order` extension (`209bf4f7a`): 1 method passed, zero failures/errors/skips, 26.0s; review33 PASS, parent cleanup audit clear; integrated/pushed `887b2bad6`. This replaces the earlier source-only UNRUN observation.
- **Unavailable environment and unverified evidence.**
  - Hosted dev does not exist, as confirmed by Gary. Real OIDC/browser login and Angular account-view integration evidence remain unverified; this does not assert the account-view code is absent.
  - Actual mail and authorised BMW service integration evidence remain unverified.
  - Variation across all selected port inputs remains unverified; the recorded FUCQ-516 later-clock defect remains capture-only and unrepaired.
- **Superseded above.** The "next increment" for the two Buddy reads is now partly delivered, as an adapter rather than a change to those files. Their SQL still runs, but its record is ignored under `recommendation`.
- **Next.** Claude assignment27 is authoring the bounded changed employee/stock-input proof through actual selected candidates, followed by the canonical generated owner-HTTP/remote-ordering journey. The parent owns its later focused validation and review. Removing the now-redundant Buddy SQL reads still needs an allocation-file release.

### Parent correction and evidence refresh, 2026-11-17T12:42:24.406039+00:00

`PolicyBriefAdapter` already supplies the non-default `BriefPolicyPort` bean over `PolicyService`; the source26 fallback-only statement was an inventory error identified by review34 and corrected in the JSON/Markdown current rows. Missing brief-specific matching runtime remains explicit. All earlier observations are retained as dated history. Owner HTTP25 now has the matching local pass/review/audit above; no new execution was needed to refresh these documents. Both original acceptance criteria and live integration/all-port/later-clock gaps remain open.

## Production state, 17 November 2026, 13:12 UTC

Checked from source at ROOT `b9041a040`.

- **Delivered code (F478).**
  - `PlanSnapshotPort` is the `@DefaultBean` `PlanningPlanSnapshot`.
  - Planning `SubmissionHistory` is `ProductionSubmissionHistory`.
  - `GregOrdersResource` registers `GET`/`POST /greg/orders`, `POST /greg/orders/queue` and the guarded `POST /presenter/production`.
- **Default-configured.** None of these has a key. `gcsp.production.provider` stays `none` (which refuses) by default, with `synthetic` and `live-stub` selectable.
- **Absent in deployment.** The planner inputs `PlanningDemand` and `PlanningSupply` are still the unconfigured defaults, so the started app's plan submit answers 503 `planning-forecast-not-configured`.
- **Peer-reported.** F478's 228 scoped passes, which use test beans for the two planner inputs, and the 503 composition test. Neither was rerun here.
- **Parent pass.** Assignment 27's input-variation method passed once. It covers the selected seam over Prepare-shaped rows, plus the remote journey. It does not run Prepare itself, and it is not an acceptance claim.
- **Next smallest original-AC work.** Binding the planner inputs belongs to FUCQ-475 (demand) and FUCQ-477 (supply, held under M1/FUCQ-515), not this lane. The Buddy SQL read removal still needs a release of `allocation/Prepare.java` and `allocation/BuddyRemoteLifecycle.java`. No other source-only AC1 increment is ready here.

## Local acceptance state, 18 November 2026

Run on `29f5b1d21` (base `gcsp-poc-dev` at merge `28bfa5ba4` plus three new test files), native PostgreSQL through the shared test stack.

- **Demo preparation through the composition.** `DemoScenarioRemoteOrderingHttpTest`: `scenario=demo`, run `run-1`, `account=repository`, `candidates=recommendation`, real `HttpOrderingProvider` over loopback. Demo preparation alone creates Paula's employee, account record and slot. She confirms a brief with her RS256 JWT, a presenter tick claims for her from an eligible selected-candidates decision, she accepts over HTTP, and her `GET /manual/order` reads `acknowledged` with exactly one remote execute, unchanged on a repeat read.
- **Candidates cannot bypass the account selection.** `CandidatesSelection` offers only `none` (refuses) or `recommendation`, which reads the selected `AccountRecordsPort`; the Buddy SQL read of the record stays ignored there.
- **Focused set.** 135 tests in 30 classes, 0 failures/errors/skips: the four generated/demo journeys, `ordering.**`, the two candidates tests and the startup and wiring set. Summary: `.claude/test-runs/receipts/fucq481/focused-20261118/summary.txt`.
- **Still for hosted acceptance (Gary).** Registered real test OIDC issuer and browser login, real test email delivery, the hosted dev environment. Remaining BMW gaps and refusing-only contracts are as listed above; the returns and production downgrade refuses rather than fabricating.
