# GCSP UX revamp plan, 10 November 2026

Gary's brief: "the screens are very busy... more minimal and meaningful, with correct hierarchy and consistency."
Desktop only (1280), per Gary on 10 November. The evidence is in [the Paula review](ux-revamp-review-2026-11-10-paula.md)
and [the Greg review](ux-revamp-review-2026-11-10-greg.md). Screenshots are in `evidence/fucq-248/revamp-2026-11-10/`.

## What the reviews found

- **Screens repeat the screens before them.** After acceptance the same order appears three times. Post-decision pages run
  from 1,770 to 3,270 px. Greg's dashboard is one 7,200 px page with 41 headings and 13 tables.
- **The next action is weak or missing.** "View offer" is an outline button beside a primary "Ask for help". Your cars has
  no primary after acceptance, and Greg has four primaries at once.
- **Facts and caveats are said two to five times.** That covers the allowance, the contract end, "All dates are UTC", the
  image disclaimer and the privacy-band note.
- **Inconsistency:** the car is drawn six ways, the car number has four labels, Refresh has four names, breadcrumbs repeat
  the h1, h2s mix uppercase and sentence case, and kickers use the accent colour.
- **Internal labels on screen:** `gcsp-policy-v1+offer-journey-v1`, figures versions, "(FUCQ-227)" and "version 3".

## Slices (LAYOUT: behaviour kept, buildable now)

In run-sheet order. One implementer per slice, each 8 points or less, and only the relevant tests run.

| # | Slice | Review findings | Pts |
|---|---|---|---|
| 1 | **Shared consistency:** no breadcrumb that repeats the h1, sentence-case h2/h3, muted kickers, one image disclaimer, no input-like focus outline on headings, plain labels instead of internal ids | P15, P18 (part), G8, G11 (part) | 5 |
| 2 | **Buddy activity:** lead with one status line, not the empty offer panel; "found a car" with a primary View offer; Renewal help becomes a link; one "All dates" note | P1, P2, P9 | 3 |
| 3 | **Offer decision:** one decision region; the comparison shows differences only; terms and details go behind a disclosure; Decline replaces Accept; the declined and change-saved states are cut to one line each; expired offers get an exit | P5, P6, P7, P14 | 8 |
| 4 | **After acceptance:** a short "Offer accepted" confirmation; Your cars shows one "Your new car" row; order progress loses the duplicate task list | P3, P4, P13 | 5 |
| 5 | **Your cars and Your preferences:** one hero with one state-driven primary; the duplicate allowance and Refresh account are removed; secondary attributes collapse; one Save region, with focus after Save | P10, P8 | 8 |
| 6 | **Greg structure:** the rail opens separate views (Next order, Demand and supply, Policy, Route comparison, Renewal cases) and lands on Next order; one primary per region; manual Request cars and Production controls go into a presenter disclosure | G1, G2, G5 (layout) | 8 |
| 7 | **Greg answers first:** Next order shows its headline, action and differences, hides zero rows and collapses the limits after a preview; Route comparison shows the verdict and three measures, with the rest in a disclosure and no raw keys; one caveat per view; flat `dataTable`/`statusScreen` variants inside panels; focus after Preview | G3, G4, G7, G9, G10, G12 | 8 |
| 8 | **Presenter:** the flyout puts beat actions first, with a one-line readback, no run id, and faults collapsed; the outbox opens the newest email | G6, G14 | 3 |

## Deferred to backlog Stories (not built now)

- **FEATURE:** seed a demo cohort large enough to clear Greg's "<5" figures (G5).
- **FEATURE:** a "Reset and switch to Greg" presenter shortcut (G6).
- **FEATURE:** the offer email gets a short link label and loses its product-name first line (G15).
- **FEATURE:** setup's "Save and continue" replaces the separate Save and Continue (P13).
- **FEATURE:** UK local time on Paula's screens, with no UTC labels (P17).
- **LAYOUT, later:** the manual route as rows, with contact details asked once (P11, P12); the case queue in the portal
  shell (G13); and one shared car-summary component across all six car treatments (P18, L).

## Agreed and building

Gary agreed all eight slices on 10 November ("Build all eight"). Two changes from the table above:
- G8 (internal labels on Greg's screens) moves to slice 7, because slice 1 does not touch Greg's files.
- "Your cars shows one Your new car row" moves from slice 4 to slice 5, so one slice owns `blocks/gcsp/account/`.

## Implementer brief, shared by every slice

- **Binding:** read `docs/gcsp/experience-quality.md`, `docs/gcsp/build-rules.md` ("Demo delivery and scope control"),
  `docs/gcsp/density/ui-revamp-spec.md` (the "Minimal and meaningful" rules and the token rules) and `COMPONENTS.md`.
  Then read your findings in the two review reports. They give the recommended change and the screenshots.
- **LAYOUT only.** Keep current behaviour: the same data, actions, adapters, states and routes. You may remove repeated text,
  merge or demote regions, reorder, collapse content into a disclosure (`<details>`) and change a button's variant. You may not
  add new behaviour or change what an action does. If a recommendation needs new behaviour, skip it and list it in your report.
- **Kit first.** Reuse kit components, or extend one with an option and document it in `COMPONENTS.md` in the same change.
  The UI ratchet (`server/test/ui-ratchet.json`) may only fall. Lower a baseline when a count falls.
- **House rules:** tokens only, `.gcsp`-scoped selectors, no em dashes in on-screen copy, code comments of two lines or fewer,
  no coloured side-stripe boxes, no on-screen "demo" or "synthetic" wording.
- **Desktop only (1280).** Don't break the existing under-600px rules, but don't add or check phone work.
- **Tests:** update tests that assert the old layout or copy so they assert the new intent. Run only the test files for
  the files you touched, plus `server/test/ui-ratchet.test.js`, `server/test/gcsp-painted-copy-words.test.js` and
  `server/test/render.test.js`. Never run `npm test`.
- **Files:** touch only the files your slice owns. Other implementers are working in the same worktree at the same time.
  Don't commit, stash, switch branch or run git commands that write. The main session reviews and commits.
- **Report** in under 300 words: the files changed, what you removed, merged or demoted for each finding, the tests you ran
  and their results, and anything you skipped and why.
