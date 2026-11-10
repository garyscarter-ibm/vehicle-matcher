# GCSP UX revamp handover, 10 November 2026

Goal: Gary's "minimal and meaningful" UX pass. Scope is now Paula's screens only, desktop only, and a quick build for
the demo, testing only what's needed (Gary, 10 November).

## Done, on gcsp-poc (b3eb87ef)

- [Plan](ux-revamp-plan-2026-11-10.md) and the [Paula](ux-revamp-review-2026-11-10-paula.md) and
  [Greg](ux-revamp-review-2026-11-10-greg.md) reviews, with evidence in `evidence/fucq-248/revamp-2026-11-10/`.
- Slices 1 to 6 and 8 are built, reviewed and pushed: shared consistency, Buddy activity, the offer decision, after
  acceptance, Your cars and preferences, Greg's rail views, and the presenter and outbox.
- Deferred Stories FUCQ-350 to FUCQ-357 are filed in Jira.

## Left

- Slice 7 (Greg answers first) was stopped when Gary narrowed the scope to Paula. Its partial diff is saved as
  `slice7-greg-partial.patch` in the side-session notes folder. Not applied, so it would need a Story if wanted.
- The Paula browser walk on the new build writes to `evidence/fucq-248/revamp-2026-11-10/after/`: check it.
- Known test failures that predate this work: `gcsp-live-regions` (2 cases), `gcsp-brief` (retained fixtures) and
  `gcsp-activity-live`. `render.test.js` "no em dashes" times out only under parallel load.
- Not done: the manual route (FUCQ-355), the shared car component (FUCQ-357) and UK local time (FUCQ-354).
