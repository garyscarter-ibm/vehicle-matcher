# Paula demo flow review, 10 November 2026

Gary asked for a review of the end-to-end flow, with Paula's journey first, so the demo runs without typing page addresses or opening tabs. The presenter controls are out of scope here because a separate session is moving them into a fly-over.

## How it was walked

The hosted entry ran in memory mode (`GCSP_RUNTIME=1 GCSP_REPOSITORY_MODE=memory`). The walk went: sign in as Paula, Your cars, Your preferences, save, Main successful journey reset, Next release, Your cars, the offer, then Buddy activity.

## Findings, worst first

1. **Home never mentioned the buddy until an offer existed.** Your cars led with the manual "Choose a replacement" route. The robot-buddy story had no entry point from home, so the presenter had to steer with the rail or a typed URL.
2. **Saving preferences was a dead end.** The page said "Version 1 saved" and offered no next step. Buddy activity was only reachable from the rail.
3. **The preferences page showed "Local preview · Version 1".** "Local preview" is a development label on a page Paula sees.
4. **Renewal help had no route from the portal.** It is not on the rail, so the presenter needed `/gcsp-help.html`.
5. **Every rail click is a full page load,** so the header, rail and presenter strip flash and re-read on each hop.
6. **The preferences page does not refresh on presenter actions.** After Next release the "Cars that suit your preferences" count stays at 0 until the page is reloaded. Activity, Your cars and Order progress do refresh.
7. **The account menu shows `paula.mason@gcsp-demo.com`.** The experience contract (FUCQ-321) requires `.test` addresses and no "demo" wording on screen. The failing `gcsp-account-render` snapshot test, which expects `paula.mason@bmwgroup.test`, is the same mismatch.
8. **The captured email lives on a separate presenter page** (`/gcsp-outbox.html`). That belongs with the presenter fly-over work.

## Built on branch `claude/demo-flow-ux-deb83c`

- **A "Your buddy" card on Your cars** (fixes 1). It appears whenever no offer or order is showing, in one of three states:
  - no preferences yet: "Set your preferences";
  - looking, with the last check: "See buddy activity";
  - paused: "Change your preferences".
  While the buddy is set up or looking, "Choose a replacement" steps back to a secondary button. It refreshes after presenter actions.
- **A next step after saving preferences** (fixes 2). With search on, a saved brief offers "See your buddy at work".
- **"Local preview" removed** from the live preferences page (fixes 3).
- **Account menu shortcuts** (fixes 4): Your preferences and Renewal help, above Sign out, on every Paula page including the offer.
- **Preferences preview refreshes on presenter actions** (fixes 6). Next release re-runs the preview on Paula's current edits, with no reload.
- **Cross-fading page changes** (eases 5). A CSS `@view-transition` keeps the header and rail steady between same-origin pages. It is off for reduced motion.

## Suggested next, not built

- **On-screen email domain** (7): decided, 10 November 2026. Gary kept `gcsp-demo.com`, Russell's sign-in domain. The experience contract now says so, and the stale `.test` browser fixtures were brought into line, which clears the failing account snapshot test.
- **One-page Paula portal.** Every view already mounts inside `mountEmployee` with an `onNavigate` hook, so one HTML host with `history.pushState` routing could swap views in place, with no reloads at all. It is too broad to land safely before 12 November. It is a good first item after the demo.
