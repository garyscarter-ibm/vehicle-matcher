# FUCQ-481 provider composition handover: 17 November 2026

This is the integration handover for FUCQ-481. It was written from source at `20d71cb9f`, whose API tree `55023060` equals the integration root `23eca515d`. **It is source reading only; nothing was run for it.** The full per-port detail is in `fucq481-provider-inventory-2026-11-17.json`: see `uniquePortCensus` and `reconciliation.demoPreparation.currentTrace`.

## Startup and configuration map

Every external provider is chosen once at startup. An unknown value stops the service, and no mode falls back silently.

| Key (environment) | Default | Modes | Selector |
|---|---|---|---|
| `gcsp.identity.provider` | none | none, oidc, fixed-test (tests only) | `identity/IdentitySelection` |
| `gcsp.account.provider` | none | none, repository, hr-snapshot | `account/AccountSelection` |
| `gcsp.evidence.provider` | none | none, lookup, offline | `evidence/EvidenceSelection` |
| `gcsp.supply.provider` | none | none, tranche-plan | `supply/SupplySelection` |
| `gcsp.allocation.candidates.provider` | unconfigured | unconfigured, recommendation | `recommendation/CandidatesSelection` |
| `gcsp.claims.stock.provider` | local | local, remote | `remote/RemoteOperationProviders` |
| `gcsp.buddy.provider` | local-synthetic | local-synthetic, remote | `remote/RemoteOperationProviders` |
| `gcsp.ordering.provider` | none | none, synthetic, remote | `ordering/OrderingSelection` plus `OrderingProviderBindings` |
| `gcsp.documents.provider` | none | none, synthetic, unsupported | `documents/DocumentsWiring` |
| `gcsp.appointments.provider` | none | none, synthetic, live (refusing stub) | `appointments/AppointmentsWiring` |
| `gcsp.approvals.provider` | none | none, synthetic, live (stub) | `approvals/ApprovalSelection` |
| `gcsp.returns.provider` | none | none, synthetic, live (stub) | `returns/ReturnSelection` |
| `gcsp.production.provider` | none | none, synthetic, live-stub | `production/ProductionSelection` |
| `gcsp.mail.transport` | captured (blank) | captured, brevo | `notify/MailTransportSelection` |
| `gcsp.scenario.provider` | none | none, demo | `scenario/ScenarioWiring` |

Remote claim stock, Buddy and ordering each read `execute-url`, `reconcile-url`, `token` and `timeout` under their own prefix. Remote settings are validated eagerly with key-only error messages. Plain-http loopback is allowed only in TEST.

## Demo preparation

- **Guarded.** It runs only with `demo` and persistence both on, and only on a database claimed with `reset_allowed` (`ScenarioWiring.java:38, 59, 68, 89-101`).
- **What it writes.** `scenario_runs`, `employees`, `employee_account_records` and `entitlement_slots` (`DemoPreparation.java:126-150`). Reset retires the run and prepares again (`ScenarioService.java:102-121`).
- **Faults.** `scenario_faults` is written (`ScenarioFaults.java:69`) but read nowhere else, so faults reach no selected provider.
- **No provider constructed.** Preparation builds and injects no external provider.
- **The gap.** Buddy prepare (`allocation/Prepare.java:100`), the Buddy remote lifecycle (`allocation/BuddyRemoteLifecycle.java:315`) and the manual-draft check (`account/ManualDrafts.java:113`) read `employee_account_records` straight from SQL, whatever `gcsp.account.provider` is. Held planning demand (`planning/PostgresDemandSnapshot.java:96`) does the same. So seeded rows can reach Buddy results outside the selected account provider. This is the open half of AC1's "demo preparation cannot bypass this composition".

## Evidence to retain

These are native runs, retained and not rerun. They are connected partial boundaries:

- 13 remote ordering adapter methods (`09e224584`).
- 1 durable ordering consumer method: `.claude/test-runs/receipts/fucq481/ordering-consumer-1021/`.
- 8 binding methods, then 11 startup methods (the 8 overlap): `.claude/test-runs/receipts/fucq481/ordering-startup-1053/` and review 28.
- 1 generated claim to owner JWT to selected-remote Holder acknowledgement: `.claude/test-runs/receipts/fucq481/generated-ordering-1111/`, review 29 and audit 1111.
- Earlier claim, Buddy and offer runs, as cited in the inventory history.

## Honest gaps against the original acceptance

- **AC1.** Providers are selected at startup for every external contract in the census. Demo-preparation consumption still bypasses the account selection (above). Six contracts have only a refusing implementation: `OrderStagePort`, `HandoverReadinessPort`, `HandoverPort`, `ReturnSourcePort`, `PlanSnapshotPort` and `CaseCarSuitabilityPort`.
- **AC2.** Claim, signed-in decision and remote ordering acknowledgement are connected. The employee's order and status HTTP read still needs `AccountPolicyPort` over `PolicyService`, which the **Russell F458 lead** owns. Differently shaped employee and stock inputs are shown for HR and tranche plans, not across all ports.
- **Not proved.** A registered real OIDC issuer, browser login, real mail, any BMW service or capability, and the **FUCQ-516** later-clock recovery. The hosted dev environment is absent, per Gary at 08:47 UTC.
- **Holds.** **F477 M1 / FUCQ-515** stays held. Bugs 513-516 remain capture-only.

## Next smallest original-AC increment

Make the three direct `employee_account_records` reads go through the selected `AccountRecordsPort`, so demo-seeded rows reach Buddy only under `gcsp.account.provider=repository`.

- **Files:** `allocation/Prepare.java`, `allocation/BuddyRemoteLifecycle.java`, `account/ManualDrafts.java`, plus one focused test each.
- **Ownership:** `ManualDrafts` and the account package belong to the F458 lane. `Prepare` and `BuddyRemoteLifecycle` need allocation-lane coordination. It must not be done without those releases.
- **If that is not released:** the ready alternative is a source note, plus one test asserting the current bypass under `account=none`, recorded as a defect candidate. No product change.
