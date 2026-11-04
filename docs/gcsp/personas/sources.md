# Persona source register

Reviewed 31 October 2026; Paula scenario added 1 November. Supports the provisional personas in [README.md](README.md). This is provenance for role-level statements and scenario anchors, not a record of persona interviews.

Real contacts appear here only to make the source selection traceable. Their names, contact details, supplier relationship ratings and unrelated commercial information are not persona attributes.

## E1: Employee role

**Anchor:** Gillian Stayte, selected from the BMW Account Corpus. The corpus records employment with BMW Financial Services (GB), an Agile Development Manager title and a client product-owner role in the BMWFS DevOps workstream.

Account Corpus references:

- `person:gillian-stayte` — `model/person/gillian-stayte.json`.
- `role:bmwfs-devops-client-product-owner` — `model/role/bmwfs-devops-client-product-owner.json`.
- Person history traces identity to signed agreement source `d-0cb032561cf7` and the current job title to ISC source `d-cac3b10570de`, effective 26 October 2026.

**Limit:** This establishes work context only. It supplies no actual scheme participation, personal grade, allowance, household, age, travel needs, satisfaction or vehicle preference. This was P01's original work-context anchor; the revised Paula scenario does not transfer Gillian's role or biography to Paula.

## E2: IT leadership role

**Anchor:** Stuart Seeley, as requested by Russell. The account-plan history records “IT Director, Sales/Aftersales/Finance”. Russell identifies him as the IT director running the platform.

Account Corpus references:

- `person:stuart-seeley` — `model/person/stuart-seeley.json`.
- Account-plan source `d-ebe3ffa92fd6`, captured 23 October 2026.
- Person history also shows an ISC title of “IT Manager” effective 28 October 2026, source `d-b5d07cdc4a7d`.

**Limit:** The titles differ. The persona uses Russell's requested generic IT-director role; it does not resolve that source discrepancy or change the corpus. A wider leadership title does not establish every operational responsibility or KPI.

## E3: Cost and delivery decisions

Account Corpus correspondence queried through the model:

- `correspondence:2023-12-21-customs-hub-migration-risk-mitigation` — `model/correspondence/2023-12-21-customs-hub-migration-risk-mitigation.json`. A December 2023 thread records challenges to additional hours and approval of a revised, narrower technical go-live and monitoring proposal.
- `correspondence:2024-03-27-tnr-services-extension` — `model/correspondence/2024-03-27-tnr-services-extension.json`. Records a decision to monitor existing transition spend before raising another purchase order.

**Contribution:** Supports an interpretation of scrutiny of incremental cost, scope and delivery risk.

**Limit:** These concern other deliveries and are dated examples. They do not prove current scheme-specific budget priorities or numerical performance targets. Internal account-team sentiment about a supplier is not used as a persona motivation.

## E4: Modernisation direction

Account Corpus source extracts:

- `d-c63db2e26174` — `_text/d-c63db2e26174/full.md`, “BMW UK GCSO and ISA Modernisation proposal”, January 2026.
- `d-40c2dd0183ad` — `_text/d-40c2dd0183ad/full.md`, “Unified GCSO/ISA Frontend Modernisation”, March 2026.
- `d-6f2cdaa80148` — `_text/d-6f2cdaa80148/full.md`, “GCSP and Fleet Management Modernisation”, June 2026 heading; a proposal version with forward-looking references to later estimates.

**Contribution:** Consolidation, BMW Density/Angular frontend standards, Quarkus/API boundaries, cloud modernisation, security, maintainability, phased investment and reduced rework. These support the platform persona's operating context.

**Limit:** These are proposals and versions of a programme plan. Phase numbering and scope vary. They do not establish today's deployed stack, live API contracts, accepted scope, achieved benefits or a binding architecture for this POC. The June-labelled extract contains later-looking text, so the heading alone is not a reliable version date.

## E5: Delivery and operational dependencies

Account Corpus source `d-357359dda397` — `_text/d-357359dda397/p0001-0012.md`, report dated 14 October 2026, period ending 16 October 2026. Its GCSP UI Modernisation section records business-role migration, order approvals, business communications and business verification as release dependencies, with several marked completed.

**Contribution:** Concrete evidence that a release involves business decisions and operational coordination beyond UI implementation.

**Limit:** This is a dated status report. It does not establish the present state of those dependencies or prove that a planned release occurred.

## E6: Scheme operations research

[Background: Box note and Employee Vehicle Process call](../background.md#box-note-bmw-employee-car-scheme-oct-nov-2024), summarising Elis Salyahetdinova's October/November 2024 note and the 7 November call with Greg, Jacob and Elis. Original [Box note](https://ibm.ent.box.com/file/1669641592632). Cross-checked against the repository's [Mural CSV](../sources/mural/timeline-2024-11-07.csv) and the [Mural summary](../background.md#mural-board-timeline-6-7-nov-2024).

**Ordering anchor:** Greg. The Mural also labels a lane “Greg / Charles Actions”. Greg's surname and formal job title are not established in these sources; no matching Greg person was found by the corpus person query.

**Contribution:** Renewal-cohort planning with a pivot table/Spec Matrix, Production requests and responses, stock management, employee dissatisfaction, conflicting stakeholder needs, residual-value concerns, and an explicit goal to reduce manual orders in a three-person team. The dated estimates of fleet size and unallocated stock are contextual evidence only.

**Limit:** Background is a research summary; the original Box note was not separately reopened during this persona task. Operational numbers, channel-change predictions and policy details are dated and sometimes conflict with other sources. Greg's current responsibilities and the split with Charles require validation. Original researchers' questions are not confirmed facts.

## E7: Portal walkthrough

[Background: walkthrough with Sandeep](../background.md#the-journey-as-we-know-it-as-is), captured 30 October 2026, and the repository's [screen collection](../screens/).

**Contribution:** Employee account, vehicle selection, approval and handover stages; selection from scheme stock; constrained availability.

**Limit:** Screenshots come from INT with junk data and support flow/layout only. Walkthrough timings and policy statements are not verified current operating rules. The screenshots do not establish prices, eligibility for a real individual or a performance baseline.

## E8: Scheme rules and eligibility

- [Choices guidelines v1.6](../sources/choices-car-scheme-guidelines-v1.6.md), June 2024, especially sections 1.2, 2, 3 and 6. Stated next review: June 2025.
- [Vehicle eligibility matrices](../sources/choices-eligibility-matrices-2024-10.md), orders from 1 October 2024, separate FS/UK and RR/Production populations.

**Contribution:** Scheme mechanism, points/cash contribution distinction and model/engine eligibility. Russell accepts the October 2024 matrices as the POC baseline despite their age.

**Limit:** No personal grade, allowance or usable vehicle price table is supplied for these personas. Missing extracted driver-rule figures and conflicting renewal terms remain gaps. A retail salary-sacrifice calculator is not an established model for this scheme. Do not derive eligibility from a contact's title.

## E9: Earlier proposals

[2024 IBM proposal](../background.md#earlier-ibm-proposal-ibm-x-bmw-employee-car-scheme-oct-2024) and [2025 stories/process map](../background.md#earlier-ibm-proposal-ecs-user-stories--process-map-2025), summarised from Box decks.

**Contribution:** Articulates the distinction between observed selection and true demand, and discusses employee satisfaction, fairness and business planning.

**Limit:** Ranked preferences, priority rules, predicted orders and allocation journeys are historical proposals, not agreed features or evidence of actual user behaviour. The named family in the process-map example is illustrative and is not reused as factual employee biography.

## E10: Project direction

Russell's instructions on 31 October 2026:

- Create one persona each for the BMW Group employee car chooser, the person ordering cars and the IT director running the platform.
- Draw employee and IT-role context from the Account Corpus; use scheme research for the ordering role. Keep personas name-agnostic.
- Build the backlog before proposing features. Keep documentation/personas in this repository because Confluence is unavailable.
- Sandeep is working on the backend and supplied the screenshots. Maintain questions for Russell to ask him, starting with points prices and allowances.

**Limit:** This establishes the task and role selection; it does not validate every proposed motivation or measure.

## E11: Paula scenario

The [INT employee-account screen](../screens/00-employee-account.webp) displays Paula Robinson, BMW Financial Services (GB) Ltd and a Winchcombe address. Only the locality is retained in the persona. On 1 November 2026 Russell corrected the initial 5 Series description by pointing to the [replacement-vehicle screen](../screens/01-replace-vehicle.webp).

That screen identifies **G21 320i M Sport Touring LCI2 B48 2.0i**, transmission **AUT**, **Portimao Blue Metallic**, and a black interior with grey contrast stitching. The interior name is truncated after “Verna”, so it is not silently expanded. Listed equipment includes heated steering wheel, panoramic glass sunroof, electric memory seats, adaptive LED headlights, Harman/Kardon audio, Technology Pack, Comfort Pack and M Sport package Pro. Use **BMW 320i M Sport Touring (G21 LCI2), B48 2.0-litre petrol, automatic** as Paula’s current-car anchor in this story.

The [research record](../service-blueprint-research.md) transcribes the vehicle facts and separates them from optional connected-use data, contribution policy and minimum-input design. The earlier generic 5 Series assumption is superseded.

**Limit:** These are test-screen anchors, not verified real-world personal details. The displayed vehicle is awaiting an appointment with no actual collection recorded; Russell’s narrative uses it as Paula’s current car. Screen consumption values are not observed MPG. Personality, weekend activities, working pattern, driveway without a chargepoint and empathy-map quotations are authored. No personal interviews were conducted. Grade, allowance, dates and other-driver records do not establish current operating rules. E1’s source-contact job is not Paula’s job.

## E12: Farnborough and flexible working

Official BMW careers sources, read 1 November 2026:

- [Farnborough location](https://www.bmwgroup.jobs/gb/en/location/location-farnborough.html): Summit ONE houses BMW UK, BMW Financial Services and Alphabet.
- [Data & Analytics Manager vacancy](https://www.bmwgroup.jobs/gb/en/jobfinder/job-description-copy.196327.html), dated 11 September 2026: advertises hybrid remote/office working and individually agreed flexible hours for a BMW UK role at Farnborough.

**Limit:** The vacancy's legal entity is BMW UK, not BMW Financial Services. It demonstrates a published local hybrid offering, not an FS-wide attendance rule or Paula's arrangement. Two planned office days plus occasional workshops are representative scenario assumptions. No exact commute time, universal attendance requirement or home-charging provision is claimed.

## Reproducing the corpus checks

The Account Corpus is a separate repository. Paths above are relative to its root and intentionally avoid a machine-specific absolute link. Use its own access instructions and query tools to inspect `show` and `history` for the cited object references, and `text` for source lookup. The corpus was read at model HEAD 2748; it was not modified for this task.

No numeric KPI targets or complete personal scorecards were found in the records reviewed. Corporate programme intentions and IBM sales/signings measures are not individual BMW platform-owner KPIs.
