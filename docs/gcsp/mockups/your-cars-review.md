# Your cars: information hierarchy review, 10 November 2026

**Today:** [your-cars-today.png](assets/your-cars-today.png) (Gary's screenshot).
**Proposed:** [your-cars-proposed.html](your-cars-proposed.html). Serve it at `http://localhost:3000/docs/gcsp/mockups/your-cars-proposed.html`, and add `#record` to open the car record. The mockup uses the real GCSP tokens and the shared `.vm-btn`. Its data comes from the `ready` fixture.

## Where the rules come from

Density supplies tokens and type roles (title, heading, regular, label and figure sizes). It has no rules about information hierarchy or progressive disclosure, so the proposal follows published guidance:

- **NN/g, visual hierarchy.** Use no more than 3 sizes and at most two big elements. Group things by proximity and white space before reaching for borders or backgrounds, "if everything is contrasted, then nothing stands out", and use the squint test to check what dominates. [nngroup.com/articles/visual-hierarchy-ux-definition](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/)
- **NN/g, progressive disclosure.** "Disclose everything that users frequently need up front". Designs that go beyond 2 disclosure levels "typically have low usability". [nngroup.com/articles/progressive-disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- **GOV.UK accordion.** "Do not use an accordion for content that all users need to see" and "do not put accordions within accordions". Test the page with plain headings first. [design-system.service.gov.uk/components/accordion](https://design-system.service.gov.uk/components/accordion/)
- **GOV.UK summary list and card.** Use a key/value list for facts. Keep a little related content as a list under a heading, not as a card, and give each group one action, not one per row. [design-system.service.gov.uk/components/summary-list](https://design-system.service.gov.uk/components/summary-list/)

They all fit the agreed [revamp spec](../density/ui-revamp-spec.md): one level of boxing, four type steps, rows not cards, and one primary action per region.

## What's wrong today

1. **The question the page answers is buried.** People come to this page to answer one question: "my contract is ending, can I afford a replacement?" The answer is split across three places. The countdown sits under the car name, the points line is at the bottom of the panel in the same weight as everything else, and the allowance sits in a separate box below.
2. **The allowance appears twice.** It's in the points line ("1,300 points a month allowance") and again as its own "Your allowance" panel holding a single fact.
3. **There are four kinds of container on one page.** A boxed panel, another boxed panel, bare accordions, and a heading with nested accordions. Nothing on the page consistently says "this is a section".
4. **There are three levels of disclosure.** Order history opens a scheme, which opens a record, which opens "Order, collection and vehicle details", which opens "Technical specification". NN/g puts the usable limit at two.
5. **Accordions hide content that every user needs.** The drivers, the employee details and every history record are closed by default. Even "Motorcycle Choices (0 records)" is an accordion you have to open to learn it's empty.
6. **The style hierarchy is upside down.** The accordion summaries are teal and semibold, so they're the loudest things on the page, louder than the car or the primary action. Teal is meant for actions. The real button, "Choose a replacement", is an outline that looks like a secondary button.
7. **"Not supplied" noise.** "More details not supplied" under the facts, and opened sections that list a dozen "Not supplied" rows (Date of birth, Bike licence type and so on).
8. **Account housekeeping is split.** "Refresh account" sits alone at the top, and "Account as of…" sits alone at the very bottom.

## What the mockup changes

| # | Change | Fixes |
|---|---|---|
| A | **The page head carries title, freshness and Refresh** on one row. | 8 |
| B | **The current car is the only panel**, with the image and the car side by side. Inside it, in order: a context label, the car name, the contract countdown (with a state dot), then a **key-figure strip** showing *this car's points*, *your allowance* and *your replacement window*, then the secondary facts as a quiet grid, then the actions. | 1, 2 |
| C | **One primary action:** "Choose a replacement" is filled teal, and "View car record" is an outline beside it. | 6 |
| D | **The "Your allowance" panel goes**, because the allowance now sits in the key-figure strip. | 2, 3 |
| E | **Order history becomes one table** (kit `dataTable`) across all schemes, with a Scheme column, a Status column and a "View record" link per row. Empty schemes and history-only schemes become one muted line, not accordions. | 3, 4, 5 |
| F | **The full record opens in a side drawer** as headed sections: Contract, Collection, Order and vehicle, Technical specification. Print record moves into the drawer. That's one disclosure level, and it's the same pattern as the presenter flyout. | 4, 7 |
| G | **Your details becomes two summary rows**: Employee and Drivers. Each shows only the supplied facts, and each has its own help link. Fields that aren't supplied are left out instead of listed. | 5, 7 |
| H | **Teal only for actions and links.** Section titles are 16px text-colour headings. "Current car" is the only state colour in the table. | 6 |

At phone width the car panel stacks, the key figures go two across, the buttons go full width, the history table collapses to labelled rows and the drawer goes full screen. I checked it at 375px and it doesn't scroll sideways.

## Decisions for Gary

1. **Replacement window in the key strip.** The mockup swaps "Contract end" for "Collect a replacement: 12 Nov to 1 Dec", because the contract end is already in the countdown line. *Recommend: keep it.* It's the date an employee acts on.
2. **Record in a drawer, or a separate page.** *Recommend: drawer.* It keeps your place on the page, and the presenter flyout already uses the same pattern.
3. **Hiding "Not supplied" fields in Your details and the record.** That means a field that is genuinely missing (for example the date of birth) is no longer visible as missing. *Recommend: hide them on this page.* If support needs a gap to show, they can see it through the help route.
4. **The no-current-car state.** With no current car there's no key strip, so the allowance needs a home. *Recommend: a one-line "Your allowance: 1,300 points a month" under the page head in that state.* This isn't mocked up.

## Building it

The layout uses only existing data and kit pieces (`factList`, `dataTable`, `button`, and the flyout pattern), so it's a presentation change under the demo-delivery rule. No new feature Story is needed. The tests in `server/test/gcsp-account*.test.js` assert some of the current structure (accordion titles, "Your allowance"), so they'll need updating alongside the change.
