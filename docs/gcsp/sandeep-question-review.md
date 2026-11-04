# Sandeep question review — 2 November 2026

The [email draft](questions-for-sandeep-email.md) reduces the twenty discovery questions to twelve short retrieval questions: eight P2 and four P3. Russell’s follow-up removes the optional directory question and handles VIN samples directly through the [sample checklist](vin-sample-checklist.md). The original [SAN register](questions-for-sandeep.md) remains intact and unanswered. This review records prioritisation and routing, not answers, new product decisions or additional backlog scope.

Russell clarified Sandeep’s reach: BMW Confluence, GCSP/GCSO and some dependent backend systems, plus the employee directory. He cannot canvass people about roles or obtain arbitrary enterprise information. The email therefore asks for existing documents, observable behaviour and anonymised examples. An unavailable source is a valid answer. It asks for neither credentials nor new access arrangements or policy approvals.

## Priority basis

Priority reflects the agreed 12 November demonstration and the currently authorised supporting work, including vehicle evidence and the synthetic fleet.

| Priority | Meaning | Assessment |
|---|---|---|
| P1 | Total blocker | No Sandeep answer is a total blocker for the agreed demo: the brief permits synthetic inputs and replaceable adapters. Actual behaviour must still work. Live-provider access remains a blocking condition for FUCQ-17/18 themselves; a fixture does not complete those capabilities. A real BMW reservation/order integration likewise cannot proceed on assumed authority. |
| P2 | Answer changes a major design decision | Platform capabilities and claims, source contracts/joins, scheme applicability and financial rules, driver/timing gates, stock/commitment semantics, current-car evidence, supply planning. VIN-profile evidence remains a P2 research need handled directly with Russell. |
| P3 | Nice to have | Optional connected summaries, existing operational evidence, the incumbent mail transport and documented channel changes. Their absence can be handled without changing the core demo proposition. |
| P4 | Even better if readily available | The optional directory lookup was removed at Russell’s request; there are no P4 questions in the current email. |

The accepted October 2024 model/engine eligibility baseline remains in place. Asking for a guide or newer tables does not make replacing that baseline a prerequisite. Retain source dates, scheme applicability and explicit assumptions where evidence is missing.

## Email questions and design consequences

Numbers below refer to bullet order in the email; they are omitted from the email to keep it simple.

| Email | Priority | Evidence requested / decision affected | Original questions |
|---|---|---|---|
| 1 | P2 | Live versus planned capabilities, release delay and remaining batch dependence. Determines which modernisation claims and event/polling assumptions are credible. | SAN-004, 015 |
| 2 | P2 | Accessible interface contracts/examples and source ownership. Check employee, scheme, entitlement/slot, contract, exact-stock and order identifiers; distinguish VIN from a stock/hold key. Examples should preserve schema and relationships while anonymising values. Capture release visibility/freshness and read/write capability; do not infer writes from readable data. | SAN-004, 012, 017, 019 |
| 3 | P2 | Correct scheme identity and applicable rulebook. PCS UKFS BMW is not established as interchangeable with FS Choices. Resolve missing driver figures and conflicting contract/mileage/renewal evidence without reopening the agreed model matrix. Existing documented exception rules are useful; no request to invent extensions. | SAN-010, 016, 018, 019; scheme-applicability gap |
| 4 | P2 | Actual points, allowances, effective dates, cash calculation and price fixation. These determine affordability and quote semantics. Retail prices and INT values cannot supply them. | SAN-001, 008, 019 |
| 5 | P2 | Current hold triggers, release/expiry/interruption behaviour, longer-hold capability and withdrawal conflicts. Establish whether the proposed two-hour buddy hold needs new backend behaviour. Technical support does not establish business permission for that policy. | SAN-004, 009, 013, 017 |
| 6 | P2 | Actual order commitment, approval states, uncertain-write reconciliation and complete declarations/readback. A received order, approval and booked collection are different states. Existing status/operation definitions should establish safe retries; the email does not require Sandeep to design a new API. | SAN-013, 017, 020 |
| 7 | P2 | Employee/current-car attribution, actual fitted specification, model/type joins and description/image sources. Check build/effective dates, completeness and representative-image limits. Contract examples from question 2 should distinguish start/current mileage and requested/earliest/booked/actual collection/return dates. | SAN-004, 012, 019 |
| 8 | P2 | Where each supply stage actually lives and any documented amendment cut-off. Determines whether Greg’s supply loop maps to APIs, files or spreadsheet handoffs. A requested car is not confirmed or released stock. It does not ask Sandeep to explain Greg’s judgement or negotiate Production capacity. | SAN-006; explicit recording-boundary gap |
| 9 | P3 | Outcome of the already-recorded Pete Thorne enquiry and documented connected signals, coverage/freshness/use conditions. No new enquiry is requested. Consumer My BMW features and VIN handbooks do not prove a GCSP feed. | SAN-012 |
| 10 | P3 | Reports/support material that already exists, with dates and definitions. Could ground scale and pain points, but cannot establish ideal unmet demand, personal KPI ownership or measured benefits by itself. | SAN-003, 005, 006, 016 |
| 11 | P3 | GCSP/GCSO’s actual mail integration as a practical future-adapter reference. Demo sender/transport setup remains with Russell/Gary; this is not an enterprise-wide mail-architecture request. | SAN-014 |
| 12 | P3 | Documented current stock-channel rules and effective TNR changes. Supports truthful treatment of old stock-clearing assumptions; no commercial-authority enquiry. If absent, qualify or omit claims rather than assume the 2024 predictions took effect. | SAN-006, 007; explicit dated channel-policy gap |

## Additional gaps exposed or made explicit

These gaps were scattered across the research or only implicit in broad SAN questions. They are now concrete requests rather than claims of newly discovered system defects.

| Gap | Existing evidence | Where addressed |
|---|---|---|
| Scheme mismatch can invalidate contribution/driver assumptions | [Blueprint research](service-blueprint-research.md), monthly-contribution section; [manual refinement](manual-journey-refinement.md), evidence boundaries; [HLD](../design/gcsp-high-level-design.md), authoritative rules gate. Choices’ £1/excess-point rule is not proved for PCS UKFS BMW. | Email 3–4, P2 |
| Joining systems needs stable identifiers and dated mappings | [BMW interface research](bmw-interface-research.md), identity/dates and adapter boundaries; [HLD](../design/gcsp-high-level-design.md), exact-stock and vehicle-evidence contracts. VIN, stock ID, UK model code and AG code have different roles; catalogue fallback can change derivative. | Email 2 and 7, P2 |
| A hold must survive conflicts and uncertain outcomes | [Manual refinement](manual-journey-refinement.md), expiry/uncertain writes; [HLD](../design/gcsp-high-level-design.md), transaction invariants. A local timeout is not proof of remote release or failed order creation. External withdrawal needs a defined result. | Email 5–6, P2 |
| The planning pipeline may cross manual and system boundaries | [Background/Mural summary](background.md), November 2024 process; [business exploration](business-model-exploration.md), demand-to-disposal chain; [HLD](../design/gcsp-high-level-design.md), Greg’s supply loop. No current contract proves all three stages are in GCSP/GCSO. | Email 8, P2 |
| UK VIN profile semantics remain unsupported for important derivatives | [VIN rules](synthetic-vin-rules.md), UK baseline comparison and observations; [synthetic fleet proposal](synthetic-vin-fleet-proposal.md), profile/coverage requirements. Four candidate observations, including the newly supplied G60/G61 pairs, do not establish all-five-WMI UK/RHD coverage. | Russell’s [sample checklist](vin-sample-checklist.md), P2 research |
| Channel-change predictions are dated | [Background](background.md), stock management/ownership: predicted MINI changes from March 2025 and BMW changes from 2027. Present applicability is unverified. | Email 12, P3 |
| Audience titles are unresolved, but can be looked up | [Persona source register](personas/sources.md), E2: Stuart’s account-plan and ISC titles differ. The brief names attendees without establishing their roles. A directory lookup can establish the listed title, not a responsibility matrix. | Removed from Sandeep’s email at Russell’s request |

Connected-data coverage, missing driver figures, complete declarations, points and contract periods were already known gaps. They are retained and simplified, rather than counted as new discoveries.

## Disposition of all twenty original questions

Priorities apply to the answerable parts or the stated demo use. Questions outside Sandeep’s remit stay open for a separate route; their omission from the email does not imply resolution.

| Original | Priority / treatment | What remains outside this email |
|---|---|---|
| SAN-001 | P2, email 4 | No assumed current points amounts or conversion. |
| SAN-002 | Remove the role/decision-rights enquiry from Sandeep’s email. P2 if that authority is needed for live operation; explicit demo controls remain Russell’s decision. | Greg’s current responsibilities, Greg/Charles split and who may approve exceptions or policy. Directory job titles do not answer this. |
| SAN-003 | P3, email 10 for existing reports only | Who owns success measures, personal scorecards, current targets, enterprise operating cost and commercial baselines. |
| SAN-004 | P2, email 1–2 and 7 | Credentials/access provisioning and organisation-wide authorisation. Existing accessible integration/use documentation is welcome; it does not itself grant access. |
| SAN-005 | P3, email 10 for existing support/feedback evidence | Recruiting employee interviewees or explaining personal needs from someone’s job. |
| SAN-006 | P2, email 8 for recorded supply stages; P3, email 10/12 for existing reports/channel rules | Asking Greg why he chose a mix, proving latent ideal demand, or negotiating Production flexibility. |
| SAN-007 | P4 for the optional full-cycle commercial scenario; keep outside Sandeep’s email | Ownership/risk/funding reconciliation, acquisition costs, realised residuals and group economics need commercial evidence. An accessible channel-policy document is the narrower P3 question 12. |
| SAN-008 | P2, email 4 for implemented price/effective-date mechanics | Authorising demand-responsive/personal pricing or incentive changes needs reward/commercial ownership. The demo must label its policy assumptions. |
| SAN-009 | P2, email 5–6 and any existing rulebook for current behaviour | New fairness, delegated-choice, manual-versus-buddy and recovery policies. Russell must agree illustrative demo rules; the appropriate BMW owner must agree live rules. |
| SAN-010 | P2, email 3 for documented contract/extension limits | Authority to offer new flexibility and its commercial value. Absence of a documented extension does not create permission. |
| SAN-011 | P4 for the optional BMW-specific compliance/economics scenario; keep outside Sandeep’s email | Manufacturer/pool compliance position, marginal EV value and remarketing balance. General regulation research does not answer these. |
| SAN-012 | P2, email 7 for static/build data; P3, email 9 for optional usage; VIN sample research moved directly to Russell | Cross-enterprise connected-data permission, new Pete Thorne outreach, third-party procurement/licensing or approval of Outvin. |
| SAN-013 | P2, email 5–6 | Business approval of the proposed two-hour hold and any new commitment/quote policy. |
| SAN-014 | P3, email 11 for incumbent integration documentation | BMW-wide transport approval, tenant changes and demo sender setup. Gary/Russell retain GC-005. |
| SAN-015 | P2, email 1–2 | Portfolio-wide achieved-benefit claims not supported by a specific platform example. |
| SAN-016 | P2 for documented renewal/exception behaviour in email 3/6; P3 for existing cases in email 10 | Creating recovery-priority policy or assigning Greg new responsibilities. |
| SAN-017 | P2, email 5–6 for transaction behaviour | Minor history-icon/navigation/print details can follow up if missing from the supplied screens/docs; they do not justify another long initial question. |
| SAN-018 | P2, email 3 and examples under email 2 | Changing driver/HR/licence policy. |
| SAN-019 | P2, email 2–4/7 for source fields, scheme rules and units | Inventing a current contract policy from conflicting INT/dates or transferring Choices rules to PCS. |
| SAN-020 | P2, email 6 | Drafting/approving new legal wording or executing downstream approval, signing or appointment workflows. |

## Research coverage and limits

The review checked the current repository research and its open-decision sections across:

- The [index](README.md), [brief](demo-brief.md), [experience contract](experience-quality.md), [background](background.md), [discovery findings](discovery-findings.md), and current Sandeep/Gary question registers.
- [Business exploration](business-model-exploration.md), [argument check](business-model-argument-check.md), [ZEV research](zev-mandate-research.md), [capability proposals](capability-breakdown.md) and [delivery evidence](delivery-evidence.md).
- The [personas and source register](personas/README.md), [blueprint research](service-blueprint-research.md), [revision 3](service-blueprint-review-v3.md) and [revision 4](service-blueprint-review.md) records. The brief’s later slider/importance clarification takes precedence over the superseded short-input proposal.
- [Manual journey refinement](manual-journey-refinement.md), [engine assessment](engine-reuse-assessment.md), [shared recommendation design](shared-recommendation-design.md) and the canonical [whole-demo HLD](../design/gcsp-high-level-design.md), including the implications for the published implementation-story sets.
- [BMW interface research](bmw-interface-research.md), [adapter capability map](bmw-interface-stories.md), [synthetic fleet proposal](synthetic-vin-fleet-proposal.md), [VIN rules](synthetic-vin-rules.md), and the related scheme/Mural source summaries and evidence indexes. The older [retail specification gap note](../bmw-spec-gaps.md) supplies model estimates, not exact fitted-equipment evidence.

This was a document review. It did not refresh live BMW, Confluence, Jira, directory or Account Corpus records, reopen the original private Box documents, or verify the external sources behind the saved research. No Sandeep answer has been received and no email has been sent. Russell subsequently supplied two VIN sample pairs, recorded only as sanitised observations. Deployment, durable state, runner and demo mail provisioning remain Gary/Russell questions rather than being transferred to Sandeep. No Jira changes, application changes, commits or agent delegation were made.

## Editorial check

Reviewed the email using the critical-review skill. Internal coherence and source applicability pass; no new claim of BMW capability or permission is made. No unresolved verify-or-cut flag remains. IBV/statistical checks do not apply to this retrieval email; the subject fits its purpose. The inferred takeaways are: retrieve existing evidence, start with design-affecting questions, and leave inaccessible answers open. Professional tone and busy-reader checks pass. Russell-voice, presentation and memorable-phrase checks do not apply. The directory and VIN-sampling questions have been removed from Sandeep’s list. All original SAN entries have a recorded disposition; missing answers remain open. Verdict: ready for Russell to send.
