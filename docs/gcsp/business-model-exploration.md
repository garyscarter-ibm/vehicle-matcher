# Employee car scheme: business model exploration

31 October 2026. Discussion prompted by Russell's ideas after the three personas were drafted. These are hypotheses and recommendations for discussion, not approved business policy, a product specification or an implementation plan.

**Discussion boundary:** Agree the business/product shape and bounded backlog items with Russell before discussion-driven Jira updates. FUCQ-2 is the entry point to this conversation. On 1 November Russell authorised housekeeping and five foundation items: FUCQ-4 to FUCQ-8 were repurposed; FUCQ-9 to FUCQ-12 were retired as superseded. Further product capabilities remain proposals. Discussion and questions stay in this repository; all scaffolding remains on.

**Demo purpose:** Russell has clarified that this is a demonstration to BMW on 12 November, intended both to show what GCSP modernisation enables and to demonstrate IBM's AI-enabled delivery with reusable components. Bold possibilities are welcome; replaceable adapters and functioning behaviour are required. See the [demo brief](demo-brief.md) for the authoritative purpose and boundaries. This discussion evaluates the business proposition without treating live BMW deployment as the immediate deliverable.

## The proposition

Employees describe their lifestyle, taste and practical requirements before choosing a specific model. BMW can recommend several satisfying ways to meet that brief while shaping a commercially useful vehicle mix. In return, employees receive an engaging, calmer and more dependable choice. Greg gains information about the attributes employees value and more flexibility in what he requests. The platform owner gains a service whose business value and operating cost can be judged. The same vehicle mix shapes future used supply.

### Clarification after Russell's feedback

The initial analysis overemphasised a fixed set of cars employees would accept and a fixed resale outcome. Russell's proposition is more active: recommendations can help employees discover alternatives, while BMW adjusts the mix and timing of the vehicles it supplies. Both employee choices and future used-market outcomes respond to these decisions. Lifestyle and taste preferences therefore precede the model shortlist; informed acceptance remains a later check, not the starting question.

BMW can influence its contribution to future used supply, but cannot determine market-wide demand, competitor supply or realised prices. The aim is to manage exposure and cultivate satisfying alternatives, rather than assume either a residual loss from a popular car or a guaranteed return from controlling volume.

Russell also identified UK EV sales regulation as a business objective for the recommendation mix. He reports that employee-car sales contribute. The relevant regulatory concept is eligible new zero-emission registrations; BMW-specific accounting and the value of another registration require confirmation. See the [primary-source check](zev-mandate-research.md).

There are two opportunities with different economics and timing:

1. **Allocate an existing fleet better.** Improve outcomes within a fixed mix and price structure, without needing Production to supply different cars.
2. **Influence future supply.** Collect credible demand before Greg commits the requested mix, then balance it against production availability and future remarketing economics.

Preferences collected just before a release can help the first opportunity. They may arrive too late for the second. The historical process requested cars before employees selected them. [Sources 1–2](#sources)

## Why the rush does not diagnose its own cause

The rush establishes competition for available choices at the prevailing terms. It does not establish that everyone wants one model or that the entire scheme lacks enough vehicles. It is consistent with several mechanisms:

| Possible mechanism | What would distinguish it | Business implication |
|---|---|---|
| Too few cars overall | Unmet eligible renewals despite broad willingness to accept alternatives. | Matching alone cannot cover a total capacity shortage. |
| Wrong mix or specifications | Popular derivatives disappear while others remain unallocated. | Better ordering and acceptable substitutions may help. |
| Attractive relative points cost | Similar points buy noticeably different perceived value; demand changes at a different contribution. | The price structure may concentrate demand. |
| Access and uncertainty | Employees rush because waiting risks losing transport or any acceptable choice. | A more dependable allocation process can improve the benefit without changing the fleet. |
| Timing and location mismatch | Cars exist but cannot meet renewal dates or collection constraints. | Total stock counts obscure a shortage in the relevant window. |

These mechanisms can coexist. The dated notes describe both an ordering rush and unallocated cars, supporting a mismatch hypothesis, but they do not quantify today's causes. [Source 1](#sources)

Greg has a rational constraint: requesting a vehicle does not mean Production confirms it. The guidelines also explicitly allow restrictions on models, colours and options to sustain scheme viability. However, the Mural's question about whether the mix protects residual values remains a question, not an answer. There is no evidence yet that Greg simply could order more of a popular car and has chosen not to. [Sources 2–3](#sources)

The decisive evidence would follow one cohort through **employee demand at stated terms → Greg's requested mix → confirmed supply → released vehicles → accepted choices → returns and disposal**. Each gap has a different owner and remedy.

## The exchange between the personas

| Role | Gives the scheme | Receives | A failure that would break the exchange |
|---|---|---|---|
| Employee car chooser | Early needs, acceptable alternatives, contribution limit and timing; possibly voluntary flexibility. | Less uncertainty, a suitable choice, understandable trade-offs and fair access. | Disclosing preferences causes higher personal prices, repeated compromise or a binding order they did not authorise. |
| Scheme ordering lead | A realistic vehicle mix, judgement of exceptions and coordination with Production. | Better evidence of demand, less unallocated stock and less manual work. | Receives aspirational wish lists too late to order against, while retaining responsibility for disappointment. |
| Platform IT director | Investment, operating accountability and organisational capacity for change. | Measurable business benefit at an acceptable ongoing cost and risk. | Funds another experience whose benefit is cosmetic or whose service burden grows. |

The three roles cannot settle the entire bargain alone. HR/reward and Finance need to validate benefit fairness, subsidy choices and who has authority to decide them. The commercial/residual-risk owner and remarketing team bring the next-sale perspective; Production confirms feasible supply. Bring those perspectives into validation of the three personas.

The common objective could be **more employees receiving a car they are happy to use, within an agreed lifecycle cost and risk budget**. That permits deliberate subsidy for employee value. It does not imply maximising employee first choices, scheme contribution or used-car prices separately. Some trade-offs will remain; the business must decide which to fund.

## Advance preferences and proactive selection

This is the strongest initial hypothesis when it begins with what makes a car appealing and useful to the employee, rather than a list of named models they would accept. A preference profile can map to different products as the range, points, stock and business priorities change. An offer still needs to be feasible at its actual contribution and collection date; a preference is not an authorisation to commit.

Separate three layers:

1. **Practical requirements:** space, accessibility, contribution ceiling, eligibility, timing and a realistic charging/travel pattern. A business benefit cannot compensate for failing an essential need.
2. **Lifestyle and taste:** appearance, comfort, driving character, cabin experience and interest in trying something different. These are graded, overlapping dimensions, not permanent employee types.
3. **BMW's current objectives:** desired employee fleet mix, available stock, expected future return volumes, lifecycle economics and confirmed EV-registration priorities. These influence which good matches to recommend.

Russell proposes spectra for the x-or-y questions, allowing employees to place themselves between the poles. This can make preferences approachable where there is a meaningful trade-off. Distinguish **position** from **importance**: the midpoint could mean a desired balance, wanting both qualities or not caring about either. An explicit “not important” response prevents indifference being mistaken for a strong preference for moderation. Sporty appearance, brisk acceleration and a comfortable ride can coexist, so some attributes may need independent ratings rather than a forced trade-off. Vibrant paint is not evidence of wanting firm suspension. Follow-up comparisons can reveal which meaning of an adjective matters. These are discussion directions, not an agreed questionnaire or UI.

For illustration only, an eligible employee seeking a sporty appearance, restrained colour and comfortable motorway travel could find both a petrol car and an EV appealing. With suitable charging and an acceptable contribution, the EV may satisfy the same brief while supporting BMW's desired registration mix. A preference for a specific petrol model would reveal less room for that recommendation.

Russell also proposes learning from the employee's current car, combining three different kinds of evidence:

- **VIN-linked specification:** the actual model, derivative and equipment they have, where the underlying vehicle data supports those details.
- **Connected-vehicle use:** available observations such as mileage, journey patterns or charging behaviour. These provide context; mileage alone does not establish motorway use, luggage needs or EV suitability.
- **Employee feedback:** whether they like the car, which qualities work or frustrate them, and whether their needs will change for the next car.

Historical selection alone remains weak evidence of preference because choices were constrained. Explicit satisfaction combined with substantial use is a stronger starting point. [Source 4](#sources) In Russell's hypothetical example, someone loves their 5 Series Touring and has driven 20,000 miles in six months. Subject to eligibility, affordability, timing and continuing needs, another suitable 5 Series Touring should be a leading recommendation. Ask what they love about it so those qualities can also be recognised in alternatives. Repetition can be a successful outcome; a recommendation does not need novelty to create value.

The business opportunity is to preserve a successful fit while identifying acceptable flexibility. If the employee values space, refinement and long-distance comfort, another vehicle might preserve those qualities while helping BMW shape its fleet or EV mix. A business nudge needs a credible account of that fit; it should not automatically displace an already successful choice. Observed use and employee correction also help Greg distinguish enduring demand from a wish list. They do not guarantee future demand or resale outcomes.

The same evidence should inform the visuals: show the employee's current car and confirmed specification, summarise what they have said works, and explain what a recommendation retains or changes. Any usage summary should identify its period and be understandable and correctable. Where matching imagery or connected data is unavailable, avoid implying an exact VIN-level depiction or inventing usage. No screen design is agreed here.

The research says VSS can supply static vehicle data from a VIN and that Sandeep would ask Pete Thorne about access to the connected-vehicle data design. It does not establish current access, signal coverage or permission to use those signals for recommendations. [Background](background.md#ideas); see SAN-012 in the [questions for Sandeep](questions-for-sandeep.md).

Cars also need to be considered across people. Hypothetical example: two cars, X and Y; one employee is equally happy with either, another can use only X. Assigning X to the first leaves the second unserved. Assigning Y to the first and X to the second satisfies both with the same stock and prices. This demonstrates a possible allocation gain, not a measured BMW benefit.

There is an incentive problem: if claiming only one acceptable car creates priority, people may narrow their stated requirements. Equally, flexible employees will stop being honest if flexibility always earns their least-preferred option. An allocation policy should consider acceptable outcomes and repeated disappointment, alongside any first-choice rate. Hard needs and strategic claims cannot be assumed identical or effortlessly distinguished.

Advance preferences can buy **convenience** without automatically buying **priority**. Any priority advantage is a reward-policy choice. If advance matches consume the attractive cars, the manual route becomes a residual pool even if its screens remain unchanged. Both routes need an explicit account of their opportunity to obtain scarce cars, including people on shifts and those unable to answer an offer immediately.

An employee can volunteer authority within agreed limits, but a wish list alone should not create a purchase commitment. Recommendation, temporary offer and accepted order have different business consequences. Historical guidelines restrict changes/cancellation after approval. [Source 3](#sources)

## Stick or twist

This could provide agency and anticipation if it means accepting a known offer or choosing to wait for another opportunity. The employee should understand what is certain, what they give up by declining, and what remains uncertain. There is no basis yet for a promise of a better next offer or a reliable probability of getting one.

Keeping one scarce vehicle while speculating on several others gives one employee a free option at everyone else's expense. Repeated rerolls could increase holding time and put the race back into a supposedly calmer service. Any game mechanic needs to earn its place through better outcomes or enjoyment, not more visits, taps or anxiety.

If “stick” means keeping the current car longer, that is a separate commercial lever. It changes mileage, age, return timing, replacement demand and possibly resale value. An extension could be useful flexibility or an expensive delay; current authority and lifecycle effects need validation before it is presented as a choice.

My recommendation is to explore the voluntary choice and clarity first, then test whether game-like presentation adds value. An employee needing dependable family transport may value certainty more than suspense.

## Internal customers and excitement

Treating employees as internal customers is a sound service principle. The guideline explicitly describes the scheme as helping employees manage the expense of buying and running a car. But fighting for a scarce subsidised benefit does not prove that users enjoy the experience; the historical notes describe negative sentiment. [Sources 1 and 3](#sources)

Strong vehicle visuals can help employees understand and anticipate the choice. They can also help a less familiar, suitable vehicle compete on its merits. The business outcome is greater confidence and satisfaction, rather than engagement for its own sake. Making unattainable choices more desirable without improving access could increase disappointment.

The scheme should aspire to a benefit employees appreciate receiving and using, rather than a contest they feel compelled to win.

## Points pricing and nudges

Demand always exists at a price. A popular model may represent excellent perceived value at its current points, rather than a preference that would survive a higher contribution. “Higher value” also needs definition: retail price, employee desirability and low lifecycle cost are different things. An expensive car with strong used demand can cost less to cycle than a cheaper car with weak residuals.

Distinguish three policies:

1. **Published prices for a future cohort**, potentially informed by cost and demand.
2. **Published incentives for commercially useful flexibility**, such as an acceptable alternative or suitable timing.
3. **A personal price based on inferred enthusiasm or willingness to pay.**

The third risks undermining the exchange: employees may conceal demand if honesty costs them more. A popularity premium can ration by ability to top up rather than solve benefit fairness. That may be a deliberate policy, but it is not a neutral recommendation improvement.

The 2024 guideline permits changes after retail-price or scheme-cost reviews and fixes the points at ordering. It does not establish authority for popularity-based or personal pricing. Nor does a higher points figure necessarily generate equivalent incremental cash or group economic value. Confirm funding, benefit rules and ownership before claiming a financial gain. [Source 3](#sources)

The more promising hypothesis is to share the value of flexibility. An employee voluntarily accepts a car, specification or date that works for them and has a better commercial outcome for the scheme. A lower contribution could be a fair exchange if its cost is smaller than the expected benefit. Preserve genuine requirements; colour flexibility is not interchangeable with a required accessibility feature.

A nudge should make the trade-off useful and believable: an appropriate alternative, more dependable availability or an explicit incentive. Low popularity alone does not make a car suitable. Scarcity messages can even increase demand for the already popular car. Track voluntary acceptance and later satisfaction; a changed click is weak evidence that an employee's needs were met.

Keep observations of original preferences separate from responses to recommendations and incentives. Both are commercially useful: initial preferences describe the starting position; the response shows demand the scheme can cultivate under the stated offer. Planning should understand that distinction instead of treating either as an immutable wish list.

## Residuals and the second customer

The employee values use of the car under benefit terms. The future used-car buyer values owning that vehicle at a market price. They need not want the same mix, specifications or powertrains. The notes explicitly juxtapose employee interest in EVs with residual-value concerns. That is a dated observation, not a current EV-market forecast. [Source 1](#sources)

Supplying more employee favourites changes the future return cohort. More of a derivative returning together could require discounts, longer holding or another disposal route. Equally, if used demand is strong enough, that same mix could perform well in both stages. Diversity is not automatically profitable; the question is how the **additional** vehicles would sell at their return dates and volumes.

Assess the full cycle. At a scheme operating boundary, start with effective acquisition cost, add funding, insurance, maintenance, logistics, refurbishment, disposal, administration and holding costs, then subtract realised external resale receipts. Count refurbishment/disposal expenses once, either as costs or netted from receipts. Compare that cost with the scheme's actual funding and agreed value of the employee benefit. Avoid counting depreciation again when acquisition less resale already captures it. At a wider group boundary, internal transfers do not create value by themselves; keep the accounting boundary consistent.

A forecast residual, agreed employee buyback/loan settlement and the eventual external resale receipt are different quantities. The dated sources also describe the ownership chain differently: the discovery note attributes ownership to Alphabet, while the guideline describes employee purchase and subsequent buyback. Ask the commercial owner who bears each risk today. [Sources 1 and 3](#sources)

The initial £200-loss example was a static sensitivity calculation. It did not represent Russell's intended model, in which recommendations can redirect employee demand and BMW can change the volume, specification and timing of the supply that reaches the used market. It should not be read as a prediction that satisfying employees worsens resale.

A more useful comparison evaluates alternative complete mixes: how many employees they satisfy, what each mix costs, what it contributes to business objectives, and how its return volumes affect expected used proceeds and selling time. Employee popularity can coexist with strong used demand. Oversupply may reduce the marginal return, but changing the mix can manage that exposure. Forecasts must respond to the proposed supply rather than attach one fixed residual to a model regardless of volume.

Confirmed EV-compliance objectives add another term to that comparison. Extra suitable EV registrations could have value alongside employee satisfaction, but future used-EV supply and the actual manufacturer compliance position still matter. No fixed compliance value per EV is assumed.

There can nevertheless be gains without changing the mix: better assignments can improve employee satisfaction; fewer unallocated vehicles can reduce idle holding; useful timing flexibility could smooth future returns. Effects on condition, mileage or residuals must be measured, not inferred merely from satisfaction.

## How I would assess the business proposition

First establish what drives the mismatch and where Greg has discretion. Then examine whether better allocation can create more acceptable outcomes at a fixed fleet mix and published prices. That isolates the proposition from a simultaneous procurement or pricing change; it does not require a new financial model to claim that reduced uncertainty matters.

For future ordering, move the demand conversation ahead of the actual planning deadline. Validate stated preferences against the offered price, subsequent acceptance and later satisfaction. A demand survey is a signal, not a purchase commitment or perfect forecast. Include the used-market view of the return cohort before changing quantities.

Judge success jointly: acceptable employee outcomes, perceived fairness and repeat disappointment; manual exceptions and unallocated stock; total lifecycle cost, disposal timing and risk; and service cost. Publish neither a residual-improvement claim nor an employee-retention claim from preference uptake alone. A live pilot would also need to account for competition within a shared vehicle pool when comparing groups.

My strongest additional thought is to make **voluntary flexibility** the item exchanged. Employees are not just sources of demand to be managed; they can help the scheme use its available supply and shape future stock. That creates value only when they also receive a benefit they recognise. The question to settle commercially is what employee outcome BMW wants to protect, and what cost, subsidy and residual exposure it will accept to deliver it.

## Historical exploratory Jira records

These records were created prematurely during discussion using the backlog skill. Russell clarified that we should first agree the shape and then bounded backlog items. The table below preserves the original ideas and their historical keys; the links now open repurposed or superseded records. For current titles and status, use the [1 November foundation refresh](discovery-findings.md#foundation-backlog--refreshed-1-november). FUCQ-2 remains the conversation entry point. No implementation stories have been created.

| Historical Jira key | Original idea before housekeeping |
|---|---|
| [FUCQ-4](https://ibm-consulting.atlassian.net/browse/FUCQ-4) | Advance preferences and proactive selection. |
| [FUCQ-5](https://ibm-consulting.atlassian.net/browse/FUCQ-5) | Stick or twist. |
| [FUCQ-6](https://ibm-consulting.atlassian.net/browse/FUCQ-6) | Current route for people without preferences. |
| [FUCQ-7](https://ibm-consulting.atlassian.net/browse/FUCQ-7) | A more exciting employee experience. |
| [FUCQ-8](https://ibm-consulting.atlassian.net/browse/FUCQ-8) | Dynamic vehicle points pricing. |
| [FUCQ-9](https://ibm-consulting.atlassian.net/browse/FUCQ-9) | Nudges when demand concentrates. |
| [FUCQ-10](https://ibm-consulting.atlassian.net/browse/FUCQ-10) | Preferences informing Greg's orders. |
| [FUCQ-11](https://ibm-consulting.atlassian.net/browse/FUCQ-11) | Lifestyle/taste preferences and x-or-y questions. |
| [FUCQ-12](https://ibm-consulting.atlassian.net/browse/FUCQ-12) | Tuning towards EVs for UK sales targets. |

The questions behind these ideas are recorded in [questions for Sandeep](questions-for-sandeep.md), especially SAN-006 to SAN-012. Sandeep can route commercial and reward-policy questions to the owners; Russell will ask them.

## Sources

1. [Background: Box discovery note](background.md#box-note-bmw-employee-car-scheme-oct-nov-2024), October/November 2024: stock management, customer-service workload, residual-value tensions, ownership description and negative sentiment. Dated summary, not verified current operating evidence.
2. [Mural process summary](background.md#mural-board-timeline-6-7-nov-2024) and [CSV export](sources/mural/timeline-2024-11-07.csv): requested versus confirmed supply, lead times and unanswered questions about the mix. The sticky about points not varying with specification is a dated observation, not a current price table.
3. [Choices guidelines v1.6](sources/choices-car-scheme-guidelines-v1.6.md), June 2024: introduction; sections 1.1–1.2 (scheme funding/contributions), 3.1 (availability restrictions), 3.6 (price fixed at order), 3.7 (changes/cancellation), 9 (loan and buyback). Contract lengths and other current rules remain unverified; the October 2024 model eligibility matrices remain the accepted POC baseline.
4. [Earlier IBM proposals](background.md#earlier-ibm-proposal-ibm-x-bmw-employee-car-scheme-oct-2024): constrained historical choice versus true demand. Ranked-choice and allocation mechanisms in those proposals are not agreed policy.
5. [Personas and source register](personas/README.md): discovery role context and evidence limits.
6. [UK ZEV mandate research](zev-mandate-research.md), checked against Department for Transport guidance updated June 2026: general new-registration rules and limitations of the BMW-specific conclusion.

No external market forecasts or current BMW residual/points figures were used. The added EV-regulation check uses official Department for Transport guidance. Business mechanisms and suggested policies above are analysis, not claimed research findings.

## Review record

Two independent read-only reviews informed this note: fleet economics and allocation/incentives. For both, `tiers spawn reviewer --harness codex` selected reviewer/Opus, requested and selected `gpt-6.1-sol` with `high` effort; no fallback was used. These are requested tool selections; effective runtime settings were not independently reported. Neither reviewer modified files or external services.

The existing allocation/incentives reviewer also checked the spectra and current-car discussion in a read-only follow-up, using the same requested model/effort pair. Its feedback distinguishes midpoint from indifference, and observed use from satisfaction; those distinctions are reflected above. No new agent was spawned for this follow-up.

The subsequent primary-source EV-regulation check used an implementer/Sonnet task for the research note, with requested and selected `gpt-6.1-sol` / `medium` from `tiers spawn`; no fallback. It read the official PDF supplied locally by the parent and wrote only the regulation note. Effective runtime settings were not independently reported.

The supporting [argument check](business-model-argument-check.md) records the reasoning, objections and evidence gaps behind the conclusion.
