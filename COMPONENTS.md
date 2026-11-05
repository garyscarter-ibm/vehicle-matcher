# Components

The catalogue of shared UI for the vehicle-matcher block. Read this before building or changing any view (a mode in `blocks/vehicle-matcher/modes/` or the shell `vehicle-matcher.js`). Gallery page: [`components.html`](components.html). Stack: vanilla JS ES modules, no build step, no component library. Import the kit with relative ES imports (`import { el, gbp } from '../ui.js'`, `import { matchCard } from './result-card.js'`). Styles live in `blocks/vehicle-matcher/vehicle-matcher.css`, with design tokens (`--vm-*`) in `tokens.css`.

## The rule

For GCSP work, also follow the [experience quality contract](docs/gcsp/experience-quality.md), including its agreed visual reference and browser evidence. This catalogue and the ratchet establish component reuse; rendered review establishes the visual result.

1. Reuse: if a component here draws it, use it.
2. Extend: if one nearly fits, add an option to it (kit code, kit styles, this file, its test and the gallery), in the same commit as the view that needs it.
3. New, only when none can be extended: add it to the kit the same way, never inside a view, and say which components you looked at and why none would do.

A view never styles a kit component's insides from the app stylesheet.

## DOM and formatting helpers (`ui.js`)

| Call | Use for |
|---|---|
| `el(tag, className, text)` | Every DOM node in the block. Use instead of `document.createElement` plus `className`/`textContent` (text is set with `textContent`, never HTML). |
| `gbp(n)` | Money in GBP, no pence. Use instead of hand-formatting `£` and `toLocaleString`. |
| `cardinal(n)` / `CARDINALS` | Small counts as words ("three cars") in prose; falls back to the numeral above ten. |
| `screenIntro({ kicker, title, lede, level = 2, className })` | Screen heading block (`vm-kicker` / `vm-title` / `vm-lede`); title is an `h<level>`. Retail modes have not migrated yet. |
| `button({ label, variant: 'primary' \| 'ghost', onClick, href, disabled, describedBy })` | `vm-btn` button: `<button type="button">`, or `<a>` when `href` is given and not disabled. `describedBy` links a visible reason for a disabled action. Retail modes have not migrated yet. |
| `statusScreen({ kicker, title, message, actions, role = 'status' })` | Error, empty or no-match shell (`vm-screen vm-status`). `actions` are nodes. Retail modes have not migrated yet. |
| `factList(rows, { className })` | `<dl>` of `{ label, value, unit, missingLabel }` rows. A null or undefined value reads "Not supplied" (or `missingLabel`) with the `is-missing` class, never "undefined" or blank. |

## Result cards (`modes/result-card.js`)

| Call | Use for |
|---|---|
| `matchCard(match, { big, compact, brand, showScore, showPaint, rejectOptions, rejectLabel, rejectPrompt, onListingSelect, view, onAction })` | Every result car card (used by questionnaire, podium, guess-who). `big` adds reasons, `compact` is the carousel tile, `showScore: false` for hard-filter modes. Each optional `rejectOptions` item is `{ label, scope?, apply }`; `scope` is shown under its reason button. `onListingSelect(listing)` optionally updates surrounding claims after a native picker selection. Use instead of building a card by hand. |
| `feedbackScope({ text })` / `feedbackUndo({ text, onUndo })` | Shared scope note and named, keyboard-accessible undo button, using the existing `vm-brief` and `vm-brief-undo` styles. Use for local browse feedback and reversible fixture examples. |
| `feedbackButton({ text, variant, onClick })` | A labelled primary or ghost button for a feedback action such as resetting a local search or confirming a fixture proposal. |
| `previewTile(match, { view, onListingSelect, onAction })` | The small live-preview strip tile (photo or placeholder, name, score, one spec line, link to listing). |
| `mediaWell(car, extraClass, { placeholder, view })` | The photo well with the "Images coming soon" fallback (`placeholder` replaces that text, e.g. GCSP's "No image for this car yet"). Use instead of a bare `<img>` for a car. Returns `{ media, showPhoto }`. |
| `distanceLabel(distance)` / `listingsOf(match, { view })` | "18.1 miles away" text; the listings behind a match (one or N). |
| `SPEC_LABELS`, `FUEL_SPEC`, `GEARBOX_SPEC`, `SWATCH_HEX`, `CONCEPT_LABELS`, `KIT_SHOWN` | Label and colour lookups for spec lines, paint swatches and concepts. Use instead of local maps. |

`matchCard` paints the selected listing's price, photo, equipment, gearbox, link and server-supplied `decision` together. Each decision contains `score`, `stretch`, `reasons` and `tradeOffs` (with optional internal `fit`/`taste`). Group count, price spread and feature availability remain aggregate; fitted equipment uses only the selected listing. Native listing buttons retain focus and pressed state when switching. `mediaWell.showPhoto(src, selectedCar?)` also updates image text for the selected car.

The questionnaire uses `onListingSelect` to replace representative-level ranking claims with **Your selected listings.** while any card shows another member. Its representative lede, scoped notice and ranking working are hidden until all cards return to their original members. Cards remain mounted so picker focus is preserved.

On an older compatible backend, the first representative can use existing top-level fields. Switching or refining to another member without its decision suppresses unsupported scores and explanations and states that they are unavailable. The client never recreates scoring weights. The gallery's **Exact listing decisions** fixture exercises R1's £30k / 96% versus £39k / 87% stretch, long names, absent images, equipment refinement, old-backend fallback and reset alongside the existing feedback/undo examples.

### Explicit exact-member display view

`matchCard(null, { view, onListingSelect, onAction })` and `previewTile(null, options)` accept the same additive display contract. Without `view`, all retail arguments, price/mileage/dealer labels and unknown treatment retain the existing adapter. `listingsOf(null, { view })` returns the exact members, and `mediaWell(null, className, { view: member })` reads that member's display/media. `mediaWell.showPhoto(src, { name, line, alt, caption })` updates the caption and clears it for absent or broken imagery.

`view` is `{ schemaVersion: 1, members, selectedId? }`. Each member is `{ id, identity, display: { name, line?, pickerLabel? }, media: { src?, alt?, caption? }, facts, terms, decision, actions }`. Facts use `factList` rows; supply `missingLabel` with the unit for an unknown quantity. Decisions contain exact `gateStatus` (`eligible`, `ineligible`, `needs-confirmation`), optional numeric `score`, and `reasons`, `blockers`, `unknowns`, `tradeOffs` arrays of strings or `{ text, ...evidence }`. Missing decisions stay explicit and cannot qualify an accept/reserve action. Members can retain provenance/version evidence without the kit calculating policy.

`formatTerm(term)` in `ui.js` accepts `{ kind: 'purchase-money', currency: 'GBP', value }` or `{ kind: 'points-monthly', value, allowance }`. Both points amounts explicitly mean points a month. Null/nonfinite values show missing terms; unsupported kinds/units are never guessed. A purchase amount is never interpreted as points.

Each action is `{ id, kind, label, variant?, disabled?, disabledReason?, scope? }`. `onAction(action, exactMember)` owns its effect. Accept/reserve actions fail closed unless the selected exact decision is eligible, even if callers set `disabled: false`; missing callbacks also disable actions. `onListingSelect(exactMember)` runs after a picker swap updates every owned display field; native picker nodes stay mounted for keyboard focus. The kit stores no brief/offer state and performs no requests. Feedback actions can reuse `feedbackScope` and `feedbackUndo` in the caller.

Shared explicit-card styles live in `decision-card.css`, imported by the existing kit stylesheet and expressed through kit tokens and scoped GCSP status tokens. The single `components.html` gallery's **Employee decision card** demonstrates long names, representative-image caption, absent imagery and facts, exact eligible/ineligible/confirmation-needed decisions, monthly points against allowance, local callback selection/feedback/undo and disabled Reserve with its visible reason. Loading, no-match and unknown examples use `statusScreen`. The browser-safe `employee-card-fixture.js` snapshot is recomputed by `server/test/helpers/shared-kit-fixture.js` using FUCQ-29 and canonical `PolicyService`; `shared-kit-contracts.test.js` requires exact equality, including provenance. Regenerate the snapshot through that helper after policy changes, never edit independent active rules into the gallery. Approved body reference: `docs/gcsp/evidence/fucq-6/README.md`, revision `a7fc178` (Gary, 5 November).

## Questions and answers (`modes/question-ui.js`)

| Call | Use for |
|---|---|
| `renderOptionList(q, answers, { onChange, onPick, value, onValueChange, disabled, ariaLabel })` | Single- or multi-select option list for a question. `onPick` fires after a single-select tap (after `onChange`). Returns `{ list, selected }`. |
| `renderRangeSlider(list, q, answers, { onChange, single, value, onValueChange, unit, valueState, disabled, ariaLabel })` | Dual-handle range by default, `single: true` for one position or importance axis. Legacy path persists the starting value immediately without invoking `onChange`; subsequent input invokes it. |
| `visibleQuestions(questions, answers, { predicate })` / `isVisible(q, answers, { predicate })` | Apply conditional-question predicates (`SHOW_IF`) so hidden questions are skipped. |
| `formatSliderValue(value, q, { unit, valueState })` / `formatRange([lo, hi], q, options)` | Slider readouts in the question's unit. |

The presence of `value` or `onValueChange` selects callback ownership: `answers` may be `null`, no defaults or changes are written to it, and mounting emits no callback. On input, `onValueChange(nextValue)` receives a scalar or a fresh selected-value array; the caller owns its draft and any rerender. Native controls update their displayed value locally. `onPick()` follows a single selection's value callback. Without either explicit option, the existing answer keys, multi-select `any`/max behavior, range defaults and `onChange` then `onPick` order remain intact. `predicate(q, answers)` optionally owns visibility; otherwise existing `SHOW_IF` predicates apply.

Single sliders use `ariaLabel` (or the question label/id); dual sliders label minimum and maximum separately. `unit` accepts the existing suffix string or an explicit `{ kind: 'points-monthly' }`, `{ kind: 'percent' }` or `{ kind: 'purchase-money', currency: 'GBP' }` descriptor. Typed points always print points a month. A GBP question cannot be relabelled with points. Unknown/nonfinite values read `Not supplied`; `valueState: 'unconfirmed'` qualifies a supplied value, while a confirmed zero remains zero. `disabled` controls native disabled state. Indifference is an explicit option control owned by the caller, separate from importance zero or missing preference. The gallery demonstrates all three controls without implying that they recalculate its saved display snapshot. Shared native-control styles live in `question-controls.css`.

Single sliders now return `{ update({ value?, valueState?, disabled? }) }`. Option lists retain their original `{ list, selected }` and add `update({ value?, disabled? })`; the returned selected Set stays the same object. Updates project only supplied presentation into the existing native controls and ARIA/readouts, never write `answers`, emit callbacks or choose a default. A single slider's unknown/null projection keeps its physical thumb position while its readout says `Not supplied`. Callback-owned mounts still emit nothing. Single-choice radio groups have one tab stop, arrow wrapping and Home/End selection with disabled choices skipped; the native buttons retain Enter/Space activation. Multi-select checkbox buttons keep separate tab stops and their existing any/max semantics. The gallery's **Project unknown display** and **Restore local display** demonstrate update projection without changing local draft answers or its unchanged decision snapshot.

## Live preview (`modes/preview-feed.js`)

The GCSP representative editor composes `mountBrief(root, adapters)` from `blocks/gcsp/brief/gcsp-brief.js`, or `mountBriefBody(main, adapters)` when an employee host already owns the shell. Both return teardown functions. The adapter supplies account/editor loaders and preview/save/confirm transport; navigation is page input, preserving the shared employee navigation. The controller owns draft, consent and persistence. The body mounts native question controls once, projects updates through their handles, and renders exact supplied decisions through the existing card kit without scoring them. `createBriefTransport({ fetch, baseURL, signal })` supplies the canonical HTTP adapter. The `<gcsp-brief>` element accepts its adapter as a property and tears down on disconnect.

`gcsp-brief.html` demonstrates one generated representative body, including long car text, representative-image provenance, missing imagery and charging uncertainty. Its explicit synthetic notice explains that only the original displayed draft has generated decisions, arbitrary edits report unavailable, and Save is disabled. The fixture is generated by real in-process services using `docs/gcsp/evidence/fucq94/generate-representative.mjs`; it supplies no independent matching rules and does not write a saved brief.

| Call | Use for |
|---|---|
| `createPreviewFeed({ api, retailer, brand, scope, group, load, onError })` | Debounced, stale-safe preview fetch: `schedule(answers, onResult, onError?)` and `cancel()`. Use instead of hand-rolled timers around `apiPreview`. `PREVIEW_DEBOUNCE_MS` is exported. |

An injected `load(snapshot)` owns transport and returns any display value synchronously or asynchronously. It bypasses `apiPreview` entirely; the retail adapter remains the default when `load` is absent. At dispatch the scheduler deep-copies nested draft data so later edits cannot change the request. Current loader rejection or synchronous failure goes to the optional schedule/config `onError(error)`; without a handler it delivers `[]`, matching the legacy fallback. Stale success/failure and cancellation deliver neither callback. Callers own loading/error presentation and all persistence. The single gallery demonstrates a local loader plus explicit `previewTile`, labelled as an unchanged FUCQ-29 snapshot.

Each feed owns its debounce and request generation. `schedule()` invalidates all earlier callbacks immediately, before the new 250 ms debounce completes. `cancel()` clears the timer and invalidates dispatched callbacks, including failures that `apiPreview` maps to an empty list. Cancellation is repeatable and the feed can be scheduled again. Correctness does not depend on transport abort support. Scope, grouping, payloads and server-owned preview limits retain their existing meaning; presentation of loading, empty and failure states stays with the consumer.

A mode's synchronous `mount(root, ctx)` may return a cleanup function. The shell calls it before replacing the stage or mounting another mode; modes that return nothing remain supported. Preview consumers return cleanup that calls their own feed's `cancel()` and guards late boot updates. Embedders calling a mode directly must call its returned cleanup before replacing its stage. Questionnaire also cancels when leaving its question flow, and each block paints into its own preview root.

## Feedback actions

The local, serialisable action contract is [`docs/gcsp/feedback-actions.md`](docs/gcsp/feedback-actions.md). The questionnaire applies browse actions to every listing in the current search, including nearby retailers, and labels that scope under each rejection reason. “Just not this one” excludes the exact model group and says so. The running brief states that changes stay in the current session and are not saved; each applied statement has an `Undo` control with a descriptive accessible name.

The contract distinguishes a known value from unavailable data. Rejecting a named paint leaves listings with no known paint in the search. A gearbox reason is offered only when another known gearbox exists, and its `not-equals` rule keeps listings whose gearbox is unknown. A price or odometer rule requires a known value below the chosen threshold. The gallery's fixture-only employee summary preserves the confirmed estate preference and five-seat essential while showing `charging: none` separately from `needs-confirmation`; its confirmation and local undo do not write a saved brief, account learning or a hold.

## Car signals, game helpers, effects (`modes/match-signal.js`)

| Call | Use for |
|---|---|
| `celebrate(host, { brand })` | Confetti burst on a result (host must be `position: relative`); gate on reduced motion. |
| `priceLabel(car)`, `gbpShort(n)`, `cap(s)` | Price text, "£12k" style short money, capitalise. |
| `shadeOf(car)`, `swatchFor(car)`, `SHADE_HEX`, `NEUTRAL_SWATCH` | Paint shade and its swatch colour. |
| `ageInYears(car, now)`, `registrationDate(car)`, `idOf(car)` | Car age, registration date, stable id. |
| `shuffle(list)`, `photosFirst(list, photoOf)`, `modal(values)`, `rankByFrequency(values)` | List and tally helpers for the game modes. |
| `budgetBandsFromQuestion(q)`, `useTilesFromQuestion(q)` | Turn the server's budget/use questions into tile data. |
| `likesToAnswers`, `swipesToAnswers`, `bracketToAnswers` | Convert taste signals into engine answers. `WEAK_SCORE` is the weak-match threshold. |

## Copy (`modes/brand-copy.js`)

| Call | Use for |
|---|---|
| `BRAND_COPY[brandKey]` | All user-facing strings per brand. Add copy here, never inline in a mode. No em dashes (enforced by `server/test/render.test.js`). |
| `UNMET_PHRASES`, `TRADE_COPY`, `tradeLines(brandKey, trades)` | Phrases for unmet wishes and trade-offs. |
| `orList(items)` / `andList(items)` | "a, b or c" / "a, b and c" joins. |

## GCSP shell (`blocks/gcsp/shell/portal-shell.js`)

Shared by the employee entry now and Greg's views later; scoped tokens and styles are in `blocks/gcsp/shell/` (`.gcsp`, `--gcsp-*`). Looked at: `el`, `statusScreen`, `screenIntro`, the retail header in `vehicle-matcher.js` and the demo launcher chrome. None supplies portal landmarks, account context and narrow icon navigation, and the retail pieces are brand themed and retail only.

| Call | Use for |
|---|---|
| `portalShell({ title, account, navigation, active, breadcrumbs, onNavigate, onRetryAccount })` | The slim branded header (account loading, ready and unavailable-with-Retry states), `<nav aria-label="Portal">`, optional breadcrumbs, skip link and `<main>`. Returns `{ root, main, setAccount, setActive, setBreadcrumbs, destroy }`. |
| `accountNavigation({ items, active, expanded, onNavigate, onToggle })` | Narrow icon sidebar with a label toggle. Unavailable items are disabled buttons with a visible reason, never dead links. Used inside `portalShell`. |
| `svgIcon(paths)` | Decorative inline SVG icon built with `createElementNS`. |
| `mountEmployee(root, ctx)` / `<gcsp-employee>` (`blocks/gcsp/employee/gcsp-employee.js`) | The employee entry. Contract in [docs/gcsp/employee-entry-contract.md](docs/gcsp/employee-entry-contract.md). |

Gallery: the single gallery ([`components.html`](components.html)) now has a **GCSP** section with the four primitives, the `mediaWell` GCSP placeholder, `portalShell` in loading, ready (long name) and unavailable states, and `accountNavigation` collapsed and expanded. Harness page: [`gcsp-employee.html`](gcsp-employee.html) (`?fixture=` names in the entry contract).

The representative employee body (`blocks/gcsp/employee/representative-body.js`, styles in `gcsp-employee.css`) is page composition from kit primitives and `gcsp-*` classes, not a kit card. It builds no competing car card: FUCQ-31 owns the shared decision-card and control contract, and the body adopts it when that lands.

## GCSP presenter outbox (`blocks/gcsp/presenter/`)

Looked at: `el`, `button`, `screenIntro`, `statusScreen`, `factList` (all reused here), the retail result cards and `portalShell`. No kit component lists messages with a detail pane, so `messageList` is new.

| Call | Use for |
|---|---|
| `messageList({ messages, selectedId, onSelect, label })` (`message-list.js`) | Rows (real buttons, `aria-current` on the open one) and a detail pane: heading that takes focus, facts, the HTML body in a sandboxed `srcdoc` iframe, the plain-text alternative and a safe `target=_blank rel=noopener` offer link. Unrendered messages show the status explanation. Returns `{ root, select, update, getSelected, destroy }`. |
| `mountOutbox(root, ctx)` / `<gcsp-outbox>` (`gcsp-outbox.js`) | The presenter-only viewer in `portalShell`. Contract in [docs/gcsp/presenter-outbox-contract.md](docs/gcsp/presenter-outbox-contract.md). Harness: [`gcsp-outbox.html`](gcsp-outbox.html). |

Gallery: the GCSP section of [`components.html`](components.html) shows `messageList` with sent, retrying and failed messages.

## GCSP Greg dashboard (`blocks/gcsp/greg/`, kit in `blocks/gcsp/kit/`)

Looked at: `el`, `screenIntro`, `button`, `statusScreen` and `factList` (all reused: heading, Refresh/Retry, states and the meta strip), `portalShell` (the shell), the employee `gcsp-card` and the retail `matchCard`. None draws a dense figure tile or a data table, and the employee cards are image-led, so `metricTile` and `dataTable` are new. They live in GCSP-scoped kit files (`blocks/gcsp/kit/gcsp-kit.css`, every selector `.gcsp`, tokens only), not in `ui.js` or `tokens.css`. Counts are `{ label, isBand }` from `toDashboardView`; a band shows its own text ("fewer than 5") with a dashed outline and screen-reader text, and nothing is derived from it.

| Call | Use for |
|---|---|
| `metricTile({ label, count: { label, isBand }, note, level })` (`metric-tile.js`) | One labelled figure. `level` is `headline`, `standard` or `compact`. A band reads "fewer than N" and is described as a privacy band; a missing count reads "Not supplied". |
| `dataTable({ caption, columns: [{ key, label, numeric }], rows, emptyText, id })` (`data-table.js`) | A real `<table>` with `<caption>`, `th scope="col"`, first cell `th scope="row"`, right-aligned tabular numeric columns and band cells marked like tiles, inside a `role="region"` `tabindex="0"` scroll area labelled by the caption. No rows shows one `emptyText` row. Cells are strings, numbers or `{ label, isBand }`. |
| `mountGregDashboard(root, ctx)` / `<gcsp-greg-dashboard>` (`gcsp-greg.js`) | Greg's view in `portalShell`: meta strip, headline tiles, demand, unmet needs, offers and stock, and five reserved empty regions (publish, order tracking, prediction, route comparison, case queue). Returns a teardown with `refresh()` and `regions`. Contract in [docs/gcsp/greg-dashboard-contract.md](docs/gcsp/greg-dashboard-contract.md). Harness: [`gcsp-greg.html`](gcsp-greg.html). |

Gallery: the **GCSP Greg kit** section of [`components.html`](components.html) shows `metricTile` exact, band and with a note, and `dataTable` with a long model name, a band cell and the empty state. The ratchet now also caps `blocks/gcsp/kit/gcsp-kit.css` and `blocks/gcsp/greg/gcsp-greg.css`.

## Not yet in the kit

Hand-built in several modes (file counts at the time of writing):

- **Screen heading block** (`vm-kicker` / `vm-title` / `vm-lede`): 5 files, 43 occurrences. `screenIntro` now exists in `ui.js`; retail modes have not migrated yet.
- **Primary and ghost buttons** (`vm-btn vm-btn-primary|ghost`): 5 files, 27 occurrences. `button` now exists in `ui.js`; retail modes have not migrated yet.
- **Skeleton blocks** (`vm-skel ...`): 5 files, 28 occurrences. Should become `skeleton(kind)` and per-screen `loadingScreen()`.
- **Status screen shell** (`vm-screen vm-status`, used for error, empty-pool and no-match): 5 files, 7 occurrences. `statusScreen` now exists in `ui.js`; retail modes have not migrated yet.
- **Spec pills** (`vm-mingle-pill`, fuel, body, shade): 2 files, 10 occurrences. Should become `specPills(car)`.
- **Mingle card media and body** (`vm-mingle-card-*`, duplicated between swipe and head-to-head): 2 files, 12 occurrences. Should become `miniCarCard(car)`.
- **Single-value slider** (`vm-slider-input`, duplicated in questionnaire and podium instead of a kit option on `renderRangeSlider`): 2 files, 2 occurrences. Use the implemented `single: true` option on `renderRangeSlider`; existing mode copies remain ratcheted migration debt.

## The ratchet

Test: `server/test/ui-ratchet.test.js`, config and baseline in `server/test/ui-ratchet.json`; it runs in `npm test`. After moving a view onto the kit, run `node server/test/ui-ratchet.test.js --write` to lower the baseline (only ever commit it lower). `node server/test/ui-ratchet.test.js --debt` lists what is outstanding. `vehicle-matcher.css`, `decision-card.css`, `question-controls.css`, `component-gallery.css` and the four GCSP stylesheets (`blocks/gcsp/shell/` and `blocks/gcsp/employee/gcsp-employee.css` and `blocks/gcsp/presenter/gcsp-presenter.css`) are capped at their current length (`stylesheets` in the config); `blocks/gcsp/` is a scanned root.


## Shared demo launcher (`blocks/demo-launcher/`)

Reuse `el`, `screenIntro`, `button` and `mediaWell`. Decision cards represent exact cars and question controls represent answers; neither represents destination navigation or a change of brand context, so these two consumed primitives are new. Their shared styles live in `launcher.css`, with the existing semantic VM tokens and an explicit ratchet cap. Launcher and gallery compositions place `.vm` within `.gcsp`, consuming the shared `gcsp-kit.css` layer and scoped tokens for the approved system font, normal-case headings and teal actions. `entry-host.css` contains only the extracted page surface/password gate styles; `retail-chrome.js` preserves the existing brand picker and shell.

| Call | Use for |
|---|---|
| `experienceChoice({ title, description, image?, imageLabel?, action, reason?, status?, secondaryAction? })` (`components.js`) | A semantic destination article with an h2, shared media fallback, visible state/reason, and native action. Disabled actions reference the visible reason. Labels survive failed imagery. |
| `brandSelector({ value?, onChange, label? })` (`components.js`) | A labelled native select with all six retail brands and All brands. Decorative logo failures keep text labels. Emits the selected brand or null without navigating or writing policy. |
| `renderLauncher(root, context, { input? })` (`launcher.js`) | Composes the two destination choices and keeps the selected brand visible. Used cars retains the resolver's URL context; employee BMW selection is explicit. |
| `bootDemo({ root?, employeeCapability?, decorateRetail? })` (`boot.js`) | Gate and route integration. A capability is available only with `enabled === true` and a real `mount(root, context)` function. The default remains unavailable pending FUCQ-35 registration; a boolean alone cannot enable an entry. |

The existing single `components.html` gallery includes a local brand callback, long destination title, missing images, loading and unavailable choices. No employee shell is duplicated. Launcher JavaScript is an explicit ratchet root; the shared primitive module is excluded as kit code. New surface checks reject inline scripts/handlers and unsafe execution.


### GCSP primitive styling (`blocks/vehicle-matcher/gcsp-kit.css`)

The shared GCSP adaptation of `screenIntro`, `button`, `factList`, `statusScreen` and `mediaWell` lives in this explicitly capped kit stylesheet. It imports `blocks/gcsp/shell/gcsp-tokens.css` and scopes every rule under `.gcsp`, with no employee-shell dependency. Both `gcsp-employee.css` and `demo-launcher/launcher.css` import it; the employee's existing primitive rules were moved unchanged. Keep new common primitive treatment here rather than duplicating it in page CSS. Retail surfaces stay outside `.gcsp` and retain their brand themes.

### GCSP account consumer (`blocks/gcsp/account/`)

`mountAccount(root, { adapter, brand, onSupport, print })` and `<gcsp-account>` compose `mountEmployee`, `screenIntro`, `button`, `statusScreen`, `factList`, `formatTerm`, `mediaWell`, the existing countdown and native labelled details for delivered cars, read-only account/licence facts and grouped histories. A current car has no stock decision, so this is page composition rather than a new decision-card primitive. `gcsp-account.css` imports the employee composition and has its own ratchet cap; harness `gcsp-account.html` uses the HTTP adapter by default and explicit read-only snapshots with `?fixture=`.

### GCSP native form presentation (`blocks/gcsp/kit/form-controls.js`)

Looked at `renderOptionList` and `renderRangeSlider`: they supply question buttons and sliders, while setup needs native date, select, contact and textarea controls with linked field errors. These two shared presentation helpers own no policy, requests or draft state. Their scoped stylesheet is `form-controls.css`; the single gallery's **GCSP native forms** section demonstrates validation, focus and reset.

| Call | Use for |
|---|---|
| `labelledField({ id, label, control, hint, error })` | Associates a unique id with a native control, label, optional hint and inline error. Returns `{ root, setError }`; updates preserve the control and manage `aria-invalid` and `aria-describedby`. |
| `errorSummary({ id, title, errors: [{ id, message }], onSelect })` | Links validation messages to controls. Returns `{ root, update, focus }`; focus targets its heading and links target the relevant control. |

`mountManualSetup(root, { adapter, brand, hint, onBack, onSupport, commandId })` and `<gcsp-manual-setup>` compose the employee shell, shared forms and existing heading/button/status/facts/typed terms. Native controls remain mounted through input and asynchronous state updates. The controller supplies permitted choices, source facts and errors. `gcsp-manual-setup.html` loads the authenticated draft directly; `mountManualJourney` connects account journey hints to a fresh trusted setup read and saves valid choices before Back. The bubbling/composed `gcsp:setup-ready` event carries exact mode/old-contract/slot/scheme/draft/context hints after a successful complete save and current availability; it creates no claim.
