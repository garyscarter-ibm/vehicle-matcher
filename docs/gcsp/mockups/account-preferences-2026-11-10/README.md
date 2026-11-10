# Account and Preferences discussion mockup

Requested by Russell, 10 November 2026. This is an isolated interactive design proposal for discussion before User Stories. No production application, data model, recommendations, active policy, existing Story contract or dispatcher changes are authorised by this artifact. The request authorises the new Epic; native Jira creation is pending because this session exposes no Atlassian connector. This document is discussion context, not an alternative backlog.

## Proposed epic text

**Improve Account and simplify Preferences**

Help an employee express what matters in their next car directly on their Account page, with a wider, more beautiful current-car presentation and a compact, intuitive Preferences component.

Use available desktop space, enlarge the current-car image without substantially changing the current-car facts, and remove the representative-image label. Let the employee rate their current car from one to five stars and use that feedback in recommendations: favour a similar or better car when they love it, and avoid similar recommendations when they dislike it.

Replace the large Preferences navigation card with the Preferences component itself. Remove “Cars which suit your preferences” from this stage; recommendations belong in Offer. Show categories first, reveal a category's options when selected, and make considered categories visibly distinct. Allow removal of a category using a bin control with confirmation. Require selections in at least three categories.

Provide “Same again, please!” to override preferences and disable the category controls. Prominently display a Buddy understanding score from 1–11, increasing with preference input to a maximum of 10; Same again sets it to 11. Use genuine model confidence if a suitable score exists. Keep the component around the footprint of Your cars. Reuse or extend shared components and enforce the UI ratchet. Use Impeccable for the design. Review the embedded Account-page mockup before writing User Stories; do not build the feature yet.

Added by: usget

## Findings and open decisions

- Current layout: `blocks/gcsp/employee/gcsp-employee.css` caps `.gcsp-rep` at 1120px with `margin: 0`. The shell owns the page inset. The proposal overrides the page composition inside the mockup only: a centred canvas up to 1680px and a flexible image column; facts remain around 480px wide.
- Existing `currentCarFeedback` stores only `preserve`, `change`, `state`, `source`. The strict validators in `server/gcsp/brief/index.js`, `server/gcsp/brief/editor.js`, `blocks/gcsp/brief/brief-controller.js` and recommendation input reject an added star rating today. A 1–5 current-car rating therefore needs an explicit contract/model extension. Preserve/change is not a star rating or observed after-use satisfaction.
- No suitable buddy/model confidence score was found in the current recommendation/brief contracts or code. Vehicle-evidence `confidence` describes source assurance; candidate fit is a different concept. The mockup deliberately uses an illustrative input-completeness mapping: no category = 1, one = 3, two = 4, three = 6, four = 7, five = 9, six = 10; Same again = 11. This is not a calibrated confidence estimate. Decide the production basis before authoring its Story.
- Six supported categories are used: body, fuel, sportiness, comfort, economy, size. Prototype qualitative choices for numeric axes illustrate simplification; they are not new active defaults. Independent preference position, importance and indifference remain design/contract questions. This proposal does not silently revise the 1 November requirement for separate importance controls.
- “At least three categories” is interpreted as three categories with an explicit option selected, not merely opened. Same again bypasses that minimum. Untoggling restores the retained choices. Switching modes preserves the rating. Eligibility, affordability, essential needs and permission to search/hold must survive either mode in a future implementation.
- Rating is a signal, not permission to search, reserve or order. Define “similar or better”, the neutral three-star case and how a later essential need takes precedence before implementing matching behaviour.
- Preference and rating interactions save only to this mockup's own localStorage key. They never call production APIs. Reload keeps the local design state. Feedback is discussed in this Codex chat; there is no comment form or inaccessible feedback store.

## Component plan

Reuse the actual `portalShell`, navigation and `svgIcon`, Density tokens/font, `el`, `screenIntro`, `button`, `factList`, `mediaWell`, `renderOptionList` and `checkboxField`. The native existing details pattern keeps secondary account information compact. No recommendation cards are mounted.

Proposed extensions are confined to this mockup: a switch treatment around `checkboxField`, category disclosure/selected/remove composition, a score readout, and a new accessible star-radio control because the kit has none. None has been installed in the production kit. After agreement, the relevant Story must extend/add these in the shared kit with catalogue/gallery coverage, tests and a falling ratchet baseline; the mockup is not an exemption for production duplication.

## Review and resource plan

Run identity: `account-preferences-20261110-01a1c6a0`. Changed paths are only this mockup directory. Affected boundaries: browser module imports of the existing shell and controls, localStorage, image and font assets; no HTTP application services. Regression: shared control reuse and CSP-safe module loading. No application callers consume this proposal.

Selected checks: `node --check` on mockup JavaScript; the existing `server/test/ui-ratchet.test.js` (scoped, no baseline edits); a single headless browser worker at 1920, 1440, 820, 375 and 320px, including empty, chosen, validation, remove-confirmation, Same again, reload, keyboard and long/missing-car states. Source checks cover this docs path because the production ratchet's roots do not. Run Impeccable's detector on the mockup once after rendering. Excluded: full server/retail suites, live matching, offer/order workflows, database writes and real confidence validation because production code is unchanged and no live feature is implemented.

Expected review budget: under 10 minutes per browser chunk, under 128MiB scratch and 800MiB RAM, one browser process. The supervisor uses `_tools/test_resources.py`'s `Scratch` manifest outside its generated absolute root, propagates TMPDIR/TMP/TEMP, closes browser/server processes in `finally`, then removes and verifies scratch. Browser profile is a bounded local compatibility working set; retained outputs are only small screenshots and a concise JSON review summary here. No archives or outputs approaching 256MiB are planned. Capacity currently prevents independent reviewer spawning; recheck before handover, and disclose that gate if it remains unavailable.

## Open the mockup

Serve the repository with its existing static server, then open `docs/gcsp/mockups/account-preferences-2026-11-10/index.html`. Query `?state=selected` opens a three-category example; `?state=same` opens Same again; `?state=long` and `?state=missing` exercise content extremes. The default opens the initial categories-only state; `?state=empty` resets this browser's local mockup state.

The screenshots and review receipt are written after browser inspection. User Stories remain unwritten pending discussion.
