# Shell header says a failed account read once (11 Nov)

Follow-up to the Your cars UI rules pass (`your-cars-ui-rules-review-2026-11-11.md`, critique item "Medium,
follow-up"). Desktop 1280 only. Captures: `evidence/header-failure-once-2026-11-11/before/` and `after/` (same
names, each with `report.json` listing the header state, headings and body buttons). `01` to `03` use the
committed harnesses; `04` to `08` used a scratch page, not committed, that mounts each page with a failing `loadAccount`.

## The problem

Whenever the account read failed or conflicted, the shell header showed "Account unavailable" with "Retry", while
the page body showed its own failure region. So the fact was said twice, Refresh had two names, and on a conflict
the header said "unavailable" while the body said "Your account has changed". On Buddy activity and Order progress
the body's own Retry was disabled, so the only working action was the header's.

## The choice

**Keep the header quiet while the body shows the failure.** Making the header match the state and say "Refresh"
would still say the fact twice and put two primaries on screen. The shell already has this pattern: a restarted run
leaves the header empty and the page's Reload is the one action (FUCQ-201).

`portalShell({ accountFailure: 'page' })` returns an empty account box on `status: 'unavailable'`;
`mountEmployee` passes `ctx.accountFailure` through and gives `renderBody` a `refresh` that re-reads the account.
The default stays `'header'`, so pages whose body ignores the account state keep the header fallback.

## Pages

| Capture | Page | Before | After |
|---|---|---|---|
| `01` | Your cars, source failure | Header "Account unavailable / Retry" above "Your account is unavailable / Refresh" | Header quiet; body unchanged |
| `02` | Your cars, conflict | Header "Account unavailable / Retry" above "Your account has changed / Refresh" | Header quiet; body unchanged |
| `03` | Representative fixture | Header Retry; body "Use Retry in the header to try again." | Header quiet; body primary Refresh |
| `04` | Your preferences | Header Retry; body has no action | Header quiet; body "Refresh to try again." with primary Refresh |
| `05` | Buddy activity | Header Retry; body Retry disabled | Header quiet; body Retry re-reads the account |
| `06` | Order progress | Header Retry; body Retry disabled | Header quiet; body Retry re-reads the account |
| `07` | Manual setup | Header Retry and body Retry | Header quiet; body Retry re-reads the account and choices |
| `08` | Offer follow-up | Header Retry; body has no action | Header quiet; body "Refresh to try again." with primary Refresh |

Not opted in, because their bodies don't show the account failure: Renewal help, the manual gallery, review and
summary, and the saved-journey check. They keep the header fallback.

## Tests

Scoped, one worker: `gcsp-shell`, `gcsp-shell-navigation`, `gcsp-shell-arrival-focus`, `gcsp-shell-inset`,
`gcsp-account-render`, `gcsp-brief`, `gcsp-brief-runtime`, `gcsp-activity-entry`, `gcsp-order-progress-entry`,
`gcsp-manual-setup`, `gcsp-manual-setup-render`, the three offer follow-up suites, `gcsp-second-offer-render`,
`gcsp-live-regions`, `launcher-employee-entry`, `ui-ratchet`, `gcsp-painted-copy-words`. 437 tests, 432 pass.

The 4 failures also fail on unchanged gcsp-poc (3eac140e), so this change didn't cause them: `gcsp-brief` (fixture
`sourceVersion` 2 vs 1), two `gcsp-order-progress-entry` tests (no "BMW i4" in the body) and
`launcher-employee-entry` (3 adapter calls, expected 4).

## Open

- Buddy activity, Order progress and Manual setup name the body action "Retry", while Your cars, Your preferences
  and the follow-up say "Refresh". Each screen now has one name; the portal still has two.
- The header fallback on the pages that aren't opted in still says "Retry".
- Your preferences, Manual setup and the follow-up have no h1 in the failure state: the status title is an h2.
