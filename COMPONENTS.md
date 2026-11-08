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
| `renderOptionList(q, answers, { onChange, onPick, value, onValueChange, disabled, ariaLabel })` | Single- or multi-select option list for a question. `onPick` fires after a single-select tap (after `onChange`). Returns `{ list, selected, update }`. |
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

**Default Density theme, authorised by Gary, 5 November 2026:** [`gcsp-tokens.css`](blocks/gcsp/shell/gcsp-tokens.css) imports [`density-theme.css`](blocks/gcsp/shell/density-theme.css) for every `.gcsp` consumer, including employee, Greg and the shared launcher. No opt-in class is required. It maps verified BMW Density values into the kit's semantic tokens and packages BMW Group TN Condensed Pro Medium for large page titles at weight 500; body text, smaller headings and controls use Density's system stack. Use this shared mapping instead of copying portal CSS or adding view-specific colours/fonts. [Source evidence and usage](docs/gcsp/density/README.md); [reference preview](docs/gcsp/density/preview.html), also linked from the GCSP gallery. The existing shell geometry and 48px touch controls remain local adaptations. Ghost-button hover excludes a pressed button, preserving its selected background and text contrast.

| Call | Use for |
|---|---|
| `density-typography.css` (imported by the default theme) | Shared source-derived families and weights: large titles BMW Medium 500; body/inputs/options system 400; smaller headings/buttons/emphasis system 600; table headers system 500; plain text/code the Density mono stack. Reuse semantic `--gcsp-font-*` aliases instead of introducing view-specific fonts or retail weights. The gallery's Density typography, question-controls, cards, tables and message-list examples exercise these roles. Local responsive sizes and italic missing-data cues remain intentional adaptations. |
| `portalShell({ title, account, navigation, active, breadcrumbs, onNavigate, onRetryAccount, presenterControls })` | The slim branded header with locally packaged BMW GROUP/BMW/MINI Density artwork, account loading/ready/unavailable-with-Retry states, `<nav aria-label="Portal">`, optional breadcrumbs, skip link and `<main>`. Ready accounts use a compact single-row native disclosure with full name/context inside; Escape closes it and returns focus. Unavailable accounts show a short status with the full message available to assistive technology and in the tooltip. Presenter controls appear only after the existing presenter API authorises them; pass `false` to omit them, or `{ adapter, navigate, commandId }` for an injected port. Returns `{ root, main, presenterRegion, setAccount, setActive, setBreadcrumbs, destroy }`. |
| `accountNavigation({ items, active, expanded, onNavigate, onToggle })` | Narrow icon sidebar with a label toggle. Selected items use pale cyan, teal text/icon and a teal left edge, following the supplied GCSP shell. Unavailable items are disabled buttons with a visible reason, never dead links. Used inside `portalShell`. |
| `svgIcon(paths)` | Decorative inline SVG icon built with `createElementNS`. |
| `mountEmployee(root, ctx)` / `<gcsp-employee>` (`blocks/gcsp/employee/gcsp-employee.js`) | The employee entry. Contract in [docs/gcsp/employee-entry-contract.md](docs/gcsp/employee-entry-contract.md). |

Gallery: the single gallery ([`components.html`](components.html)) now has a **GCSP** section with the four primitives, the `mediaWell` GCSP placeholder, `portalShell` in loading, compact ready (long name), open account-details and unavailable states, and `accountNavigation` collapsed and expanded with the reference's pale selected treatment. Harness page: [`gcsp-employee.html`](gcsp-employee.html) (`?fixture=` names in the entry contract). [Shell refinement and evidence](docs/gcsp/density/gcsp-shell-refinement.md); [artwork provenance](docs/gcsp/density/evidence/shell-logo-provenance.json).

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
| `mountGregDashboard(root, ctx)` / `<gcsp-greg-dashboard>` (`gcsp-greg.js`) | Greg's view in `portalShell`: meta strip, headline tiles, demand, unmet needs, offers and stock, plus regions for publishing, order tracking, prediction, route comparison and the case queue. A supplied `publishAdapter` mounts the existing publication panel. Returns a teardown with `refresh()` and `regions`. Contract in [docs/gcsp/greg-dashboard-contract.md](docs/gcsp/greg-dashboard-contract.md). Synthetic dashboard harness: [`gcsp-greg.html`](gcsp-greg.html); live workspace: [`gcsp-presenter.html`](gcsp-presenter.html). |

Gallery: the **GCSP Greg kit** section of [`components.html`](components.html) shows `metricTile` exact, band and with a note, and `dataTable` with a long model name, a band cell and the empty state. The ratchet now also caps `blocks/gcsp/kit/gcsp-kit.css` and `blocks/gcsp/greg/gcsp-greg.css`.

`mountGregOrders(root, {adapter, productionControls, onChanged, signal})` and `<gcsp-greg-orders>` in `blocks/gcsp/greg-orders/` compose the existing `dataTable`, `labelledField`, `button`, `statusScreen` and `el`. This adds no competing kit primitive. Requested, confirmed and released counts stay separate; native model/derivative/quantity forms retain focus across refresh, and saved confirmations expose release-queue retry. The optional synthetic production disclosure uses the retained presenter cookie; the acting Greg cookie handles requests and queueing. The element accepts `adapter` as a property, emits `gcsp:orders-changed`, has `refresh()`, and aborts on disconnect. The [same-origin integration harness](blocks/gcsp/greg-orders/harness.html) mounts the panel in the existing dashboard region, requiring trusted backend session bootstrap and registered supply/demand routes. Its scoped composition stylesheet is capped separately; shared kit/gallery rows and existing caps remain intact. [Contract and browser evidence](docs/gcsp/greg-orders-contract.md).

`attachGregOrders(dashboard, {adapter, productionControls, onChanged, signal})` in `blocks/gcsp/greg-orders/runtime.js` owns that existing region across dashboard remounts. It replaces prior listeners, refreshes the same demand dashboard after an order change, and restores the original reserved region on teardown or abort. Production controls default to hidden; the host selects disclosure. [Canonical host/source handoff](docs/gcsp/fucq104-source-runtime-handoff-2026-11-06.md).

## GCSP Greg order plan (`blocks/gcsp/greg/plan/`)

`mountGregOrderPlan(root, { adapter, signal, onSubmitted, commandId })` and `<gcsp-greg-order-plan>` (`fixture` attribute or `adapter` property) show Greg's next order: the action first, versions, proposed quantities, coverage and risk tiles, unmet needs, binding constraints, alternatives, a limits editor, a labelled preview, and a separate "Request N vehicles from Production" button. Looked at: nothing existing draws a plan, so it composes `el`, `screenIntro`, `button`, `statusScreen`, `factList`, `metricTile`, `dataTable`, `labelledField`, `errorSummary` and `renderRangeSlider` (single). It adds no new kit primitive. `mountGregDashboard` mounts it into the `prediction` region when given `orderPlanAdapter` (the Greg HTTP adapter's `orderPlan`), refreshes it on `gcsp:policy-published` and exposes `teardown.orderPlan`; the presenter workspace refreshes it with order tracking.

`plan.css` is `.gcsp` scoped, uses tokens only and has its own cap in `server/test/ui-ratchet.json` (32 lines); `gcsp-greg.css` keeps its cap by importing it. No JavaScript pattern debt was added. Gallery: the **Greg order plan** section of [`components.html`](components.html) shows ready, preview, infeasible and stale. Every state loads in the dashboard harness as `gcsp-greg.html?fixture=populated&plan=<state>`.

## GCSP renewal cases and presenter workspace

The adopted case and publication views compose `screenIntro`, `button`, `statusScreen`, `factList`, `dataTable` and the shared labelled fields/error summary. They introduce no new shared primitive. Their styles use the existing GCSP tokens and have explicit ratchet caps.

| Call | Use for |
|---|---|
| `mountHelp(root, options)` / `<gcsp-help>` (`blocks/gcsp/cases/gcsp-help.js`) | Employee renewal help, explicit request review/confirmation and current case readback. [`gcsp-help.html`](gcsp-help.html) uses the existing HTTP case and account adapters; named fixtures are explicit snapshots. |
| `mountCaseQueue(root, options)` / `<gcsp-case-queue>` (`blocks/gcsp/cases/gcsp-case-queue.js`) | Greg's current scheme-team cases and deliberate case actions. The live workspace embeds it in the dashboard's existing `caseQueue` region. [`gcsp-case-queue.html`](gcsp-case-queue.html) is the standalone HTTP entry. |
| `mountGregPublish(root, options)` (`blocks/gcsp/greg/publish/panel.js`) | Server-projected policy values, preview and explicit publication of the reviewed changes, with held-offer readback. Its gallery adapter supplies synthetic component states only. |
| `mountPresenterWorkspace(host, options)` (`blocks/gcsp/presenter-controls/workspace.js`) | Reads the actual acting context, then mounts the existing employee manual journey or Greg HTTP dashboard with publication and the case queue. Presenter switching/reset returns to [`gcsp-presenter.html`](gcsp-presenter.html); the employee account retains Resume and renewal-help navigation. |

## GCSP activity (`blocks/gcsp/activity/`, timeline in `blocks/gcsp/kit/`)

The representative activity body follows approved employee reference `a7fc178` and reuses `screenIntro`, `button`, `statusScreen`, `mediaWell`, `svgIcon`, the merged GCSP primitive stylesheet and `mountEmployee`. `messageList` owns messages and `dataTable` owns comparison; neither expresses dated activity. No existing kit control owns popup actions with keyboard focus and dismissal, so the consumed menu is shared kit.

| Component | Use |
|---|---|
| `activityTimeline({ events, heading = 'Activity history', emptyText, level = 2 })` (`activity-timeline.js`) | Named ordered list of supplied `{ id, occurredAt, label, detail? }` events. Supplied order; valid dates use `<time datetime>` and fixed UTC demo time, also exported as `demoTime(instant)` for callers that print a check or deadline time. Missing dates say “Time not available”; no events say “No activity is recorded”. No requests or inferred events. Scoped `activity-timeline.css`. |
| `actionMenu({ label = 'Actions', items })` (`action-menu.js`) | Named three-dot native button and menu. Items are `{ label, onSelect?, disabled?, reason? }`. Disabled items remain focusable with `aria-disabled` and their visible described reason. Arrow keys/Home/End move focus; Escape restores trigger focus; Tab/outside focus/pointer dismiss. Call returned `destroy()` or `root.destroy()` before unmount. Caller owns effects; no requests. Scoped `action-menu.css`. |
| `activityBody({ result, onRetry?, onPause?, onResume?, pending = false, offerDisplay?, level = 1 })` (`activity-body.js`) | Compact Active/Inactive status and Pause/Resume menu; image-led offer; one lower Activity feed whose search and check lines come from `value.state`, `sourceStatus` and `lastSuccessfulCheck` (`searchLines`, `activity-copy.js`): Not searched yet, Still searching. No match yet., Source delayed. Waiting for stock data., Stock source unavailable., and “Last check <demo time>: N cars checked, M suitable.” (adds “Found a car for you.” when a car is held). Missing evidence adds no line. The offer is `value.currentOffer`; `offerDisplay` (imagery, title) applies only when its `offerRef.offerId` matches. Paused says new searches and holds have stopped, plus “Your offer is still open. View it to accept or decline.” when the offer is active. Host callbacks own saved commands; absent callbacks show “Preview only”, pending commands show “Updating search”. No requests in this body. |
| `activityOffer({ offer, display?, level = 2, emptyText? })` (`activity-offer.js`) | Page composition reusing `mediaWell`, `button` (a ghost `<a>` “View offer” to `offer.href`) and native image controls. Shows the offer state (Waiting for you, Being processed, Accepted, Declined, Expired) and “Respond by <demo time>” while active. `display` is `{ offerRef, title?, images: [{ src, alt, kind }] }`. Local reviewed-source allowlist currently accepts only `/assets/brand-hero/bmw.jpg` as `representative`, with an explicit brand-image caption. Unknown/network sources and false exact claims are rejected; absent/broken media preserves offer facts. Scoped `activity-offer.css`. |

The single gallery contains the timeline and one activity surface per state: not searched, searching, offer waiting, declined, expired, paused (with and without an open offer), source delayed, source unavailable, pending command and unavailable, plus absent/broken imagery and multiple-image controls. The pending example supplies a disabled local callback and saves nothing. Its multiple-image example repeats the same approved brand image solely to exercise selection. Gallery remount destroys open menus. Harness: `gcsp-activity.html?fixture=` `offer` (default), `never-checked`, `searching`, `offer-declined`, `offer-expired`, `paused-offer`, `paused`, `source-delayed`, `source-unavailable` or `unavailable`.

`activity-fixtures.js` is generated by `server/test/helpers/activity-fixtures.js --write-activity-fixtures`: one fresh synthetic run per state: real BriefService confirmation/pause, a stored allocation receipt of the real shape, a real clock tick for source health, and a tiny quote/hold/offer stored via the real repository, all projected by the real activity reader. These are design fixtures, not evidence of an integrated search producer or offer access; the View offer link target is the real route but opens nothing in the gallery. Provider-unavailable is a simulated repository failure. Equality is checked by `gcsp-activity-body.test.js`. New styles are ratchet capped; existing caps/baselines never increase. The callback consumer and custom element contract are in `docs/gcsp/activity-entry-contract.md`; genuine search and offer integration remain separate acceptance prerequisites.

## GCSP order progress (`blocks/gcsp/order-progress/`, kit in `blocks/gcsp/kit/`)

Slice A of FUCQ-120: a pure, request-free render layer for Paula's order progress, outstanding actions, handover and return planning. It follows the activity body's reference (`a7fc178`) and reuses `screenIntro`, `statusScreen`, `button`, `factList`, `mediaWell` (placeholder "No image for this car yet") and `activityTimeline`. Two kit components are new.

| Component | Use |
|---|---|
| `stageTracker({ heading = 'Progress', stages, level = 2 })` (`stage-tracker.js`) | Named `<ol>` of `{ id, label, state: 'done' \| 'current' \| 'upcoming' \| 'declined' \| 'blocked', at?, owner?, next?, note? }`. State is always written ("Done", "Current step", "Not started", "Declined", "Not updated"); `current` and `blocked` carry `aria-current="step"`. `at` prints in demo time, `owner` and `next` ("Next: ...") are the caller's wording, `note` is a free line (a blocked reason). Supplied order; nothing inferred; no requests. Scoped `stage-tracker.css`. |
| `taskList({ heading = 'Tasks', groups: [{ heading, items }], emptyText, level = 2 })` (`task-list.js`) | Grouped owned items `{ id, label, owner, status, tone: 'todo' \| 'in-progress' \| 'overdue' \| 'failed' \| 'done', due?, reason?, detail?, action?: { label, onSelect(id), disabled, reason } }`. The action is the kit `button`; a disabled action links its visible reason. `Overdue` and `Failed: <reason>` are written out, not colour alone. Due times use `demoTime`. Empty groups are skipped; no groups reads `emptyText`. No requests. Scoped `task-list.css`. |
| `orderProgressBody({ progress, car?, pending?, message?, onRetry?, onCompleteTask?, onRequestAppointment?, onAcceptAppointment?, onRequestReturn?, onAcceptReturn?, onHelp?, mountHelp?, level = 1 })` (`order-progress-body.js`, copy in `order-progress-copy.js`) | `progress = { phase: 'loading' \| 'ready' \| 'unavailable', stages, documents, appointment, returnPlan }`, each the producer's raw envelope. Sections: Your order (car, `Order no.`, server stage names in sentence case, owner and next step from `value.owner`/`nextStep`, HR only if the server list has it, `blocked` as Not updated), Handover (FUCQ-114 states; `booked` decides "Booked"), Documents and checks (tasks first, then others; readiness; "Synthetic acknowledgement, not a signature"), and Returning your current car (only when `applicable`; the current car is shown unchanged in every state). A failed envelope shows its own line and the rest still render. `documents` is the `readItems` envelope (order matched by `stages.value.orderUuid`); a lone order or `not-open` is accepted. Absent callbacks render no controls; `pending` disables actions; `message` is a live region (`alert` when `error`). `mountHelp(node)` or `onHelp` supplies help for a decline or a proposed time. Scoped `gcsp-order-progress.css` (layout only). |

Looked at and why none would do: `activityTimeline` is dated history only, with no owner, current step or next step (it still draws the handover and return history); `factList` pairs labels with values and has no order, state or action; `dataTable` is a comparison grid, not a list of actions; `messageList` shows messages, not owned items with due times; `statusScreen` is one whole-screen state (it still draws loading and unavailable).

`fixtures.js` holds one fictional `progress` per state in the producer shapes (key lists asserted against `server/test/fixtures/gcsp-lifecycle-*-outcomes.json`): waiting-hr, waiting-sales-manager, no-hr, declined, provider-unsupported, sent-to-ordering-no-slot, appointment-requested, appointment-change-proposed, appointment-pending, appointment-scheduled, documents-waiting-for-you, documents-in-progress, documents-overdue, documents-failed, ready-for-handover, return-unavailable, return-not-planned, return-requested, return-change-proposed, return-scheduled, new-order, loading, unavailable, partial-failure. The gallery draws each, with callbacks that only report. Slice B1 wires it (no new components, no new styles). `createOrderProgressHttpAdapter({ fetch, loadAccount? })` (`order-progress-http.js`) is the same-origin adapter (credentials same-origin, no-store, redirects fail closed): `listOrders`, `readStages`, `readAppointment`, `readReturnPlan` (each `{ orderUuid, signal }`), `readDocuments`, and the commands `completeTask({ orderUuid, itemId, commandId })`, `requestAppointment`/`requestReturn`, `acceptAppointment`/`acceptReturn`. Producer refusals (`unsupported`, `conflict`, `forbidden`, `not-open`) keep their own envelope; anything malformed is `unavailable`. `createOrderProgressController({ adapter, orderUuid?, onChange })` (`order-progress-controller.js`) reads the four producers in parallel into the `progress` shape, one command at a time, and re-reads everything after each command. Without an `orderUuid` it takes the employee's newest order by `source.receivedAt` (ties: larger order id); none gives phase `none`. `mountOrderProgress(root, { adapter, orderUuid, car, brand, navigation, onNavigate, helpAdapter, embedded, headingLevel })` and `<gcsp-order-progress>` (attributes `brand`, `order-uuid`, `embedded`, `heading-level`; properties `adapter`, `car`, `helpAdapter`) are in `gcsp-order-progress.js`; it exports `ORDER_PROGRESS_DESTINATION`, `defineGcspOrderProgress()` and a default `decorate`, and `register.js` defines the element. Not embedded it mounts inside `mountEmployee`; embedded it draws only the body (for the account and offer hosts) and loads no account. Help is the embedded `mountHelp`, torn down on every repaint. Pages: `gcsp-order-progress.html` (design harness, `?fixture=` any fixture name, keyboard state picker, callbacks report locally) and `gcsp-order-progress-live.html` (real adapters; Brief and Buddy activity navigation). Tests: `gcsp-order-progress-view.test.js`, `-kit`, `-controller`, `-http`, `-entry` and `-live` (the real memory runtime over loopback HTTP). Embedded (slice B2): the account page mounts it as "Your order" only when `listOrders` finds an order (`orderAdapter`, `helpAdapter` options of `mountAccount`; the car is the `GET /api/gcsp/manual/order` selection snapshot, used only when its `orderUuid` matches, else left unset). The offer page mounts it under the accepted car for `orderUuid` through the `order` port (`mountOffer`/`createOfferView` `mountOrder`), with the car from the offer's own display. Remaining: a navigation entry on the other live pages.

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
| `bootDemo({ root?, employeeCapability?, decorateRetail? })` (`boot.js`) | Gate and route integration. A capability is available only with `enabled === true` and a real `mount(root, context)` function. Library boot stays unavailable until supplied a real capability; public boot registers the lazily loaded employee journey. A boolean alone cannot enable an entry. |

`createEmployeeCapability({ enabled, load, fetchImpl })` in `employee-entry.js` registers `<gcsp-employee-entry>`, a launcher-owned light-DOM adapter over the delivered `mountManualJourney`. It loads the existing account/setup styles on employee entry, passes the shared cookie-authorised HTTP adapter, and tears down on navigation. It supplies no identity or scheme policy.

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
| `checkboxField({ id, label, checked, onChange })` | A native checkbox with its label beside it, 24px control and visible focus, for declarations. Returns `{ root, input }`; the caller owns the checked state. Added in `form-controls.js` and `form-controls.css` for FUCQ-108. `labelledField` stacks its label above the control and suits text, select and date controls, not a tick box. |

### GCSP stage list (`blocks/gcsp/kit/stage-list.js`)

Looked at `activityTimeline` (an ordered list, but every row needs a dated event), `factList` (label and value, no order or state) and `metricTile`. None lists named stages in order with a plain state, so `stageList` is new, with its own scoped `stage-list.css` and ratchet cap and pattern.

| Call | Use for |
|---|---|
| `stageList({ heading, stages: [{ name, state }], level, labels })` | An ordered `<ol>` of stage names with a state label: `complete` Done, `waiting` Waiting, `not-started` Not started, `pending` Sending, `failed` Not accepted (default `STAGE_LABELS`). Names and order are the caller's; the kit infers no stage or state, and an unknown state reads "Unknown". The gallery's **GCSP stage list** section shows acknowledged, sending and not-accepted lists. |

`mountManualSetup(root, { adapter, brand, hint, onBack, onSupport, commandId })` and `<gcsp-manual-setup>` compose the employee shell, shared forms and existing heading/button/status/facts/typed terms. Native controls remain mounted through input and asynchronous state updates. The controller supplies permitted choices, source facts and errors. `gcsp-manual-setup.html` loads the authenticated draft directly; `mountManualJourney` connects account journey hints to a fresh trusted setup read and saves valid choices before Back. The bubbling/composed `gcsp:setup-ready` event carries exact mode/old-contract/slot/scheme/draft/context hints after a successful complete save and current availability; it creates no claim.

### GCSP renewal help and case composition (`blocks/gcsp/cases/`)

`mountHelpBody(root, { adapter, signal, commandId, headingLevel })` supplies an embeddable read-only help entry and employee case view; its teardown exposes `refresh()`. `mountHelp` and `<gcsp-help>` add the existing employee shell with the actual account HTTP projection, or body-only composition with `embedded` (h2 by default, standalone h1; hosts may set `headingLevel` or `heading-level`). The default uses the case HTTP adapter; explicit harness fixtures are read-only. The custom element supports an injected adapter before upgrade and disconnect cleanup. `renderCaseContent` composes case owner/reason/action, UTC DemoClock due time, calendar deadline, remedy and dated history for employee and future scheme-team consumers. These are domain page compositions using `el`, `screenIntro`, `button`, `statusScreen`, `factList`, `labelledField` and `errorSummary`; no new kit primitive or competing card/table is introduced. Requests and single-preference changes require separate explicit confirmation and authoritative server readback.

`mountCaseQueue(root, { adapter, embedded, headingLevel, signal, commandId })` / `<gcsp-case-queue>` adds Greg’s operational queue as a body composition. It reuses the existing `dataTable` unchanged, with native labelled sorting and case selection. Opening a case reads the server’s permitted statuses and feasible remedies; editing requires review, explicit confirmation and authoritative queue/options readback. UTC DemoClock timestamps and calendar deadlines remain separately labelled. The teardown exposes `refresh()`; the custom element supports pre-upgrade adapter injection, heading overrides and disconnect cleanup. Register both case elements with `cases/register.js` and load `gcsp-case-queue.css`. [`gcsp-case-queue.html`](gcsp-case-queue.html) defaults to actual HTTP; explicit `?fixture=populated` (or `empty`, `loading`, `unavailable`, `forbidden`, `stale-run`, `unavailable-options`) selects a read-only synthetic preview. No new shared primitive is introduced.

## GCSP presenter controls (`blocks/gcsp/presenter-controls/`)

Component plan: reuse `button`, `factList`, `statusScreen`, `labelledField` and controlled `renderOptionList` for both Scenario and Acting principal; use the shared shell presenter region. Add `presenterBar` because neither the account disclosure nor a status screen combines a compact presenter disclosure with supplied run/clock/principal facts. Authorization, draft selection and command behavior stay with the consumer.

| Component | Use instead |
|---|---|
| `presenterBar({ label = 'Presenter controls', readback = [] })` (`blocks/gcsp/kit/presenter-bar.js`) | Native disclosure plus supplied `factList` rows. Returns `{ root, summary, panel, readback, setReadback(rows) }`. Append consumer actions to `panel`; readback updates preserve disclosure and action identity. Use instead of hand-building a presenter disclosure/readback. |
| `mountPresenterControls(host, { adapter, commandId, navigate })` | Shared presenter strip with a native target field and controlled Scenario/Acting principal radio lists, server-projected policy step/cues/principals, confirmed reset, ordered tick receipts, exact original-command retry and actual-context switch reconciliation. Returns `{ root, refresh, destroy }`. Use instead of per-page presenter actions. |
| `<gcsp-presenter-controls>` / `defineGcspPresenterControls(registry)` | Standard custom element, adapter property, disconnect teardown. Load `presenter-controls/register.js` and the shared shell styles. The parent `.gcsp` supplies Density tokens. |
| `mountPresenterWorkspace(host, options)` | Reads actual server context and mounts the account or Greg HTTP surface. Harness `gcsp-presenter.html`; never selects a principal from URL/fixtures. |

Shared disclosure/readback/compact option styling lives in `kit/presenter-bar.css`, imported by the capped `presenter-controls/presenter-controls.css` through the shell. The kit stylesheet is separately capped, and the presenter-bar pattern rejects new hand-built copies outside its factory. Picker rows rebuild only when the supplied options change; ordinary readbacks use the existing `update({ value, disabled })` handle. Unavailable scenarios stay selectable with missing-capability copy while Reset stays disabled. Groups have explicit accessible labels and retain the shared arrow/Home/End semantics. The GCSP gallery includes a standalone presenterBar and an explicitly isolated pending/missing-release example with both option lists; it makes no release or scenario capability claim. Functional tests: `server/test/gcsp-presenter-controls-render.test.js`, shell/CSP checks and UI ratchet. Browser evidence remains a separate gate.

### GCSP demo restarted (`blocks/gcsp/kit/run-restarted.js`)

Looked at `statusScreen` (title, message and actions, but no copy for a restarted demo or a Reload action) and `button`. Nothing existing says the demo was restarted and offers a reload, so the helper composes both and adds no stylesheet.

| Call | Use for |
|---|---|
| `isRunRestarted(reply)` | True when a server reply has status `stale-run`. Use instead of showing the raw status. |
| `runRestartedScreen({ reload })` | Page-level alert (`statusScreen`): "Demo restarted", the reload message and one primary Reload button. `reload` defaults to following an empty-href link (a full reload; the kit never reads the URL). |
| `runRestartedNotice({ reload })` | Compact inline alert for panels. Returns `{ root, reload }`; `reload` is the Reload button, so callers can move focus to it. Used by presenter controls, which also disable every control and never resend the old command. The gallery's **GCSP demo restarted** section shows both. |

### Manual released-car browser (`blocks/gcsp/manual-gallery/`)

The manual browser composes the employee shell, `screenIntro`, native `labelledField` controls, `matchCard`/`listingsOf`, `mediaWell`, `factList`, typed terms, `statusScreen` and `button`. Series and body filters reuse the shared `renderOptionList` radiogroup as visual chips with car counts and arrow-key roving focus; cards reuse the employee `gcsp-card`, `gcsp-points` and `gcsp-status` classes for the FUCQ-64 cost hierarchy. Each shared card has one exact `orderUuid` member; search, series/body filters, sorting and details read the complete unranked decision set. Fitted, reference and unclassified specification facts remain distinct. This is page composition using the existing decision-card contract.

The single gallery's **Manual released-car cards** section shows explicit synthetic eligible/ineligible/long-name examples with disabled Review actions. The linked `gcsp-manual-gallery.html?fixture=available` harness is also read-only; the default harness uses the authenticated HTTP adapter. Only an explicit live Review action may issue a claim, using the server-issued exact input. Current authoritative readback precedes `onClaimConfirmed` and bubbling/composed `gcsp:manual-claim-confirmed`; their shared detail is specified in `docs/gcsp/manual-gallery-contract.md`. Existing or uncertain claims block another attempt. The claim controller owns no policy, release, contact editing or review-phase transition.

### GCSP offer consumer (`blocks/gcsp/offer/`)

`mountOffer(root, adapter)` and `<gcsp-offer>` compose the existing portal shell, exact-member `matchCard`, `mediaWell`, `factList`, heading and buttons. `createOfferView` lays out the exact offer beside the authorised current-car projection, stacked on narrow screens. `createOfferController` receives explicit authoritative read and optional decision ports; absent authority disables actions. DemoClock readback controls the countdown and deadline reread; no browser wall clock decides expiry. The controller and element clean up pending reads and presenter subscriptions on disconnect.

The optional `adapter.followup = { loadAccount, mount }` composes a trusted follow-up body inside the declined offer using an exact verified read handle. A fresh employee account load gates the mount; `mount(body, { decisionId, signal })` returns a teardown function. Missing authority shows concise unavailable text and the existing refresh button. Normal polls preserve the child controls; changed entry, explicit refresh and disconnect dispose them. This reuses headings, `el`, note/status text and buttons without a new kit primitive or stylesheet. See the [authored follow-up contract](docs/gcsp/evidence/fucq105/followup-entry-plan.md); execution and real session integration remain outstanding.

FUCQ-108 adds to the offer: a **Before you accept** group (`factList` for contact and the car to return, the fictional terms wording, one `checkboxField` per server declaration) and, once accepted, a **Your selection** `stageList` of the server's stage names. Accept stays disabled until every declaration is ticked, and is absent when the handoff has a blocker; it sends the server `termsDigest` and declaration ids. The headline follows `selectionState` and never says approved. Preview: `?fixture=` `handoff-replacement`, `handoff-blocked`, `selection-hr`, `selection-no-hr`, `selection-pending`, `selection-failed`. Otherwise this is page composition from existing kit pieces. `gcsp-offer.css` contains only the consumer layout and has its own additive ratchet cap. The [owned preview](blocks/gcsp/offer/preview.html) accepts named `?fixture=` presentation examples with no real decisions; it is not live producer/access evidence. The [offer view contract and delivery gates](docs/gcsp/offer-view-contract.md) retain the access, decision, host and rendered/full validation requirements.

### Claimed-car review consumer (`blocks/gcsp/manual-review/`)

`mountManualReview(root, options)` composes the employee shell; `mountManualReviewBody(main, options)` embeds the same form in an existing shell. `<gcsp-manual-review>` uses the same HTTP adapter. Reuse: `matchCard` with a pinned quote display and no claim actions; `screenIntro`, `button`, `statusScreen`, `factList`, `labelledField` and `errorSummary`. No new shared primitive. Native controls remain mounted through edits and checks. Contact, policy-bounded special requirements and replacement-only return mileage are independent of the quoted draft. Requested collection and the old contract stay visible. `manual-review.css` is composition only and has its own ratchet cap.

The host passes one gallery-confirmed handoff, subscribes to one callback or event, and connects presenter clock updates via `subscribeClock(refresh)` (return an unsubscribe function). A fresh authoritative read is required on mount and every refresh. The numeric countdown stays outside the live region; low-time and expiry announcements are separate. Back/change/cancel release independently of validation. Navigation requires confirmed current readback. Details and exact host integration are in [the review UI contract](docs/gcsp/manual-review-ui-contract.md). DOM checks cover the component boundary; actual desktop/320px/keyboard and producer integration remain separate acceptance gates.

## Manual final review and order outcome (`blocks/gcsp/manual-summary/`)

`mountManualSummary(root, options)` composes the employee shell; `mountManualSummaryBody(main, options)` embeds the same screen; `<gcsp-manual-summary>` uses the same HTTP adapter. One screen holds the readback and declarations before Submit, and the confirmation after it; reopening shows whichever the server holds.

**Component plan.** Reuse: `screenIntro`, `button`, `statusScreen`, `factList`, `matchCard` with the review's `reviewVehicleView`, `checkboxField`, `errorSummary`, `stageList`, `.gcsp-card` and `.gcsp-note`, `mountEmployee`, and the review controller for claim reads, countdown and release (no second claim state machine). Extend: nothing in the kit. New: no kit primitive. The sections are page composition, so `manual-summary.css` is composition only (including `@media print`) and has its own ratchet cap.

Copy comes from maps in `summary-model.js` (relationship, licence category, stage names); a field with no human label is omitted, never shown as an id. Required inputs read "Required"; absent historic values read "Not recorded". Terms wording is server text and is labelled synthetic. The outcome shows the returned state only, never "approved". Controls carry `gcsp-print-hidden`; Print calls `window.print`. Edit actions: contact or requirements returns to the review with the claim kept; car and order choices release the claim first. The host connects `subscribeClock(refresh)` as for the review.
