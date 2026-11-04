# Paula blueprint: evidence behind revision 4

Reviewed 1 November 2026 for [FUCQ-3](service-blueprint.html). This records desk research and design decisions, not interviews with employees or a tested production design.

## Her precise current car

The [replacement-vehicle screen](screens/01-replace-vehicle.webp) explicitly identifies **G21 320i M Sport Touring LCI2 B48 2.0i**, with transmission **AUT** and **Portimao Blue Metallic** paint. Russell confirmed that this record anchors Paula’s current car in the story. The earlier 5 Series premise was wrong and has been removed from the current blueprint.

Use **BMW 320i M Sport Touring (G21 LCI2), B48 2.0-litre petrol, automatic, Portimao Blue Metallic** throughout. The interior field reads “Black with Grey Contrast Stitching Verna”; it is cut off, so the current artifact uses the visible black / grey-stitching description without expanding the upholstery name.

The screen’s equipment list includes **heated steering wheel (248), panoramic glass sunroof (402), electric memory seats (459), driver-seat backrest-width adjustment (491), high-beam assistant (5AC), adaptive LED headlights (552), Harman/Kardon audio (688), M Sport package Pro (33B), Technology Pack (7A2) and Comfort Pack (7LG)**. These give the personal view and replacement comparison specific things to celebrate or compare. The M Sport Pro package does not change the displayed base derivative into a different model name.

These are supplied test-record facts used for the scenario, not a verified real person’s production vehicle record. The source status is “Approved Awaiting Appointment” and actual collection is blank; Russell’s direction uses the displayed vehicle as the current-car anchor for the narrative. Its fuel-consumption fields are catalogue-type fields with questionable values / units, not observed driving data. They must not populate Paula’s personal average MPG. No registration, full VIN, current odometer or observed trip data is invented. Live use requires the authoritative identity / equipment record; model dimensions require a checked specification source.

## Monthly contributions are documented

[Choices Car Scheme Guidelines v1.6, June 2024](sources/choices-car-scheme-guidelines-v1.6.md), **§1.2, page 9**, explicitly permits cash contributions for cars above an employee’s points entitlement, calculated at **£1 per excess point** and deducted monthly from salary. Appendix A’s agreement wording repeats this basis. The guide also warns that points and pounds can have different tax consequences.

Use **“maximum extra monthly payment”** in Paula’s brief, with **“£0 extra”** available. Explain that this is the contribution above her allowance, not the full financial or tax cost. Do not suggest she can buy extra equipment or override vehicle / driver eligibility by paying more. The screen’s scheme is **PCS UKFS BMW**. The Choices guide proves the contribution mechanism for Choices; its applicability to this PCS scheme is not established. The illustrated contribution branch therefore remains conditional on scheme-owner confirmation. Hide the question when the selected scheme does not allow it. Current allowance, price tables, tax presentation and policy must be confirmed before live use. The first-rejection story remains coherent: a car can fit her stated maximum and still feel poor value; she explicitly lowers the maximum afterwards.

## A personal usage view is credible; access is unproven

BMW’s public consumer features provide a useful reference:

| Source, accessed 1 November 2026 | What it supports | Boundary for this service |
|---|---|---|
| [My Trips FAQ](https://www.bmw.co.uk/uk/s/article/What-is-My-Trips-in-the-MyBMW-App-C4NoY?language=en_GB) | Previous-trip consumption, distance and average speed, depending on model / equipment. | A consumer app feature does not establish an API, enterprise permission or available history for GCSP. |
| [My BMW App](https://www.bmw.co.uk/en/topics/owners/bmw-apps/my-bmw-app.html) and [mileage FAQ](https://www.bmw.co.uk/uk/s/article/How-can-I-find-out-the-mileage-of-my-BMW-Ri89I?language=en_GB) | Petrol-car fuel status / estimated range and access to mileage. | Fields vary; current-car identity, permitted access and freshness need validation. |
| [Vehicle-status update FAQ](https://www.bmw.co.uk/uk/s/article/My-BMW-App-Vehicle-status-Update-Troubleshooting-PT1sQ?language=en_GB) | Last-update time, connectivity limitations and consent / Remote Services dependencies. | Display the time and coverage. A stale reading is not live data. |
| [BMW UK electric-range guidance](https://www.bmw.co.uk/en/electric-cars/electric-car-range.html) | My Trips can support a consumer electric-vehicle analysis against recorded journeys. | Trip suitability is not proof of a workable home / work charging plan; do not add a speculative EV fit percentage. |

The proposed first view shows the precise car, imagery, **30-day miles, average MPG, weekly efficiency trend, longest recorded journey, remaining agreement mileage and service status**. These are proposed display fields, not numbers observed for Paula. Period, coverage and last update accompany them. Calculate consumption from comparable distance and fuel totals rather than a simple average of individual trip MPG. Contract-mileage headroom combines the current odometer with the agreement’s start mileage and limit.

No suitable evidence was obtained for a universal BMW **driver score for this petrol 320i**. Leave it out. An efficiency trend is useful without implying a safety assessment, employer performance score or a new allocation rule. Exact journey maps are unnecessary for this view. Connecting is optional; no permitted feed must not block the renewal.

## Reduce decisions before refining their presentation

Primary usability guidance supports removing questions, reusing known information and showing conditional detail:

| Guidance | Finding used here | Result in the blueprint |
|---|---|---|
| [Nielsen Norman Group, *Less Effort, More Completion*, 6 March 2025](https://www.nngroup.com/articles/eas-framework-simplify-forms/) | Eliminate nonessential / nonurgent questions, reuse existing data, then simplify remaining input. | Remove preference sliders and separate importance weights. Do not ask about every possible fitted feature. |
| [GOV.UK Design System, Question pages](https://design-system.service.gov.uk/patterns/question-pages/), accessed 1 November 2026 | Ask only needed information; do not ask the same thing twice; prefill or carry forward known answers. It also advises against range-slider questions. | Drivers, dates and known needs are reviewable defaults, not blank questions. The next renewal does not repeat setup. |
| [GOV.UK Service Manual, Structuring forms](https://www.gov.uk/service-manual/design/form-structure), published 2016, updated 2018 | Give each question a clear purpose, design common paths first and branch so users answer relevant questions. This is longstanding design guidance, not a current completion-rate study. | Reveal only missing practical checks or relevant “Add a must-have” detail. Keep advanced preferences optional. |
| [NHS digital service manual, Make sure you need each question](https://service-manual.nhs.uk/content/how-to-write-good-questions-for-forms/make-sure-you-need-each-question), accessed 1 November 2026 | Identify what the organisation already has, fill the gaps, and defer questions not needed now. | Defer booking and documents until the car is selected; avoid a lifestyle questionnaire at setup. |

The local CX corpus was checked; it supplied general commentary on cognitive effort rather than direct evidence for these form choices. An IBM IBV search found no directly relevant form-field or progressive-disclosure study. General AI / personalisation findings were excluded because they do not validate this input design. No completion-time or conversion-uplift statistic is claimed.

### The proposed minimum input contract

| Input | Why it affects the search | What Paula does |
|---|---|---|
| Two broad priorities, one optional improvement | Orders otherwise suitable cars; gives useful comparison language. | Selects Comfort / Space and Easier parking from a six-theme set. Three choices, without feature ratings or weight tuning. |
| Known drivers and practical requirements | Avoids a legally ineligible or practically unusable recommendation. | Confirms a prefilled summary; only missing or changed essentials trigger follow-up. No driver is assumed from connected trips. |
| Maximum extra monthly payment | Applies a clear affordability boundary. | Enters a £ figure or chooses £0 extra. No paid amount is preselected. |
| Charging readiness | Prevents plug-in recommendations that cannot work in practice. | Answers ready / not yet / not sure. Not yet / not sure keep plug-in options out until a plan is confirmed. |
| Return / collection window | Prevents a known gap in transport. | Checks the agreement-derived window and edits only a genuine timing constraint. |
| Search / temporary-hold permission | Makes delegation intentional. | Explicitly starts the agent after reviewing the brief. This never authorises an order. |

This is a short path when known records are complete, not a promise that every user can finish with a fixed number of taps. An unknown must-have must be resolved before a car is represented as suitable. Broad “Space” preference does not automatically mean an exact minimum boot volume; only Paula’s confirmed carrying requirement becomes a constraint. Comfort remains an explained comparison, not a guaranteed feeling inferred from a model badge.

Test the proposal with representative employees: can they form a brief without help, distinguish priorities from must-haves, understand extra payment, correct a prefill and explain what the agent may do? Record time, hesitation, corrections, abandonment and unsuitable recommendations. No such employee test has yet been run.

## Journey decisions from Russell’s review

- **01a:** a proposed modernised manual gallery demonstrates that imagery and clearer presentation alone do not remove the release-day race. Monday is the narrative example; release timing is not established as a universal rule.
- **04a:** the agent gets its own does / sees column. Eligibility, practical checks, comparison, allocation and the confirmed hold are separate actions.
- **06:** “My rejections” preserves the car, old quote, reason and comparison. A rejected car returns to the same eligible pool after the stock owner confirms release. Paula does not receive a privileged queue position.
- **End at 13:** physical collection, after-use feedback and a second renewal are removed from the primary walkthrough. The continuing service still updates the current car after confirmed handover and reuses the saved brief, asking only what changed.

All of these remain proposed service behaviour for review. This revision creates no implementation stories or Jira changes.
