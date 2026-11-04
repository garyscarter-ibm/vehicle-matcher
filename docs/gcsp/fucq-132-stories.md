# FUCQ-132 · The 1,000-employee comparison stories

**Published and verified on 4 November 2026.** Readiness item C8: one Epic, [FUCQ-132](https://ibm-consulting.atlassian.net/browse/FUCQ-132) "Compare today's release route with the buddy route over 1,000 fictional employees", with six native Stories, FUCQ-133 to FUCQ-138. They build on the foundation, [FUCQ-79](fucq-79-stories.md), and on the critical path, [FUCQ-86 to 90](fucq-86-90-stories.md).
- The Epic is In Progress, with Start date 2026-11-04.
- The Stories are To Do and unassigned, at High (P2, `due 2026-11-12: GCSP demo`). No Story Points were authored.
- 17 native Blocks links record the dependencies. [Publication verification](evidence/fucq-132/story-publication.json) records the read-back.

**Design first.** The readiness review found the HLD thin here. Gary agreed the design on 4 November 2026, under the equal-authority rule (`AGENTS.md`): the HLD section "[The 1,000-employee comparison](../design/gcsp-high-level-design.md#the-1000-employee-comparison)" and diagram page **09 1,000-employee comparison**. Page 05's simulation node now points to page 09.
- **Where it runs:** a comparison module in the GCSP Node backend, started by the presenter in a worker thread, with a command-line twin. Each simulated run is isolated, with an in-memory repository, a simulated clock and the captured outbox.
- **What it reuses:** FUCQ-29's employee policy (once per seed, for both routes); FUCQ-96, 100 and 106 for the buddy route; FUCQ-66's cart claims for today's route; FUCQ-82 for every assumption.
- **Seeds and outputs:** a seeded generator built from `comparison.*` keys; per route, the mean and range across seeds of coverage before renewal, unused stock, declines, expiries and retries. Results are stored once, unchangeable, with their input manifest.
- **How it is shown:** a route comparison panel on Greg's dashboard (FUCQ-101), with assumptions and a buddy hold-duration rerun.

Gary approved the Epic, the Story titles, their one-line outcomes and the dependency order on 4 November 2026. He also decided that FUCQ-133 does not depend on FUCQ-78. Source of the scope: [handover C7 to C9](../design/handover-section-c7-c9-2026-11-04.md), section C8, and [HLD story readiness](../design/hld-story-readiness-2026-11-04.md), item C8. Template: [_dev/story-template.md](../../_dev/story-template.md). FUCQ-138 names its kit components from [COMPONENTS.md](../../COMPONENTS.md). Only stories were authored: no implementation, poller, provisioning or deployment was started.

| Story | Outcome | Kind, size | Depends on |
|---|---|---|---|
| [FUCQ-133](https://ibm-consulting.atlassian.net/browse/FUCQ-133) | Generate seeded employees, stock and releases from PolicyService keys | code, M | FUCQ-80, 82 |
| [FUCQ-134](https://ibm-consulting.atlassian.net/browse/FUCQ-134) | Replay today's first-come-first-served release for a seeded cohort in an isolated run | code, L | FUCQ-133, 29, 66, 81, 85 |
| [FUCQ-135](https://ibm-consulting.atlassian.net/browse/FUCQ-135) | Replay the buddy route for the same cohort through allocation, holds and decisions | code, L | FUCQ-134, 93, 96, 100, 106 |
| [FUCQ-136](https://ibm-consulting.atlassian.net/browse/FUCQ-136) | Measure both routes across seeds and store an unchangeable comparison result | code, M | FUCQ-135 |
| [FUCQ-137](https://ibm-consulting.atlassian.net/browse/FUCQ-137) | Run comparison jobs in a worker, presenter-only, with a command-line twin | code, M | FUCQ-136, 84 |
| [FUCQ-138](https://ibm-consulting.atlassian.net/browse/FUCQ-138) | Show the route comparison panel on Greg's dashboard with assumptions and a hold rerun | ui, L | FUCQ-137, 101 |

**Build order:** FUCQ-133, then FUCQ-134, 135, 136 and 137 in turn, then FUCQ-138. FUCQ-133 can start once FUCQ-80 and FUCQ-82 are done. FUCQ-138 also waits for Greg's dashboard, FUCQ-101.

**Shared decisions.** Every Story's Decided section cites:
- `docs/gcsp/README.md`, `demo-brief.md` ("Compare 1,000 fictional employees"), `build-rules.md` and `experience-quality.md`;
- `docs/gcsp/shared-contracts.md` (FUCQ-80);
- the foundation's ownership of the repository, PolicyService, identity and clock;
- the HLD section and diagram page 09, and the HLD review decisions each Story relies on.

The comparison must be able to show a benefit, a trade-off or no improvement. Calculated fit is not observed satisfaction.

**Still open, not part of this set:** the PNG export for page 09 has not been made. The sibling readiness items are published separately: C7 as [FUCQ-110](https://ibm-consulting.atlassian.net/browse/FUCQ-110), and C9 as Stories under FUCQ-74 and FUCQ-75.

The Story bodies below are the Jira descriptions as read back, with `id` and `title` added to each header. The only other changes are the bullet marker, escaped checkboxes and heading levels, which are normalised.

---

## [FUCQ-132](https://ibm-consulting.atlassian.net/browse/FUCQ-132) · Compare today's release route with the buddy route over 1,000 fictional employees

---

### [FUCQ-133](https://ibm-consulting.atlassian.net/browse/FUCQ-133) · Generate seeded employees, stock and releases from PolicyService keys

```text
id: FUCQ-133
title: Generate seeded employees, stock and releases from PolicyService keys
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-132, 1,000-employee comparison from HLD readiness item C8)
epic: FUCQ-132
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-80, FUCQ-82
```

#### Goal

As the presenter, I want a reproducible synthetic cohort, stock and release schedule built from declared assumptions, so that both routes in the comparison start from identical inputs that anyone can inspect.

#### Acceptance criteria

- [ ] **Pure, seeded generator:** `generateComparisonInputs(seed, policy)` returns the employees, the stock and the release schedule for one seed. The same seed, policy version and generator version give identical output; a different seed gives different output. It reads no clock, network or global random source.
- [ ] **Employees:** the cohort size comes from a PolicyService key (default 1,000). Each employee has:

    - a fictional ID, with no real names, contact details or licence data;
    - a grade and points allowance drawn from keyed grade distributions;
    - a renewal date inside the keyed horizon;
    - underlying needs: essentials, and preference values each with its importance weight;
    - a stated brief derived from those needs, with keyed brief-accuracy noise;
    - an access group, with keyed access-time and response-time distributions;
    - buddy participation, drawn from the keyed uptake rate.

- [ ] **Stock and releases:** cars per employee, the model-line mix and the release cadence come from keys. Each car carries a synthetic `orderUuid` and a target-format `configurationId` (Q13). Configurations come through the vehicle corpus read port, or a reviewed fixture configuration set until the corpus is published. Nothing is written to the live run's stock.
- [ ] **Keys, not literals:** every value above is a `comparison.*` key in FUCQ-82's seed, with value, unit, `assumed` status, a short basis, and source and date (build rules). The key list is recorded in `docs/gcsp/shared-contracts.md`. The generator holds no defaults of its own.
- [ ] **What-if overlay:** the generator accepts an explicit alternative-policy overlay (for example a different order mix or points). An overlay is never published to PolicyService, and the output records it.
- [ ] **Manifest:** each output carries the seed, policy version, overlay hash and generator version. The default seed list is a key (`comparison.seeds`).

#### Files or areas

- `server/gcsp/comparison/generator.js (proposed)`
- `server/gcsp/policy/ (seed: add the comparison.* keys)`
- `server/test/gcsp-comparison-generator.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (comparison key list and input shapes)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026, with the design agreed the same day (`docs/design/hld-story-readiness-2026-11-04.md`, item C8; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md` ("Compare 1,000 fictional employees"), `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`, "The 1,000-employee comparison", plus diagram page 09. Carry these decisions and acceptance criteria into every child-agent brief.

The synthetic employees are generated from PolicyService keys, never hard-coded. The assumptions are plausible and labelled; they model the dated research, not BMW's real cohort. Gary decided on 4 November that this story does not depend on FUCQ-78: it reads configurations, not FUCQ-78's generated scheme stock.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q6: policy is dated tables seeded from a reviewed repo file and read through one PolicyService.
- Q13: exact stock is keyed by a synthetic order UUID with a target-format `configurationId`.

#### Out of scope

Running either route (the other Stories in FUCQ-132); FUCQ-78's scheme stock for the live demo; real employee data.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-comparison-generator.test.js`: these pass:

    - same seed and policy give identical output;
    - a different seed gives different output;
    - the cohort size and seed list come from keys;
    - changing one seed-file key changes the output;
    - an overlay changes the output, is recorded in the manifest and is not published;
    - no personal-data fields;
    - stock identities follow Q13.

- `npm test` passes.
- Backend-only: no screen. Record the generator's output and manifest shapes in fixtures for the harness and the panel (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-134](https://ibm-consulting.atlassian.net/browse/FUCQ-134) · Replay today's first-come-first-served release for a seeded cohort in an isolated run

```text
id: FUCQ-134
title: Replay today's first-come-first-served release for a seeded cohort in an isolated run
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-132, 1,000-employee comparison from HLD readiness item C8)
epic: FUCQ-132
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-133, FUCQ-29, FUCQ-66, FUCQ-81, FUCQ-85
```

#### Goal

As the presenter, I want today's release route replayed for a whole seeded cohort, without touching the live demo, so that the comparison has a fair baseline built from the real claim rules.

#### Acceptance criteria

- [ ] **Isolated harness:** a simulation harness opens one run per (seed, route) on FUCQ-81's in-memory repository, with its own simulated FUCQ-85 clock and FUCQ-93's captured transport when that exists (a no-op recorder until then). It never reads or writes the live demo run, and sends no mail. A test proves the live run is unchanged after a comparison run.
- [ ] **Shared evaluation:** for each seed, FUCQ-29's employee policy evaluates every employee against the stock once, gates first and then explained ranking. The result is cached for the seed so the buddy route uses exactly the same candidates.
- [ ] **Today's route:** at each release, employees act in order of their modelled access time (generated by FUCQ-133). Each one makes FUCQ-66 cart claims on their best appropriate available car, with the cart-hold duration read from PolicyService (Q15). A claim conflict means a retry on the next candidate, counted as a retry. Non-participants and buddy-route employees who never act follow the keyed manual-route behaviour. A cart hold that is not taken expires and the car returns to the pool.
- [ ] **Acceptance:** an employee takes a car only when it passes their underlying essentials and gates, with calculated fit at or above `comparison.acceptableFitThreshold`. The stated brief alone never decides acceptance.
- [ ] **Recorded outcomes:** per employee: the car taken and the date, or none by renewal; claims, retries and expiries; the access group. Per car: allocated, held but not taken (with days), or unused. Every outcome carries the seed, policy version and route.
- [ ] **Deterministic:** the same seed, policy and code give identical outcomes. Any randomness is seeded from the run seed.

#### Files or areas

- `server/gcsp/comparison/harness.js (proposed)`
- `server/gcsp/comparison/routes/current.js (proposed)`
- `server/test/gcsp-comparison-current.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (outcome record shape)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026, with the design agreed the same day (`docs/design/hld-story-readiness-2026-11-04.md`, item C8; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md` ("Compare 1,000 fictional employees"), `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`, "The 1,000-employee comparison", plus diagram page 09. Carry these decisions and acceptance criteria into every child-agent brief.

The baseline is a stated model of the dated research, not a claim to reproduce BMW operations exactly. It reuses the application's own claim rules rather than a simplified copy. Calculated fit estimates satisfaction; it is not observed satisfaction.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q3: no unattended runner; the simulated clock advances only inside the run.
- Q5: the employee policy calls `rankCars()` through FUCQ-29.
- Q15: the short manual cart hold is first come first served, as on the target platform.
- Round-2 finding: releases are first come first served today.

#### Out of scope

The buddy route (the next Story in FUCQ-132); measures across seeds; the worker and the panel; changing FUCQ-66's claim behaviour.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-comparison-current.test.js`: these pass:

    - the live run is untouched and no mail is sent;
    - evaluation runs once per seed and is reused;
    - claims follow access order;
    - a conflict leads to a counted retry;
    - an untaken cart hold expires and frees the car;
    - acceptance uses underlying needs and the threshold key;
    - identical outcomes for the same seed;
    - a small cohort runs through FUCQ-66's real claim code, not a copy.

- `npm test` passes.
- Backend-only: no screen. Record the outcome record shape in fixtures for the measures Story (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-135](https://ibm-consulting.atlassian.net/browse/FUCQ-135) · Replay the buddy route for the same cohort through allocation, holds and decisions

```text
id: FUCQ-135
title: Replay the buddy route for the same cohort through allocation, holds and decisions
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-132, 1,000-employee comparison from HLD readiness item C8)
epic: FUCQ-132
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-134, FUCQ-93, FUCQ-96, FUCQ-100, FUCQ-106
```

#### Goal

As the presenter, I want the buddy route replayed for exactly the same cohort, stock and releases, using the services Paula's journey uses, so that any difference from today's route comes from the process change alone.

#### Acceptance criteria

- [ ] **Same inputs:** the buddy route runs in FUCQ-134's harness on the same seed's inputs and cached evaluation as today's route. A test proves both routes received identical cohort, stock, release schedule and policy version.
- [ ] **Real services:** at each simulated release, FUCQ-96's allocation assigns cars across consenting buddy participants by the policy tie-break. FUCQ-100 holds each car and creates its offer and outbox job, captured by FUCQ-93's transport. FUCQ-106 records each accept, decline or expiry. The route calls these services; it does not reimplement them.
- [ ] **Modelled responses:** each employee responds to an offer within their keyed response time, or the offer expires at the buddy hold duration (`hold.buddy`). They accept when the car passes their underlying essentials and gates with fit at or above `comparison.acceptableFitThreshold`; otherwise they decline with a typed reason. A decline excludes the car through FUCQ-96's rule. Expiry gives no priority.
- [ ] **Non-participants:** employees who do not take part in the buddy route use today's route for the same releases, through FUCQ-134's code, competing for the cars the buddy has not held.
- [ ] **Recorded outcomes:** the same outcome record shape as FUCQ-134, plus offers made, declines by reason and expiries, and hours held but not taken.
- [ ] **Hold-duration override:** a run can override `hold.buddy` through FUCQ-133's what-if overlay, for the hold-duration sweep. The override is recorded and never published.

#### Files or areas

- `server/gcsp/comparison/routes/buddy.js (proposed)`
- `server/test/gcsp-comparison-buddy.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (outcome record additions)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026, with the design agreed the same day (`docs/design/hld-story-readiness-2026-11-04.md`, item C8; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md` ("Compare 1,000 fictional employees"), `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`, "The 1,000-employee comparison", "Allocation and offers" and "Transaction and event invariants", plus diagram page 09. Carry these decisions and acceptance criteria into every child-agent brief.

The comparison must be able to show a benefit, a trade-off or no improvement. Nothing in this route may favour the buddy beyond the rules the demo itself uses. Captured notifications replace 1,000 outbound emails.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q11: notifications go to the captured outbox.
- Q15: the buddy offer hold is a proposed new capability with a configurable duration.
- Q16: declines carry typed reasons; no automatic recovery priority.

#### Out of scope

Measures across seeds (the next Story in FUCQ-132); the post-decline preference change (FUCQ-107), which the simulation does not model; changing the allocation, hold or decision services.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-comparison-buddy.test.js`: these pass:

    - identical inputs to today's route;
    - the route calls FUCQ-96, FUCQ-100 and FUCQ-106 (no copies);
    - notifications captured, none sent;
    - accept, decline with reason and expiry;
    - decline exclusion and no expiry priority;
    - non-participants follow today's route;
    - the hold-duration override is recorded and not published;
    - identical outcomes for the same seed.

- `npm test` passes.
- Backend-only: no screen. Record the buddy outcome shape in fixtures for the measures Story (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-136](https://ibm-consulting.atlassian.net/browse/FUCQ-136) · Measure both routes across seeds and store an unchangeable comparison result

```text
id: FUCQ-136
title: Measure both routes across seeds and store an unchangeable comparison result
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-132, 1,000-employee comparison from HLD readiness item C8)
epic: FUCQ-132
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-135
```

#### Goal

As Greg, I want the two routes' outcomes summarised across several seeds and kept as an explainable record, so that I can see what changed, by how much and how much it varies.

#### Acceptance criteria

- [ ] **Experiment runner:** `runComparison(experiment)` runs both routes for every seed in the experiment's seed list and returns one result. The experiment types are: process only (identical inputs), alternative order mix or points (an explicit overlay), and buddy hold-duration sweep (a list of `hold.buddy` values).
- [ ] **Measures per route:** for each, the mean, minimum and maximum across seeds:

    - the share of employees with an acceptable car before renewal;
    - unused stock: released cars never allocated, and car-days held but not taken;
    - declined and expired offers, and failed claims and retries;
    - mean calculated fit of accepted cars;
    - the same coverage share for each access group.

- [ ] **Honest differences:** the result reports the difference between the routes with its range, and labels it "no clear difference" when the ranges overlap (rule key `comparison.noClearDifferenceRule`). It never reports only the measures where the buddy wins.
- [ ] **Immutable result:** each result is stored once in FUCQ-81's repository, with its manifest: experiment, seeds, policy version, overlays, generator version and code revision. It is never edited; a new run makes a new result. Results are outside the live run's reset (FUCQ-85), so a reset does not delete them.
- [ ] **Read model:** a read returns the latest result for each experiment, and whether its policy version is still the active one.
- [ ] **Labels:** the result carries the assumption set used (key, value, assumed or verified, basis) and the fixed caveat that calculated fit is not observed satisfaction.

#### Files or areas

- `server/gcsp/comparison/measures.js (proposed)`
- `server/gcsp/comparison/experiments.js (proposed)`
- `server/gcsp/migrations/ (additive comparison results table)`
- `server/test/gcsp-comparison-measures.test.js (proposed)`
- `docs/gcsp/shared-contracts.md (result shape)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026, with the design agreed the same day (`docs/design/hld-story-readiness-2026-11-04.md`, item C8; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md` ("Compare 1,000 fictional employees"), `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`, "The 1,000-employee comparison", plus diagram page 09. Carry these decisions and acceptance criteria into every child-agent brief.

First isolate the process change; then run the order-mix and points scenarios separately, so the source of any improvement is clear (demo brief). Financial and residual measures are out until there are declared economic assumptions.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q2: managed PostgreSQL behind the repository port.
- Q6: results record the policy version they used.

#### Out of scope

Running jobs and their API (the next Story in FUCQ-132); the panel; financial or residual-value scenarios.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-comparison-measures.test.js`: these pass:

    - measures computed correctly on a hand-checked small cohort;
    - mean and range across seeds;
    - "no clear difference" when ranges overlap;
    - a fixture where today's route does better is reported as such;
    - overlays and sweep values recorded in the manifest;
    - results are immutable and survive a run reset;
    - the latest-result read flags a superseded policy version.

- `npm test` passes.
- Backend-only: no screen. Record the result shape in fixtures for the panel (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-137](https://ibm-consulting.atlassian.net/browse/FUCQ-137) · Run comparison jobs in a worker, presenter-only, with a command-line twin

```text
id: FUCQ-137
title: Run comparison jobs in a worker, presenter-only, with a command-line twin
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-132, 1,000-employee comparison from HLD readiness item C8)
epic: FUCQ-132
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-136, FUCQ-84
```

#### Goal

As the presenter, I want to start a comparison run from the demo without the app freezing, and to run the same thing from the command line, so that results are ready before and during the walkthrough.

#### Acceptance criteria

- [ ] **Worker job:** a comparison job runs FUCQ-136's `runComparison` in a Node `worker_threads` worker inside the GCSP backend. API requests stay responsive while it runs (a test checks a request is served mid-run). One job runs at a time; starting another while one runs is refused with the running job's ID.
- [ ] **Routes:** under `/api/gcsp`, start a job (experiment type, and an optional overlay or hold-duration list), read its progress (seeds done of total) and outcome, and read the latest result for each experiment. Starting a job is presenter-only and also allowed for Greg (FUCQ-84 roles); reading results is allowed for Greg and the presenter. Other roles are refused.
- [ ] **Validation:** overlays and sweep values are checked against each key's declared unit and range. An invalid request is refused with the key named, and starts nothing.
- [ ] **Clear outcomes:** a worker error or timeout (`comparison.jobTimeoutSeconds`) marks the job failed with a reason and stores no partial result. A backend restart marks any running job interrupted.
- [ ] **Command-line twin:** `node scripts/gcsp-comparison.mjs --experiment <type> [--seeds ...]` runs the same module, prints the measures table and writes the result through the same repository port (in-memory or `GCSP_DATABASE_URL`). It is how the demo's results are prepared in advance.
- [ ] **No unattended work:** nothing starts a job on a timer or at startup (Q3).

#### Files or areas

- `server/gcsp/comparison/job.js (proposed)`
- `server/gcsp/comparison/worker.js (proposed)`
- `server/index.js (routes under /api/gcsp)`
- `scripts/gcsp-comparison.mjs (proposed)`
- `server/test/gcsp-comparison-job.test.js (proposed)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026, with the design agreed the same day (`docs/design/hld-story-readiness-2026-11-04.md`, item C8; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md` ("Compare 1,000 fictional employees"), `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`, "The 1,000-employee comparison" and "Technical deployment and recovery", plus diagram pages 05 and 09. Carry these decisions and acceptance criteria into every child-agent brief.

The comparison is a module in the GCSP backend, not a separate service. `worker_threads` is part of Node, so no runtime dependency is added (Q4).

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q1: GCSP runs in its own Render environment.
- Q3: presenter-started work only, with no unattended runner.
- Q4: no runtime dependency beyond `pg`.

#### Out of scope

The panel (the next Story in FUCQ-132); scheduling or unattended runs; a separate service or queue.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-comparison-job.test.js`: these pass:

    - a job runs in a worker and the API stays responsive;
    - one job at a time;
    - role checks for start and read;
    - invalid overlays refused with the key named;
    - failure and timeout store no partial result;
    - restart marks a running job interrupted;
    - the command-line twin writes the same result shape.

- `node scripts/gcsp-comparison.mjs --experiment process` completes against the in-memory repository and prints the measures table.
- `npm test` passes.
- Backend-only: no screen. Record the job and progress shapes in fixtures for the panel (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-138](https://ibm-consulting.atlassian.net/browse/FUCQ-138) · Show the route comparison panel on Greg's dashboard with assumptions and a hold rerun

```text
id: FUCQ-138
title: Show the route comparison panel on Greg's dashboard with assumptions and a hold rerun
kind: ui
design_impact: yes
ui: el, cardinal; screenIntro and statusScreen (both listed under "Not yet in the kit"; reuse them if already added); FUCQ-101's metricTile and dataTable; FUCQ-31's shared fact and decision components; new: rangeBar, because the kit has no way to show a mean with its range across seeds
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-132, 1,000-employee comparison from HLD readiness item C8)
epic: FUCQ-132
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-137, FUCQ-101
```

#### Goal

As the presenter showing Greg's dashboard, I want today's route and the buddy route side by side, with the assumptions behind them and a quick hold-duration rerun, so that the audience sees an honest comparison they can question.

#### Acceptance criteria

- [ ] **Panel in its own region:** a route comparison panel in a defined region of FUCQ-101's dashboard, inside FUCQ-64's shell. It loads the latest stored result for the chosen experiment at once, so the walkthrough never waits for a run.
- [ ] **Side by side:** for each measure (coverage before renewal, unused stock, declines, expiries, retries, fit of accepted cars, and coverage by access group), today's route and the buddy route with mean and range across seeds, and the difference. "No clear difference" and a result where today's route does better are shown as plainly as a buddy win.
- [ ] **Assumptions:** an expandable list of the assumptions used (key, value, unit, assumed or verified, basis), the seeds, the policy version and when the result was made. The caveat that calculated fit is not observed satisfaction is always visible.
- [ ] **Experiments and rerun:** a picker for process only, alternative order mix or points, and hold-duration sweep. A hold-duration control starts FUCQ-137's job with chosen values, shows progress, and then the new result. While it runs, the previous result stays on screen, labelled as the previous result.
- [ ] **States:** no result yet (with a start action), running, failed (with the reason), result for an older policy version (labelled), source unavailable, and refused for a role other than Greg or the presenter.
- [ ] **Respectful copy:** the baseline is called "today's release route". Copy explains behaviours and does not disparage the delivered GCSP interface (demo-brief positioning). No em dashes.
- [ ] **Kit and embeddable (Q18):** new components go into the kit, `COMPONENTS.md` and the gallery in the same commit, and the ratchet baseline only falls. The panel mounts as part of the dashboard custom element, with no inline scripts, inline handlers or `eval`. Keyboard operable, with readable contrast.

#### Files or areas

- `blocks/gcsp/ (Greg dashboard block: comparison panel)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`
- `server/test/ (render test for the comparison panel)`

#### Decided

Gary approved this Epic, its Story titles and the dependency order on 4 November 2026, with the design agreed the same day (`docs/design/hld-story-readiness-2026-11-04.md`, item C8; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md` ("Compare 1,000 fictional employees" and the positioning section), `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` ("Establish Greg's denser operational treatment"), `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/personas/scheme-ordering-lead.md` and `docs/design/gcsp-high-level-design.md`, "The 1,000-employee comparison", plus diagram page 09. Carry the experience contract, the visual reference and these criteria into every child-agent brief.

The demo interaction the brief suggests is changing the reservation duration: a longer hold may relieve time pressure while keeping scarce stock unavailable for longer. The panel lets the simulation show that balance rather than asserting it.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q8: separate GCSP blocks.
- Q9: Greg's dashboard is on the critical path; this panel adds to it.
- Q18: custom element and CSP.

#### Out of scope

Publishing policy from the panel (FUCQ-103 publishes; the panel's overlays are what-ifs only); FUCQ-74's prediction panel; the comparison computation itself.

#### Validate

Run commands from the worktree root.

- `npm test` passes, including the UI ratchet, the em-dash test and a render test for the panel.
- Browser evidence at desktop and narrow (375 px) widths, with keyboard-only operation, of these states: a result with a buddy improvement, "no clear difference", a result where today's route does better, assumptions expanded, a hold-duration rerun in progress and its new result, no result yet, failed, older policy version, unavailable, and refused for a non-Greg role. Record the screenshot paths (`docs/gcsp/experience-quality.md`).
