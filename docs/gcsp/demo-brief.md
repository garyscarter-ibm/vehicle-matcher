# GCSP demonstration brief — 12 November 2026

Purpose, boundaries and product direction supplied by Russell on 31 October 2026; backlog granularity, email direction and foundation work clarified on 1 November; current platform baseline corrected on 2 November. Required demo elements are recorded below. Broad organising statements are retained as hills. Russell authorised the [five foundation backlog items](discovery-findings.md#foundation-backlog--refreshed-1-november); the [product capability proposal](capability-breakdown.md) remains for later refinement. The implementation plan remains to be agreed.

## What the demonstration must achieve

**Scheme decision, Russell, 3 November:** Paula’s main demonstration uses **points-based Choices**, preserving the agreed **October 2024 eligibility matrix**. Keep other schemes’ cash/contribution rules and histories separate. The [3 November discovery update](discovery-update-2026-11-03.md) records the current question dispositions and design constraints; private technical correspondence is retained outside this public repository.

The deliverable is a demonstration to BMW on 12 November, rather than a service commissioned for employees to use operationally.

**Build direction, Russell, 2 November:** the [build rules](build-rules.md) govern full planned scope and plausible, centrally stored assumptions that can be revised through trial and improvement. Earlier stretch labels and suggestions to reduce implementation scope are superseded.

Russell has confirmed a **30-minute slot**. On 2 November he supplied the event participant workbook as the audience planning baseline. Read [demo audience planning](demo-audience.md) and the private Account Corpus register it links before shaping the narrative or assessing stakeholder perspectives; that register retains roles, attendance statuses, identity gaps and the earlier audience sketch. A working presentation recommendation is around 20 minutes of connected demonstration and 10 minutes of discussion; this running order has not been agreed.

**The overt business purpose:** answer Stuart's question, “now that it's modernised, what cool shit can we do with it?” **Russell's clarification, 2 November:** GCSP unifies the UI for GCSO (Global Car Scheme – Ordering, the mainframe ordering application) and ISA (Internal Sales Appointment, previously a separate handover system). GCSP remains a UI over the mainframe for now; Java modernisation follows. The supplied slide describes AWS hosting, which does not establish completed backend migration. See the [platform context and source slides](platform-context.md). New APIs and hooks could support more responsive employee and scheme-team experiences; their actual availability, shapes and capabilities remain to be established.

**The underlying delivery purpose:** demonstrate what IBM can achieve through AI-enabled development, reusable EDS-style blocks and strategic use of coding agents. Russell wants BMW to see an impressive, coherent and credible result and want that delivery approach on other projects. AI-enabled delivery and AI running inside the product are separate choices; a runtime LLM is not a prerequisite for every useful behaviour.

### Outcome clarified 1 November

The desired commitment is agreement to discuss a **2027 roadmap item for next-generation front ends on modernised mainframe platforms**, across **Financial Services and NSC**. GCSP is one example within that wider opportunity. This is an invitation to shape the roadmap, rather than an agreed implementation commission.

The second message is that **agentic coding is available now and should inform delivery across the account**. Functional evidence should support the roadmap discussion. Evidence of delivery speed, quality, adaptability and component reuse should support both the roadmap and the case for adopting this delivery approach now.

**Refinement mandate, Russell, 2 November:** the demonstration should make the intended employee and ordering-lead experience clear to BMW, supporting a mandate to refine it with real employees afterwards. Walkthroughs with real employees and an ordering lead are expected after the demo; they are not a prerequisite for 12 November. Detailed interaction flows can improve through trials of the first working build. Russell's own [repeatable manual scenarios](manual-acceptance-scenarios.md), recorded as FUCQ-75, support that work before the demonstration. The full planned build and existing functional/visual quality requirements remain in force.

Russell pointed to contract 1734 for background. A read-only Account Corpus review found a phased modernisation portfolio and distinct FS and NSC contexts. Do not imply that all platforms have completed migration, share one stack or expose the same capabilities. Detailed account sources remain in the corpus rather than being copied into this public demo repository.

Russell may capture screens during the work, including this discussion, to show the process. A useful evidence trail links a real discussion and human correction to a refined story, the agent work, review and verification, and the resulting experience. See [delivery evidence](delivery-evidence.md). Screen recording itself has not been started by this project.

Russell now proposes inviting “What would you change?” at the end, potentially with someone capturing suggestions in this project and progressing a bounded item through backlog, stories and code while discussion continues. This can complement the 2027 roadmap ask. Choose and authorise a feasible change, retain the normal verification and visual-quality workflow, and show the result when it is ready; completion within the meeting depends on the actual request.

The look, feel and UX must be credible as a production experience and consistent across stories and agents. The [experience quality contract](experience-quality.md) makes this a story-authoring, implementation and review obligation. The supplied GCSP screenshots are agreed for the header, sidebar and palette, with the body redesigned toward Used Cars; review a representative body early before parallel body implementation. Production deployment acceptance remains separate.

The ambition is breadth and polish backed by working behaviour. Explore bold possibilities; select a coherent demonstration story before agreeing the epics. The three personas remain the business lenses: employee car chooser, ordering lead and platform IT director.

## Positioning: the art of the possible, building on GCSP

**Binding presentation direction, Russell, 2 November 2026:** IBM delivered the new GCSP interface, and BMW is proud enough of the achievement to have made an internal launch video. Recognise both IBM's delivery and BMW's ownership. The demonstration must build on that achievement and the investment already made.

For internal planning, Russell considers the current visual treatment dated and sees substantial room for a more contemporary experience. Retain that design ambition while treating the existing delivery and its team with respect. This assessment is context for our work, not customer-facing criticism.

- **Lead with the achievement.** Acknowledge the unified ordering/handover experience and use the launch's own promise of future innovation as the bridge to what comes next.
- **Present the art of the possible.** Show how preferences, delegated searching and better planning could build on GCSP's foundations. Position the demo as an exploration of the next opportunity, with BMW shaping its refinement.
- **Protect the team and the relationship.** Avoid disparaging the new interface, embarrassing its authors or inviting BMW to defend a launch they are proud of. Screenshots and comparisons should explain specific behaviours and opportunities respectfully; do not label the newly delivered GCSP interface as the obsolete system we need to discard.
- **Keep delivery evidence constructive.** Show measured reuse, adaptability, speed and quality without implying that the original IBM team did poor work or that the launch investment was wasted. Apply the same care to the agentic-development reveal.

These rules apply to slides, talk tracks, demo labels, visual comparisons and discussion. They preserve the agreed visual-quality ambition and full build scope. Factual comparisons of employee outcomes and effort remain useful evidence under the brief's existing boundaries.

Working presentation bridge: **“GCSP has brought ordering and handover together in one experience. Building on that achievement, we'd like to explore what becomes possible next for employees and the scheme team.”**

## Employee positioning: their robot buddy

Russell wants employees to experience this as their “robot buddy”: working in the background to find the best suitable car it can, so they can delegate the searching and checking. The working employee promise is: **“Tell me what matters, and I'll keep looking for you.”**

The relationship connects the first three narrative moments: it knows the available facts about their current car; listens when they have their say; remembers the resulting brief and acts when suitable supply appears. Employees can revise that brief as their needs change. Their feedback should visibly affect its work.

The companion should communicate useful progress and bring back relevant opportunities with an explanation of why they fit. Its tone should feel warm, capable and attentive. The choice of a character, name or visual treatment remains open; “robot buddy” describes the relationship rather than an agreed visual design. Structured input is the baseline, with no runtime language model required.

Trust depends on preserving the employee's practical needs and making fit and trade-offs understandable, including when BMW's priorities favour a particular alternative. Russell has chosen recommendation and temporary reservation, with the employee making the final choice. A roughly two-hour reservation is his proposed duration; keep it configurable. Rejection or expiry returns the car to the pool. Background searching does not authorise an order.

The demo should make that background work observable: capture the employee's brief, advance the scenario to a vehicle release and let the real matching/offer behaviour produce the result. The replayable event source described below can demonstrate this without claiming an operational connection to BMW.

## Confirmed product direction

**FUCQ-6 clarification, Russell, 1 November 2026:** retain preference sliders and separate importance weights, as specified below, together with Greg's weighting controls. The saved version-4 blueprint and its research/review record contain a conflicting proposal to replace these with three short selections. Those input-control passages are superseded by this direct clarification. The other blueprint responsibilities remain design inputs; no new implementation scope is created by this correction.

- **Employee input:** slider-based preferences, alongside explicit practical requirements and feedback about the current car. Distinguish a preferred position from importance or indifference; use separate controls where qualities can coexist. Russell does not plan a site LLM. A small language model was raised as an optional possibility, not a requirement; the proposed baseline uses structured inputs, calculated matches and evidence-based explanation templates.
- **Delegation:** the buddy recommends and temporarily reserves. Rejection or timeout releases the exact car back to the pool. Two hours is the working duration proposal, rather than a verified BMW rule.
- **Competition:** include a shared scarce pool and competing employees, plus the planned 1,000-employee comparison of the current route and proposed route under the [full-build direction](build-rules.md).
- **Greg's role:** decide his next best action to place as close as possible to the right list of cars. The dashboard supplies the relevant evidence and curates a recommended order decision. Aggregate employee preferences and demand support future vehicle orders, points nudges and the requested weighting controls. Future order requests, confirmed supply and released stock represent different stages. **Approved 2 November:** [FUCQ-74](https://ibm-consulting.atlassian.net/browse/FUCQ-74) adds learned demand/choice prediction feeding constrained order planning, explained quantities/coverage/risk/uncertainty, editable constraints, intentional submission and replanning after Production responds. The [research record](greg-predictive-research.md) and [HLD](../design/gcsp-high-level-design.md#gregs-next-best-order-fucq-74) retain the evidence and contracts. Exact model/solver remain refinement decisions; synthetic training/evaluation is distinct from real BMW validation. The central assumptions source owns objectives, bounds and the active immutable model reference.
- **Population:** BMW within one supplied eligibility matrix, using fictional employees with different needs and grades. FS/UK is the proposed first matrix; the exact scheme variant remains to be named. The October 2024 baseline is already accepted.
- **Repeat choices:** Russell describes employees receiving two cars a year. Consider fairness and recovery across successive selection cycles; retain actual contract dates as data rather than infer identical renewal dates for every employee. A temporary compromise still needs to meet essential needs.

## Required demo elements

| Element | Purpose and behaviour |
|---|---|
| Employee home | Show the current vehicle and available connected-use statistics, contract countdown, editable preferences and the buddy on/off control. Retain the employee's brief for future releases. |
| Tranche-release trigger | Release a new group of vehicles through the demo data/event boundary and run matching against saved employee briefs. |
| Buddy notification | Deliver a real email after a reservation has been secured, through a replaceable backend mail adapter. Russell prefers investigating a representative Microsoft route using his Entra developer setup; Brevo is available as an alternative adapter. The sender, recipient and transport setup remain to be established; credentials stay outside browser code and source control. |
| Offer landing page | Open the actual offer from the email, show its vehicle, terms, grounded reasons and remaining reservation time, and allow the employee to accept or reject. Reopening an expired, rejected or accepted offer must reflect its current state. |
| Greg's view | Recommend the next order using learned demand and constrained planning; show coverage, unwanted-stock risk, unmet needs, uncertainty, reasons and alternatives. Let Greg change constraints, recalculate, intentionally submit and replan after Production responds, alongside weighting and points controls. Compute consequences from shared versioned data/policy. |

## Email adapter and Microsoft setup — checked 1 November

Russell authorised a read-only review of Trailblazer's Microsoft access/setup. In its checkout at revision `7310299`, Entra/MSAL supports sign-in and Graph profile access; the configured Graph scopes do not include `Mail.Send`. A historical spike records binding an authorised Office 365 Outlook connection to a cloned Power Automate flow that remained Draft/Off. This does not verify a currently usable sending mailbox or completed mail delivery. No Azure Communication Services Email setup or sender domain was evidenced. A historical note says no Azure subscription was linked to that Power Apps environment; current wider subscription availability remains unknown.

Two Microsoft transports could sit behind the same mail interface:

- **Microsoft Graph / Exchange Online:** use a suitable sender mailbox with the required `Mail.Send` authorisation. First verify current mailbox availability and permissions.
- **Azure Communication Services Email:** use provisioned email/communication resources and an eligible sender domain. This requires an Azure subscription and separate setup; Entra membership alone does not provide it.

Prefer the Microsoft route if the existing environment makes it practical. Keep Brevo as a genuine alternative adapter, and keep reservation, message content and offer-link behaviour independent of the transport. Confirm BMW's sanctioned transport with Sandeep rather than infer it solely from their Microsoft estate. No tenant changes or emails were made during this review.

Trailblazer provenance: `packages/api/src/auth/msal.ts` (scopes), `docs/technical/TECH-SPIKE-HANDOVER.md` (Outlook connection/flow), `docs/technical/microsoft_API_reach.md` (access and historical subscription context), and `docs/gap-analysis/TODO_NOTIFICATIONS.md` (email implementation gap). These are evidence references, not runtime dependencies or permission to reuse Trailblazer's app credentials.

Primary service references: [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0) and [Azure Communication Services Email](https://learn.microsoft.com/en-us/azure/communication-services/concepts/email/email-overview), read 1 November 2026. Current mailbox licensing, mail permissions and Azure resource availability were not checked against the live tenant.

## Proposed additions to complete the experience

These recommendations support the required elements but have not yet been agreed as detailed policy:

- **Complete the offer loop:** acceptance records a confirmed demo allocation and removes the car from availability. Rejection/expiry releases it and prompts another matching opportunity. Allow at most one active reservation per employee and one holder per car. Do not immediately reoffer a declined car to the same employee without a relevant change.
- **A simple structured rejection reason:** let the employee identify which attribute failed so future matching can respond, with any inferred preference change visible and correctable.
- **Honour an existing offer:** hold its quoted points/terms stable while Greg's changes apply to subsequent offers. This is proposed demo policy, pending validation of the real scheme rules.
- **A matching in-app alert:** show the same offer and state as the email, allowing the employee home to remain useful and the demonstration to proceed if delivery is delayed. Notification delivery must follow a successful reservation and must not determine allocation priority.
- **A demo clock and reset:** advance through the proposed two-hour hold, reveal expiry/reassignment, and restore a versioned scenario for another run. Expiry should use the underlying offer state, rather than a visual countdown alone.
- **Understandable activity:** give the employee useful buddy status and expose enough match/allocation reasoning for the presenter to explain why an employee received an offer or is still waiting.
- **Keep the manual route available:** preserve Russell's earlier direction that employees who do not provide preferences can choose through the current route. Represent this against the same eligible stock pool; decide how both routes share scarce supply within the allocation policy.

Implement an explicit plausible allocation principle and tie-break through the [central assumptions source](build-rules.md); execution order must not accidentally decide priority. The acceptance boundary can likewise use a clearly recorded demo assumption and improve through trials: the proposed endpoint is a confirmed allocation in demo state, without reproducing BMW's downstream loan/approval administration.

### Unresolved renewals and recovery

Russell has asked for this exception route to be defined in the visual process flow, FUCQ-4. When an employee cannot obtain a suitable replacement in time, explore automatic identification and a manual-intervention job on Greg's page, with reasons and feasible next-best options. The flow must identify who owns the case and how the employee hears about progress and resolution.

Candidate options are another suitable available vehicle, an employee-approved relaxation of a preference, a later release with a realistic date, or a manual scheme-team decision. An extension of the current contract is an option only if the real scheme permits it. Essential requirements, eligibility and affordability remain constraints.

Russell also proposes an upside after disappointment, such as greater priority at the next release or selection cycle. A bounded recovery priority is worth exploring; its definition, duration and interaction with renewal urgency and the manual route remain policy questions. Distinguish an objectively unresolved or accepted-compromise outcome from repeated rejection as a way to gain priority. Do not promise a specific next car. See SAN-016 in the [Sandeep questions](questions-for-sandeep.md).

## Compare 1,000 fictional employees

Russell proposes a simulation comparing the current release/rush route with preference-led buddy allocation, exploring bottlenecks and employee outcomes. The comparison must be capable of revealing benefits, trade-offs or no improvement, rather than programming a preferred result.

Start with the same synthetic cohort, vehicle stock, eligibility, points, renewal deadlines and underlying needs for both routes. Model access/response times explicitly and make the assumptions inspectable, including buddy uptake, preference accuracy and the manual route for non-participants. Use repeatable random seeds and multiple runs to reveal variability. The baseline is a stated model of the dated research, rather than a claim to reproduce current BMW operations exactly.

First isolate the allocation-process change. Then compare separate scenarios where Greg changes future order mix or points, making the source of any improvement clear. Use the application matching/reservation rules where applicable, with captured notifications rather than 1,000 outbound emails.

Useful measures include suitable allocations secured before renewal; calculated preference fit and its distribution; repeated contention/retries and estimated employee effort; rejected/expired offers and time cars spend held but unused; and outcomes for employees with different access or flexibility. Calculated fit is an estimate of satisfaction, not observed employee happiness. Add financial/residual scenarios only with declared economic assumptions.

A possible demo interaction is changing the reservation duration: a longer hold may relieve time pressure while keeping scarce stock unavailable for longer. Let the simulation show the resulting balance. Future return volumes can be calculated; realistic used-market prices require a further explicit scenario model.

## Binding boundaries

- Put external data and system operations behind replaceable adapters. Interfaces should describe the information and actions the experience needs, independently of BMW's eventual field names and transport. Real integration may require mapping, authentication and capability work, while preserving the experience and business logic.
- Use realistic, explicitly identified scenario data where real BMW data or contracts are unavailable. Apply the [central assumptions build rule](build-rules.md); distinguish supplied research, unverified assumptions and synthetic values.
- Run fixture-backed and real-backed inputs through the same application services and decision logic. Compute recommendations, explanations and any aggregate results from the current inputs. A fixture is input data, not a predetermined answer for a named demo employee.
- If the selected demonstration includes offers, holds or acceptance, make the chosen state transitions work against the demo adapter. A clicked button should change the underlying demo state and subsequent behaviour. Real BMW write operations remain conditional on available services and appropriate authority.
- If the selected story uses release events or other hooks, exercise the actual event-processing path using a replayable demo source. Do not claim BMW publishes those events until confirmed. The current stock fixture loader is static; a responsive event scenario requires additional behaviour.
- Show ambition through valuable interactions and compelling visuals. Changes to preferences, stock or priorities should have understandable consequences, including an unmet need where the data supports no suitable result.
- Build all planned capabilities with production discipline. Support delivery-speed and quality claims with actual implementation, reuse and verification evidence. This demo does not itself establish production deployment readiness within BMW.

These boundaries permit synthetic input and assumed interface shapes. They rule out per-employee winner overrides, canned changes in dashboard totals and UI-only order confirmations.

## Working demonstration narrative

Russell supports these four narrative themes, connecting the same employee and fleet across different perspectives. Detailed interactions, business rules, feature scope and epic structure remain to be agreed:

1. **“You already know me.”** Begin with current VIN-linked specification and available connected-use summaries, with strong vehicle visuals. Establish a recognisable starting picture of the employee's current car and its use, while distinguishing observations from interpretations.
2. **“I get to have my say.”** Give the employee a distinct opportunity to explain what they love or dislike about their current car, correct our interpretations, describe future needs and express taste preferences and their importance. Use sliders and structured controls; no runtime language model is required. They can indicate whether they want continuity or a change. Recompute recommendations from that input and explain what changed and why. Another version of a loved current car can be the best result. Capture preferences before release, giving the employee a voice in the demand picture available to Greg as well as their own recommendations; this does not guarantee a particular car or create an order commitment. Exact controls and visual treatment remain to be designed.
3. **“The platform can act when something happens.”** From the employee's perspective, their buddy has kept looking for them. Release vehicles through the demo source and identify employees whose expressed needs fit, using the brief captured when they had their say. Bring back a relevant opportunity and explain the match. An employee's response changes the available fleet or offer state according to the chosen policy. This illustrates what timely access and hooks could unlock beyond a batch-fed stock page.
4. **“Greg can see the consequences.”** Use the employee preference picture to inform future order requests and adjust points or recommendation priorities. Follow the order-to-release stages and compare resulting employee outcomes and future return volumes. If lifecycle or used-market scenarios are included, compute them from declared assumptions and keep them distinguishable from validated BMW forecasts. A strategic preference cannot turn an unsuitable car into a good fit.

A brief reveal of the delivery method could support this story: show how shared components, data and services underpin different experiences, using actual reuse and development evidence. Live coding is not required or agreed.

The strongest story is likely to show a decision travelling between the employee and the ordering lead, while making the platform's new possibilities tangible for Stuart. A large set of disconnected features would provide weaker evidence of a reusable approach.

## Demo entry point and technical release path

Russell requested a shared launcher in front of the current launcher, offering **employee cars** and **used cars** while retaining the brand switcher. This is recorded as [FUCQ-13](https://ibm-consulting.atlassian.net/browse/FUCQ-13). Preserve the existing used-car experience and supported brands; employee-scheme coverage follows the agreed scope.

The supplied live frontend is on GitHub Pages. Its deployed script points to `https://bmw-matcher-api.onrender.com`; direct browser navigation to `/health` returned `{"ok":true}` on 1 November. The repository's Pages workflow targets `main`, and `render.yaml` declares the Node backend on Render. The actual deployed backend revision, plan and automatic-deployment branch still need Gary's confirmation.

Russell owns the human presentation practicalities. The HLD, FUCQ-6, must cover the technical path from this branch to a functioning deployment and the conditions for later BMW integration. Keep future deployment requirements, including identity, authoritative rules and durable state, visible without claiming that the demo establishes production acceptance. Gary's questions for Tuesday 3 November are in [questions for GC](questions-for-gc.md).

## Existing foundations and remaining work

The current EDS block has a mode registry and shared question, preview and vehicle-card components. Stock sources already support live and fixture data flowing into a common matcher. Those are useful foundations, rather than proof that GCSP integration or employee-scheme workflows already exist.

Employee/current-car context, connected data, authoritative scheme eligibility and points, saved preferences, offers and fleet-level decisions need their own suitable contracts and behaviour if selected. The October 2024 eligibility matrices remain the agreed POC baseline. Points and other synthetic figures must remain identifiable as assumptions.

See the [codebase findings](discovery-findings.md#codebase-and-reuse), [component catalogue](../../COMPONENTS.md) and [business-model discussion](business-model-exploration.md).

## Organising hills

Russell identified these as hills rather than suitably granular backlog items. Retain them to organise the demo's intent. The smaller, cross-cutting feature intentions in the [capability-level proposal](capability-breakdown.md) are the proposed backlog unit; future sessions can refine each into implementation-ready stories. The current actionable Jira backlog contains the five separately authorised foundation items and the shared-launcher item FUCQ-13.

| Hill | Demonstrable outcome |
|---|---|
| My car, my preferences | Employee home with current vehicle, connected-use summaries, contract countdown, sliders and saved buddy preferences. |
| My buddy finds and reserves | A tranche release triggers suitable matches across a shared pool and configurable temporary reservations, with correct rejection/expiry and reassignment. |
| My offer and decision | Adapter-backed email, equivalent in-app notification, offer landing page, grounded reasons and working acceptance/rejection/current-state handling, plus continued manual-choice access. |
| Greg understands and shapes demand | Aggregate preference/demand views, future order requests, points nudges and weighting controls, with calculated consequences and stable active offers. |
| A repeatable, inspectable demonstration | Scenario data, employee/presenter navigation, event controls, accelerated clock, reset and actual evidence of component reuse and delivery quality. |
| Compare 1,000 employees | Reproducible current-route versus buddy-route simulation, inspectable assumptions and outcome comparisons, without guaranteed improvements. |

## Open planning questions

- With the 30-minute slot and named audience confirmed, decide the balance between the business demonstration, a short delivery-method reveal and discussion.
- Use the five authorised foundation items to establish the process, interface evidence, HLD, baseline flow and engine reuse. Refine the product capabilities afterwards. The illustrative allocation principle, precise acceptance boundary, two-hour duration and additional suggestions remain to be settled in that work.
- What Sandeep can share about actual or planned interfaces and hooks before 12 November. SAN-004 covers platform contracts; SAN-012 covers current-car data. Neither is a prerequisite for progressing with documented assumptions and replaceable adapters.
- Deployment and demonstration environment, including repeatable scenario reset. No new hosting or production integration has been authorised by this brief.
- Agree the technical release path with Gary using [questions for GC](questions-for-gc.md); Russell owns the human demo environment. Include unresolved-renewal handling in the flow and review any recovery-priority policy explicitly.
- Verify whether the Microsoft developer environment can support Graph/Exchange mail or Azure Communication Services Email; select the mail adapter and sender accordingly. Brevo remains an available alternative. No credentials have been requested in chat and no real emails have been sent.

## Review record

A read-only follow-up from the existing fleet-economics reviewer informed the candidate moments and credibility considerations. Its requested and selected pair remains `gpt-6.1-sol` / `high`, reviewer/Opus, with no fallback or new spawn; effective runtime settings were not independently reported. It changed no files or external services. No Jira records were changed for this brief.

Further read-only follow-ups from the existing allocation/incentives and fleet-economics reviewers informed the reservation loop and simulation design. Both retain requested/selected `gpt-6.1-sol` / `high`; no fallback or new spawn. Neither changed files or external services.

On 1 November the existing allocation/incentives reviewer checked backlog semantics (`gpt-6.1-sol` / `high`), and the existing research implementer inspected Trailblazer's Microsoft setup (`gpt-6.1-sol` / `medium`). These remain the requested/selected pairs, with no fallback or new spawn; effective runtime settings were not independently reported. Both tasks were read-only, with no credentials exposed, tenant changes or mail sends.
