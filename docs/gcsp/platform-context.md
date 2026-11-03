# GCSO, ISA and GCSP platform context

Russell supplied this clarification and two slide screenshots on **2 November 2026**. His accompanying explanation establishes the current platform baseline below. The slides are supporting source material; their wording is recorded separately and does not authorise implementation or backlog changes.

## Current baseline confirmed by Russell

| Name | Meaning and role |
|---|---|
| GCSO | **Global Car Scheme – Ordering**, using Russell's supplied expansion. The mainframe application for ordering employee vehicles. |
| ISA | **Internal Sales Appointment**. Previously a separate system for vehicle handover. |
| GCSP | One UI unifying GCSO and ISA. It remains a UI over the mainframe for now; **Java modernisation follows**. |

The unified employee experience and the later Java backend modernisation are distinct stages. This supersedes the earlier wording in the demo brief and SAN-004 that could be read as saying the move from mainframe/batch processing to Java on AWS was already complete. Preserve the wording of older scheme documents as historical evidence, including any different acronym expansion.

## Supplied slide evidence

### GCSP launch / employee experience

Source: [GCSP: the new Employee Experience for BMW Group UKI](sources/gcsp-launch-slide-received-2026-11-02.png), supplied as a screenshot of slide 5; the slide itself is undated.

- Presents GCSP as one platform for selecting and ordering employee cars, bringing GCSO and ISA together.
- Describes the platform as running on AWS and being ready for future AI capabilities. This does not establish that its mainframe business logic has already been replaced by Java, or that any particular API or AI feature is live.
- Describes coverage across UK and Ireland locations, including plants and RRMC employees.
- Reports a new URL and users confirming it works. It also describes legacy GCSO/ISA shutdown and redirection on **3 November**, without a year. Record this as the slide's claim: the cutover year and completion are unverified. A redirect or retirement of the old application entry points does not establish mainframe retirement.
- Credits joint delivery involving development, BMW business/communications, IBM communications and BMW IT, including a launch video. The screenshot does not supply a playable video or its URL.

### BMW UK 2026 transformation overview

Source: [BMW UK 2026: Driving Transformation Through AI, Modernisation & Cloud](sources/bmw-uk-transformation-slide-received-2026-11-02.png), supplied as a screenshot.

- Positions the GCSP launch as combining GCSO and ISA into a single employee-car platform across BMW Group UKI.
- Lists mainframe modernisation separately, spanning GCSP, Fleet Management and Used Cars, alongside modernisation of 42 ACE integration flows.
- Supplies portfolio context; it does not establish completed Java migration, deployment topology, live interface contracts or delivery dates for those programmes.

## Implications for this demonstration

The nine-page [launch-video storyboard](launch-storyboard.md), also supplied on 2 November, adds voiceover and visual evidence: familiar scheme journeys, BMW Density design, continuity of orders/appointments/login, and company-owned devices connected to the corporate network. Its closing promise of future innovation supports the proposed demo's positioning. These are storyboard statements; final-video content, migration success and actual access arrangements were not verified. Its video-production notes do not change application scope or the agreed visual direction.

Use the current GCSP UI/mainframe baseline when describing today's platform. Present Java modernisation as the subsequent stage, and the proposed employee experience as a demonstration of what could be enabled across those stages. Keep actual API availability, batch delays and event freshness open until supported by system evidence; SAN-004 and SAN-015 in the [Sandeep questions](questions-for-sandeep.md) remain relevant.

The [demo brief](demo-brief.md)'s replaceable-adapter and functioning-demo boundaries still apply. This clarification adds context and corrects an assumption; it creates no additional authorised capability or Jira scope.
