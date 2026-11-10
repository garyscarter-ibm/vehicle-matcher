# Presenter console revamp: spec and mockups

Draft for Gary, 10 November 2026. Branch `claude/presenter-controls-revamp-627251`. Nothing here is built
or claimed; it is a proposal to agree before any Story is raised. Mockups: open
[`docs/gcsp/mockups/presenter-console.html`](mockups/presenter-console.html) through `npm run serve`.

## What Gary asked for

1. Keep everything the presenter controls do today, as a hidden **Advanced** mode.
2. Make **Basic** the default: as few buttons as possible, built around Paula's main successful journey.
3. Show time in a friendly way; releases happen **daily**.
4. A release puts **100 cars** on the scheme and shows them visually, so the audience sees how many cars
   the engine chose from. Animation is welcome.
5. Every release brings a **different set** of cars and configurations, so Paula is not matched with the
   same car every time.
6. Move the controls to **their own page**, entirely separate from the app, so Paula's and Greg's screens
   look like production with no demo overlay.

## Assumptions I made (redirect me if any are wrong)

- **Two screens on stage.** The console runs in its own window (presenter's laptop or a second tab); the
  audience sees Paula's portal. The console still looks good enough to put on the big screen during the
  release moment, because the "100 cars to 1" visual is the point of the demo.
- **"Daily" replaces Mon/Wed/Fri for the demo.** The 300 to 400 cars a week in `background.md` stays the
  real-world fact; for the demo, one release a day of 100 cars is a revisable assumption in
  `seed-v1.json`, not BMW policy. 100 a day is 500 to 700 a week, above the real figure; I've flagged
  that as a question rather than quietly changing it.
- **Basic means Paula's main successful journey only.** Every other scenario, faults, ticks to a target,
  switching principal and handler receipts move to Advanced untouched.
- **Signing in as Paula stays on the portal.** The console doesn't log people in; it tells the portal
  what happened (it already does, through the `gcsp:presenter-action` storage event).
- **Greg's view counts as "the app" too:** his dashboard loses the presenter tile in the same way.

## The Basic console

One page, `/gcsp-presenter.html` (same URL, new body). No portal header, no rail, no employee chrome. It
reads as a control room for the scheme, not as a debug panel.

```
 GCSP  Presenter                                    Tue 10 Nov · 9:00am     [ Advanced ]
 ─────────────────────────────────────────────────────────────────────────────────────────
  Main successful journey                Day 1 of the scheme week
  Paula Mason · preferences saved        Next release: Tomorrow, 11:30am

           [ Release tomorrow's cars ]          ( Start again )

  ┌ Release ───────────────────────────────────────────────────────────────────────────┐
  │  100 cars released · 11 model lines · 24 colours                                    │
  │  ▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢   (grid of 100 tiles, each a real car image)        │
  │  ...                                                                                │
  │  100 released → 38 Paula can have → 12 fit her brief → 1 offered                   │
  │                                         ▸ BMW i5 Touring eDrive40, Mineral White    │
  └─────────────────────────────────────────────────────────────────────────────────────┘

  What happened                                        Open Paula's portal ↗
  11:30am  100 cars released
  11:30am  Buddy matched Paula with an i5 Touring, held for 2 hours
  11:31am  Offer email sent to paula.mason@gcsp-demo.com          View email
```

### Buttons: agreed, Gary, 10 November 2026

Two buttons, one primary, plus a link out.

| Button | What it does | Why this shape |
|---|---|---|
| **Release tomorrow's cars** (primary) | Moves the clock to the next daily release and runs it: 100 cars arrive, the buddy allocates, the offer email is captured. | One verb Paula's story turns on. The label says the time jump out loud, so the audience hears "next morning". |
| **Start again** (secondary, confirm) | Resets to a fresh *Main successful journey* run with Paula's saved brief, a new day 1, and a new stock seed. | "Reset" reads as an error to an audience; "Start again" reads as a choice. |
| *Open Paula's portal* (link) | Opens the portal in another tab, signed in as Paula. | Not a control, just navigation. |

The primary button's label follows the journey, so the presenter never has to think about which button
comes next:

| Journey state (read from the server) | Primary button |
|---|---|
| Paula has no confirmed brief | *Waiting for Paula's preferences* (disabled, with "Open Paula's portal") |
| Brief confirmed, no release today | **Release tomorrow's cars** |
| Release done, offer open | The story is on Paula's screen now, so the headline reads *Paula has an offer, held until 1:30pm* and the button becomes **Release the next day's cars**. No "let it lapse" button in Basic. |
| Paula accepted, order in progress | **Move on a day** (order progress steps forward) |
| Paula declined | **Release the next day's cars** |

### Alternatives I considered

- **A. Two buttons (agreed).** Release and Start again, label changes with the state.
- **B. One "Next" button.** Steps a scripted storyboard (release, wait, move a day). Fewest buttons, but
  the presenter loses the feel of *causing* a release, and an off-script audience question has no answer.
- **C. Day timeline.** A strip of seven days; click a day to jump to its release. Visually strong and
  shows "daily" well, but it invites jumping backwards, which the clock can't do (forward only).

The mockup shows A, with C's day strip as read-only context in the header ("Day 1 of the scheme week").

## Friendly time

- Clock shows **"Tue 10 Nov · 9:00am"** in `Europe/London`, never a UTC ISO string or "tick".
- Next release shows **"Tomorrow, 11:30am"** / **"Today, 11:30am"** / **"Thu 12 Nov, 11:30am"**.
- The demo day counter ("Day 3") is relative to the run's start, so it reads the same after Start again.
- Hold time on an offer shows as **"held until 1:30pm"** or **"1h 54m left"**.
- Advanced keeps the exact UTC instant and the step controls for anyone who needs them.

The start date stays a scenario input; I suggest the demo run starts on **Monday 9 November, 9:00am**
so the week reads naturally on 12 November.

## Releases: daily, 100 cars, different every time

### What exists today

- *Main successful journey* replays **published demo stock**: three fixed windows of 6, 3 and 3 cars
  (`supply.release.windows`), on four model lines. Same cars, same match, every reset.
- The **generated stock** route (FUCQ-78, `createRunStockProvider`) already builds real BMW
  configurations from the retained corpus, with observed colour shares per model line
  (`stock.aggregate.*`), a weekly volume (`supply.weeklyReleaseVolume`, 300 to 400) and a
  Mon/Wed/Fri cadence (`supply.release.cadence`). Its seed is
  `[generator version, runId, seed, policyVersion]`, so **a new run already gives new cars**.
- Release size is `supply.release.size` = 20.

### What changes

1. **Main successful journey uses generated stock**, not the fixed demo windows. Its catalogue input
   becomes `stockTranches: [{ source: 'generated-stock', cue: 'release' }]`; the run-stock chooser
   already sends any run without `published-demo-stock` to the generator.
2. **Daily cadence:** `supply.release.cadence` gets all seven weekdays (or Mon to Fri; see questions)
   at 11:30. Its basis says it is a demo assumption with the real Mon/Wed/Fri kept in its history.
3. **100 per release:** `supply.release.size` = 100 and the weekly volume range rises to match. One
   canonical change each; no client constants (build rules, assumptions in one place).
4. **Guarantee Paula has a real match.** Random stock can, by chance, hold nothing that fits Paula.
   The generator gets one deterministic constraint for this scenario: each release includes at least
   **three** cars that pass Paula's eligibility gates, drawn from different eligible lines and
   colours, so the winner still varies. This is a scenario input (`stockTranches[0].guarantee`), not
   a hidden rule.
5. **Different each time:** the stock seed adds the run id (already true) and the release window id, so
   day 2's cars differ from day 1's within one run, and Start again gives a new run and new cars.
6. **Other scenarios keep the published demo stock**, because their stories depend on exact cars
   (no SUV for decline-then-change, the hatch for Alex in offer-expires).

### Visualising the release

The release card is the one place the console is designed to be put on screen.

1. **Arrive.** On release, 100 tiles fill a 10 × 10 grid in a quick staggered cascade (about 1.2s
   total). Each tile is the car's real display image (`display-images.v1.json`), over its paint colour
   name on hover/focus. Counters above tick up: *100 cars · 11 model lines · 24 colours*.
2. **Narrow.** The buddy's real evaluation streams in. Tiles that Paula can't have (grade, scheme,
   model eligibility) dim to 20%; the counter reads *38 Paula can have*. Then tiles that miss her
   essentials dim; *12 fit her brief*. Each stage is a step on a funnel bar under the grid.
3. **Choose.** One tile lifts, scales up and slides into a result card: the car, its colour, why it won
   (the buddy's top reasons, already in the allocation receipt), and "Held for Paula until 1:30pm".
4. **Hand over.** A line in *What happened* says the offer email went out, with *View email*.

Images: the grid needs small thumbnails (about 120 px wide) preloaded before the cascade starts, or the
tiles arrive as empty frames; the mockup preloads full images to show the intent.

Reduced motion: no cascade or slide, the grid appears filled and dims in one step; counters show final
numbers. Keyboard: the grid is one focus stop with arrow navigation, each tile labelled
("BMW X1 sDrive20i, Alpine White, not eligible for Paula's grade").

The funnel numbers come from the allocation slice (`gateStatus`, `suitable`, `blockers` per car), so
they are the engine's real numbers for that release, not illustration. The console needs one new
read-only, presenter-only projection for this: `GET /api/gcsp/presenter/releases/latest`
returning per-car `{ imageSrc, modelName, colourName, stage: 'released'|'eligible'|'suitable'|'offered' }`
and the counts. It reads existing receipts; it writes nothing.

## Its own page, separate from the app

| Today | Proposed |
|---|---|
| Presenter controls are a left-rail item and flyout on every portal page that sees a presenter cookie (`portal-shell.js` `buildPresenterItem`). | The portal shell drops the rail item and flyout entirely. No presenter code is imported by any Paula or Greg page. |
| `gcsp-presenter.html` mounts the *acting principal's* employee or Greg workspace inside the portal shell. | `gcsp-presenter.html` is the console only: its own layout, no portal shell. |
| Any visitor to `gcsp-presenter.html` is issued a presenter cookie by the host. | Unchanged for the demo, but noted: that is effectively open access. A shared passphrase on the console is a separate Story if wanted. |
| Paula's pages refresh on presenter actions through `subscribePresenterActions`. | Unchanged. The console writes the same storage key, so open portal tabs update with no overlay. |
| Captured emails live on `gcsp-outbox.html`. | The console's *What happened* list opens them in a side panel; `gcsp-outbox.html` stays as is. |

## Advanced mode

A toggle top-right, **Advanced**, remembered per browser session. It swaps the Basic body for today's
controls, regrouped into tabs but functionally identical:

| Tab | Contains (from today's `controls.js`) |
|---|---|
| Scenario | All eight scenarios with availability, Reset with confirmation, Continue to workspace |
| Clock | Tick (60 seconds), tick to named time or UTC target, Next release, the exact clock and run |
| People | Acting principal, Switch principal, Retry original action, Issue again |
| Faults | Stock source none/unavailable/stale, any other adapter the server reports |
| Last tick | Tick summary, handler steps and outcomes, missing stages, release count |

Command idempotency, retry of the original body, stale-run handling and the reset confirmation stay as
the FUCQ-126/172 contract says. Advanced is the existing controller mounted in a new host, not a rewrite.

## Delivery: how I'd slice it

Each line would be a separate backlog Story for collaborator review before build (build rules, scope
control). MoSCoW is my suggestion for the 12 November demo.

| # | Slice | Points | MoSCoW |
|---|---|---|---|
| 1 | Console page: own layout, Basic/Advanced toggle, Advanced mounts today's controller unchanged | 3 | M |
| 2 | Remove the presenter rail item and flyout from the portal shell; nothing presenter-related loads on Paula's or Greg's pages | 2 | M |
| 3 | Friendly time and state-driven primary button (reads existing `/controls` and `/context`) | 3 | M |
| 4 | Main successful journey on generated stock, daily cadence, 100 per release, guaranteed Paula matches (policy + catalogue + generator) | 8 | M |
| 5 | Presenter release projection route (read-only, from allocation receipts) | 5 | S |
| 6 | Release visual: grid, funnel, winner animation, reduced motion, keyboard | 5 | S |
| 7 | *What happened* feed with email side panel | 3 | C |

Slices 1 to 3 give a clean, production-looking app and a two-button console without touching the
engine. Slice 4 is the riskiest: it moves the main journey off fixed stock days before the demo.

## Risks

- **Main journey on generated stock, two days out.** Fixed demo stock was chosen because it's
  predictable. The guarantee in step 4 handles "no match"; it does not make the winning car known in
  advance. If the presenter needs to say "she'll be offered an i5", generated stock removes that.
- **Generation needs its inventory file.** Locally, a stale `<tmpdir>/gcsp-stock-inventory/*.json` from
  an earlier run made today's startup fall back to demo stock (`retained-stock-request-mismatch`). On
  Render that path is fresh per deploy, but a restart mid-demo could hit the same thing. Worth a test.
- **Volume vs the real figure.** 100 a day overstates BMW's 300 to 400 a week; say it verbally, or
  release on weekdays only (500 a week), or keep 60 a day (see questions).
- **Images.** 242 display images cover the retained corpus; cars without a variant image fall back to
  the model image, so some tiles in a release will look alike.

## Questions for Gary (each with my recommendation)

1. ~~Two buttons, or one Next?~~ **Decided: two buttons (A), Gary, 10 November 2026.**
2. **Daily every day, or weekdays only?** Recommend weekdays only at 11:30, so "tomorrow" skips the
   weekend and the week stays close to the real volume.
3. **Keep 100, or match the real 300 to 400 a week?** Recommend 100: it's the number the audience will
   remember, and the assumption is documented in one place.
4. **Is generated stock on the main journey in scope for 12 November,** or after? Recommend slices 1 to
   3 and 6 (with stock from today's fixed windows padded to 100 for the visual) before the demo, and
   slice 4 straight after, unless you're comfortable with an unscripted winner on the day.
5. **Should the console be password-protected?** Recommend not for the demo; raise it as a Story.
6. **Greg in Basic?** I've kept Basic to Paula's journey. Greg's order planning could be a third button
   later.

## Rules followed

`docs/gcsp/experience-quality.md` (desktop 1280 checked, no on-screen demo or synthetic wording, no
em dashes in copy, reduced motion, keyboard); `docs/gcsp/build-rules.md` (one policy source,
new scope as separate Stories); `COMPONENTS.md` (the build would reuse `button`, `factList`,
`renderOptionList`, `statusScreen`, `activity-timeline` and the Density tokens; the release grid and
funnel are new kit components). The HLD changes (presenter route, console page, shell no longer
hosting controls) go on the draw.io design before build.
