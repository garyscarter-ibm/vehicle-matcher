# Components

## GCSP Angular migration — 13 November 2026

This catalogue describes existing shared primitives and remains the reuse baseline. The [agreed GCSP target](docs/design/migration-decisions-2026-11-13.md) uses **Angular 21** in `apps/gcsp-web/`, owning screens/routing rather than permanently wrapping legacy screen controllers. Adapt compatible primitives, styling and semantic tokens at the first consuming Story; keep reusable Angular pieces shared within the new app and catalogue them here as they are built. Preserve existing Used Cars imports and behavior. The vanilla/no-build description below applies to the existing retail kit, not the Angular application. Extend gallery/ratchet coverage to actual Angular paths and retain rendered/browser evidence under the [experience contract](docs/gcsp/experience-quality.md).

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
| `statusScreen({ kicker, title, message, actions, role = 'status', level = 2 })` | Error, empty or no-match shell (`vm-screen vm-status`). A null `role` leaves it plain content when the view's own status line speaks. `actions` are nodes; the title is an `h<level>`, so a page whose whole state is the screen can make it the h1. Retail modes have not migrated yet. |
| `factList(rows, { className, hideMissing })` | `<dl>` of `{ label, value, unit, missingLabel }` rows. A null or undefined value reads "Not supplied" (or `missingLabel`) with the `is-missing` class, never "undefined" or blank. `className: 'vm-facts-pair'` (FUCQ-275) keeps two equal columns at narrow width (the default fits as many 150 px columns as the width allows, so one at 375 px); long values wrap. `matchCard`'s explicit view takes it as `factsClass`. Gallery: **factList: two columns at narrow width**. `hideMissing` (FUCQ-277, a line of text such as "More details not supplied") drops the missing rows and shows that line once beneath the supplied ones; with any row dropped the result is a `div.vm-facts-wrap` holding the `<dl>` (omitted if every row is missing) and a `p.vm-facts-more`, with none dropped it is the plain `<dl>`. The manual released-car cards use it inside their closed "Car facts" disclosure. |

## Result cards (`modes/result-card.js`)

| Call | Use for |
|---|---|
| `matchCard(match, { big, compact, brand, showScore, showPaint, rejectOptions, rejectLabel, rejectPrompt, onListingSelect, view, onAction, scoreLabel, headingLevel, hideMissing })` | Every result car card (used by questionnaire, podium, guess-who). With `view`, `headingLevel` (2 to 4, default 3) sets the car name's heading so a page outline never skips a level (FUCQ-286: the offer page passes 2). `big` adds reasons, `compact` is the carousel tile, `showScore: false` for hard-filter modes. With `view`, `scoreLabel` (a string, `{ text, title }` or `null`) replaces the percentage badge (`null` hides it); unset keeps the percentage. Each optional `rejectOptions` item is `{ label, scope?, apply }`; `scope` is shown under its reason button. `onListingSelect(listing)` optionally updates surrounding claims after a native picker selection. `hideMissing` (a line of text; view path only, FUCQ-316) is passed to `factList`, so missing facts collapse into that one line; unset keeps the unknown rows. Use instead of building a card by hand. |
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

`formatPointsCost(term)` (same file) reads the same `points-monthly` term as current cost / budget: "1,100 / 1,300 points per month". A missing side is named ("1,100 points per month · budget not supplied", "Cost not supplied · 1,300 points per month budget"), neither is "Not supplied", zero is a real amount, and any other kind is "Not supplied". Callers pass only authoritative amounts and never borrow another scheme's allowance. The optional `formatPointsCost(term, { compact: true })` omits the unit text when the fact label already says **Points per month**; missing sides and zero remain explicit. Gallery: **factList: Points cost from formatPointsCost**.

Each action is `{ id, kind, label, variant?, disabled?, disabledReason?, scope? }`. `onAction(action, exactMember)` owns its effect. Accept/reserve actions fail closed unless the selected exact decision is eligible, even if callers set `disabled: false`; missing callbacks also disable actions. `onListingSelect(exactMember)` runs after a picker swap updates every owned display field; native picker nodes stay mounted for keyboard focus. The kit stores no brief/offer state and performs no requests. Feedback actions can reuse `feedbackScope` and `feedbackUndo` in the caller.

GCSP offer, activity and claimed-car review layouts (including final review/outcome) fill a 16:9 image area with proportion-preserving cover cropping and place its caption below it, using the shared GCSP kit layer. Review order tags occupy a separate wrapping strip below the image; offer/activity badges keep their top placement. Empty badges are hidden across GCSP media wells. Absent or broken images retain the 16:9 fallback frame, with separate space for the review placeholder and order tag. Gallery: **mediaWell: selected review image and missing-photo frame**, with a long order tag and caption.

`mediaWell(car, 'gcsp-media-whole')` (`vehicle-media.css`) fills the allocated frame using `object-fit: cover`: the image preserves its proportions and crops at the edges rather than leaving gaps, and a missing or broken photo keeps a readable 16:9 frame. Use it for Account's current car and gallery feature images; it grows with the surrounding panel and keeps a 16:9 frame when stacked. Gary's 11 November 2026 direction supersedes the previous intrinsic-ratio presentation. Gallery features, thumbnails, the enlarged viewer and notification images also use cover cropping. Gallery: **mediaWell: car fills its frame**.

Shared explicit-card styles live in `decision-card.css`, imported by the existing kit stylesheet and expressed through kit tokens and scoped GCSP status tokens. The single `components.html` gallery's **Employee decision card** demonstrates long names, brand imagery with no caption, absent imagery and facts, exact eligible/ineligible/confirmation-needed decisions, monthly points against allowance, local callback selection/feedback/undo and disabled Reserve with its visible reason. Loading, no-match and unknown examples use `statusScreen`. The browser-safe `employee-card-fixture.js` snapshot is recomputed by `server/test/helpers/shared-kit-fixture.js` using FUCQ-29 and canonical `PolicyService`; `shared-kit-contracts.test.js` requires exact equality, including provenance. Regenerate the snapshot through that helper after policy changes, never edit independent active rules into the gallery. Approved body reference: `docs/gcsp/evidence/fucq-6/README.md`, revision `a7fc178` (Gary, 5 November).

## Questions and answers (`modes/question-ui.js`)

| Call | Use for |
|---|---|
| `renderOptionList(q, answers, { onChange, onPick, value, onValueChange, disabled, ariaLabel, variant })` | Single- or multi-select option list for a question. `onPick` fires after a single-select tap (after `onChange`). `variant: 'rows'` uses the shared GCSP fixed radio rows, retaining its controlled value and arrow/Home/End behaviour. Returns `{ list, selected, update }`. |
| `renderRangeSlider(list, q, answers, { onChange, single, value, onValueChange, unit, valueState, unknownText, disabled, ariaLabel })` | Dual-handle range by default, `single: true` for one position or importance axis. Legacy path persists the starting value immediately without invoking `onChange`; subsequent input invokes it. |
| `visibleQuestions(questions, answers, { predicate })` / `isVisible(q, answers, { predicate })` | Apply conditional-question predicates (`SHOW_IF`) so hidden questions are skipped. |
| `formatSliderValue(value, q, { unit, valueState, unknownText })` / `formatRange([lo, hi], q, options)` | Slider readouts in the question's unit. |

The presence of `value` or `onValueChange` selects callback ownership: `answers` may be `null`, no defaults or changes are written to it, and mounting emits no callback. On input, `onValueChange(nextValue)` receives a scalar or a fresh selected-value array; the caller owns its draft and any rerender. Native controls update their displayed value locally. `onPick()` follows a single selection's value callback. Without either explicit option, the existing answer keys, multi-select `any`/max behavior, range defaults and `onChange` then `onPick` order remain intact. `predicate(q, answers)` optionally owns visibility; otherwise existing `SHOW_IF` predicates apply.

Single sliders use `ariaLabel` (or the question label/id); dual sliders label minimum and maximum separately. `unit` accepts the existing suffix string or an explicit `{ kind: 'points-monthly' }`, `{ kind: 'percent' }` or `{ kind: 'purchase-money', currency: 'GBP' }` descriptor. Typed points always print points a month. A GBP question cannot be relabelled with points. Unknown/nonfinite values read `Not supplied` (or the caller's `unknownText`, e.g. the brief's `Not set`); `valueState: 'unconfirmed'` qualifies a supplied value, while a confirmed zero remains zero. `disabled` controls native disabled state. Indifference is an explicit option control owned by the caller, separate from importance zero or missing preference. The gallery demonstrates all three controls without implying that they recalculate its saved display snapshot. Shared native-control styles live in `question-controls.css`. Extension (FUCQ-290): a single slider (`vm-slider-single`) now shows a 2px `--vm-ink-strong` outline on the track and a two-ring thumb shadow on `:focus-visible` (WebKit and Firefox thumbs), replacing the faint blue thumb shadow; the gallery's Preference, importance and indifference sliders show it when tabbed to.

Single sliders now return `{ update({ value?, valueState?, disabled? }) }`. Option lists retain their original `{ list, selected }` and add `update({ value?, disabled? })`; the returned selected Set stays the same object. Updates project only supplied presentation into the existing native controls and ARIA/readouts, never write `answers`, emit callbacks or choose a default. A single slider's unknown/null projection keeps its physical thumb position while its readout says `Not supplied`. Callback-owned mounts still emit nothing. Single-choice radio groups have one tab stop, arrow wrapping and Home/End selection with disabled choices skipped; the native buttons retain Enter/Space activation. Multi-select checkbox buttons keep separate tab stops and their existing any/max semantics. The gallery's **Project unknown display** and **Restore local display** demonstrate update projection without changing local draft answers or its unchanged decision snapshot.

## Live preview (`modes/preview-feed.js`)

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
| `portalShell({ title, account, navigation, accountMenu, active, breadcrumbs, onNavigate, onRetryAccount, accountFailure, signOut, sessionAdapter, navigate, reload })` | The slim branded header with locally packaged BMW GROUP/BMW/MINI Density artwork, account signed-out/loading/ready/unavailable-with-Retry states, `<nav aria-label="Portal">`, optional breadcrumbs (rendered only when the trail has two or more items, so a one-item trail that repeats the h1 is dropped; `setBreadcrumbs` keeps working), skip link and `<main>`. Ready accounts use a compact single-row native disclosure with full name/email/context inside and Sign out; Escape closes it and returns focus. Sign out uses a same-origin POST through the session adapter, disables repeat requests, preserves the account with accessible retry feedback on failure, and clears visible identity/content before full navigation to `/gcsp/login` after revocation. `signOut: false` omits the action for read-only fixtures; `sessionAdapter: { signOut }` and `navigate(path)` are injectable. The signed-out state is quiet and has no account actions. Live shells clear account/content on a cross-tab session-change marker and reload through the server guard. `pagehide` clears identity before a history snapshot; a persisted `pageshow` reloads before exposing content. Late account responses cannot repaint a cleared shell. `reload()` is injectable; `signOut: false` also excludes fixtures from this lifecycle. Sign-in and sign-out publish only an opaque localStorage change marker, without credentials or profile data. Unavailable accounts show a short status with the full message available to assistive technology and in the tooltip. `accountFailure: 'page'` keeps the header quiet on a failed read instead, for a page whose body says it once with its own action; `mountEmployee` passes it through and gives `renderBody` a `refresh` that re-reads the account. Your cars, Your preferences, Buddy activity, Order progress, Manual setup, the offer follow-up and the representative fixtures use it. No presenter controls: the console lives on its own page (FUCQ-360/361). Returns `{ root, main, setAccount, setActive, setBreadcrumbs, destroy }`. |
| `accountIdentity(account)` / `createContextHttpAdapter({ fetch, baseURL })` (`shell/account-runtime.js`) | Shared durable profile projection for account and session context consumers. Preserves the server name and email for the account menu. The context adapter reads `/api/gcsp/context` with same-origin credentials and no cache, passing access and restarted states through to the shell. Live Greg composition injects this loader; explicit fixture adapters supply their own profile and `signOut: false`. |
| `accountNavigation({ items, active, expanded, onNavigate, onToggle })` | Narrow icon sidebar with a label toggle. Selected items use pale cyan, teal text/icon and a teal left edge, following the supplied GCSP shell. Unavailable items are disabled buttons with a visible reason, never dead links. Used inside `portalShell`. `setItems(items)` updates destinations while preserving the rail and its expanded state. Trusted ready `greg` accounts receive the Employee car ordering icon. Accounts with both `greg` and `employee` roles receive Your cars, Buddy activity, Order progress and Employee car ordering from either entry point; single-role employees retain their existing rail. An ordering dashboard with unknown identity shows no role-specific destinations. |
| `svgIcon(paths)` | Decorative inline SVG icon built with `createElementNS`. |
| `mountEmployee(root, ctx)` / `<gcsp-employee>` (`blocks/gcsp/employee/gcsp-employee.js`) | The employee entry. Contract in [docs/gcsp/employee-entry-contract.md](docs/gcsp/employee-entry-contract.md). |
| `PORTAL_NAVIGATION`, `PORTAL_ROUTES`, `routePortal`, `routePortalEvents`, `routeAfterRelease` (`blocks/gcsp/employee/portal-navigation.js`) | The one Paula rail and its routes, dependency-free. See **One Paula rail** below. |
| `ACCOUNT_MENU`, `routeAccountMenu` (`blocks/gcsp/employee/portal-navigation.js`) | Account menu shortcut (Renewal help) shown above Sign out. `portalShell({ accountMenu })` renders them as plain menu links (`.gcsp-account-link`, styled in `account-menu.css`), closes the disclosure and calls `onNavigate(key)`. `mountEmployee` passes `ACCOUNT_MENU` unless `ctx.accountMenu === false`; the offer page gets it from `signedInPortal`. Extended for the demo flow review, 10 November 2026: reuse of the existing disclosure, no new primitive. |

**One Paula rail (FUCQ-284).** Every Paula page shows the same two working items in this order: Your cars, Order progress (`PORTAL_NAVIGATION`, also exported as `EMPLOYEE_NAVIGATION`). The old disabled placeholders (New order, Order history, Drivers and licences, Scheme guidelines) are gone from the Paula rail because they were not journey destinations; `accountNavigation` still renders `available: false` items for other personas and the gallery. `mountEmployee` always uses this list: pages no longer pass `navigation`. A page whose view is not in the rail (renewal help, the next offer) passes `viewLabel` for its crumb and shows no current item. A rail click on another item goes to `ctx.onNavigate(key)` when the host gave one, otherwise to `PORTAL_ROUTES[key]` through `ctx.location` (default `window.location`). Live hosts that handle `gcsp:navigate` call `routePortalEvents(host, location)` so both rail keys route; the manual review and summary pages release their reservation first (`routeAfterRelease`) and route only once it is released. Buddy navigation was removed for FUCQ-397; its activity route, standalone page and source remain available to existing shortcuts. Preferences navigation was removed on 11 November 2026; the retained `brief` shortcut leads to `Your cars#gcsp-account-preferences`. The standalone preference page and editor remain in code. Pinned by `server/test/gcsp-shell-navigation.test.js`.

**One content inset (FUCQ-284).** The shell owns the page's left edge: `--gcsp-content-inset` on `.gcsp-content` (24px, 72px from 900px wide, 16px at 600px and under; [`shell-inset.css`](blocks/gcsp/shell/shell-inset.css)) pads the crumbs and `<main>`, so the page h1 starts at one x on every page at each width. A page root (a `.vm` that is a direct child of `.gcsp-main`, or sits in one bare wrapper div) adds no horizontal padding or centring of its own; `.vm` blocks nested in cards keep theirs. The shell crumb is the only location label above the h1: a `vm-kicker` placed right before the page h1 inside `.gcsp-main` is not shown, so pages do not repeat it. Pinned by `server/test/gcsp-shell-inset.test.js` and measured in `docs/gcsp/evidence/fucq-284/`.

Gallery: the single gallery ([`components.html`](components.html)) now has a **GCSP** section with the four primitives, the `mediaWell` GCSP placeholder, `portalShell` in loading, compact ready (long name), open account-details and unavailable states, and `accountNavigation` collapsed and expanded with the reference's pale selected treatment. Embedded shell frames contain account panels to their own width; frames up to 360px give the unavailable status and Retry a full header row. These gallery-only container rules preserve the desktop panel size and shared live shell styles. [Shell refinement and evidence](docs/gcsp/density/gcsp-shell-refinement.md); [artwork provenance](docs/gcsp/density/evidence/shell-logo-provenance.json).

The shared account disclosure and session controls use `blocks/gcsp/shell/account-menu.css`, imported by the shell. The Angular `/gcsp/sign-in` route owns the sign-in screen. The shell stylesheet is capped by the UI ratchet.

The representative employee body (`blocks/gcsp/employee/representative-body.js`, styles in `gcsp-employee.css`) is page composition from kit primitives and `gcsp-*` classes, not a kit card. It builds no competing car card: FUCQ-31 owns the shared decision-card and control contract, and the body adopts it when that lands.

## GCSP presenter outbox (`blocks/gcsp/presenter/`)

Looked at: `el`, `button`, `screenIntro`, `statusScreen`, `factList` (all reused here), the retail result cards and `portalShell`. No kit component lists messages with a detail pane, so `messageList` is new.

| Call | Use for |
|---|---|
| `messageList({ messages, selectedId, onSelect, label })` (`message-list.js`) | Rows (real buttons, `aria-current` on the open one; the newest email opens by default, and with none the detail pane is hidden) and a detail pane: heading that takes focus, one line of To, status and time, the offer link as an outline button, the email, then closed "Plain-text version" and "Delivery attempts" disclosures. Earlier wording: facts, the HTML body in a sandboxed `srcdoc` iframe, the plain-text alternative and a safe `target=_blank rel=noopener` offer link. A sent message whose `transport` is `captured` is labelled "Captured, not sent". Unrendered messages show the status explanation. Returns `{ root, select, update, getSelected, destroy }`. |

Gallery: the GCSP section of [`components.html`](components.html) shows `messageList` with sent, retrying and failed messages.

## GCSP Greg dashboard (`blocks/gcsp/greg/`, kit in `blocks/gcsp/kit/`)

Looked at: `el`, `screenIntro`, `button`, `statusScreen` and `factList` (all reused: heading, Refresh/Retry, states and the meta strip), `portalShell` (the shell), the employee `gcsp-card` and the retail `matchCard`. None draws a dense figure tile or a data table, and the employee cards are image-led, so `metricTile` and `dataTable` are new. They live in GCSP-scoped kit files (`blocks/gcsp/kit/gcsp-kit.css`, every selector `.gcsp`, tokens only), not in `ui.js` or `tokens.css`. Counts are `{ label, isBand, fewerThan }` from the server demand projection; a band shows plain "<5" (FUCQ-293: no dashed box, no suffix) and nothing is derived from it.

| Call | Use for |
|---|---|
| `metricTile({ label, count: { label, isBand, fewerThan }, note, level })` (`metric-tile.js`) | One labelled figure. `level` is `headline`, `standard` or `compact`. A band with a finite `fewerThan` shows plain "<N" (`aria-hidden`) with its label as visually hidden text, so a screen reader says "fewer than N" once; a band without `fewerThan` shows its label alone. Both keep `is-band` and `data-band`. A missing count reads "Not supplied". |
| `dataTable({ caption, columns: [{ key, label, numeric, detail }], rows, emptyText, id, stack, compare, rowAction })` (`data-table.js`) | A real `<table>` with `<caption>`, `th scope="col"`, first cell `th scope="row"`, right-aligned tabular numeric columns and band cells marked like tiles, inside a `role="region"` `tabindex="0"` scroll area labelled by the caption. No rows shows one `emptyText` row. Cells are strings, numbers, `{ label, isBand, fewerThan }` (a band draws as plain "<N", like a tile) or `{ label, emphasis: true, tone: 'success' }` (drawn in `<strong>`, so a changed value is bold as well as signed in text; `tone: 'success'` adds `--gcsp-success`, used for "Current car" in the account history). `rowAction: { header = 'Action', label = 'Open', name(row, i), onSelect(row, i), disabled }` (FUCQ-297) adds a last column with one ghost button per row; `name` gives the accessible name that includes the row ("Open case for Paula"; it is also the button's `data-focus-key`, so a quiet repaint refocuses that row's button), `disabled` is a boolean or a per-row function, and stacked rows show the button without a label line. `stack: true` (FUCQ-235) keeps the table at wider widths and, under 640 px, shows each row as its row header over labelled value lines (cells carry `data-label`; explicit table roles keep the semantics; a label keeps at least `min(6em, 40%)` so a long value cannot squeeze it, FUCQ-261). `compare: true` (FUCQ-275, the comparison variant) keeps row header, value and value as three columns at any width, never stacked (fixed layout, long values wrap); a column's `detail` is a second line under its label naming what it describes (a car), hidden under 640 px so headers stay short on a phone (FUCQ-318), and `{ label, missing: true }` cells read as missing (`is-missing`). Its styles are `blocks/gcsp/kit/data-table-compare.css` (imports `gcsp-kit.css`; capped in the ratchet). The offer's "Compared with your current car" table uses it for "This offer" beside "Your current car", with the same rows in the same order for both. |

Gallery: the **GCSP Greg kit** section of [`components.html`](components.html) shows `metricTile` exact, band and with a note, and `dataTable` with a long model name, a band cell, emphasised changed cells, the stacked option (`stack`, under 640 px), the comparison variant (`compare`) and the empty state. The ratchet also caps `blocks/gcsp/kit/gcsp-kit.css`.

## GCSP Greg order plan (`blocks/gcsp/greg/plan/`)

`mountGregOrderPlan(root, { adapter, signal, onSubmitted, commandId })` (adapter from `planFixtureAdapter` or the plan HTTP adapter) shows Greg's next order: the action first, versions, proposed quantities, coverage and risk tiles, unmet needs, binding constraints, alternatives, a limits editor, a labelled preview, and a separate "Request N vehicles from Production" button. Looked at: nothing existing draws a plan, so it composes `el`, `screenIntro`, `button`, `statusScreen`, `factList`, `metricTile`, `dataTable`, `labelledField`, `errorSummary` and `renderRangeSlider` (single). It adds no new kit primitive. The Angular `/gcsp/greg/plan` route owns the live screen; this panel stays for the component gallery.

`plan.css` is `.gcsp` scoped, uses tokens only and has its own cap in `server/test/ui-ratchet.json` (32 lines). No JavaScript pattern debt was added. Gallery: the **Greg order plan** section of [`components.html`](components.html) shows ready, preview, infeasible and stale.

**Next order after a request (FUCQ-290).** Reused, none new: `presenterBar({ label: 'Change limits' })` is the closed disclosure for the limits editor (its summary carries the old heading id; the panel opens it for a limit error and keeps it open across a refresh), `screenIntro` (with `lede` for the plan's own line), and `button`. After a request the headline reads "N vehicles requested from Production" (N from the submission's requests) with one notice and a link to `#gcsp-order-requests`, the id of the dashboard's Order requests region; the status line and the disabled button's note are left empty. Binding constraints leave out every `:min` row whose detail is "Quantity meets minimum 0." and the table when none remain. Preview, Back, Request and a refresh asked for by `teardown.orderPlan.refresh({ focus: true })` (the workspace sends it only after Save production response) focus the new headline or the Replanned notice; an ordinary refresh never moves focus. 

**Synthetic-trained model beside the plan (FUCQ-123).** One section after the baseline sections, from the response's `learned` field: reuse `dataTable` (the comparison, in its own keyboard-scrollable region), `metricTile` (held-out log loss, Brier score and choice count), `factList` (evaluation label, short artifact id, activation policy, training data) and `gcsp-plan-list` (limitations); extend `dataTable` with `{ label, emphasis: true }` cells so a changed row is bold as well as signed ("+1", "-2", "No change"); nothing new. FUCQ-235 extends `dataTable` with `stack` so the comparison stacks into labelled rows under 640 px instead of scrolling. A fallback or unavailable result shows the server's limitation (and any coverage lists) as plain notes, with no table or figures. The section has no button: only the recommended plan is requested. It adds one `plan.css` rule (numeric table headers may wrap, so the comparison fits narrow widths), inside the existing cap. Gallery states: `learned` and `learned-coverage`; the no-active-model fallback is `ready`.

## GCSP Greg route comparison (`blocks/gcsp/greg/comparison/`)

`mountGregComparison(root, { adapter, signal })` (default the HTTP adapter) shows the stored process comparison: today's release route and the buddy route per measure with mean and range across seeds, the difference, a plain verdict, the always-visible fit caveat, what the replay leaves out, and a closed `<details>` with assumptions and provenance. Looked at: `metricTile` (one figure), `dataTable` (assumptions, reused) and the new `rangeBar` (the bars, reused), so it composes `el`, `screenIntro`, `button`, `statusScreen`, `factList`, `dataTable` and `rangeBar` and adds no kit primitive. The stored values are only formatted, never computed. A one-sentence **headline** (a lead paragraph, no heading) opens the process body from the stored `acceptableCoverage` verdict, both means and the seed count, falling back to counted verdicts when coverage is missing (FUCQ-295). Car time reads in hours when every figure in its pair is under one car-day, else in days; the what-if change and the assumptions table show a plain **Setting** label from `PARAMETER_LABELS`, with the raw key kept in its own column.

**Experiments and hold rerun (FUCQ-176).** When the adapter has `loadAll` (the live HTTP adapter does) the panel adds an **Experiment** picker (`renderOptionList`, one controlled radio list: process only, order mix, points, hold duration, each with "stored <time>" or "not run yet") and shows the chosen stored result: process-only as above, a what-if as its change facts (`factList`), the always-visible fit caveat, one section per route with a `rangeBar` per measure (today's value first, then each tried value) and a difference and plain verdict per tried value, and the same closed `<details>`. An experiment with no result says the presenter prepares it before the demo, with no command on screen; the hold sweep also shows a rerun form (`labelledField`, `errorSummary`, `button`) that checks shape, sends whole seconds through the worker-start route, and shows a run strip (`role="status"`, native `<progress>` with the server's seeds and steps) while the previous result stays labelled. A new result shows only after `loadResult` returns the job's `resultId`; a failed or stopped job shows its reason and no result. Policy values and bounds come from the stored result, never client literals. No new kit primitive. Styles: `experiments.css` (`.gcsp` scoped, imported by `comparison.css`, cap 20 lines in `server/test/ui-ratchet.json`). Options: `pollMs` (default 2000). Fixtures: `experiments-ready` and the other names in `EXPERIMENT_FIXTURE_NAMES`.

The Angular `/gcsp/comparison` route owns the live screen; the panel's HTTP adapter reads `GET /api/gcsp/comparison/process/latest`. States: loading, ready, empty (preparation command, Reload), older policy version, unavailable (Retry), refused and access lapsed. No verdict has its own colour or weight. Reload is a native button that keeps focus; `<summary>` has a visible focus outline; no inline script, handler or `eval`.

`comparison.css` is `.gcsp` scoped, uses tokens only and has its own cap in `server/test/ui-ratchet.json` (31 lines). Gallery: the **Greg route comparison** section of [`components.html`](components.html).

## GCSP renewal cases and presenter workspace

The adopted publication view composes `screenIntro`, `button`, `statusScreen`, `factList`, `dataTable` and the shared labelled fields/error summary. It introduces no new shared primitive. Its styles use the existing GCSP tokens and have an explicit ratchet cap.

| Call | Use for |
|---|---|
| `mountGregPublish(root, options)` (`blocks/gcsp/greg/publish/panel.js`) | Server-projected policy values, preview and explicit publication of the reviewed changes, with held-offer readback. Its gallery adapter supplies synthetic component states only. Plain labels come from `policy.displayLabels.v1`; provenance sits in one closed "Sources and assumptions" disclosure. |

## GCSP activity (`blocks/gcsp/activity/`, timeline in `blocks/gcsp/kit/`)

The representative activity body follows approved employee reference `a7fc178` and reuses `screenIntro`, `button`, `statusScreen`, `mediaWell`, `svgIcon`, the merged GCSP primitive stylesheet and `mountEmployee`. `messageList` owns messages and `dataTable` owns comparison; neither expresses dated activity. No existing kit control owns popup actions with keyboard focus and dismissal, so the consumed menu is shared kit.

| Component | Use |
|---|---|
| `activityTimeline({ events, heading = 'Activity history', emptyText, level = 2, collapseRepeats = false, formatTime = demoTime, note = null })` (`activity-timeline.js`) | Named ordered list of supplied `{ id, occurredAt, label, detail? }` events. Supplied order; valid dates use `<time datetime>` and UK (Europe/London) demo time with no zone label (FUCQ-354), also exported as `demoTime(instant)` for callers that print a check or deadline time. Missing dates say “Time not available”; no events say “No activity is recorded”. No requests or inferred events. `collapseRepeats` draws adjacent rows with the same time, label and detail once, in the view only (Buddy activity uses it; the data is untouched). `formatTime(iso)` words the `<time>` text (default `demoTime`; the presenter feed passes a London friendly time), `note` is an optional paragraph under the heading (none by default), and an event's optional `action` node is appended inside the row's detail after the label and detail (the presenter feed's View email button). Scoped `activity-timeline.css`. |
| `actionMenu({ label = 'Actions', items })` (`action-menu.js`) | Named three-dot native button and menu. Items are `{ label, onSelect?, disabled?, reason? }`. Disabled items remain focusable with `aria-disabled` and their visible described reason. Arrow keys/Home/End move focus; Escape restores trigger focus; Tab/outside focus/pointer dismiss. Call returned `destroy()` or `root.destroy()` before unmount. Caller owns effects; no requests. Scoped `action-menu.css`. |
| `activityBody({ result, onRetry?, onPause?, onResume?, onReviewBrief?, pending = false, offerDisplay?, level = 1, announce? })` (`activity-body.js`) | Compact Active/Inactive status and Pause/Resume menu; image-led offer; one lower Activity feed whose search and check lines come from `value.state`, `sourceStatus` and `lastSuccessfulCheck` (`searchLines`, `activity-copy.js`): Not searched yet, Still searching. No match yet., Source delayed. Waiting for stock data., Stock source unavailable., and “Last check <demo time>: N cars checked, M suitable.” (adds “Found a car for you.” when a car is held). Missing evidence adds no line. When the last check found no suitable car (not paused, finished or holding an open offer), the server's `lastSuccessfulCheck.exclusions` (top two excluding essentials) read as “No released car has 9 seats.” or “9 of 12 cars do not have 430 litres of boot space.” with kit `button`s “Keep searching” (a status note, no change) and “Review your brief” (`onReviewBrief`; disabled “Preview only” without it). The offer is `value.currentOffer`; `offerDisplay` (imagery, title) applies only when its `offerRef.offerId` matches. Paused says new searches and holds have stopped, plus “Your offer is still open. View it to accept or decline.” when the offer is active. Host callbacks own saved commands; absent callbacks show “Preview only”, pending commands show “Updating search”. No requests in this body. |
| `activityOffer({ offer, display?, level = 2 })` (`activity-offer.js`) | Page composition reusing `mediaWell`, `button` (a ghost `<a>` “View offer” to `offer.href`) and native image controls. Returns `null` with no offer (the page's status line carries the state). An active offer is headed “Your buddy found a car” with the car name, “Respond by <demo time>” and a primary “View offer”; other states keep the “Your offer” heading, a state label (Being processed, Accepted, Declined, Expired) and a ghost link. `display` is `{ offerRef, title?, images: [{ src, alt, kind?, fidelity?, caption? }] }`. Local reviewed-source allowlist (`approvedImages`) accepts `/assets/brand-hero/bmw.jpg` as `representative` (brand-image caption) and the approved corpus assets as `representative-configuration`, mirroring `APPROVED_CORPUS_IMAGES` (drift-tested), captioned like the offer view. Live, the controller fills `offerDisplay` from the adapter's `readOfferDisplay`, which validates the offer read with `toOfferPresentation` (FUCQ-256). Unknown/network sources and false exact claims are rejected; absent/broken media preserves offer facts. Scoped `activity-offer.css`. |

The single gallery contains the timeline and one activity surface per state: not searched, searching, offer waiting, declined, expired, paused (with and without an open offer), no match with one or two excluding essentials, source delayed, source unavailable, pending command and unavailable, plus absent/broken imagery and multiple-image controls. The pending example supplies a disabled local callback and saves nothing. Its multiple-image example repeats the same approved brand image solely to exercise selection. Gallery remount destroys open menus.

`activity-fixtures.js` is generated by `server/test/helpers/activity-fixtures.js --write-activity-fixtures`: one fresh synthetic run per state: real BriefService confirmation/pause, a stored allocation receipt of the real shape, a real clock tick for source health, and a tiny quote/hold/offer stored via the real repository, all projected by the real activity reader. These are design fixtures, not evidence of an integrated search producer or offer access; the View offer link target is the real route but opens nothing in the gallery. Provider-unavailable is a simulated repository failure. Equality is checked by `gcsp-activity-body.test.js`. New styles are ratchet capped; existing caps/baselines never increase. The callback consumer and custom element contract are in `docs/gcsp/activity-entry-contract.md`; genuine search and offer integration remain separate acceptance prerequisites.

## GCSP order progress (`blocks/gcsp/order-progress/`, kit in `blocks/gcsp/kit/`)

Slice A of FUCQ-120: a pure, request-free render layer for Paula's order progress, outstanding actions, handover and return planning. It follows the activity body's reference (`a7fc178`) and reuses `screenIntro`, `statusScreen`, `button`, `factList`, `mediaWell` (placeholder "No image for this car yet") and `activityTimeline`. Two kit components are new.

| Component | Use |
|---|---|
| `stageTracker({ heading = 'Progress', stages, level = 2 })` (`stage-tracker.js`) | Named `<ol>` of `{ id, label, state: 'done' \| 'current' \| 'upcoming' \| 'declined' \| 'blocked', at?, owner?, next?, note? }`. State is always written ("Done", "Current step", "Not started", "Declined", "Not updated"); `current` and `blocked` carry `aria-current="step"`. `at` prints in demo time, `owner` and `next` ("Next: ...") are the caller's wording, `note` is a free line (a blocked reason). Supplied order; nothing inferred; no requests. Scoped `stage-tracker.css`. |
| `taskList({ heading = 'Tasks', groups: [{ heading, items }], emptyText, level = 2, rows = false })` (`task-list.js`) | Grouped owned items `{ id, label, owner, status, tone: 'todo' \| 'in-progress' \| 'overdue' \| 'failed' \| 'done', due?, reason?, detail?, action?: { label, onSelect(id), disabled, reason } }`. The action is the kit `button`; a disabled action links its visible reason. `Overdue` and `Failed: <reason>` are written out, not colour alone. Due times use `demoTime`. Empty groups are skipped; no groups reads `emptyText`. `rows: true` (opt-in, order progress) draws divided rows, not cards. No requests. Scoped `task-list.css`. |
| `slotPicker({ slots, actionLabel = 'Request', onPick?, disabled = false, className })` (`slot-picker.js`) | Offered `{ slotId, start }` times grouped by UK (Europe/London) day: a list of days, each a named group ("Sun 8 Nov 2026") of compact time buttons ("09:00") that wrap; days stack under 600 px. Supplied order kept; slots with no valid `start` are skipped. Each button's name stays complete (`aria-label` "<actionLabel> 8 Nov 2026, 09:00", also its `data-focus-key` so quiet repaints refocus the exact slot). `onPick(slot)` is the caller's; `disabled` greys every button; no `onPick` draws plain times. Used for handover and return slots (FUCQ-299). Scoped `slot-picker.css`. |
| `orderProgressBody({ progress, car?, pending?, message?, messageSection?, onRetry?, onCompleteTask?, onRequestAppointment?, onAcceptAppointment?, onRequestReturn?, onAcceptReturn?, onHelp?, mountHelp?, level = 1, announce? })` (`order-progress-body.js`, copy in `order-progress-copy.js`) | `progress = { phase: 'loading' \| 'ready' \| 'unavailable', stages, documents, appointment, returnPlan }`, each the producer's raw envelope. Sections: Your order (car, `Order no.`, server stage names in sentence case, HR only if the server list has it, `blocked` as Not updated; the Steps list then continues with "Handover booked" and "Ready for handover" from the appointment and documents envelopes, a missing or failed envelope reading Not started, and one `Next:` line sits on the latest current step from the envelope that owns it: approvals for approval steps, the appointment for Handover and Ready; a server list that already ends in its own Handover stage is shown as is), Handover (FUCQ-114 states; `booked` decides "Booked"; `completed` reads "Handover complete", `no-show` reads "Handover missed" with offered slots in a `slotPicker` (time buttons grouped by day, named `Request <date, time>`), and a rebooked attempt keeps "Earlier handover missed" from `previousAttempts`; the owner and next step are the server's), Documents and checks (tasks first, then others; readiness, where "Not ready for handover." is followed by "Needs attention" and "Still to do" lists; "Synthetic acknowledgement, not a signature"), and Returning your current car (only when `applicable`; the current car is shown unchanged until the server's current-car relationship says otherwise: once the handover is confirmed the new car is the current car and the old one is "Car to return", `returned` reads "Returned" with a synthetic return reference, `return-missed` reads "Return missed" with the server's owner and next step and no action, and a pending or refused outcome never shows either). A failed envelope shows its own line and the rest still render. `documents` is the `readItems` envelope (order matched by `stages.value.orderUuid`); a lone order or `not-open` is accepted. Absent callbacks render no controls; `pending` disables actions; `message` is a live region (`alert` when `error`), placed under the heading of `messageSection` (`stages`, `handover`, `documents`, `return`) when given, else at the top; the mount passes the section a command came from, so focus and narrow views stay there (FUCQ-254). `mountHelp(node)` or `onHelp` supplies help for a decline or a proposed time. Scoped `gcsp-order-progress.css` (layout only). |

Looked at and why none would do: `activityTimeline` is dated history only, with no owner, current step or next step (it still draws the handover and return history); `factList` pairs labels with values and has no order, state or action; `dataTable` is a comparison grid, not a list of actions; `messageList` shows messages, not owned items with due times; `statusScreen` is one whole-screen state (it still draws loading and unavailable).

`fixtures.js` holds one fictional `progress` per state in the producer shapes (key lists asserted against `server/test/fixtures/gcsp-lifecycle-*-outcomes.json`): waiting-hr, waiting-sales-manager, no-hr, declined, provider-unsupported, sent-to-ordering-no-slot, appointment-requested, appointment-change-proposed, appointment-pending, appointment-scheduled, appointment-completed, appointment-no-show, appointment-rebooked, appointment-outcome-pending, documents-waiting-for-you, documents-in-progress, documents-overdue, documents-failed, ready-for-handover, return-unavailable, return-not-planned, return-requested, return-change-proposed, return-scheduled, return-returned, return-returned-first, return-missed, return-handover-complete, return-outcome-pending, return-outcome-refused, new-order, loading, unavailable, partial-failure. The gallery draws each, with callbacks that only report.

## Not yet in the kit

Hand-built in several modes (file counts at the time of writing):

- **Screen heading block** (`vm-kicker` / `vm-title` / `vm-lede`): 5 files, 43 occurrences. `screenIntro` now exists in `ui.js`; retail modes have not migrated yet.
- **Primary and ghost buttons** (`vm-btn vm-btn-primary|ghost`): 5 files, 27 occurrences. `button` now exists in `ui.js`; retail modes have not migrated yet.
- **Skeleton blocks** (`vm-skel ...`): 5 files, 28 occurrences. Should become `skeleton(kind)` and per-screen `loadingScreen()`. GCSP portal views already use `loadingSkeleton` (below); the matcher modes still hand-build theirs.
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

`createEmployeeCapability({ enabled, frontendUrl, navigate })` in `employee-entry.js` sends an employee on the bmw brand to the Angular `/gcsp/` app, replacing the launcher location. It supplies no identity or scheme policy.

The existing single `components.html` gallery includes a local brand callback, long destination title, missing images, loading and unavailable choices. No employee shell is duplicated. Launcher JavaScript is an explicit ratchet root; the shared primitive module is excluded as kit code. New surface checks reject inline scripts/handlers and unsafe execution.

### GCSP primitive styling (`blocks/vehicle-matcher/gcsp-kit.css`)

The shared GCSP adaptation of `screenIntro`, `button`, `factList`, `statusScreen` and `mediaWell` lives in this explicitly capped kit stylesheet. It imports `blocks/gcsp/shell/gcsp-tokens.css` and scopes every rule under `.gcsp`, with no employee-shell dependency. Both `gcsp-employee.css` and `demo-launcher/launcher.css` import it; the employee's existing primitive rules were moved unchanged. Keep new common primitive treatment here rather than duplicating it in page CSS. Retail surfaces stay outside `.gcsp` and retain their brand themes.

**Narrow widths (FUCQ-223).** `.gcsp .vm-facts` never asks a column to be wider than its container (`minmax(min(100%, 150px), 1fr)`) and the card variants (`.gcsp-card`, brief card facts) use `repeat(auto-fit, minmax(max(140px, 40%), 1fr))`, so a grid is one column below about 360 px and at most two wide. Fact labels and values wrap at spaces and hyphens (`overflow-wrap: break-word`); only a single word longer than its column, such as an email address or a hash, breaks inside the word. Below 600 px the shell's `.vm` panels lose their extra 16px side padding so native selects keep the full column width and show their selected text.

### GCSP order identity (`blocks/gcsp/kit/order-identity.js`, FUCQ-220)

A data helper, not a component. `orderIdentityRows(orderReference, carOrderNumber)` returns `factList` rows labelled "Order reference" (only when the server sent a well-formed `^[A-Za-z0-9-]{1,32}$` reference) and "Car order number"; `orderReferenceOf` is the same check. The manual confirmation, buddy handoff, account order card and history, and order progress all use it, so an earlier order shows only the car's number and nothing is derived on the client.

### GCSP plain copy (`blocks/gcsp/kit/plain-copy.js`, FUCQ-267)

`POINTS_RECOMMENDATION` (FUCQ-381) supplies the brief's **Recommended** badge and its allowance-use tooltip when the server identifies `similarFitThenPoints` ordering. The renderer marks only the server's first recommendation, and only when eligible choices differ in points or preference fit. Legacy `BEST_MATCH` remains for score-only policy pins; neither label changes the underlying preference percentages.

A data helper, not a component (pure, no DOM). Car images carry no disclaimer caption (FUCQ-373); a caption shows only when the data supplies one. `reasonText(entry, kind)` turns any server reason, trade-off, blocker or unknown (`kind` is `reasons`, `tradeOffs`, `blockers` or `unknowns`) into one plain sentence (FUCQ-371 adds the six current-car feedback codes); supplied `text`/`reason` wins, and an unmapped code gets a neutral sentence per kind, never the code or its fields. `longDate(value)` formats a date or ISO instant as "Friday 13 November 2026" (null when invalid). `bodyStyleLabel(value)` reuses `SPEC_LABELS` and title-cases the rest. The brief and offer cards (`decisionView`), the manual gallery, review and summary use it; filter values and sort keys stay raw. `NO_IMAGE_TEXT` (FUCQ-279) is the one image fallback line, "No image for this car yet", used as the `mediaWell` placeholder by the gallery, activity offer, order progress and the account's new-car row; the Account current-car hero alone uses `NO_IMAGE_YOUR_CAR`, "No image available for your car" (frozen reference 193cbf07, FUCQ-359); the kit gallery's `mediaWell placeholder` group shows it. Car names are not built on the client: the server names every car by one rule ("BMW " plus the `policy.displayLabels.v1` model template with the engine filled in, `server/gcsp/policy/car-name.js`), so cards, account, brief, offer and activity read the same name.

### GCSP friendly time (`blocks/gcsp/kit/friendly-time.js`, FUCQ-362)

A data helper, not a component (pure, no DOM). On-screen times read the Europe/London wall clock, never UTC, an ISO string or "tick": `friendlyTime(iso)` gives "Tue 10 Nov, 11:30am", `relativeTime(iso, now)` gives "Today, 11:30am", "Tomorrow, 11:30am" or the date, and `dayClock(now, start)` gives "Day 2 · Tue 10 Nov, 11:30am" counted from the run's start. `londonParts`, `londonInstant`, `londonDaysBetween`, `weekdayName` and `clockTime` are the building blocks, correct either side of a clock change.

### GCSP native form presentation (`blocks/gcsp/kit/form-controls.js`)

Looked at `renderOptionList` and `renderRangeSlider`: they supply question buttons and sliders, while setup needs native date, select, contact and textarea controls with linked field errors. These two shared presentation helpers own no policy, requests or draft state. Their scoped stylesheet is `form-controls.css`; the single gallery's **GCSP native forms** section demonstrates validation, focus and reset.

| Call | Use for |
|---|---|
| `labelledField({ id, label, control, hint, error })` | Associates a unique id with a native control, label, optional hint and inline error. Returns `{ root, setError, setHint }`; updates preserve the control and manage `aria-invalid` and `aria-describedby`. `setHint(text)` swaps the hint for a value-dependent note (FUCQ-282: the made-up demo address note). |
| `errorSummary({ id, title, errors: [{ id, message }], onSelect })` | Links validation messages to controls. Returns `{ root, update, focus }`; focus targets its heading and links target the relevant control. |
| `checkboxField({ id, label, checked, onChange, switch, disabled, describedBy })` | A native checkbox with its label beside it, 24px control and visible focus, for declarations. Returns `{ root, input }`; the caller owns the checked state. Added in `form-controls.js` and `form-controls.css` for FUCQ-108. `switch: true` (FUCQ-368) adds `role="switch"`, the `gcsp-switch` class (rules in `switch.css`, imported by `form-controls.css`: 44x26 track, 18px knob, label first, `.is-important` warning variant when checked, 50% opacity when disabled) and puts the label before the control; `describedBy` sets `aria-describedby`. Without those options the output is unchanged. `labelledField` stacks its label above the control and suits text, select and date controls, not a tick box. |

### GCSP category preferences (`blocks/gcsp/kit/category-preferences.js`, FUCQ-368)

The compact Account Preferences: six category tiles, one open panel, a removal confirmation and a status line, matching the [frozen reference](docs/gcsp/mockups/account-preferences-2026-11-10/FROZEN-REFERENCE.md). Looked at `renderOptionList` (multi buttons, kept for Body and Fuel), `renderRangeSlider` (single, step 50, kept for the three-stop categories) and `checkboxField` (extended with `switch` for "This is really important"); all are composed, not replaced, so their keyboard behaviour and tokens carry over. `radioGroup`-style tiles, `tabs` and `actionMenu` do not fit: a tile toggles one panel, shows a chosen summary and carries its own remove button. A pure presenter: no persistence, policy, requests or category data of its own.

| Call | Use for |
|---|---|
| `preferenceCategories(context.accountPreferences)` | Turns the server projection (`{ order, categories }`) into the ordered `[{ key, label, question, kind: 'multi'\|'stops', options\|stops: [{ value, label }], openDefault? }]` list. |
| `categoryPreferences({ id, categories, state, minimum, onOpen, onChange, onRemove, onConfirmRemove, onKeep, onClose, onStatusAction })` | Returns `{ root, update(state), focusCategory(key), destroy() }`. `state` is `{ categories: { [key]: { state: 'unset' } \| { state: 'considered', value, importance: 'medium'\|'high' } }, open, pendingRemoval, disabled, status: { kind: 'idle'\|'pending'\|'saved'\|'failed'\|'stale'\|'access'\|'restarted', text, actionLabel?, onAction? } }`. Callbacks are intents only: `onOpen(key)` toggles, `onChange(key, { value })` or `(key, { importance })`, `onRemove(key)` (bin), `onConfirmRemove`, `onKeep`, `onClose` (Done). The caller owns every state change and calls `update`. |

`update` patches in place: the open panel's controls are rebuilt only when `open` changes, so focus and the slider survive a quiet refresh. Slots `[data-slot="understanding"]` (section head) and `[data-slot="mode"]` (above the tiles) are filled by the FUCQ-369 options below and stay empty without them; `[data-slot="action"]` (footer) holds the FUCQ-370 Buddy action (below). Unset sliders sit on `openDefault` without emitting; the caller saves it on open if it wants to. The slider's `aria-valuetext` is the stop label. Styles are in `category-preferences.css` (ratchet-capped); the gallery's **GCSP category preferences** section shows empty, selected, open-unset, open-medium, open-high, midpoint, remove-confirmation and failed states from local fixture state. Test: `server/test/gcsp-category-preferences.test.js`.

**FUCQ-369 extension (Same again, Buddy understanding).** Extended rather than new: the meter and the mode row live in the component's own head and mode slots, reuse `checkboxField({ switch })` and `helpTip`, and share the `is-disabled` neutral tile rules (now `:is(.is-disabled, .is-same-again)`), so no second tile treatment exists. Two optional options, both absent by default (identical DOM to before): `understanding: { label?, maximum }` mounts an `understandingMeter` in the head; `sameAgain: { description, onToggle(on) }` mounts the mode row (label "Same again, please!", a 44px info button, the switch) with a `helpTip` (`below-start`, `dismissOnActivate: false`) reading "Select this option if you just love everything about your current car, and your next best car would be another `description`". Extra state: `understanding: { value, maximum, pending, failed }` and `sameAgain: { on, available = true, reason }`. While `on` the root gets `is-same-again`: tiles go neutral (choices stay visible, names end ", kept while Same again is on"), open and remove buttons are disabled and any open panel or removal confirmation is not shown. Unavailable (`reason` `no-current-car` or `current-car-unidentified`) disables and unchecks the switch, hides the info button (there is no car to describe) and shows a short note that describes the switch; categories stay editable. Toggling the switch closes the help so it does not cover the tiles. The switch is controlled: it only calls `onToggle(checked)`. The returned `setSameAgainDescription(text)` rewrites the tip's description when the car renders after the component. Styles for the row are in `same-again.css`; the meter's are in `understanding-meter.css`.

**FUCQ-370 extension (footer action).** Extended: an optional `action: { onClick, describedBy }` mounts one primary `button` in `[data-slot="action"]`; state `action: { label, disabled }` sets its text and disabled flag (also disabled with the whole component). Returned `focusStatus()` focuses the status line (tabIndex -1, for the under-minimum outcome) and `actionButton` exposes the button so the caller keeps focus on it. Status kind `notice` renders in the danger colour like `failed`: it is the kind for a saved success the user must act on (minimum loss), so a success is never styled or announced as a failure. Without `action` the DOM is unchanged.

### GCSP understanding meter (`blocks/gcsp/kit/understanding-meter.js`, FUCQ-369)

Looked at `rangeBar` (a figure of ranges), `metricTile` (one figure, no segments) and the sliders (inputs). None is a read-only "n of max" with equal segments, so `understandingMeter` is new, with `understanding-meter.css`. It is an input-completeness indicator: never call it confidence, probability or fit.

| Call | Use for |
|---|---|
| `understandingMeter({ id, label = 'Buddy understanding', value, maximum, pending = false, failed = false })` | Returns `{ root, update({ value, maximum, pending, failed }) }`. `root` is a plain `div[data-kind="input-completeness"]` holding the label, a bold `n / max` figure whose `aria-label` reads "Buddy understanding 6 out of 11" (plus " (saving)" while `pending`, or " (not saved)" when `pending` and `failed`, which also mutes the figure and the filled segments without changing geometry) and `maximum` equal `aria-hidden` segments (the last is drawn as the open-ended 11th). Values are clamped to 0..maximum. The caller owns the number; the kit holds no policy. |

Gallery: **GCSP understanding meter and Same again** (meter at 1, 6, pending and 11; Same again off at 1 and 6, on with a high-importance choice kept, unavailable, help open). Tests: `server/test/gcsp-understanding-meter.test.js`, `server/test/gcsp-category-preferences.test.js`.

### GCSP stage list (`blocks/gcsp/kit/stage-list.js`)

Looked at `activityTimeline` (an ordered list, but every row needs a dated event), `factList` (label and value, no order or state) and `metricTile`. None lists named stages in order with a plain state, so `stageList` is new, with its own scoped `stage-list.css` and ratchet cap and pattern.

| Call | Use for |
|---|---|
| `stageList({ heading, stages: [{ name, state }], level, labels })` | An ordered `<ol>` of stage names with a state label: `complete` Done, `waiting` Waiting, `not-started` Not started, `pending` Sending, `failed` Not accepted (default `STAGE_LABELS`). Names and order are the caller's; the kit infers no stage or state, and an unknown state reads "Unknown". The gallery's **GCSP stage list** section shows acknowledged, sending and not-accepted lists. |

### GCSP range bar (`blocks/gcsp/kit/range-bar.js`)

For a mean with its range across seeds on one shared scale, as in the route comparison. Looked at `metricTile` (one figure, no range), `dataTable` (exact cells, no visual range) and `renderRangeSlider` (an input, not a display), so `rangeBar` is new. `rangeBar({ label, rows: [{ label, mean, min, max }], scale, format, level = 3, id })` draws a labelled `figure` with one row per measure; without `scale`, the rows share the smallest min to the largest max, and a null mean reads `Not observed`. Positions are CSSOM custom properties (`--gcsp-range-start`, `--gcsp-range-end`, `--gcsp-range-mean`), never inline style strings. The value text carries the meaning and the track is `aria-hidden`. The rows share one set of columns (`subgrid` on the list's `minmax(6rem, 1fr) auto` grid), so every track in a bar is the same width, never under 6rem, whatever the value text; the label sits above its track and value (FUCQ-295). Gallery: the **Range bar** section of `components.html`; its stylesheet `range-bar.css` is capped at 12 lines.

### GCSP show more (`blocks/gcsp/kit/show-more.js`, FUCQ-223)

Looked at `button` (a single action, no count or paging state), `statusScreen` (an empty or error shell) and the gallery's own counts line (a read-only total). None pages a long list, so `showMore` is new, with its own `show-more.css`, ratchet cap and pattern.

| Call | Use for |
|---|---|
| `showMore({ nouns = ['car', 'cars'], label = 'Show more cars', onShowMore })` | A paging footer: a plain (not live) line "Showing n of total cars" and a real ghost `button`; the caller announces the count through its `viewStatus`. Returns `{ root, update({ shown, total }), button }`; the button hides once `shown >= total`. The caller owns the page size, the sliced list and focus: on `onShowMore` it renders the next page and focuses the first new item (give it `tabindex="-1"` and an accessible name). The gallery's **GCSP show more and narrow values** section demonstrates it. |

The manual released-car browser pages its cars with `showMore`: `MANUAL_GALLERY_PAGE_SIZE` (6, a display constant, not policy) cars first, "Show more cars" adds the next page and focuses its first card, and any search, sort, filter or reload resets to the first page. Sorting and filtering still apply to the whole list. The control is not in the page when the list fits one page. The counts line now reads "n matching" (the filtered total) beside "Showing x of n cars".

### GCSP side drawer (`blocks/gcsp/kit/side-drawer.js`)

Looked at `actionMenu` (a popup of actions, not a record), the presenter flyout (presenter-only, not modal) and `statusScreen` (a whole-screen state). None holds a record beside the page, so `sideDrawer` is new, with its own `side-drawer.css`, ratchet cap and no `showModal` (jsdom lacks it).

| Call | Use for |
|---|---|
| `sideDrawer({ host, context, title, body = [], footer = [], opener, closeLabel = 'Close', onClose })` | A modal panel on the right (480 px, full screen under 600 px) with `role="dialog"`, `aria-modal="true"` labelled by its h2, `--gcsp-elevation-overlay` and a `--gcsp-backdrop` scrim. `context` is a 12 px muted label above the title; `body` and `footer` are nodes, the footer holding actions (a ghost button each). Focus moves to the heading on open, Tab stays inside (buttons, links, fields, `summary` and `iframe`), and Escape, the Close button and a scrim click close it and focus `opener` (an element, or a function returning one so a repaint cannot strand focus). Background siblings are inert and page scrolling is contained while open; prior attributes and scrolling restore on close. Hidden controls and closed-details contents are excluded from its trap. `setDismissible(false)` prevents Close, Escape and scrim dismissal while a command is pending; API close remains available for terminal readback and teardown. Returns `{ root, panel, close(restoreFocus = true), setDismissible(value) }`. The caller keeps one open at a time and closes it on teardown. Used by the account's car record. |

### GCSP notification bell (`blocks/gcsp/kit/notification-bell.js`, FUCQ-375)

Looked at `actionMenu` (a popup of actions, no count), the account `details` disclosure (a name, not a list), `sideDrawer` (modal, not a header disclosure) and `viewStatus` (reused for the announcement). None is a header disclosure with a count badge and a rows panel, so `notificationBell` is new, with its own `notification-bell.css` (imported by `gcsp-shell.css`, so every `portalShell` page has it), ratchet cap and `button` for the offer action.

| Call | Use for |
|---|---|
| `notificationBell({ id, onNavigate, onOpen, noteMs = 6000 })` | A 44 px bell `button` with `aria-expanded`/`aria-controls`, a red count badge, a 380 px "Notifications" panel and a short note under the bell. Model through `update({ status: 'ok' \| 'unavailable' \| 'loading', waiting: 0 \| 1, rows, note })`; a row is `{ key, kind: 'offer', waiting, title, car, detail, image: { src }, action: { label, href, variant: 'button' \| 'link' } }`. The accessible name is "Notifications, 1 car offer waiting" or "Notifications, none waiting". Escape and a click outside close it and return focus; opening it calls `onOpen` (the shell closes the account menu). A `note` shows for `noteMs` and is announced once through a polite `viewStatus`. Returns `{ root, button, update, open, close, destroy }`. |
| `portalShell({ notifications })` | Optional header slot just left of the account: a bell source `{ connect(update) -> disconnect }` or a static model. Without it the header is unchanged. `shell.setNotifications(model)` updates it; `shell.bell` is its root. `mountEmployee(root, { notifications })` and the live pages pass it through. |
| `notificationRows(activity, display)` / `notificationModel(activity, display)` (`blocks/gcsp/activity/notification-source.js`) | Pure derivation of rows from the activity read: the newest offer first (active "Your buddy found a car" with the car, "Reserved for you. Respond by HH:MM." and one "View your offer" button; accepted, being processed, declined, expired), then older offers and buddy state changes by time. The badge is 1 only while the newest offer is `active`. |
| `createNotificationSource({ adapter, subscribe, pollMs = 30000 })` | The live source over `createActivityHttpAdapter` (`readActivity`, `readOfferDisplay` with the activity value's `runId`). It reads on connect, on a presenter action, on a visible tab, on a restored page (`pageshow` persisted) and every `pollMs` while the tab is visible; one read at a time, aborted on disconnect. The note is set only when an active offer id is new since the previous successful read, never on the first read. Before the first success the panel says "Notifications are unavailable right now." with no badge; a later failure keeps the last state. |

The gallery's **GCSP notification bell** section shows none waiting, waiting, the note, open waiting, open with nothing waiting and open unavailable. Opening the bell or the offer never clears the badge; only the offer leaving `active` does. The offer page without an employee session passes `{ status: 'unavailable' }`, so it shows the bell with no badge and makes no read.

### GCSP live regions (`blocks/gcsp/kit/view-status.js`, FUCQ-285)

Each view announces through one region, for results and outcomes only. Looked at the brief's and follow-up's own live lines and the offer's hidden announcement: each was a private copy, and no kit helper owned a single per-view status, so `viewStatus` is new.

| Call | Use for |
|---|---|
| `viewStatus({ className = 'gcsp-vh' })` | Returns `{ root, announce(text), clear() }`: one `p` with `role="status"` and `aria-atomic="true"`, visually hidden by default. `announce` skips text equal to the last announced; `clear()` lets the same text announce again. Stay silent on first paint. |

Everything else is plain text: the explicit card's eligibility line (no `aria-live`), `showMore`'s count, a slider's readout (`span.vm-slider-value`, `aria-hidden`; the input's `aria-valuetext` carries the value), and a `statusScreen` embedded under a host that owns the region (`role: null`). `createFollowupView` takes `announce` to speak through its host instead of making its own line. So do `mountOrderProgress` and `orderProgressBody`, and `activityBody`: an optional `announce(text)` from the host means they make no region and their messages and status screens are plain; standalone they keep exactly one. Static labels ("Active", "No renewal case", read-only notes) are always plain text.

## GCSP presenter controls (`blocks/gcsp/presenter-controls/`)

Component plan: reuse `button`, `factList`, `statusScreen`, `labelledField` and controlled `renderOptionList` for both Scenario and Acting principal; use the shared shell presenter region. Add `presenterBar` because neither the account disclosure nor a status screen combines a compact presenter disclosure with supplied run/clock/principal facts. Authorization, draft selection and command behavior stay with the consumer.

| Component | Use instead |
|---|---|
| `presenterBar({ label = 'Presenter controls', readback = [] })` (`blocks/gcsp/kit/presenter-bar.js`) | Native disclosure plus supplied `factList` rows. Returns `{ root, summary, panel, readback, setReadback(rows) }`. Append consumer actions to `panel`; readback updates preserve disclosure and action identity. Use instead of hand-building a presenter disclosure/readback. |
| `mountPresenterControls(host, { adapter, commandId, navigate, clearAfter = 5000, onAvailability, onReveal, onEscape, onReadback, openOnLoad })` | Shared presenter strip (UX revamp slice 8: beat actions first in run-sheet order with Tick the only primary, a short Scenario/Clock/Acting as readback, principals labelled by job such as "Paula, employee", no run id on screen (it is `data-run-id` on the root), "Available" never shown per item, and Faults and Last tick as closed `details.gcsp-presenter-fold` disclosures; `openOnLoad` opens the flyout once on a landing page unless the presenter already closed it) (a details disclosure in any host; `portalShell` passes the three hooks to show it in the nav flyout instead: `onAvailability(visible)` when it is shown or hidden, `onReveal()` where it would open itself, `onEscape()` for Escape) with a native target field and controlled Scenario/Acting principal radio lists, server-projected policy step/cues/principals, confirmed reset, ordered tick receipts in a closed native "Step results" disclosure that keeps its open state across readbacks, Last tick in words from `presenter-controls/tick-copy.js` (a summary sentence and labelled steps, never ids or JSON), exact original-command retry and actual-context switch reconciliation. **Reset and switch to Greg** (FUCQ-351) follows the four beat actions: it opens the same reset confirmation for the chosen scenario with the scenario's Greg principal as the lead (disabled when the scenario is unavailable or names no Greg), returns focus to itself on Cancel or Escape, and after a confirmed switch publishes the opaque session-change marker so open portal tabs reload onto Greg's page. Returns `{ root, refresh, destroy }`. Success text ("Presenter controls ready", "Action recorded", "Principal confirmed") clears after `clearAfter` ms; failures and uncertainty stay until replaced. Use instead of per-page presenter actions. |
| `<gcsp-presenter-controls>` / `defineGcspPresenterControls(registry)` | Standard custom element, adapter property, disconnect teardown. Load `presenter-controls/register.js` and the shared shell styles. The parent `.gcsp` supplies Density tokens. |
| `subscribePresenterActions(target)(listener)` | Lives in `blocks/gcsp/kit/presenter-actions.js` with `PRESENTER_ACTION_KEY`, used by portal pages; `controls.js` writes the same key. Bare, idempotent subscription to a successful strip action: the bubbling `gcsp:presenter-action` event on this page, plus the `storage` event for `localStorage['gcsp:presenter-action']` (written after each success; storage events never reach the writing tab, so a same-page action is heard once). Consumers pass it as `adapter.subscribeClock` and re-read only their own data with a quiet `sync()`. |
| `focusKeyOf` / `findByFocusKey` / `keepScroll` (`blocks/gcsp/kit/focus-key.js`) | Quiet repaint helpers: remember the focused control by tag, label (its `data-focus-key` when set, else its text) and section, refocus its equal after the repaint, and restore window scroll if it moved. Used by activity and order progress. |
| `installArrivalFocus({ root, main, arrive })` / `focusHeading(heading)` (`blocks/gcsp/kit/arrival-focus.js`, `arrival-focus.css`) | Shell focus helper, installed by `portalShell` (`arrivalFocus: true` for `mountEmployee` pages and the offer). Tracks input modality: script focus on a `tabindex=-1` h1-h3 gets `data-gcsp-quiet-focus` (no ring) unless the last input was the keyboard, which keeps the ring. With `arrive`, focuses the main h1 until the first key or pointer input, never taking focus from a control. `focusHeading` is the in-page outcome move. The shared `.gcsp` focus ring moved into `arrival-focus.css`. Gallery: GCSP arrival focus. |

Shared disclosure/readback/compact option styling lives in `kit/presenter-bar.css`, imported by the capped `presenter-controls/presenter-controls.css` through the shell. The kit stylesheet is separately capped, and the presenter-bar pattern rejects new hand-built copies outside its factory. Picker rows rebuild only when the supplied options change; ordinary readbacks use the existing `update({ value, disabled })` handle. Unavailable scenarios stay selectable with missing-capability copy while Reset stays disabled. Groups have explicit accessible labels and retain the shared arrow/Home/End semantics. The GCSP gallery includes a standalone presenterBar and an explicitly isolated pending/missing-release example with both option lists; it makes no release or scenario capability claim. Functional tests: `server/test/gcsp-presenter-controls-render.test.js`, shell/CSP checks and UI ratchet. Browser evidence remains a separate gate.

### GCSP tabs (`blocks/gcsp/kit/tabs.js`, FUCQ-360)

Looked at `renderOptionList` (a radiogroup of choices, no panels) and `presenterBar` (a disclosure). Neither is a tab set, so `tabs` is new, with its own `tabs.css`, ratchet cap and pattern.

| Call | Use for |
|---|---|
| `tabs({ label, items: [{ id, label, panel }], selected, onSelect })` | WAI-ARIA tabs with automatic activation: `role=tablist` named by `label`, `role=tab` buttons with `aria-selected`, `aria-controls` and a roving tabindex, Left/Right (wrapping), Home and End; each supplied `panel` node becomes a `role=tabpanel` (`tabindex=0`, `aria-labelledby`), hidden unless selected. The selected tab is marked by an underline; below 600px, tab targets are at least 44px high. Returns `{ root, list, select(id), selected() }`. The caller owns the panel contents. Gallery: **GCSP tabs**. |

### GCSP release grid (`blocks/gcsp/kit/release-grid.js`, FUCQ-365)

Looked at `tabs` (panels, not tiles), `renderOptionList` (a radiogroup of choices) and the manual gallery cards (full cards, one per car, each its own tab stop). None draws a dense image tile grid with one focus stop, roving arrows and a staggered arrival, so `releaseGrid` is new, with its own `release-grid.css`, ratchet cap and pattern.

| Call | Use for |
|---|---|
| `releaseGrid({ label = 'Released cars', columns = 20, preload, timeoutMs = 4000, matchMedia })` | Returns `{ root, show(tiles, { animate = true }) -> Promise, setLoading(), clear(), destroy() }`; tiles are `{ id, imageSrc, label }`. `root` is `role="grid"` named by `label`, rows are `role="row"` (`display: contents`), each tile a 16:9 `role="gridcell"` named by its label with an `alt=""` image cropped to the car. `setLoading()` cancels pending work and replaces existing cars with matching 16:9 tile skeletons. `show()` keeps those placeholders visible with `aria-busy`, preloads every image (all settled or `timeoutMs`; `preload(srcs) -> Promise<Set>` is injectable) and only then adds the tiles; a tile whose image failed shows its label as text. A newer `show()` or `clear()` cancels an older pending one. With `animate` and motion allowed the tiles fade in with a staggered delay so the grid lands in about 1.2s and the promise resolves then; under reduced motion (`matchMedia`, or the window's) or `animate: false` they are final at once. One focus stop (roving tabindex): Left/Right move one, Up/Down one row, Home/End to row start/end, Ctrl+Home/Ctrl+End to first/last, clamped, no wrap; focus inside the grid moves to the new first tile on re-render. Hover or focus shows the label in one `aria-hidden` tip. Gallery: **GCSP release grid** (with Replay). |

**Release charts and day bar (Gary, 11 November 2026).** Looked at `rangeBar` (a mean and its range on a shared scale, label above the track) and `factList` (text only); neither draws the mockup's label, bar and count row, so `countBars({ label, rows: [{ label, count }], limit, otherLabel, level, id })` (`blocks/gcsp/kit/count-bars.js` and `.css`) is new: a `figure` labelled by its heading, bars scaled to the largest count through the `--gcsp-count-share` custom property (aria-hidden; the count text carries the meaning), rows past `limit` folded into one `otherLabel` row. `dayBar()` (`presenter-controls/day-bar.js`) is the mockup's Mon to Sun week strip: past days since the run began are done, today is `aria-current="date"`, weekends dim. Its time/day layout and week marker styles belong to the separately capped `kit/presenter-time.css`, linked explicitly by `components.html`. Reuse `dayBar()` and its `update({ now, start })` handle rather than copying week markup or restyling its markers in a view. Gallery: **GCSP presenter time and scheme week** (past/current/weekend and unavailable-clock states).

### GCSP help tip (`blocks/gcsp/kit/help-tip.js`, FUCQ-367)

Looked at `releaseGrid`'s aria-hidden label tip and the shell's account-status tooltip (neither is a focusable, hoverable description with dismissal), `renderOptionList` (no tooltip) and the Account mockup's private `attachTooltip`. None is shared behaviour, so `helpTip` is new, with `help-tip.css`. FUCQ-369 (Same again help) reuses it.

| Call | Use for |
|---|---|
| `helpTip({ host, triggers, text, id, placement = 'below-start', dismissOnActivate = true })` | Returns `{ root, show(), hide(), dismiss(), setText(text), destroy() }`. `root` is a hidden `p.gcsp-help-tip[role=tooltip]` appended to `host` (which must be a positioning context); `id` is added to each trigger's `aria-describedby`. Shows on mouse or pen `pointerenter` (not touch) and on keyboard focus; stays while the pointer is over the tip; hides when the pointer leaves `host` (unless a trigger has keyboard focus) or focus leaves it. `dismiss()` hides and holds it shut until pointer and focus have both left `host`. Escape, a `pointerdown` outside `host` and, with `dismissOnActivate`, a trigger click dismiss it; with `dismissOnActivate: false` a click shows it. Placements `below-start` and `above-end`. Text is `textContent` only. Gallery: **GCSP star rating and help tip**. |

### GCSP star rating (`blocks/gcsp/kit/star-rating.js`, FUCQ-367)

Looked at `renderOptionList` (a radiogroup of labelled answer buttons: no compact star glyph targets, no clear by re-selecting), `checkboxField` (one boolean) and the mockup's private rating markup. None is a 1-5 rating, so `starRating` is new, with `star-rating.css` (the tip comes from `helpTip`).

| Call | Use for |
|---|---|
| `starRating({ label, value = null, help, labels = RATING_WORDS, onChange, onRetry, announce, overlay = false, pill = false, name, disabled = false })` | Returns `{ root, update({ value, status, disabled }), value(), focus(), destroy() }`. `root` is a `fieldset` named by a hidden `legend` (`label`) with five native radios, each in a 44px target with a 24px star and an `aria-label` such as "4 stars: I really like it" (`RATING_WORDS` is exported). Value is 1-5 or `null`; choosing the selected star clears it. Click, tap, Enter and Space each change the value once and call `onChange(value)`; arrows move and select (clamped), Home and End go to 1 and 5. `help` adds a `helpTip` (above-end) that every activation dismisses. `overlay` pins the rating 8px from the bottom right of a positioned image well. `onRetry` adds, above the stars and only while the status is `failed`, a compact `.gcsp-star-failed` line: visible "Rating not saved" and a 44px ghost `Try again` button named "Try saving your rating again" (one line, wraps above the stars at 320px). The frozen reference has no such service state. |

State shape: the caller owns saving. It passes `update({ value, status })` with `status` `'idle' | 'pending' | 'saved' | 'failed'`; `pending` sets `aria-busy` but leaves the stars usable, `saved` announces "Rating saved: n of 5" or "Rating cleared", `failed` announces "Rating not saved. Try again.", each once per outcome, through `announce(text)` when supplied or one `viewStatus()` inside the fieldset. `update` repaints without calling `onChange` or moving focus, and `data-status` mirrors the status for styling. The kit sends no requests and stores nothing. Gallery: **GCSP star rating and help tip** (unrated, 4, 5, long help, not saved with Try again, no image).

### GCSP loading skeleton (`blocks/gcsp/kit/loading-skeleton.js`)

Looked at `vm-skel` (matcher-only shimmer bars with no layouts or label) and `statusScreen` (a message, not a page shape). Neither draws the shape of a portal page while it loads, so the kit adds one helper and `loading-skeleton.css`, imported by the shell.

| Call | Use for |
|---|---|
| `loadingSkeleton({ label, layout, role, items, labels })` | Grey blocks shaped like the coming view, with a slow sweep that stops under reduced motion. `layout` is `page` (title, lines, car card, rows; the default), `form` (preferences panels), `timeline` (card and rows, for activity and order progress) `card` (help) or `feature` (Your cars: the full-width car panel with its image filling the wide left column, then a panel and rows, at the page's 1680 px cap). The shapes are `aria-hidden`; `label` is the one line assistive tech hears, with `role="status"` unless `role: null` (when the page already has a live region). `mountEmployee` draws it while the account loads, picking `ctx.loadingLayout`. Two more layouts: `console` (heading, sub line, two buttons, a panel and rows) and `section` (rows only). Release layouts are `release-grid` (16:9 tiles, `items` defaults to 100 and columns inherit `--gcsp-release-columns`), `stats` (five counters, or the supplied `labels`, matching the five/two-column layout), and `bars` (label/bar/count rows, `items` defaults to three). These share `release-skeleton.css`. Gallery: **GCSP release skeletons**. |

### GCSP demo restarted (`blocks/gcsp/kit/run-restarted.js`)

Looked at `statusScreen` (title, message and actions, but no copy for a restarted demo or a Reload action) and `button`. Nothing existing says the demo was restarted and offers a reload, so the helper composes both and adds no stylesheet.

| Call | Use for |
|---|---|
| `isRunRestarted(reply)` | True when a server reply has status `stale-run`, `unknown-session` or `access-required`. Use instead of showing the raw status. |
| `isAccessLapsed(httpStatus, body)` | True for a bare 401 (no string `status`). Every page adapter maps it to `{ status: 'access-required' }`. |
| `runRestartedScreen({ reload })` | Page-level alert (`statusScreen`): "Demo restarted", the reload message and one primary Reload button. `reload` defaults to following an empty-href link (a full reload; the kit never reads the URL). |
| `runRestartedNotice({ reload })` | Compact inline alert for panels. Returns `{ root, reload }`; `reload` is the Reload button, so callers can move focus to it. Used by presenter controls, which also disable every control and never resend the old command. The gallery's **GCSP demo restarted** section shows all three. |
| `accessLapsedScreen({ next })` | Page-level alert for the offer link, where a reload would not restore the session: "Session ended" and one link back to `next` (default the account page). Used by the offer and offer follow-up views for `access-required`. |

### Manual released-car cards (`blocks/gcsp/manual-gallery/`)

`gallery-model.js` projects the unranked exact-stock decision set into one `matchCard` view per `orderUuid`, with search, series/body filters, sorting and details. Fitted, reference and unclassified specification facts remain distinct. `fixtures.js` holds the synthetic stock states. The page controller is retired: the Angular `/gcsp/stock` route replaced it (FUCQ-442).

The single gallery's **Manual released-car cards** section shows explicit synthetic eligible/ineligible/long-name examples with disabled Review actions, built from `toManualGallery` and `matchCard`.

### Vehicle decision presentation (FUCQ-383)

FUCQ-402 aligns this composition with Your cars: shared Density page/vehicle heading sizes, button metrics and section spacing. `loadingSkeleton` adds `layout: 'offer'` (header/countdown, media/summary/actions, comparison rows, with summary before media below 800px) and `layout: 'media'` (fills the existing image well). The entry renders the shared shell and offer skeleton during account startup; the view uses the same skeleton while reading the offer. Featured and enlarged gallery images use the shared media skeleton until load/error. No decision controls appear before the offer read settles. Gallery: **Vehicle media gallery**, Offer loading and Image loading. Styles are in capped `kit/offer-skeleton.css`, imported by the existing skeleton sheet; reduced motion uses the shared shell rule. Reuse `portalShell`, `screenIntro`, `button`, `mediaWell`; extend the shared skeleton/gallery only, with no new primitive or business logic.

`vehicleDecisionCard({ view, media?, actions, note, finishes, pointsDifference })` in `blocks/gcsp/kit/vehicle-decision.js` extends the existing exact `matchCard` with a wide media/summary layout. `media` optionally supplies a shared media node; absent it, the single-image well stays. Its actions precede media in reading and narrow-screen order; supplied facts and blockers remain visible. `finishLabel({ label, value, shade })` pairs readable text with a decorative swatch; only an explicitly supplied supported shade uses `SWATCH_HEX`, otherwise `NEUTRAL_SWATCH` and the unknown treatment apply. Marketing names never imply a colour value.

Supplied Options facts with structured `items` move from the compact grid into the initially closed native **Selected equipment (count)** disclosure. Every label remains in source order, including explicit missing labels; the projected fact retains its provenance. Scalar, unknown and empty Options facts keep the existing fact behaviour. Expanded equipment uses responsive text columns without ranking or inferring priorities.

`mediaGallery({ name, images, placeholder })` (`blocks/gcsp/kit/media-gallery.js`, FUCQ-385) extends `mediaWell` with ordered retained `{ src, alt, fidelity, sourceRef?, viewpoint?, label? }` views. It returns `{ root, select(index), selectedIndex, destroy() }`. Thumbnails replace the feature; the magnifier opens the selected image in a native dialog with synchronized thumbnails/counter, wrapping arrows, keyboard containment and Escape/Close focus return. Empty/single/loading/broken states stay readable without phantom navigation; a selected failed thumbnail retains its border, with a separate outside keyboard-focus ring. An allowlisted historical photo without fidelity remains one view. Call `destroy()` before removing/replacing the node. The pending offer owns this lifecycle across structural redraws and disconnect, preserving selection during clock reads. `media-gallery.css` is scoped and ratchet capped; the component gallery shows three views, single, empty, unavailable and long-label examples.

`decisionHighlights({ benefits, tradeoffs })` takes `{ number?, title, detail? }` entries and paints each card independently. Benefits occupies two of three equal desktop columns and wraps in two-card rows without a cap; Tradeoffs keeps its natural height; groups stack on narrow screens. An empty group says none are confirmed. Reuses `metricTile`'s figure hierarchy, but metricTile's single dense dashboard tile has no grouped two-column layout. Use this shared component instead of local benefit grids. Styles live in `vehicle-decision.css`, capped by the ratchet; gallery: **Vehicle decision: finishes and five benefits**.

`dataTable` now supports `captionHidden` (caption remains accessible), `equalColumns` (equal thirds in compare) and `{ label, winner: true }` cells (individual tinted, bold cells). Existing defaults stay unchanged. The offer places current car before offered car and keeps their configuration identities at narrow widths. Only agreed directional points cost and boot-capacity differences infer a winner; ties, missing data and preference-dependent rows stay neutral. Server-supplied reasons/tradeoffs remain available as highlight cards without selecting new equipment priorities.

The pending offer is capped at 1680px. Its prominent h:mm countdown uses only DemoClock readback and retains the authoritative zero reread; it never advances or resets the business clock locally. Pending Scheme/order identifiers are omitted, while accepted order outcomes retain their actual order number. Until FUCQ-386 integrates drawers, existing declaration/decision controls stay authoritative; the summary actions expose the same decision hook.

FUCQ-386 offer decision composition uses one `sideDrawer`, `checkboxField`, `labelledField`, `errorSummary`, `factList`, `renderOptionList` radio rows and `button`. The initial page actions only open review. Canonical declarations, contact/driver/licence/old contract and pinned points stay visible in the acceptance drawer. Expected return mileage is a separate controlled field, bounded by the server policy projection; recorded mileage is read-only context. Document links reveal the authoritative scheme wording or focus the projected driver/contract record. The decline drawer takes its fixed codes and labels from the controller registry; no text feedback field exists. The footer stays outside the scrolling body.

### GCSP Buddy status (FUCQ-389)

`buddyState(result)` and `buddyStatus({ state, href, onClick })` in `blocks/gcsp/kit/buddy-status.js`, styled by `buddy-status.css`, provide the shared static dot and readable status used by Your cars and Buddy activity. An optional `href` wraps the status in one outlined native link with Buddy and a decorative chevron; unset instead reads Set up your buddy. The shared projection uses current activity permission: Buddy engaged requires search and hold grants with pause off; partial grants and historical paused records read Buddy disengaged. Not set up, Search finished and Status unavailable remain distinct read/setup outcomes. Missing/failed permission never means unconfigured. The kit sends no requests or commands and owns no consent. Existing `statusScreen`/`viewStatus` remain page/announcement helpers. Gallery: GCSP Buddy status, all six states as links and plain labels, plus the prominent row. The `gcsp-buddy-action` class extends existing ghost buttons with a white outlined 44px control; Activity composes these buttons with pause/play SVGs, retains disabled reasons, and uses a stable focus key across Engage Buddy / Disengage Buddy. Both controls use the Account editor commands and its minimum gate. The reachable legacy preferences form also has one Engage Buddy / Disengage Buddy choice, applied on Save with both grants together; its public draft and confirmation routes use the same editor minimum, Same again and grant-policy gates, and retain raw response envelopes for compatibility.

**FUCQ-370 extension (retained prominent variant).** The former Account engagement lamp remains available in the kit and gallery (`gcsp-activity-status`, `metricTile` and the bell dot were checked first and are 16px badge, a figure and an 8px count). `buddyStatus({ prominent: true, id, state })` returns a `<p id>` (not a live region: the preferences status line is the single announcement) with an `aria-hidden` 18px lamp and title-size strong words "Buddy engaged" / "Buddy disengaged" / "Buddy status unavailable" for state `engaged` | `disengaged` | `unknown` (anything else reads unknown). The element has `data-state` and an `update(state)` method that repaints in place. Lamp tokens: `--gcsp-success`, `--gcsp-danger`, `--gcsp-text-muted` (unknown is never green); static, no animation or transition. The compact variant uses the same engaged/disengaged wording and suppresses a repeated Buddy name inside its navigation link. Account no longer mounts this lamp; FUCQ-397 uses the single activity tile below. The 4 lines it adds (a comment and 3 rules) raise the `buddy-status.css` cap from 12 to 16. Tests: `server/test/gcsp-buddy-status.test.js`.

### GCSP Buddy tile (FUCQ-397)

`buddyTile({ id?, onPause, onResume, onRetry, onHistory, onOffer, orderHref })` in `blocks/gcsp/kit/buddy-tile.js` returns `{ root, update({ phase, result, pending, events, offerTitle, deadline }) }`. It composes `buddyStatus`, `activityTimeline` and `button` into the compact Option A tile: one readable state, visible Pause/Resume, two supplied events, a held-offer summary and a Buddy history action. It sends no requests or commands. Loading, setup, inactive, active, paused, held, unavailable and finished outcomes stay distinct; an accepted car has no Pause/Resume. Stable focus keys retain the search action across authoritative command readback. Setup and inactive states use concise readback without a redundant Review your preferences action; the editor is adjacent on Your cars. Shared `buddy-tile.css` is scoped and ratchet capped; gallery **GCSP Buddy tile** shows eight states.

The preference kit now responds to its own named inline-size container: six category columns above 1100px, three up to 1100px, two up to 600px and one up to 260px. Its meter/header and footer also adapt to the container, preserving readable labels beside the Buddy tile. The existing category stylesheet cap is unchanged.

### Your cars presentation extensions (FUCQ-405)

- `starRating({ pill: true })` adds the small opaque surface and 18 px stars, with 32 px desktop targets and 44 px coarse-pointer targets. Behaviour and retry remain shared. Styles: `star-rating-pill.css`; gallery: **GCSP star rating and help tip**, including failed save. Default callers retain the existing unboxed 44 px targets.
- `categoryPreferences({ sameAgain: { mode: 'choice', description, onToggle }, ... })` presents native alternative radios **Set my preferences** / **Same again, please!**. Same again hides tiles and shows the supplied current-car summary while retaining saved choices; returning to custom restores them. The server supplies understanding; no client match confidence is invented. `state.action.hidden` hides a redundant footer action. Styles: `preference-modes.css`; gallery: **GCSP understanding meter and Same again**. Default callers keep the switch. Account passes `buddyControls: true` when the Buddy tile owns Pause/Resume, hiding Disengage after engagement; inactive setup still offers Engage with validation and failure recovery. The footer action uses the shared primary-button sizing and typography; it has no enlarged desktop override.
- `buddyTile` puts its one authoritative search command in the heading and exposes **Buddy history**. Search settings/details is removed. The gallery keeps all eight distinct outcomes.
- `notificationModel` / `notificationRows` project only the current active offer and expired offers, deduplicated and capped at six. Decisions and preference/permission changes remain in Buddy history. Expired rows link to their supplied offer URL. `notificationBell` has no all-activity footer and reserves image space only for an actual thumbnail. Gallery includes an open expired-offer state; live badge, polling, note and focus behaviour are retained.

### Focused offer composition (Gary, 11 November 2026)

`vehicleDecisionCard({ ..., layout: 'focused', deadline, kicker })` extends the existing exact card with a separate summary panel and a media/facts column. The caller supplies the authoritative deadline node; the kit puts it with cost and actions. Four supplied overview facts sit under the gallery; **Full specification** retains all supplied facts and unknown treatment, and the existing equipment disclosure retains every item. `decisionHighlights({ benefits, tradeoffs, layout: 'list' })` uses equal-width, naturally growing lists without truncation. `mediaGallery({ ..., presentation: 'picker', fit: 'contain' })` uses centred image-only thumbnails in a white bar, retaining named buttons, failure handling and the enlarged viewer. Contain preserves the whole supplied image in the offer; the previously agreed cover default remains for other consumers. Defaults are unchanged. Shared styles: `kit/focused-decision.css`, imported by `vehicle-decision.css`; gallery: **Focused offer: four benefits and five tradeoffs**, **Focused offer: decision panel**, plus the existing gallery examples. Use these options instead of rebuilding offer cards, lists or image pickers in a view.

### Shared vehicle typography

`blocks/gcsp/kit/vehicle-summary.css` supplies opt-in roles used by Your cars and the focused Your offer card: `gcsp-vehicle-page` gives regular 14/20 body text; `gcsp-vehicle-heading` groups context, name and metadata with 4px spacing inside `gcsp-vehicle-copy`, which contains a strong system 23/28 `gcsp-vehicle-title`, muted regular 12/16 `gcsp-vehicle-context`, and regular 14/20 `gcsp-vehicle-meta`. Use existing Density tokens for these roles and 29px numeric accents. Keep section headings, facts and controls on their existing shared scale. The gallery shows the current-car roles beside the focused card; other decision-card layouts keep their defaults.

### Shared decorative finish shades

`finishLabel({ label, value, shade? })` uses `kit/finish-shades.js:finishShade` for a supplied supported shade or an exact recognised paint/upholstery name. Label text remains unchanged; the circle is decorative. The shared generated `finish-shades-data.js` is projected through `PolicyService` from `stock.optionLabels.v1`, `stock.paintColourFamilies.v1` and `presentation.finishShades.v1`. Correct the canonical policy, then run `node scripts/project-finish-shades.mjs`; `--check` and the focused regression reject a stale projection. Do not add per-view colour lookups or parse colour words from arbitrary prose. Unknown/unlisted/generic Individual paint and ambiguous upholstery retain neutral hatching. An explicit unsupported shade stays neutral. Existing consumers receive the mapping automatically. Gallery: **Vehicle finishes: known, unknown and mixed colours** and the focused offer. These are broad visual accents, not exact manufacturer paint samples or evidence of physical fitment.

### Focused offer title and car details (12 November 2026)

The approved Option B in `docs/gcsp/mockups/offer-details-2026-11-12/` supersedes the focused offer's two inline disclosures. Focused headings retain the shared 23/28 semibold title, with 8px between context and title and 20px before the finishes. `finishLabel({ ..., labelled: true })` preserves the supplied value in `.gcsp-finish-value` and adds a muted Paint/Upholstery label; top-aligned circles and 16px between rows support long trim names. The shared current-car heading and default finish layout keep their existing typography/spacing.

`vehicleDetails({ name, finishes, facts, decision, equipment })` in `kit/vehicle-details.js` composes the existing `button`, `factList`, `sideDrawer` and `tabs`. It returns `{ root, destroy() }`: one full-width **View car details** button with the actual equipment count opens the shared 480px drawer containing **Specification** and **Selected equipment (N)** tabs. All supplied specification nodes and equipment items are retained. Missing equipment says **Equipment not supplied**, never zero fitted items. Hidden retained content is inaccessible until opened; the shared modal provides inert background, scroll containment, close/Escape and focus return, while shared tabs provide arrow/Home/End navigation. Use this composition instead of building local offer disclosures or modals. `vehicleDecisionCard({ layout: 'focused', ... })` uses it and exposes `card.destroy()`; callers must invoke it before replacing/removing the card. The offer view preserves the drawer/tab across clock reads and tears it down on changed offer content/state and view destruction. Styles: `kit/vehicle-details.css`, with its own ratchet cap; gallery: **Focused offer: long finish and 57-item car details drawer**. Non-focused decision cards retain their equipment disclosure.

### Offer page spacing (12 November 2026)

The focused decision summary uses 24px between content groups; the countdown keeps its own width. Supplied overview facts use four columns above 1200px and two below, giving long dates room at compact desktop widths. List highlights use 20px top/24px side padding, 12px after their heading and 16px vertical row padding. Comparison `dataTable` cells use 12px vertical padding for readable paired values. The shared offer header centres its title and Back control; the offer composition leaves 32px before the decision comparison and 24px between its heading, highlights and table. Reuse these shared presentations; existing focused-offer and comparison-table gallery examples show the spacing.

## GCSP Angular shared kit (`apps/gcsp-web/src/app/kit/`)

FUCQ-439 introduces native standalone Angular equivalents because the DOM factories do not own Angular routes or authentication. Reuses the current portal header/rail, existing `blocks/gcsp/shell/` Density semantic CSS and packaged brand/font artwork without importing legacy controllers. The employee rail stays **Your cars, Order progress**; Greg adds **Employee car ordering**, both roles compose, and presenter keeps its dedicated controls. Reference: `docs/gcsp/screens/00-employee-account.webp` and kickoff baseline `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`.

| Angular primitive | Use and semantics |
| --- | --- |
| `button[gcspButton]`, `a[gcspButton]` | Primary/ghost shared action treatment. Native buttons retain type, disabled and click semantics; navigation uses links. |
| `div[gcspCheckboxField]` | Port of frozen `kit/form-controls.js:checkboxField`: inputs `controlId` (required nonempty caller ID), `label`, `checked`, `disabled`, `describedBy` and `switch` (default false); output `checkedChange: boolean`. The host is the actual `div.gcsp-check`; default order is input/associated label, switch order is label/input with `gcsp-switch` and native `role="switch"`. It retains literal label text and supplied checked/description state, emits only native change intent, and sends no requests or save confirmation. Use instead of local declaration/switch markup; the caller owns state and unique IDs. Global source CSS owns its presentation. Gallery: Source checkboxes and switches, including a disabled declaration with its visible reason. |
| `gcsp-option-list` | Single-select inputs `groupId`, `label`, `options: readonly OptionListOption[]`, caller-owned `value`, `disabled` and `variant: 'default' \| 'rows'`; optional boolean `required`/`invalid` bind `aria-required`/`aria-invalid` to the actual radiogroup (undefined preserves default omission), with no selection or validation policy; output `valueChange` supplies the exact selected value. Default retains the existing Stock gcsp classes. `rows` ports the frozen `renderOptionList` single-select rows branch with `vm-options vm-options-rows`, `vm-option`, label/sub and selected/disabled states; use it for source radio rows instead of local reason controls. Both modes retain native button radios, enabled roving tab entry, arrow/Home/End intent, absent saved values and stable element/focus across equivalent inputs. No multi-select, swatch, request or save policy is introduced. Global source CSS styles rows. Gallery: Source radio rows with interactive and disabled examples. |
| `gcsp-screen-intro` | Required title, optional concise lede/kicker and h1/h2/h3 level. Page h1 accepts arrival focus. Level 3 (`h3.gcsp-intro-title`) nests the title under an embedded h2 section with the same look as the h2. |
| `gcsp-status-screen` | Loading, unavailable, denied or unavailable-feature body; shared intro, busy/announcement semantics and projected actions. `level` (1, 2 or 3) follows the host section: an embedded h2 body passes 3 (FUCQ-502). |
| `gcsp-labelled-field` | Associated label and stable hint/error IDs from required `controlId`. Caller supplies its native input with matching `id`, `aria-describedby` and `aria-invalid`. |
| `gcsp-error-summary` | Readonly `errors: FieldError[]` retains `{ controlId, message }`. Default keeps the existing alert, section tabindex/focus, fixed heading ID/title, empty omission and native-target link behavior. Opt-in `presentation="source"` ports frozen `errorSummary`: requires caller-owned nonempty `summaryId`, accepts `title` (source default Check your choices), renders source heading/link classes and retains an empty root hidden. Its source-only host uses `display: contents` so a hidden summary adds no flex item. After rendering updated nonempty errors, `focus()` focuses the source h2 (default mode focuses its section); it never focuses automatically. Source links prevent fragment navigation and focus the actual control, or invoke supplied `onSelect(id)`. Use for validation and actual field jumps instead of local error lists; no save/request policy. Gallery: Source validation summary, configured/empty states and real field link/focus. |
| `gcsp-data-table` | Native caption, column/row headers and explicit header associations; rows stack below 640px with visible labels. Supplied literal cells, stable row IDs, one employee-named Open action, disabled/empty states and `focusRow(id)` for return focus. The component emits an ID and sends no requests. Gallery: Case queue table. |
| `gcsp-vehicle-card` | Released-car presenter with required exact `memberId`/`name`, optional line/order number, provided images/fallback, nullable points/allowance/contribution, supplied eligibility, `reviewDisabled`/`disabledReason` and `FactRow[]`. Emits `{ memberId, action: 'review' \| 'details' }`; no fetch, policy or claim. Native collapsed Car facts retains missing/zero/false. Disabled review reasons have unique accessible IDs. Gallery: Released vehicle card, with unavailable review and explicit details feedback. |
| `gcsp-media-gallery` | Port of frozen `kit/media-gallery.js`: supplied `{ src, alt?, caption?, fidelity?, sourceRef?, viewpoint?, label? }[]`, name and placeholder; one displayed-view projection drives feature/thumbnails/viewer, selection, failures and counts. Exact display allowlisting reuses the existing Activity data through the one pure `kit/vehicle-image-assets.ts:isDisplayImage`, with frozen absent-fidelity fallback, brand-hero exception, first-src deduplication and label/alt defaults. The Angular host is the source `.gcsp-media-gallery` root; no extra wrapper breaks direct-child decision CSS. Optional `presentation="picker"` and `fit="contain"` retain source variants. Stock keeps `compact` (default false), a 180px image/fallback without thumbnails/caption/enlarge; entering compact closes the viewer and resets selection. Raw image/name equality preserves selection/failures/viewer on equivalent readbacks; no source requests or generated imagery. Use instead of view-local image pickers/viewers. Gallery: Source vehicle images and Focused decision layout shell. |
| `ShellComponent` / `AuthPort` | Native Angular shell/router and typed account states, role destinations, narrow menu, account disclosure, skip link and deliberate auth actions. Default auth is unavailable until the real adapter is wired; no successful fixture login. |

App-local gallery: `/gcsp/components`. Focused Angular tests exercise role policy/direct-entry guards, state presentation and rendered kit semantics; app-local boundary checks enforce semantic colours, pinned production AOT and the CSP/controller boundary. Browser and real OIDC/Java acceptance remain separate gates; future feature bodies reuse this kit.

FUCQ-555 MediaGallery is a source checkpoint. Global source CSS and packaged-image serving require supported F548/F551 integration. Source icon controls still retain the pre-existing ButtonDirective; adopt F556's one compatible source-presentation option through supported integration rather than copying its directive. Real image responses, keyboard/browser critique and live same-state parity remain unverified; source selector coverage is not visual acceptance.

### Angular preferences and rating (FUCQ-441)

`gcsp-preference-category` and `gcsp-star-rating` in the Angular kit are native standalone
presenters. Category inputs are the server definition, considered/unset state, open/removing and
disabled flags. Outputs express value/importance changes, open, request removal, remove and keep.
Multi choices use checkboxes; stops and medium/high importance use separate radio groups. Unset
categories read Not important. Removal requires an explicit Remove preference action with a Keep
preference alternative. Stars use a named native radio group for 1–5 and a Clear rating button.
Tab, Space and the native radio arrow keys operate these controls; focus outlines remain visible.
Disabled states retain readable answers. Gallery: **Preference categories and current-car rating**,
including high importance, removal, unset/disabled, selected stars and an unconfirmed-save message.

`gcsp-account-preferences` and `gcsp-current-car-rating` compose those presenters with the shared
root `BriefEditorStore`. Account inputs are `carDescription`, and `contractId` for rating. Rating
is hidden unless the editor's current contract matches exactly. The compact editor contains no
recommendations. Its meter is server-projected input completeness and labels unsaved projections.
Same again keeps the categories and prevents category edits while selected. Preferences, rating
and Same again share a versioned save queue; unavailable outcomes retain retryable intent, stale
outcomes require explicit reload, and identity/run changes clear the local state. Full preferences
uses the same scoped editor resource, native position/importance/practical inputs, read-only facts,
server preview decisions and explicit draft-save/confirmation. These fixture checks do not establish
Java, OIDC, database, hosted-browser or accessibility acceptance.

`gcsp-buddy-controls` presents the saved server Buddy view and native Engage, Pause search, Resume
search and Disengage actions. It reports paused search separately from withdrawn consent, keeps
uncertain requests available for an explicit same-command retry, and provides a status reload. Its
gallery states use inert projections with actions disabled; the live compact and full preferences
views bind its outputs to the shared `BriefEditorStore` command lane.

### Angular manual review and summary (FUCQ-443)

`ManualRouteComponent` composes the existing screen intro, status, vehicle media, facts,
native fields, declarations and buttons at employee-guarded `manual/review` and
`manual/summary`. Stock passes its exact supplied selection through the scoped in-memory
`ManualStore`; navigation history carries no quote or command authority. Leaving an open
claim waits for actual release. Saved orders use the existing order-progress destination.
The current Java response lacks the frozen contact/return details and review version,
so final submission stays unavailable. This composition adds no shared primitive;
connected and rendered acceptance remains open.

### Angular employee order progress (FUCQ-446)

`gcsp-orders` (`apps/gcsp-web/src/app/orders/orders.component.ts`) is the native standalone
employee screen at `/gcsp/orders`, with optional `?orderUuid=...` for an exact order. It has
no component inputs or outputs; the router supplies query state and the injected
`OrdersClient` supplies authenticated reads and supported employee commands. The screen
composes `gcsp-screen-intro`, `gcsp-status-screen`, `gcsp-fact-list`, `gcsp-labelled-field`
and `gcspButton` with supplied stage, task, slot and history lists. It uses the existing
semantic tokens, exact vehicle imagery with a missing-image fallback and the designated
current-car relationship source.

The orders screen owns lifecycle presentation and explicit action review/confirmation;
the existing client/controller/actions own scoped reads and the employee command lane.
Refresh reads authoritative state, and authentication recovery does not replay a write.
This is a routed composition, with no new shared primitive or gallery API. Selected
component/route tests provide fixture evidence; rendered browser and connected Java/OIDC/
database acceptance remain separate, open checks.

### Angular Greg demand and policy (FUCQ-448)

`GregRouteComponent` at Greg-guarded `/gcsp/greg` composes the existing screen intro,
status, labelled fields, error summary and buttons with demand and policy presenters.
Demand keeps the server's privacy bands and evidence; policy changes remain bound to
the server's current version and matching preview. Publication stays unavailable when
the server cannot supply that preview. Read-only demand tables use native captions and
headers with the existing semantic tokens; the shared case table's employee Open action
does not apply. This routed composition adds no shared primitive or gallery API.
Connected Chromium evidence against Java, local OIDC and PostgreSQL 17 is in the FUCQ-448
Result; publication through this screen waits on Java policy preview.

### Angular selection and order stages (FUCQ-555, shared with FUCQ-556)

These are the canonical Angular ports of frozen Node
`e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38` `kit/stage-list.js`,
`kit/stage-tracker.js` and `kit/order-identity.js`. Consumers reuse them instead of
building local stage lists, timelines or reference labels. They preserve source DOM,
classes and state classes and consume FUCQ-548's canonical global CSS; this source
checkpoint does not establish stylesheet integration, rendered parity or acceptance.
Reconcile their rows with FUCQ-548's complete Port status inventory at integration.

| Source presenter | Angular target and public contract |
|---|---|
| `stageList` | `StageListComponent` / `gcsp-stage-list` in `apps/gcsp-web/src/app/kit/stage-list.component.ts`: inputs `heading` (Progress), `stages: readonly { name, state }[]`, `level` (1–6, default 2), and optional `labels`. Supplied names/order/state classes remain; complete/waiting/not-started/pending/failed read Done/Waiting/Not started/Sending/Not accepted, unknown labels read Unknown. Unique heading association; no stage inference or commands. |
| `stageTracker` | `StageTrackerComponent` / `gcsp-stage-tracker`: inputs `heading` (Progress), `stages: readonly { label, state, at?, owner?, next?, note? }[]`, `level` (1–6, default 2). Source done/current/upcoming/declined/blocked wording remains; current and blocked carry `aria-current="step"`. Unknown state uses the source upcoming presentation. Valid instants retain `datetime` and the ONE existing `activity/activity.copy.ts:formatActivityTime`, imported as `demoTime`; invalid/absent time is omitted. Supplied owner/Next/note remain; no business state or clock is advanced. |
| `orderIdentityRows` / `orderReferenceOf` | Pure helpers in `kit/order-identity.ts`. A supplied reference matching `/^[A-Za-z0-9-]{1,32}$/` is retained exactly, otherwise omitted. Rows are Order reference when supplied, then Car order number including explicit missing value; neither identity is derived from the other. |

Both presenter hosts use `display: contents` to preserve source geometry. No source
stylesheet or formatter is copied. FUCQ-555's offer integration and FUCQ-556's order
screen must use these same ports; the offer's accepted short confirmation remains
separate from its refused-selection stage list. Gallery: **Selection and order stages**
shows complete/waiting/not-started/pending/failed selection states, exact order identity,
dated current/upcoming order stages, declined/blocked owner/next states. Focused tests
cover source wording/order, heading association, missing/unknown values and London time.

### Angular finishes and decision presenters (FUCQ-555)

The shared pure employee copy helpers live in
`apps/gcsp-web/src/app/preferences/brief.copy.ts`. Preferences and offer projections
reuse the same `reasonText(entry, kind)` before displaying reasons, tradeoffs,
blockers and unknowns. Supplied sentences win; mapped codes become plain sentences
and unknown codes use the kind's neutral fallback. Calendar dates keep their day;
ISO instants with an explicit zone use the London day, without a locale comma.
`bodyStyleLabel(value)` uses the existing body enum and title-cases other nonblank
strings; `fuelSpecLabel(value)` returns only the existing four fuel enum labels or
null, leaving each source caller's fallback intact. Generic `choiceLabel` is
unchanged. These are data helpers with no DOM, requests or business decisions.

These source presenters reuse FUCQ-548's global styles without copying CSS. Their
hosts use `display: contents`. They fetch nothing, emit no business commands and
infer no eligibility, comparison winner, clock or saving. This source checkpoint
does not establish stylesheet integration, offer composition, rendered parity or
acceptance; reconcile with FUCQ-548's complete Port status inventory at integration.

| Source presenter | Angular target and public contract |
|---|---|
| `finishLabel` / `finishShade` | `FinishLabelComponent` / `gcsp-finish-label`: required `label`, optional `value`, `shade` and `labelled` (false). Source `.gcsp-finish`, decorative `aria-hidden` swatch, unknown hatching class and full readable label/value remain. `kit/finish-shades.ts` owns the ONE shared palette, neutral and exact-name resolver; `finish-shades-data.ts` preserves the frozen generated projection, its source keys and digest. NFKC/whitespace/case normalization and Paint/Colour/Upholstery/Interior aliases remain. An explicit unsupported shade stays neutral; unknown, generic and ambiguous names do not imply a colour. Reuse this presenter and mapping instead of per-view swatches or parsing colour/stitching words. |
| `decisionHighlights` | `DecisionHighlightsComponent` / `gcsp-decision-highlights`: readonly `benefits`/`tradeoffs` entries `{ number?: string \| number, title, detail? }`, `layout: 'default' \| 'list'`. Source Benefits/Tradeoffs groups, number emphasis including zero, all supplied entries/details and exact empty states remain. The caller supplies grounded comparisons; the presenter selects no priorities or winners. Use instead of local highlight grids/lists. |
| `vehicleDecisionCard` decision layout shell | `VehicleDecisionComponent` / `gcsp-vehicle-decision`: supplied `name`, `kicker`, `finishes`, nullable numeric `points`/`allowance`, optional supplied `contribution`/`pointsDifference` text and `layout: 'default' \| 'focused'`. Keeps source decision root, summary/head/terms/finishes/details classes, focused labels, finite/zero/missing cost treatment and summary/actions before media in reading order. Content slots are `[decisionDeadline]`, `[decisionActions]`, `[decisionNote]`, `[decisionMedia]`, `[decisionOverview]`, `[decisionDetails]`. Reuse the shell instead of building a local offer layout. Generic exact-card behavior and actual media/facts/decision/equipment presenters are not implemented or claimed by this shell; the caller must retain every supplied detail through the canonical shared presenters at integration. |

Gallery: **Vehicle finishes and decision highlights** shows known, mixed, unsupported
and missing finishes; five uncapped benefits, zero emphasis, default/list layouts and
empty groups. **Focused decision layout shell** shows static summary/deadline/actions
with explicit media/details slots, not a live offer. Compatible source FactList,
MediaGallery, VehicleDetails, SideDrawer/Tabs and generic exact-card composition remain
separate named integration obligations. Focused tests cover the source display
contracts; every original FUCQ-555 acceptance criterion remains open.

### Angular source facts and tabs (FUCQ-555)

Extend the existing canonical components instead of creating offer-local facts or
tabs. Both reuse FUCQ-548's original global source styles. This source checkpoint
does not establish stylesheet integration, rendered behavior or live acceptance;
reconcile with the complete Port status inventory during supported integration.

| Source presenter | Angular target and public contract |
|---|---|
| `factList` | Existing `FactListComponent` / `gcsp-fact-list` keeps `rows: readonly FactRow[]` and `hideMissing`. Add `presentation: 'default' \| 'source'` (default `default`) and source-only `className` for options such as `vm-facts-pair gcsp-vehicle-overview`. The source variant keeps `.vm-facts`, `.vm-fact`, `.vm-fact-label` and `.vm-fact-value`; zero, false and supplied whitespace remain supplied, and null/undefined/empty values use the supplied missing label or Not supplied without a unit. Hidden missing rows use the exact `.vm-facts-wrap` plus one `.gcsp-note.vm-facts-more` summary; all missing gives only the summary, while no missing/empty input keeps the unwrapped definition list. Default callers retain their `gcsp-facts` presentation. Existing local label/value rules are scoped to that default so they cannot override source facts; only the source host uses `display: contents`. Use the source variant for canonical offer overview/specification and identity rows instead of hand-built definition lists. |
| `tabs` | Existing `TabsComponent` / `gcsp-tabs` keeps required accessible `label`, readonly `items: { id, label, content: TemplateRef }[]`, optional `initialSelectedId` and `selectionChange`. Source root/list/tab/panel classes include `.gcsp-tab-list`; associated unique IDs, retained panels/hidden state, selected roving tab stop, arrows/Home/End automatic activation and focus remain. A valid selection survives equivalent readback; a removed selection falls back to the initial/first valid ID under the existing Angular contract. Local copied presentation rules are removed; only `display: contents` host adaptation remains. Use this same port for car details and Greg instead of local tab markup. |

Actual existing callers are retained: Tabs serves VehicleDetails and GregRoute;
FactList serves help, stock, orders, Greg planning/production/demand/policy,
presenter, manual review/summary, cases, VehicleCard and the gallery. Gallery:
**Source facts and tabs** shows paired/overview rows, zero/missing facts, mixed and
all-hidden summaries and accessible tab panels. **Selection and order stages** now
uses the source variant for exact identity rows. Media, complete details, drawer,
generic-card and offer composition remain separate named obligations; no such
presenter is claimed source-equivalent by this extension.


### Angular source side drawer (FUCQ-555)

The existing `SideDrawerComponent` / `gcsp-side-drawer` now uses the canonical
source backdrop and single `aside[role="dialog"][aria-modal="true"]`, with
`.gcsp-side-drawer-head`, `-titles`, `-title`, `-body` and `-foot`. It consumes
FUCQ-548's global sheet; local CSS only adapts the Angular host with
`display: contents` and hides an empty retained footer projection. The root is
retained with `hidden` while closed, preserving Angular projected content without
exposing it. No native dialog wrapper or second accessible dialog is introduced.

Public contracts remain `title` (required), `context` (empty by default),
`dismissible` (true), `closed`, `open(opener?)` and `close(restoreFocus = true)`.
Body content projects normally and `[drawer-footer]` projects outside its scrolling
body. Opening focuses the associated heading, contains page scrolling and marks
background siblings inert; closing restores prior scrolling/inert attributes and
the connected opener. Tab/Shift-Tab wrap across visible enabled controls, including
summaries/iframes; hidden, inert and closed-details contents stay outside the cycle.
Escaped focus returns to the heading. Close/Escape/backdrop obey `dismissible`;
public API close remains available for terminal readback and teardown. Destroy
removes listeners and restores page state without focusing a removed opener.

VehicleDetails and OfferDecision remain the actual production callers. Their
regressions retain all content, business, count and focus assertions while querying
the source modal instead of the obsolete native wrapper. Gallery: **Source side
drawer** demonstrates a normal record and nondismissible pending-command preview.
This source checkpoint does not establish F548 stylesheet integration, real browser
visual/focus/inert behavior, connected acceptance or same-offer parity. All eight
original FUCQ-555 acceptance criteria remain open.


### Angular source car details (FUCQ-555)

The existing `VehicleDetailsComponent` / `gcsp-vehicle-details` composes the ONE
source SideDrawer, Tabs and explicit source FactList ports. The source control
contains the entry and retained hidden drawer content, the supplied name in
`h3.gcsp-h2`, specification facts followed by the optional supplied template,
and the complete equipment list in `.gcsp-vehicle-equipment > ul`. The component
adds no Finishes/Vehicle facts headings. Null/empty finishes are omitted; supplied
whitespace and explicit missing facts remain. Missing equipment reads
**Equipment not supplied.** and the entry always starts **Full specification ·**,
with the actual singular/plural count when equipment is supplied. The owned entry
keeps source `vm-btn vm-btn-ghost` classes beside its existing ButtonDirective.
All copied local presentation rules are removed; only the Angular host uses
`display: contents`, consuming FUCQ-548's canonical global source styles.

Public inputs are `name`, readonly `finishes: VehicleDetailRow[]`, readonly
`facts: FactRow[]` (existing string/null callers remain compatible), `equipment`
and `additionalDetails: TemplateRef | null`; the latter retains the
supplied decision/detail seam. `VehicleDetailRow`, `isOpen`, `tabItems`,
`openDrawerFromEvent`, `openDrawer`, `displayValue` and `onDrawerClosed` remain.
Optional `factsPresentation="source-card"` wraps those supplied raw facts in
`.vm-card-facts` and reuses FactList's `vm-facts-pair` and
`hideMissing="More details not supplied"`. It retains zero, false and supplied
units; missing rows produce one note. The default preserves its prior DOM and
explicit missing rows. Use the option for the pending offer's bounded source
facts instead of local fact markup. The raw JSON snapshot and separate TemplateRef
identity guard remain: equivalent readback preserves the open drawer/tab/focus;
changed raw details, template or presentation closes and resets to Specification.
OfferScreen's pending card uses this option; nonpending and OfferFollowup retain
their default bindings. No facts are replaced with an empty guard snapshot.

Gallery: **Source car details** shows long finishes, all 57 equipment entries,
a supplied decision template, missing-equipment/finish values and the exact-card
source facts option with raw zero/false, units and a hidden missing row. This is a source
checkpoint; F548/shared-button style integration, real browser/visual behavior,
connected acceptance and same-offer human parity remain separate gates. All eight
original FUCQ-555 acceptance criteria remain open.


### Angular source heading and status presenters (FUCQ-555)

Extend/reuse the existing ScreenIntroComponent and StatusScreenComponent instead
of local heading/status markup. Their element selectors and default presentation
keep the legacy DOM/classes, level-one default, busy/announcement semantics and
projected actions. Optional presentation="source" ports frozen ui.js helpers:

| Source helper | Angular source contract |
|---|---|
| screenIntro | Use native div[gcspScreenIntro] with presentation="source", required title, optional kicker/lede and level1–6 (source default2). The DIV is the actual root; direct vm-kicker, hN.vm-title and vm-lede children preserve source ordering and omit absent copy. Native class binding supplies the source helper's optional root class. |
| statusScreen | Use native div[gcspStatusScreen] with presentation="source", required title, optional kicker/message, level1–6 (source default2), announcement (status/alert/null) and existing busy. Actual root is DIV.vm-screen.vm-status; heading/message and caller-projected actions are direct children, with no nested intro/panel/action wrapper. Null announcement omits role; busy retains the existing truthful aria-busy semantics. |

The native DIV hosts need no copied stylesheet, display workaround or view-local
styling. OfferScreen uses source level1 for normal intros and refused-selection
status; its existing heading-focus code supplies tabIndex when focus is needed.
Idle/loading/read-failure and generic/uncertain state composition remain separate
original gaps. Gallery: Source headings and status demonstrates both default-level
source presenters with supplied copy/actions. Direct tests cover all six source
levels/default2, absent copy, optional roles/busy and unique interactive projected
actions; legacy/default behavior remains explicitly tested. F548 CSS/F556 Button
integration, rendered/browser/connected pairs and human acceptance remain open.


### Angular source loading skeleton (FUCQ-555)

Port/reuse LoadingSkeletonComponent on native div[gcspLoadingSkeleton] instead of
page-local placeholder markup or a generic status box. It preserves frozen
kit/loading-skeleton.js hierarchy/classes for page, form, timeline, card, feature,
console, section, release-grid, stats, bars, offer and media layouts; unknown layouts
fall back to page. Inputs are label (Loading), layout (page), role (status or null),
optional items and labels. Source defaults are100tiles/5stats/3bars; explicit zero
and supplied stat labels keep their source meaning without invented counts/caps.
The actual DIV.gcsp-skeleton has data-layout/aria-busy; its one gcsp-vh paragraph
owns the role/label, while all artwork is under aria-hidden=true. It has no image,
control, request, business clock or own stylesheet. Source CSS owns motion/geometry.

OfferScreen loading composes the source hidden Your offer h1 and offer-layout
skeleton labelled Loading your offer. Existing same-offer/account refocus,
no-focus-theft/stale/dispose guards remain; loading and ready headings are distinct
DOM nodes even though their text matches. Gallery: Source loading skeletons shows
all12layouts with non-announcing example labels. Source layout/count/label/role
and nested offer/feature/text-card contracts have focused tests. F548 global CSS,
actual browser/rendered behavior and live same-state human parity remain open.
