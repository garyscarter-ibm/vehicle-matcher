# FUCQ-476 resumed implementation plan

Original Story: `_dev/in-progress/DEV-2026-11-13-044.md`. Frozen implemented baseline: `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`; resumed code base: `71fb69e52bd1`. Prior merged artifact/parity work remains evidence, not completion of the reopened criteria.

The original criteria require Java artifact/version/forecast/uncertainty parity without Node business execution, and actual new-run learning exposure/outcome provenance with explicit historical and synthetic limits. The data strategy is specified Java/PostgreSQL, using existing authoritative policy/artifact and producer records. No schema, policy, provider mode or storage choice changes are planned.

## Remaining slices

- Preserve existing slice IDs `s1-inference`, `s2-records`, `s2b-source` and `s3-integration`. Add `s2c-producers` to make the already-existing source gap explicit. Integration now means the scoped Story test set and honest original-AC accounting; full suites belong to the covering batch.
- Bind `LearningOutcomeRows` to existing persisted Buddy offers/quotes, custody holds, immutable offer decisions and actual relevant event facts. Retain original demo-clock timestamps; storage `created_at`/`updated_at` never supplies exposure or decision time. Read the environment/run-scoped rows using the service's single read-only repeatable-read connection.
- Read `run_clocks.clock_instant` and `clock_version` through `RunLearningClock`, in that same snapshot. Missing clock means unavailable; never silently substitute wall time.
- Exercise real presenter/Buddy/employee HTTP operations with signed OIDC test JWT/JWKS and native PostgreSQL17, then read the injected production learning service. No acceptance path replaces production beans with alternatives. Existing raw-row parity remains separate from this composed producer proof.
- Connect the existing learned-view boundary only within the exact separately allocated planning files. Preserve the six-route contract, model identity, explicit synthetic evaluation limits, non-submittable learned advice and truthful fallback/refusal. PlanningDemand/Supply/Clock live bindings remain under M1/FUCQ-515 hold.

## Source trace and mapping constraints

`LearningRecordService` and `LearnedDemandForecastPort` have no callers outside learning in the resumed main-source tree. `GregOrderPlanResource` constructs `OrderPlanOperations`, whose `readPlan` and `previewPlan` currently always call `learnedUnavailable()`; its comment assigns that boundary to FUCQ-476. Node's `predict/plan/operations.js:learnedFor`, `predict/forecast/plan-forecast.js` and `predict/forecast/input.js` define the replacement view, narrowing and feature contracts.

Producer differences needing explicit translation:

- Java `offer_decisions.versions.briefVersion` is Node `versions.brief`; preserve other version fields.
- Java Buddy local and remote holds both have an operation id. Node treats its hold operation id as a remote-claim marker, so determine remote provenance from the actual `buddy_operations` record before projecting that marker. Otherwise the local quote/offer atomic exposure timestamp is incorrectly lost.
- Saved Buddy quote `terms` and scalar pinned columns govern historical points/allowance/configuration/time. Never recompute historical terms from active policy or fill unknown data from current employee records.
- Offer decisions store the successful business value rather than the Node status envelope. Preserve actual final versus pending state from the actual producer tables; pending operations never become accepted by inference.
- Current remote selection-pending time comes from the saved immutable decision-intent payload, joined to the current hold operation in the same environment/run; this stays pending and never infers final acceptance.
- Unrecorded historical choice sets, satisfaction and wait outcomes remain unknown. Synthetic training/evaluation labels remain explicit. A learning projection is derived read-only evidence; it creates no new product command or route.

## Validation selection and resources

Start with the new source/clock regression classes, then run `./mvnw -B test -Dtest='gcsp.api.learning.**,gcsp.api.planning.**,gcsp.api.DefaultProfileTest,gcsp.api.OidcContextTest,gcsp.api.OidcIdentityTest,gcsp.api.IdentitySelectionTest,gcsp.api.persistence.PersistenceWiringTest,gcsp.api.persistence.NotConfiguredReadinessTest,gcsp.api.claims.ClaimWiringTest,gcsp.api.notify.NotificationDrainWiringTest,gcsp.api.appointments.AppointmentsWiringTest,gcsp.api.ordering.RemoteOrderingStartupTest'`. Both edited packages are selected; these include the direct planning callers and their route/contract regressions. Inspect retained Node parity scripts and compare their unchanged fixtures; production Java never invokes Node.

The explicit scoped selector dry plan was inspected at resumed base. No full-suite fallback is authorized. No Flyway migration, startup thread, CDI producer, shared application configuration, dependency/build or shared test harness change is planned. **Full suite: deferred to batch.** Exclude unrelated retail/UI packages because this increment changes learning records and the existing backend learned projection only; reassess rendered evidence if the reachable UI behavior changes.

Supervisor: `.claude/poller/run-20261117-2335/resources/sulley476-supervisor.py` in the shared checkout; ownership manifest alongside it. Owned root `/private/tmp/vm-poller-20261117-sulley-476`, one native PostgreSQL17 plus one Maven worker, at most 1536MiB scratch/2304MiB inclusive process RAM and 600 seconds per chunk. Use actual machine-wide HostBudget and atomically owned `/tmp/vm-poller-java-verify.lock`; preserve 5GiB disk reserve. Propagate TMPDIR/TMP/TEMP. Finalizer stops and joins owned processes, stops PostgreSQL, removes and verifies the owned root and lock, releases reservation and retains bounded logs/receipt outside scratch. No OneDrive access, including existence or cleanup checks.

## Delivery facts

Sulley title verified through desktop tool. Requested/selected lead model is `gpt-6.1-sol/high`; no fallback. User's explicit High override applies to implementers as well. Root independently verified the effective lead/implementer turn contexts as Sol/high on 18 November; no fallback. Initially root, Hugh, Daffy Duck and Sulley occupied all four tool slots, so source/contract refinement proceeded without spawning a duplicate worker. All collaborator authority, current Jira-write policy, held boundaries and claimed scope in `AGENTS.md` remain binding.
