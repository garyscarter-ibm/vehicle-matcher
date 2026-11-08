FUCQ-122 activity host browser check, 2026-11-08 (local, memory mode, port 59634)

Activity page /gcsp-activity-live.html (1280 and 375)
- Activity state: "No confirmed search" / "Confirm a search brief to begin."
- Renewal help region sits below the activity content.
  1280: top 548px, height 925. 375: top 528px, height 837.
- Help copy: "Remedies need the scheme team's decision. No specific next car or greater priority is guaranteed."
- Disclosure "Get help with your renewal" is collapsed by default (closed triangle).
  Its text: "The scheme team can review a delayed or uncertain renewal and explain the next action. Opening help changes nothing."
- "Ask for help" sits inside the collapsed disclosure. It is not visible or tabbable until the disclosure is opened.
- Renewal case status: "No renewal case" / "Help is available if you need the scheme team to review your renewal."
- The "No renewal case" block renders faint in both screenshots (low contrast or a transition still running). Not confirmed which.

Keyboard (1280 only)
- Tab 1 to 40 from page start: "Get help with your renewal" summary reached at Tab 36. Show labels at Tab 40.
- Ask for help not reached within the 40-press budget. Brief step 4 blocked; review screen, Cancel and status message not tested.
- Shift+Tab x4 probe confirmed the order: Show labels, Buddy activity, Your car brief, Skip link.
- Focus ring confirmed on the skip link (solid 2px rgb(2,145,183)). Not checked on Ask for help.

Checks (both widths)
- Overflow 1280: scrollWidth 1280, clientWidth 1280. 375: 375 and 375.
- Inline script blocks: 0. Inline onclick/onload/onerror: 0.
- Console errors: none.
- /api/gcsp requests: all GET (200). No non-GET seen under /api/gcsp (access POST not inspected). ERR_ABORTED on presenter/controls is a navigation abort, not an error.

Order progress /gcsp-order-progress-live.html (375)
- "Order progress" / "No order yet". No help entry visible.

Visual
- 375: help heading, copy and disclosure box stack full width, no clipping.
- 1280: help region below activity, disclosure collapsed, same faint "No renewal case" block.
- The page also shows a Presenter controls panel (demo fixture) on the live activity page.
