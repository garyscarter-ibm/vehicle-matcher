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
| `matchCard(match, { big, compact, brand, showScore, showPaint, rejectOptions, rejectLabel, rejectPrompt, onListingSelect })` | Every result car card (used by questionnaire, podium, guess-who). `big` adds reasons, `compact` is the carousel tile, `showScore: false` for hard-filter modes. Each optional `rejectOptions` item is `{ label, scope?, apply }`; `scope` is shown under its reason button. `onListingSelect(listing)` optionally updates surrounding claims after a native picker selection. Use instead of building a card by hand. |
| `feedbackScope({ text })` / `feedbackUndo({ text, onUndo })` | Shared scope note and named, keyboard-accessible undo button, using the existing `vm-brief` and `vm-brief-undo` styles. Use for local browse feedback and reversible fixture examples. |
| `feedbackButton({ text, variant, onClick })` | A labelled primary or ghost button for a feedback action such as resetting a local search or confirming a fixture proposal. |
| `previewTile(match)` | The small live-preview strip tile (photo or placeholder, name, score, one spec line, link to listing). |
| `mediaWell(car, extraClass, { placeholder })` | The photo well with the "Images coming soon" fallback (`placeholder` replaces that text, e.g. GCSP's "No image for this car yet"). Use instead of a bare `<img>` for a car. Returns `{ media, showPhoto }`. |
| `distanceLabel(distance)` / `listingsOf(match)` | "18.1 miles away" text; the listings behind a match (one or N). |
| `SPEC_LABELS`, `FUEL_SPEC`, `GEARBOX_SPEC`, `SWATCH_HEX`, `CONCEPT_LABELS`, `KIT_SHOWN` | Label and colour lookups for spec lines, paint swatches and concepts. Use instead of local maps. |

`matchCard` paints the selected listing's price, photo, equipment, gearbox, link and server-supplied `decision` together. Each decision contains `score`, `stretch`, `reasons` and `tradeOffs` (with optional internal `fit`/`taste`). Group count, price spread and feature availability remain aggregate; fitted equipment uses only the selected listing. Native listing buttons retain focus and pressed state when switching. `mediaWell.showPhoto(src, selectedCar?)` also updates image text for the selected car.

The questionnaire uses `onListingSelect` to replace representative-level ranking claims with **Your selected listings.** while any card shows another member. Its representative lede, scoped notice and ranking working are hidden until all cards return to their original members. Cards remain mounted so picker focus is preserved.

On an older compatible backend, the first representative can use existing top-level fields. Switching or refining to another member without its decision suppresses unsupported scores and explanations and states that they are unavailable. The client never recreates scoring weights. The gallery's **Exact listing decisions** fixture exercises R1's £30k / 96% versus £39k / 87% stretch, long names, absent images, equipment refinement, old-backend fallback and reset alongside the existing feedback/undo examples.

## Questions and answers (`modes/question-ui.js`)

| Call | Use for |
|---|---|
| `renderOptionList(q, answers, { onChange, onPick })` | Single- or multi-select option list for a question. `onPick` fires after a single-select tap (after `onChange`). Returns `{ list, selected }`. |
| `renderRangeSlider(list, q, answers, { onChange })` | Dual-handle range slider for a range question; persists the starting value immediately. |
| `visibleQuestions(questions, answers)` / `isVisible(q, answers)` | Apply conditional-question predicates (`SHOW_IF`) so hidden questions are skipped. |
| `formatSliderValue(value, q)` / `formatRange([lo, hi], q)` | Slider readouts in the question's unit. |

## Live preview (`modes/preview-feed.js`)

| Call | Use for |
|---|---|
| `createPreviewFeed({ api, retailer, brand, scope, group })` | Debounced, stale-safe preview fetch: `schedule(answers, onResult)` and `cancel()`. Use instead of hand-rolled timers around `apiPreview`. `PREVIEW_DEBOUNCE_MS` is exported. |

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

## Not yet in the kit

Hand-built in several modes (file counts at the time of writing):

- **Screen heading block** (`vm-kicker` / `vm-title` / `vm-lede`): 5 files, 43 occurrences. `screenIntro` now exists in `ui.js`; retail modes have not migrated yet.
- **Primary and ghost buttons** (`vm-btn vm-btn-primary|ghost`): 5 files, 27 occurrences. `button` now exists in `ui.js`; retail modes have not migrated yet.
- **Skeleton blocks** (`vm-skel ...`): 5 files, 28 occurrences. Should become `skeleton(kind)` and per-screen `loadingScreen()`.
- **Status screen shell** (`vm-screen vm-status`, used for error, empty-pool and no-match): 5 files, 7 occurrences. `statusScreen` now exists in `ui.js`; retail modes have not migrated yet.
- **Spec pills** (`vm-mingle-pill`, fuel, body, shade): 2 files, 10 occurrences. Should become `specPills(car)`.
- **Mingle card media and body** (`vm-mingle-card-*`, duplicated between swipe and head-to-head): 2 files, 12 occurrences. Should become `miniCarCard(car)`.
- **Single-value slider** (`vm-slider-input`, duplicated in questionnaire and podium instead of a kit option on `renderRangeSlider`): 2 files, 2 occurrences. Should become a `single` option on `renderRangeSlider`.

## The ratchet

Test: `server/test/ui-ratchet.test.js`, config and baseline in `server/test/ui-ratchet.json`; it runs in `npm test`. After moving a view onto the kit, run `node server/test/ui-ratchet.test.js --write` to lower the baseline (only ever commit it lower). `node server/test/ui-ratchet.test.js --debt` lists what is outstanding. `vehicle-matcher.css` and the four GCSP stylesheets (`blocks/gcsp/shell/`, `blocks/gcsp/employee/gcsp-employee.css` and `blocks/gcsp/presenter/gcsp-presenter.css`) are capped at their current length (`stylesheets` in the config); `blocks/gcsp/` is a scanned root.
