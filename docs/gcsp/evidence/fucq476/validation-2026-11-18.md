# FUCQ-476 resumed validation — 18 November 2026

Status: **partial**. The resumed increment supplies real Java planning advice and persisted new-run learning provenance. Original AC1 still needs learned-success evidence through the real planning HTTP composition and rendered experience; the live PlanningDemand/PlanningSupply/PlanningClock bindings remain held under FUCQ-477 / M1 / FUCQ-515. FUCQ-476 remains open. No deployment, hold release, default model activation or acceptance transition is claimed.

## Implemented and reviewed

- `LearnedPredictionInput`, `LearnedPlanForecast` and `LearnedPlanView` follow the retained Node input/plan-forecast/operations contracts. The two allocated planning callers use the actual artifact-backed Java inference. Preview scores the disposable draft policy, pins baseline clock/supply versions and retains fallback/unavailable reasons. Uncertainty, artifact identity and synthetic evaluation limits are carried through; advisory results remain `recommended:false` and `submittable:false`.
- Production `PostgresLearningOutcomeRows` reads actual Buddy offers/quotes, custody holds, immutable final decisions and expiry event payloads using five environment/run-scoped set reads in the caller's repeatable-read snapshot. Local atomic quote time supplies exposure; remote-claim attribution is distinguished from Java local operation IDs. Saved terms and version fields are mapped without recomputing historical policy. Unknown choice sets/satisfaction and unsupported historical facts remain unknown.
- `RunLearningClock` reads `run_clocks.clock_instant` / version in the same snapshot. Missing run clock stays unavailable; wall time is never invented. The preliminary clock is rechecked before the decline registry is selected.
- A current `offer-selection` intent is joined by environment, run, current operation and hold before its saved `payload.decidedAt` supplies selection-pending time. It never turns a pending operation into a final acceptance or selection.

## Evidence and limits

`LearningCaptureHttpTest` uses the real Quarkus composition, signed OIDC/JWKS tokens and native PostgreSQL17. An actual presenter allocation creates offers; Bruno declines and Paula accepts through their own public HTTP commands. The injected production learning service then proves saved exposure, terms, decision/selection time, actual advanced run-clock projection, run isolation, Greg authorization and no revision writes. No enabled alternatives, learning probe route or Node business execution is used. This is composed local-producer AC2 evidence, not a live provider-completion or hosted Render claim.

The remote pending-intent mapping is additionally covered by an explicitly synthetic transaction-rollback fixture over the actual persisted payload shape. It is separate from the HTTP producer proof. Remote provider completion, actual expiry capture and every possible historical source variant are not asserted by that fixture; existing exact projection/parity tests cover their retained contract shapes.

Ten new planning tests cover real learned advice, baseline fallback, malformed sources, draft policy pinning, waits, demand/supply drift, provider exceptions, infeasible comparisons and outside-coverage identity. The 13-case Node input oracle covers null/missing facts, period offsets/month boundaries, bad briefs/duplicate choices and unavailable terms. `requiredBy:null` first reproduced the exact reason mismatch (`prediction-input-unavailable` versus `prediction-input-invalid`), then passed after null coalescing was corrected. Existing 187 forecast/model and 240 record validator/projection reference cases replay in Java; documented numeric bounds remain absolute 1e-12 / relative 1e-9 with outcome preservation. Java tests never invoke Node.

The offline oracle generator initially failed because this worktree has no `server/node_modules/pg`. A bounded retry resolved only `pg` from the shared checkout's existing dependency tree through Node's resolution hook; all oracle business imports remained in this story worktree. No package installation, copied dependencies or symlink was created. The retained fixture is 166,271 bytes.

## Scoped validation

Base: `71fb69e52bd1f3dbdf955ae005046839d438aa1a`; pushed code commit: `aa99f1a91fd8931f0850dfb96443a14fa68ea7d9`; final code/test/fixture identity: `3de08861711b5fa1c5e95a0497843735f46dd862b8ffc04da29924cd79eaf5c1`. Per-file hashes and reviewed impact edges are retained in the local impact receipt named below.

Run once on the final broad candidate:

```sh
./mvnw -B test -Dtest='gcsp.api.learning.**,gcsp.api.planning.**,gcsp.api.DefaultProfileTest,gcsp.api.OidcContextTest,gcsp.api.OidcIdentityTest,gcsp.api.IdentitySelectionTest,gcsp.api.persistence.PersistenceWiringTest,gcsp.api.persistence.NotConfiguredReadinessTest,gcsp.api.claims.ClaimWiringTest,gcsp.api.notify.NotificationDrainWiringTest,gcsp.api.appointments.AppointmentsWiringTest,gcsp.api.ordering.RemoteOrderingStartupTest'
```

Result: **203 tests, 0 failures, 0 errors, 0 skipped**, 39.39 seconds. A later adapter-only provenance correction changed `PostgresLearningOutcomeRows` and its learning test; `./mvnw -B test -Dtest='gcsp.api.learning.**'` then passed **33 tests, 0 failures, 0 errors, 0 skipped** in 22.41 seconds. All planning and startup/wiring source hashes are unchanged from the 203-test run. These matching scoped results cover the final code; no redundant full rerun was performed.

The earlier pending fixture attempt failed the real terminal-hold state guard because it was placed after acceptance. The fixture was moved before the employee decision, where it rolls back, and then reproduced the intended missing timestamp assertion before the adapter was fixed. Binding RED and unavailable-skeleton RED runs, the fixture mistake, expected parity/timestamp RED runs and their final green results are all retained explicitly; none is reported as a passing acceptance run.

Both edited packages and direct planning callers are selected. No migration, new startup thread, CDI producer, shared application configuration, dependency/build or shared test profile/support class was changed. **Full suite: deferred to batch**; no green covering batch or final Story acceptance is claimed. Angular/hosted/live-provider suites were excluded because their live planning inputs remain held. No UI file changed. Required reachable learned-success visual critique at desktop/narrow widths remains incomplete with AC1, rather than being declared unnecessary or done.

Data strategy: specified Java/PostgreSQL; `<scaffolding>/plugin/skills/design-with-drawio/data-design.md`, `docs/gcsp/build-rules.md`, the existing learned contracts and producer schemas. No persistence schema choice changes. Adapter cost on the two-offer/two-decision composed fixture: **5 reads, 1.249 ms**; native EXPLAIN execution times for offers/holds/decisions/quotes/expiry were 0.016 / 0.011 / 0.022 / 0.056 / 0.004 ms, each one loop, root rows 2/2/2/2/0. This is a small synthetic cost observation, not a scale guarantee or a substitute for the earlier 2,000-brief evidence. Per-test measured coverage instrumentation is unavailable in the selected harness; the impact map records reviewed ownership/fixture edges and observed execution without inventing coverage contexts.

## Resource and cleanup receipt

Each chunk used one native PostgreSQL17 with two throwaway databases and one Maven/Quarkus worker, HostBudget reservation, owned Java lock and the registered supervisor finalizer. Owned root: `/private/tmp/vm-poller-20261117-sulley-476`. Expected caps: 600 seconds, 1536 MiB scratch and 2304 MiB inclusive process RSS. Maximum measured scratch **189,781,504 bytes**, inclusive RSS **1,984,462,848 bytes**. Sum of per-chunk removed peak allocations: **647,945,600 bytes** (not simultaneous occupancy). Every allocated chunk stopped/joined owned processes, stopped PostgreSQL, verified scratch removal, removed its own lock and released its reservation; all cleanup issue arrays are empty. One attempted clock chunk did not allocate because a peer owned the Java lane.

The bounded native database and Maven working data use the documented local compatibility exception. Pre-existing Maven `target` working data is preserved in this active worktree and is not counted as reclaimed scratch. Retained local summaries/logs/receipts: `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources`. No archives or large copied inputs were produced. No OneDrive location was accessed, including existence or cleanup checks. No disposable scratch remains owned by this run.

Agents: Sulley (lead) and Goopy Geer (implementer), requested/selected/runtime-confirmed `gpt-6.1-sol/high`, explicit user override; no fallback. Goopy's independent implementation review and the lead's contract/source/test review found and corrected the null and saved-intent timestamp issues. Goopy has returned; observed worker claims expire at handoff. No question, Jira transition, merge or follow-on task was created by this lead.

Work-map reconciliation: latest peer map facts were read from shared commit `45fb18586` and only the observed FUCQ-476 row reapplied through `_tools/product_map.py`. Peer claims/statuses were preserved; observed FUCQ-476 claims expired at handoff.
