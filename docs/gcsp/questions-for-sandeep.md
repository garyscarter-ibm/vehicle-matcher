# Questions for Sandeep

**Latest response update, 3 November 2026:** technical answers dated 2 November have been reviewed. Use the [current dispositions and design consequences](discovery-update-2026-11-03.md), which supersede the historical status statements below. The detailed assessment and follow-up draft remain with the private planning correspondence. Russell confirms Choices for Paula and retains the October 2024 eligibility baseline.

**Outbound list, 2 November 2026:** use the [short prioritised email](questions-for-sandeep-email.md), with [research review and SAN traceability](sandeep-question-review.md). Russell clarified that Sandeep can retrieve accessible Confluence/backend documents and directory details, but cannot canvass business owners or resolve arbitrary enterprise questions. The twenty original entries below preserve discovery history; they are not the email checklist. Their answers remain open.

Started 31 October 2026. Sandeep Sundar is our contact currently working on the backend system and supplied the portal screenshots. Russell will put these questions to him; record answers and their sources here as they arrive.

Keep this as a running list of questions arising during discovery and backlog development. The October 2024 eligibility matrices in the research are the agreed POC baseline.

## Original questions — historical wording and status

### SAN-001: Vehicle points prices and employee allowances

**Question:** Can you share the vehicle points prices and employee points allowances, showing the applicable schemes, grade bands and effective dates?

**Context:** The research contains model/engine eligibility matrices but no points prices or grade allowance amounts.

**Status:** Open; awaiting Russell's discussion with Sandeep.

**Answer/source/date:** Not yet received.

### SAN-002: Ordering role and decision rights

**Question:** Does Greg still own renewal planning, requests to Production and unallocated-stock management, and how are those responsibilities split with Charles, Alphabet and the other teams? Who can change the requested mix, approve exceptions and decide allocation policy?

**Context:** The 2024 notes describe Greg's process, while the Mural labels a lane “Greg / Charles Actions”. We want the ordering persona to reflect the real job and authority boundaries. This is about validating responsibilities, not changing the agreed eligibility baseline.

**Status:** Open; awaiting Russell's discussion with Sandeep, who may need to identify the scheme owner.

**Answer/source/date:** Not yet received.

### SAN-003: Success measures and baselines

**Question:** What measures actually define success for the scheme team and platform owner, who owns each measure, and are current baselines or targets available? In particular, are employee satisfaction, complaints, manual orders, unallocated stock, residual value, service reliability and running cost tracked?

**Context:** Research supplies business objectives and dated estimates, but no verified current scorecards. Persona measures are candidates until confirmed. Sandeep can route the IT-director priorities to the platform owner rather than answer on their behalf.

**Status:** Open; awaiting Russell's discussion with Sandeep and the relevant business/platform owners.

**Answer/source/date:** Not yet received.

### SAN-004: Current platform boundaries

**Question:** Which parts of GCSP's modernisation and interfaces are available or planned by 12 November, and which systems own employee eligibility, points, vehicle stock, orders and holds? Can you share API specifications or representative anonymised payloads, including any release/change events or other hooks, and distinguish read access from operations such as reserving or accepting a car?

**Context:** [Russell clarified on 2 November](platform-context.md) that GCSP unifies the GCSO ordering and ISA handover UI over the mainframe today; Java modernisation follows. The supplied slide describes AWS hosting, and the Account Corpus contains 2026 GCSO/ISA modernisation proposals, but neither establishes actual current contracts or hooks. The 12 November demonstration should show what new capabilities could enable without claiming completed backend migration. We need enough detail to design replaceable adapters and identify which assumptions are synthetic. Confirm whether sandbox/sample access is possible and how access works; the demo can progress with documented assumptions if it is unavailable. No live BMW integration is a prerequisite.

**FUCQ-5 refinement, 1 November:** [Website interface research](bmw-interface-research.md) proved browser catalogue/specification/rules and representative imagery calls, but native UCP/manifest requests without a key returned 401. Which supported services or anonymised exports can supply UK model/AG identifiers, dated configurations/options and image assets, with sanctioned credentials and demo/display/retention conditions? The sampled catalogue resolved to January 2027 production, so also confirm the join to the agreed October 2024 eligibility baseline. Catalogue constructibility and retail pricing do not establish released stock, eligibility or scheme points. These are research findings; no answer from Sandeep has been received.

**Status:** Open; awaiting Russell's discussion with Sandeep.

**Answer/source/date:** Not yet received.

### SAN-005: Employee needs and access

**Question:** Do we have recent employee feedback or support-request themes explaining why people accept a compromise, struggle to choose or ask for a manual order? Do those needs differ for desk-based and production/shift-based employees, and who could help us validate them?

**Context:** The employee persona uses a BMW Financial Services professional as its work-context anchor. Their own car needs are unknown, and older research raises unequal access to the ordering rush as a concern. We should validate those needs rather than infer them from a contact's job or reuse an illustrative family from a proposal.

**Status:** Open; awaiting Russell's discussion with Sandeep, who may need to identify employee or scheme-team contacts.

**Answer/source/date:** Not yet received.

### SAN-006: Where demand and supply diverge

**Question:** For a recent renewal cohort or release, can Greg show the mix employees wanted at the actual points/contribution and dates, what he requested, what Production confirmed, what was released, what was taken and what remained? What explains the gaps, and how far before release can the requested mix still change?

**Context:** The rush could reflect a total shortage, the wrong mix/specification, relative points value, timing or uncertain access. The 2024 Mural asks whether residual-value needs explain the mix but does not answer it. Preferences gathered before release may still be too late to influence Production.

**Status:** Open; awaiting Russell's discussion with Sandeep and Greg.

**Answer/source/date:** Not yet received.

### SAN-007: Lifecycle economics and residual exposure

**Question:** Who owns the commercial decision on the scheme mix and bears a resale shortfall? Can they explain acquisition and funding costs, contributions, holding/refurbishment/disposal costs, forecast residuals and realised used proceeds by model/specification and return period? Do mix or return-volume limits reflect used-market demand, and what evidence supports them?

**Context:** Employee demand and used-buyer demand may differ. A better employee match is not automatically a better vehicle-cycle result. The dated ownership note and the loan/buyback guideline describe the ownership chain differently. We need the commercial owner's current explanation, including the distinction between internal transfers and group economic value.

**Status:** Open; awaiting Russell's discussion with Sandeep, who can identify the Alphabet/Finance and remarketing owners.

**Answer/source/date:** Not yet received.

### SAN-008: Authority and purpose for points changes

**Question:** Who may change vehicle points prices, for what reasons and at what stage? Could future cohorts have published demand-responsive prices or incentives for useful flexibility, and how would that affect the funded benefit, cash contributions and eligibility? When are terms fixed for the employee?

**Context:** SAN-001 remains the request for the actual points and allowance tables. The 2024 guideline fixes points at ordering and allows retail-price/scheme-cost reviews; it does not establish popularity or personalised pricing authority. A larger points number is not automatically equivalent new revenue. HR/reward and the commercial owner need to define the intended bargain.

**Status:** Open; awaiting Russell's discussion with Sandeep and the pricing/reward owners.

**Answer/source/date:** Not yet received.

### SAN-009: Fair access, delegated choice and declining an offer

**Question:** When eligible employees compete for the same car, which priority principles should apply across advance-preference and manual routes? What may an employee authorise the scheme to select or reserve for them, and what happens after refusal or non-response? Can someone retain an offer while waiting for another, and how should shift-based access and repeated disappointment be handled?

**Context:** Advance selection may replace speed-based allocation with a different rationing rule, and could leave manual choosers with leftovers. A wish list, temporary offer and accepted order are different commitments. Any stick-or-twist proposition needs an explicit account of what is kept or surrendered.

**Status:** Open; awaiting Russell's discussion with Sandeep and the scheme/reward owners.

**Answer/source/date:** Not yet received.

### SAN-010: Flexibility in current-car and return timing

**Question:** If an employee wanted to keep their current car longer or accept a different replacement date, when is that permitted, who decides and how are the extra mileage, costs and used-market return timing assessed? Could voluntary timing flexibility have useful commercial value?

**Context:** Keeping the current car is one possible meaning of “stick”. That differs from accepting a new-car offer. Existing sources conflict on contract periods, so an extension cannot be assumed to be an available benefit or economically helpful. The October 2024 model eligibility baseline remains agreed.

**Status:** Open; awaiting Russell's discussion with Sandeep and the scheme/commercial owners.

**Answer/source/date:** Not yet received.

### SAN-011: Employee-scheme EV registrations and compliance priorities

**Question:** Which employee-scheme new registrations count in BMW's UK zero-emission compliance accounting, and who owns the current target, manufacturer/pool position and value of another suitable EV registration? Could this inform the preferred scheme mix, and how would the resulting future used-EV volumes be balanced with remarketing?

**Context:** Russell reports that employee-car sales count towards UK government EV sales targets and wants this considered when tuning recommendations. Official guidance can establish the general registration rules; it does not establish BMW's current position or a fixed financial value for each car. A used-car resale must not be counted as another new registration.

**Status:** Open; awaiting Russell's discussion with Sandeep, who can identify the compliance and commercial owners.

**Answer/source/date:** Not yet received.

### SAN-012: Current-car VIN and connected-vehicle data

**Question:** Can we reliably link an employee to their current car's VIN and specification, and which connected-use signals are actually available to support recommendations? What are the coverage, freshness and permitted uses of those data, and did the earlier enquiry to Pete Thorne establish an access route?

**Context:** Russell wants the current car to inform both recommendations and visuals, alongside the employee's own feedback on whether and why they like it. The research says VSS holds static data retrievable from a VIN; Sandeep was to check with Pete Thorne about the connected-vehicle data design. Current access is unverified. Useful signals could include mileage and, where available and permitted, journey or charging summaries; we should establish what exists before assuming any of them. Observations need a relevant period and reliable vehicle/employee attribution, and employees need a way to correct an interpretation or explain changed needs.

**FUCQ-5 refinement, 1 November:** The [official VIN tests](bmw-interface-research.md#5-vin-lookup-official-bmw-routes) found a repeatable Driver's Guide UK handbook and image for an authorised VIN, without an API key; Know Your BMW returned no match. The guide's disclaimer prevents treating its content as a fitted-equipment/build sheet, and neither source proves connected-use data. Can VSS/the supported vehicle-data service provide build date, exact model/type/AG mapping, paint/upholstery and fitted option codes with completeness/freshness guarantees, plus the separate connected signals? If official build data is unavailable, Russell asked us to assess bimmer.work and M Decoder: neither free-site test decoded successfully, while M Decoder advertises an authenticated Outvin API whose access, successful schema and permitted demo/display/retention use still need confirmation. Do not infer an approved third-party route from that advertisement.

**Status:** Open; awaiting Russell's discussion with Sandeep and the relevant vehicle-data owners.

**Answer/source/date:** Not yet received.

### SAN-013: Reservation lifecycle and acceptance boundary

**Question:** Can the modernised system support an exclusive hold on one exact vehicle for a configurable period, then accept it or release it on rejection/expiry? What does acceptance commit in the current scheme process, and which points/terms are honoured if prices change while an offer is held?

**Context:** Russell wants the demo buddy to recommend and temporarily reserve, with roughly two hours proposed. Rejection or timeout returns the car to the pool. The proposed demo would show a confirmed allocation on acceptance, honour active offers and apply price changes to future offers; these are demo-policy proposals, not verified BMW rules. We need to understand the relevant interfaces, authority and change events without assuming that today's short portal hold can simply be lengthened. SAN-004 covers overall interface availability; SAN-009 covers fairness and delegation policy.

**Status:** Open; awaiting Russell's discussion with Sandeep and the relevant scheme owners.

**Answer/source/date:** Not yet received.

### SAN-014: BMW's application email transport

**Question:** Which approved service should an application use to send employee offer notifications in BMW's Microsoft environment: Microsoft Graph/Exchange Online, Azure Communication Services Email, an internal relay or another service? How are the sender and application authorised, and is there a relevant interface or sample integration?

**Context:** Russell wants the demo's real email delivery behind a replaceable adapter and prefers a representative Microsoft route if practical. His Entra developer setup is documented in Trailblazer, but current mail transport availability is unverified. Microsoft identity alone does not establish the BMW-approved sending route. Brevo is available for an alternative demo adapter.

**Status:** Open; awaiting Russell's discussion with Sandeep and the platform/mail-service owners.

**Answer/source/date:** Not yet received.

### SAN-015: Evidence for availability and API improvements

**Question:** What is the actual before-and-after behaviour for vehicle-release visibility: which batch jobs, schedules and delays constrain the current experience, and what freshness, APIs or release events will the modernised platform offer? Which interfaces are live, planned or still backed by mainframe operations, and which observable behaviour could we credibly demonstrate on 12 November?

**Context:** [Russell's 2 November clarification](platform-context.md) establishes UI unification over the mainframe, with Java modernisation to follow. Instant release visibility and easier APIs remain possibilities to substantiate; neither the new UI nor the slide's AWS wording establishes real-time behaviour. SAN-004 covers interface contracts; this question establishes any specific improvement and its business consequence. The demo should support a 2027 cross-portfolio front-end roadmap discussion without implying every NSC or FS platform is already migrated.

**Status:** Open; awaiting Russell's discussion with Sandeep.

**Answer/source/date:** Not yet received.

### SAN-016: Unresolved renewals, manual intervention and recovery priority

**Question:** When no suitable car is available before renewal, what intervention routes and owners exist, and how early should the scheme team act? Which next-best options are permitted, and could a genuinely disappointing outcome support a bounded priority adjustment at the next release or selection cycle?

**Context:** Russell wants the flow to consider automatic flagging, jobs for Greg and useful alternatives. He describes two selection cycles a year, so fairness can include recovery over time. Define what counts as an unresolved or disappointing outcome, how it is recorded, and how any credit interacts with urgent renewals, flexibility and the manual route. Rejection alone should not automatically earn priority. Contract extension remains subject to the authority and economics covered by SAN-010; no exception rule or priority formula has been approved.

**Status:** Open; awaiting Russell's discussion with Sandeep and the scheme/reward owners.

**Answer/source/date:** Not yet received.

### SAN-017: Manual entry, stock holds and interruption behaviour

**Question:** For the current manual route, which first-order, replacement and second-car paths and status-dependent account/history actions should the demo represent? What do the history icons and Print/Finish actions do? Exactly when do preview and order-review timers start/change/end, and what happens on Previous, Cancel, another car, refresh, connection loss or expiry during submission? Can a lost submit response be retried safely?

**Context:** FUCQ-7 now preserves the current manual decisions in a redesigned body. The eight INT captures are inconsistent example records, not one transaction. Walkthrough notes describe 120-second preview and five-minute terms periods, while screenshots show only remaining seconds. Confirm atomic stock claim/release and operation identifiers alongside SAN-004/013. The buddy's proposed two hours is a separate policy.

**Status:** Open; awaiting Russell's discussion with Sandeep.

**Answer/source/date:** Not yet received.

### SAN-018: Nominated-driver, licence and entitlement rules

**Question:** Can you supply the missing family-tree and age/licence eligibility figures, applicable schemes/grades, first/second-car entitlement rules, and representative anonymised driver/licence/eConsent responses? Which drivers may be nominated primary drivers versus occasional users, and which fields may the employee correct in the portal versus through HR/support?

**Context:** FUCQ-7 needs self and permitted nominated-driver branches without copying an unverified INT relationship. The dated guide distinguishes primary and occasional drivers and requires licence-check consent, but extracted figures are missing. The G7/530e/second-slot example in the screenshots conflicts with the accepted FS/UK model matrix and dated second-car guidance; coherent synthetic records will be used.

**Status:** Open; awaiting Russell's discussion with Sandeep and the scheme/HR/licence owners.

**Answer/source/date:** Not yet received.

### SAN-019: Manual contract, collection and cost-field semantics

**Question:** Which contract length/mileage options, renewal windows, location/date constraints and expiring early-renewal/allowance overrides should this baseline use? How do exact vehicle availability and the old contract constrain requested collection? Which service returns requested, earliest, booked and actual collection/return separately? Do points price, allowance used/remaining and salary cash top-up have separate units/periods, and when is an over-allowance choice permitted or blocked?

**Context:** Sources disagree on contract/window values. The INT monthly cost, retail price and allowance cannot define scheme policy. The dated Choices guide allows cash top-up at £1 per point; SAN-001/008 seek current authoritative prices/terms, so no universal over-allowance block or current conversion is inferred. A requested collection date is not a booked appointment. Expected return mileage refers to the old car.

**Status:** Open; awaiting Russell's discussion with Sandeep and the scheme/collection owners.

**Answer/source/date:** Not yet received.

### SAN-020: Full declarations, order commitment and employee readback

**Question:** Can you share the complete current terms/declaration text below the clipped summary, its version/source, required acknowledgement controls and stored acceptance record? What exact action creates the order/removes stock, what determines initial HR/IS/manager approval and employee-visible status/reason, and which changes/cancellations remain permitted? What fields and next steps should order readback/print show, including special-requirement handling and subsequent collection confirmation?

**Context:** Screenshot 06 ends partway through declarations; screenshot 07 shows a generated GCSO reference and Awaiting IS Approval. It does not establish final approval, signing or a booked appointment. The 500-character special-requirements field is evidenced, but it cannot promise arbitrary changes to released stock. SAN-013 covers the wider commitment boundary. FUCQ-7 will use explicit synthetic versioned declarations and a functioning adapter-backed handoff until confirmed.

**Status:** Open; awaiting Russell's discussion with Sandeep and the ordering/terms owners.

**Answer/source/date:** Not yet received.


## Current response status

See the [3 November update](discovery-update-2026-11-03.md) for the current disposition of every SAN entry. The original questions above are preserved as discovery history; no broad entry is fully closed.
