# FUCQ-481 provider composition handover: 17 November 2026

This is the integration handover for FUCQ-481. It was written from source at `20d71cb9f`, whose API tree `55023060` equals the integration root `23eca515d`, and published at `fc244cc06`. It was corrected at 11:55 UTC after independent review 30, against the same API tree. **It is source reading only; nothing was run for it.** The full per-port detail is in `fucq481-provider-inventory-2026-11-17.json`: see `uniquePortCensus` and `reconciliation.demoPreparation.currentTrace`.

## Startup and configuration map

- **Names are checked at startup.** Every key below is validated once at startup, and an unknown value stops the service.
- **Some providers are built later.** Returns and production build their provider on first use. A selected `synthetic` without active persistence then quietly becomes the unconfigured, refusing provider (`returns/ReturnSelection.java:104-111`, `production/ProductionSelection.java:47-55`). That is a downgrade, not an unknown-mode refusal, and it is an open gap.
- **Six contracts have no key.** `OrderStagePort`, `HandoverReadinessPort`, `HandoverPort` (approvals and returns), `ReturnSourcePort`, `PlanSnapshotPort` and `CaseCarSuitabilityPort` each have only a refusing default, so there is nothing to select.

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
  - six contracts have only a refusing implementation and no key.
- **Ordering.** `remote-bound` means remote is selectable and connected when `gcsp.ordering.provider=remote` is set. Default startup is `none`, which refuses.
- **AC2.** Claim, signed-in decision and remote ordering acknowledgement are connected. The F458 policy blocker is resolved at ROOT `3542ff697`: `AccountPolicyPort` is bound to `PolicyAccountAdapter`. The owner's order and status HTTP read is authored (`209bf4f7a`) but **unrun**. Differently shaped employee and stock inputs are shown for HR and tranche plans, not across all ports.
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
- **Unrun.** The owner `GET /manual/order` extension (`209bf4f7a`).
- **Absent.**
  - The hosted dev environment, real OIDC and browser login, and the Angular account view.
  - Real mail, and any BMW service.
  - Shaped inputs varied across all ports, and FUCQ-516.
- **Superseded above.** The "next increment" for the two Buddy reads is now partly delivered, as an adapter rather than a change to those files. Their SQL still runs, but its record is ignored under `recommendation`.
- **Next.** The parent runs `-Dtest=GeneratedClaimRemoteOrderingHttpTest`. Removing the now-redundant Buddy SQL reads would need an allocation-file release.
