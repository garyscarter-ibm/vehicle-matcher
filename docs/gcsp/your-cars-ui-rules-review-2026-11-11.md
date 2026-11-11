# Your cars against the UI rules, 11 November 2026

Gary's ask: Russell's FUCQ-359 Your cars layout "doesn't carry any of the new UI rules"; review it and bring it into line.
Desktop 1280 only. Captures: `evidence/your-cars-ui-rules-2026-11-11/before/` and `after/` (same names).

## When the rules landed

| Rule source | Landed on `gcsp-poc` (10 Nov, UTC) |
|---|---|
| Density tokens and portal match (`density/ui-revamp-spec.md`, 813ea67f) | 14:22 |
| Page-shaped skeleton loading (4053c043) | 14:39 |
| UX revamp slices 1 to 8, incl. slice 5 Your cars (d3926aa4) and the minimal-and-meaningful rules | 17:57 to 18:17 |
| Frozen Account reference 193cbf07 | 19:50 |
| FUCQ-359 built and merged (b3341032, closed db596e21) | 21:38 to 23:41 |

FUCQ-359 followed the frozen reference, which was drawn from Russell's mockup CSS rather than the density tokens.
Its agreed structure stays: car panel, rating, facts and Points cost, then Your preferences, then Order history and Your details.

## Departures and what was done

| # | Where (before capture) | Rule broken | Change | Kind |
|---|---|---|---|---|
| 1 | `01` h1 "YOUR CARS" is 38px from a raw `clamp(28px, 3vw, 40px)`; every other Paula page is 23px | Tokens only, four type steps, consistency | h1 uses the shared title token like the other pages | Rule fix, made |
| 2 | `01` to `09` "Account as of 5 November 2026 at 09:00." closes the page | No redundant status summaries (Paula P10: drop it); the frozen reference has no such line | Removed | Rule fix, made |
| 3 | `06` no current car: a loose allowance line, a "No current car" box, then a full-width detached "Start a new order" | One primary per region, placed bottom left at normal width; one level of boxing | One "No current car" region holding the allowance line and the primary | Rule fix, made |
| 4 | `08`, `09` the state box says replacement isn't available, then the car panel says "Replacement is unavailable for this contract and slot." | Say a fact once; plain words, not "slot" | The panel line is dropped when the page state already says it, and reads "Replacement isn't available for this car." otherwise (`04`, second car) | Rule fix, made |
| 5 | `15` account failure: two boxes ("Your account is unavailable" and "Saved journey could not be read"), "Refresh account" outside both, no primary | One region per message, one primary per region, one name for Refresh | One failure region with a primary "Refresh" and an outline "Contact support"; the journey box is not added when the account itself failed | Rule fix, made |
| 6 | `14` loading: the generic page skeleton, narrower than the page, with lede lines and an inset image the page doesn't have | Skeletons are shaped like the coming view | A `feature` skeleton layout in the kit: the full-width car panel (wide image, facts column), the preferences panel and rows | Kit extend, made |
| 7 | `01` history note "No Motorcycle Choices orders. PCS UK FS BMW shows history only…" | No unnecessary prose; Paula P10 hides empty schemes | The "No … orders." half is dropped; the history-only half stays | Rule fix, made |
| 8 | Car panel `border-radius: 0` | Radius token | `--gcsp-radius` | Token fix, made |
| 9 | `01` car facts repeat the countdown ("Contract end 1 December 2026") and say "Status: Current car" under a panel that is the current car | Say a fact once (Paula P10 names both) | **Proposed:** drop both facts from the panel; both stay in the full record | Changes the frozen facts, needs Gary |

## Checked and left as they are

- **No Buddy route on Your cars.** Slice 5's state-driven "See buddy activity" primary was removed by FUCQ-359, as the frozen
  reference asks. FUCQ-370 (Engage Buddy, DEV-2026-11-10-012) adds the Buddy status and action; adding slice 5's hero back would conflict with it.
- **Order history as a visible table** rather than Paula's collapsed "Previous orders". The frozen reference keeps it visible below Preferences.
- **"1,100 / 1,300 points per month"** rather than "Within your allowance, 200 points left". The frozen reference fixes this format.
- **24px panel padding** where the density spec says 16: it matches `statusScreen` and the other kit panels, so changing Account alone would break consistency.
- **Amber filled stars** (`--gcsp-warning`): FUCQ-367's rating component, agreed in the frozen reference.
- Kickers, breadcrumbs, uppercase h2s, side stripes, shadows and on-screen disclaimers: none present.

## Component plan

- REUSE `statusScreen` (failure and no-current-car regions, with their actions), `button`, `factList`, `screenIntro`.
- EXTEND `loadingSkeleton` with a `feature` layout (documented in `COMPONENTS.md`); `mountEmployee` already passes `loadingLayout`.
- NEW: none.

## Independent critique of the after captures

Reviewer (general-purpose, opus), from the images and rule docs only. It found no regression from before to after, and confirmed items 1 to 8.
Acted on:
- **Status copy.** Provenance words were removed. No current car reads "Your allowance is 1,300 points a month." Not yet
  eligible reads "Your collection window doesn't allow a replacement yet." Unsupported drops its line. Conflict reads
  "Refresh to see the latest."
- **History note.** It isn't shown when the unsupported-scheme state already says ordering isn't possible.
- **Feature skeleton.** Its title bar is the width of the real title.

Not changed, and why:
- **Medium, follow-up.** The shell header's "Account unavailable" and "Retry" repeat the body's failure region. The header
  still says "unavailable" on a conflict. This is the shared portal shell on every employee page, outside the Your cars layout.
- **Medium, data-driven.** The car heading and spec line repeat the variant ("320i" and "320i M Sport Touring"). They come
  from the account data, and FUCQ-369 uses the heading and spec as the car's description.
- **Low.** Short Order history columns wrap beside a very long car name (`04`). This is `dataTable`, not this layout.
- **Low.** `?prefs=pending` doesn't hold the save in flight, so `12` matches `01`. This is the FUCQ-368 fixture.
- **Item 9 above:** still waiting for Gary's decision.

Tests run (scoped, one worker): gcsp-account-render, gcsp-loading-skeleton, gcsp-presenter-refresh, gcsp-account-runtime,
gcsp-live-regions, ui-ratchet, gcsp-painted-copy-words, shared-kit-contracts, gcsp-plain-copy and gcsp-manual-journey-resume
(285 pass), plus render.test.js (41 pass). Full `npm test` was not run.
