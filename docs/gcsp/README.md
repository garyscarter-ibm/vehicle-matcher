# GCSP project context and session handoff

Start here for every new GCSP discovery, foundation, design, implementation or review session. Repository documents hold the project decisions; this chat history is not required context.

## Purpose and binding context

- Demonstration: **12 November 2026**, **30 minutes**, for Stuart and the named leadership group in the [brief](demo-brief.md).
- Desired outcome: agreement to discuss a **2027 next-generation front-end roadmap across FS and NSC**. Also demonstrate that agentic coding can support delivery across the account now.
- Read the [demo brief](demo-brief.md) for confirmed direction and adapter/behaviour boundaries, and the [experience quality contract](experience-quality.md) for story and agent obligations.
- Use [COMPONENTS.md](../../COMPONENTS.md), the project's `scaffolding:component-kit` workflow and the agreed visual reference. No GCSP visual reference has been agreed yet; establish it before parallel UI implementation.
- All scaffolding pieces are on. Jira FUCQ is the backlog; `gcsp-poc` is the shared integration branch. Follow the configured story/worktree/team workflow. Additional product proposals need refinement and agreement before becoming implementation scope.

## Authorised backlog items

Use Jira keys when opening a session; their numbers differ from the original numbered suggestions.

| Key | Intended outcome |
|---|---|
| [FUCQ-3](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-3) | [Paula's live service blueprint](service-blueprint.html): fifteen scrollable columns, 01–13 plus 01a / 04a, from her screen-identified 320i M Sport Touring and usage profile through a short brief, delegated search, rejection / revised offer and handover plan. Plain-language responsibilities connect to input data and proposed adapters / flows. Includes a [persona and empathy map](personas/employee-car-chooser.md), [UX / scheme research](service-blueprint-research.md) and [verification record](service-blueprint-review.md). |
| [FUCQ-4](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-4) | Accepted research: proven BMW UK website/configurator interfaces and their limits; implementation tracked separately. |
| [FUCQ-5](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-5) | Agreed HLD, including technical deployment and later BMW integration conditions. |
| [FUCQ-6](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-6) | Current GCSP selection journey using shared components. |
| [FUCQ-7](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-7) | Reuse assessment for the existing matching intelligence. |
| [FUCQ-12](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-12) | Shared employee-car/used-car launcher with brand switching. |
| [FUCQ-13](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-13) | Dated BMW catalogue/specification snapshots through an adapter. |
| [FUCQ-14](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-14) | Representative configuration-image snapshots through an adapter. |
| [FUCQ-15](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-15) | VIN-linked handbook/illustration adapter, distinct from a build sheet. |
| [FUCQ-16](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-16) | Authorised live BMW catalogue/specification provider; access-gated. |
| [FUCQ-17](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-17) | Authorised live BMW configuration imagery provider; access-gated. |
| [FUCQ-18](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-18) | Synthetic VIN registry/service, consuming adapter and plausible BMW VIN generator, proved with five-WMI fixtures. |
| [FUCQ-19](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-19) | Collect, validate, publish and load 10,000 genuinely distinct BMW configurations into that VIN service. |

Read the current Jira description and subsequent comments before starting. FUCQ-1 is discovery context; FUCQ-2 records completed persona drafts. The superseded exploratory records retain history. The [original 22 capability proposals](capability-breakdown.md) are retained for refinement as foundation work informs the direction.

Russell confirmed at FUCQ-4 closeout on 1 November that backlog Epics are independent bounded capabilities: do not nest Epics beneath Epics. FUCQ-13–17 retain their research origin through `Relates` links and their delivery prerequisites through directed `Blocks` links; they are not children of FUCQ-4. Refine implementation stories under the relevant capability when it is picked up.

## Supporting evidence and open decisions

- [Discovery update, 3 November](discovery-update-2026-11-03.md): latest question dispositions and general design constraints after private technical feedback. Russell confirms Choices for Paula; the detailed source assessment and follow-up draft remain with the private planning material.

- [BMW interface research](bmw-interface-research.md) and [adapter capability map](bmw-interface-stories.md), FUCQ-4 refinement, 1 November: dated catalogue/specification/image proof, a repeatable VIN-linked Driver's Guide route, unsuccessful free-decoder tests and conditional Outvin API findings. These establish source limits, not live GCSP integration or a VIN build sheet.
- [Synthetic VIN fleet refinement](synthetic-vin-fleet-proposal.md): authorised Epics FUCQ-18/19, the 10,000-distinct target, an offline lookup service and replaceable adapter. Includes a three-configuration native pilot and refined acceptance. [BMW VIN rules](synthetic-vin-rules.md) retain primary descriptor/checksum/year/plant evidence, explicit UK/RHD gaps and a bounded AutoTrader-to-VINwiki pilot with two sanitised candidate observations. The HLD and selected collection/profile context remain implementation inputs.
- [Discovery and codebase findings](discovery-findings.md), [research background](background.md), [business model](business-model-exploration.md) and [personas](personas/README.md).
- [Sandeep questions](questions-for-sandeep.md): interfaces and before/after availability, points/allowances, connected data, allocation and unresolved-renewal policy. Russell asks Sandeep.
- [GC questions](questions-for-gc.md): deployment, shared state, adapters, email and future integration. Russell owns the human presentation practicalities.
- [Delivery evidence](delivery-evidence.md): complexity estimates, human effort, elapsed time, reuse, quality and a genuine change of direction.

Working policy proposals include a roughly two-hour reservation and recovery priority after disappointment. Exact allocation, priority, acceptance and email choices remain to be refined. The October 2024 model eligibility matrix is the agreed baseline. Keep assumptions in data/configuration and behaviour computed through adapters.

Russell proposes inviting “What would you change?” near the end of the demo, potentially having an operator capture, refine and build a bounded suggestion during the discussion. This can complement the roadmap ask. It is a proposed demonstration format, not an instruction to start a dispatcher or promise an unknown change within the meeting.

## Starting a fresh session

Give the session a Jira key, this index and its intended output. It reads current project instructions, the issue and relevant linked context, then follows the appropriate research/design/story workflow. Different foundation investigations can use separate sessions; architecture and implementation must incorporate agreed findings and dependencies.

Commit the context and project settings before creating worktrees from the integration branch: Git worktrees start from committed history and do not copy uncommitted discovery files. Gary's separate clone also needs the shared commits and his own member/Jira setup. Opening a new session does not itself claim work or authorise a broad poller.
