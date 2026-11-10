# Account and Preferences frozen design reference

Reference ID: **account-preferences-2026-11-10-final**, 10 November 2026. This is the visual and interaction baseline for Epic FUCQ-358. It incorporates Russell's final request for a more prominent Buddy status, immediate rating-tooltip dismissal and clearing a rating by selecting its current star again. Future Stories remain discussion only until a collaborator authorises implementation.

The immutable commit linked from each Jira Story pins this document, the interactive source, its imported kit/assets and all screenshots. [design-reference.json](design-reference.json) records SHA-256 identities, browser settings and every capture's exact viewport, fixture query and observed state. [review.mjs](review.mjs) is the deterministic replay recipe. Do not silently replace these reference images or redefine the baseline during implementation.

## Primary captures

| Capture | CSS viewport | Reference state |
| --- | --- | --- |
| [Desktop Account](review/1440-selected.png) | 1440 × 1100 | Three considered categories, five stars, Buddy engaged |
| [Wide Account](review/1920-selected.png) | 1920 × 1000 | Three considered categories, four stars, Buddy disengaged |
| [Intermediate Account](review/820-selected.png) | 820 × 1000 | Three considered categories, four stars, Buddy disengaged |
| [Narrow Account](review/375-engaged.png) | 375 × 1000 | Three considered categories, four stars, Buddy engaged |
| [Initial categories](review/1440-initial.png) | 1440 × 1100 | No category chosen; rating four after keyboard trial |
| [Under-minimum validation](review/1440-validation.png) | 1440 × 1100 | No category chosen; Engage validation |
| [Three-stop midpoint](review/1440-slider-default.png) | 1440 × 1100 | Comfort open at A bit of both |
| [High importance](review/1440-importance-high.png) | 1440 × 1100 | Body chosen/high, amber category/options/switch |
| [Removal confirmation](review/320-remove-confirmation.png) | 320 × 1000 | Long current-car name, named Comfort removal |
| [Same again](review/320-same-again-neutral.png) | 320 × 1000 | Saved categories neutral/disabled, score 11 |
| [Rating help](review/320-rating-tooltip-long.png) | 320 × 1000 | Long model/specification, help open before activation |
| [Same again help](review/320-same-tooltip-long.png) | 320 × 1000 | Exact guidance with long model/specification |
| [Missing image](review/1440-missing-image.png) | 1440 × 1100 | Identifiable car and readable image fallback |

All **31 captures**, including 1100, 1024, 900px and medium/unselected/long-label states, are indexed in the manifest. PNGs are full-page images; their height may exceed the viewport height. Every capture starts at scroll (0, 0), uses device scale 1, en-GB, reduced motion and the existing GCSP BMW theme/fonts. Browser version at capture: **157.0.8103.51**. The exact saved/painted state and visible tooltip IDs are in each manifest entry; a query name alone does not describe edits made later in the replay.

## Strict comparison acceptance

For every Story affecting this surface, reproduce its relevant named states with the same fixture, theme, fonts, viewport width **and height**, device scale and scroll position. Wait for fonts and vehicle media. Capture the actual integrated application, then retain paired reference/implementation images and a side-by-side or overlay comparison. A real service fixture may supply deterministic data; a decorative replacement for a missing integration does not satisfy acceptance.

There must be **no unapproved difference in composition, image sizing/containment, alignment, spacing, typography, control size/placement, labels, selection/importance colours, status prominence or responsive behaviour**. Do not accept a broad pixel-difference threshold that conceals design drift. Browser font antialiasing is the only incidental rendering allowance; it cannot excuse changed geometry or colours. Use the recorded browser/environment where possible and explain any rendering-only variance. A collaborator must explicitly approve a deliberate design change and its new versioned reference before acceptance; an implementer or reviewer cannot silently update this baseline.

An independent reviewer must substantively inspect desktop, intermediate and narrow renders, including realistic long content and relevant empty, selected, validation, disabled, confirmation and tooltip states. Judge proportions, space, hierarchy, record identification, selection effort, readable controls, action placement and feedback. Fix actionable findings and inspect the corrected result. Passing DOM assertions, a clean detector, screenshot existence or viewport-fit checks alone do not meet this AC. New loading/error states absent from this reference must follow the shared kit and receive explicit visual review without altering the frozen normal states.

## Interaction and contract anchors

- Buddy text is **23px** using the existing title token; its static red/green lamp is **18px**, with text conveying state independently of colour.
- Stars are **24px** inside **44px** targets, transparent at the actual bitmap's right/bottom edge with **8px** inset. Rating is 1–5 or unset. Activation dismisses help immediately; activating the selected star clears it, including Space. Arrow navigation, visible focus and autosave remain usable.
- Rating help: “How highly do you rate your {model and specification}?” Same-again help: “Select this option if you just love everything about your current car, and your next best car would be another {model and specification}”. Both use the heading's supplied vehicle description.
- Category selection is medium/blue unless **This is really important** is on, when it is high/amber. Unchosen is unimportant. Same again removes selection colour and disables controls while retaining choices/importance for restoration. Opening an unset three-stop slider selects/saves its middle **A bit of both**; unopened categories do not count.
- Preferences autosave; confirmed bin removal saves deletion. The main action is **Engage Buddy / Disengage Buddy**. Three considered categories or Same again gates engagement; editing alone never engages. Minimum-loss disengagement remains an explicit revisable design assumption for Story discussion.
- Points cost appears once in current-car facts as current cost / budget. No header allowance lines, representative-image label or Account recommendation cards are present. Recommendations belong in Offer.

The production model does **not** currently accommodate a star rating and needs an explicit compatible extension. No suitable genuine model-confidence score exists. The displayed understanding values are an illustrative completeness mapping (0–6 categories → 1, 3, 4, 6, 7, 9, 10; Same again → 11), not calibrated confidence. Multi-choice Body/Fuel and sparse consideration also require production contract changes. The prototype persists only locally and starts no real Buddy search.

Verification: **179 passing scoped browser checks**, 31 screenshots, no page errors; both JavaScript syntax checks and the changed-target Impeccable detector pass. Parent and independent Road Runner review passed. [visual-review.md](review/visual-review.md) records the substantive review, earlier corrections and resource limits. Production UI ratchet evidence is reused only for unchanged production UI source/test/config identities; no production implementation was built in this task.
