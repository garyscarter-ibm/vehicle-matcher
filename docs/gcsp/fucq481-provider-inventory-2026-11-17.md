# FUCQ-481 provider inventory (2026-11-17)

This records the external provider ports in the GCSP Java API as the source stands at `bdee6c5123779d877e87855b4174667f1a626a5d`. Three remote-provider/offer records were reconciled at `e3c56854a`; both `EligibleCandidates` records are now reconciled at `97cd67aa4` after delivery of the canonical adapter. Other records retain their own earlier observations. It covers an inventory increment of AC1 only. **Provider selection is not complete, and neither are AC1, AC2 or the Story.**

- **How it was built:** the initial inventory used static source reading. The current claim-stock, Buddy and offer-decision records also reference matching retained native execution below. This documentation reconciliation ran no new tests, and no port is verified-live against BMW.
- **The full record:** the machine-readable version, with contracts, implementations, consumers, failure semantics and evidence per port, is [`fucq481-provider-inventory-2026-11-17.json`](fucq481-provider-inventory-2026-11-17.json).

## Summary
There are 59 inventory records: 24 read/input and 35 action/event. These include grouped contracts and cross-domain duplicates, including `EligibleCandidates`; the counts describe records, not a deduplicated port total or exhaustive AC1 coverage.

| Status | Records | Meaning |
|---|---|---|
| local-bound | 15 | A local or repository provider is bound at startup |
| remote-bound | 1 | `OrderingProviderPort` (action/event), and only when `gcsp.ordering.provider=remote` is set explicitly. Its default is `none`, which refuses |
| default-unconfigured | 16 | The default gives a refusing or unconfigured provider |
| partial | 26 | Some provider modes exist, but a required mode or a consumer path is missing |
| unverified-runtime | 1 | The broad persistence record remains unverified as a complete composition; selected native PostgreSQL evidence exists |

**Selection:** every switchable provider is chosen once at startup from a `gcsp.*` key in `services/gcsp-api/src/main/resources/application.properties`. The keys are identity, account, evidence, supply, documents, appointments, approvals, returns, production, ordering, scenario, mail, claim stock and Buddy.
- The original switchable providers default to `none`, except captured mail. Claim stock defaults to `local`; Buddy defaults to `local-synthetic`. Their new `remote` selections refuse invalid settings at startup and never fall back.
- An unknown value stops startup.
- One exception: the name is checked at startup, but the returns and production providers are built on first use. A selected `synthetic` without active persistence then quietly becomes the unconfigured provider (`returns/ReturnSelection.java:104-111`, `production/ProductionSelection.java:47-55`). That is a downgrade, not an unknown-mode refusal.
- `render.gcsp.yaml` sets the dev API's providers explicitly: account, evidence, supply, documents, appointments and returns are `none` and ordering is `synthetic` (`render.gcsp.yaml:221-254`). Identity stays unset until OIDC is registered (`:175`), and mail stays captured unless Brevo is uncommented (`:260`). So the dev deployment, as committed, cannot exercise AC2's differently shaped employee or stock inputs.

## Findings against the original AC
1. **Claim-stock and Buddy remote substitutes are now selectable at startup.** `remote/RemoteOperationProviders.java` selects `claims/HttpClaimStock.java` and `allocation/HttpRemoteBuddy.java`. The retained 65-case adapter/transport/startup run and 10 HTTP-to-durable-consumer cases passed. Three HR/stock-shape component cases also passed. See [remote provider evidence](fucq481-remote-operation-providers-2026-11-17.md).
   - One native Quarkus/JWKS JWT method passed using the injected remote Buddy and PostgreSQL offer records for durable acceptance and HTTP offer readback (`30241a729`, integrated `3d196cfb4`). Independent source review passed.
   - The preceding acknowledged claim/offer was seeded and the policy clock was profile-scoped and fixed. SQL order persistence plus HTTP offer state does not prove the full order-status HTTP route, connected claim-to-decision journey, browser/hosted OIDC, actual email or BMW integration. Both original criteria remain open.
2. **Demo preparation is guarded at startup, but its rows are read outside the selected provider.**
   - **The guard:** `gcsp.scenario.provider` accepts only `none` or `demo` (`scenario/ScenarioProvider.java:13`). Preparation runs only with demo and persistence both on (`scenario/ScenarioWiring.java:68`), and it stops startup unless the database was claimed with reset allowed (`:86`).
   - **The write:** it inserts employees, account records and slots by direct SQL (`scenario/DemoPreparation.java:138`).
   - **The gap:** `AccountService` sees those rows only under `gcsp.account.provider=repository`. But Buddy prepare (`allocation/Prepare.java:100-116`) and the Buddy remote lifecycle (`allocation/BuddyRemoteLifecycle.java:315-325`) read `employee_account_records` directly into candidate evaluation, whatever the account provider is.
   - So with `recommendation` candidates selected, seeded rows feed Buddy results even under `account=none` or `hr-snapshot`.
   - The manual-draft check (`account/ManualDrafts.java:111-117`) is narrower. It runs only after the selected account projection is ready, and reads only the table version when that projection carries a `repositoryVersion`. It is a conditional stale-save guard, not a bypass (corrected 17 November, 11:55 UTC). "Demo preparation cannot bypass this composition" is not yet true.
3. **Account policy always refuses in the main injection.** `account/AccountSelection.java:68` produces `UnconfiguredAccountPolicy`. Only the recommendation and brief-preview paths build `PolicyAccountAdapter` inline (`recommendation/RecommendationResource.java:126`, `brief/RecommendationBriefPreview.java:91`). *(Original finding. Corrected 12:32 UTC: ROOT `3542ff697` binds `PolicyAccountAdapter`; see the current composition section.)*
   - The current-car port answers success with an empty list (`account/AccountSelection.java:62`). *(Corrected 12:32 UTC: only without persistence; with it, the returns store is bound.)*
4. **Some ports have no real binding at all:**
   - candidate evaluation: `gcsp.allocation.candidates.provider=recommendation` now selects the real canonical adapter; unset/blank/none still refuses. Thirteen focused cases have matching passes, including actual selected injection and native-PG claim/offer production through a scripted remote at the same instant. A one-second-later reconciliation reproduces premature release, captured as Medium FUCQ-516; no lifecycle repair or successful recovery is claimed;
   - order stages, handover readiness, return source, plan snapshot and comparison replay;
   - Greg plan submission.
   - The clock also has no handler for the Buddy allocation, Buddy expiry or manual expiry stages.
5. **Planning reads stay unconfigured on this branch.** Only the inert `DemandCohort` and `PostgresDemandSnapshot` helpers are here (251d89b22). `PostgresPlanningDemand` and `PostgresPlanningSupply` are held by FUCQ-515.
6. **Clocks:** policy, account, planning, learning and comparison read wall time, not the run clock. This is the known FUCQ-515 family, recorded here and not refiled.
7. **BMW access and capability:** no port names a BMW source. `docs/gcsp/migration-replacement-contracts-2026-11-13.md` lists BMW identity, HR, stock, ordering and lifecycle access and capabilities as unknown, around lines 98 and 128. Mail is IBM-side: Brevo acceptance is not inbox delivery.

## Ports
Paths are under `services/gcsp-api/src/main/java/gcsp/api/` unless shown in full. The "key = default" column is the startup config, where there is one.

| Port | Side | Status | Key = default | Contract | Why |
|---|---|---|---|---|---|
| IdentityPort | read/input | default-unconfigured | `gcsp.identity.provider` = none | services/gcsp-api/src/main/java/gcsp/api/identity/IdentityPort.java:7 | Default is none; only an in-process JWKS server has exercised the oidc provider. No real issuer evidenced (dispatcher-learnings.md:335 lists real Java/OIDC/PostgreSQL proof as unrun). |
| PolicySource | read/input | local-bound | `(follows persistence)` = retained classpath seed | services/gcsp-api/src/main/java/gcsp/api/policy/PolicySource.java:7 | Bound at startup with no extra config to retained dated tables (classpath) or PostgreSQL. Retained synthetic policy, not a BMW source. Postgres-backed tests skip without GCSP_TEST_DATABASE_U |
| PolicyClock | read/input | partial | `(none)` = wall clock | services/gcsp-api/src/main/java/gcsp/api/policy/PolicyClock.java:9 | Wall clock only; the presenter RunClock does not feed PolicyClock consumers. No PresenterClock class exists; the presenter clock is RunClock. |
| AccountRecordsPort | read/input | default-unconfigured | `gcsp.account.provider (+ gcsp.account.hr-snaps` = none | services/gcsp-api/src/main/java/gcsp/api/account/AccountRecordsPort.java:7 | Default none; file and PostgreSQL providers exist; the committed blueprint sets GCSP_ACCOUNT_PROVIDER=none (render.gcsp.yaml:229). |
| AccountPolicyPort | read/input | local-bound | `(none)` = UnconfiguredAccountPolicy | services/gcsp-api/src/main/java/gcsp/api/account/AccountPolicyPort.java:6 | Bound to `PolicyAccountAdapter` over `PolicyService` (ROOT `3542ff697`, `AccountSelection.java:70-74`); was refusing. Peer-reported evidence; no BMW policy. |
| CurrentCarPort (account) | read/input | local-bound | `(none)` = empty list | services/gcsp-api/src/main/java/gcsp/api/account/CurrentCarPort.java:3 | Returns store bound when persistence is active (ROOT `3542ff697`); without it, still ok with an empty list. |
| AccountClockPort | read/input | partial | `gcsp.account.fixed-now (no properties entry)` = unset: system clock | services/gcsp-api/src/main/java/gcsp/api/account/AccountClockPort.java:3 | Wall clock; presenter RunClock does not reach it. |
| BriefAccountPort / BriefPolicyPort | read/input | partial | `gcsp.environment.policy-version, gcsp.environm` = adapters win | services/gcsp-api/src/main/java/gcsp/api/account/BriefAccountAdapter.java:15 | The account half now runs on the bound policy (ROOT `3542ff697`); `BriefPolicyPort` still only has the `@DefaultBean` fallback. |
| VehicleProvider / VehicleDetailsConsumer (configuration, specification | read/input | default-unconfigured | `gcsp.evidence.provider (+ store, reference-dir` = none | services/gcsp-api/src/main/java/gcsp/api/evidence/VehicleProvider.java:6 | Default none and the proposed blueprint sets none (services/gcsp-api/render-service.proposed.yaml:63-64). Real providers read retained synthetic files. |
| StockPort (evidence stock identity) | read/input | local-bound | `(follows persistence)` = bean present | services/gcsp-api/src/main/java/gcsp/api/evidence/StockPort.java:6 | Bound to PostgreSQL when persistence on; reached only when the evidence provider is not none. Postgres-backed tests skip without GCSP_TEST_DATABASE_URL (PgFixture.java:31-39), so connected P |
| VehicleEvidencePort (recommendation input) | read/input | local-bound | `(none)` = stored stock facts | services/gcsp-api/src/main/java/gcsp/api/recommendation/VehicleEvidencePort.java:11 | Bound by default to stock-row facts stored by the supply provider; not the evidence provider. |
| EligibleCandidates | read/input | partial | `gcsp.allocation.candidates.provider` = none; recommendation selectable | services/gcsp-api/src/main/java/gcsp/api/allocation/EligibleCandidates.java:8 | Canonical frozen-request adapter and startup selection delivered; 13 scoped cases have matching passes. Direct account SQL, F516 later-clock failure and full connected journey remain. Since ROOT `b220082c9` the selected recommendation reads account facts through the selected `AccountRecordsPort`; the Buddy SQL reads still run but their record is ignored. |
| SupplyProvider | read/input | default-unconfigured | `gcsp.supply.provider (+ tranche-plan-file)` = none | services/gcsp-api/src/main/java/gcsp/api/supply/SupplyProvider.java:4 | Default none; only a synthetic local plan file exists. Postgres-backed tests skip without GCSP_TEST_DATABASE_URL (PgFixture.java:31-39), so connected PostgreSQL behaviour was not observed fr |
| ReleasePolicy | read/input | partial | `gcsp.supply.policy-file` = empty | services/gcsp-api/src/main/java/gcsp/api/supply/ReleasePolicy.java:6 | Release policy bypasses PolicyService unless a file is set; the PolicyService adapter exists but is never selected (README.md:186). |
| ReleasedStock page read | read/input | local-bound | `(follows persistence)` = IllegalStateException when p | services/gcsp-api/src/main/java/gcsp/api/recommendation/StockPages.java:10 | Reads PostgreSQL when persistence is on. Postgres-backed tests skip without GCSP_TEST_DATABASE_URL (PgFixture.java:31-39), so connected PostgreSQL behaviour was not observed from tests alone |
| RunClock / DocumentClock | read/input | partial | `(follows persistence)` = inactive | services/gcsp-api/src/main/java/gcsp/api/clock/RunClock.java:22 | Real run clock, but PolicyClock, PlanningClock, LearningClock, AccountClockPort and demand do not use it. RunPlanningClock is absent from this branch. |
| PlanningClock / LearningClock (wall clocks) | read/input | partial | `(none)` = wall clock | services/gcsp-api/src/main/java/gcsp/api/planning/PlanningClock.java:10 | RunPlanningClock is not on this branch; docs/gcsp/dispatcher-learnings.md:1354 records its wiring as held. |
| ArtifactStore (learned model artifacts) | read/input | local-bound | `gcsp.learning.artifact-dir` = empty (classpath) | services/gcsp-api/src/main/java/gcsp/api/learning/ArtifactStore.java:6 | Always bound at startup to retained artifacts. |
| LearningOutcomeRows | read/input | default-unconfigured | `(none)` = bound()=false | services/gcsp-api/src/main/java/gcsp/api/learning/LearningOutcomeRows.java:12 | No outcome producer exists; LearningRecordService has no consumer in main. |
| DemandPolicyPort / UnmetEvaluationPort / OfferRecordsPort / Allocation | read/input | partial | `(none)` = refusals | services/gcsp-api/src/main/java/gcsp/api/demand/DemandPolicyPort.java:8 | Policy port bound through PolicyDemandAdapter; evaluation, offers and allocation records unbound. |
| PlanningDemand | read/input | default-unconfigured | `(none)` = planning-forecast-not-config | services/gcsp-api/src/main/java/gcsp/api/planning/PlanningDemand.java:10 | No PostgresPlanningDemand class on this branch; FUCQ-477 commit 76837ffe8 is not an ancestor of HEAD (git merge-base --is-ancestor), per docs/gcsp/fucq477-planning-demand-2026-11-17.md:42-57 |
| PlanningSupply | read/input | default-unconfigured | `(none)` = planning-supply-not-configur | services/gcsp-api/src/main/java/gcsp/api/planning/PlanningSupply.java:10 | No PostgresPlanningSupply class on this branch. |
| Persistence gate (datasource and Flyway activation) | read/input | unverified-runtime | `GCSP_DATABASE_URL (+ gcsp.persistence.* in pro` = off | services/gcsp-api/src/main/java/gcsp/api/persistence/Persistence.java:15 | Selected native PostgreSQL component evidence is retained in docs/gcsp/fucq477-planning-demand-2026-11-17.md:52-59; original connected provider-composition and full AC2 journey remain unproved. |
| Scenario DemoPreparation (seeding of account tables) | read/input | partial | `gcsp.scenario.provider` = none | services/gcsp-api/src/main/java/gcsp/api/scenario/DemoPreparation.java:125 | Direct seeding does not go through the provider ports; worker B owns scenario in detail. |
| ManualSelectionPort | action/event | partial | `(none)` = ManualSelection over stock:: | services/gcsp-api/src/main/java/gcsp/api/claims/ManualSelectionPort.java:7 | Real implementation exists but only produces results when persistence (GCSP_DATABASE_URL) and an account provider supply stock; otherwise answers not-configured. |
| ClaimStockPort | action/event | partial | `gcsp.claims.stock.provider` = local; remote selectable | services/gcsp-api/src/main/java/gcsp/api/remote/RemoteOperationProviders.java:69 | HttpClaimStock and local default are startup-selected; retained transport/startup/consumer passes exist. Full claim producer and journey remain open. |
| ClaimTimingPort | action/event | local-bound | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/claims/ClaimTimingPort.java:7 | Single local policy-backed implementation. |
| ClaimClock | action/event | partial | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/claims/ClaimClock.java:7 | Bound locally, but claim expiry timing can follow the wall clock rather than the run clock depending on which PolicyClock is bound. |
| SlotOccupancyPort | action/event | local-bound | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/claims/SlotOccupancyPort.java:8 | Single local implementation. |
| RemoteBuddy | action/event | partial | `gcsp.buddy.provider` = local-synthetic; remote selectable | services/gcsp-api/src/main/java/gcsp/api/remote/RemoteOperationProviders.java:75 | HttpRemoteBuddy is startup-selected; retained component and seeded-boundary authenticated acceptance proof exist. Full claim/offer producer and order/status remain open. |
| EligibleCandidates | action/event | partial | `gcsp.allocation.candidates.provider` = none; recommendation selectable | services/gcsp-api/src/main/java/gcsp/api/allocation/EligibleCandidates.java:8 | Real canonical candidates produce a PG claim/offer at one instant through the scripted remote. Later-clock reevaluation confirms F516; full startup-selected remote/authenticated/order-status composition remains open. Since ROOT `b220082c9` the selected recommendation reads account facts through the selected `AccountRecordsPort`; the Buddy SQL reads still run but their record is ignored. |
| OfferFacts | action/event | local-bound | `(none)` = PostgresOfferFacts when its  | services/gcsp-api/src/main/java/gcsp/api/notify/OfferFacts.java:7 | PostgresOfferFacts is an ApplicationScoped bean over local tables. |
| OfferDecision (decision route over RemoteBuddy) | action/event | partial | `gcsp.buddy.provider` = local-synthetic; remote selectable | services/gcsp-api/src/main/java/gcsp/api/offers/OffersResource.java:74 | One native JWT/JWKS/Quarkus/PG/remote acceptance and HTTP offer-state method passed. Seeded prior offer, fixed profile clock and SQL order readback limit the proof. |
| OrderingProviderPort | action/event | remote-bound (configured remote only) | `gcsp.ordering.provider` = none (refusing); none, synthetic or remote, bound through `OrderingProviderBindings` and the real Holder | services/gcsp-api/src/main/java/gcsp/api/ordering/OrderingProviderPort.java:4 | GCSP substitute only; owner order/status HTTP read authored (`209bf4f7a`), unrun; the F458 policy blocker is resolved; no BMW live mode |
| SelectionConversionPort | action/event | partial | `(none)` = UnconfiguredConversion for a | services/gcsp-api/src/main/java/gcsp/api/ordering/SelectionConversionPort.java:11 | Cart is a bean; buddy-offer is constructed inline; every other source type is unsupported. |
| DocumentProviderPort | action/event | partial | `gcsp.documents.provider` = none | services/gcsp-api/src/main/java/gcsp/api/documents/DocumentProviderPort.java:10 | none/synthetic/unsupported selectable; no live provider; case/stage reads default to unavailable. |
| DocumentCasePort / DocumentClock | action/event | partial | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/documents/DocumentCasePort.java:8; services/gcsp-api/src/main/java/gc | Clock is a real run-clock bean; case/stage port has no real binding in main. |
| AppointmentProvider | action/event | partial | `gcsp.appointments.provider` = none | services/gcsp-api/src/main/java/gcsp/api/appointments/AppointmentProvider.java:6 | none/synthetic/live selectable; `live` is a refusing stub (`appointments/AppointmentsWiring.java:28-30`). |
| OrderStagePort | action/event | default-unconfigured | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/appointments/OrderStagePort.java:6 | No real stage producer in main. |
| HandoverReadinessPort | action/event | default-unconfigured | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/appointments/HandoverReadinessPort.java:6 | No real binding in main. |
| ApprovalStatusProvider | action/event | partial | `gcsp.approvals.provider` = none | services/gcsp-api/src/main/java/gcsp/api/approvals/ApprovalStatusProvider.java:7 | none/synthetic/live-stub selectable; live refuses. |
| OrderSourcePort (approvals) | action/event | local-bound | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/approvals/OrderSourcePort.java:9 | Bound to ordering selections. |
| HandoverPort (approvals) | action/event | default-unconfigured | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/approvals/HandoverPort.java:7 | Only no-op default. |
| ReturnProviderPort | action/event | partial | `gcsp.returns.provider` = none | services/gcsp-api/src/main/java/gcsp/api/returns/ReturnProviderPort.java:12 | none/synthetic/live-stub selectable; the name is checked at startup, and synthetic without a database yields Unconfigured on first use (ReturnSelection.java:104-111). |
| ReturnSourcePort | action/event | default-unconfigured | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/returns/ReturnSourcePort.java:6 | Only default; no real binding. |
| HandoverPort (returns) | action/event | default-unconfigured | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/returns/HandoverPort.java:6 | Only default; no real binding. |
| CaseNotificationPort | action/event | local-bound | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/cases/CaseNotificationPort.java:7 | Local outbox emission. |
| CaseCarSuitabilityPort | action/event | default-unconfigured | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/cases/CaseCarSuitabilityPort.java:7 | Only no-op default. |
| MailTransport | action/event | partial | `gcsp.mail.transport` = unset = captured | services/gcsp-api/src/main/java/gcsp/api/notify/MailTransport.java:6 | Captured default is local; Brevo is the only real outbound HTTP in main, but inbox delivery is unverified (docs/gcsp/employee-delivery-email-2026-11-11.md:118,130). |
| ProductionProviderPort | action/event | partial | `gcsp.production.provider` = none | services/gcsp-api/src/main/java/gcsp/api/production/ProductionProviderPort.java:10 | none/synthetic/live-stub selectable; the name is checked at startup, and synthetic without a database yields Unconfigured on first use (ProductionSelection.java:47-55). |
| PlanSnapshotPort | action/event | default-unconfigured | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/production/PlanSnapshotPort.java:9 | Only default in main. |
| SupplyQueuePort | action/event | local-bound | `(none)` = StockReleaseSupplyQueue when | services/gcsp-api/src/main/java/gcsp/api/production/SupplyQueuePort.java:7 | Real local implementation constructed with the service. |
| ProductionClock | action/event | local-bound | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/production/ProductionClock.java:8 | Bound to ticks. |
| GregOrderPlan submit action | action/event | default-unconfigured | `(none)` = not applicable | services/gcsp-api/src/main/java/gcsp/api/planning/GregOrderPlanResource.java:29 | No submit action exists; preview and read only. |
| ComparisonReplay | action/event | default-unconfigured | `gcsp.comparison.reruns` = false (only true or 1 enable | services/gcsp-api/src/main/java/gcsp/api/comparison/ComparisonReplay.java:7 | Only unavailable replay in main; retained result files are served locally. |
| ScenarioProvider (demo preparation) | action/event | partial | `gcsp.scenario.provider` = none | services/gcsp-api/src/main/java/gcsp/api/scenario/ScenarioProvider.java:4 | Only the mechanics scenario gcsp-clock-scenario-v1 is available; ScenarioCatalogue.java:47 marks journeys unavailable via requiredCapabilities (json :1423). |
| ScenarioFaults | action/event | partial | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/scenario/ScenarioFaults.java:24 | Only the stock adapter fault is injectable. |
| Presenter clock and controls | action/event | partial | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/presenter/PresenterClockResource.java | Handlers exist for eight stages; manual-expiry, buddy-expiry and buddy-allocation have none. |
| Outbox and command receipts | action/event | local-bound | `(none)` = default bean | services/gcsp-api/src/main/java/gcsp/api/persistence/Tx.java:78 | Postgres-backed and local; inert without persistence. |

## Defect candidates (capture-only, for the parent)
These are listed with file:line in the JSON under `defectCandidates`. They have not been triaged, filed or repaired. Bugs FUCQ-513 to 515 are unchanged.

- **The account policy always refuses.** Resolved in source at ROOT `3542ff697`.
- **The current-car port** reports empty as success. Now only without persistence.
- **`PolicyReleaseAdapter`** has no injection site.
- **Synthetic returns or production** without a database quietly falls back to unconfigured.
- **Wall-clock reads bypass the run clock** in comparison jobs, the case service holder and the policy clock.
- **The ordering contract** names a live mode that does not exist.
- **Only the stock fault** is injectable.
- **The allocation seam** has no stage handlers.
- **Retryability** depends on a `not-configured` string suffix.
- **Account records** are read by direct SQL outside the account port.

## What this does not prove
- The initial three-record reconciliation ran no new runtime. The latest two-record candidate reconciliation records 13 matching focused passes, independent review and confirmed capture-only F516; it establishes no full connected provider-composition, browser/hosted OIDC, actual email delivery, hosted deployment or BMW proof. Retained selected native PostgreSQL component evidence exists, including the F477 helper run (docs/gcsp/fucq477-planning-demand-2026-11-17.md:52-59).
- PostgreSQL-backed tests skip without `GCSP_TEST_DATABASE_URL`.
- Unchanged records retain their earlier observations. The three remote-provider records and two candidate records distinguish matching retained execution from test-source references. Selected component and seeded-boundary composition passes do not prove the complete connected journey.
- Several records group contracts or overlap across domains. The parent sampled source facts and corrected blueprint/evidence statements; not every semantic claim was independently reverified.

The candidate increment was tested at `37b2d964d` (12 passes and one test assertion failure). The assertion compared in-memory Jackson numeric node classes with JSONB readback; the corrected test uses the existing canonical JSON boundary without changing values. Only the affected method reran at `71a219f28` and passed. Independent source review passed; integrated API source at `97cd67aa4` equals the corrected tested source. Both attempts have independently verified process, scratch and reservation teardown. The passing later-clock characterization records the defect and does not prove recovery. No screen or full connected acceptance evidence is added.

## Generated claim to authenticated decision — 17 November 2026, 07:50 UTC

One native method in `GeneratedClaimRemoteOfferHttpTest` passed at `4e823b7c5`, integrated and pushed as `4c7f6d338`. The profile selects real canonical candidates, repository account data and remote Buddy. Its resource seeds only six source tables; twelve generated-output tables are checked empty before injected Allocation runs. The test traces the resulting claim, hold, quote and offer through real owner JWT/JWKS HTTP acceptance, accepted/allocated HTTP offer state, durable selection source-claim lineage and all eight canonical quote fields. No generated offer or decision is seeded.

Independent source review passed. The finite run executed exactly one case with zero failures/errors/skips in 23.7 seconds. Parent independently verified 70 recorded process identities and 7 groups absent, scratch removed, reservation clear and pinned inputs unchanged; the integrated API tree equals tested source. Retained 65 adapter/startup, 10 consumer, 3 shape, 1 seeded-boundary JWT and 13 canonical cases were reused without rerun.

This is a fixed same-instant composition proof. Full `GET /api/gcsp/v1/manual/order` still reaches the refusing AccountSelection policy; no browser, hosted OIDC, actual email, BMW or later-clock recovery is proved. FUCQ-516 remains capture-only and unrepaired. Both original acceptance criteria remain open. The four JSON port records above now include this evidence; older paragraphs and other records retain their own observations.

## Standalone remote ordering adapter — 17 November 2026, 08:21 UTC

Reviewed source `45d1c1afc05858c6f2d123d1958dd86ed625214a` is integrated and pushed as `09e22458483497c23d74a6588d43a140805b0d4e`. The exact two Java blobs implement the unchanged ordering port and13focused real-loopback tests; the integrated API tree equals tested source. All13cases passed with zero failures, errors or skips in17.0seconds. Independent source review passed. Parent independently verified39recorded process identities and three groups absent, owned scratch removed, host reservation released and tool/source pins unchanged; no PostgreSQL was started. See [the mapping and validation note](fucq481-remote-ordering-adapter-2026-11-17.md).

The adapter preserves all request/scope facts, the persisted idempotency key, GET-only identity reconciliation and complete truthful acknowledgements. Shared transport remains unchanged because its generic reply omits ordering facts and unsupported status. This is an **unbound GCSP substitute**: existing holder/selector/configuration and peer-owned core were unchanged. Startup selection, actual durable consumer/full order-status HTTP, BMW access and both original criteria remain open. Only the OrderingProviderPort JSON record changed;59record identities, all58other rows and existing count/status facts are preserved. Earlier paragraphs retain their own observations.

## Startup selection and unique-port census, 17 November 2026

Published at `fc244cc06` (11:28 UTC). It was first headed 11:40 UTC, which was later than its own return; corrected at 11:55 UTC after review 30.

The ordering row above is reconciled to the integrated startup selection (`3e0235593`, then `23eca515d`). Its earlier text is kept in the JSON `reconciliationHistory`. It is `remote-bound` only when `gcsp.ordering.provider=remote` is configured. The default is still `none`, and the committed dev deployment selects `synthetic` (`render.gcsp.yaml:237-238`).

The retained native evidence for ordering is: 13 adapter methods, 1 durable consumer method, 8 binding methods, 11 startup methods (the 8 overlap) and 1 generated-claim JWT to selected-remote acknowledgement. These prove connected partial boundaries, not a whole acceptance criterion.

### Unique-port census, corrected 11:55 UTC

The JSON `uniquePortCensus` counts **declarations**. It covers every `public interface`, top-level or nested, in `services/gcsp-api/src/main/java` at API tree `55023060`. There are 123 declarations with 121 distinct simple names, because `CurrentCarPort` and `HandoverPort` are each declared in two packages.

| Class | Declarations |
|---|---|
| External provider contracts (startup-selected or produced) | 34 |
| Clock inputs | 10 |
| Internal service, projection or repository seams | 38 |
| Sealed results and helper callbacks | 41 |
| Unknown | 0 |
| **Total** | **123** |

- **Grouping.** The JSON lists the 34 external declarations as 30 grouped entries. `VehicleProvider` with `VehicleLookupPort`, and `PlanningDemand` with `PlanningSupply`, each join two names. `CurrentCarPort` and `HandoverPort` each join two same-named declarations.
- **The correction.** Assignment 22 reported 121 declarations, 118 names and 39 internal seams. It also listed `AccountClockPort` as both a clock and an internal seam. The overlap is removed.
- **Reproducible.** `declarationList` maps each of the 123 by file, line and qualified name to exactly one class. `excludedInterfaces` lists the 50 other interface declarations: 22 implicitly public members of a counted interface, and 28 package-private helpers inside classes.
- **Judgement.** Which class a name belongs to is source judgement under the stated rules. The disputed cases are `BriefAccountPort`/`BriefPolicyPort` and `OfferFacts`.
- **Selection coverage.** Six external contracts have only a refusing implementation and no startup key, so there is nothing to select: `OrderStagePort`, `HandoverReadinessPort`, `HandoverPort` (both), `ReturnSourcePort`, `PlanSnapshotPort` and `CaseCarSuitabilityPort`.

The 59 legacy rows are kept with their identities. Some group or duplicate contracts, and some are composition boundaries rather than interfaces. This is a source census, not a runtime proof.

Demo preparation is traced again in `reconciliation.demoPreparation.currentTrace`. It constructs no provider and writes source tables only. Buddy prepare and the Buddy remote lifecycle still read `employee_account_records` outside `gcsp.account.provider`. The manual-draft read is a conditional version guard behind the selected account projection, not a bypass. See `docs/gcsp/fucq481-provider-composition-handover-2026-11-17.md`.

## Current composition, 17 November 2026, 12:32 UTC

Reconciled against ROOT `b220082c9` (API tree `3213b1af`). The earlier findings above are kept as they were observed; JSON rows keep their prior text in `currentCorrections`.

| What | Current source | Evidence class |
|---|---|---|
| `AccountPolicyPort` | `PolicyAccountAdapter` over `PolicyService` (`3542ff697`) | Delivered code; F458 tests peer-reported, not rerun here |
| `CurrentCarPort` (account) | Returns store with persistence; empty list without | Delivered code; peer-reported |
| Brief account facts | Bean over the injected `AccountService`, so on the bound policy | Delivered code; no brief run here |
| `EligibleCandidates` | Selected `AccountRecordsPort` through `SelectedAccountCandidates` (`b220082c9`) | Delivered code; 10 matching parent passes, review 32 |
| Owner `GET /manual/order` | Authored in the generated ordering test (`209bf4f7a`) | Unrun, under parent review |

Still open:

- Buddy prepare and lifecycle SQL reads still run.
- Synthetic returns and production still downgrade quietly without persistence.
- Six contracts are refusing-only.
- Not proved: real OIDC, mail, the hosted environment, BMW, shaped inputs across all ports, and FUCQ-516.
- Both original criteria remain open.
