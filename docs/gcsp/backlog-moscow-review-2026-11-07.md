# GCSP backlog review: MoSCoW for 12 November 2026

**Partial-story splits authorised and applied, 7 November.** Russell asked to retain each necessary part under its existing Story number and move its remaining scope into a new To Do Story. Ten native Jira splits are now applied, with their local contracts reconciled. The wider MoSCoW prioritisation remains a proposal for collaborator decision. Preserve implemented work and complete the connected Paula journey and Greg's actionable order plan.

The categories below mean **Must** for a credible working demonstration, **Should** for important supporting evidence or an alternative route, **Could** for additions after those are secure, and **Won't for this demo** for work proposed after 12 November. They describe the proposed demo priority, not a new Jira status.

The [full-build direction](build-rules.md#scope-split-decision-7-november-2026) now records the specific authorised split boundaries below. Existing Story statuses, assignees, claims, priority, point values and unrelated links are preserved. New remainders FUCQ-167 through FUCQ-176 are unassigned native Stories in To Do, with no point estimate and Jira's default Medium priority. Native split links provide traceability; none blocks its retained Story. The learned-model lane and the rest of the 1,000-employee promise are not waived by this action. FUCQ-27/28 retain their agreed post-demo boundary; FUCQ-149 remains paused. FUCQ-61's delivered corpus offers no remaining collection work to save.

## Basis and estimation limits

- The original review covered **56 unaccepted Stories** in the retained Jira observation from **7 November, 12:55 UTC**: 24 In Progress, six In Review and 26 To Do. That remains the dated review baseline. After Jira reauthentication, all **35 Must identities** and the **20 original/remainder records** were read natively for this split action; the [read-back](evidence/backlog-splits-2026-11-07/jira-readback.json) records the actual revised descriptions and metadata. This action adds ten remainders to the reviewed scope.
- All 24 In Progress records carry an original local estimate of 8 or 13 points: twenty at 13, four at 8. The six In Review records add three of each. The 26 unclaimed local records do not mirror a points field; their Jira estimates are unknown here, rather than assumed absent.
- Original points are not remaining effort. Published topic checkpoints already contain substantial implementation for FUCQ-69, 77, 78, 104, 113, 115 and 117; FUCQ-100/102/122 also retain integration evidence. Local remote-tracking references are implementation evidence, not confirmation of current remote heads or running workers.
- Use the [journey map](service-blueprint.html), [demo brief](demo-brief.md), [HLD](../design/gcsp-high-level-design.md), [experience contract](experience-quality.md) and [shared contracts](shared-contracts.md) together. The map follows Paula; Greg and the comparison also have explicit commitments in the brief.
- Map input wording about replacing sliders is superseded by the brief: retain preference sliders and separate importance weights.

The [inventory](evidence/backlog-moscow-2026-11-07/inventory.json) records every reviewed Story, its observed status, local estimate source, disposition and actual split mapping. Existing point estimates are historical combined-scope estimates; retained Stories and new remainders need re-estimation against their actual remaining acceptance. The [split record](evidence/backlog-splits-2026-11-07/plan.json) preserves the authorised scope and validation boundaries. No measured delivery saving is claimed.

## Must: complete the connected demonstration

### Development and integration order

The table names every Must Story individually, including the six data Stories whose implementation is already In Review. Complete their remaining acceptance rather than restarting their development. This is the order in which the connected outcomes need to come together, not a requirement to wait for every earlier Jira issue to close. Independent work can proceed against the existing agreed interfaces; retain claims, explicit holds and actual technical blockers. In particular, FUCQ-78 does not wait for FUCQ-77.

| Order | Exact Story | Necessary scope and immediate integration inputs |
| --- | --- | --- |
| 1 | FUCQ-58 | Verify the retained source qualification, coverage and collection budgets. Existing foundation evidence is available. |
| 2 | FUCQ-59 | Accept resumable collection of distinct constructible configurations, using FUCQ-58's qualified source. |
| 3 | FUCQ-60 | Accept supported facts and images for the collected configurations from FUCQ-59. |
| 4 | FUCQ-61 | Accept the delivered 10,000 genuinely distinct configurations and retained validation. |
| 5 | FUCQ-62 | Accept publication and stock generation by order reference from FUCQ-61's corpus. |
| 6 | FUCQ-63 | Accept full-corpus lookup and offline recovery through the published port from FUCQ-62. |
| 7 | FUCQ-77 | Qualify the existing corpus for every scheme model line, including the retained coverage and round-trip requirements. |
| 8 | FUCQ-78 | Produce reproducible scheme stock using the corpus, bounded real stock aggregates and canonical policy. FUCQ-77 is not a blocking prerequisite. |
| 9 | FUCQ-92 | Release that stock through the actual tick handler and shared repository. |
| 10 | FUCQ-126 | Operate the main scenario's tick, next release, reset and server-issued role controls, using FUCQ-92 and the existing clock/scenario services. |
| 11 | FUCQ-66 | Finish shared exclusive manual claims and expiry against the existing repository and clock. |
| 12 | FUCQ-71 | Finish idempotent selection/order conversion through the shared ordering authority, using FUCQ-66. |
| 13 | FUCQ-69 | Integrate released-car browsing and exact-car details with FUCQ-92; opening a car makes no claim. |
| 14 | FUCQ-95 | Integrate useful buddy activity and pause/resume with the existing saved-brief service. |
| 15 | FUCQ-96 | Allocate released cars across competing eligible briefs using the canonical tie-break and FUCQ-92's release. |
| 16 | FUCQ-100 | Commit the exclusive hold, offer and outbox job atomically from FUCQ-96's allocation. |
| 17 | FUCQ-98 | Deliver the offer through the real email transport and retain actual send evidence from the outbox. |
| 18 | FUCQ-102 | Open the current offer through a run-bound link from FUCQ-100, including stale-link and access handling. |
| 19 | FUCQ-105 | Show the exact offer quote, current-car comparison and countdown from FUCQ-102. |
| 20 | FUCQ-106 | Accept, decline and expire the offer idempotently, preserving ownership and uncertain-outcome reconciliation. |
| 21 | FUCQ-107 | Confirm one preference change after decline and obtain the matching second offer through FUCQ-96/106. |
| 22 | FUCQ-108 | Submit the selected buddy offer once through FUCQ-71/106, including required contact, return-data and declaration checks. |
| 23 | FUCQ-128 | Replay the successful decline/change/second-offer variant using FUCQ-107 and the main presenter controls. |
| 24 | FUCQ-109 | Prove the connected Paula selection journey, actual email/link, second offer, handoff and reset on the running application. |
| 25 | FUCQ-111 | Progress the selected order through truthful approval states after the FUCQ-108 handoff. |
| 26 | FUCQ-114 | Request and obtain provider confirmation of the replacement appointment, including accepted slot changes and pending reconciliation. |
| 27 | FUCQ-116 | Track the selected order's documents, readiness, outstanding actions and named owners. |
| 28 | FUCQ-118 | Request and schedule a distinct old-car return through FUCQ-114's appointment port; preserve the current-car relationship. |
| 29 | FUCQ-120 | Compose order progress, documents, appointment and separate return planning from FUCQ-111/114/116/118. |
| 30 | FUCQ-122 | Place useful help and named case ownership/status in the activity and order-progress hosts, using the existing case service. |
| 31 | FUCQ-124 | Prove the connected approval/document/confirmed-plan journey and retained difficult states after FUCQ-109/120/122. |
| 32 | FUCQ-104 | Integrate Greg's requested, confirmed and released supply with the FUCQ-92/96 stock authority. This lane can proceed alongside Paula's journey. |
| 33 | FUCQ-117 | Produce the feasible deterministic order plan from expressed demand, policy and FUCQ-104's supply. |
| 34 | FUCQ-119 | Preview constraint edits, replan after supply responses and intentionally submit the plan through FUCQ-104/117. |
| 35 | FUCQ-121 | Compose Greg's actionable order-plan panel using FUCQ-119 and the existing dashboard/weighting controls. |

| Capability and journey evidence | Remaining Stories or slices | Recommendation |
| --- | --- | --- |
| Trustworthy vehicles and a believable shared pool | FUCQ-77/78; existing FUCQ-58–63 evidence | Reuse FUCQ-61's delivered 10,000-configuration corpus. Verify scheme coverage, exact identity, usable facts/images and generated stock. Review the six In Review Stories against their retained evidence; do not restart or split delivered work. |
| Paula browses, then delegates, map 01a–04 | FUCQ-69/95 and existing brief/current-car capabilities | Keep the visual gallery and complete car details. Opening a car must not claim it. Keep saved requirements, separate preference/importance controls, permission, useful activity and pause/resume. |
| The buddy obtains a real exclusive hold, map 04a–05 | FUCQ-66/92/96/100/98/102/105 | Keep competing employees, shared stock authority, policy tie-break, tick-driven releases, atomic hold/offer/outbox, working offer links, exact quote/comparison and countdown. Deliver a real email through the existing Brevo route; capture alone does not meet the brief. |
| Decline, confirm one change, receive a better second offer, map 06–11 | FUCQ-106/107/108; main matching variant of FUCQ-128 | Keep the decline and confirmed brief change distinct, exclude the unchanged declined car, explain the second offer and submit the selected car once. Keep expiry and pending reconciliation correct. FUCQ-71's shared ordering authority remains essential even if additional manual screens are lower priority. |
| Approval and a practical handover plan, map 12–13 | FUCQ-111/116 and retained FUCQ-114/118/120 | Show truthful approval stages, outstanding actions/documents, readiness and named ownership. Request and confirm the replacement appointment and a distinct old-car return plan. Keep the current car unchanged before physical completion. |
| Greg makes an intentional, feasible order decision | FUCQ-104/117/119/121; existing demand, points and weighting controls | Keep expressed demand, supply already coming, feasible quantities, reasons, editable constraints, preview and intentional submission. Show requested, confirmed and released supply distinctly and replan after Production responds. HLD Q10 makes this deterministic baseline the primary plan. |
| The presenter can operate and repeat the main journey | Core FUCQ-126 controls; FUCQ-109 and core FUCQ-124 walkthrough | Keep tick, next release, reset of the main scenario, server-issued Paula/competitor/Greg switching and truthful read-back. Prove the integrated route, reset and stale-link handling. |
| A credible way to get help, map 08 | Basic help entry and named contact/status from FUCQ-122 and existing case service | Paula opens the options but takes none in the mapped story. Keep useful options and ownership without requiring the full case-management demonstration. Opening help must not alter her brief, allocation priority or active search. |

Required transactional, persistence, access, functional, accessibility and rendered-browser evidence stays with each delivered capability. Preserve canonical policy versions, exact-car identity, unknown facts, synthetic labels and source provenance. A fixture or integration merge does not prove an unavailable live/native integration or accepted completion.

### Authorised splits from Must Stories

| Existing Story and retained necessary scope | New To Do Story and remaining scope | Demo disposition |
| --- | --- | --- |
| **FUCQ-114:** request a slot, obtain provider confirmation, accept a proposed change and reconcile pending outcomes | **FUCQ-167:** completion gated by documents/readiness, no-show receipt and rebooking | Won't for this demo |
| **FUCQ-118:** request and schedule a distinct old-car return; keep current-car identity unchanged during planning | **FUCQ-168:** returned/missed outcomes, exception receipt and current-car changes only after confirmed completion/return | Won't for this demo |
| **FUCQ-120:** order progress, owned document/actions, replacement appointment and separate return planning | **FUCQ-169:** completed/no-show/missed-return UI and rebooking actions | Won't for this demo |
| **FUCQ-122:** useful help entry/request and truthful named owner, status and next action | **FUCQ-170:** Greg's operational queue/remedies, full case history and advanced employee remedy/relaxation interactions | Could |
| **FUCQ-124:** connected approval/document/confirmed-plan acceptance, retained difficult states and repeatability | **FUCQ-171:** terminal buddy/manual lifecycle, no-show/return and advanced help/remedy walkthroughs | Won't for this demo |
| **FUCQ-126:** main walkthrough tick, release, reset, role controls and actual read-back | **FUCQ-172:** wider scenario picker, other reset targets and unavailable-scenario presentation | Could |
| **FUCQ-128:** replay decline, a separate confirmed change and a matching second offer | **FUCQ-173:** the additional no-second-match waiting variant and its replay package | Could |

FUCQ-120 keeps both progress and planning under its existing number because both are necessary. Each remainder owns its moved functional, integration and rendered-browser evidence; each retained Story keeps the checks relevant to its delivered scope. Existing implementation and historical failures remain evidence about their original revisions, not new passes or a Done transition.

FUCQ-77 and FUCQ-78 are unchanged by this split action: their proposed internal delivery outcomes are all Must. Re-estimate FUCQ-77's reuse approach first, preserving eight configurations per mapped line, 200 total, 20 headless round trips and identity/facts/publication obligations. Collection/enrichment of a genuine coverage gap is still required. FUCQ-78 can publish bounded source/policy aggregates before integrating reproducible run stock, while retaining PostgreSQL, provenance and distribution evidence. Its existing corpus access remains independent of FUCQ-77.

Do not split FUCQ-66/96/100/106 into independent persistence, API and testing tickets. Their ownership, fairness and atomic transitions need one coherent acceptance boundary. FUCQ-71/108 must also preserve one guarded selection/order conversion. Likewise FUCQ-117 already excludes preview/submission and UI: those are FUCQ-119 and FUCQ-121, not new children to invent.

FUCQ-69 could have been split into browsing and exact-car detail outcomes before implementation; its published host evidence makes a retrospective split a low-value action now. FUCQ-104 likewise already has storage, service, panel and attachment checkpoints. Finish their remaining composition and evidence. Splitting FUCQ-115 into training now and evaluation later would undermine the claim of a tested learned model.

## Should: supporting evidence and a complete alternative route

| Work | Priority and proposed boundary |
| --- | --- |
| **A reproducible 1,000-employee process comparison**, FUCQ-134/135 and retained FUCQ-136/137/138 | Preserve this approved hill, scheduled after the connected Must path. Show an actual saved result from equal inputs, real shared claim/allocation services, several seeds, honest ranges and inspectable assumptions. Generation can happen before the meeting; the screen must read the stored result and show provenance. A made-up chart is not a substitute. |
| **The full manual checkout alternative**, FUCQ-70/72/73 | Map 01a explicitly leaves browsing without reserving or ordering. Complete additional manual review/declarations, new-order/nominated-driver variants, print and full alternative-route walkthrough after the buddy path. Reuse implemented screens. Keep FUCQ-66/71 and every required contact, return-data and declaration check on the buddy handoff in Must. Before deferring manual-only UI, verify how FUCQ-108 obtains those inputs and preserve any manual actions exposed as usable. |

The three comparison splits are now applied:

| Existing Story and retained supporting scope | New To Do Story and optional scope |
| --- | --- |
| **FUCQ-136:** process-only comparison, all multi-seed measures, honest differences and immutable provenance | **FUCQ-174:** alternative order-mix/points experiments and buddy hold-duration sweeps |
| **FUCQ-137:** offline execution through the shared runner/repository and an authorised read route for the actual stored result | **FUCQ-175:** browser-triggered responsive worker jobs, progress, concurrency and failure/restart outcomes |
| **FUCQ-138:** latest stored process-result panel, all measures/ranges, assumptions and policy freshness | **FUCQ-176:** experiment picker, interactive hold reruns, progress and persisted new-result presentation |

The stored display still consumes FUCQ-137's real read route, and offline execution still uses FUCQ-136's shared runner and repository. The optional worker and controls are separate To Do Stories; they do not block acceptance of that stored-result route. All moved checks stay with their respective remainder.

The complete 1,000-employee hill is a larger possible deferral if Must work remains at risk. That would explicitly remove an approved demonstration promise; recommend the smaller interactive-control cuts first.

## Could: useful additions after Must and Should are secure

These are the principal **nice-to-have** candidates. Continue to use functioning landed code; deprioritisation means reducing unfinished work ahead of the demo, not deleting features or pretending their original points are still available to save.

| Work | Why it can follow the main demonstration | Boundary to preserve |
| --- | --- | --- |
| **Learned-model alternative**, FUCQ-123 and remaining work in FUCQ-113/115 | Q10 already makes expressed demand the submit-able baseline. The synthetic-trained alternative strengthens the predictive story but does not enable Paula's transaction or Greg's baseline order. | FUCQ-113 already publishes observed/generator/CLI slices; FUCQ-115 already publishes actual training, held-out evaluation, immutable artefacts and activation work. Assess the remaining integration cost first. Do not budget their full 26 original points as a saving or rebuild them. A deferral revises the explicit learned-model promise in the brief. |
| **Full renewal-case operations**, FUCQ-170 | In map 08 Paula sees help choices and continues searching. Case assignment, remedy approval and full queue work are a secondary branch. | FUCQ-122 retains basic help and named ownership/status. Reuse its integrated operational code and evidence in FUCQ-170. Preserve proposal, approval and application as distinct, with no automatic allocation priority. |
| **Dedicated exception replay packages**, FUCQ-127/129/130/131 and FUCQ-173 | These broaden rehearsal and discussion beyond the selected journey. | Correct no-match, expiry, source-failure and uncertain-write behaviour stays Must, with meaningful checks. FUCQ-128 retains the successful decline/change/second-offer route; reuse FUCQ-109. The optional work is the extra fixture/catalogue/replay presentation. |
| **Interactive comparison experiments**, FUCQ-174/175/176 | Precomputed process evidence communicates the core comparison without waiting for a new experiment in the meeting. | FUCQ-136/137/138 retain the reproducible runner, stored results, read route, assumptions and honest display in Should. Greg's ordinary points/weight/constraint controls remain in Must; these cuts concern simulation experiment controls. |
| **Wider presenter scenario chooser**, FUCQ-172 | The main journey can run with its fixed reset scenario and required controls. | FUCQ-126 retains server-owned role changes, clock/release/main reset and truthful read-back. The essential presenter has no dependency on the optional chooser. |

The FUCQ-122/FUCQ-170 split preserves Gary's claim and all existing implementation and historical validation evidence. It tracks the remaining optional acceptance separately; it does not recover the original 13 points as an available saving. FUCQ-113 already has three bounded checkpoints; another retrospective decomposition is unlikely to speed the demo.

## Won't for this demo: proposed after 12 November

| Work | Reason and decision status |
| --- | --- |
| **FUCQ-27/28**, shared-engine extraction and grouped projections | Already agreed after 12 November. Preserve the existing employee path and retail baseline; no new scope decision needed. |
| **FUCQ-46/47/48**, live catalogue provider, its failure/fallback integration and live verification | Propose using the qualified versioned offline corpus for this demo. Live-provider delivery adds no distinct mapped step. This is conditional on the demo dataset meeting exact identity, usable facts/images and scheme coverage needs; it does not waive those. Existing source/access holds remain binding. |
| **Physical completion and later lifecycle verification**, FUCQ-167/168/169/171 | Russell authorised this extraction on 7 November. The mapped demo ends at a confirmed handover plan. The new To Do Stories own the later outcome, its UI and its checks. FUCQ-114/118/120/124 retain documents/readiness visibility, requested versus confirmed dates, separate return plans and unchanged current-car identity through planning. |
| **FUCQ-149**, additional saved-manual-journey Resume | Already paused as an additional proposal awaiting review and prioritisation. It is absent from the mapped walkthrough. Preserve existing recovery/uncertain-state safeguards and reuse landed work later. |

Lower-severity Bugs retain the existing independent-backlog policy. This review does not re-triage defects or change severity. Critical/High findings still require resolution or a specific collaborator deferral; correctness is not a Could item.

## Applying this review

1. Finish or integrate the existing Must checkpoints before starting more broad work. Prioritise the data/policy/runtime seams, FUCQ-108 selection handoff and FUCQ-120 order-progress host; retain all existing claims and explicit holds.
2. Re-estimate the **remaining acceptance work** with its published code and retained evidence. First candidates are FUCQ-77/78 and the model work; original story points overstate any saving available now.
3. The ten authorised partial-story splits are reconciled in native Jira, local contracts and the brief/HLD scope references; product-map associations are recorded. Their [scope record](evidence/backlog-splits-2026-11-07/plan.json) maps the retained and moved obligations. The other whole-capability priority recommendations still need collaborator agreement before changing their contracts or the remaining full-build promises. Each Story owns its relevant integration and UX evidence.
4. Keep FUCQ-109 and the retained core of FUCQ-124 as connected acceptance checks. Use the named small outcomes above for review and integration, rather than dividing work merely by files or technical layers.

## Review validation and retained evidence

The original review's 56 identities, 24/6/26 status counts, 30 historical local estimates and 26 estimate unknowns remain the dated baseline. This update revises authored Story contracts and tracking metadata. Native read-back verifies all ten pairs, exact revised descriptions, To Do/unassigned remainder state, parent Epic and preserved original status/assignee/points/priority/labels/unrelated links. The [acceptance map](evidence/backlog-splits-2026-11-07/acceptance-map.json) accounts for all 67 original acceptance clauses across retained and moved scope. Local parsing/contract agreement, the 35 unique exact Must identities and integration order, product-map inputs, links, JSON and whitespace are checked; the [validation receipt](evidence/backlog-splits-2026-11-07/validation.json) records the results.

The product-map registry includes all ten remainders across eleven associations, and this branch's projection validates without diagnostics. The aggregate snapshot reports conflicting records from other active branches, so this action does not establish a published-map refresh. Existing slice progress and worker observations are preserved.

Application, database, source-collection and product-browser suites were not run: no application implementation changes in this action. Existing failed, skipped and unrun evidence remains attached to its recorded revision; splitting a Story proves no new capability or accepted completion. No agents or implementation work were started. Retained output is this report, the inventory, native/local split evidence and product-map facts. Task-created browser artifacts are covered by the cleanup receipt; unrelated working-tree files are preserved.
