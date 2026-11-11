# Handover: header notification bell (FUCQ-375), 11 November 2026

The demo is on 12 November. This session raised, built and merged the bell; it is now In Review for Gary.

## Goal

When Paula's buddy reserves a car, she sees it on whatever employee page she is on: a bell in the portal header with
a badge, a short note and a dropdown that leads to the existing offer page. This is the demo brief's "matching in-app alert".

## Done

- Storyboard approved by Gary (direction A, bell with dropdown): `docs/gcsp/mockups/buddy-notifications-2026-11-10/index.html`.
- [FUCQ-375](https://ibm-consulting.atlassian.net/browse/FUCQ-375), Should, 5 points, **In Review**, assigned to Gary.
- Merged into `gcsp-poc` (code `5f0e9d7f`, evidence `86c77fb6`, merge `505644d8`, record closed `c4f91c5b`).
  Story record: `_dev/done/2026-11/DEV-2026-11-10-GC-046.md` (its `## Result` block lists ACs, tests and judgement calls).
- Live two-tab check at 1280 passed: `docs/gcsp/evidence/fucq-375/README.md`.
- Targeted tests: 323/326 on the merged tree, 166/166 presenter and release-grid, new bell tests 18/18. Full suite not run.

## Decisions

- The badge counts open decisions (an active offer), not unread rows; nothing is stored. It reads `/api/gcsp/activity`, never email delivery.
- The offer page stays the one place to accept or decline (FUCQ-278); the bell only links to it.
- Gary approved an AC revision during the build: re-read every 30 seconds while the tab is visible, so a console in another
  browser still updates the bell (recorded in Jira and the story record).
- Implementer's judgement calls, open for Gary to change: the expired row links "Open Buddy activity"; at most 6 rows;
  only the newest offer gets a thumbnail; `?fixture=` pages show no bell; "Respond by" shows UTC like the rest of the activity copy.

## Left

- Gary reviews FUCQ-375 and moves it to Done or back to In Progress. Only Gary moves it on from In Review.
- Not walked live: accept or expiry clearing the badge (storyboard frame 5) and the 30-second poll. Both are unit-tested.
- Three pre-existing test failures on `gcsp-poc` (render "no em dashes in painted copy", activity-live "actual live entry
  bootstraps...", live-regions "activity loading and help standalone...") are being triaged in their own session,
  "Triage three failing tests on gcsp-poc". Don't duplicate that work.

## Files to read first

1. `_dev/done/2026-11/DEV-2026-11-10-GC-046.md` (ACs and result).
2. `blocks/gcsp/kit/notification-bell.js` and `blocks/gcsp/activity/notification-source.js` (component and live source).
3. `blocks/gcsp/shell/portal-shell.js` (the `notifications` slot).
4. `docs/gcsp/evidence/fucq-375/` (live check, its script and screenshots).

## Notes for running things

- A worktree has no `server/node_modules`, so `pg` is missing: symlink the main checkout's `server/node_modules` and remove it after.
- Hosted run: `GCSP_RUNTIME=1 GCSP_REPOSITORY_MODE=memory` from `server/`. Paula signs in at `/gcsp/login` as
  `paula.mason@gcsp-demo.com` / `fucq`. The presenter console is `/gcsp-presenter.html`, with Release and Start again.
  Reload the console after Start again before pressing Release, or it reports that a presenter control session is required.
