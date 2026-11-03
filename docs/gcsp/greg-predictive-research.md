# Greg's next decision: predictive research

Research and refinement record, 2 November 2026. After reviewing this proposal, Russell approved the capability and requested both a backlog item and an HLD update. It is recorded as [FUCQ-74](https://ibm-consulting.atlassian.net/browse/FUCQ-74), with [architecture/contracts](../design/gcsp-high-level-design.md#gregs-next-best-order-fucq-74) and page **08 Predictive order planning** in the canonical HLD. The capability is authorised; the exact model, training runtime, solver and implementation stories remain for refinement. This recording does not start implementation, model training or pollers.

Russell's confirmed objective in the current discussion: Greg decides his next best action to place as close as possible to the right list of cars; the dashboard should supply and curate the evidence for that decision. The decision can concern the requested future mix, a response to Production's constraints or existing unallocated stock. Those are related decisions with different inputs and time horizons.

## Was ML proposed before?

**Yes, explicitly.** The retained research describes three predictive uses. These are historical proposals, not evidence that a model was trained or deployed.

| Retained source | Explicit proposal | Proposed inputs and controls | Limits of the evidence |
|---|---|---|---|
| “IBM x BMW Employee Car Scheme”, deck last modified **31 October 2024** | Predict an employee's next desired car, then order the desired cars. The preferred process replaces the rush with ranked first/second/third choices and a later satisfaction score out of ten. | Ideal preference, ranked alternatives, later satisfaction; changes in eligibility and vehicle models must be accommodated. A fallback treats the earliest roughly 25% of Monday selections as less constrained, while recognising bias and discarded observations. | The summary does not name an algorithm, training population/size, validation design, accuracy measure, loss function or achieved result. “Until employees always get desired car” is an aspiration in the proposal, not a demonstrated outcome. [Background:78–110](background.md#L78). |
| “ECS User Stories & Process Map”, deck last modified **11 March 2025** | Greg sees an **ML-calculated list of cars to order**. His model minimums/maximums change the list. After Production replies, the **ML allocates the actual available cars to employees by best match**. | Early employee choices, model quantity bounds and Production's confirmed availability. Employee stories ask for three choices; the illustrated email asks for five. Greg submits the final list. | This combines demand prediction, constrained order planning and allocation under the label ML without specifying their separate algorithms, objective, fairness rule, uncertainty or evaluation. The March/April/May dates form the illustrative process timeline, not evidence of a live rollout. [Background:112–144](background.md#L112). |
| October/November 2024 discovery note, last edited **7 November 2024** | Use stock-management data to train a model to predict vehicles likely to remain unselected in the employee funnel. | Records of vehicles left unallocated and moved to another channel. The notes report 40–50 vehicles per review and reviews a couple of times a month. | A possible use of data, not an available labelled extract or demonstrated classifier. Those counts and channel arrangements are dated observations. The stock-management summary is attributed to this note. [Background:146–167](background.md#L146). |

Provenance matters: these findings use the repository's retained summaries. The original private Box decks/note were not reopened for this investigation. The source register also qualifies the proposals as historical and distinguishes the summary from direct reinspection. [Source register E6:62–70](personas/sources.md#L62), [E9:89–95](personas/sources.md#L89), [discovery evidence limits:35–44](discovery-findings.md#L35).

## What data was proposed, and what is available here?

The historical note explicitly says **historic data is available, plus the future vehicle pipeline**. It also records a historical vehicle view in GCSO. It does not provide a current API contract, export, schema, row count, time coverage or permission to use those records for training. That is evidence of reported historical existence, not proof of present access or ML readiness. [Background:206–208](background.md#L206), [253–254](background.md#L253).

| Information | Evidence and current limit |
|---|---|
| Historical employee selections and renewal cohorts | Greg reportedly used contract ends, selected vehicles, a pivot table and the Spec Matrix. No employee-level training extract was found in this repository review. [Background:256–270](background.md#L256). |
| Ideal demand, acceptable alternatives and satisfaction | Proposed as additional observations precisely because orders alone omit unmet demand. The retained material does not establish that ranked preference/satisfaction collection happened or supply resulting records. [Background:86–105](background.md#L86), [discovery:66–68](discovery-findings.md#L66). |
| What the employee could actually obtain | Production responses, released inventory, eligibility, prices/points, dates and alternatives available at the choice time are necessary context for interpreting a selection. The existing research distinguishes these observations but does not supply a joined historical dataset. [Business analysis:42–44](business-model-exploration.md#L42), [discovery:68](discovery-findings.md#L68). |
| Eligibility and costs | October 2024 model/engine matrices are the agreed demo baseline; they contain neither points prices nor allowances. Test screenshots contain junk data. These are useful rule/flow evidence, not training labels or valid historical commercial terms. [Discovery:38–40](discovery-findings.md#L38), [48–58](discovery-findings.md#L48). |
| Stock-management outcomes | The note proposes learning from unallocated/channel-transfer records, but no extract establishes exposure duration, availability, selection opportunity or reasons for transfer. [Background:148–155](background.md#L148). |
| Current repository software/data | The implemented retail ranker applies explicit hard filters, dimension scorers, weighted sums and deterministic sorting. It is not a trained predictor. `server/data.js` contains indicative vehicle attributes, not employee choice/outcome observations. [Engine:620–689](../../server/engine.js#L620), [vehicle fixture:1–23](../../server/data.js#L1), [reuse assessment:25–39](engine-reuse-assessment.md#L25). |

A bounded repository search checked filenames for training/model artefacts and common dataset/model formats, plus ML/training terms in `docs`, `server` and `scripts`. It found the historical proposals, design discussion and the Mural's process-note CSV, but no employee training dataset, training pipeline or trained model artefact. This is a repository finding, not an assertion about BMW's systems, private storage or uninspected external materials. Dependencies inspected were the root and server `package.json`; neither declares a model-training library. A library's absence alone would not establish absence of ML.

The proposed shared recommendation design explicitly describes future architecture rather than completed extraction/employee implementation. It retains deterministic evaluation and separately versioned employee calibration. The planned synthetic VIN/configuration corpus supplies vehicle facts, not observed employee preferences, acceptance or satisfaction labels. [Shared design:1–3](shared-recommendation-design.md#L1), [24–30](shared-recommendation-design.md#L24), [52–56](shared-recommendation-design.md#L52); [HLD vehicle corpus:85–89](../design/gcsp-high-level-design.md#L85).

## What constrains Greg's next best action?

The dated process asks Greg to request the mix **before final employee selection**. Production may supply only part of that request. In the November 2024 example he requests cars on 1 November for March 2025 renewals; employee selection opens later, on 1 December. Asking only at release cannot repair that earlier planning decision. [Background:256–268](background.md#L256), [Mural summary:285–300](background.md#L285).

Greg balances employee suitability and satisfaction with timely renewals, manual workload, unwanted stock, throughput and residual exposure. The research does not establish that he can unilaterally alter eligibility, points, Production capacity or allocation policy. Numeric KPI definitions/targets remain unverified. [Ordering persona:24–46](personas/scheme-ordering-lead.md#L24). Predicting last year's constrained selections accurately could still request the wrong mix; historical selection is not the same target as unmet preference or satisfaction. [Discovery:68](discovery-findings.md#L68).

The current HLD separates **requested mix → provider-confirmed supply → released exact stock**. Greg should see unmet needs, declines, expiries, holds and accepted selections across the whole relevant population, rather than the few displayed retail recommendations. A what-if preview differs from a published policy or submitted request. [HLD:93–99](../design/gcsp-high-level-design.md#L93).

Commercial consequences require their own evidence: the future return cohort changes when volume/specification/timing changes. A single fixed residual per model cannot establish the economics of a proposed new mix. The business-model discussion therefore evaluates complete alternatives and keeps lifecycle costs and used-market assumptions explicit; it is analysis, not a validated forecast. [Business model:136–156](business-model-exploration.md#L136).

## Implications for the options discussion

The earlier research supports considering ML; it does not yet establish which predictive target is learnable from accessible records. Distinguish the three questions before selecting an algorithm:

1. **Demand:** what suitable cars would employees accept at stated terms and dates, including alternatives they have not selected historically?
2. **Decision:** given demand, quantity bounds, feasible supply and business constraints, which requested mix/action offers the best trade-off?
3. **Risk:** which released cars are likely to remain unallocated, and what feasible action reduces that risk?

Prediction can inform a decision without deciding the business trade-off. A non-trained baseline can calculate current expressed demand and compare feasible mixes; the learned estimate must be tested against that baseline. FUCQ-74 includes a synthetic learned demonstrator if real records are not yet accessible; claims of real calibration require suitable observations. Demo calculations retain explicit assumptions, the shared canonical policy source and functioning adapter-backed decisions. [Build rules](build-rules.md#L11), [brief boundaries](demo-brief.md).

## Approved capability and refinement direction

**Learned demand/choice prediction feeding constrained order planning is the approved FUCQ-74 capability.** Russell confirmed the next-best-action objective and approved this direction. The following contracts shape refinement; exact algorithms remain choices to validate. An aggregate expressed-demand baseline remains available for comparison and operation when a learned provider is unavailable or insufficiently evidenced.

| Part | Question answered | Proposed output |
|---|---|---|
| Demand/choice predictor | For employees due to renew in the planning horizon, which suitable vehicles would they choose or accept at these terms and dates? | A probability distribution over the relevant alternatives, including waiting/no acceptable choice; aggregate demand and uncertainty by vehicle class and period. |
| Constrained planner | Given that demand, existing stock, confirmed inbound supply, lead times and business constraints, which order quantities should Greg request? | Recommended model/derivative quantities, predicted coverage/unallocated risk, unmet needs, binding constraints and comparison with his current draft. |
| Decision surface and feedback | What is Greg's next useful action, why, and what changes if his constraints change? | A curated proposed order request, editable quantity bounds, assumptions/uncertainty and alternative plans. Recompute after a Production response and retain Greg's intentional submission. |

This separates prediction from the chosen business objective. Predict-then-optimise is an established formulation in which predictions inform a subsequent constrained decision; downstream decision quality can differ from raw predictive accuracy. [Elmachtoub and Grigas, Smart Predict, then Optimize](https://arxiv.org/abs/1710.08005). Integer optimisation provides a way to express indivisible counts, constraints and a decision objective; a particular solver or new runtime dependency is not selected here. [Google OR-Tools: mixed-integer optimisation](https://developers.google.com/optimization/mip).

### Candidate first learned model

Start the investigation with an interpretable, regularised discrete-choice model, initially a conditional/multinomial-logit specification using vehicle attributes and interactions with employee preferences/needs. This model family estimates choice probabilities over an explicitly defined choice set from observed choices and attributes. Its assumptions about substitution between similar alternatives must be checked; the basic logit model's independence-of-irrelevant-alternatives assumption can be restrictive. [Kenneth Train, Discrete Choice Methods with Simulation, chapter 3](https://eml.berkeley.edu/books/choice2nd/Ch03_p34-75.pdf).

Proposed features include stated preferences and importance, approved practical needs, current-car feedback, vehicle body/space/powertrain/equipment, contribution/points, timing and the alternatives actually offered or available. Keep eligibility, essential needs and entitlement checks in the existing authoritative services. The learned model estimates response among permitted choices; it does not acquire authority to relax those gates. Known renewal dates and confirmed supply remain facts rather than quantities the model must guess.

A feature-based specification is worth testing for model-range changes, while assessing performance separately on vehicle classes and employee cohorts absent from training. New ranges outside the training coverage should retain visible uncertainty. A stock non-selection risk output is useful, but should first be derived/tested through the same demand/planning scenario rather than introducing an unrelated classifier without evidence it adds value.

### What the learning records need

Each real observation should join the relevant employee/entitlement and renewal period with the stated brief, terms, eligible/available choice set and exposure, the offered/selected car or wait/no-choice result, and timestamps. Keep acceptance, rejection reasons, expiry/no response and later after-use satisfaction distinct. History without the alternatives and prices available at the time cannot establish the unconstrained preference target identified by the original research.

The planned configuration corpus is useful vehicle-feature coverage; its 10,000 configurations do not provide 10,000 observed employee choices. The proposed preference capture and offer services can create richer future learning records. The next data check is a small accessible, appropriately anonymised historical extract with field definitions and joins, not an assumed entitlement to all historical systems. This check informs real calibration and need not prevent a synthetic demonstrator under the build rules.

For a synthetic demonstrator, generate plausible multi-cycle choice/outcome records, train a real model and test it on separately generated held-out cycles/cohorts. Include noisy responses, no-choice outcomes and supply constraints. Report the synthetic origin and generating assumptions. Performance against that generator demonstrates learning and pipeline behaviour within its assumptions; it does not validate predictions about BMW employees. Historical orders and pipeline availability remain reported evidence until a usable extract is obtained.

### Define and test the decision's usefulness

A proposed starting objective is timely acceptable coverage of the renewal cohort while controlling unwanted stock and respecting the chosen commercial/supply constraints. Greg can inspect alternative plans where objectives conflict. Keep the objective weights, bounds, fallback assumptions and active model reference in the one canonical policy/assumptions source required by [the build rules](build-rules.md). Learned coefficients and training metadata belong to an immutable versioned model artifact referenced from that source; they are not separately maintained business-policy defaults.

Validate predictions on later, held-out periods and assess new cohorts separately. Compare the learned predictor with expressed-demand aggregation and a baseline using the existing deterministic fit calculations. Probability quality can be examined through calibration and appropriate probability scores such as log loss/Brier score, alongside reliability plots; these measures evaluate probabilities rather than proving that a recommended fleet mix is useful. [scikit-learn: probability calibration](https://scikit-learn.org/stable/modules/calibration.html).

Then evaluate whole plans through the same shared allocation/event services: suitable coverage before renewal, unused vehicles, observed or simulated offer acceptance, contributions and the selected cost/return assumptions. Count each entitled employee/slot consistently; independent per-car interest scores must not be added as if one employee would take every car. Model competition and substitution when stock runs out. Keep original demand, changes caused by presentation/points and confirmed acceptance distinct; changing recommendation weights alone does not demonstrate that underlying preferences changed. Price/nudge response inferred from observational history is an assumption for counterfactual scenarios until its causal interpretation is supported.

The dashboard should lead with a proposed action and order list, then expected consequences, uncertainty, constraints and alternatives. When data does not support a reliable recommendation it should show that limitation and the available baseline result. A request to Production remains a request; only its acknowledgement establishes confirmed supply, and actual release establishes selectable stock.

### Alternatives considered

- **Expressed-demand aggregation plus scenario planning:** transparent baseline using current preferences and rules. Useful without training labels, with learning behaviour demonstrated separately when a trained provider is introduced.
- **Learned choice model plus constrained planner:** recommended investigation because it directly connects forecast employee responses to Greg's procurement decision and the historical min/max-control proposal.
- **A more complex nonlinear predictor:** compare only if accessible data and held-out results justify it. The model remains behind the same prediction contract so its replacement does not rewrite Greg's workflow.

FUCQ-74 now records the approved learned-model/planner direction, and the HLD specifies its provider contracts, versions and evaluation/decision boundaries. Refine its implementation stories through the existing process. Alternative algorithms remain candidates rather than separate authorised capabilities. The existing decision to avoid a site LLM does not prohibit a trained statistical model.

## Investigation record

The initial delegated repository-only review on 2 November 2026 produced the historical/source/data findings above. The parent subsequently added the model/planner proposal and checked the cited primary ML/optimisation sources. That investigation changed no application code, tests or Jira records and trained no model or validated any performance claim. The parent linked the discussion and recorded Russell's objective in the brief, context index and readiness review. Following Russell's approval, FUCQ-74 was created and read back, and the canonical HLD, brief and context index were updated to record the authorised capability. Implementation and model training have not started through this recording task.

Agent role: implementer / Sonnet. Requested and selected `gpt-6.1-sol` / `medium`, no fallback; effective runtime settings not independently verified. No descendants.
