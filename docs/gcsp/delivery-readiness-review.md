# GCSP delivery readiness review — 2 November 2026

Discussion record for Russell's proposed sequence: review the candidate journey/HLD with Gary, approve the design, create remaining capability Epics and Stories, then run Russell's Claude, Codex and Gary's Claude pollers. This review does not authorise additional backlog scope or start implementation/pollers.

Russell confirms that he has sent the questions to Sandeep. Earlier source documents describing the email as unsent are historical on that point. No answers were supplied with this discussion.

**Russell's response, 2 November:** all planned capabilities must work and there is time to build them. Rules may develop through trial and improvement, using plausible assumptions held in one shared, easily changed source. The binding [build rules](build-rules.md) supersede this review's earlier scope-reduction suggestions and upfront policy-confirmation gates. The other discovery/refinement suggestions remain for Russell's review.

## Assessment

The candidate HLD maps Paula's current-car, brief, search, offer, decision and order/handover journey to responsible modules and state. Greg's demand, points/weights and supply stages also have architectural homes. The principal gaps are delivery and policy decisions, plus refinement of the proposed capabilities; a further broad ideation phase is not required for the demo.

Architecture agreement can precede final provider selection. Each implementation story still needs enough behaviour, contracts, dependencies and acceptance evidence to be buildable. Where policy is unconfirmed, implementers may choose plausible assumptions under the [build rules](build-rules.md) and refine them through observed results. Separate the ability to write an adapter from the ability to enable it in the deployed demonstration.

Use bounded capabilities as Epics, mapped to the HLD responsibilities. For example, saving/revising a buddy brief or returning a declined exact offer to the pool can span interface, services and storage. A diagram box does not by itself determine backlog size. Preserve independent Epics and the existing agreed granularity.

## Current backlog baseline

Read-only Jira query on 2 November 2026: `project = FUCQ ORDER BY key ASC`, with all results returned. There are **53 native Stories, FUCQ-20–72**, all currently **To Do**:

| Existing capability | Stories |
|---|---|
| FUCQ-7 · shared recommendation reuse | FUCQ-20–30, 11 |
| FUCQ-12 · shared launcher | FUCQ-31–35, 5 |
| FUCQ-13–19 · vehicle evidence, synthetic VIN service and corpus | FUCQ-36–62, 27 |
| FUCQ-6 · modern manual route and shared shell | FUCQ-63–72, 10 |

FUCQ-5 is In Review and FUCQ-3 is In Progress. Those Jira states do not establish whether Russell/Gary have accepted the final current documents. Reconcile the remaining journey requirements against these existing records before adding Epics or Stories. The existing story sets do not implement the full durable buddy, allocation/offer, mail, Greg or downstream lifecycle capabilities.

## Dependencies and readiness gates

| Dependency | Evidence or decision needed | Owner and timing |
|---|---|---|
| Demonstration scope and finish line — scope resolved | All planned capabilities must work; Russell confirms there is time. Plan completion of the full build and use the 30-minute slot to shape the walkthrough. Represent the demonstrated end states truthfully. | Binding [build rules](build-rules.md); no scope-reduction decision is outstanding. |
| Explicit demo policy — confirmation gate replaced | Implement plausible rules/values in the single canonical policy/assumptions source, including scheme variant, contributions, allocation, access, hold limits/durations, decline exclusion, quote stability and acceptance. Exercise them and improve them when results or verified facts warrant change. Existing confirmed constraints still apply. | Implementers apply the [build rules](build-rules.md); advance approval of every assumed value is not required. Real BMW policy authority remains a live-integration condition. |
| Hosting and release | Confirm actual backend branch/revision/plan and ownership, the `gcsp-poc` integration-to-release route, compatible Pages/Render/EDS publication, and recovery ownership. The local integration branch is not itself a deployed release. | Gary/platform owner; agree before enabling the relevant deployed capabilities. |
| Durable state and execution | Select/provide transactional SQL hosting, connection/secrets/migration arrangements and the expiry/release runner. PostgreSQL is proposed; provider is open. Decide how explicit demo ticks and any unattended operation are presented. | Gary; contract/fake-backed implementation can proceed earlier, but durable/restart acceptance and deployed operation require the real repository/execution choice. |
| Email and offer access | Choose the available Microsoft or Brevo transport, sender/permission setup, intended demonstration recipient and stable environment-specific offer URL. Prove delivery and current-state link handling across browsers. | Gary/Russell before real-mail acceptance. Sandeep's documentation of an incumbent transport does not provision this demo sender. |
| Reviewed visual implementation reference | Complete FUCQ-63's representative employee body and review its actual desktop/narrow render before parallel body designs fan out. Establish Greg's operational composition when introduced. Apply shared kit/gallery ownership, tokens and the experience contract. | Russell/Gary early in implementation; shell/palette references are already available. |
| Implementable shared contracts and dependency graph | Refine versioned brief, exact stock/claim/offer/order states, errors, IDs and adapter results for each first slice. Assign shared ownership and sequence changes to core, shell, kit, transaction authority and migrations. Keep manual and buddy selection on one authority. | Story author/design reviewers before the affected stories are claimable. Detailed interface-control review is currently deferred in the HLD index. |
| Scenario/corpus preparation | Select coherent fictional employees, exact vehicles, terms and release events that exercise the journey. For FUCQ-18/19, settle source activation, supported VIN profiles, configuration coverage and collection/image budgets. Preserve the authorised 10,000-distinct acceptance target. | Dataset implementers with Russell's scope decisions, early enough for collection/validation. Small compatible fixtures can unblock application work; they do not complete FUCQ-19. |
| Shared source and poller operation | Commit/share the approved context, design and story inputs before worktrees/other clones depend on them. Verify member/Jira setup, remote claim leases, isolated story worktrees, compatible tooling and integration ownership. In particular, verify how Russell's Claude and Codex coordinate if they share a checkout/member identity. Agree who answers questions requiring a human decision. | Russell/Gary and the three poller sessions before sustained parallel dispatch. Existing scaffolding supplies the mechanisms; exercise them with a small initial run. |
| Integrated acceptance and rehearsal | Exercise a deployed end-to-end slice early, retain visual/functional evidence, then rehearse resets, concurrent claims, expiry, stale links, mail failure and process restart. Agree a known tested demo release and time for final correction/rehearsal. Capture delivery/reuse/rework evidence during work if it will support the agentic-delivery claim. | Russell/Gary own acceptance and presentation; story results supply evidence. Before declaring the demonstration ready. |

Some capabilities can progress while these decisions are open. For example, the agreed shared recommendation extraction, bounded correctness fixes, shell reference and small snapshot providers need not wait for a live BMW write API or the full corpus. Readiness applies to each story and release capability rather than as one blanket stop.

## Focused refinement questions

1. **Scope response recorded:** all planned capabilities must work. Refine the walkthrough and truthful ending state while retaining the full build; earlier suggestions to shorten implementation scope are superseded.
2. **Allocation outcome proposed by Russell, 2 November:** at least as many employees satisfied with their eventual vehicle as the as-is, with a measured reduction in total time wasted manually checking the portal. The [discussion record](allocation-outcomes-refinement.md) treats this as a candidate success criterion, with satisfaction/effort definitions, baseline comparability and manual-user outcomes to refine. Scarce-car priority and tie-breaks remain policy choices; a high individual match score is not an allocation policy, and rejecting a car alone earns no recovery priority under the HLD.
3. **Greg's objective recorded, 2 November:** choose his next best action to place as close as possible to the right list of cars, with the dashboard supplying evidence and curating the decision where possible. The [predictive research](greg-predictive-research.md) recovers earlier explicit ML proposals and explores learned choice prediction feeding constrained order planning. Metrics, predictive model and planning details remain for discussion; separate projected demand from observed acceptance, confirmed supply and measured commercial outcomes.
4. **Trial-and-improvement response, Russell, 2 November:** explore successful and difficult flows after the first build through repeatable scenarios he can manually click through, reset and inspect. [FUCQ-74](manual-acceptance-scenarios.md) records shared setup/replay support; each relevant implementation Epic contributes scenarios, with a dedicated child Story where preparation needs distinct work. Include no match, rejection/brief change, expiry, unavailable data, uncertain handoff and competing manual/buddy claims. Current expected outcomes may evolve through trials while existing correctness requirements remain in force.
5. **Real-user walkthrough timing resolved, Russell, 2 November:** employee and ordering-lead walkthroughs are expected after the demo. The intended experience should be clear enough to seek BMW's mandate to refine with real employees; prior representative-user validation is not a demo gate. Russell's own first-build trials and the existing functional/visual acceptance continue before the demo.
6. **What will establish that a built story contributes to a working demonstration?** Specify the observable result, functional checks and relevant rendered evidence; then verify the connected release. Story tests and three active pollers do not by themselves prove the complete journey.

## Suggested sequence

1. Review the journey and HLD with Gary, and record the accepted revision plus remaining owner decisions. Use the existing [GC questions](questions-for-gc.md) to include deployment, SQL, execution and mail.
2. Preserve the full planned scope; map capabilities to the existing backlog and identify the gaps. Implement plausible policy assumptions through the central source and refine them through trials. Greg's decision-journey refinement remains a suggestion for Russell's review.
3. Refine the first ready Stories with dependencies and contracts. Progress the representative visual body early, retaining its existing owner FUCQ-63. Later body stories consume the reviewed reference.
4. Share committed context and exercise claims/integration with a small run. Then run all three pollers on ready, independent work, with shared components and transactions sequenced explicitly. More pollers do not remove the serial dependencies.
5. Integrate one working release-to-offer-to-decision slice early, extend the remaining agreed capabilities, and reserve time for deployed acceptance and rehearsal before 12 November.

No Sandeep answer is a total blocker for the permitted synthetic demonstration. Authorised live providers and real BMW reservation/order operation retain their own access/authority gates; a synthetic adapter does not complete those live capabilities. The production-hosting/SSO/operational questions can remain later roadmap gates where they do not affect the demo.

## Sources and review limits

Reviewed the [context index](README.md), [demo brief](demo-brief.md), [whole-demo HLD](../design/gcsp-high-level-design.md), [HLD index](../design/README.md), [experience contract](experience-quality.md), [manual refinement](manual-journey-refinement.md), [shared recommendation design](shared-recommendation-design.md), [capability proposal](capability-breakdown.md), [Sandeep question review](sandeep-question-review.md), [VIN fleet proposal](synthetic-vin-fleet-proposal.md), [delivery evidence](delivery-evidence.md), scaffolding settings and the dev-inbox team/Codex procedure. Current Jira issue types, parent relationships and statuses were checked read-only. Provider dashboards, Gary's clone, credentials, sender readiness and running pollers were not inspected; those are verification needs, not asserted failures.

Gateway preflight passed on IBM Global. No agents were spawned, Jira records changed, pollers started, infrastructure provisioned, messages sent or application code changed by this review.
