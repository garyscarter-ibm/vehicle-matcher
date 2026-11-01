# Capability-level backlog proposal

1 November 2026. Discussion proposal for Russell's review, not a second backlog and not created Jira records. Jira FUCQ remains the configured backlog. Russell has since authorised five foundation items, recorded by repurposing FUCQ-3 to FUCQ-7; FUCQ-8 to FUCQ-11 were retired as superseded. The product capabilities below remain proposals for later refinement, rather than newly created Jira items. See the [foundation refresh](discovery-findings.md#foundation-backlog--refreshed-1-november).

## Meaning and size of an item

The scaffolding backlog skill captures feature ideas. In Jira mode each item is stored as an Epic; that issue type does not imply a large scope. The dev-inbox workflow later refines an item into stories linked through `epic:`. Stories carry the decisions, acceptance and validation needed for implementation. The backlog description captures the user's intent without inventing implementation detail.

Russell wants smaller, cross-cutting feature capabilities from which another session can readily derive the relevant stories. Each proposed item below has a specific behaviour or information need, even where it spans employee views, Greg's view, decision logic and external services. The six broad statements retained in the [demo brief](demo-brief.md#organising-hills) remain organising hills.

Russell has confirmed these proposed capabilities are useful and should be retained. Use the five foundation items to learn more about their direction, then refine their scope, order and detail. Keep this proposal available throughout that work; it is not a fixed implementation plan.

These are proposed titles and intent summaries for review. They do not assign priorities, invent Jira keys, settle unresolved policy or constitute implementation-ready stories.

## Proposed capabilities from Russell's stated direction

| # | Proposed item | Intent to preserve during refinement |
|---|---|---|
| 1 | Show the employee's actual current car | Use VIN-linked specification and suitable vehicle visuals to ground the experience in the car the employee already has. |
| 2 | Use connected-vehicle statistics as recommendation context | Present available current-car usage statistics and use relevant observations alongside the employee's expressed preferences. |
| 3 | Show the current contract countdown | Make the employee's renewal timing visible on their home page, using contract data. |
| 4 | Capture what the employee likes about their current car | Ask whether they like it and which qualities they want to preserve or change when recommending the next vehicle. |
| 5 | Save and revise preference spectra | Let employees express lifestyle/taste preferences on sliders before vehicle release and retain that brief for recommendations and aggregate demand. |
| 6 | Enable and disable the employee's buddy | Let the employee turn background vehicle-finding on or off from their home page. |
| 7 | Apply the agreed BMW eligibility baseline | Use the supplied eligibility matrix for the chosen population when identifying cars the employee can select or receive. |
| 8 | Account for vehicle points and employee allowances | Use vehicle points and employee allowance information when presenting and recommending scheme cars; unavailable values may use declared demo assumptions. |
| 9 | Match available vehicles to employee needs and preferences | Combine the employee's current-car context and stated preferences with the actual available vehicle pool. |
| 10 | Handle employees competing for scarce vehicles | Support several employees seeking the same available cars; refine the illustrative priority/allocation rule explicitly. |
| 11 | Trigger matching when a tranche is released | Provide a way to release new vehicles and have the buddy act on saved employee briefs. |
| 12 | Temporarily reserve a recommended vehicle | Give the employee time to decide on a recommended car, with roughly two hours as Russell's proposed hold duration. |
| 13 | Review an offer and understand why it was chosen | Open the recommended vehicle from a notification, present its details and explain the fit using the employee and vehicle evidence. |
| 14 | Accept the offered vehicle | Let the employee make the final choice; refine exactly what acceptance commits within the demonstration. |
| 15 | Return rejected and expired offers to the pool | Release a car when its employee rejects it or its reservation expires so it becomes available again. |
| 16 | Deliver offer email through a replaceable mail adapter | Send a real notification linking to the offer; investigate a representative Microsoft transport, with Brevo available as another adapter. |
| 17 | Retain manual choice for employees without preferences | Keep the current route available to employees who do not use advance preferences, alongside the buddy route. |
| 18 | Aggregate employee preferences into a demand picture | Show Greg selected preferences and vehicles in or out of demand using the employees' actual saved inputs. |
| 19 | Place future vehicle orders informed by demand | Let Greg request a different future vehicle mix in response to the aggregate demand picture. |
| 20 | Nudge vehicle demand through points values | Let Greg adjust vehicle points values to influence the choices available to employees. |
| 21 | Tune recommendation priorities | Give Greg the requested weighting controls, including the discussed ability to tune EV emphasis. |
| 22 | Compare allocation routes for 1,000 employees — stretch | Simulate the existing route and proposed buddy route to explore bottlenecks and employee outcomes from declared assumptions. |

Current-car specification and connected-use data are separate because their sources, coverage and interpretation differ. Individual matching and competition are separate because a good recommendation for one employee does not settle who receives a scarce car. Offer reservation, review, acceptance and release each express a distinct part of the lifecycle while sharing the same underlying state.

## Additional suggestions still needing agreement

### Further direction from 1 November

The original 22 capabilities above remain retained. Russell has since requested a shared employee-car/used-car entry point with a brand switcher; this bounded item is [FUCQ-12](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-12).

He has also asked the foundation process flow to define unresolved-renewal handling: automatic flags, jobs for Greg and feasible next-best options. Possible recovery priority at a later release or selection cycle remains a policy proposal. Refine the relevant later capabilities using that flow rather than silently treating a priority formula or contract extension as agreed.

The earlier assistant suggestions of an in-app alert/activity view, structured rejection reasons, stable quoted terms, one active reservation per employee, and an accelerated demo clock/reset remain proposals. They can become separate items or refinement of an agreed capability; they are not silently included as user requirements above.

## Context for a future refining session

Read the [demo brief](demo-brief.md), [business-model exploration](business-model-exploration.md), [discovery findings](discovery-findings.md), [personas](personas/README.md) and [questions for Sandeep](questions-for-sandeep.md) before writing stories. Preserve the adapter boundary, declared synthetic inputs, working computed behaviour and existing decision status.

Cross-cutting example: refining “Return rejected and expired offers to the pool” would need to consider reservation state, shared availability and what an employee sees on reopening the offer. The relevant implementation stories and their dependencies should be decided during refinement, rather than inferred as separate unrelated page projects.

No runtime LLM is required. BMW's October 2024 model eligibility is the accepted baseline. Roughly two hours is a proposed demo hold, not current verified BMW policy. The exact allocation tie-break, acceptance boundary and choice of Microsoft mail transport remain open. Sandeep's actual API shapes can be learned alongside refinement; documented adapter assumptions permit progress.

## Source guidance checked

The initial interpretation used scaffolding 0.5.0 guidance. The shared backlog skill was then amended, reviewed and released as 0.5.1 on 1 November: epics in scaffolding-enabled projects mean bounded backlog items, with explicit discussion-only boundaries preserved. `backlog/references/jira.md` retains one Epic per item; `dev-inbox/references/cowork.md`, “Stories from a backlog item”, describes later story refinement and parent linkage.
