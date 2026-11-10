# FUCQ-358 — Account and Preferences story review mirror

Published 10 November 2026 under **Improve Account and simplify Preferences**. Jira is the authoritative backlog; this file is a review mirror of the six native User Stories. All six were read back as **To Do, unassigned and unestimated**, with their complete descriptions, frozen reference, strict visual acceptance and explicit discussion holds intact. No implementation or pickup is authorised. `AP-01`–`AP-06` remain stable authoring markers mapped to the verified Jira keys below. Priority is Medium throughout.

| Authoring marker | Native Story |
| --- | --- |
| AP-01 | [FUCQ-359 — Give Account a wider current-car presentation](https://ibm-consulting.atlassian.net/browse/FUCQ-359) |
| AP-02 | [FUCQ-367 — Save a current-car star rating from Account](https://ibm-consulting.atlassian.net/browse/FUCQ-367) |
| AP-03 | [FUCQ-368 — Edit and autosave compact category preferences](https://ibm-consulting.atlassian.net/browse/FUCQ-368) |
| AP-04 | [FUCQ-369 — Choose Same again and show Buddy understanding](https://ibm-consulting.atlassian.net/browse/FUCQ-369) |
| AP-05 | [FUCQ-370 — Engage Buddy explicitly from Account](https://ibm-consulting.atlassian.net/browse/FUCQ-370) |
| AP-06 | [FUCQ-371 — Use current-car feedback in suitable recommendations](https://ibm-consulting.atlassian.net/browse/FUCQ-371) |

## Reference and delivery contract

The immutable reference is commit `193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5`: [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md), [manifest](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/design-reference.json), [desktop screenshot](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/review/1440-selected.png), [narrow screenshot](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/review/375-engaged.png). Its33 captures record exact width **and height**, browser/theme/fonts, fixture query, observed saved selections, open panel/tooltip/confirmation/drawer and scroll position. Use the recorded state and replay recipe; query names alone are insufficient. Preserve all relevant empty, selected, engaged, importance, Same again, tooltip, removal, long/missing-car and GC history/details/drawer states. The earlier bd27555a freeze is historical, superseded by this revision for the GC integration. Additional service-error states must receive explicit visual review without changing frozen normal states.

All Stories follow `docs/gcsp/{README.md,demo-brief.md,build-rules.md,experience-quality.md}`, the binding adapter/authority boundaries, and `COMPONENTS.md`. Reuse or extend the shared kit; new consumed primitives belong in the kit with catalogue, gallery and focused tests. Keep page styles to composition, use shared Density/semantic tokens, cover new surfaces in the UI ratchet and never raise existing debt caps. Keep the CSP-safe ES-module/custom-element approach: no inline script bodies, inline handlers, `eval`, `new Function` or string timers. Preserve concise copy, keyboard operation, visible focus, target sizes, contrast, reduced motion, native control identity and one useful status announcement per outcome. No screen or email gains a demo/synthetic-data disclaimer.

These are future application changes through real services/repositories and replaceable adapters. The mockup's private localStorage is design evidence, not the proposed persistence implementation. Preserve existing current-car facts, manual choice, account/history/order access, confirmed essentials, eligibility, affordability, source assurance, tenant/employee/run isolation, active-offer terms and final employee choice. Account does not show recommendations; Offer owns their presentation. Preference/rating changes alone never grant search, hold or order authority.

**Binding Account integration direction, 10 November 2026:** preserve our agreed Your cars composition, large whole-car image, rating, facts/countdown and single **Points cost** cost/budget row. The only part imported from GC’s merged **Your cars** design is its **Choose a replacement** / order-a-replacement control and existing permitted-action behavior. Do not import GC’s other car/hero/fact rearrangements or its separate key-figure strip. Retain his other Account components **below Your preferences in both DOM and visual/reading order**: Order history using shared `dataTable`, full-record access using shared `sideDrawer`, and Your details summary rows, plus any other retained GC secondary Account component. Record-opening controls belong in that lower region; opening their modal drawer may overlay the page. This supersedes the mockup’s earlier secondary-details disclosures without changing the agreed Your cars design.

- [ ] **SHARED VISUAL INTEGRATION AC (all six Stories):** exact [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md) comparison must show Your cars → Your preferences → GC’s retained secondary Account components in DOM, visual and keyboard reading order. Preserve the agreed car/image/rating/Points cost layout, import only GC’s replacement control into Your cars, retain his shared history table/full-record drawer/Your details rows below Preferences, and show no duplicated car key-figure strip. Independently critique the full rendered integration at the exact desktop/narrow fixtures, including record identity, drawer focus/close/return, replacement availability and empty/long history/details. Correct findings and re-inspect; no other GC car rearrangement or unapproved drift passes.

During future build, select tests from actual changed paths and affected callers before running; inspect the configured affected-test plan and use explicit boundary checks when JavaScript coverage is unknown. Retain the compact file/function-to-test map under `.claude/test-runs/impact/`. Use one test/browser worker, run-owned absolute scratch and an external ownership manifest/finalizer; plan chunks under ten minutes and 2GiB scratch, reusing unchanged evidence. Record real failures, skips and unrun gates. Follow `AGENTS.md` for large-output placement and verified cleanup. The commands below are scoped starting selections, not claims they were run during authoring and not permission to silently run the full suite.

## Slicing and actual readiness

| Review label | Bounded capability | Actual contract boundary to resolve during build |
| --- | --- | --- |
| AP-01 | Account composition and current-car presentation | Existing `mountAccount`, `toAccountView`, typed monthly terms, GC’s replacement action, shared history `dataTable`, record `sideDrawer` and Your details rows are available. Preserve the agreed Your cars layout and compose the retained secondary components below Preferences. |
| AP-02 | Current-car star rating, control and durable readback | Strict current-car feedback validators accept only preserve/change/state/source today. A real optional rating contract and matching current-car identity are required. |
| AP-03 | Compact category editing, importance and autosave | Body/Fuel are scalar enum values today; editor defaults populate all six categories. Multi-choice, sparse consideration and persisted importance need explicit compatible contract changes. |
| AP-04 | Same again override and honest understanding display | Same-again intent and retained overridden choices need durable representation; no suitable calibrated confidence is available. |
| AP-05 | Deliberate Buddy engagement and Account status | Existing draft/confirm and pause/resume services exist; autosave must be separated from confirmation/consent and the three-category/Same-again gate enforced by the server. |
| AP-06 | Feedback-aware recommendations and connected walkthrough | Consume the saved rating, mode and current-car snapshot contracts; current read-only recommendation input does not accept feedback. Preserve the existing suitability gates and stored-subject authority boundary. |

Jira links describe sequencing context; they are not automatic pickup gates. After the discussion hold is lifted, record concrete interface/code readiness and conflicting file ownership before pickup. AP-01 can be developed against existing Account contracts; AP-02/AP-03 can establish their bounded contracts independently. AP-04/AP-05/AP-06 may use agreed interfaces for independent work, but their acceptance still requires the real producer/consumer integrations. Coordinate ownership of Account and Brief files rather than running overlapping edits blindly.

## AP-01 — Give Account a wider current-car presentation

```yaml
kind: ui
design_impact: yes
epic: FUCQ-358
priority: P3
priority_reason: default
size: M
depends_on: none
paused: 2026-11-10, by Russell Gowers: Discuss only; do not pick up or build until a collaborator authorises implementation.
```

**User Story / goal:** As an employee, I want my Account page to make good use of the screen and show my whole current car clearly, so that I can recognise my starting point and see the relevant scheme facts at a glance.

**decided**

- **Binding discussion hold, Russell Gowers, 10 November 2026:** discuss only; do not pick up or build until a collaborator explicitly authorises implementation. Keep this Story To Do, unassigned and unestimated. This instruction applies even if an importer omits the `paused` metadata.
- Follow the reference/delivery contract above, `docs/gcsp/experience-quality.md`, `COMPONENTS.md` and [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md). The Account canvas is centred, uses available space above 800px and is capped at 1680px. This is an Account composition exception to the current uncentred 1120px representative body, not a global shell redesign.
- Reuse `mountEmployee`/`portalShell`, `screenIntro`, `mediaWell`, `factList`, `formatTerm`, `button`, GC’s shared `dataTable`/`sideDrawer`, Your details summary rows and tokens. Extend shared media/term presentation where needed; do not override kit internals in Account CSS. Preserve the merged history/record/details component behavior rather than replacing it with the old mockup disclosures.
- GC’s merged Account is a source for the replacement control and lower secondary components only. Within Your cars, import only **Choose a replacement** / order-a-replacement behavior. Keep our agreed car, image, rating, countdown/facts and Points cost arrangement; exclude GC’s other car rearrangements and separate key-figure strip. Order history, record-opening controls, Your details and every other retained GC secondary Account component follow Your preferences in DOM and visual/reading order.
- Preserve the current-car facts and secondary records. Remove the representative-image caption on this Account hero and both header allowance lines. Show **Points cost** as current cost / budget, with monthly points units, once in the current-car facts. Do not change representative-image policy on Offer or other surfaces.

**acceptance**

- [ ] Account follows the frozen centred/max-width composition at wide sizes and the frozen stacking rules at narrow sizes. The current vehicle's entire bitmap/silhouette remains visible at its intrinsic ratio; tall facts and intermediate widths do not crop/stretch it or place an overlay in letterbox space. Missing/broken media retains a readable fallback and record identity.
- [ ] The model/specification, existing supplied facts, countdown and secondary Account functions remain available without substantial fact rearrangement beyond the reference. Points cost uses authoritative terms/budget, e.g. `1,100 / 1,300 points per month` for the reference fixture; neither amount is hardcoded or derived from an unrelated scheme. Missing amounts are truthful. No duplicate header allowance or standalone cost line remains.
- [ ] Within Your cars, the only imported change from GC’s merged car design is **Choose a replacement** / order-a-replacement, using the existing server-supplied action, availability, pending/disabled reason and route behavior. It does not create an order or bypass the manual journey. The agreed image/rating/facts/countdown/Points cost composition remains intact; GC’s separate three-cell key-figure strip and other car/hero rearrangements are absent, so current cost/budget is not duplicated.
- [ ] GC’s **Order history** remains the shared `dataTable` with actual cross-scheme rows, empty states and named **View record** actions; full records still use shared `sideDrawer` with the existing supplied sections, Print, dismissal/focus containment and return to the exact opener. **Your details** retains GC’s Employee/Drivers summary rows and help actions. These components, their record-opening controls and all other retained GC secondary Account components occur below **Your preferences** in both DOM and visual/reading order at every width; CSS visual reordering alone does not pass.
- [ ] The Preferences navigation card and “Cars which suit your preferences” region are removed from Account. The Account composition hosts the real compact Preferences capability at the frozen position; its behavior is AP-03/AP-04/AP-05, and final integrated evidence must use that capability rather than a decorative placeholder. Existing navigation still reaches a working preference editor, with one saved source of truth.
- [ ] Existing manual replacement, offer/order/history/contact routes and multi-car identity remain usable. Data loading, no-current-car, partial/missing facts and account failure/retry stay truthful and usable; this layout does not select a different car or fabricate facts.
- [ ] **STRICT VISUAL COMPARISON:** compare the rendered Account composition against [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md) at its exact viewports, fixtures and relevant empty/selected/long/missing-car/replacement/history/details/open-record states. Explicitly verify that GC’s other car rearrangements and duplicate key-figure strip were not imported, and that history/record/details follow Preferences in both DOM and visual/reading order. Retain paired screenshots and an independent substantive rendered visual/usability critique of proportions, space, hierarchy, car identification, readable controls, action placement and feedback. Implement actionable findings and inspect corrected captures. No unapproved layout, controls, copy or colour drift is accepted; a DOM/viewport-fit check alone does not pass.
- [ ] Shared-kit/catalogue/gallery/ratchet, CSP, accessibility and responsive requirements in the reference/delivery contract pass for the changed surface; Account width styling does not alter adjacent employee, Greg or retail screens.

**files_or_areas**

`blocks/gcsp/account/{gcsp-account.js,account-view.js,gcsp-account.css,http-adapter.js}`, `blocks/gcsp/employee/`, shared media/term helpers, `blocks/gcsp/kit/{data-table.js,side-drawer.js}` and kit styles as justified, `COMPONENTS.md`, `components.html`, `server/test/ui-ratchet.json`, Account render/runtime tests. Inspect live Account host and presenter refresh integration.

**out_of_scope**

New Account data fields or history semantics, GC’s other Your cars/image/hero/fact rearrangements, any duplicate car key-figure strip, placing retained secondary Account components before Preferences, global shell/rail redesign, recommendation cards, changing Offer imagery/captions, new manual or order workflows. Reuse GC’s existing history table, record drawer and details rows below Preferences; rating, preference behavior and Buddy consent belong to AP-02–AP-05.

**validate**

- Starting scoped commands: `node --test --test-concurrency=1 server/test/gcsp-account-render.test.js server/test/gcsp-account-runtime.test.js server/test/gcsp-shell-inset.test.js server/test/gcsp-shell-navigation.test.js server/test/ui-ratchet.test.js`.
- Exercise the real Account HTTP adapter, replacement entry and quiet refresh: action permission/disabled state, terms/current-car identity and existing manual-journey handoff remain correct, with no order created by entry; focus/scroll survive refresh. Inspect actual DOM, visual and keyboard order for history/details after Preferences, long/empty history rows, current/historic record identity, drawer close/Escape/Print/focus return, help actions and absence of duplicated key figures. Run the strict reference comparison and keyboard walkthrough at exact frozen widths/heights, including 820/900/1024/1100px image boundaries, long model/specification and no image. Capture a bounded neighbouring-screen check for shared kit/style changes. Retain the comparison, independent critique, corrected evidence and any unrun scope.

## AP-02 — Save a current-car star rating from Account

```yaml
kind: code
design_impact: yes
epic: FUCQ-358
priority: P3
priority_reason: default
size: M
depends_on: none
paused: 2026-11-10, by Russell Gowers: Discuss only; do not pick up or build until a collaborator authorises implementation.
```

**User Story / goal:** As an employee, I want to rate or clear my rating of my current car directly on its image, so that Buddy can remember how I feel about that specific car.

**decided**

- **Binding discussion hold, Russell Gowers, 10 November 2026:** discuss only; do not pick up or build until a collaborator explicitly authorises implementation. Keep this Story To Do, unassigned and unestimated. This instruction applies even if an importer omits the `paused` metadata.
- Follow `docs/gcsp/experience-quality.md`, `COMPONENTS.md`, the reference/delivery contract and [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md). Reuse the shared media, icon, status and button helpers. Add an accessible shared rating primitive because the kit has no suitable rating control; share the tooltip behavior with AP-04 rather than duplicating it in views.
- The existing preserve/change feedback is not a star rating. Extend the actual versioned input/storage/readback contracts, strict validators and semantic equality/digests end to end. Preserve compatible existing records and preserve/change meaning. Bind rating to the server-recognised current car/configuration/contract; a future replacement must not inherit another car's rating accidentally.
- A rating is an integer 1–5 or explicitly unset. It is independent of category count, importance, Same again and permission to act. AP-06 owns its recommendation effect.

**acceptance**

- [ ] Five compact stars sit transparently at the right of the **actual bitmap**, within the frozen inset at every width, without a separate visible rating card/caption. The frozen 24px stars retain accessible 44px targets. The whole vehicle remains visible and the fallback remains readable.
- [ ] Selecting a star immediately autosaves that value. Activating the currently selected star again clears the rating and autosaves unset; it does not remain stuck because native radio `change` did not fire. The help tooltip dismisses immediately after either selection or clearing while focus stays useful. Mouse, touch and keyboard users can select every value and clear the current value with equivalent operation.
- [ ] The exact tooltip is `How highly do you rate your {model and specification}?`, interpolated from the same supplied description shown in the heading. Hover/focus and assistive descriptions expose the guidance; pointer/touch/keyboard activation immediately dismisses it rather than leaving a sticky tooltip. It remains hoverable before activation, dismisses with Escape/outside interaction, and wraps within the 320px viewport for a long description. The group/value/state has a useful accessible name and visible focus.
- [ ] The real authenticated persistence/readback path retains a saved rating or cleared state through page reload/browser restart. Requests validate type/range/current-car context and reject unknown/authority fields. Legacy feedback without a rating remains valid; malformed or stale responses do not become a successful save.
- [ ] Saving/pending, failure/retry and stale-version behavior is truthful. A failed request retains the user's attempted value for retry without claiming it was saved; authoritative reload shows the last saved value. Rapid edits/clear plus late responses cannot overwrite a newer choice. Rating writes cannot alter Buddy consent, pause state, category count or active offers.
- [ ] **STRICT VISUAL COMPARISON:** compare the rendered Account/rating surface against [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md) at its exact viewports, fixtures and relevant unrated/rated/cleared/help/long/missing-image states. Retain paired screenshots and an independent substantive rendered critique covering image containment, compact proportions, target/readout clarity, record identity, focus and feedback. Implement findings and inspect corrected captures. No unapproved layout, controls, copy or colour drift passes; DOM assertions alone are insufficient.
- [ ] Shared-kit/catalogue/gallery/ratchet, CSP and accessibility requirements pass, including real keyboard clearing and no duplicate status announcements.

**files_or_areas**

`blocks/gcsp/account/`, `blocks/gcsp/kit/`, `blocks/gcsp/brief/{brief-controller.js,brief-transport.js,brief-view-model.js}`, `server/gcsp/brief/{index.js,editor.js,http.js}`, recommendation/projection validators that consume the extended feedback, repository serialization and current-car fact adapters, `docs/gcsp/shared-contracts.md`, `COMPONENTS.md`, gallery and focused tests.

**out_of_scope**

Recommendation policy/ranking, after-use satisfaction modelling, rating other employees' cars, new rating-history UI, broader feedback controls, search/reservation/order authority. Do not encode a rating by abusing preserve/change arrays or image evidence confidence.

**validate**

- Starting scoped commands: `node --test --test-concurrency=1 server/test/gcsp-brief.test.js server/test/gcsp-brief-editor.test.js server/test/gcsp-brief-controller.test.js server/test/gcsp-brief-transport.test.js server/test/gcsp-account-render.test.js server/test/ui-ratchet.test.js`; add focused rating/tooltip contract and control cases to the appropriate existing suites.
- Through the real HTTP/repository path: set 1 and 5, replace, clear by activating the same star, reopen, reject out-of-range/wrong-car writes, simulate failure/retry and an edit racing an older response. Inspect persisted values rather than only the painted stars. Run the strict frozen browser/keyboard comparison and independent critique. Reuse AP-03 autosave evidence only for identical shared code and inputs.

## AP-03 — Edit and autosave compact category preferences

```yaml
kind: ui
design_impact: yes
epic: FUCQ-358
priority: P3
priority_reason: default
size: L
depends_on: none
paused: 2026-11-10, by Russell Gowers: Discuss only; do not pick up or build until a collaborator authorises implementation.
```

**User Story / goal:** As an employee, I want to consider a few clear categories and mark what really matters, so that I can express my next-car preferences in a compact Account panel without completing a long form or pressing Save.

**decided**

- **Binding discussion hold, Russell Gowers, 10 November 2026:** discuss only; do not pick up or build until a collaborator explicitly authorises implementation. Keep this Story To Do, unassigned and unestimated. This instruction applies even if an importer omits the `paused` metadata.
- Follow `docs/gcsp/experience-quality.md`, `COMPONENTS.md`, the reference/delivery contract and [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md). Reuse controlled `renderOptionList`, `renderRangeSlider`, `checkboxField`, shared disclosures/buttons/icons/status; extend shared controls/kit for the switch and selected-category presentation as needed.
- Six categories: Body, Fuel, Sportiness, Comfort, Economy, Size. Body/Fuel allow multiple supported choices. Four qualitative sliders use 0/50/100 with middle label **A bit of both**; values/labels/importance mappings come from the canonical server policy projection, not parallel client defaults.
- Extend the current scalar Body/Fuel enums to support the agreed multiple choices through validation, persistence, projection and scoring. Preserve existing scalar saved choices with an explicit compatible read/migration rule. Preserve sparse/unset intent: current policy-populated unconfirmed defaults must not falsely count as employee-considered categories. Genuine existing employee-confirmed values remain considered.
- Use stable versioned assumptions through `PolicyService`: proposed `brief.accountPreferences.v1` owns category/three-stop definitions, considered semantics and medium/high mappings (plausible 50/100 on the existing importance scale). An absent value is unimportant, not an invisible midpoint selection. Do not scatter active defaults or new arbitrary weights.

**acceptance**

- [ ] Account embeds the category-first Preferences component around the frozen rough footprint of Your cars. It initially shows compact category controls; opening one reveals only its relevant options and the single importance switch. Selected/considered categories and their human-readable selected choices are identifiable without opening each one. `Done` only closes the open panel.
- [ ] Body and Fuel support the frozen multiple-choice options. Opening them without choosing saves/counts nothing. Sportiness, Comfort, Economy and Size have exactly three slider stops; opening an unset slider immediately selects **A bit of both**, autosaves it and counts that category. Unopened sliders remain unset and do not count merely because a DOM thumb has a midpoint.
- [ ] Every preference edit autosaves through the real authenticated versioned service, including incomplete sets of zero, one or two categories. Saved choices survive reload/browser restart and both existing preference navigation and Account read the same record. Rapid changes are ordered/coalesced without losing the latest selection; a quiet Account refresh does not reset focused controls or an open panel.
- [ ] Each open category has one visible **This is really important** switch, with no numeric weight or importance twisty. Unchosen means no saved weight and a disabled, unchecked switch with **Choose a preference first.** Chosen/off means medium with the frozen blue treatment; chosen/on means high with the shared amber urgent treatment on the category, selected options/slider and switch. A changed importance does not count another category. Accessible names/state convey selection and importance without colour alone.
- [ ] Clearing the last Body/Fuel choice clears its consideration and importance. A bin action names the category and asks for confirmation; **Keep it** preserves value/importance and useful focus, **Remove preference** autosaves removal and clears both. Choosing again starts at medium. Cancelling, reloading and editing another category preserve saved high importance.
- [ ] Pending, failed, retryable, stale/conflicting and access/run-reset responses have truthful feedback. Only confirmed persistence says saved; failures preserve retryable edits and do not engage Buddy. Server validation rejects unknown categories/options, invalid slider stops, orphan importance and injected identity/authority fields. Relevant existing essentials and unavailable data are preserved, not silently cleared by the simplified editor.
- [ ] **STRICT VISUAL COMPARISON:** compare the rendered Account/Preferences surface against [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md) at its exact viewports, fixtures and relevant empty/open/selected/medium/high/removal/cancel/long-label states. Retain paired screenshots and an independent substantive rendered critique of footprint, hierarchy, selection effort, readable options, focus, action placement and feedback. Implement findings and inspect corrected captures. No unapproved layout, controls, copy or colour drift passes; fit checks or screenshots without critique are insufficient.
- [ ] Shared-kit/catalogue/gallery/ratchet, CSP, accessibility and responsive requirements pass. Sliders expose qualitative values to assistive technology and work with keyboard arrows; selection, switch label/Space activation, confirmation/cancel and focus return work at 320px as well as desktop.

**files_or_areas**

`blocks/gcsp/{account,brief}/`, shared question/form/kit controls and styles, `server/gcsp/brief/`, `server/scenarios/employee/index.js`, `server/gcsp/recommendation/`, canonical policy provider/seed and relevant policy schema/projections, shared contracts, `COMPONENTS.md`, gallery, scoped Brief/render/runtime tests and ratchet.

**out_of_scope**

Additional categories, free text/LLM input, redesigning practical requirements, recommendation cards on Account, Same-again behavior/understanding (AP-04), deliberate engagement (AP-05), new validation infrastructure or global preference model refactoring unrelated to these contracts.

**validate**

- Starting scoped commands: `node --test --test-concurrency=1 server/test/gcsp-brief-controls.test.js server/test/gcsp-brief-controller.test.js server/test/gcsp-brief-editor.test.js server/test/gcsp-brief.test.js server/test/gcsp-brief-render.test.js server/test/gcsp-brief-transport.test.js server/test/employee-recommendation.test.js server/test/ui-ratchet.test.js`.
- Add regressions for sparse versus policy defaults, old scalar/new multiple-choice readback and fit, all slider stops/open-default persistence, unchosen/medium/high, last-choice clearing, bin confirm/cancel, rapid edits and failed/retried autosave. Demonstrate one canonical mapping change updating server projection/control/scoring consistently, preserving pinned historical versions.
- Reopen the real saved brief through HTTP and inspect the stored values; use exact frozen fixtures for the strict browser/keyboard comparison and independent critique. Keep real runtime integration evidence distinct from generated presentation fixtures.

## AP-04 — Choose Same again and show Buddy understanding

```yaml
kind: code
design_impact: yes
epic: FUCQ-358
priority: P3
priority_reason: default
size: M
depends_on: none
paused: 2026-11-10, by Russell Gowers: Discuss only; do not pick up or build until a collaborator authorises implementation.
```

**User Story / goal:** As an employee, I want to ask for another car like my current one and see how much preference input Buddy has, so that I can express continuity without losing the preferences I previously considered.

**decided**

- **Binding discussion hold, Russell Gowers, 10 November 2026:** discuss only; do not pick up or build until a collaborator explicitly authorises implementation. Keep this Story To Do, unassigned and unestimated. This instruction applies even if an importer omits the `paused` metadata.
- Follow `docs/gcsp/experience-quality.md`, `COMPONENTS.md`, the reference/delivery contract and [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md). Reuse/extend the shared switch, tooltip and compact category components; use a shared score presentation if no suitable existing primitive fits.
- No suitable calibrated model-confidence measure exists in the current brief/recommendation contracts. **Buddy understanding** is a transparent input-completeness indicator, never a probability, confidence estimate or fit/eligibility score. Canonical assumed `brief.accountPreferences.v1` owns the mapping: 0–6 considered categories → **1, 3, 4, 6, 7, 9, 10**; Same again → **11**. Importance and rating cannot inflate it.
- Same again is persisted explicit next-car intent. Its category override retains the original saved choices and importance unchanged; it does not copy inferred current-car facts into employee-confirmed categories. AP-06 defines the resulting recommendation policy.

**acceptance**

- [ ] **Same again, please!** autosaves on/off through the real brief contract. When on, category opening, changes, removal and importance are disabled; any open options/removal panel closes. Saved category summaries stay available in the frozen neutral treatment with no blue/amber selection emphasis. Turning it off restores the original choices, category count and medium/high presentation. Rating is retained unchanged in both modes.
- [ ] An information control beside the label replaces persistent guidance. Its tooltip text is exactly `Select this option if you just love everything about your current car, and your next best car would be another {model and specification}` using the heading's supplied car description. Hover/focus/touch, hoverable content, Escape/outside dismissal, useful retained focus and long text at 320px are supported by the same shared tooltip behavior as rating.
- [ ] The prominent **Buddy understanding** display shows the exact canonical mapping above, capped at 10 for categories and 11 only for Same again. It updates from actual considered/saved intent, survives reload and does not count unopened/default-only categories or importance/rating changes. Any unsaved state is identified honestly rather than claiming persisted understanding.
- [ ] The indicator's product text, accessible name and data contract never mislabel completeness as calibrated confidence. Vehicle-source assurance or candidate fit is not substituted. Changing the mapping in one canonical policy entry updates every affected consumer coherently and retains its version/provenance in evidence.
- [ ] No-current-car or insufficient identified-current-car data cannot create a fabricated Same-again target; the UI gives a concise unavailable reason while normal category editing remains possible. Failure/retry, stale versions and reload retain the last authoritative mode/choices without falsely claiming success. Same again alone does not engage Buddy or grant search/hold authority.
- [ ] **STRICT VISUAL COMPARISON:** compare rendered Account/Preferences against [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md) at its exact viewports, fixtures and relevant category-count/Same-again/help/neutralised/restored/long-car states. Retain paired screenshots and an independent substantive rendered critique of score hierarchy, neutral override, disabled control clarity, target/readability and feedback. Implement findings and inspect corrected captures. No unapproved layout, controls, copy or colour drift passes; numerical/DOM assertions alone are insufficient.
- [ ] Shared-kit/catalogue/gallery/ratchet, CSP, accessibility and responsive requirements pass, including keyboard switch operation, tooltip dismissal and descriptive disabled states.

**files_or_areas**

`blocks/gcsp/{account,brief,kit}/`, `server/gcsp/brief/{index.js,editor.js,http.js}`, strict model/serialization/projection consumers, current-car adapter facts, canonical policy source/provider, shared contracts, `COMPONENTS.md`, gallery, Brief/controller/render/policy tests and ratchet.

**out_of_scope**

Training/calibrating a confidence model, claiming genuine confidence, recommendation policy implementation (AP-06), changing essentials/eligibility, automatically engaging Buddy, losing retained choices when changing modes.

**validate**

- Starting scoped commands: `node --test --test-concurrency=1 server/test/gcsp-brief.test.js server/test/gcsp-brief-editor.test.js server/test/gcsp-brief-controller.test.js server/test/gcsp-brief-render.test.js server/test/gcsp-policy-service.test.js server/test/ui-ratchet.test.js`.
- Verify counts 0–6, no score change from rating/importance, on/off/reload with high-importance choices retained, failed mode save/retry and missing-current-car behavior through the actual service. Demonstrate a one-place mapping change through `PolicyService`. Run the strict frozen comparison and independent critique, including 320px long tooltip, neutralisation and restoration.

## AP-05 — Engage Buddy explicitly from Account

```yaml
kind: code
design_impact: yes
epic: FUCQ-358
priority: P3
priority_reason: default
size: M
depends_on: none
paused: 2026-11-10, by Russell Gowers: Discuss only; do not pick up or build until a collaborator authorises implementation.
```

**User Story / goal:** As an employee, I want a clear Engage/Disengage action and visible Buddy status, so that I control when my saved preferences authorise Buddy to work for me.

**decided**

- **Binding discussion hold, Russell Gowers, 10 November 2026:** discuss only; do not pick up or build until a collaborator explicitly authorises implementation. Keep this Story To Do, unassigned and unestimated. This instruction applies even if an importer omits the `paused` metadata.
- Follow `docs/gcsp/experience-quality.md`, `COMPONENTS.md`, the reference/delivery contract and [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md). Reuse shared buttons, status/live-region and semantic success/danger tokens; the lamp is static and its accompanying text carries the state.
- Autosave and engagement are different operations. Editing keeps the existing authority state and does not silently engage/resume, create holds or order. **Engage Buddy / Disengage Buddy** replaces Save Preferences. Engagement uses the existing explicit search/temporary-hold authority boundary; the server retains separate consent meanings and final employee order choice.
- At least **three considered categories** or Same again is required to engage; incomplete input still autosaves. Canonical `brief.accountPreferences.v1` owns the minimum and counting rule. **Revisable design assumption for review:** if an engaged Buddy loses the minimum after confirmed removal/clearing or Same again is turned off, stop future search/holds, show Buddy disengaged and explain why. Preserve saved input and existing open offers. This minimum-loss behavior is mockup design semantics, not verified BMW policy.

**acceptance**

- [ ] Account shows a prominent top lamp and **Buddy engaged** / **Buddy disengaged** text, green/red respectively, from authoritative saved state. The button reads **Disengage Buddy** when engaged and **Engage Buddy** when disengaged; no Save Preferences button remains. Pending/unknown/unavailable state never falsely appears engaged or successfully saved.
- [ ] Engaging with fewer than three considered categories and Same again off is rejected by both UI and server with the remaining-category count and useful focus/feedback. Multiple choices in one category still count once; opening an unset slider counts its saved midpoint; opening unchosen Body/Fuel or a policy default does not. Same again bypasses the minimum.
- [ ] An explicit Engage action first establishes the latest saved brief/mode and required consent through the real service, then reports success only after authoritative readback. Pending/failed autosave cannot engage using older choices. Disengage stops new search/hold activity, retains choices/rating and leaves existing offers truthful under the existing offer contract. Neither action places an order.
- [ ] Preference/rating/importance changes and page reload never silently grant consent or resume a paused Buddy. A deliberately engaged Buddy remains engaged through successful valid edits/reload; a deliberate disengagement remains disengaged. Under the recorded minimum-loss assumption, a confirmed edit that loses the gate disengages atomically with the relevant save, explains the consequence, and cannot leave the search producer acting against a now-invalid brief. A failed save does not falsely claim this transition occurred.
- [ ] Timeout/retry, repeated clicks, stale/conflicting versions, access/run reset and concurrent edits cannot create duplicate authority transitions or resurrect an older state. Retry/readback reconciles uncertain outcomes; preserve active-offer terms and the existing activity page's truthful state. The Account lamp/action and Buddy activity agree after reload/quiet refresh.
- [ ] **STRICT VISUAL COMPARISON:** compare rendered Account/Preferences against [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md) at its exact viewports, fixtures and relevant frozen disengaged/engaged/under-minimum/validation/minimum-loss states; additionally inspect pending/error states using the shared kit as required by the reference contract. Retain paired screenshots and an independent substantive rendered critique of top-status prominence, action placement, concise consequences, focus and feedback. Implement findings and inspect corrected captures. No unapproved layout, controls, copy or colour drift passes; status-colour/DOM assertions alone are insufficient.
- [ ] Shared-kit/catalogue/gallery/ratchet, CSP, accessibility and responsive requirements pass; lamps do not blink and state is understandable without colour. The action/status remain usable with keyboard and at 320px.

**files_or_areas**

`blocks/gcsp/{account,brief,activity}/`, `server/gcsp/brief/{index.js,editor.js,http.js,activity.js}`, actual consent/paused stored projections and buddy consumers, policy source/provider, shared contracts, Account/Brief/runtime/Buddy handoff tests, shared status controls and ratchet.

**out_of_scope**

New search/allocation algorithms, changing reservation duration, cancelling/repricing existing offers, automatic orders, new notification channels, redefining final employee consent outside the existing search/hold boundary.

**validate**

- Starting scoped commands: `node --test --test-concurrency=1 server/test/gcsp-brief.test.js server/test/gcsp-brief-controller.test.js server/test/gcsp-brief-runtime.test.js server/test/gcsp-account-runtime.test.js server/test/gcsp-buddy-handoff.test.js server/test/gcsp-buddy-runtime-integration.test.js server/test/ui-ratchet.test.js`.
- Through real authenticated HTTP and repository readback, exercise two/three categories, Same again, explicit engage/disengage, refresh, pending/failing autosave, repeated request/retry, concurrent edit and minimum-loss transition with an open offer. Inspect stored consent/paused state and producer permission, not only the lamp. Run strict frozen browser/keyboard comparison and independent critique.

## AP-06 — Use current-car feedback in suitable recommendations

```yaml
kind: code
design_impact: yes
epic: FUCQ-358
priority: P3
priority_reason: default
size: L
depends_on: none
paused: 2026-11-10, by Russell Gowers: Discuss only; do not pick up or build until a collaborator authorises implementation.
```

**User Story / goal:** As an employee, I want my current-car rating and Same-again choice to affect the cars Buddy recommends, so that positive feedback favours continuity or a measured improvement and negative feedback avoids repeating the same unsuitable choice.

**decided**

- **Binding discussion hold, Russell Gowers, 10 November 2026:** discuss only; do not pick up or build until a collaborator explicitly authorises implementation. Keep this Story To Do, unassigned and unestimated. This instruction applies even if an importer omits the `paused` metadata.
- Follow `docs/gcsp/{demo-brief.md,build-rules.md,experience-quality.md}`, `COMPONENTS.md`, the reference/delivery contract and [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md). Reuse the existing recommendation service, policy port, exact-candidate gates and explanation projection. Extend the supported brief/stored-subject projections intentionally; do not add fields to one permissive caller while strict validators or semantic digests silently discard them.
- Adopt a **plausible, revisable policy**, labelled assumed with basis/provenance in one canonical `PolicyService` entry (proposed `employee.currentCarFeedback.v1`): **4–5 positive**, **1–2 negative**, **3 or unset neutral**. These thresholds are not measured BMW satisfaction rules.
- Proposed similarity definition: compare the server-resolved current-car baseline and candidate's confirmed **model line, body and fuel**; all three equal means similar. Missing required baseline/candidate facts mean unknown, never an assumed match/mismatch. Use structured facts and their provenance/configuration identity, not name-string parsing or representative imagery. Keep the dimensions/thresholds configurable in the canonical entry.
- Proposed positive rule: prefer eligible similar candidates, or a candidate demonstrably **no worse on each confirmed, non-overridden expressed preference and better on at least one**, compared with the current-car baseline using the shared preference utility; do not infer “better” from price, speed, trim or age alone. For positive feedback, recommend **only** a proven-similar candidate or a proven improvement under this rule. If neither can be established, return a truthful no-match/insufficient-evidence result; do not fall back to an unrelated candidate. Negative feedback omits proven-similar candidates from the recommendation shortlist; it does not reclassify scheme eligibility or silently substitute a similar fallback. Neutral feedback adds no rating effect.
- Proposed precedence: **eligibility, affordability, confirmed essentials/charging/timing and existing authority gates first; explicit Same-again continuity intent next; rating next; retained category preferences only when not overridden**. Same again targets the same confirmed current model and specification, including an equivalent catalogue configuration only when the relevant specification is confirmed equal; body/fuel/model-line similarity alone must not erase a material specification difference. It never relaxes essentials, promises exact supply or creates a guarantee; unavailable suitable continuity produces a truthful no-match. While on, it overrides the retained category/rating ranking effects; off restores them. The rating/mode precedence is an explicit revisable design assumption for review.

**acceptance**

- [ ] The real recommendation consumers receive the saved rating, Same-again mode, correct current-car baseline and chosen multi-value preferences through compatible typed contracts. Stored-subject evaluation remains server-owned data, not a client-supplied employee session or authority grant. Old briefs without these fields retain their prior behavior.
- [ ] On the same stock/employee/policy inputs, positive/negative/neutral/unrated changes produce the defined, deterministic shortlist/order behavior; every positive-feedback recommendation is proven similar or better; a negative rating does not recommend a proven-similar car, and a positive or Same-again choice can recommend another current-car-like vehicle when suitable. No exact/similar or improvement claim is made when source facts are insufficient. No eligible result is invented when all candidates fail suitability or the explicit negative-similarity preference.
- [ ] Body/Fuel multiple choices are honoured as alternatives inside that category, with importance independent of choice count. Same again applies its explicit continuity policy while retaining categories/importance/rating for restoration. Tests cover conflicting negative rating plus Same again and demonstrate the recorded precedence, not accidental field omission.
- [ ] The recommendation output records the active/pinned policy, brief, facts and stock identities and grounded reasons/trade-offs for any feedback influence. A one-place canonical policy change alters subsequent recommendations and explanations consistently while historical/pinned offers retain their explanation/terms. No local client weight table or unversioned matching default competes with the policy service.
- [ ] Essential requirements, eligibility, affordability, charging, source uncertainty and availability gates take precedence over high rating, Same again or “better” utility. A loved/similar but ineligible/over-budget/essential-failing car cannot enter the suitable recommendations; unknown evidence remains unknown. Feedback writes/evaluation alone cannot start searching, reserve, allocate or order. Existing offers are not silently cancelled, repriced or reranked in place.
- [ ] Account remains free of recommendation cards. The existing Offer surface consumes the real resulting decision/explanation with the shared presentation and actual state; no per-employee winner override or canned result is used.
- [ ] **STRICT VISUAL COMPARISON:** run the connected Account portion at [frozen reference 193cbf07](https://github.com/garyscarter-ibm/vehicle-matcher/blob/193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5/docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md)'s exact viewports, fixtures and rating/category/Same-again/engagement states, retain paired screenshots and an independent substantive rendered critique, implement findings and inspect corrected captures. No unapproved layout, controls, copy or colour drift from that reference passes. The integrated Account must preserve the agreed car/image/rating/Points cost composition, import only GC’s replacement control into Your cars, exclude his other car rearrangements/duplicate key figures, and place his history table, record-opening controls/drawer and Your details rows below Preferences in DOM and visual/reading order. On Offer, compare the existing agreed Offer reference and a recorded exact candidate/result fixture; only the factually required recommendation/reason content may vary under this Story, with any deliberate presentation/copy change requiring collaborator approval. Backend tests alone do not pass visible acceptance.
- [ ] Supply one bounded, resettable **integrated walkthrough** using the real Account → persisted Brief → engaged Buddy → release/evaluation → Offer path. Show rating selection/clear; three-category edits with medium/high importance; reload; Same again on/off restoring choices; engage/disengage; one contrasting positive/negative result; and one essentials/affordability conflict. Also verify the retained replacement entry, Order history table, full-record drawer and Your details actions without moving them ahead of Preferences or rearranging Your cars. Record setup/reset, exact inputs, expected/observed outcomes, screenshots/critique and known limitations. Extend existing scenario/reset support; do not create a separate validation-framework Story. Fixture input may drive real services, but fixtures alone do not prove a missing live integration.
- [ ] Shared-kit/ratchet, CSP, accessibility and relevant narrow Offer/Account interaction requirements remain satisfied; any new reason content is concise, grounded and readable with long vehicle descriptions.

**files_or_areas**

`server/gcsp/recommendation/index.js`, `server/scenarios/employee/index.js`, `server/gcsp/brief/` projections/semantic digests, current-car fact provider/adapters, `server/gcsp/policy/`, stored-subject/Buddy evaluation callers, existing Offer explanation adapters, `docs/gcsp/shared-contracts.md`, existing reset/scenario support and relevant recommendation/runtime/Offer tests. Extend the shared reason dictionary/presentation only if the resulting evidence introduces a new supported reason.

**out_of_scope**

Learning a satisfaction model, a new ranking engine, calibrated confidence, using rating as identity/consent, relaxing suitability, new holds/order algorithms, after-use population analytics, recommendation cards on Account, retail extraction/refactoring, new test infrastructure, real BMW deployment/integration or real email delivery beyond existing authorized boundaries.

**validate**

- Starting scoped commands: `node --test --test-concurrency=1 server/test/employee-recommendation.test.js server/test/employee-recommendation-api.test.js server/test/gcsp-recommendation-stored-subject.test.js server/test/gcsp-brief-editor.test.js server/test/gcsp-policy-service.test.js server/test/gcsp-policy-versions.test.js server/test/gcsp-buddy-runtime-integration.test.js server/test/recommendation-compat.test.js`. Add focused policy/feedback cases at these existing boundaries; select Offer tests from actual changed explanation/presentation callers.
- Run deterministic comparisons on a small shared candidate set for rating 1–5/unset; identical/different/unknown similarity facts; a measurable improvement versus a merely expensive/faster car; multiple Body/Fuel alternatives; Same-again precedence; required seats/boot/charging and points/eligibility conflicts; stale/legacy/pinned versions. Prove canonical policy replacement affects the real evaluator and preserve retail compatibility.
- Perform the bounded connected walkthrough above against actual services and persisted readback, then the strict Account/Offer browser comparison and independent critique at frozen desktop/narrow sizes. Publish scoped test results, actual integration status, failed/skipped/unrun checks and review evidence; do not infer acceptance or Done from a commit or integration merge.

## Review assumptions and authoring receipt

The remaining **design assumptions for collaborator review** are the minimum-loss automatic disengagement in AP-05; the explicit Same-again/rating precedence; rating thresholds; and similarity/improvement policy in AP-06. They are intentionally plausible and centrally revisable, not assertions of BMW policy or a request to stop future authorized demo work solely for missing policy confirmation. The integrated freeze is immutable commit `193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5`, with 192 scoped browser checks, 33 captures and an independent corrected-result visual review. Future implementation must pass that reference’s strict comparison gate; the earlier bd27555a freeze remains historical. No suitable genuine confidence source has been found; this draft resolves that gap by specifying honest input completeness, not inventing confidence.

Authoring validation: the author reviewed project/build/experience rules, the component catalogue, strict brief/editor/controller/recommendation contracts and GC’s merged Account composition. Parent froze and hash-verified the mockup, then the native authoring runner reused FUCQ-359, created FUCQ-367–371 and read back all six full descriptions. Markdown-only normalisation preserved every required section and AC. Jira’s empty-estimate filter matched all six; the connector omits raw null values from its mapped custom-field output. No production application/model/policy, claim, dispatcher or build was changed by authoring. GC’s separate sync previously imported FUCQ-359; its local copy has an explicit scheduling pause, and the native hold applies to every imported copy even if an importer omits that metadata.

The product map records only verified identities, original native observation times, existing capability associations and future slices marked not started, without worker claims. See `JIRA-AUTHORING-RECEIPT.json` for native verification and `review/visual-review.md` for rendered critique. Run identity: `account-preferences-20261110-01a1c6a0`. Parent owns native-runner teardown and the retained read-only preview.

agents: Baymax — story author/reviewer tier; requested and selected `gpt-6.1-sol` / `high`, no fallback; effective runtime settings not independently verified. Own desktop chat title set and verified as **Baymax**.
