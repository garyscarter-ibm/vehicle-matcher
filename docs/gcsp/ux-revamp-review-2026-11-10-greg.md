# GCSP UX revamp review, Greg and the presenter, 10 November 2026

Follow-up to FUCQ-248. Scope: Greg's dashboard (demand, policy and weights, next order, order requests and
production, route comparison, renewal cases), the case queue, the captured outbox and offer email, and the
presenter entry and flyout. Paula's screens are reviewed separately. Desktop only (1280x900), by Gary's scope
change during the run; no phone walks or touch-target checks. Walked on `claude/gcsp-ux-revamp-166206` at 7c90d936.

Brief (Gary): "the UX is atrocious"; "the screens are very busy, a common trait with AI screens. We need to be
more minimal and meaningful with our presentation, with correct hierarchy and consistency." Judged against
`docs/gcsp/density/ui-revamp-spec.md` "Minimal and meaningful": one level of boxing, colour means something,
four type steps, one rhythm, rows not cards, one primary action per region. Visual tokens, type steps, buttons
and the shell were fixed by the visual pass (95f39141 and later) and are not re-reviewed.

Tags: **LAYOUT** = presentation or flow change that keeps current behaviour, buildable now. **FEATURE** = new
behaviour or changed acceptance, becomes a backlog Story under the build rules. Kit: *as is*, *extend*, *new*.

## Method

- Harness: `docs/gcsp/evidence/fucq-248/revamp-2026-11-10/walk-greg.mjs` (a copy of `../walk.mjs` with the server
  path, port range 9295-9299 and a flyout-aware `openStrip`) and `sections-greg.mjs` (sections `presenter`,
  `dashboard`, `actions`, `comparison`, `queue`, `outbox`). Offline host (`GCSP_OFFLINE=1`), memory repository,
  Playwright Chromium. The route comparison is loaded from the stored result
  `server/data/gcsp/comparison/process-only.json` through `GCSP_COMPARISON_RESULT_FILE`, as the hosted demo does.
- Greg is reached as the run sheet's 10:00 beat says: Reset **Decline then change**, switch to Greg.
- Busyness is measured by script per region (`busy()` in `sections-greg.mjs`): boxed regions (a border on three
  or more sides, or a fill that is neither white nor the page grey, wider than 60 px), deepest box nesting,
  headings, buttons (including `summary`), primary buttons, tables, lines of prose outside tables, and words.
- Accessibility kept light, as briefed: focus after each action (flagging BODY), and a Tab walk per screen.
- Screenshots: `docs/gcsp/evidence/fucq-248/revamp-2026-11-10/greg-<screen>-1280-<nn>-<state>.png`, and region
  crops `greg-<screen>-1280-r<nn>-<state>.png`.

## Screen by screen

### Presenter entry and flyout (`gcsp-presenter.html`)

Evidence: `greg-presenter-1280-01-gate.png` to `-07-switched-to-greg.png`.

**One job:** let the presenter move the story on (Reset, Tick, Next release, Switch principal) without the
audience noticing the machinery.

**Competes with it:** a readback of four raw facts (32-character run id, ISO clock with milliseconds), a
nine-item scenario list where every item says "Available", two fault pickers with seven options and two Set
buttons, a six-person principal list, Refresh readback, and a "Last tick" log with step results.

| Measure | Flyout open |
|---|---|
| Scroll height in an 826 px panel | 2,294 px (2.8 screens) |
| Buttons (incl. summary) | 34, two primary (Tick, Switch principal) |
| Headings | 3 (Presenter controls, Faults, Last tick), plus a second "Presenter controls" summary inside |
| Boxed rows | 9 scenario rows, 7 fault rows and 6 principal rows, each a bordered box |
| Tab stops to cycle the panel | 18 |

Landing (`-02-landing.png`): one white panel, "PRESENTER WORKSPACE / Choose an acting principal in Presenter
controls.", an empty rail apart from the sliders icon at the bottom. The instruction names a control the presenter
cannot see until they find an unlabelled icon at the bottom left.

Findings 6 and 14 in the ranked list below.

### Greg's dashboard (presenter workspace as Greg, `gcsp-presenter.html`)

Evidence: `greg-dashboard-1280-01-arrival.png`, `-02-full.png` (the whole page), region crops `-r01` to `-r10`;
actions `greg-actions-1280-r01` to `-r10`. Reached live: Reset Decline then change, switch to Greg.

**One job:** decide what to order next. The run sheet's 10:00 beat is "Next order: set Min 2, Preview, Request
from Production, confirm under Production controls: Replanned". Everything else on the page supports that
decision or answers 12:00 ("Is it better?").

**Competes with it:** four headline tiles that all read "<5", four one-row demand tables, an empty unmet-needs
table, a stock table of "<5", five more "<5" tiles and an empty declines table, then a 790 px policy editor,
before Next order starts at 2,330 px (the third screen). Below it: a second, manual way to order cars (Request
cars), Production controls, an 11-measure comparison and the case queue.

| Measure (whole `main`) | At arrival |
|---|---|
| Page height | 7,202 px (eight screens at 900 px) |
| Boxed regions / deepest nesting | 33 / 2 |
| Headings | 41 (1 h1, 10 h2, the rest h3/h4) |
| Buttons (incl. disclosures) | 20, **four primary** (Publish this preview, Request from Production, Submit request, Save production response) |
| Tables | 13 |
| Lines of prose outside tables / words | 268 / 1,958 |
| Above the fold at 1280x900 | breadcrumb, h1, lede, a five-fact meta box with two caveats, a status line, four "<5" tiles, then demand. No action. |

Per region:

| Region | Height | Boxes | Headings | Buttons (primary) | Tables | Prose lines | Words |
|---|---|---|---|---|---|---|---|
| At a glance | 129 | 4 | 1 | 0 | 0 | 8 | 29 |
| Demand | 343 | 4 | 1 | 0 | 4 | 2 | 84 |
| Unmet needs | 206 | 1 | 1 | 0 | 1 (empty) | 2 | 45 |
| Stock | 301 | 1 | 1 | 0 | 1 | 2 | 87 |
| Offers | 280 | 6 | 1 | 0 | 1 (empty) | 11 | 55 |
| Preview and publish policy | 788 | 1 | 1 | 4 (1) | 0 | 69 | 554 |
| after Preview changes | 1,432 | 4 | 2 | 4 (1) | 2 | 75 | 683 |
| Next order, no order recommended | 1,673 | 9 | 5 | 4 (1, disabled) | 4 | 38 | 311 |
| Next order, Change limits open | 2,650 | 9 | 5 | 4 (1) | 4 | 38 | 416 |
| Next order, preview (Min 2) | 3,347 | 13 | 6 | 5 (1) | 7 | 40 | 517 |
| Order requests (+ Production controls open) | 485 (581) | 2 | 2 | 4 (**2**) | 1 | 2 | 67 (88) |
| Route comparison | 2,482 | 2 | **25** | 6 (0) | 1 | 120 | 615 |
| Renewal cases (empty) | 313 | 2 (nested) | 2 | 1 | 0 | 3 | 33 |

What the walk showed, in demo order:

- **Arrival.** "DEMAND AND SUPPLY" twice (breadcrumb and h1), then a lede that the Demand section repeats almost word
  for word ("What employees have saved and confirmed they need..." appears three times on the page: lede, meta-box
  caveat, Demand note). The meta box shows `gcsp-policy-v1+offer-journey-v1`, "Brief version 1" and "Figures
  version 9f45ad69". Then "Figures updated for 5 Nov 2026, 09:30 GMT." repeats the box's "Figures for" fact. Every
  figure on screen one is "<5" (9 Nov finding 25, still present).
- **Demand and offers.** Four tables of one row each, then five tiles, all "<5". Each block has its own caveat
  sentence ("not satisfaction and not a prediction" is said twice; "Rows can overlap, so do not add them together"
  sits above an empty table).
- **Policy.** Kicker "Policy" over "PREVIEW AND PUBLISH" in page-title type. A points-row picker over about 75
  derivatives, a full-width cost input, six weight inputs each with a "Now 1" hint, Sources and assumptions closed
  (good: 9 Nov finding 21 is fixed), then Preview changes, a disabled Publish this preview and Refresh policy. After
  Preview the comparison is four rows of "<5 / <5 / Unknown (privacy bands)" and one "Suppressed for privacy", so
  the preview shows Greg nothing he can act on in this cohort. **Focus fell to BODY after Preview changes**
  (`focusAfter policy-preview: BODY`).
- **Next order, before change.** "NO NEW ORDER RECOMMENDED", then Change limits drawn as a 90 px empty box, then a
  disabled primary with its reason, a three-fact meta row (with the policy key again), a caveat, a 5-row table of
  zeros, a 4-row totals table of zeros, three tiles, an unmatched-supply table, ten bullets of unmet needs for one
  renewal (five are "Not every version of X is eligible"), an alternatives table and a "Learned model" note.
- **Next order, Min 2 then Preview.** Works and lands focus on the new h2 "Order 2 vehicles: 1 Series Sports Hatch
  120" (good). But the open limits editor (five derivative rows with Min, Max and a slider each, plus budget) sits
  between the headline and the result, so "Request 2 vehicles from Production" is about 1,000 px below the
  heading the focus went to. The preview's policy version shows `preview-09781888adee6b3a6e7aff9f`. The result is
  "Differences from the current plan" (one row, good) and "Outcome before and after", then the full proposed-order
  and totals tables again, mostly zeros.
- **Request, then Production.** "2 vehicles requested from Production" with "See this request in Order requests"
  (good, 9 Nov finding 22 is fixed). Order requests shows the row as Requested. Production controls is a closed
  disclosure under a second, manual "Request cars" form with its own primary Submit request. After Save production
  response, focus lands on "Replanned after a Production response" (good) and the plan says no new order.
- **Route comparison.** Now has a one-sentence verdict at the top (9 Nov finding 26 is fixed): "Today's release
  route did better: it covered 14.8% before renewal, against 11.8% on the buddy route, across 3 seeds." Then a
  four-card experiment picker where three cards say "not run yet", the stored time three times (picker, h3, meta),
  a code revision, and eleven measures in two columns, each with an h3, an h4 "Mean and range across seeds", two
  range bars, a difference line and "X better / Higher is better". The two facts the presenter quotes at 12:00
  (64 days held but not taken; 3.6% against 15.8% for delayed access) are measures 3 and 9 of 11. "What this
  replay leaves out" includes "(FUCQ-227)" and "Live corpus realism/integration is separate acceptance evidence."
- **Renewal cases.** Page-title-style heading, a caveat, "0 renewal cases loaded.", Refresh queue, then a nested
  bordered box "NO RENEWAL CASES / There are no renewal-risk cases right now." The empty state is said three times
  and boxed twice.
- **Rail.** Four items: Demand and supply (current), Publish stock, Order tracking and Next order. **The last three
  are disabled**, although all three exist on this page. "Publish stock" names a region headed "Preview and
  publish" that publishes policy, not stock; "Order tracking" is headed "Order requests".
- **Keyboard.** The Tab walk reaches every control with a visible ring; 40 stops from the rail to Refresh queue,
  seven of them table scroll regions. No loss apart from the policy preview above.

### Captured outbox and the offer email (`gcsp-outbox.html`)

Evidence: `greg-outbox-1280-01-empty.png`, `-02-list.png`, `-03-message.png`, `-r01-email-body.png`. Reached live:
Reset Main successful journey, Next release, open the outbox.

**One job:** show the audience the email Paula received, as she would see it, at 3:30.

**Competes with it:** a page shell around the email that says the same thing several times, and a second full copy
of the email in monospace.

| State | Height | Boxes | Headings | Buttons (primary) | Prose lines | Words |
|---|---|---|---|---|---|---|
| Empty | 316 | 2 | 2 | 1 | 5 | 38 |
| List, nothing selected | 242 | 2 | 1 | 2 | 7 | 36 |
| Message open | 1,269 | 2 | 4 | 3 (1) | 10 | 95, plus the email |

- "CAPTURED EMAILS" twice (breadcrumb and h1), a lede "Captured messages and delivery status.", then a bordered
  status bar "1 captured email, newest first." with Refresh. The bar is inset 16 px from the h1's left edge, the only
  element on the page that is.
- The subject "Your vehicle offer is ready to review" appears three times in view (list row, h2 in the detail pane,
  h1 inside the email), and the car and points twice more in the plain-text copy below.
- Facts above the email: To, Status "Captured, not sent", Time, **Attempts 1**. Then a primary "Open the offer".
  Then "Email as received" (the email in a bordered frame), then "Plain-text version" (the whole email again).
- The email itself is better than on 9 Nov (finding 23): it names the car, the points and "Respond by 11:30 on
  Thursday 5 November". Still present: the first line is the internal product name "GCSP employee vehicle scheme",
  and the raw link (about 190 characters, including `#token=...`) is printed in full under "If you cannot use the
  link, copy this address", on a slide the audience reads.
- With one email, the list still needs a click before anything shows ("Select an email to read it.").
- Focus after opening the email goes to its h2 (good). The outbox rail has three items (Captured emails, Clock,
  Scenarios), which no other presenter page shows.

### Presenter flyout, detail

- **Readback first, in body type.** The panel opens on Scenario, a 32-character Run id, Clock (UTC)
  "2026-11-05T09:30:00.000Z" broken over two lines, and Acting principal "Paula Mason (employee)". The run id is
  never needed on stage.
- **The scenario list is nine bordered two-line cards**, each with the sub-line "Available". Nine identical
  sub-lines carry no information; "Clock and reset mechanics" is a test fixture, not a story.
- **Faults are always open:** two pickers of seven bordered rows and two Set buttons sit between Reset and Switch
  principal, although no beat in the run sheet uses them.
- **The principal list is six rows labelled by role key** ("Greg Lawson (greg)", "Presenter (presenter)").
- **After an action the panel stays where it was scrolled**, so after Reset the status line "Reset done. New run:
  7f97...dc4. Acting as Paula Mason." is drawn as a focused bordered box near the bottom
  (`greg-presenter-1280-06-reset-done.png`). Focus lands on it (good), but it shows a run id again.
- **Switching to Greg** takes Reset, then scrolling to the principal list, picking a row and Switch principal, then
  a Reload prompt. That is five actions for the 10:00 beat. The walk logged `reloadPrompt: true` after each switch.
- **Keyboard:** 18 stops round the panel, ring visible on all, Escape closes it from outside the controls. When
  the walk sent Escape with focus on the page heading, the flyout stayed open (`afterEscape: true`), which is
  correct for a non-modal panel.

### Renewal case queue (`gcsp-case-queue.html`, and embedded on the dashboard)

Evidence: `greg-cases-1280-r01-embedded-live.png` (live, empty), `-01-standalone-live.png` (live, empty),
`-02-queue-populated.png`, `-03-case-open.png`, `-04-case-review.png`, `-05-queue-empty.png`. The populated and
open states are the `?fixture=populated` fixture, as a Greg session: the live Decline then change run has no
cases until Paula asks for help, and the host serves the page only to a Greg session.

**One job:** pick the most urgent case and record the next action or remedy.

**Competes with it:** a caveat, a load status line, Refresh queue and a full-width Sort select above the table; an
eight-column table whose Reason, Owner and Next action due are the same on every row; then a case detail that
repeats the row's facts and puts the action form after a second meta row.

| State | Height | Boxes | Headings | Buttons (primary) | Tables | Prose lines | Words |
|---|---|---|---|---|---|---|---|
| Queue, five cases | 900 | 2 | 1 | 6 (0) | 1 | 2 | 147 |
| Case open | 1,802 | 3 | 5 | 9 (1) | 1 | 38 | 300 |
| Empty | 900 | 2 (nested) | 2 | 1 | 0 | 3 | 33 |

- **Standalone page has no portal shell**: no header account, no rail, no breadcrumb; the h1 sits 16 px from the
  window edge (`-01-standalone-live.png`). It is the only Greg screen that looks like a different product.
- **Open case:** focus goes to the h2 "EMPLOYEE 3" (good, drawn with a focus box). The detail is a bordered box with
  kicker "Renewal case", status "REMEDY PROPOSED" in heading type, eight facts in seven columns (Reason and Latest
  update both "My replacement may miss my contract end."), **Case reference "SYNTHETI"**, then "PROPOSED REMEDY"
  with "Proposed value **suv**" and "Expected brief version 3". Outside the box: "Options as of (UTC)" and
  **"Policy version synthetic-policy"**, then "RECORD NEXT ACTION" with five fields and "Review case update".
  "Close case details" is above the heading it closes.
- Dates are ISO with "UTC" in labels and values ("2026-11-06 12:00:00 UTC"), unlike the dashboard's "5 Nov 2026,
  09:30 GMT". (Raw values here are 9 Nov finding 1 and 27, partly still present; the "synthetic" strings are
  fixture data and would not show live, but the column and label wording would.)
- **Empty, embedded on the dashboard:** "RENEWAL CASES", a caveat, "0 renewal cases loaded.", Refresh queue and a
  nested bordered box "NO RENEWAL CASES / There are no renewal-risk cases right now." (`-r01-embedded-live.png`).

## Findings, ranked by what the demo audience would notice first

Each finding: step and screenshot; who it affects; the problem; the change; tag; kit; effort.

**1. Greg's dashboard is one 7,200 px page, and the 10:00 beat starts on screen three.**
10:00, `greg-dashboard-1280-02-full.png`, `-01-arrival.png`. Greg, presenter, audience.
Eight screens, 41 headings, 13 tables and about 1,960 words on one page. Next order, the thing the presenter
came to show, starts at 2,330 px under five sections of "<5" and a policy editor; the comparison starts at 4,500 px.
The rail already names the destinations (Publish stock, Order tracking, Next order) but all three are disabled.
Change: make the rail work. Split the page into four views behind the existing rail items, in run-sheet order:
**Next order** (plan plus Order requests and Production controls, the 10:00 beat), **Demand and supply** (headline
plus demand, stock, offers), **Policy** (rename "Publish stock"), **Route comparison** (new item, the 12:00 beat),
and put Renewal cases on its own item or the case-queue page. Land Greg on Next order after Switch principal.
LAYOUT (same regions, same behaviour, new routing). Kit: extend `GREG_NAVIGATION` and `portalShell` routing, which
Paula's rail already does (`routePortal`). Effort M.

**2. One region, one primary: the dashboard shows four teal primaries at once, and two ways to order cars.**
10:00, `greg-dashboard-1280-r10-order-requests.png`, `greg-actions-1280-r09-orders-after-production.png`. Greg,
presenter, audience. Publish this preview, Request from Production, Submit request and Save production response are
all filled teal. "Request cars" (model, derivative, quantity, Submit request) is a second, manual order path beside
the plan's Request from Production; the audience cannot tell which one is "the" order.
Change: on the Next order view, the plan's Request button is the only primary. Order requests becomes a read-only
table under it ("What Production has"). Move the manual Request cars form and the Production controls into one
closed disclosure, "Production (presenter)", with Save production response as its only button, outline style until
open. LAYOUT. Kit: as is (`presenterBar` disclosure, `button` variants). Effort S.

**3. Next order buries its answer between a limits editor and two tables of zeros.**
10:00, `greg-dashboard-1280-r07-next-order-plan.png`, `greg-actions-1280-r05-next-order-preview.png`,
`-r10-next-order-replanned.png`. Greg, presenter, audience.
Before a change the region is 1,673 px: headline, an empty-looking Change limits box, a disabled primary with its
reason, a three-fact meta row with `gcsp-policy-v1+offer-journey-v1`, a caveat, a five-row table of zeros, a
four-row totals table of zeros, three tiles, an unmatched-supply table, ten unmet-need bullets for one renewal,
alternatives and a "Learned model" note. After Preview it grows to 3,347 px with 13 boxes and 7 tables, and the
open limits editor (five rows with Min, Max and a slider each) sits between the focused headline and the Request
button, about 1,000 px apart. After the request the plan reverts to "No new order recommended" with the editor
still open and the tables of zeros again.
Change: order the region as headline, one sentence of outcome (coverage, spend, unmatched), the primary action,
then "Differences from the current plan" (the one table that changes). Collapse Change limits after a preview and
show the changed limit as a one-line summary ("1 Series Sports Hatch 120: min 2"). Show only non-zero rows in
Proposed order, drop Order totals by model when it repeats Proposed order, merge the three tiles into the outcome
sentence, fold the unmet needs into one line with a count ("10 reasons, 5 of them eligibility"), and move
alternatives, sources and the learned-model note into one closed "How this plan was worked out". Drop the meta row
(forecast source and plan time belong in that disclosure; the policy key goes). LAYOUT. Kit: as is (`dataTable`
already filters rows by caller; `presenterBar` disclosure). Effort M.

**4. The route comparison has a verdict, then 2,000 px of eleven equal measures.**
12:00, `greg-comparison-1280-r01-result.png`, `-01-result-viewport.png`, `-r02-assumptions-open.png`. Presenter,
audience. The verdict sentence is now at the top (good). Below it: an experiment picker where three of four
cards say "not run yet", the stored time three times, a code revision, then eleven measures with 25 headings
(each measure has an h3 plus an h4 "Mean and range across seeds"), each ending "X better / Higher is better". The
two facts the presenter must quote (64 days held but not taken; 3.6% against 15.8% for delayed access) are measures
3 and 9 of 11 and look exactly like the other nine. The run sheet says to expand assumptions: doing so adds 5,500
px of a table with raw keys (`comparison.buddyRoute.v1`), JSON values and a description column one word wide.
Change: verdict, then the three measures that explain it ("Why" in the run sheet: coverage, car time held but not
taken, delayed access) as a compact `dataTable` (`compare` variant) with today, buddy and difference, then a closed
"All 11 measures" disclosure holding the current range-bar view. Say "Mean and range across 3 seeds" once, above
the table. Show the experiment picker only when more than one experiment has a stored result. In the
assumptions disclosure, show label, value and status; move key and raw JSON behind a second "Technical detail"
disclosure. Update the run sheet to say "the panel" rather than "assumptions expanded". LAYOUT. Kit: as is
(`dataTable` compare variant, `range-bar`, `details`). Effort M.

**5. Screen one says nothing: four "<5" tiles, four one-row tables, five more "<5" tiles.**
10:00, `greg-dashboard-1280-01-arrival.png`, `-r01` to `-r05`. Audience, presenter. 9 Nov finding 25 is still
present. Thirteen figures above 1,500 px are "<5" and two tables are empty; each block carries its own caveat.
Change, layout part: keep one headline row of four figures, drop the Offers tile row (it repeats "Offers made" and
"Selected" from the headline), collapse the three single-dimension demand tables into one "Demand by" table with
a dimension column, show Unmet needs and Declines only when they have rows, and say the privacy rule once in the
meta line. LAYOUT, Kit as is, Effort S. Data part: seed a cohort large enough to clear the "<5" band for the
demo, or have the presenter say it is small on purpose (the run sheet already flags this). FEATURE if seeded.

**6. The presenter flyout is a 2,300 px settings page; the 10:00 switch takes five actions.**
All beats, `greg-presenter-1280-03-flyout-open.png`, `-04-flyout-scrolled-end.png`, `-06-reset-done.png`.
Presenter. 34 buttons, 22 bordered option rows, a 32-character run id and an ISO clock first; nine scenario cards
each saying "Available"; two always-open fault pickers no beat uses; principals labelled "(greg)" and
"(presenter)". Getting to Greg is Reset, Confirm, scroll, pick Greg, Switch principal, then Reload.
Change: lead with the four beat actions as one row (Tick, Next release, Reset, Switch), with Tick as the only
primary; show Scenario and Clock as one line ("Decline then change, 5 Nov 09:30"); drop the Run id; drop the
"Available" sub-line unless a scenario is unavailable; put Faults and Last tick in closed disclosures; label
principals by job ("Greg Lawson, scheme ordering"). LAYOUT. Kit: as is (`presenterBar`, `renderOptionList`
compact). Effort S. A one-click "Reset and switch to Greg" scenario shortcut would be a FEATURE (new presenter
command), effort S.

**7. Policy: a 790 px editor that previews into "Unknown (privacy bands)", with focus lost.**
10:00 (optional), `greg-dashboard-1280-r06-preview-and-publish-policy.png`, `greg-actions-1280-r01-policy-preview.png`.
Greg, keyboard users. Six weight inputs each with "Now 1", a full-width points input, three equal buttons and a
caveat; after Preview the comparison is four rows of "<5 / <5 / Unknown (privacy bands)". **Focus falls to BODY
after Preview changes** (WCAG 2.4.3 Focus order; the plan and outbox move focus correctly). The kicker "Policy" is
accent-free but sits above an h2 in page-title type, unlike every other region.
Change: move focus to the preview heading "Compare with the active policy" after Preview (fix). Lay the weights out
as a compact two-column row list with the current value as a muted inline suffix, not a line under each input. Show
the preview as "Changed values" first, and hide outcome rows whose difference is unknown behind one line ("Outcome
figures are hidden for groups under 5"). Rename the rail item to "Policy". LAYOUT (focus fix is a defect, S). Kit:
as is. Effort S.

**8. Internal identifiers on Greg's screens.**
10:00 and 12:00, `greg-dashboard-1280-01-arrival.png`, `greg-actions-1280-r05-next-order-preview.png`,
`greg-comparison-1280-r01-result.png`, `greg-cases-1280-03-case-open.png`. Audience. `gcsp-policy-v1+offer-journey-v1`
(three times), "Figures version 9f45ad69", "Brief version 1", `preview-09781888adee6b3a6e7aff9f`, "Code revision
669fbc2f", "(FUCQ-227)" and "Live corpus realism/integration is separate acceptance evidence." in What this
replay leaves out, "Expected brief version 3" and "Proposed value suv" on a case. 9 Nov finding 1, still present
on Greg's side. The policy panel already has a plain label ("Policy 1 with offer journey"): reuse it everywhere.
Change: one plain policy label from `policy.displayLabels.v1` in every Greg region; drop figures, brief and code
versions from screen (keep in Sources disclosures); remove the Jira key and the acceptance-evidence line; title-case
enum values. LAYOUT. Kit: as is (`plain-copy.js`). Effort S.

**9. The same caveat, said three to five times per screen.**
All Greg screens. Audience. "What employees have saved and confirmed they need" (three times), "not a prediction"
or "not satisfaction" (five times across demand, offers, plan, comparison, policy preview), "Preview only.
Nothing is saved..." (three times in the plan preview), the empty case queue said three times, the outbox subject
three times.
Change: one caveat per view, in the meta line under the h1. Delete status lines that repeat a visible fact
("Figures updated for..." under "Figures for...", "Orders up to date.", "Stored comparisons loaded.", "0 renewal
cases loaded."), keeping them as visually hidden live-region text where they announce a refresh. LAYOUT. Kit: as is
(`view-status.js` already supports a hidden status). Effort S.

**10. Boxes inside boxes, against "one level of boxing".**
Dashboard and case queue, `greg-dashboard-1280-r07`, `-r09`, `greg-cases-1280-03-case-open.png`. Audience. Measured
nesting depth 2 in Next order (tiles and tables inside the region panel), Route comparison, Renewal cases (the
empty state is a bordered status box inside the bordered region) and the case detail. Change Limits is drawn as a
bordered 90 px box with one line in it. The comparison experiment picker is four bordered cards for a radio choice.
The outbox status line is a bordered bar.
Change: inside a region panel, tables and tiles lose their outer border (hairline rules only); empty states inside a
region are plain text; Change limits is a plain disclosure row; the experiment picker is a compact segmented radio
row; the outbox status is a plain line beside Refresh. LAYOUT. Kit: extend (`dataTable` and `statusScreen` need an
"inside a panel" flat variant; `metricTile` compact level exists). Effort M.

**11. Heading levels and styles drift between regions.**
Dashboard. Audience, screen-reader users. Some regions use page-title type for their h2 (PREVIEW AND PUBLISH, NO
NEW ORDER RECOMMENDED, ROUTE COMPARISON, RENEWAL CASES, all caps condensed), others use the 16 px section style
(At a glance, Demand, Order requests). Next order's h2 is the plan's state, so the region has no stable name; the
plan then uses h4 for Model limits under h2 (skips h3). Kickers ("Policy", "Next order", "Renewal case") repeat
the heading. Change: every region h2 is its name in the section style; the state is the first line under it;
drop kickers. LAYOUT. Kit: as is (`screenIntro` level 2). Effort S.

**12. The case queue: no shell standalone, constant columns, form after a second meta row.**
`greg-cases-1280-01-standalone-live.png`, `-02-queue-populated.png`, `-03-case-open.png`. Greg. 9 Nov finding 27
partly still present. Change: mount the standalone page in `portalShell` with Greg's rail; drop columns whose value
is the same on every row (Owner, Trigger, Next action due when equal) into a line above the table; make the row
name the link and drop the "Open" column of five identical buttons; in the detail, put status and next action first,
the form directly under the remedy, and the meta facts in a closed "Case details" disclosure; use the shared date
format. LAYOUT. Kit: as is (`portalShell`, `dataTable` `rowAction`). Effort M.

**13. The outbox repeats the email and prints the token link.**
3:30, `greg-outbox-1280-03-message.png`. Audience. Subject three times, the full plain-text copy under the HTML,
Attempts 1, and a 190-character link with `#token=` in the email body on the slide. Change: open the newest email
by default; keep To, Status and Time on one line under the subject; move Plain-text version and Attempts into a
closed disclosure; demote "Open the offer" to outline (the email's own link is the primary). LAYOUT, Kit as is,
Effort S. Change the email template: drop the "GCSP employee vehicle scheme" first line and print a short link label
instead of the raw address. FEATURE (email content is acceptance on the offer-email Story), effort S.

**14. Presenter landing points at a control it does not show.**
`greg-presenter-1280-02-landing.png`. Presenter. "Choose an acting principal in Presenter controls." in a panel,
with the flyout closed and its only trigger an unlabelled sliders icon at the bottom of an empty rail. Change: open
the flyout on the presenter landing (it already persists its open state), or put the principal picker in the
landing panel. LAYOUT. Kit: as is. Effort S.

### Still present from the 9 November review (run 2), briefly

- 25 ("fewer than 5" boxes, long page): still present; findings 1 and 5 above.
- 27 (case queue as a form stack): partly; finding 12.
- 1 (internal codes and raw timestamps): still present on Greg's side; finding 8.
- 24 (pages stale after presenter actions): the Greg workspace now refreshes on presenter actions; Switch principal
  still ends with a Reload prompt (finding 6).
- Fixed and not repeated: 19 (Next order loads in Decline then change), 20 (comparison shows a stored result), 21
  (policy source notes now in one closed disclosure), 22 (the request now reads "2 vehicles requested from
  Production" and links to Order requests), 26 (comparison has a headline verdict), 23 in part (the email names the
  car, points and deadline).

## Cross-screen consistency issues

1. **Three rails for one presenter.** Greg's rail has four items (three disabled); the outbox rail has Captured
   emails, Clock and Scenarios; the presenter landing rail is empty. The Presenter controls flyout is the only
   common item.
2. **Breadcrumb repeats the h1** on the dashboard and the outbox ("DEMAND AND SUPPLY" / "DEMAND AND SUPPLY",
   "CAPTURED EMAILS" twice); the case queue has neither breadcrumb nor shell.
3. **Region headings in two styles** (finding 11), and **Refresh in four styles**: "Refresh" (meta box), "Refresh
   policy", "Refresh orders", "Reload" (comparison), "Refresh queue", each in a different place in its region.
4. **Dates in three formats:** "5 Nov 2026, 09:30 GMT" (dashboard), "2026-11-05T09:30:00.000Z" (presenter
   readback), "2026-11-06 12:00:00 UTC" (case queue), and "Respond by 11:30 on Thursday 5 November" (email).
5. **Region names disagree with the rail:** "Publish stock" opens "Preview and publish" (policy); "Order tracking"
   opens "Order requests"; "Next order" region's h2 is its state.
6. **Same fact, different component:** coverage, spend and unmatched are tiles in Next order, a table in the plan
   preview and a sentence in Alternative plans; the policy is a label in Policy and a key elsewhere.
7. **Empty states differ:** plain table row (Unmet needs, Declines), a nested `statusScreen` box (Renewal cases), a
   bordered panel with kicker (outbox "NO EMAILS YET"), and "Select an email to read it." in an empty box.

## What works and should stay

- The 10:00 beat now runs end to end in Decline then change: Min 2, Preview, Request, Production confirm, Replanned,
  with focus moved to the new heading at each step.
- The comparison's one-sentence verdict, and its plain "Higher is better / Lower is better" per measure.
- "Differences from the current plan" in the plan preview: the one table that shows what changed.
- Sources and assumptions closed by default in Policy; the privacy band rule applied consistently.
- The outbox list row (name, subject, time, "Captured, not sent" with an icon) and focus to the opened email.
- The flyout keeps one primary per section and returns focus to its status after Reset.
- Every control in the Tab walks had a visible focus ring; no horizontal scroll at 1280.

## Screens and states not reached

- Phone width: dropped by Gary's scope change during the run.
- A populated live case queue: needs Paula's help request first (the `helpCase` section of run 2 does it); the
  populated state was reviewed from the fixture.
- Comparison experiments with stored results (order mix, points, hold): not stored offline; "not run yet" seen live.
- Publish this preview (publishing changes the run's policy) was not pressed, to keep the 10:00 state intact.
- `greg-presenter-1280-08-run-restarted.png` records a run-restarted state the walk hit when a second browser
  profile reused an old presenter session; it is the restarted screen working as designed, not a finding.

## Recommended backlog tickets (the dispatcher raises them)

1. LAYOUT, M: Make Greg's rail work: Next order, Demand and supply, Policy, Route comparison, Renewal cases as
   separate views; land Greg on Next order. (Findings 1, 5.)
2. LAYOUT, S: One primary per Greg region; manual Request cars and Production controls into one closed presenter
   disclosure. (2.)
3. LAYOUT, M: Next order answer-first: headline, outcome sentence, action, differences; zero rows hidden; limits
   collapse to a summary after preview; detail into "How this plan was worked out". (3.)
4. LAYOUT, M: Route comparison: verdict plus the three "why" measures in one table, all 11 in a disclosure,
   assumptions table without raw keys and JSON; update the run sheet's 12:00 line. (4.)
5. FEATURE, S: Seed a demo cohort large enough to clear the "<5" band on Greg's figures. (5.)
6. LAYOUT, S: Presenter flyout: beat actions first, one-line readback, no run id, faults and last tick collapsed,
   principals labelled by job; open it on the presenter landing. (6, 14.)
7. FEATURE, S: "Reset and switch to Greg" presenter shortcut for the 10:00 beat, without a reload prompt. (6.)
8. Bug, S: Policy Preview changes drops focus to BODY; move it to the preview heading. (7.)
9. LAYOUT, S: Plain labels for policy, figures, brief and code versions on Greg's screens; remove the FUCQ key and
   the acceptance-evidence line from What this replay leaves out. (8.)
10. LAYOUT, S: One caveat per Greg view; repeated status lines become hidden live-region text. (9.)
11. LAYOUT, M: Flat variants of `dataTable` and `statusScreen` for use inside a region panel; apply to Greg's
    regions, Change limits and the experiment picker. (10.)
12. LAYOUT, S: One region-heading style and level scheme on Greg's dashboard; drop kickers; one Refresh pattern. (11.)
13. LAYOUT, M: Case queue in the portal shell; constant columns lifted out; row name opens the case; form before
    the meta facts; shared date format. (12.)
14. LAYOUT, S: Outbox: newest email open by default, facts on one line, plain text and attempts collapsed. (13.)
15. FEATURE, S: Offer email: drop the product-name first line and print a short link label, not the raw token
    address. (13.)
