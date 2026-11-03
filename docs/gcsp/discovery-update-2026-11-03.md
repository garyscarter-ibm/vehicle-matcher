# GCSP discovery update — 3 November 2026

Technical answers dated 2 November were reviewed on 3 November. Detailed source analysis and the follow-up draft are held privately with the original planning correspondence. This published note records the demonstration decisions, current question dispositions and general design constraints. It does not reproduce the private system map, source email, contact details or interface material.

## Confirmed demonstration direction

Russell confirmed on **3 November 2026** that **Paula remains in the points-based Choices scheme**. Keep the agreed **October 2024 eligibility matrix**. Other schemes' cash allowances, contribution rules, contract rules and driver entitlements must remain separate; screenshot labels and example values cannot transfer those rules into Choices.

The full planned demonstration remains in scope. Preserve the existing shared policy/assumptions requirement: confirmed facts and plausible assumptions have provenance/status, units, effective context and coherent versions in one canonical source used by every consumer. This research note is input to that source, not a second runtime defaults table. Missing live-service evidence does not prevent a functioning synthetic demonstration.

## Design consequences

| Area | Requirement for the existing design and implementation scope |
|---|---|
| Current versus target interfaces | Keep today's platform, planned integrations and the synthetic demonstration distinct. A named upstream system or architecture overview does not establish an available endpoint, supported write operation, payload schema, access permission or delivery date. |
| Scheme, grade and affordability | Choices points, grade allowance, model eligibility and employee cash contribution are distinct concepts. Preserve typed units/periods and explicit override/effective-date rules. Neither an allowance-administration description nor a screenshot supplies current prices or a conversion formula. |
| Identity before and after ordering | Keep employee, entitlement, exact released-stock, order-reference and VIN identities separate. Ordering/stock actions must work with their stable identifiers when a VIN is absent. A VIN is optional vehicle evidence at stages where it is unavailable. Current-car attribution and verified fitted specification still need their own joins and source assurance. |
| Holds and stock conflicts | Manual selection and final-review timing are separate from the proposed longer buddy offer. Configurable duration does not establish business permission or a cross-system exclusive claim. Preserve server-owned claims, authoritative expiry, withdrawal handling and reconciliation before declaring success or making stock available again. |
| Selection, approval and readback | A recorded selection/order is not final approval or a collection booking. Make approval routes/statuses configurable and truthful. An uncertain external submission remains pending until reconciled; an error response alone does not prove that nothing was written. |
| Driver checks | Eligibility rules, consent/check status and an authorised approval decision are separate facts. A configurable eligibility rule must not be presented as proof of a completed licence check or approval. |
| Mail | Keep notification content/outbox and transport independent. The actual incumbent transport and the demo's available sending service are separate questions; Microsoft identity alone does not determine the transport. |
| Stock freshness and presentation claims | Require evidence for a quantified latency or an achieved before/after improvement. UI unification, planned modernisation, an asynchronous update or a qualitative freshness description cannot establish an event contract or latency guarantee. |
| Requested, confirmed and released supply | Retain separate requests, provider acknowledgements and selectable stock. Knowing a recording system does not establish amendment cut-offs, a complete production workflow or a usable write interface. |
| Optional data and commercial claims | Keep connected-use summaries optional and their coverage/use permissions explicit. No report, current channel policy or future commercial change should be claimed from a promised follow-up or an absence of documentation. |

The authorised synthetic VIN/corpus capabilities remain planned. Separate order identity and optional early-stage VIN availability do not remove FUCQ-19/20 or turn a specification lookup into stock/reservation authority.

## Current disposition of the original twenty questions

The original entries in [the Sandeep register](questions-for-sandeep.md) retain their historical wording and status text. **This table supersedes those historical status statements.** No broad SAN entry is fully closed. Narrow facts supplied in the reply do not answer every part of a multi-part question.

| Question | Current status on 3 November | Still required |
|---|---|---|
| SAN-001 · Points and allowances | Partly answered: administration described | Dated numerical Choices tables, units, contribution calculation, overrides and price fixation. |
| SAN-002 · Ordering role and rights | Open; outside the retrieval email | Current role and policy/exception authority evidence. No role has been inferred from a technical answer. |
| SAN-003 · Measures and baselines | Evidence pending | Actual reports, definitions, periods, ownership and baselines; a follow-up route is not measured evidence. |
| SAN-004 · Platform boundaries | Partly answered: overview supplied | Current/planned availability, schemas/examples, record joins, read/write contracts, events/polling and access. |
| SAN-005 · Employee needs | Evidence pending | Actual employee feedback/themes and validation evidence. |
| SAN-006 · Demand and supply | Partly answered: recording context supplied | Requested/confirmed/released history, demand/outcome evidence and amendment cut-offs. |
| SAN-007 · Lifecycle economics | Open; substantive economics not supplied | Current commercial ownership, costs, residuals and channel policy evidence. |
| SAN-008 · Points-change authority | Open | Vehicle-price authority/purpose/effective rules; allowance administration does not establish authority to change vehicle points. |
| SAN-009 · Fairness and delegation | Open | Allocation, delegated choice, refusal/non-response and recovery policy. Technical holds do not authorise these rules. |
| SAN-010 · Timing flexibility | Partly answered: configurable rule context | Actual Choices term/mileage/renewal rules, extension permission, owner and costs. |
| SAN-011 · EV compliance | Open; outside the retrieval email | BMW-specific compliance/economic evidence; no new regulatory conclusion is made. |
| SAN-012 · Current car and usage | Partly answered: order-identity context | Employee/current-car/VIN/fitted-specification joins; separate connected-data route, coverage, freshness and use permission. |
| SAN-013 · Hold and acceptance | Partly answered: technical behaviour described | Exclusive-operation contract, precise triggers, withdrawal/reconciliation, longer-hold authority and quote/commitment rules. |
| SAN-014 · Application mail | Partly answered: incumbent protocol identified privately | Integration documentation, authorisation/sender details and separate demo provisioning. |
| SAN-015 · Availability improvements | Partly answered: qualitative freshness reported | Scope, measured timing, before/after baseline, event/polling contract and release dates. |
| SAN-016 · Unresolved renewals | Open | Actual remedies, intervention ownership and recovery rules. |
| SAN-017 · Manual transactions | Partly answered: duration context supplied | Start/transition/release triggers, navigation/interruption cases, atomicity and safe submit recovery. |
| SAN-018 · Drivers | Partly answered: rule/check/approval stages distinguished | Dated Choices family/age/licence/entitlement figures and representative statuses. |
| SAN-019 · Contract, collection and costs | Partly answered: scheme distinction clarified | Actual term/mileage/date fields, units/periods, override expiry, contributions and quote fixation. |
| SAN-020 · Declarations and order outcome | Partly answered: approval-route context | Complete versioned declarations, acknowledgement record, state/readback fields and reconciliation semantics. |

Russell's actual email contained **fourteen questions: nine P2 and five P3**, with regrouping compared with the saved twelve-bullet draft. The private assessment maps every actual question, including the separately answered scheme-identity and stock-freshness questions. The saved draft and its review remain historical preparation records.

## Backlog and follow-up

Use this as a source clarification for existing FUCQ-6 design, FUCQ-7 manual journey and FUCQ-8 shared recommendation work. Apply the identity/evidence boundaries to FUCQ-14–20, the supply-stage distinction to FUCQ-74, and relevant failure paths to the repeatable scenarios in FUCQ-75. This update does not create new backlog capabilities, change priorities/statuses, start implementation or provision live access.

The private follow-up draft prioritises the applicable Choices rule pack, hold/interruption flow, order/approval/reconciliation example, current-car specification linkage and complete declarations. Existing promised evidence checks are tracked separately. No message to an external contact has been sent by this task.
