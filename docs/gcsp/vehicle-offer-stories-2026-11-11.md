# Approved vehicle offer direction and Stories — 11 November 2026

The collaborator approved the [local concept](mockups/vehicle-offer-2026-11-11/index.html) after the final caption, alignment, overflow and decline edits. [Five benefits](mockups/vehicle-offer-2026-11-11/benefits-expanded.html) demonstrate the wrapping rule. Independent critique and corrected desktop/narrow reinspection passed within the concept scope; [the review](mockups/vehicle-offer-2026-11-11/review/final-review.md) records evidence and limits.

Delivery update, 11 November 2026: FUCQ-383–386 and the explicitly authorised FUCQ-382 prerequisite are built, merged and In Review. The bounded poller stopped after these five items. Russell lifted the Bug's diagnosis-only hold and authorised the compact expected-return-mileage field through the existing handoff contract. See the [delivery report](dev-poller-fucq380-2026-11-11.md) for current evidence and limits. The sections below preserve the earlier design/backlog-authoring record; their To Do/unassigned, no-pickup and implementation-not-started statements describe that earlier point, not current state.

## Original authored scope

All four new Stories belong to [FUCQ-380](https://ibm-consulting.atlassian.net/browse/FUCQ-380). Native Jira is authoritative for their complete acceptance, decisions and validation. They are unassigned, To Do, with the default Medium priority and no Story-point estimate. This session authors the backlog; it does not start production implementation or a dispatcher.

| Story | Bounded capability | Existing work reused |
| --- | --- | --- |
| [FUCQ-383](https://ibm-consulting.atlassian.net/browse/FUCQ-383) | Full-width offer, prominent h:mm countdown, finish swatches, Benefits/Tradeoffs, wrapping overflow and winning comparison cells | FUCQ-105 presentation/clock and FUCQ-337 meaningful comparisons |
| [FUCQ-384](https://ibm-consulting.atlassian.net/browse/FUCQ-384) | Seeded readable option/paint/upholstery definitions with keyed local lookup before quote pinning | Existing configuration-ID index, FUCQ-60 enrichment and FUCQ-382 propagation repair |
| [FUCQ-385](https://ibm-consulting.atlassian.net/browse/FUCQ-385) | Seeded two-exterior/one-interior gallery, featured-image selection and accessible enlarged viewer | FUCQ-323 correct single-image coverage and existing retained-image provider |
| [FUCQ-386](https://ibm-consulting.atlassian.net/browse/FUCQ-386) | Acceptance declarations/documents and fixed-reason decline in shared side drawers | FUCQ-106 decisions, FUCQ-108 handoff, FUCQ-107 follow-up and Your cars sideDrawer |

The Epic is In Progress because its first follow-on Stories have been authored; its Start date is 11 November 2026. This status does not establish an active implementation worker or accepted functionality. Native parent, type, descriptions, statuses, assignment, priority and all 12 Story relations were read back. Relations provide context; no new automatic blocking links were added.

## Agreed design

The pending offer has no order number or Scheme fact. Accept is the primary action and Decline the next most prominent, before the gallery at narrow widths. Decisions open a side drawer and only its final confirmation submits. All three incumbent declarations and relevant document links remain in acceptance. Decline uses the existing PolicyService `offer.declineReasons.v1` choices, currently Body style, Size, Fuel type and Equipment; it has no free text or free-text payload.

Benefits and Tradeoffs retain the large-number treatment, with Benefits subtly accentuated. Desktop uses equal thirds shared with the comparison: Benefits spans two columns, Tradeoffs one. Additional benefits wrap into two-card rows with clear individual boundaries, an unpainted unused slot and a natural-height tradeoff card. Narrow layouts stack the groups. Comparison emphasis follows the grounded winning cell in either car; ties, unknowns and preference-dependent differences stay neutral. The redundant comparison caption and extra product links/labels are removed.

Thumbnails replace the featured image in place. A magnifier opens that selected image with a scrollable thumbnail strip and left/right navigation. Paint and upholstery retain readable labels alongside swatches.

## Data and existing contracts

[The diagnosis](mockups/vehicle-offer-2026-11-11/diagnosis.md) traces facts lost upstream of the renderer. [FUCQ-382](https://ibm-consulting.atlassian.net/browse/FUCQ-382) keeps that defect separate and retains its diagnosis-only/no-pickup hold. Story authoring does not claim a repair or live reproduction. FUCQ-384 adds reusable readable definitions; it must not hide the Bug's identity/snapshot repair within its scope. FUCQ-60 already requires evidenced attribute meanings, paint/upholstery and selected-equipment mapping on configurations. Its original unmet criteria remain its obligation; the new local index reuses that enrichment contract and does not transfer or declare those gaps complete. Reuse the indexed configuration lookup instead of building another configuration database. Preserve exact identity, provenance, missing-versus-absent distinctions and historical quote terms.

[FUCQ-337](https://ibm-consulting.atlassian.net/browse/FUCQ-337) already owns meaningful exact-configuration comparisons. Its parent, original contract and status remain intact; it relates to this Epic and the relevant new Stories. The collaborator will identify high-value options once readable specifications are available. No option priority/ranking decision is inferred from the illustrative mockup or other proposals.

The front image is already catalogued; the mockup rear/interior images still need supported production seeding/association. Configuration-selected equipment and model imagery do not establish verified physical-car fitment. There is no production wiring, countdown, submission or decision implementation in this concept. The gallery is its only working interaction.

## Delivery and validation boundary

Each Story references the shared experience contract, component kit, agreed visual states, authoritative adapters and central policy. Plans include the actual producer/consumer integration slice. At pickup, assess the code/interface evidence and current ownership rather than using Jira relations as admission gates. Keep existing claimed acceptance fixed. Use scoped affected checks, real producer/readback evidence and independent substantive desktop/narrow critique; fixtures or an integration merge alone do not prove acceptance. The current authoring session ran no production/full application suite.

The local Jira import uses the repository sync tool and preserves the prior global polling watermark for this targeted import. Product-map work remains not-started, with no active worker claims. All authored records and the local visual changes are committed and pushed to `gcsp-poc`; no Artifacts upload or feedback form is used.
