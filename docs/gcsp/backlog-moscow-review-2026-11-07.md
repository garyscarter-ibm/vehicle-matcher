# GCSP backlog review: MoSCoW for 12 November 2026

**Proposal for collaborator decision, 7 November.** Prioritise the connected Paula journey and Greg's actionable order plan. Split unfinished work where a smaller outcome can be integrated and tried independently. Preserve implemented work and reduce simultaneous integration work before creating more tickets.

The categories below mean **Must** for a credible working demonstration, **Should** for important supporting evidence or an alternative route, **Could** for additions after those are secure, and **Won't for this demo** for work proposed after 12 November. They describe the proposed demo priority, not a new Jira status.

This is a proposed revision to the [full-build direction](build-rules.md), which currently requires the planned capabilities, including the learned-model lane and the 1,000-employee comparison. FUCQ-27/28 already have an agreed post-demo timing boundary. The earlier deferral of FUCQ-61 offers no remaining collection saving: its corpus has since been delivered. FUCQ-149 is an additional paused proposal awaiting review. No Jira priority, claim, dependency or acceptance criterion is changed by this report.

## Basis and estimation limits

- Reviewed all **56 unaccepted Stories** in the retained Jira observation from **7 November, 12:55 UTC**: 24 In Progress, six In Review and 26 To Do. This is a dated snapshot; no authenticated Jira tab or Jira connector was available for a fresh read during this review.
- All 24 In Progress records carry an original local estimate of 8 or 13 points: twenty at 13, four at 8. The six In Review records add three of each. The 26 unclaimed local records do not mirror a points field; their Jira estimates are unknown here, rather than assumed absent.
- Original points are not remaining effort. Published topic checkpoints already contain substantial implementation for FUCQ-69, 77, 78, 104, 113, 115 and 117; FUCQ-100/102/122 also retain integration evidence. Local remote-tracking references are implementation evidence, not confirmation of current remote heads or running workers.
- Use the [journey map](service-blueprint.html), [demo brief](demo-brief.md), [HLD](../design/gcsp-high-level-design.md), [experience contract](experience-quality.md) and [shared contracts](shared-contracts.md) together. The map follows Paula; Greg and the comparison also have explicit commitments in the brief.
- Map input wording about replacing sliders is superseded by the brief: retain preference sliders and separate importance weights.

The [inventory](evidence/backlog-moscow-2026-11-07/inventory.json) records every reviewed Story, its observed status, local estimate source and proposed disposition. Proposed child sizes below are planning targets for re-estimation, not measured savings or a forecast of delivery time.

## Must: complete the connected demonstration

| Capability and journey evidence | Remaining Stories or slices | Recommendation |
| --- | --- | --- |
| Trustworthy vehicles and a believable shared pool | FUCQ-77/78; existing FUCQ-58–63 evidence | Reuse FUCQ-61's delivered 10,000-configuration corpus. Verify scheme coverage, exact identity, usable facts/images and generated stock. Review the six In Review Stories against their retained evidence; do not restart or split delivered work. |
| Paula browses, then delegates, map 01a–04 | FUCQ-69/95 and existing brief/current-car capabilities | Keep the visual gallery and complete car details. Opening a car must not claim it. Keep saved requirements, separate preference/importance controls, permission, useful activity and pause/resume. |
| The buddy obtains a real exclusive hold, map 04a–05 | FUCQ-66/92/96/100/98/102/105 | Keep competing employees, shared stock authority, policy tie-break, tick-driven releases, atomic hold/offer/outbox, working offer links, exact quote/comparison and countdown. Deliver a real email through the existing Brevo route; capture alone does not meet the brief. |
| Decline, confirm one change, receive a better second offer, map 06–11 | FUCQ-106/107/108; main matching variant of FUCQ-128 | Keep the decline and confirmed brief change distinct, exclude the unchanged declined car, explain the second offer and submit the selected car once. Keep expiry and pending reconciliation correct. FUCQ-71's shared ordering authority remains essential even if additional manual screens are lower priority. |
| Approval and a practical handover plan, map 12–13 | FUCQ-111/116; planning slices of FUCQ-114/118/120 | Show truthful approval stages, outstanding actions/documents, readiness and named ownership. Request and confirm the replacement appointment and a distinct old-car return plan. Keep the current car unchanged before physical completion. |
| Greg makes an intentional, feasible order decision | FUCQ-104/117/119/121; existing demand, points and weighting controls | Keep expressed demand, supply already coming, feasible quantities, reasons, editable constraints, preview and intentional submission. Show requested, confirmed and released supply distinctly and replan after Production responds. HLD Q10 makes this deterministic baseline the primary plan. |
| The presenter can operate and repeat the main journey | Core FUCQ-126 controls; FUCQ-109 and core FUCQ-124 walkthrough | Keep tick, next release, reset of the main scenario, server-issued Paula/competitor/Greg switching and truthful read-back. Prove the integrated route, reset and stale-link handling. |
| A credible way to get help, map 08 | Basic help entry and named contact/status from FUCQ-122 and existing case service | Paula opens the options but takes none in the mapped story. Keep useful options and ownership without requiring the full case-management demonstration. Opening help must not alter her brief, allocation priority or active search. |

Required transactional, persistence, access, functional, accessibility and rendered-browser evidence stays with each delivered capability. Preserve canonical policy versions, exact-car identity, unknown facts, synthetic labels and source provenance. A fixture or integration merge does not prove an unavailable live/native integration or accepted completion.

### Splits that can improve delivery

| Existing work | Proposed smaller outcomes | Why and how to treat existing implementation |
| --- | --- | --- |
| **FUCQ-120**, To Do, authored L | **See my order progress and outstanding actions**, target 5 points; **request and view my confirmed replacement/return plan**, target 5–8 | The first outcome can integrate FUCQ-111/116 and become useful before all appointment/return services finish. Each slice includes its relevant UI states, access, browser evidence and integration. Share the host and components. |
| **FUCQ-114**, To Do, authored M | **Request a slot and obtain provider confirmation**, target 5; **record collection/no-show and rebook**, target 3–5, after the demo | The map ends at a confirmed plan. Extract terminal physical outcomes coherently through FUCQ-118, FUCQ-120 and FUCQ-124 too: return/missed-return state, UI and their checks move with the later capability. Do not turn the already-small FUCQ-118 into several technical tickets. |
| **FUCQ-126**, In Progress, 13 | **Operate the main walkthrough**, target 5–8; **select and replay the wider exception catalogue**, target 3–5 | Core time/release/reset/role controls can be accepted without waiting for every difficult-case fixture. Both keep presenter-only access, idempotent commands and accurate read-back. Formalise this split only if the catalogue still has material unfinished work; reuse the published controls. |
| **FUCQ-77**, In Progress, 13, approach already revised | **Qualify and publish a reusable demo subset**, target 3–5; **close identified collection/enrichment gaps**, separately sized only if gaps exist | First re-estimate the reuse approach. The existing plan/verifier already exists. Preserve the original eight configurations per mapped line, 200 total, 20 headless round trips and identity/facts/publication obligations unless a collaborator explicitly revises them. A coverage report alone does not satisfy missing coverage. |
| **FUCQ-78**, In Progress, 13 | **Publish bounded stock-locator aggregates through canonical policy**, target 3; **generate and reset reproducible run stock from them**, target 5–8 | Source observation and executable stock generation have distinct useful outputs. Sampler/generator mechanisms are already published. Separate remaining source/policy work from runtime consumption only if it shortens the handoff; retain required PostgreSQL, provenance and distribution evidence in the appropriate slice. Both outcomes remain Must. |

Do not split FUCQ-66/96/100/106 into independent persistence, API and testing tickets. Their ownership, fairness and atomic transitions need one coherent acceptance boundary. FUCQ-71/108 must also preserve one guarded selection/order conversion. Likewise FUCQ-117 already excludes preview/submission and UI: those are FUCQ-119 and FUCQ-121, not new children to invent.

FUCQ-69 could have been split into browsing and exact-car detail outcomes before implementation; its published host evidence makes a retrospective split a low-value action now. FUCQ-104 likewise already has storage, service, panel and attachment checkpoints. Finish their remaining composition and evidence. Splitting FUCQ-115 into training now and evaluation later would undermine the claim of a tested learned model.

## Should: supporting evidence and a complete alternative route

| Work | Priority and proposed boundary |
| --- | --- |
| **A reproducible 1,000-employee process comparison**, FUCQ-134/135, process-only FUCQ-136, offline/result-read parts of FUCQ-137 and stored-result display in FUCQ-138 | Preserve this approved hill, scheduled after the connected Must path. Show an actual saved result from equal inputs, real shared claim/allocation services, several seeds, honest ranges and inspectable assumptions. Generation can happen before the meeting; the screen must read the stored result and show provenance. A made-up chart is not a substitute. |
| **The full manual checkout alternative**, FUCQ-70/72/73 | Map 01a explicitly leaves browsing without reserving or ordering. Complete additional manual review/declarations, new-order/nominated-driver variants, print and full alternative-route walkthrough after the buddy path. Reuse implemented screens. Keep FUCQ-66/71 and every required contact, return-data and declaration check on the buddy handoff in Must. Before deferring manual-only UI, verify how FUCQ-108 obtains those inputs and preserve any manual actions exposed as usable. |

For the comparison, useful smaller boundaries are:

- FUCQ-136: **process-only comparison with immutable provenance and multi-seed measures**, target 5; **additional order-mix/points and hold-duration experiments**, target 3–5, Could.
- FUCQ-137: **run offline and read the stored result**, target 3; **start and monitor a responsive browser-triggered worker job**, target 5, Could.
- FUCQ-138: **show the latest comparison and its assumptions**, target 5; **run interactive experiments and hold-duration sweeps**, target 3–5, Could.

These are proposals to refine the existing contracts. Their current dependency chain must be reconciled if adopted: the display still needs a real result-read route, and the offline execution path still needs the shared runner/repository. Removing the whole of FUCQ-137 would remove those required pieces too.

The complete 1,000-employee hill is a larger possible deferral if Must work remains at risk. That would explicitly remove an approved demonstration promise; recommend the smaller interactive-control cuts first.

## Could: useful additions after Must and Should are secure

These are the principal **nice-to-have** candidates. Continue to use functioning landed code; deprioritisation means reducing unfinished work ahead of the demo, not deleting features or pretending their original points are still available to save.

| Work | Why it can follow the main demonstration | Boundary to preserve |
| --- | --- | --- |
| **Learned-model alternative**, FUCQ-123 and remaining work in FUCQ-113/115 | Q10 already makes expressed demand the submit-able baseline. The synthetic-trained alternative strengthens the predictive story but does not enable Paula's transaction or Greg's baseline order. | FUCQ-113 already publishes observed/generator/CLI slices; FUCQ-115 already publishes actual training, held-out evaluation, immutable artefacts and activation work. Assess the remaining integration cost first. Do not budget their full 26 original points as a saving or rebuild them. A deferral revises the explicit learned-model promise in the brief. |
| **Full renewal-case operations**, Greg queue/remedies and advanced Paula case interactions in FUCQ-122 | In map 08 Paula sees help choices and continues searching. Case assignment, remedy approval and full queue work are a secondary branch. | Keep the basic help route and named ownership. Much of FUCQ-122 is already integrated; defer remaining secondary integration only where there is actual effort to avoid. Preserve the distinction between a proposal, approval and applied remedy, with no automatic allocation priority. |
| **Dedicated exception replay packages**, FUCQ-127/129/130/131 and the no-second-match variant of FUCQ-128 | These broaden rehearsal and discussion beyond the selected journey. | Correct no-match, expiry, source-failure and uncertain-write behaviour stays Must, with meaningful checks. Keep the successful decline/change/second-offer route in Must and avoid duplicating FUCQ-109. The optional work is the extra fixture/catalogue/replay presentation, not error correctness. |
| **Interactive comparison experiments**, additional FUCQ-136/137/138 slices | Precomputed process evidence communicates the core comparison without waiting for a new experiment in the meeting. | Keep the reproducible runner, stored results, read route, assumptions and honest display in Should. Greg's ordinary points/weight/constraint controls remain in Must; these cuts concern simulation experiment controls. |
| **Wider presenter scenario chooser**, additional FUCQ-126 slice | The main journey can run with its fixed reset scenario and required controls. | Retain server-owned role changes, clock/release/reset and truthful read-back. Do not make the essential presenter depend on optional scenario delivery. |

A split of FUCQ-122 into **Paula can find help and see ownership** and **Greg can work the case queue/remedies** is a sensible future boundary, roughly 3–5 and 5–8 points. Current integrated implementation limits the benefit of creating replacement tickets now. FUCQ-113 already has three bounded checkpoints; another retrospective decomposition is unlikely to speed the demo.

## Won't for this demo: proposed after 12 November

| Work | Reason and decision status |
| --- | --- |
| **FUCQ-27/28**, shared-engine extraction and grouped projections | Already agreed after 12 November. Preserve the existing employee path and retail baseline; no new scope decision needed. |
| **FUCQ-46/47/48**, live catalogue provider, its failure/fallback integration and live verification | Propose using the qualified versioned offline corpus for this demo. Live-provider delivery adds no distinct mapped step. This is conditional on the demo dataset meeting exact identity, usable facts/images and scheme coverage needs; it does not waive those. Existing source/access holds remain binding. |
| **Physical collection/return completion, no-show and missed-return branches** extracted from FUCQ-114/118/120/124 | The map explicitly ends at a confirmed handover plan. Move the complete later outcome, its UI and its checks together. Keep documents/readiness visibility, requested versus confirmed dates, separate return plans and unchanged current-car identity in Must. This revises authored scope and needs a collaborator decision. |
| **FUCQ-149**, additional saved-manual-journey Resume | Already paused as an additional proposal awaiting review and prioritisation. It is absent from the mapped walkthrough. Preserve existing recovery/uncertain-state safeguards and reuse landed work later. |

Lower-severity Bugs retain the existing independent-backlog policy. This review does not re-triage defects or change severity. Critical/High findings still require resolution or a specific collaborator deferral; correctness is not a Could item.

## Applying the proposal

1. Finish or integrate the existing Must checkpoints before starting more broad work. Prioritise the data/policy/runtime seams, FUCQ-108 selection handoff and FUCQ-120 order-progress host; retain all existing claims and explicit holds.
2. Re-estimate the **remaining acceptance work** with its published code and retained evidence. First candidates are FUCQ-77/78 and the model work; original story points overstate any saving available now.
3. If a collaborator accepts these priorities, reconcile the brief/HLD, native Jira descriptions/dependencies and claimed/local records before building revised slices. Preserve original obligations until that explicit revision. Each smaller story owns its relevant integration and UX evidence; no separate generic testing phase is created.
4. Keep FUCQ-109 and the retained core of FUCQ-124 as connected acceptance checks. Use the named small outcomes above for review and integration, rather than dividing work merely by files or technical layers.

## Review validation and retained evidence

This review changes documentation only. Selected validation passed: 56 unique Story identities and MoSCoW dispositions; the 24/6/26 status counts; 30 original local estimates and 26 explicit estimate unknowns; all seven report links, 13 source-document paths and the index link; JSON syntax and whitespace. Every inventory key and recorded point value was checked against its local Story. Application, database, source-collection and browser suites were not run because this report changes no product behaviour, contracts or authored acceptance. Existing test results are evidence about their recorded revisions, not new passes claimed here.

The review creates no temporary test/proof roots and spawns no agents. Retained output is this report, its small JSON inventory and the project-index link. Unrelated working-tree files are preserved.
