# FUCQ-389 implementation evidence

Approved reference: [Option A](../../mockups/buddy-status-2026-11-11/consistency.html).

## Observed walkthrough, 11 November 2026

Owned local memory run, `http://localhost:4177`, production Account and Activity entry points. Sign in with the existing Paula demo credential, starting without a confirmed brief.

1. Your cars shows Buddy | Set up your buddy ›. Enter opens Your buddy, showing neutral Not set up and the visible setup button.
2. Set up your buddy opens the existing preferences editor. Explicitly select search consent and save through its existing control. No consent is granted by navigation.
3. Your buddy shows a green Active dot and an outlined Pause search button with pause icon. Enter pauses once through the existing service; pending blocks repetition, the server readback shows amber Paused/Resume search, and keyboard focus returns to Resume search.
4. Your cars reads that same saved Paused state. Enter on its single account-level indicator returns to Buddy activity.
5. Resume search with Enter restores Active/Pause search and focus; Your cars agrees after navigation. The activity history records confirmed, paused and resumed.

Inspected at 1440×1000, 375×900 and 320×850. The indicator occupies the approved title-row gap, wraps below the title when needed, and both pages have no horizontal overflow. Controls are 44px tall. Dots have accompanying words and the chevron/icons are decorative. Existing car, rating, preferences, history and details composition remains intact.

## Captures

Local retained raster evidence is ignored by repository policy, in this directory: cars-active-1440.jpg, cars-paused-1440.jpg, cars-paused-375.jpg, cars-setup-1440.jpg, buddy-active-1440.jpg, buddy-paused-1440.jpg, buddy-paused-375.jpg, buddy-active-320.jpg, cars-setup-320.jpg. Setup capture uses the named read-only `?fixture=ready&prefs=empty` Account fixture; initial setup was also exercised through the real no-brief state before saving. All active/paused captures use the real saved service state.

## Automated checks and limits

193 distinct functional tests pass across the selected Account, Activity, shared kit, presenter-refresh, live-region and painted-copy boundaries. Real authenticated HTTPS verifies both HTTP adapters agree after pause/resume. The final focused refresh/body run passes 32/32 and Account rendering passes 69/69. Core state/entry/shared-status validation passes 111/111. No full suite was run; unrelated allocation/lifecycle services were not changed. Supervisor impact/evidence is retained under shared `.claude/test-runs/impact/fucq389.md` with bounded logs.

UI ratchet 130/132: the two unchanged presenter stylesheet failures are already tracked as Low severity FUCQ-387. Buddy's shared CSS/pattern coverage passes; the Activity cap was lowered to its shorter length. This authorised scope continues under the standing sub-High backlog rule in docs/gcsp/build-rules.md; the Bug is not repaired here. Existing passing negative presenter fixtures log clockVersion TypeErrors and jsdom's print stub logs its unsupported call. Browser navigation logged view-transition abort diagnostics without a failed action.

FUCQ-370 remains separately claimed and its broader engagement/minimum-category contract is not completed by this work. FUCQ-389 awaits collaborator acceptance; integration does not establish Done.

## Integration and resource receipt

Merged concurrent shared-branch work without conflicts in Buddy code. The integration selection passes all 25 functional checks; UI ratchet remains 130/132 with only FUCQ-387's unchanged failures. No full-suite stamp is claimed.

The browser supervisor stopped and joined its owned server, verified port 4177 closed and removed `/private/tmp/test-stamp-shard-786cb7fe278c447089b7fdcaa5aef711`. Its external ownership manifest records `removed`; all supervised test allocations likewise report removed scratch. Nine small screenshots are retained locally alongside this summary in the main checkout. No large-output exception or leftover owned process/scratch.
