# FUCQ-214, FUCQ-215, FUCQ-219: browser evidence

- Date: 2026-11-08
- Server: http://127.0.0.1:8981 (node scripts/serve.js, PORT=8981, run under a 1500 s alarm)
- Worktree: /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-08-GC-036
- Branch: dev/DEV-2026-11-08-GC-036, HEAD 6da57123
- Widths: 1280x900 and 375x812 (mobile preset) in the Browser pane, tab-1
- Keyboard: Tab key presses; focus read with document.activeElement, walking into shadow roots.
- Headless PNGs: Google Chrome --headless=new with --window-size as listed. Added --virtual-time-budget=8000 to every capture, because without it the fixture states had not rendered when the shot was taken.

## A. Accepted brief (gcsp-brief.html?state=accepted), FUCQ-214

### 1280x900
- PASS: h1 "Your buddy found your car".
- PASS: text "You accepted a car, so your brief can no longer be changed."
- PASS: no visible input, slider, select or textarea. One hidden text input (id presenter-1) sits in a hidden presenter block outside main.
- PASS: link "See your order progress" (href /gcsp-order-progress-live.html).
- Focus order (12 presses, then the cycle repeats): 1 Skip to content, 2 SUMMARY | PPaula (fictional), 3 Your cars, 4 Your car brief, 5 Show labels, 6 See your order progress.
- PASS: order-progress link reachable at stop 6. Focus outline 2px solid rgb(2, 145, 183) confirmed in a screenshot (not saved to file).
- Console: only "Failed to load resource" 401 and 404 entries (presenter controls and readback endpoints, not served by the static server).

### 375x812
- PASS: h1, accepted text, link present. No visible form controls (same hidden input). Document scroll width 375.
- Focus order (8 presses, then the cycle repeats): 1 Skip to content, 2 Menu, 3 SUMMARY | PPaula (fictional), 4 See your order progress.
- Console: same 401 and 404 entries as above.

## B. Offer accepted (gcsp-activity.html?fixture=offer-accepted), FUCQ-215

### 1280x900
- PASS: status "Finished. You accepted a car."
- PASS: no "Search actions" control and no "Pause Search" text.
- Focus order (16 stops recorded): 1 Skip to content, 2 SUMMARY | PPaula (synthetic), 3 Your cars, 4 New order, 5 Order history, 6 Drivers and licences, 7 Scheme guidelines, 8 Buddy activity, 9 Show labels, 10 View offer, 11 SUMMARY | Get help with your renewal, 12 SUMMARY | Dated case history, 13 Not searched, 14 Searching, 15 No match, one reason, 16 No match, two reasons.
- Stops 13 to 16 are the presenter fixture switcher buttons, not search controls.
- Console: 401 and 404 resource errors. No "Uncaught" entries.

### 375x812
- PASS: status "Finished. You accepted a car.", no Search actions, no Pause Search. Document scroll width 375.
- Focus order (15 stops): 1 Skip to content, 2 Menu, 3 SUMMARY | PPaula (synthetic), 4 View offer, 5 SUMMARY | Get help with your renewal, 6 SUMMARY | Dated case history, 7 Not searched, 8 Searching, 9 No match, one reason, 10 No match, two reasons, 11 Offer waiting, 12 Offer declined, 13 Offer accepted, 14 Offer expired, 15 Paused with offer.
- Console: 401 and 404 resource errors.

## C. No match (gcsp-activity.html?fixture=no-match-one and ?fixture=no-match-two), FUCQ-219

Reason text does not match the brief. Both fixtures say 5 seats where the brief expects 9 seats. Everything else in the check is as expected.

### no-match-one, 1280x900
- FAIL: reason line reads "No released car has 5 seats." (brief expects "No released car has 9 seats.").
- PASS: buttons "Keep searching" and "Review your brief" present.
- Review your brief: disabled attribute true, no aria-disabled. aria-describedby text is "Preview only".
- Keyboard: 10 Tab presses from the page start landed on "Search actions", not Keep searching. Enter on Search actions opened its menu and moved focus to the "Pause Search" menu item. Escape closed the menu; the status stayed "Active", so no pause was taken.
- Tab from Search actions reached "Keep searching" (stop 11). Focus outline visible.
- PASS: Enter on Keep searching shows "Buddy will keep searching with your brief as it is." Focus moves to that note paragraph (outline 2px solid). Review your brief stays disabled.
- Console: 401 and 404 resource errors. No "Uncaught" entries.

### no-match-two, 1280x900
- FAIL: first reason line reads "9 of 12 cars do not have 5 seats." (brief expects "9 of 12 cars do not have 9 seats.").
- PASS: second line "6 of 12 cars do not have 430 litres of boot space."
- PASS: buttons "Keep searching" and "Review your brief" present. Review your brief disabled; aria-describedby text "Preview only".
- Keyboard: 11 Tab presses from the page start landed on "Keep searching".
- PASS: Enter shows the note "Buddy will keep searching with your brief as it is." Focus moves to the note paragraph.
- Console: 401 and 404 resource errors.

### no-match-one, 375x812
- FAIL: reason line reads "No released car has 5 seats." (brief expects 9).
- PASS: buttons present. Review your brief disabled; aria-describedby "Preview only".
- Keyboard: 5 Tab presses from the page start landed on "Keep searching" (after Skip to content, Menu, SUMMARY | PPaula, Search actions). Enter not pressed on this page at 375.
- Console: 401 and 404 resource errors. No "Uncaught" entries.

### no-match-two, 375x812
- FAIL: first reason line reads "9 of 12 cars do not have 5 seats." (brief expects 9).
- PASS: second line "6 of 12 cars do not have 430 litres of boot space."
- PASS: Keep searching at Tab stop 5. Enter shows the note "Buddy will keep searching with your brief as it is." Focus moves to the note paragraph.
- Console: 401 and 404 resource errors.

## Evidence files (this directory)

| File | Bytes | Notes |
|---|---|---|
| brief-accepted-1280.png | 87796 | Rendered, viewed |
| brief-accepted-375.png | 66075 | |
| activity-accepted-1280.png | 283589 | |
| activity-accepted-375.png | 119696 | |
| activity-no-match-one-1280.png | 30461 | Top 900 px only; the Activity section is below the fold. Same bytes as the no-match-two file. |
| activity-no-match-one-1280-tall.png | 72181 | Taller window (1280x1400), shows the Activity section; viewed |
| activity-no-match-two-1280.png | 30461 | Top 900 px only; identical to no-match-one 1280 (differences are below the fold) |
| activity-no-match-two-1280-tall.png | 77281 | Taller window (1280x1400) |
| activity-no-match-one-375.png | 40096 | |
| activity-no-match-two-375.png | 41070 | Viewed. Content renders, but the right edge appears clipped (the status text and offer box run past the frame). Not confirmed whether this is a capture-window artifact; the live 375 pane showed document scroll width 375. |

The post-Keep-searching screenshot from the Browser pane was taken but is not saved as a file; the Browser pane screenshot tool cannot write files.

## Open items for the author
1. The fixtures say 5 seats, not the 9 seats in the brief. Either the brief text or the fixture is out of date. Not changed here.
2. Review your brief is disabled with the only description "Preview only". No reason for the disabled state is given to the user in the description.
