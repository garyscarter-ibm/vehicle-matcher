# GCSP UX revamp review: Paula's journeys, 10 November 2026

A follow-up to FUCQ-248. Gary's brief: "the UX is atrocious", and "the screens are very busy, a common trait with AI screens. We need to be more minimal and meaningful with our presentation, with correct hierarchy and consistency."

This review judges flow, hierarchy, density, wayfinding and consistency against `docs/gcsp/density/ui-revamp-spec.md` ("Minimal and meaningful"): one level of boxing, colour that means something, four type steps, one rhythm, rows rather than cards, and one primary action per region. It does not re-review the visual tokens, buttons or shell, which the visual pass (95f39141 and later) already fixed.

**Scope:** desktop only, at 1280x900. Gary narrowed the scope mid-run, so there are no phone captures or touch-target findings. Accessibility checks are light: focus loss only.

## How it was walked

- The host ran offline (`GCSP_OFFLINE=1`, memory repository) on ports 9290-9292, with Chromium driven by Playwright.
- Harness: `docs/gcsp/evidence/fucq-248/walk-revamp.mjs` and `sections-revamp.mjs`. They copy the FUCQ-248 walker with two changes:
  - the presenter controls are now reached through the left-nav flyout, and principals are labelled "Paula Mason (employee)";
  - each capture adds a busyness count from computed styles, taken inside `main` with the shell and presenter controls excluded:
    - **boxes:** bordered or tinted padded regions;
    - **nesting depth;**
    - **headings;**
    - **buttons**, with the primary buttons counted separately;
    - **visible words.**
- Sections:
  - `buddy`: the run sheet from 0:00 to 8:30, using "Main successful journey". The route is sign-in state, Your cars, Your preferences, save, Buddy activity, Next release, offer, decline (Body style), change to Saloon, Tick, second offer, accept, Order progress, 6 Ticks, a slot request, Tick to 10:07, then Renewal help.
  - `manual`: setup, gallery, review, summary, submit, outcome. It runs on "No suitable match", because every scenario that releases stock gives Paula a buddy hold, and the hold blocks a manual reservation.
  - `states`: no match, an expired offer, and the `?fixture=` states on Your cars.
  - `probe`: sign-in, the error state and landing.
- Screenshots: `docs/gcsp/evidence/fucq-248/revamp-2026-11-10/paula-<screen>-1280-<nn>-<state>.png`. The `nn` numbering restarts in each section.

## Busyness, measured (1280 wide)

| Screen and state | Boxes | Headings | Buttons (primary) | Words | Page height (px) | Shot |
|---|---|---|---|---|---|---|
| Sign in | 1 | 1 | 1 (1) | 15 | 900 | signin-01 |
| Your cars, buddy looking | 2 | 7 | 9 (1) | 127 | 1,552 | home-01 |
| Your cars, after acceptance | 3 | 15 | 6 (0) | 293 | 3,101 | home-21 |
| Your preferences | 4 | 4 | 33 (1) | 257 | 3,270 | brief-03 |
| Buddy activity, before release | 3 | 6 | 2 (1) | 88 | 1,571 | activity-05 |
| Buddy activity, car found | 2 | 7 | 3 (1) | 121 | 1,371 | activity-07 |
| Offer | 4 | 3 | 3 (1) | 246 | 1,516 | offer-09 |
| Offer, decline open | 4 | 3 | 5 (2) | 261 | 1,648 | offer-12 |
| Offer declined, one change | 1 | 2 | 9 (1) | 55 | 900 | offer-13 |
| Offer accepted | 4 | 9 | 3 (1) | 278 | 2,328 | offer-19 |
| Order progress, approvals done | 5 | 10 | 7 (1) | 231 | 2,203 | order-23 |
| Order progress, handover booked | 5 | 11 | 16 (1) | 298 | 2,587 | order-25 |
| Renewal help | 2 | 3 | 1 (1) | 60 | 900 | help-26 |
| Manual: Your order choices | 5 | 5 | 5 (1) | 162 | 1,443 | manual-01 |
| Manual: Released cars | 7 | 7 | 18 (6) | 328 | 2,338 | manual-05 |
| Manual: Review your car | 2 | 4 | 5 (1) | 144 | 1,351 | manual-06 |
| Manual: Review your order | 7 | 9 | 5 (1) | 329 | 2,022 | manual-07 |
| Manual: Order received | 8 | 11 | 2 (1) | 243 | 1,770 | manual-08 |

The box counter misses some white panels that have no border. The screenshots show more boxes than the table counts on the offer, review and summary pages.

The measurement says what the screenshots say. Sign-in is the only screen with one job, one box and one action. Every post-decision screen (offer accepted, Your cars after acceptance, order received) runs to 1,770 to 3,100 px, because it repeats the screens before it.

## Findings, ranked by what the audience would notice first

Tags:

- **LAYOUT** is a presentation or flow change that keeps the current behaviour, and is buildable now.
- **FEATURE** is new behaviour or changed acceptance, and becomes a backlog Story.

Kit: **as is**, **extend** or **new**. Effort: S, M or L.

### 1. Buddy activity opens on a 630 px black "No current offer" panel (LAYOUT, S, kit extend)
- **Where:** run sheet beat 1:30, "Buddy activity: active, not searched yet" (`paula-activity-1280-05-before-release.png`; also `paula-activity-1280-01-no-match.png`).
- **The screen's one job:** show that the buddy is on, and what it last did.
- **What competes with it:** the media placeholder for an absent offer fills the first viewport with an empty dark rectangle, under a "Your offer" heading that has no offer. The real status, "Not searched yet", is a 14 px line under it, below the fold edge.
- **Count:** 3 boxes, 6 headings, 2 buttons, 88 words.
- **Minimal recommendation:**
  - With no offer, drop the "Your offer" section entirely.
  - Lead with one status line under the h1: "Looking for a car. Not searched yet." or "Last checked 5 Nov, 09:30: 5 cars, none suitable."
  - Follow it with the activity rows.
- **Kit:** `vehicle-media` needs an "absent: render nothing" mode.
- **Who notices:** the audience sees this at the first buddy beat.

### 2. When the buddy finds a car, the obvious next action is secondary and the news is buried (LAYOUT, S, kit as is)
- **Where:** beat 3:30 (`paula-activity-1280-07-found.png`).
- **The screen's one job:** "your buddy found a car, look at it".
- **What competes with it:**
  - "View offer" is an outline button.
  - The only primary button on the page is "Ask for help", in the embedded Renewal help block.
  - "Found a car for you." is the last clause of an activity sentence: "Last check 5 Nov 2026, 09:30: 6 cars checked, 5 suitable. Found a car for you."
  - The offer facts sit in a third column with no hierarchy: "Waiting for you", then "Respond by…", then the car name.
- **Count:** 2 boxes, 7 headings, 3 buttons (1 primary, on the wrong action).
- **Minimal recommendation:**
  - Put an h2 "Your buddy found a car" at the top.
  - Under it, the car name, the respond-by time and a **primary** "View offer".
  - Make Renewal help a single text link at the foot of the page (see 9).
  - Remove the "All dates are UTC." line.

### 3. "Offer accepted" re-renders the whole offer and then the whole order tracker (LAYOUT, M, kit as is)
- **Where:** beat 7:00 to 8:30 (`paula-offer-1280-19-second-accepted.png`, 2,328 px).
- **The screen's one job:** "accepted, here's what happens next".
- **What competes with it:**
  - Under the confirmation line and two buttons, the full offer card follows: image, badge, model, "Eligible" and "Why it suits you".
  - Then the full comparison table.
  - Then an embedded "ORDER PROGRESS" section with the car image a second time, the order reference, six steps, Handover, Documents and checks, and Returning your current car.
  - Then a full-width "Check current state".
  - The car image appears twice and the car order number three times.
- **Count:** 4 boxes, 9 headings, 278 words.
- **Minimal recommendation:**
  - Keep the h1, one line with the car name and order reference, the next step ("HR approval is next"), a primary "View order progress" and an outline "Back to Your cars".
  - Remove the embedded tracker and the comparison table from this state.

### 4. Your cars after acceptance embeds the tracker too, so the same order appears three times (LAYOUT, M, kit as is)
- **Where:** `paula-home-1280-21-accepted.png` (3,101 px, the longest Paula screen) and `paula-home-1280-09-manual-ordered.png`.
- **What repeats:**
  - A box, "YOUR ORDER IS IN PROGRESS", shows the order reference, car order number and current step, with "View order progress".
  - Directly under it, the entire order-progress view: the same reference and number, the image, the steps, handover, documents and return.
  - Then the current car panel.
  - Then Order history, which lists the same order a third time with its status, reference and number.
- **Count:** 15 headings, 6 buttons and no primary.
- **Minimal recommendation:**
  - One "Your new car" row: image thumbnail, name, current step, and a primary "View order progress".
  - Below it, the current car panel, which is still relevant until return.
  - Order history in one collapsed disclosure.
  - Delete the embedded tracker.

### 5. The offer page has three competing regions and a full-width "Check current state" (LAYOUT, M, kit extend)
- **Where:** beat 5:00 (`paula-offer-1280-09-first.png`, `paula-offer-1280-17-second.png`).
- **The screen's one job:** decide on this car.
- **What competes with it:**
  1. A hold timer plus a separate "Time at last check: … UTC" line.
  2. A car card:
     - an "ORDER NO. 1464183" badge over the image;
     - an image disclaimer;
     - the "1,100 points a month · 1,300 points a month allowance" line;
     - Model and Derivative, which repeat the name above them;
     - "More details not supplied";
     - a bare word, "Eligible";
     - an accent-coloured uppercase "WHY IT SUITS YOU". Its first reason, "Available by Tuesday 1 December 2026.", is a date, not a reason.
  3. A 7-row comparison table in its own box. It repeats points, body style and fuel from the card.
  4. "Before you accept": 5 contact facts, a 50-word scheme terms paragraph and 3 checkboxes.
  5. A helper line, Accept (disabled), Decline, then the widest control on the page: a full-width outline "Check current state".
- **Count:** at least 4 boxes and 246 words for one decision.
- **Minimal recommendation:**
  - In the header, keep the car name and points against the allowance ("200 points under your allowance", the gallery's phrasing), plus the hold timer.
  - Image on the left. On the right, "Why it suits you" as 2 or 3 reasons, and only the comparison rows that differ (for the second offer: body style, boot, mpg).
  - Contact facts go behind "Your details" with an edit link. They were already confirmed in setup.
  - Declarations immediately above Accept.
  - Remove the "Time at last check" line, "More details not supplied", the bare "Eligible" and the order-number badge (keep the number in the details).
  - Make "Check current state" a small text link, or remove it if the page refreshes on presenter actions.
- **Kit:** the comparison table needs a "differences only" option.

### 6. Decline opens below the disabled Accept, leaving two primary buttons and a re-rendered select (LAYOUT, S, kit as is)
- **Where:** `paula-offer-1280-12-decline-reason-chosen.png`.
- **What goes wrong:**
  - The reason select, "Confirm decline" (primary), "Cancel" and "Check reasons again" all sit at the foot of the page, under the still-visible declarations and the disabled "Accept this offer". The screen shows two primary-styled actions with opposite meanings.
  - The helper line above Accept changes to "Choose a reason to decline this offer."
  - Choosing a reason re-renders the region, and focus fell to BODY.
- **Minimal recommendation:**
  - Decline replaces the decision region. Hide the declarations and Accept, and show the reason select with "Confirm decline" (primary) and "Keep this offer" (outline).
  - Drop "Check reasons again".
  - Keep focus on the select after it changes.
- **Earlier finding:** the 9 November finding 3 (the change question 1,400 px down) is fixed. The declined state now leads with the change.

### 7. The declined and change-saved states say everything twice, misalign the panel and show version numbers (LAYOUT, S, kit as is)
- **Where:** `paula-offer-1280-13-declined.png` and `paula-offer-1280-15-change-saved.png`.
- **What repeats:**
  - "Your decline is recorded." and "You declined the BMW 3 Series Touring 320i, 1,100 points a month." are two lines with one fact.
  - "One change to your preferences" is an uppercase heading indented about 40 px from the page column. Its box is indented a further 8 px, so it reads as a different layout from the rest of the page.
  - After saving: "Your change is saved as version 3 of your preferences." sits above a box headed "CHANGE SAVED", which says "Check whether your next offer is ready."
- **Minimal recommendation:**
  - One line: "You declined the 3 Series Touring. Change one thing and your buddy looks again."
  - Then the question, flush with the column, and a primary "Confirm this change".
  - After saving, one line, "Saved. Your buddy will look again at the next check.", with a primary "See buddy activity".
  - Drop "version 3" and the full-width "Check current state".

### 8. Your preferences: 3,270 px, 33 buttons, and every attribute asks two questions (LAYOUT, M, kit extend)
- **Where:** beat 1:30 (`paula-brief-1280-03-start.png`).
- **The screen's one job:** tell the buddy what matters.
- **What competes with it:**
  - Six attributes each show a preference control, an importance slider and an "I don't mind" button. Four of them are pairs of sliders reading "Not set / Not set", so the page is mostly empty sliders.
  - "Version 1" and "Go to your preview" sit above the form.
  - The preview column on the right says "0 eligible cars." with no explanation.
  - "What your buddy may do" is a separate box, and "Save your preferences" sits alone in its own box at the foot.
  - After saving, "Version 2 saved. Your selected buddy permissions apply." appears twice: under the Save button and again in the preview column.
  - Focus fell to BODY after Save.
- **Count:** 4 boxes, 33 buttons, 257 words.
- **Minimal recommendation:**
  - Body style and Fuel stay as they are.
  - The four slider attributes become one "Anything else?" group, collapsed by default. Each slider shows importance only after a preference is moved.
  - Put the two permissions beside Save in a single closing region.
  - Remove "Version n", "Go to your preview" and the duplicate saved message.
  - Move focus to the saved message.
- **Kit:** `range-bar` needs a "show importance on first change" pattern. This is presentation only: the same values are saved.

### 9. Renewal help is boxed twice, disclaims itself and is embedded on Buddy activity (LAYOUT, S, kit as is)
- **Where:** `paula-help-1280-26-start.png`, and the foot of every Buddy activity capture.
- **What competes with it:**
  - Two boxes.
  - Uppercase "GET HELP WITH YOUR RENEWAL", with "Opening help changes nothing." and "Remedies need the scheme team's decision. No specific next car or greater priority is guaranteed."
  - A second box, "NO RENEWAL CASE", whose only sentence repeats the first box: "Help is available if you need the scheme team to review your renewal."
  - On Buddy activity, the same block appears under an extra uppercase "RENEWAL HELP" heading, and it holds that page's only primary button.
- **Count:** 2 boxes, 3 headings, 60 words for one button.
- **Minimal recommendation:**
  - Renewal help page: h1, one sentence ("The scheme team can review a delayed or uncertain renewal."), then "Ask for help". Show the case list only when a case exists.
  - Buddy activity: replace the block with one line, "Need help with your renewal?", linking to the page.

### 10. Your cars home: two refresh-style actions, the allowance shown twice, three legacy scheme accordions (LAYOUT, M, kit as is)
- **Where:** beat 0:00 (`paula-home-1280-01-start.png`).
- **The screen's one job:** "your contract ends in 26 days, and your buddy is on it".
- **What competes with it:**
  - The first control on the page is "Refresh account".
  - The buddy box has two full-width buttons, so the widest controls on the page are its secondary ones.
  - The current-car panel:
    - repeats the contract end in two places ("Contract ends in 26 days, on 1 December 2026" and "Contract end 1 December 2026");
    - shows "Status: Current car" under the label "Your current car";
    - shows "More details not supplied";
    - has a "Choose a replacement" outline button.
  - A separate "Your allowance" box repeats the 1,300 points already in the panel.
  - Employee and Drivers disclosures follow.
  - Order history has three accordions, including "Motorcycle Choices (0 records)" and "PCS UK FS BMW (1 record)".
  - "Account as of 5 November 2026 at 09:00." closes the page.
- **Count:** 9 buttons. The current-car disclosure also holds a second "Choose a replacement" and "Print record" button.
- **Minimal recommendation:**
  - One hero region: car image, name, the countdown in warning colour, the points line, and the buddy status as one line under it ("Your buddy is looking. Last checked 09:30.").
  - One primary, which changes with state: "See buddy activity", "View your offer" or "View order progress". "Choose a replacement" is a text link beside it.
  - Merge the allowance box into the hero.
  - One "Your details" disclosure for employee and drivers, and one "Previous orders" disclosure that hides empty schemes.
  - Drop "Refresh account" (the page refreshes on presenter actions), "Status: Current car" and "Account as of…".

### 11. Released cars (manual): blocked cards still show their actions, and three counts sit above the cars (LAYOUT, M, kit extend)
- **Where:** `paula-manual-1280-05-gallery-released.png`, and the earlier capture with an offer held (an overwritten run; the state is described below).
- **What competes with it:**
  - Above the cars:
    - an allowance box;
    - "Release history: 6 cars in 1 release visible to you. Latest visible release: 5 Nov 2026, 09:30 UTC.";
    - a Series filter with one option ("All series, 6 cars");
    - a Body style filter;
    - search and sort;
    - a fourth count line: "6 released cars · 4 eligible · 6 matching · 4 eligible matching".
  - Each card: an image caption overlay repeating the name and body style in uppercase ("3 SERIES SALOON · SALOON · 320I"), "Order no. 4364043", points, allowance headroom, a "Car facts" disclosure, the bare word "Eligible", a primary "Review this car" and an outline "Vehicle details". That makes 6 primaries.
  - An ineligible card says so three times: a red "Not eligible", an accent uppercase "WHY IT IS NOT ELIGIBLE" with bullets, and "This car is not eligible." under a disabled button.
  - When the buddy holds an offer, all six cards show a disabled grey "Review this car" with "Decide on your car offer first." repeated six times, under a box that already says so.
- **Minimal recommendation:**
  - Drop the release-history lines and the four-figure count line. Keep one result count by the sort.
  - Hide any filter with a single option.
  - Show eligible cars first. Collapse ineligible ones under "2 cars you can't choose", with one reason line each.
  - Drop the overlay caption and the order number from the card face.
  - While an offer blocks reserving, show the notice once and omit the per-card buttons.
- **Kit:** the car card needs a "blocked" variant with no actions.

### 12. The manual route asks for contact details twice and repeats the order four times (LAYOUT M, plus one FEATURE S)
- **Where:**
  - `paula-manual-1280-01-setup-empty.png`: "Your order choices";
  - `paula-manual-1280-06-review.png`: "Review your car";
  - `paula-manual-1280-07-summary.png`: "Review your order";
  - `paula-manual-1280-08-outcome.png`: "Order received".
- **Setup:**
  - A "Journey / Current car" box.
  - An allowance box labelled "Your monthly allowance", whose first field is labelled "Monthly allowance".
  - A Driver box that is mostly empty space with a full-width help button.
  - Three exits at the foot: "Back to account", "Save choices" and a primary "Continue". "Save" and "Continue" are two steps for one intent.
  - Focus fell to BODY after Save.
- **Review your car:**
  - A countdown, "Car reservation: 2:00 remaining", set larger than the h1.
  - The contact and return form is asked again.
  - Five buttons in one row: "Back", "Change car", "Cancel review", "Save details" and a primary "Continue to order review". Three of them leave the page.
  - "Pinned vehicle details" is internal wording.
- **Review your order:**
  - 7 boxes, a second countdown that restarts at 10:00, and four "Change…" buttons, each with a line of consequence prose.
  - The 50-word scheme terms are repeated from the offer page.
- **Order received:** 8 boxes and 11 headings re-list every summary box (employee, driver and licence, contact, car you are returning) for a receipt.
- **Minimal recommendation:**
  - Setup: merge the journey and allowance boxes into a one-line header, and put one primary at the foot.
  - Review your car: the car, the timer and two actions ("Continue", and a text link "Choose another car"). Remove the contact form, which is already captured in setup.
  - Review your order: one row list with hairline dividers and a "Change" link per row.
  - Order received: the h1, the order reference, the status, the next step and the progress rows. Everything else goes behind "Order details" or Print.
- **FEATURE (S):** merge "Save choices" and "Continue" into "Save and continue". This changes when the save happens.

### 13. Order progress lists the same tasks twice and says "All times are UTC." twice (LAYOUT, S, kit as is)
- **Where:** `paula-order-1280-23-approvals-done.png` and `paula-order-1280-25-handover-booked.png`.
- **What repeats:**
  - "Documents and checks" shows "Not ready for handover.", then a "Still to do" list of 4 items, then a "Checklist" with "Your tasks" and "Being handled by others" holding the same 4 items, three of them as separate boxed cards.
  - "Returning your current car" repeats "Confirm your new car's handover first." under two headings.
  - "All times are UTC." sits under the h1, and "All dates are UTC." under Handover history.
  - After booking, the return slot grid adds 15 buttons.
- **Count:** 5 boxes, 11 headings, 16 buttons.
- **Minimal recommendation:**
  - Delete the "Still to do" list.
  - Make the checklist rows with dividers, not boxes. Paula's task keeps its one primary.
  - Show return choices only once handover is booked, with one line before then.
  - Drop the UTC notes (see 16).
- **What works:** the step list itself (number, name, state, "With you", "Next:") is clear. Keep it.

### 14. Offer expired dead-ends on "Check current state" (LAYOUT, S, kit as is)
- **Where:** `paula-offer-1280-04-expired.png`.
- **What goes wrong:** the page says "Open your account to check for a new offer.", but the only control is a full-width "Check current state". This is the 9 November finding 4, still present for the expired state. It is fixed for change and accept.
- **Minimal recommendation:** a primary "See buddy activity" and an outline "Back to Your cars". Remove "Check current state".

### 15. Focus rings on programmatically focused headings look like text inputs (LAYOUT, S, kit extend)
- **Where:**
  - `paula-offer-1280-13-declined.png`, "One change to your preferences";
  - `paula-offer-1280-15-change-saved.png`, "Change saved";
  - `paula-manual-1280-08-outcome.png`, the "Order received" h1;
  - `paula-signin-1280-02-error.png`, the error box.
- **What goes wrong:** arrival focus draws a rounded 2 px accent outline round a heading's full width, so the heading reads as an empty field. The walk used the keyboard. Chromium may not draw the ring after a mouse click, so the presenter may not see it, but the walker always did.
- **Minimal recommendation:** for `tabindex="-1"` arrival targets in `kit/arrival-focus`, use a subtle underline or no outline. Keep the ring for keyboard-operable controls.
- **Who it affects:** keyboard users still get the focus move announced.

### 16. Times are shown in UTC with "UTC" labels on four screens (FEATURE, S)
- **Where:** Buddy activity ("All dates are UTC."), Offer ("Time at last check: 5 Nov 2026, 09:30 UTC"), Order progress (twice) and Released cars ("09:30 UTC").
- **What goes wrong:** Paula is a UK employee. The label adds a line and a question on every screen.
- **Recommendation:** show UK local time with no label. This changes displayed values, so it is a Story. In November, UK time equals UTC, so the values on screen would not change for the demo.

## Cross-screen consistency

| What | How it varies | Recommend |
|---|---|---|
| The car | Six treatments: the home panel (image left, facts right); Activity (unframed image, facts in a third column); the offer card (order-number badge top left over the image); the gallery card (uppercase caption overlay at the bottom); review and summary ("CAR ORDER" badge below the image); order progress (small image, facts right) | One car summary component, image plus name, points and status, in two sizes |
| Image disclaimer | "Representative image, not your exact car" (home, gallery, review); "Representative image; exact appearance and equipment unconfirmed." (activity, offer); none on order progress | One wording, and one placement as a caption |
| Car number label | "Order no." (gallery), "ORDER NO." (offer badge), "CAR ORDER" (review badge), "Car order number" (facts) | "Car order number", in the details only |
| Points | "1,100 points a month · 1,300 points a month allowance" (home, offer, review) against "Within your allowance, 200 points left" (gallery) | The gallery phrasing everywhere |
| Refresh | "Refresh account", "Refresh availability", "Check current state", "Keep searching" | One quiet "Refresh" text link, or none where the page updates itself |
| Leaving a step | "Back to account", "Back to Your cars", "Back", "Cancel review", "Finish" | "Back to Your cars" everywhere |
| Breadcrumb against h1 | "YOUR CARS / YOUR CARS", "YOUR PREFERENCES / YOUR PREFERENCES", "ORDER PROGRESS / ORDER PROGRESS", "RENEWAL HELP / RENEWAL HELP" repeat the heading; "BUDDY ACTIVITY / YOUR BUDDY" and "YOUR OFFER / YOUR CAR OFFER" differ | Drop the breadcrumb where it equals the h1, per the spec. Use one name per place: the rail label equals the h1 |
| Section headings | Uppercase sentence-length h2/h3s in some components ("YOU ALREADY HAVE A CAR OFFER", "GET HELP WITH YOUR RENEWAL", "NO RENEWAL CASE", "ONE CHANGE TO YOUR PREFERENCES", "CHANGE SAVED", "YOUR ORDER IS IN PROGRESS", embedded "ORDER PROGRESS") beside sentence-case h2s elsewhere | Sentence case for every h2 and h3: only four type steps |
| Kickers | "WHY IT SUITS YOU" and "WHY IT IS NOT ELIGIBLE" in accent uppercase | Muted 12 px sentence case (spec: "Labels… kickers are muted, never accent") |
| Primary placement | Under the h1 (offer accepted, order received), bottom left (setup), inside a right-hand panel (review), full width (home buddy box), absent (Your cars after acceptance, which has 0 primaries) | One primary, bottom left of the decision region, the same width as other buttons |
| Contact details | Shown or edited on setup, review, summary, offer "Before you accept" and order received | Captured once in setup, then a single "Your details" row with Change |
| Scheme terms | The same 50-word paragraph on the offer page and the order summary | Keep it identical, but put it behind a "Scheme terms" disclosure next to the declarations |
| Help | Renewal help in the account menu and embedded in Activity, not in the rail. Your preferences is in both the rail and the account menu | Help in one place (the account menu), plus contextual links |

## Earlier findings: status at 10 November

- **9 Nov, 3 (decline focus far down):** fixed. The declined state leads with the change question.
- **9 Nov, 4 (offer dead-ends):** fixed after the change and after acceptance. It is still present when the offer expires (finding 14).
- **9 Nov, 7 (pages stale after Next release):** fixed on Buddy activity. "View offer" appeared without a reload (`paula-activity-1280-06-after-release-live.png`).
- **9 Nov, 2 ("0% fit" on the brief):** not seen in this walk. The preview reads "0 eligible cars." before release, which still needs a reason.
- **9 Nov, 1 (internal codes):** reduced. The remaining internal labels are "Version n", "Order no. 4364043" on cards, "Pinned vehicle details" and the UTC labels.
- **10 Nov flow review, 1, 2, 3 and 4:** fixed. Home has a buddy entry, a saved brief offers "See your buddy at work", "Local preview" is gone, and Renewal help is in the account menu.

## Focus loss (light check)

Focus landed on BODY after these actions:

- "Save your preferences";
- "Save choices" on setup;
- choosing a decline reason, where the region re-renders.

Elsewhere, focus moves to the new h1 or section heading as intended. Tab order reached every control, and no control was missing a focus indicator, apart from the native date input on setup, which draws its own.

## What works and should stay

- **Sign in:** one box, one heading, one button, and a clear error. It is the benchmark for the rest.
- **The account menu:** name, email, grade, two shortcuts and Sign out. It is compact and correct.
- **The order progress step list,** with "With you" and "Next:" per step.
- **The declined state** leads straight into the one change, and the saved state offers the next step.
- **Gallery allowance headroom:** "Within your allowance, 200 points left" is the clearest points copy in the product.
- **Real car imagery** on every car surface. The "no photos" risk in the run sheet is gone for this stock.

## Not reached, and why

- **Phone (375):** dropped by Gary's scope change mid-run.
- **The renewal help request form and case states:** not opened in this run. The FUCQ-248 run 2 captures cover them.
- **Uncertain handoff and data unavailable:** not walked here. Run 2 covered them.
- **The `gcsp-employee.html?fixture=` loading and unavailable states:** the hosted front does not serve `gcsp-employee.html` (404), and starting the static server was outside this run. Your cars `?fixture=source-failure` and `not-yet-eligible` were captured (`paula-home-fixture-1280-07/08`) and add nothing new beyond finding 10.
- **Manual gallery while the buddy holds an offer:** walked, but the capture was overwritten by the rerun on "No suitable match". The state is described in finding 11 from the earlier run's log.

## Recommended backlog tickets (the dispatcher raises them)

1. LAYOUT S: Buddy activity drops the empty offer panel and leads with one status line (1).
2. LAYOUT S: Buddy activity, "found a car" heading with a primary "View offer"; Renewal help becomes a link (2, 9).
3. LAYOUT M: Offer accepted becomes a short confirmation with no embedded offer or tracker (3).
4. LAYOUT M: Your cars shows one "Your new car" row instead of the embedded tracker; history collapsed (4).
5. LAYOUT M: Offer page in one decision region: differences-only comparison, details behind a disclosure, no "Check current state" (5).
6. LAYOUT S: Decline replaces the accept region, with one primary, and focus kept on change (6).
7. LAYOUT S: Declined and change-saved copy cut to one line each, no version numbers, the panel aligned to the column (7).
8. LAYOUT M: Preferences: secondary attributes collapsed, importance shown only once set, a single closing Save region, focus after Save (8).
9. LAYOUT S: Renewal help: one sentence and one button; the case list only when a case exists (9).
10. LAYOUT M: Your cars hero: one region with one state-driven primary; "Refresh account" and the duplicate allowance removed (10).
11. LAYOUT M: Released cars: noise lines removed, ineligible cars collapsed, a blocked-card variant with no actions (11).
12. LAYOUT M: Manual review, summary and outcome as rows not cards; contact asked once; one exit per step (12).
13. FEATURE S: Setup "Save and continue" replaces the separate Save and Continue (12).
14. LAYOUT S: Order progress: the duplicate "Still to do" list removed, the checklist as rows, return choices shown after booking (13).
15. LAYOUT S: Offer expired gets "See buddy activity" and "Back to Your cars" (14).
16. LAYOUT S: Arrival focus on headings drops the input-like outline (kit `arrival-focus`) (15).
17. FEATURE S: UK local time on Paula's screens, with no "UTC" labels (16).
18. LAYOUT M: Consistency pass: one car summary component, one image disclaimer, one points phrasing, sentence-case h2 and h3, muted kickers, breadcrumbs that don't repeat the h1 (cross-screen table).
