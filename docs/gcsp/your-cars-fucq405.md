# FUCQ-405: Your cars refinement

Gary approved the light two-column concept on 11 November 2026: retain the large whole-car image, a small corner pill of rating stars, Buddy understanding, and a clear separation between editable preferences and Buddy activity. Remove Search settings/details and the bell's all-activity link. Notifications show current/new and expired offers only; preference, permission and decision events remain in Buddy history. Do not merge until Gary explicitly approves.

## Component plan

- Reuse the account shell, mediaWell, facts, record drawer and table; simplify the current-car summary without removing its record data.
- Extend starRating with an opt-in small pill; preserve native radio, save, retry and keyboard behaviour.
- Extend categoryPreferences with opt-in alternative mode buttons and Same again summary; preserve saved custom preferences and the server-owned understanding score.
- Reuse buddyTile and activityTimeline; remove Search details, keep useful search readback in history and one Pause/Resume command.
- Reuse notificationBell and its live source, restricting projected rows to active/expired offers, removing the footer and phantom thumbnail spacing.

## Validation plan

Scoped tests: gcsp-account-render/runtime/buddy, gcsp-category-preferences, gcsp-account-preferences-mount/controller, gcsp-star-rating, gcsp-notification-bell, gcsp-understanding-meter and UI ratchet. These cover account records and journey authority, persistent editing/saving, rating interactions, Buddy commands and offer notifications. Use one worker. No backend contracts or matching algorithms change; the full backend suite is excluded. Inspect the actual local memory runtime at desktop and narrow widths, including focus/Escape, Same again, rating, Buddy history and notification content. Retain a compact receipt. No merge or deployment.

## Delivery evidence

Built on `dev/fucq-405-your-cars`, based on `802167470956`. No merge or deployment is authorised. Gary stopped Jira updates during delivery: no further Jira writes are made and its last observed In Progress status is preserved locally. The separate Your offer design chat is desktop-only; Gary also removed phone/tablet review from the remaining current scope.

The account uses the approved 1.6:1 desktop composition and the existing whole-car image. Full contract, collection, order and specification facts remain in the car record drawer. The current car and Buddy no longer duplicate a held-offer action. Shared rating and preference-mode extensions are opt-in, catalogued and shown in the gallery. Buddy owns Pause/Resume; setup still retains validated Engage, save/retry and server-owned understanding. Search status and exclusions live in Buddy history. The bell projects only current and expired offers and has no activity footer or phantom thumbnail padding.

### Scoped checks

- Final account render suite: **70/70 pass**, including the new current-car record opener across a quiet redraw, Escape focus return, full facts, journey and history assertions.
- Latest UI/account-preference run: **132/134 pass**. The two failures are backend preview fixtures returning `feedback-baseline-unavailable`; both reproduce unchanged at the base. Existing diagnosis FUCQ-406 was recorded before Jira updates stopped. This UI change does not repair or hide them.
- Shared kit contracts, painted copy and shell: **95/95 pass**.
- Final Buddy suite after the primary held-offer action adjustment: **6/6 pass**.
- The earlier account controller/runtime/understanding checks outside the render suite passed **60/60**; their implementation and tests are unchanged after that run.
- Final UI ratchet: **147/148 pass**. Only the unchanged Presenter console CSS exceeds its existing cap (44 lines, cap39, existing FUCQ-387). Every changed stylesheet passes; existing caps were not raised.
- `git diff --check` passes. The full backend suite was not run: this is presentation work with existing adapters, not matching/policy/API changes. The repository affected-test selector is Python-only; explicit JavaScript regressions and shared boundaries were selected instead. A code/test identity map and timings are retained in the shared `.claude/test-runs/impact/` directory.

### Actual runtime review

Used an isolated memory runtime on port8895 with one test worker. Desktop inspected at1440x1080 against the approved light concept and `docs/gcsp/experience-quality.md`. Verified rating save and reload, custom choices restoring after Same again, native mode arrow keys, server-owned understanding, Engage validation and disappearing redundant action, Pause/Resume, preserved held offer, Buddy history/search readback and Escape focus return, and current-car record/Escape. A stable contract key restores the current-car record opener after quiet account redraws. Earlier390px inspection occurred before the desktop-only instruction; no final phone/tablet conformance claim is made.

In the Main successful journey scenario, released Day2 stock to create a real BMW X2 offer, paused Buddy, then advanced to Day3. The bell remained offer-only after preference/permission changes; expiry produced one compact expired row without a badge, footer or blank image gutter. Its supplied link opened the actual Offer expired state. No hosted/shared runtime was changed.

Screenshots are local review artifacts under `/Users/garycarter/Documents/Codex/2026-11-11/wit/outputs/`: `your-cars-desktop.jpg`, `your-cars-offer-notification.jpg`, `your-cars-expired-notification.jpg`. Detailed bounded test logs are in that chat's `work/` directory. To repeat, start a local memory runtime from this branch, sign in as Paula, inspect Your cars, and use the local Presenter Main successful journey scenario for release/expiry.

Development is ready for review with the baseline failures above disclosed; acceptance and merge remain Gary's decision. No Jira transition is implied.
