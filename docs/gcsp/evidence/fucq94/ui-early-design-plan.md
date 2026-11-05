# FUCQ-94 brief screen: UI and early design plan

5 November 2026. Accepted representative-body plan for DEV-2026-11-04-052. The supporting backend is frozen at `34154686cce29975e85d4d1cd93fc9ecdbb10970`. The dispatcher retains integration, allocation, review and closure. FUCQ-95's first representative UI is frozen at `ffc87ea`; its shared-kit, gallery and catalogue lane is released to FUCQ-94. The dispatcher authorized one representative brief body and its consumed additive control extension, with at most one implementer after fresh live admission checks. Stop after actual desktop/375px render, inspection and bounded correction for human review, before wider state fan-out. FUCQ-95's human review is pending; neither its unmerged code/tests nor an accepted-design or integrated continuity claim is adopted here.

## Purpose and visual authority

Paula needs to express her next-car preferences, distinguish what matters from what she must have, and understand the resulting cars before deliberately saving a brief or giving the buddy permission. This is an Operate surface: the primary action is **Save this brief**; changing a control produces an explicitly unsaved, read-only preview.

Follow `docs/gcsp/{demo-brief,build-rules,experience-quality}.md`, `docs/gcsp/screens/README.md` and the Gary-approved FUCQ-64 body in `docs/gcsp/evidence/fucq-6/README.md`, source `a7fc178`, approved 5 November. The approved desktop and 320px captures were inspected. Preserve the slim account header, narrow icon navigation, pale page, white surfaces, system type and teal actions. Use image-led exact cars and plain explanations. The new screen needs its own 375px evidence; the reference's 320px result is not evidence for it.

Read-only kit inspection is pinned to shared checkout HEAD `eeb3497a4e85d1e1d59c29d90eb90ecca3317250`. No shared-base merge occurred. These are the inspected SHA-256 identities, not an assertion that the shared checkout cannot advance:

| Source | SHA-256 |
|---|---|
| `COMPONENTS.md` | `700f52c2db239d0046b5fcfa268e198303c94811c44d5a518dfcd221fbb1e8cf` |
| `blocks/vehicle-matcher/ui.js` | `49107097a7927e388ff78949045827f3a8903fea0bd758dbe1aa597bec82d8b2` |
| `blocks/vehicle-matcher/modes/question-ui.js` | `bd05c2db467b0abc5cce6d1d0cb6c17f9f1060e86176c9013ca8d8d8cb26cfad` |
| `blocks/vehicle-matcher/modes/preview-feed.js` | `5bcc378bb9a76db29943f4b7dbe4bdcb3f9c034f0a51a99ee4b78b12cfef7b49` |
| `blocks/vehicle-matcher/modes/result-card.js` | `cc5d50468f45f1c751c597ece89ca5d7dfe88f70d98dd606104ad3504007f948` |
| `blocks/vehicle-matcher/question-controls.css` | `cf6c9f81ad4bdb8f2543c93dc4dbd7eca60ea851af8d4a287c2930fbef8a17ec` |
| `blocks/vehicle-matcher/gcsp-kit.css` | `64abde7dfc99e40c68270a9ea5850c9a713623014f3beca1f4d5c96263763b86` |
| `blocks/gcsp/shell/portal-shell.js` | `4e6c3b52bb320f6254ce0a5ae62f481d022e2a24350264149352eb92caa50d8b` |
| `blocks/gcsp/shell/gcsp-tokens.css` | `d939a355b945ecfd0ad185029dbe2b79c70bab8862052a7ec54cf7abfa7f8642` |
| `blocks/gcsp/employee/gcsp-employee.js` | `2f35c7983aafef2c8f1eb72f6c78341cbf1c76269110f6a25dca1b775f11df2b` |

Re-read the live kit and FUCQ-95 result when allocation resumes. Adopt its accepted APIs before implementing a competing seam.

## First representative body

Use one page in the existing shell, with the breadcrumb **Your car brief** and a concise introduction. A compact sourced current-car/driver/contract summary establishes what the scheme already knows. `factList` displays source and missing values; `mediaWell` can show supplied current-car imagery with its actual caption. All currently supplied known facts have `editable:false`. A later editable fact must use an actual server-permitted operation; no such write endpoint exists in this slice.

At desktop, place the editable brief and explained preview in two readable columns. Preference rows pair **What you prefer** with **How much it matters**; practical requirements follow as a distinct section. Put independent search/hold permission and the save action after the requirements. The preview has its own heading, unsaved label, concise result count/status and exact-car cards. Keep its reading order after the form in the DOM. Avoid a seven-step wizard, dense portal grid or a large ornamental hero.

At 375px, retain the shell's Menu disclosure and stack each preference's two controls, then requirements, permission/save and preview. Keep labels, readouts and full car names visible. Provide a normal in-flow preview-status link near the introduction so a keyboard or touch user can reach updated results without scrolling through every field. Preview completion does not move focus. There is no mobile overlay or fixed save bar hiding content.

The first actual body must include all six registered preference dimensions, all four practical questions, distinct search/hold choices, one exact supplied car image, one absent image and a realistic long model name. Use a real editor response and a response computed by the real preview service, or a versioned browser-safe snapshot generated from those services with source identity recorded. A static fixture demonstrates layout only; actual transport proof remains required. The representative edit sets comfort and sportiness high together, changes one importance independently, keeps another at indifference, and retains at least one unknown essential. Show grounded recommendation evidence alongside the unknown candidate summary when the service returns both.

Capture and inspect this body at **1280x900 and 375x812** before building the remaining state variants. Compare its actual rendering with FUCQ-64's approved reference and the shared gallery. Record the selected source commit, response/fixture identity, screenshot paths, visual findings and keyboard observations in this directory; submit that concrete body for the dispatcher's early review before wider state fan-out. No captures are produced by this plan.

## Reuse and narrowly scoped extensions

| Need | Existing component and intended use | Remaining seam |
|---|---|---|
| Shell and account context | `mountEmployee(root, {loadAccount, renderBody, navigation, signal})` and `portalShell` | Supply the brief body through composition. Coordinate the brief/activity navigation list with FUCQ-95; do not edit `EMPLOYEE_NAVIGATION` independently. |
| Headings, actions and facts | `screenIntro`, `button`, `factList`, `el`, `formatTerm` from `ui.js` | Page composition and scoped layout only. Do not restyle primitive internals from page CSS. |
| Numeric preference position and every importance | `renderRangeSlider(container, q, null, {single:true, value, valueState, onValueChange, ariaLabel})` | The existing single-slider option replaces the story's obsolete proposal for a new `importanceControl`. Use server bounds; it returns no handle today. |
| Enum preference and practical choices | `renderOptionList(q, null, {value, onValueChange, ariaLabel})` | It currently returns `{list,selected}` and updates locally on click. Agree controlled-update support and native radio-group keyboard behaviour in the shared lane. |
| Independent search/hold permission | Callback-owned `renderOptionList` with `multi:true`, two explicit checkbox options | Map the selected keys to exact `{search,hold}` booleans. Its native buttons retain checkbox semantics and Space/Enter operation; no new consent component is needed. |
| Unsaved preview scheduling | Existing controller and `createPreviewFeed({load})` | Inject real transport. No second debounce, client ranking or browser policy table. |
| Explained cars | `previewTile(null, {view})` for a compact summary; `matchCard(null, {view})` for the explained exact car; `mediaWell` for imagery | A pure adapter maps actual service decisions to the explicit-member contract. Preserve reasons, trade-offs, blockers, unknowns, versions and points units. No reserve/accept effect is introduced. |
| Loading and empty/error outcomes | `statusScreen` plus kit `button` for supported retry | Use state-specific text and existing semantic status tokens. No new generic status component. |

Propose one additive shared-control extension, subject to FUCQ-95 seam allocation: return an update handle from `renderRangeSlider` and add an update handle alongside `renderOptionList`'s existing `{list,selected}`. An update accepts supplied value/state/disabled presentation, updates readout, `aria-valuetext`/`aria-checked` and native disabled state without emitting an input callback, and preserves each native control node. Retain every existing return property and legacy answer-mutation path. This supports external indifference changes, refreshed state and permission changes without replacing the focused input or accessing kit internals from the view. If FUCQ-95 already supplies an equivalent accepted contract, reuse it.

The single-choice option group needs documented ArrowLeft/Right/Up/Down and Home/End behaviour, one tab stop per group, Enter/Space selection and a predictable disabled-option skip. The current role-radio buttons have click handlers but no group key handling. Implement that behaviour once in the kit with regression coverage for existing retail callers; multi-select behaviour remains separately tested. This is a proposed extension, not a defect-fix write authorized by this plan.

Any agreed shared change lands with its consuming view, `COMPONENTS.md`, the existing single `components.html` gallery and external gallery module, relevant kit test and ratchet coverage/caps. Reuse `question-controls.css`, `gcsp-kit.css` and scoped `--gcsp-*` tokens; introduce no parallel token set or view-owned card/control styling. Lower existing ratchet debt only where removed; never raise an existing baseline to admit duplication.

## Preference and practical-answer semantics

The server registry currently has numeric **sportiness, comfort, economy and size**, plus categorical **body** and **fuel**. Render native position sliders for numeric definitions and explicit option choices for categorical definitions. Every dimension has a separate native importance slider. Do not invent an ordered numeric body/fuel scale to satisfy the story's historical shorthand; record this registry-driven interpretation in the UI result for review. Comfort and sportiness remain independent.

Show an explicit **I don't mind** choice separately from an unknown/unreviewed preference. Selecting it sets only importance to the canonical minimum and preserves the chosen value. Moving the importance slider above that minimum clears its selected presentation. Do not synthesize a remembered nonzero importance when leaving indifference; the user chooses the new weight using the slider. Render separate value/importance state labels and the supplied shared source; do not invent independent axis provenance. Existing draft defaults use `context.unconfirmedLabel` and the supplied unconfirmed readout treatment. Mounting a control emits no callback and approves nothing.

The accepted preview schema has one shared source for a preference, with independent value and importance states. Editing one axis can provisionally evaluate the carried displayed draft default on the other. Label the result **Preview of your current draft** and explain that starting positions may still be unconfirmed. The response's original states and `preview.approved:false` remain intact. Do not imply independent-axis review, durable approval or permission from a preview result.

For each server `practicalQuestions` entry, render separate **Yes / No / Not sure yet** choices. The UI maps through that response's `yes`, `no` and `unknown` values, retaining the essential's declared operator/unit. Current seeded examples are below solely to make the integration reviewable; runtime values come from the response:

| Question | Yes | No | Not sure yet |
|---|---|---|---|
| Carry five people | `5` | `0` (no employee minimum) | `null` |
| At least 430 litres carrying space | `430` | `0` (no employee minimum) | `null` |
| Towbar | `['towbar']` | `[]` (no employee include requirement) | `null` |
| Charging at home or work | Supplied home/work/either subchoice | `'not-ready'` | `null` |

Charging **Yes** opens the supplied location choices. Until the user selects one, the submitted essential stays `null` and visibly unresolved; never select home/work/either by default or submit a boolean. Selecting No or Not sure clears any provisional subchoice. When reopening, map exact typed values back to a choice; a value that cannot be represented by the current question mapping requires refresh/review and must remain visible rather than being overwritten. Explicit No never relaxes an independent provider requirement. Unknown charging continues to gate plug-in cars through the server assumption, with that provenance visible. No cash or contribution question appears.

Save is a deliberate confirmation of the displayed draft, including displayed starting positions. Explain that near **Save this brief**. Unknown essentials stay unknown when saved. Search and hold are independent explicit checkbox choices, initially taken from `initial.consent`; a new brief has both false. Reuse callback-owned `renderOptionList` in multi-select mode and map its selected keys to the controller's exact `{search,hold}` booleans. The copy explains that holding requires search permission as well, and saving without search permission leaves the buddy off. Never infer either checkbox from Save, preview success or another checkbox.

## Browser, controller and runtime composition

Released owned files: `blocks/gcsp/brief/gcsp-brief.js` (mount and custom element), `brief-view.js` (page composition), `brief-transport.js` (HTTP adapter), `brief-view-model.js` (pure exact-card/status projection), `gcsp-brief.css` (layout), `gcsp-brief.html` plus an external harness module, and focused `server/test/gcsp-brief-{render,transport}.test.js`. The existing `brief-controller.js` remains the state/request owner. Shared `EMPLOYEE_NAVIGATION`, backend/index and shared contracts remain frozen; use injected composition. The proposed return/update control APIs are allocated; FUCQ-95 has no slider/options seam to adopt.

1. Host composition injects the existing account loader and a same-origin `fetch`/base URL into the brief adapter. The adapter loads `GET /api/gcsp/brief/editor`, validates the real envelope, and passes its `context` and `initial` directly to `createBriefController`. Server identity/run/policy selection stays outside browser payloads. There is no fixture fallback for failed real requests.
2. Transport maps `preview` to `POST /api/gcsp/brief/preview`, `saveDraft` to `POST /api/gcsp/brief/draft` and `confirm` to `POST /api/gcsp/brief/confirm`, preserving the controller's exact allowlisted commands and typed outcomes. HTTP 409's body remains stale-version/refresh-required; a network/invalid-body failure remains unavailable. Use JSON request headers, the supported same-origin authenticated context and abort signals. No browser employee/run/fact/approved-version authority is added.
3. `mountBriefBody(main, adapters)` mounts the controls once, subscribes to the controller and patches regions/kit update handles. Updates do not replace the form or move focus. Preview cards can be replaced independently because they contain no active draft control. Current preview errors cannot erase edited values; stale success and stale failure remain rejected by the shared feed.
4. Save retains the controller's immutable snapshot/two-step draft-and-confirm operation and separate command IDs. Show actual returned approved version and permission effect. If edits occurred during Save, state clearly that the captured version was saved and newer edits remain unsaved. Do not mark the live edited axes confirmed. Reopening/refetching is a separate generation-checked operation; stale loads cannot replace a newer controller or discard edits. A conflict keeps the complete draft and consent and offers a clear refresh/review action. Loading the current server version requires an explicit replacement choice while edits exist; no automatic merge or retry is planned.
5. Compose the body through `mountEmployee`'s injected `renderBody`, navigation and `loadAccount`; its teardown calls the body teardown. The standard `<gcsp-brief>` wrapper uses a JavaScript adapter property, external module registration and disconnect cleanup, following the existing employee element conventions. A host already supplying the shell can use `mountBriefBody` directly. No nested shell, location/history mutation, inline script/handler or unsafe evaluation.
6. Teardown aborts adapter loads/requests, unsubscribes, destroys the controller/feed, removes event listeners and ignores late completions. Reconnect creates a fresh mount. The custom element's events describe navigation/status without carrying credentials or claiming server authority.

The real server composition is a remaining allocated seam. `server/index.js` currently accepts injected GCSP services; the frozen change adds `deps.gcspBriefEditor`, not a production-ready constructor. Use the same trusted account/provider/policy/clock/identity/repository instances as the existing manual/brief/recommendation services. Record where the supported demo runtime constructs and passes them before declaring the page connected. Missing dependencies show unavailable. Coordinate this route composition with FUCQ-95's additive `createActivityRoutes` call; retain both calls/imports and prove both on one integrated code identity later. No backend changes or FUCQ-95 merge are authorized here.

## Observable states and accessibility evidence

| State | Visible outcome and action |
|---|---|
| New/empty brief | Unconfirmed sourced starting positions, all practical unknowns and explicit false consent; no invented approved version. |
| Preview pending/ready | Polite status, current draft label, then exact explained cars; no focus move or automatic Save. |
| Zero eligible | Preserve the draft and explain actual blockers; offer an in-page route to the relevant controls. |
| Essential unknown | Name the actual unresolved essentials. Keep eligible recommendations visible when returned alongside unknown candidates. |
| Preview unavailable | Explain that the preview could not be updated, retain edits, provide Retry; do not present prior results as current. |
| Saving/saved | Prevent duplicate Save, retain editable draft unless a server permission forbids it, report the returned version and actual unsaved-change state. |
| Conflict | Keep edits and consent, describe newer server state and provide explicit refresh/review; no silent retry. |
| Missing context/account | Use the shell/account retry treatment and unavailable body; do not fabricate editable known facts or success. |

Use native fieldsets/legends and uniquely named position/importance inputs, full value readouts and `aria-valuetext`. Associate provenance/help and validation text through stable IDs. Keep a single polite live region for settled preview/save summaries; mark preview busy without announcing every slider tick. Error/refresh messages remain in reading order, with focused explicit validation review where needed. Use visible shared focus treatment, text/icons as well as status colours, and reduced-motion tokens. Long names wrap and missing media uses `mediaWell`'s actual placeholder/caption rules.

Desktop and 375px keyboard evidence must include Tab/Shift+Tab through shell and fields, range arrow/Home/End changes, option-group keys, checkbox Space, Save/Retry/refresh activation, visible focus and stable active-element identity across debounce, response completion and error. Verify Menu disclosure and skip link, no horizontal overflow, readable source/units and no clipped focus. Run reduced-motion and missing-image checks in the same bounded capture round. Use headless isolated browser automation; preserve the user's foreground app, selected tabs and focus.

## Validation and release gates

This documentation checkpoint changes only this plan, its evidence index and this story's partial result. Check the exact diff, internal paths and whitespace. No executable source changes, test/proof scratch or generated archive is needed. Reuse the frozen backend's 176 scoped checks and cleanup receipt; do not rerun them for prose edits.

Before later UI execution, record a fresh run identity, changed paths, affected callers, integration boundaries, exact selected commands and exclusions. Review the affected-selector plan rather than accepting its full-suite fallback silently. Start with one worker: new render/transport/controller checks, existing question/decision-card/shared-kit and employee-shell boundary checks, then copy/CSP/ratchet coverage for every new source, HTML, external harness and stylesheet path. Update the shared file/function-to-test impact evidence with bounded coverage observations during required checks. No missing map entry proves a path irrelevant.

The authored full-story `npm test` remains a required final integrated checkpoint, split into bounded chunks if host resources require it. It follows the early body review and scoped regression; it is not needed to approve this prose plan. Final acceptance additionally requires the real HTTP/runtime proof, custom-element mount/disconnect proof, kit/gallery/catalogue consistency, all seven authored desktop/375px states, actual keyboard operation and comparison with FUCQ-64 and the adjacent accepted FUCQ-95 screen. Run the Impeccable detector once after the actual UI is finished and use a bounded combined desktop/mobile inspect/fix/confirm cycle. Load the skill's craft-floor immediately before future UI edits, not for this plan.

Before test/build/capture scratch exists, establish an absolute owned root and manifest outside it and register a supervisor finalizer; pass owned TMPDIR/TMP/TEMP through every process. Budget one worker, at most 2 GiB scratch and ten minutes per independent chunk initially; measure/replan at each checkpoint and preserve the 5 GiB emergency reserve. Export any archive or output expected to reach 256 MiB directly under the prescribed OneDrive project/run path. Stop/join owned processes, retain compact receipts/useful bounded failures, remove disposable scratch and verify absence. Later browser profiles require the bounded active-working-set exception and measured cleanup receipt. This plan creates no such allocation.

Current release order is: publish this amended plan; reconcile the latest compatible clean base through the wrapper while preserving frozen backend identities; register the exact scoped run/manifest/finalizer; build one representative body and its consumed control extension; capture/inspect/fix/confirm desktop and 375px; then stop for human review. Wider state variants and final integration validation remain pending. One implementer is authorized after fresh live tier/capacity/date checks and actual-slot admission; no runner or descendants are authorized. Its self-contained brief carries this plan, the experience contract, approved body reference and exact resource duties.
