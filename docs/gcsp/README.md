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
| [FUCQ-3](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-3) | Reviewable visual HTML process flow, including unresolved-renewal handling. |
| [FUCQ-4](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-4) | Proven BMW UK website/configurator interfaces and their limits. |
| [FUCQ-5](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-5) | Agreed HLD, including technical deployment and later BMW integration conditions. |
| [FUCQ-6](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-6) | Current GCSP selection journey using shared components. |
| [FUCQ-7](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-7) | Reuse assessment for the existing matching intelligence. |
| [FUCQ-12](https://ibm-consulting-sandbox003.atlassian.net/browse/FUCQ-12) | Shared employee-car/used-car launcher with brand switching. |

Read the current Jira description and subsequent comments before starting. FUCQ-1 is discovery context; FUCQ-2 records completed persona drafts. The superseded exploratory records retain history. The [original 22 capability proposals](capability-breakdown.md) are retained for refinement as foundation work informs the direction.

## Supporting evidence and open decisions

- [BMW interface research](bmw-interface-research.md) and [adapter story map](bmw-interface-stories.md), FUCQ-4 refinement, 1 November: dated catalogue/specification/image proof, a repeatable VIN-linked Driver's Guide route, unsuccessful free-decoder tests and conditional Outvin API findings. These establish source limits, not live GCSP integration or a VIN build sheet.
- [Discovery and codebase findings](discovery-findings.md), [research background](background.md), [business model](business-model-exploration.md) and [personas](personas/README.md).
- [Sandeep questions](questions-for-sandeep.md): interfaces and before/after availability, points/allowances, connected data, allocation and unresolved-renewal policy. Russell asks Sandeep.
- [GC questions](questions-for-gc.md): deployment, shared state, adapters, email and future integration. Russell owns the human presentation practicalities.
- [Delivery evidence](delivery-evidence.md): complexity estimates, human effort, elapsed time, reuse, quality and a genuine change of direction.

Working policy proposals include a roughly two-hour reservation and recovery priority after disappointment. Exact allocation, priority, acceptance and email choices remain to be refined. The October 2024 model eligibility matrix is the agreed baseline. Keep assumptions in data/configuration and behaviour computed through adapters.

Russell proposes inviting “What would you change?” near the end of the demo, potentially having an operator capture, refine and build a bounded suggestion during the discussion. This can complement the roadmap ask. It is a proposed demonstration format, not an instruction to start a dispatcher or promise an unknown change within the meeting.

## Starting a fresh session

Give the session a Jira key, this index and its intended output. It reads current project instructions, the issue and relevant linked context, then follows the appropriate research/design/story workflow. Different foundation investigations can use separate sessions; architecture and implementation must incorporate agreed findings and dependencies.

Commit the context and project settings before creating worktrees from the integration branch: Git worktrees start from committed history and do not copy uncommitted discovery files. Gary's separate clone also needs the shared commits and his own member/Jira setup. Opening a new session does not itself claim work or authorise a broad poller.
