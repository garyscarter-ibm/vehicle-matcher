# FUCQ-74 and FUCQ-75 · Greg's predictive next order and replayable acceptance scenarios

**Published and verified on 4 November 2026.** This is readiness item C9: 13 native Stories under two Epics that already existed.
- Six Stories under [FUCQ-74](https://ibm-consulting.atlassian.net/browse/FUCQ-74), Greg's predictive next order.
- Seven Stories under [FUCQ-75](https://ibm-consulting.atlassian.net/browse/FUCQ-75), replayable manual acceptance scenarios.

Status and fields:
- Both Epics are In Progress, with Start date 2026-11-04.
- Each Epic gained a paragraph tying it to the new backlog, and its migration record is kept.
- New Relates links: FUCQ-90 relates to FUCQ-74, and FUCQ-85 relates to FUCQ-75.
- The Stories are To Do and unassigned, at High (P2, `due 2026-11-12: GCSP demo`). No Story Points were authored.
- 28 native Blocks links record the dependencies. [Publication verification](evidence/fucq-74-75/story-publication.json) records the read-back.

Gary approved the Story titles, their one-line outcomes and the dependency order on 4 November 2026, under the equal-authority rule (`AGENTS.md`). That approval included two choices:
- The plan chain does not wait for the learned model.
- The presenter controls (FUCQ-126) do not block FUCQ-109.

Source of the scope: [C7–C9 handover](../design/handover-section-c7-c9-2026-11-04.md), section C9, and [HLD story readiness](../design/hld-story-readiness-2026-11-04.md), section C. Template: [_dev/story-template.md](../../_dev/story-template.md). Each `ui`-kind story names its kit components from [COMPONENTS.md](../../COMPONENTS.md). Only stories were authored: no implementation, poller, provisioning or deployment was started.

Keys skip numbers because sibling sessions created C7 and C8 Stories at the same time.

| Story | Outcome | Kind, size | Depends on |
|---|---|---|---|
| [FUCQ-113](https://ibm-consulting.atlassian.net/browse/FUCQ-113) | Record learning records for Greg's demand model, observed and synthetic | code, M | FUCQ-77, 81, 82, 99 |
| [FUCQ-115](https://ibm-consulting.atlassian.net/browse/FUCQ-115) | Train the choice model offline and evaluate it on held-out cycles | code, M | FUCQ-113, 83 |
| [FUCQ-117](https://ibm-consulting.atlassian.net/browse/FUCQ-117) | Plan feasible order quantities from expressed demand, supply and policy | code, L | FUCQ-99, 104 |
| [FUCQ-119](https://ibm-consulting.atlassian.net/browse/FUCQ-119) | Preview a replan after constraint edits and submit the plan as a request | code, M | FUCQ-117 |
| [FUCQ-121](https://ibm-consulting.atlassian.net/browse/FUCQ-121) | Show Greg's recommended order plan as a panel on his dashboard | ui, L | FUCQ-119 |
| [FUCQ-123](https://ibm-consulting.atlassian.net/browse/FUCQ-123) | Forecast demand with the learned model, shown beside the baseline plan | code, L | FUCQ-115, 121, 29 |
| [FUCQ-125](https://ibm-consulting.atlassian.net/browse/FUCQ-125) | Set up named acceptance scenarios from versioned fixtures on reset | code, M | FUCQ-85 |
| [FUCQ-126](https://ibm-consulting.atlassian.net/browse/FUCQ-126) | Give the presenter controls for ticks, releases, reset, scenarios and role | ui, M | FUCQ-125, 64, 92 |
| [FUCQ-127](https://ibm-consulting.atlassian.net/browse/FUCQ-127) | Replay the no-suitable-match scenario | code, S | FUCQ-126, 95, 96 |
| [FUCQ-128](https://ibm-consulting.atlassian.net/browse/FUCQ-128) | Replay the decline-then-change scenario | code, S | FUCQ-126, 107 |
| [FUCQ-129](https://ibm-consulting.atlassian.net/browse/FUCQ-129) | Replay the offer-expiry scenario | code, S | FUCQ-126, 106 |
| [FUCQ-130](https://ibm-consulting.atlassian.net/browse/FUCQ-130) | Replay the unavailable-data scenario | code, S | FUCQ-126, 95 |
| [FUCQ-131](https://ibm-consulting.atlassian.net/browse/FUCQ-131) | Replay the uncertain-handoff scenario | code, S | FUCQ-126, 108 |

**Build order:**
1. **Plan chain (FUCQ-74), which drives the demo (Q10):** FUCQ-99 and FUCQ-104, then FUCQ-117, FUCQ-119 and FUCQ-121.
2. **Learned chain, in parallel:** FUCQ-113, then FUCQ-115. FUCQ-123 joins the two chains by adding the learned column to FUCQ-121's panel.
3. **Presenter controls, early, because the walkthrough needs them:** FUCQ-125 after FUCQ-85, then FUCQ-126 once FUCQ-64 and FUCQ-92 are built.
4. **Difficult cases:** FUCQ-127 to FUCQ-131 fan out as each one's journey Stories land.

FUCQ-109 supplies the main successful journey and drives the presenter routes directly, so it does not wait on FUCQ-126.

**Shared decisions.** Every Story's Decided section cites:
- `docs/gcsp/README.md`, `demo-brief.md`, `build-rules.md` and `experience-quality.md`;
- `docs/gcsp/shared-contracts.md` (FUCQ-80);
- the four-line Foundation (FUCQ-79) list;
- the HLD review decisions it relies on.

The FUCQ-74 Stories keep the deterministic baseline as the plan that drives the demo and the only one that can be submitted. The learned model is labelled synthetic-trained (Q10), and no runtime dependency beyond `pg` is added (Q4). The FUCQ-75 replay Stories exercise the real services, never set a predetermined winner in a fixture, and send screen defects back to the owning Story or a Bug.

**Still open, not part of this set:**
- FUCQ-121 and FUCQ-126 each add a kit component (FUCQ-126 names `presenterBar`), which goes into `COMPONENTS.md` when it is built.

The Story bodies below are the Jira descriptions as read back, with `id` and `title` added to each header. The only other changes are the bullet marker and escaped checkboxes, which are normalised.

---

## [FUCQ-74](https://ibm-consulting.atlassian.net/browse/FUCQ-74) · Recommend Greg's next vehicle order using predicted employee demand

---

### [FUCQ-113](https://ibm-consulting.atlassian.net/browse/FUCQ-113) · Record learning records for Greg's demand model, observed and synthetic

```text
id: FUCQ-113
title: Record learning records for Greg's demand model, observed and synthetic
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-74, HLD readiness section C9)
epic: FUCQ-74
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-77, FUCQ-81, FUCQ-82, FUCQ-99
```

#### Goal

As Greg, I want a clean record of what employees wanted, what they could get and what they chose, so that a demand model can learn from it without mixing synthetic history with what really happened.

#### Acceptance criteria

- [ ] **Record shape:** a `LearningRecord` shape is added to `docs/gcsp/shared-contracts.md`. Each record carries:

    - the renewal cohort and period, and the entitlement context (scheme, grade, allowance band);
    - the confirmed brief version, with preferences, importance weights and essentials;
    - the choice set: the eligible and available alternatives at the time, and how long each was exposed;
    - the dated points terms that applied;
    - the outcome: offered, selected, declined (with its typed reason), expired, or waited with no acceptable choice;
    - timestamps from the demo clock;
    - provenance: `observed` or `synthetic`, with the generator version and seed for synthetic records.

- [ ] **Distinct outcomes:** acceptance, decline, expiry and later satisfaction are separate fields. A fit score is never written as an outcome or as satisfaction.
- [ ] **Observed records:** a projection over FUCQ-81's repository builds observed records for the current run from the same saved briefs and offer outcomes that FUCQ-99 aggregates. It holds no employee names, trip or usage history.
- [ ] **Synthetic generator:** a seeded generator produces plausible multi-cycle records. It includes noisy responses, no-choice outcomes, competition and supply limits.

    - Synthetic employees are generated from PolicyService keys (cohort size, preference and importance distributions, noise, no-choice rate). None is hard-coded.
    - Vehicle alternatives come from FUCQ-77's real configurations.
    - The same seed and policy version give identical output.

- [ ] **Manifest:** each generated dataset writes a manifest with record counts, cycles, seed, generator version, policy version and the configuration set it used. Training (the next Story in FUCQ-74) reads only datasets with a manifest.
- [ ] **Kept apart:** observed and synthetic records are never mixed in one dataset without their provenance, and a test proves it.
- [ ] **One central change:** changing one generator key in the policy source (for example the no-choice rate) changes the generated records, with no code edit.

#### Files or areas

- `server/gcsp/predict/records/ (proposed: LearningRecord projection)`
- `scripts/gcsp/generate-learning-records.mjs (proposed)`
- `server/gcsp/policy/seed (generator keys, through FUCQ-82's seed file)`
- `server/test/gcsp-learning-records.test.js (proposed)`
- `docs/gcsp/shared-contracts.md`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/greg-predictive-research.md` ("What the learning records need") and `docs/design/gcsp-high-level-design.md`, "Greg's next best order: FUCQ-74" (the learning-records contract). Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q10: the deterministic baseline drives the plan; the learned model is shown alongside, labelled synthetic-trained.
- Q4: `pg` is the only new runtime dependency.
- Q13: vehicles are keyed by `configurationId`; the 200-plus real configurations supply vehicle features, not employee-choice labels.
- Round-2 finding: quota setting, lead times and release sizes are undocumented, so they are plausible keyed assumptions.

No real BMW employee extract exists in the repository. Synthetic records demonstrate the pipeline within their stated assumptions and never validate BMW employee behaviour.

#### Out of scope

Training and evaluation (the training Story in FUCQ-74); prediction and planning; any screen; real historical extracts.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-learning-records.test.js`: these pass:

    - the record shape and its distinct outcome fields;
    - observed records from a seeded run, with no personal fields;
    - identical synthetic output for the same seed and policy version;
    - a different output after one generator key changes;
    - provenance kept apart;
    - the manifest written and required.

- `node scripts/gcsp/generate-learning-records.mjs --seed 1` writes a dataset and manifest, and reports the counts.
- `npm test` passes.
- Backend-only: no screen. Record a sample record and manifest as fixtures for the training Story (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-115](https://ibm-consulting.atlassian.net/browse/FUCQ-115) · Train the choice model offline and evaluate it on held-out cycles

```text
id: FUCQ-115
title: Train the choice model offline and evaluate it on held-out cycles
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-74, HLD readiness section C9)
epic: FUCQ-74
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-113, FUCQ-83
```

#### Goal

As Greg, I want a demand model that has really been trained and tested on cycles it never saw, so that its predictions are honest about how well they work.

#### Acceptance criteria

- [ ] **Offline training:** a Node script trains an interpretable, regularised conditional-logit choice model on a FUCQ-113 dataset with a manifest. The features are vehicle attributes and their interactions with stated preferences, importance and essentials. A no-choice (wait) alternative is included. No new runtime dependency is added (Q4): the optimiser is plain JavaScript in the script.
- [ ] **Held-out evaluation:** training uses earlier cycles, and evaluation uses later cycles and a cohort absent from training. The evaluation reports:

    - log loss and Brier score, against a baseline from FUCQ-99's expressed-demand shares and one from deterministic fit (FUCQ-29);
    - a reliability table by probability band;
    - results by vehicle class and cohort, with thin classes flagged.

- [ ] **Immutable artefact:** the run writes an artefact with the learned coefficients, feature and schema version, training-data manifest, evaluation results and provenance (`synthetic-trained`, seed, generator version). It is content-addressed, and its contents never change once written.
- [ ] **Activation by policy version:** making a model active is a change of a dated policy row, published through FUCQ-83's `publishPolicyVersion` and read through FUCQ-82. There is no second model registry. Earlier versions stay readable, so a historical plan can say which model it used.
- [ ] **Training settings in the policy source:** the regularisation strength, the train and held-out split and the feature set are policy keys. Changing one changes the next training run, with no code edit.
- [ ] **Honest limits:** the artefact and its evaluation summary state that the model was trained on synthetic data, and give the generator's assumptions. A model that does worse than the baseline is still recorded, with that result shown.

#### Files or areas

- `scripts/gcsp/train-choice-model.mjs (proposed)`
- `server/gcsp/predict/model/ (proposed: artefact reader and schema)`
- `docs/gcsp/models/ (proposed: committed demo artefact and evaluation summary)`
- `server/test/gcsp-choice-model.test.js (proposed)`
- `docs/gcsp/shared-contracts.md`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md` (rules 4 and 5), `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/greg-predictive-research.md` ("Candidate first learned model" and "Define and test the decision's usefulness") and `docs/design/gcsp-high-level-design.md`, "Greg's next best order: FUCQ-74". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q10: the learned model runs alongside the deterministic baseline, labelled synthetic-trained. It never drives the demo plan.
- Q6: the active model reference is a dated policy row.
- Q4: `pg` only, so no ML library.

The HLD places training and held-out evaluation offline, with no new ML microservice. The basic logit's independence-of-irrelevant-alternatives assumption is a known limit; record it.

#### Out of scope

Runtime prediction (the forecast Story in FUCQ-74); planning; any screen; validated BMW calibration.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-choice-model.test.js`: these pass:

    - training recovers known coefficients from a small generated set within a stated tolerance;
    - held-out cycles and the cohort never enter training;
    - the metrics and both baselines are computed;
    - the artefact is immutable and content-addressed;
    - activation reads through PolicyService;
    - a training key change alters the next run.

- `node scripts/gcsp/train-choice-model.mjs` trains on the committed dataset and prints the evaluation summary.
- `npm test` passes.
- Backend-only: no screen. Record the evaluation summary shape as a fixture for the forecast and plan panel (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-117](https://ibm-consulting.atlassian.net/browse/FUCQ-117) · Plan feasible order quantities from expressed demand, supply and policy

```text
id: FUCQ-117
title: Plan feasible order quantities from expressed demand, supply and policy
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-74, HLD readiness section C9)
epic: FUCQ-74
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-99, FUCQ-104
```

#### Goal

As Greg, I want a recommended order list worked out from what employees need, what supply is already coming and the limits I work within, so that I request the right cars rather than repeating last year's mix.

#### Acceptance criteria

- [ ] **OrderPlan service:** a pure planner takes these inputs and returns an `OrderPlan` (shape in `docs/gcsp/shared-contracts.md`):

    - a demand forecast. The default and demo driver is FUCQ-99's expressed-demand aggregation for the renewal horizon (Q10);
    - released and held stock, and confirmed inbound supply with expected dates, from FUCQ-104's records;
    - policy keys: model and derivative minimum and maximum quantities, lead times, budget, objective weights and the horizon.

- [ ] **Feasible integers:** the plan returns integer quantities per model and derivative that satisfy every bound, the budget and lead-time reach. Each entitled employee is counted once. When stock runs short, competition and substitution between acceptable alternatives are modelled, so one employee is never counted against every car.
- [ ] **Explained result:** the plan reports:

    - expected acceptable coverage before renewal;
    - unallocated-stock risk;
    - unmet needs, with the gate or constraint that causes each;
    - the binding constraints;
    - the objective trade-off;
    - a comparison with at least one alternative plan and with Greg's current draft, if any.

- [ ] **Infeasible requests:** when no plan satisfies the constraints, the result names the conflicting constraints instead of returning a partial plan as if it were feasible.
- [ ] **Versions:** each plan records the forecast, policy, stock, supply and cohort versions it used, and a plan ID.
- [ ] **Deterministic:** the same inputs give the same plan. The solver is plain JavaScript (for example a bounded branch-and-bound or greedy-with-repair over the small demo problem), with no new runtime dependency (Q4).
- [ ] **One central change:** changing one bound or objective weight in the policy source changes the plan, with no code edit.

#### Files or areas

- `server/gcsp/predict/plan/ (proposed: OrderPlan planner)`
- `server/test/gcsp-order-plan.test.js (proposed)`
- `docs/gcsp/shared-contracts.md`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/greg-predictive-research.md` ("What constrains Greg's next best action?") and `docs/design/gcsp-high-level-design.md`, "Greg's next best order: FUCQ-74" (the forecast + supply + policy → `OrderPlan` contract) and "Greg's supply loop and the commitment boundary". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q10: the deterministic expressed-demand baseline drives the plan. The learned forecast is an alternative input, added by the forecast Story in FUCQ-74.
- Q4: no solver library.
- Round-1 finding: future orders live upstream with requested and confirmed dates on one status scale, so confirmed supply is FUCQ-104's record, not a planner guess.
- Round-2 finding: quota setting, lead times and release sizes are plausible keyed assumptions.

The planner reads demand from FUCQ-99, which never uses the retail display sample. Known renewal dates and confirmed supply are facts, not quantities to predict.

#### Out of scope

Greg's preview, constraint editing and submission (the preview Story in FUCQ-74); the panel; the learned forecast; any write to stock or order records.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-order-plan.test.js`: these pass:

    - feasible integer quantities within every bound and the budget;
    - each employee counted once, with substitution under scarcity;
    - confirmed inbound supply reducing the plan;
    - an infeasible set naming its conflicting constraints;
    - the same inputs giving the same plan;
    - a policy key change altering the plan.

- `npm test` passes.
- Backend-only: no screen. Record feasible, infeasible and alternative plan shapes as fixtures for the plan panel (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-119](https://ibm-consulting.atlassian.net/browse/FUCQ-119) · Preview a replan after constraint edits and submit the plan as a request

```text
id: FUCQ-119
title: Preview a replan after constraint edits and submit the plan as a request
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-74, HLD readiness section C9)
epic: FUCQ-74
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-117
```

#### Goal

As Greg, I want to change my limits, see the new plan before anything is committed, and then submit it on purpose, so that I stay in charge of what is ordered and the plan keeps up when Production replies.

#### Acceptance criteria

- [ ] **Preview:** a Greg-role `/api/gcsp` route recomputes FUCQ-117's plan against draft constraints, such as quantity bounds or other keys PolicyService marks as Greg-editable. It writes nothing, and says it is a preview. The editable keys are listed in `shared-contracts.md`. Eligibility gates and essentials are not editable.
- [ ] **Keep the edited bounds:** Greg can keep his edited bounds as a draft, or publish them as a new policy version through FUCQ-83's `publishPolicyVersion`. Publishing records Greg as the publisher and an effective date. A preview never publishes.
- [ ] **Submit through FUCQ-104:** submitting a selected plan creates `FutureOrderRequest` records through FUCQ-104's idempotent submission, with no second request path. Each request keeps the plan ID and the plan, forecast, policy, model, cohort, stock and supply versions.
- [ ] **Stale inputs:** if any input version has changed since the preview, submission is rejected with a "replan needed" outcome and the changed inputs listed. It never submits a stale plan.
- [ ] **Replan on response:** when FUCQ-104's synthetic production adapter confirms part of a request, delays it or releases it, the next plan read recomputes and marks itself as replanned after that response. A request is never counted as confirmed supply, and only a release is stock.
- [ ] **Role and run:** other roles are refused, and every read and write is run-scoped.

#### Files or areas

- `server/gcsp/predict/plan/ (preview, submit and replan operations)`
- `server/index.js (Greg plan routes under /api/gcsp)`
- `server/test/gcsp-order-plan-submit.test.js (proposed)`
- `docs/gcsp/shared-contracts.md`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md` (rules 4 and 5), `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`, "Greg's next best order: FUCQ-74" (the preview → `FutureOrderRequest` contract) and "Greg's supply loop and the commitment boundary". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q6: published bounds are dated policy rows.
- Q14: the integration target is the AWS platform. Greg's submit is a request to the ordering side, not a GCSP stock write.
- Round-1 finding: request, confirmation and release map onto the upstream status scale.

FUCQ-104 owns the request, confirmed and released records and the synthetic production adapter. This Story only calls them.

#### Out of scope

The panel (the plan panel Story in FUCQ-74); the learned forecast; live ordering writes; new request or supply records.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-order-plan-submit.test.js`: these pass:

    - a preview that writes nothing;
    - non-editable keys refused;
    - publishing edited bounds as a new version;
    - submission through FUCQ-104, idempotent and carrying every version;
    - stale-input rejection;
    - a replan after a partial confirmation, a delay and a release;
    - role refusal and run scope.

- `npm test` passes.
- Backend-only: no screen. Record the preview, stale and replanned response shapes as fixtures for the plan panel (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-121](https://ibm-consulting.atlassian.net/browse/FUCQ-121) · Show Greg's recommended order plan as a panel on his dashboard

```text
id: FUCQ-121
title: Show Greg's recommended order plan as a panel on his dashboard
kind: ui
design_impact: yes
ui: el, gbp, cardinal; renderRangeSlider (single option, as extended by FUCQ-94) for quantity bounds; button, screenIntro and statusScreen (all listed under "Not yet in the kit"; reuse them if already added); metricTile and dataTable from FUCQ-101
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-74, HLD readiness section C9)
epic: FUCQ-74
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-119
```

#### Goal

As Greg, I want my dashboard to lead with the next order I should place and why, so that I can check it, change my limits and submit it without working the numbers out myself.

#### Acceptance criteria

- [ ] **Panel placement:** the plan panel fills the region FUCQ-101 reserved for FUCQ-74 on Greg's dashboard, in FUCQ-64's shell. It sits beside the order-tracking panel (FUCQ-104) without duplicating it.
- [ ] **Leads with the action:** the panel opens with the recommended next action and the proposed model and derivative quantity list. Below that it shows:

    - expected acceptable coverage before renewal;
    - unallocated-stock risk;
    - unmet needs, with the reason for each;
    - binding constraints and reasons;
    - at least one alternative plan.

- [ ] **Edit and preview:** Greg changes quantity bounds and other editable constraints, then previews a replan (FUCQ-119). The screen says it is a preview and shows the differences from the current plan. An infeasible request shows which constraints conflict.
- [ ] **Submit:** submitting is a separate, clearly labelled action. A stale plan shows "replan needed" with the changed inputs. After submission the request appears in FUCQ-104's tracking panel. After a Production response the panel shows that it has replanned.
- [ ] **Versions:** the panel shows the forecast source ("Expressed demand", the deterministic baseline), and the policy version and demo-clock time the plan is for.
- [ ] **States:** loading, no demand yet, plan ready, preview, infeasible, stale (replan needed), submitted, replanned after a response, source unavailable, and refused for a non-Greg role.
- [ ] **Kit and embedding (Q18):** built from the shared kit in Greg's denser operational treatment. New components go into the kit, `COMPONENTS.md` and the gallery in the same commit, and the ratchet baseline only falls. Mounts as a custom element, with no inline scripts, inline handlers or `eval`. Keyboard operable, with readable contrast, and copes with long derivative names.
- [ ] **Manual scenario:** a "Greg's next order" scenario is added to `docs/gcsp/manual-acceptance-scenarios.md`, following FUCQ-75's catalogue format: start state, reset and tick steps, edit a bound, preview, submit, confirm through the synthetic production adapter, see the replan, plus space for observations.

#### Files or areas

- `blocks/gcsp/ (Greg dashboard: plan panel)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`
- `server/test/ (render test for the plan panel)`
- `docs/gcsp/manual-acceptance-scenarios.md`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` ("Establish Greg's denser operational treatment"), `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/personas/scheme-ordering-lead.md`, `docs/gcsp/greg-predictive-research.md` and `docs/design/gcsp-high-level-design.md`, "Greg's next best order: FUCQ-74", plus diagram page 08. Carry the experience contract, the visual reference and these criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q8: separate GCSP blocks.
- Q18: custom element and CSP.
- Q10: the deterministic baseline drives the plan shown here. The learned column is added by the forecast Story in FUCQ-74.
- Round-1 finding: no KPIs exist on the target for order volumes or unallocated stock, so this view is net new.

#### Out of scope

The learned forecast column (the forecast Story in FUCQ-74); the order-tracking panel (FUCQ-104); publishing points and weights (FUCQ-103).

#### Validate

Run commands from the worktree root.

- `npm test` passes, including the UI ratchet, the em-dash test and a render test for the plan panel.
- Browser evidence at desktop and narrow (375 px) widths, with keyboard-only operation, of these states: plan ready, preview after a bound change, infeasible, stale, submitted, replanned after a confirmation, empty, unavailable, and refused for a non-Greg role. Record the screenshot paths (`docs/gcsp/experience-quality.md`).
- Russell can run the "Greg's next order" manual scenario from a reset.

---

### [FUCQ-123](https://ibm-consulting.atlassian.net/browse/FUCQ-123) · Forecast demand with the learned model, shown beside the baseline plan

```text
id: FUCQ-123
title: Forecast demand with the learned model, shown beside the baseline plan
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-74, HLD readiness section C9)
epic: FUCQ-74
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: L
depends_on: FUCQ-115, FUCQ-121, FUCQ-29
```

#### Goal

As Greg, I want to see what a trained demand model predicts next to the plan from expressed demand, so that I can judge whether learning adds anything, knowing it was trained on synthetic data.

#### Acceptance criteria

- [ ] **Prediction port:** a `PredictionInput` → `DemandForecast` port inside the Node backend (shapes in `docs/gcsp/shared-contracts.md`):

    - **Input:** a versioned cohort and horizon, permitted choice sets and the dated terms.
    - **Output:** choice, acceptance and wait probabilities; aggregate demand by vehicle class and period, with uncertainty; and the model and data versions and stated limitations.

- [ ] **Gates first:** FUCQ-29's eligibility, essentials and entitlement gates build each employee's permitted choice set before the model scores it. The model cannot relax a gate or add stock-write authority. A fit score is never shown as an acceptance probability.
- [ ] **Active model:** the provider loads the artefact named by the active policy version (FUCQ-115, through FUCQ-82). Activating a different version changes the next forecast, and earlier plans keep the version they used.
- [ ] **Learned plan alongside:** FUCQ-117's planner runs a second time with the learned forecast. FUCQ-121's panel gains a learned-alternative column beside the baseline plan, with differences highlighted. The column is labelled "Synthetic-trained model", with its held-out evaluation summary. The baseline remains the recommended plan (Q10), and only the baseline plan can be submitted.
- [ ] **Fallback:** when no model is active, the artefact is missing or invalid, or a cohort or vehicle class is outside the training coverage, the panel shows the baseline alone with the limitation stated. Nothing is silently substituted.
- [ ] **One central change:** activating another model version, or changing one forecast key, updates the forecast, the learned plan and the displayed differences consistently.
- [ ] **Browser:** the learned column passes the panel's kit, CSP and keyboard rules (FUCQ-121).

#### Files or areas

- `server/gcsp/predict/forecast/ (proposed: PredictionInput, DemandForecast provider)`
- `server/gcsp/predict/plan/ (second plan run)`
- `blocks/gcsp/ (plan panel: learned-alternative column)`
- `server/test/gcsp-demand-forecast.test.js (proposed)`
- `docs/gcsp/shared-contracts.md`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/greg-predictive-research.md` and `docs/design/gcsp-high-level-design.md`, "Greg's next best order: FUCQ-74" (the `PredictionInput` → `DemandForecast` contract). Carry the experience contract, the visual reference and these criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q10: deterministic baseline primary; the learned model is shown alongside, labelled synthetic-trained.
- Q5: the employee policy calls `rankCars()` directly through FUCQ-29 until FUCQ-27/28.
- Q18: custom element and CSP for the panel column.

Synthetic-trained results never claim validated BMW employee behaviour.

#### Out of scope

Training (FUCQ-115); submitting the learned plan; a new ML service or runtime dependency.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-demand-forecast.test.js`: these pass:

    - the gates applied before scoring;
    - probabilities summing to one per employee, including wait;
    - the active-version switch;
    - each fallback case;
    - the learned plan computed alongside, never as the submit target;
    - a central change propagating to forecast and plan.

- `npm test` passes, including the UI ratchet and the em-dash test.
- Browser evidence at desktop and narrow (375 px) widths, with keyboard-only operation, of the learned column beside the baseline, its label and evaluation summary, and the fallback state. Record the screenshot paths (`docs/gcsp/experience-quality.md`).

---

## [FUCQ-75](https://ibm-consulting.atlassian.net/browse/FUCQ-75) · Replay manual acceptance scenarios for trial and improvement

---

### [FUCQ-125](https://ibm-consulting.atlassian.net/browse/FUCQ-125) · Set up named acceptance scenarios from versioned fixtures on reset

```text
id: FUCQ-125
title: Set up named acceptance scenarios from versioned fixtures on reset
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-75, HLD readiness section C9)
epic: FUCQ-75
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-85
```

#### Goal

As Russell, I want to start any named scenario from a known state with one reset, so that I can try a journey, see what happens and try it again exactly the same way.

#### Acceptance criteria

- [ ] **Scenario catalogue:** a machine-readable catalogue (shape in `docs/gcsp/shared-contracts.md`) lists each scenario with:

    - a stable ID and name;
    - the Epics and Stories it exercises, and the capabilities it needs;
    - the acting roles, with principals from FUCQ-84's fixtures;
    - its start-state fixture version and policy version;
    - its clock start, and the tick and release steps it uses.

    The first entries are the main successful journey (FUCQ-109) and the five difficult cases in FUCQ-75.

- [ ] **Reset into a scenario:** a presenter-only operation resets into a named scenario by calling FUCQ-85's reset with that scenario's fixture set. It adds no reset of its own: a new `runId`, regenerated identifiers, the clock at the scenario's start and the old run made stale all come from FUCQ-85.
- [ ] **Fixtures through the real services:** scenario start states are versioned fixtures (briefs, principals, stock tranches, pending operations) loaded through the same repository and services the application uses. A fixture never sets a predetermined winner or replaces screen text. Runtime values come from PolicyService, and a scenario may name an alternative policy version but keeps no separate defaults.
- [ ] **Capability check:** resetting into a scenario whose required capabilities are not built yet returns a clear "not available yet" outcome listing what is missing, rather than a half-built state.
- [ ] **Observation record:** `docs/gcsp/manual-acceptance-scenarios.md` gains the per-scenario format: start state, reset and tick steps, short click-through, expected visible result and state change, provisional assumptions, and a dated observations table recording the run ID, build commit, result and feedback.
- [ ] **Read-back:** the presenter can read the catalogue, the current scenario, its run ID and its fixture version.

#### Files or areas

- `server/gcsp/scenarios/ (proposed: catalogue, scenario reset)`
- `server/gcsp/fixtures/scenarios/ (proposed: versioned start states)`
- `server/index.js (presenter scenario routes under /api/gcsp)`
- `server/test/gcsp-scenarios.test.js (proposed)`
- `docs/gcsp/manual-acceptance-scenarios.md`
- `docs/gcsp/shared-contracts.md`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md` ("Refine the experience through hands-on trials"), `docs/gcsp/experience-quality.md` ("Repeatable manual trials"), `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/manual-acceptance-scenarios.md` and `docs/design/gcsp-high-level-design.md`, "Transaction and event invariants" (scenario reset). Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q3: presenter ticks only, with no unattended runner.
- Q13: identifiers never change within a run; reset makes new ones (FUCQ-85).

Reset never touches the immutable corpus or any operational provider (HLD).

#### Out of scope

The presenter control screen (the presenter controls Story in FUCQ-75); the scenario walkthroughs themselves (the replay Stories in FUCQ-75 and FUCQ-109); new reset mechanics.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-scenarios.test.js`: these pass:

    - the catalogue shape;
    - reset into each listed scenario through FUCQ-85;
    - two resets into the same scenario giving the same state with new identifiers;
    - the previous run left stale;
    - the "not available yet" outcome;
    - presenter-only refusal.

- `npm test` passes.
- Backend-only: no screen. Record the catalogue and scenario-reset response shapes as fixtures for the presenter controls (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-126](https://ibm-consulting.atlassian.net/browse/FUCQ-126) · Give the presenter controls for ticks, releases, reset, scenarios and role

```text
id: FUCQ-126
title: Give the presenter controls for ticks, releases, reset, scenarios and role
kind: ui
design_impact: yes
ui: el, renderOptionList (scenario and principal pickers); button and statusScreen (both listed under "Not yet in the kit"; reuse them if already added); FUCQ-64's portalShell; new: presenterBar, because no kit component gives a compact control strip with run and clock read-back
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-75, HLD readiness section C9)
epic: FUCQ-75
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: M
depends_on: FUCQ-125, FUCQ-64, FUCQ-92
```

#### Goal

As the presenter, I want one small set of controls to move time on, release stock, reset, pick a scenario and switch who I am acting as, so that I can run the 12 November walkthrough on cue without typing commands.

#### Acceptance criteria

- [ ] **Controls:** a presenter control block, available only to the presenter role, offers:

    - **Tick:** advance by the policy's step, or to a named time, through FUCQ-85;
    - **Next release:** a tick that runs FUCQ-92's release handler, showing how many cars appeared;
    - **Reset:** reset into the current or a chosen scenario through FUCQ-125, with a confirmation step;
    - **Scenario picker:** FUCQ-125's catalogue, with the "not available yet" state for scenarios whose capabilities are missing;
    - **Acting principal:** switch between Paula, the competing employees and Greg through FUCQ-84's server-issued session, with no ID in the URL.

- [ ] **Read-back:** the block always shows the current scenario, run ID, demo-clock time, acting principal and last tick outcome, including each handler's result in order.
- [ ] **Safe actions:** each action is idempotent by command ID, so a double click or a retry returns the original outcome. A failed or refused action shows its reason, and the screen never claims an outcome the backend did not report.
- [ ] **Placement:** the controls sit in a compact strip or drawer within FUCQ-64's shell. They can be collapsed during the walkthrough, and are hidden entirely for non-presenter roles. Switching principal reloads the employee or Greg surface with the new server context.
- [ ] **States:** idle, action in progress, tick result, reset done (new run), scenario not available yet, refused, and backend unavailable.
- [ ] **Kit and embedding (Q18):** built from the shared kit. New components go into the kit, `COMPONENTS.md` and the gallery in the same commit, and the ratchet baseline only falls. Mounts as a custom element, with no inline scripts, inline handlers or `eval`. Keyboard operable throughout, with visible focus.

#### Files or areas

- `blocks/gcsp/ (proposed presenter control block)`
- `COMPONENTS.md`, kit gallery, `server/test/ui-ratchet.json`
- `server/test/ (render test for the presenter controls)`
- `docs/gcsp/manual-acceptance-scenarios.md (how to use the controls)`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026, and placed this Story at P2 because the presenter needs it to run the walkthrough (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). FUCQ-85 explicitly leaves the presenter control UI to FUCQ-75. Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md` (demo clock, reset and presenter navigation), `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`, `docs/gcsp/screens/README.md`, `COMPONENTS.md`, `docs/gcsp/shared-contracts.md` (FUCQ-80) and `docs/design/gcsp-high-level-design.md`, "Demo access and offer links" and "Transaction and event invariants". Carry the experience contract, the visual reference and these criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q3: presenter ticks, with no unattended runner.
- Q8: a separate GCSP block.
- Q18: custom element and CSP.
- Q9: the presenter needs this to run Gary's critical path, but FUCQ-109 proves the path through the presenter routes directly and does not wait on this Story.

#### Out of scope

New clock, tick, reset or identity mechanics (FUCQ-85, FUCQ-84); the outbox viewer (FUCQ-97); scenario walkthroughs.

#### Validate

Run commands from the worktree root.

- `npm test` passes, including the UI ratchet, the em-dash test and a render test for the presenter controls (hidden for non-presenter roles).
- Browser evidence at desktop and narrow (375 px) widths, with keyboard-only operation, of these states: idle with read-back, after a tick, after a release, reset into another scenario, scenario not available yet, switching from Paula to Greg and back, refused, and backend unavailable. Record the screenshot paths (`docs/gcsp/experience-quality.md`).

---

### [FUCQ-127](https://ibm-consulting.atlassian.net/browse/FUCQ-127) · Replay the no-suitable-match scenario

```text
id: FUCQ-127
title: Replay the no-suitable-match scenario
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-75, HLD readiness section C9)
epic: FUCQ-75
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: S
depends_on: FUCQ-126, FUCQ-95, FUCQ-96
```

#### Goal

As Russell, I want to replay an employee whose brief no released car can meet, so that I can check she understands why there is no offer and what she can still do.

#### Acceptance criteria

- [ ] **Fixture and catalogue entry:** a versioned "no suitable match" start state in FUCQ-125's catalogue: an employee whose confirmed essentials no car in the next release can meet (for example a towing or seating essential), alongside a competing employee who does match.
- [ ] **What happens:** after Next release, allocation (FUCQ-96) makes no offer for her, by calculation and not by a fixture flag, and the competitor still gets his offer. Her activity view (FUCQ-95) shows "searched, no suitable match yet", the essential or gate that excluded the cars, and what she can do next (keep searching, review the brief). It never shows an empty error.
- [ ] **Greg's side:** her unmet need appears in FUCQ-99's figures under the blocking gate.
- [ ] **Replay test:** an automated replay drives the scenario through the presenter and employee routes after a reset, and asserts these outcomes twice, across two resets.
- [ ] **Manual scenario:** the scenario's entry in `docs/gcsp/manual-acceptance-scenarios.md` follows FUCQ-125's format, with start state, presenter steps, click-through, expected result, provisional assumptions and the observations table.

#### Files or areas

- `server/gcsp/fixtures/scenarios/ (no-suitable-match start state)`
- `server/test/gcsp-scenario-no-match.test.js (proposed)`
- `docs/gcsp/manual-acceptance-scenarios.md`
- `docs/gcsp/evidence/fucq-75/ (screenshots)`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` ("Repeatable manual trials"), `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/manual-acceptance-scenarios.md` ("No suitable match") and `docs/design/gcsp-high-level-design.md`, "Paula's version-4 blueprint". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q3: presenter ticks drive the release.
- Q9: FUCQ-109 supplies the main successful journey; this is a difficult case.

The scenario exercises the real services. If a screen defect shows up, it is fixed in the owning Story or raised as a Bug, not patched in the fixture.

#### Out of scope

New allocation or activity behaviour (FUCQ-96, FUCQ-95); the main successful journey (FUCQ-109).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-scenario-no-match.test.js`: the calculated no-offer, the competitor's offer, the activity reason, Greg's unmet-need count and the repeat after a second reset all pass.
- `npm test` passes.
- Browser evidence at desktop and 375 px, with keyboard operation, of her activity view after the release, saved under `docs/gcsp/evidence/fucq-75/` (`docs/gcsp/experience-quality.md`).
- Russell can run the scenario from the presenter controls (FUCQ-126).

---

### [FUCQ-128](https://ibm-consulting.atlassian.net/browse/FUCQ-128) · Replay the decline-then-change scenario

```text
id: FUCQ-128
title: Replay the decline-then-change scenario
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-75, HLD readiness section C9)
epic: FUCQ-75
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: S
depends_on: FUCQ-126, FUCQ-107
```

#### Goal

As Russell, I want to replay a decline followed by one preference change, including the case where no second offer comes straight away, so that I can refine how the follow-up feels beyond the happy path.

#### Acceptance criteria

- [ ] **Fixture and catalogue entry:** a versioned "decline then change" start state in FUCQ-125's catalogue, with Paula holding a first offer. It has two variants:

    - a later release contains a car that suits the changed brief;
    - no released car suits it yet.

- [ ] **What happens:** Paula declines with a typed reason and confirms one preference change (FUCQ-107, Q16). The declined car is excluded from her later offers by employee policy, and it returns to the pool for others. Then:

    - in the first variant, the next release gives a second offer that reflects the change;
    - in the second, her screens show "change saved, waiting for the next release", with no offer.

- [ ] **Separate records:** the decline, the brief change and any later satisfaction are separate records. The decline is not treated as an expiry.
- [ ] **Replay test:** an automated replay drives both variants through the presenter and employee routes after a reset, and asserts these outcomes twice, across two resets.
- [ ] **Manual scenario:** the scenario's entry in `docs/gcsp/manual-acceptance-scenarios.md` follows FUCQ-125's format, for both variants.

#### Files or areas

- `server/gcsp/fixtures/scenarios/ (decline-then-change start states)`
- `server/test/gcsp-scenario-decline-change.test.js (proposed)`
- `docs/gcsp/manual-acceptance-scenarios.md`
- `docs/gcsp/evidence/fucq-75/ (screenshots)`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` ("Repeatable manual trials"), `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/manual-acceptance-scenarios.md` ("Reject and change the brief") and `docs/design/gcsp-high-level-design.md`, blueprint columns 05 to 09 and "Transaction and event invariants". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q16: one preference change after a decline, not a contribution ceiling.
- Q3: presenter ticks drive the releases.

FUCQ-109 covers the case where the second offer arrives; this Story adds the waiting variant and makes both replayable from the catalogue. If a screen defect shows up, it is fixed in the owning Story or raised as a Bug, not patched in the fixture.

#### Out of scope

New decision or change behaviour (FUCQ-106, FUCQ-107); a contribution ceiling.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-scenario-decline-change.test.js`: both variants, the declined-car exclusion, the car returned to the pool, the separate records and the repeat after a second reset all pass.
- `npm test` passes.
- Browser evidence at desktop and 375 px, with keyboard operation, of the waiting state and the second offer, saved under `docs/gcsp/evidence/fucq-75/` (`docs/gcsp/experience-quality.md`).
- Russell can run both variants from the presenter controls (FUCQ-126).

---

### [FUCQ-129](https://ibm-consulting.atlassian.net/browse/FUCQ-129) · Replay the offer-expiry scenario

```text
id: FUCQ-129
title: Replay the offer-expiry scenario
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-75, HLD readiness section C9)
epic: FUCQ-75
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: S
depends_on: FUCQ-126, FUCQ-106
```

#### Goal

As Russell, I want to let an offer run out on purpose and then reopen its old link, so that I can check the expiry is real, the car moves on and the old email tells the truth.

#### Acceptance criteria

- [ ] **Fixture and catalogue entry:** a versioned "offer expires" start state in FUCQ-125's catalogue: Paula holds a buddy offer with its captured email, and a competing employee whose brief also fits that car is waiting.
- [ ] **What happens:**

    1. The presenter ticks past the hold's expiry, a policy duration (Q15).
    2. FUCQ-106's expiry handler marks the offer expired.
    3. The car returns to allocation, and on the same or the next tick the waiting employee is offered it.
    4. Paula's offer page, opened from the old email link (FUCQ-102), shows "expired" from the backend. A browser countdown or a refresh never revives the hold.

- [ ] **Not a dislike:** the expiry is recorded as an expiry. It is not a decline or dislike, and gives Paula no priority entitlement.
- [ ] **Replay test:** an automated replay drives the scenario through the presenter and employee routes after a reset, and asserts these outcomes twice, across two resets. An old link from the earlier run is refused as stale.
- [ ] **Manual scenario:** the scenario's entry in `docs/gcsp/manual-acceptance-scenarios.md` follows FUCQ-125's format.

#### Files or areas

- `server/gcsp/fixtures/scenarios/ (offer-expiry start state)`
- `server/test/gcsp-scenario-expiry.test.js (proposed)`
- `docs/gcsp/manual-acceptance-scenarios.md`
- `docs/gcsp/evidence/fucq-75/ (screenshots)`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md` (demo clock and reset), `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` ("Repeatable manual trials"), `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/manual-acceptance-scenarios.md` ("Offer expires") and `docs/design/gcsp-high-level-design.md`, "Demo access and offer links" and "Transaction and event invariants". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q3: presenter ticks, so expiry happens on a tick, not on a timer.
- Q15: the buddy offer hold duration is a keyed policy value, labelled a proposed new capability.

If a screen defect shows up, it is fixed in the owning Story or raised as a Bug, not patched in the fixture.

#### Out of scope

New expiry or allocation behaviour (FUCQ-106, FUCQ-96); the manual cart hold's expiry (FUCQ-66, FUCQ-73).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-scenario-expiry.test.js`: the expiry on a tick, the reallocation, the old link showing expired, no revival, the expiry record and the repeat after a second reset all pass.
- `npm test` passes.
- Browser evidence at desktop and 375 px, with keyboard operation, of the expired offer page opened from the old link, saved under `docs/gcsp/evidence/fucq-75/` (`docs/gcsp/experience-quality.md`).
- Russell can run the scenario from the presenter controls (FUCQ-126).

---

### [FUCQ-130](https://ibm-consulting.atlassian.net/browse/FUCQ-130) · Replay the unavailable-data scenario

```text
id: FUCQ-130
title: Replay the unavailable-data scenario
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-75, HLD readiness section C9)
epic: FUCQ-75
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: S
depends_on: FUCQ-126, FUCQ-95
```

#### Goal

As Russell, I want to replay the stock source being unavailable, so that I can check the employee sees the difference between "nothing suitable yet" and "we couldn't check", and can carry on.

#### Acceptance criteria

- [ ] **Fault mode:** the synthetic stock adapter gains a presenter-set, run-scoped fault mode (unavailable, or stale beyond a policy age key). It is set from the scenario's fixture or the presenter controls (FUCQ-126), and cleared by the next reset. It is a synthetic adapter setting only, never a change to an operational provider.
- [ ] **Fixture and catalogue entry:** a versioned "data unavailable" start state in FUCQ-125's catalogue, with the fault set before the next release.
- [ ] **What happens:**

    - the release tick records the pull as failed, with no stock change, no offer and no allocation;
    - Paula's activity view (FUCQ-95) shows "couldn't check for new cars", which is distinct from "no suitable match yet";
    - Greg's figures show the source unavailable rather than zero.

    After the fault is cleared and the next tick runs, the pull succeeds and normal allocation resumes.

- [ ] **No false outcomes:** an unavailable or stale pull never counts as an empty pool, never frees or takes a car, and never changes priority.
- [ ] **Replay test:** an automated replay drives the scenario after a reset, and asserts these outcomes twice, across two resets.
- [ ] **Manual scenario:** the scenario's entry in `docs/gcsp/manual-acceptance-scenarios.md` follows FUCQ-125's format.

#### Files or areas

- `server/gcsp/ (synthetic stock adapter fault mode, alongside FUCQ-92's release)`
- `server/gcsp/fixtures/scenarios/ (data-unavailable start state)`
- `server/test/gcsp-scenario-unavailable.test.js (proposed)`
- `docs/gcsp/manual-acceptance-scenarios.md`
- `docs/gcsp/evidence/fucq-75/ (screenshots)`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` ("Render useful loading, empty, no-match, validation/error ... states"), `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/manual-acceptance-scenarios.md` ("Data unavailable") and `docs/design/gcsp-high-level-design.md`, "Vehicle evidence and adapter contracts" and "Transaction and event invariants". Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q3: presenter ticks.
- Round-1 finding: release is stock appearing on the next pull, so a failed pull is the realistic fault.

If a screen defect shows up, it is fixed in the owning Story or raised as a Bug, not patched in the fixture.

#### Out of scope

Live provider outages; new activity or dashboard screens (FUCQ-95, FUCQ-101).

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-scenario-unavailable.test.js`: the failed pull with no state change, the distinct unavailable outcome, Greg's unavailable figure, recovery after the fault clears, the fault cleared by reset and the repeat after a second reset all pass.
- `npm test` passes.
- Browser evidence at desktop and 375 px, with keyboard operation, of Paula's "couldn't check" state beside the "no suitable match yet" state, saved under `docs/gcsp/evidence/fucq-75/` (`docs/gcsp/experience-quality.md`).
- Russell can run the scenario from the presenter controls (FUCQ-126).

---

### [FUCQ-131](https://ibm-consulting.atlassian.net/browse/FUCQ-131) · Replay the uncertain-handoff scenario

```text
id: FUCQ-131
title: Replay the uncertain-handoff scenario
kind: code
design_impact: yes
requested: 2026-11-04, by Gary via Claude Code (backlog FUCQ-75, HLD readiness section C9)
epic: FUCQ-75
priority: P2
priority_reason: due 2026-11-12: GCSP demo
size: S
depends_on: FUCQ-126, FUCQ-108
```

#### Goal

As Russell, I want to replay an order handoff whose result is uncertain, so that I can check Paula sees an honest pending status with an owner, and the car is neither lost nor double-booked.

#### Acceptance criteria

- [ ] **Fault mode:** the synthetic ordering adapter gains a presenter-set, run-scoped mode for one handoff, either a timeout or an uncertain response. It is then resolved on a later reconciliation tick as either acknowledged or rejected. It is set from the scenario's fixture or the presenter controls (FUCQ-126), and cleared by the next reset.
- [ ] **Fixture and catalogue entry:** a versioned "uncertain handoff" start state in FUCQ-125's catalogue, with Paula about to accept an offer. It has two variants: resolved as acknowledged, and resolved as rejected.
- [ ] **What happens:**

    1. Paula accepts and the handoff (FUCQ-108) times out. Her screens show "pending with ordering", who owns the next step, and that nothing needs doing yet.
    2. The car stays held for her and is not offered to anyone else.
    3. The presenter ticks, and FUCQ-85's reconciliation resolves the pending operation before any retry.
    4. Acknowledged: the target state names (Q19) appear. Rejected: the screen gives the stated outcome and what happens to the car.

- [ ] **No false outcomes:** an uncertain write never shows as success, never frees the car and is never retried before it is reconciled.
- [ ] **Replay test:** an automated replay drives both variants after a reset, and asserts these outcomes twice, across two resets.
- [ ] **Manual scenario:** the scenario's entry in `docs/gcsp/manual-acceptance-scenarios.md` follows FUCQ-125's format, for both variants.

#### Files or areas

- `server/gcsp/ (synthetic ordering adapter fault mode, alongside FUCQ-108's handoff)`
- `server/gcsp/fixtures/scenarios/ (uncertain-handoff start states)`
- `server/test/gcsp-scenario-uncertain-handoff.test.js (proposed)`
- `docs/gcsp/manual-acceptance-scenarios.md`
- `docs/gcsp/evidence/fucq-75/ (screenshots)`

#### Decided

Gary approved this Epic's Stories, their titles and the dependency order on 4 November 2026 (`docs/design/handover-section-c7-c9-2026-11-04.md`, C9; `docs/design/hld-story-readiness-2026-11-04.md`, section C; equal-authority rule, `AGENTS.md`). Read `docs/gcsp/README.md`, `docs/gcsp/demo-brief.md`, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md` ("Repeatable manual trials"), `docs/gcsp/shared-contracts.md` (FUCQ-80), `docs/gcsp/manual-acceptance-scenarios.md` ("Uncertain order handoff") and `docs/design/gcsp-high-level-design.md`, "Greg's supply loop" (the lifecycle paragraph) and "Transaction and event invariants" (remote authority and reconciliation). Carry these decisions and acceptance criteria into every child-agent brief.

Foundation (FUCQ-79):

- Store state through FUCQ-81's repository, with additive migrations recorded in `shared-contracts.md`.
- Read every rule, duration and assumption through FUCQ-82's PolicyService by key, never as local literals.
- Take the principal, role and run from FUCQ-84's server-owned context.
- Read time from FUCQ-85's demo clock.

HLD review (`docs/design/hld-review-gc.md`), as it applies here:

- Q19: the target platform's approval and appointment state names.
- Q14: the AWS target platform. A live adapter reports unsupported writes rather than pretending success.
- Q3: reconciliation runs on presenter ticks.

If a screen defect shows up, it is fixed in the owning Story or raised as a Bug, not patched in the fixture.

#### Out of scope

New handoff or lifecycle behaviour (FUCQ-108, readiness item C7); live ordering writes.

#### Validate

Run commands from the worktree root. Named new test files are deliverables of this story.

- `node --test server/test/gcsp-scenario-uncertain-handoff.test.js`: these pass:

    - pending on a timeout;
    - the car kept held, with no reallocation;
    - no retry before reconciliation;
    - both resolutions;
    - the target state names;
    - the repeat after a second reset.

- `npm test` passes.
- Browser evidence at desktop and 375 px, with keyboard operation, of the pending state and both resolutions, saved under `docs/gcsp/evidence/fucq-75/` (`docs/gcsp/experience-quality.md`).
- Russell can run both variants from the presenter controls (FUCQ-126).

---
