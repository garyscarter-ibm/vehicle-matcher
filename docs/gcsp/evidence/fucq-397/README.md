# FUCQ-397 Buddy on Your cars

Approved reference: `docs/gcsp/mockups/buddy-allocation-2026-11-11/buddy-tile-options.html`, Option A. Implementation: Pussyfoot (they/them), requested/selected `gpt-6.1-sol` / `medium`, no fallback or descendants. Desktop chat title set and verified through the title tool.

The account composes one persistent activity tile beside the existing preference picker. The activity controller and HTTP adapter own reads and Pause/Resume; the brief controller retains Engage/Disengage, categories, Same again, understanding and permission authority. Pausing does not release or change a held offer. The former header lamp and separate Buddy rail item are removed; the standalone activity page and routes remain available.

The two recent rows are actual projected permission changes, offered cars and the latest verified check, ordered newest first. Buddy history shows all of those available projected rows. The existing activity projection supplies only the latest successful check, so the UI never invents earlier check executions or a decision timestamp from an offer creation time. Search details reuse supplied check/exclusion reasons; the held-offer drawer reuses the existing offer display and real review link.

## Repeatable inspection

Serve the repository using `npm run serve`. Read-only account previews:

- `/gcsp-account.html?fixture=ready&prefs=selected&activity=searching`
- Replace `activity` with `paused`, `offer`, `paused-offer`, `setup`, `inactive`, `finished`, `loading`, `unavailable`, `source-delayed` or `source-unavailable`.
- Gallery: `/components.html#gcsp-buddy-tile` has eight presentation states.

At desktop and narrow widths check that preference category labels remain readable (the shared picker responds to its container), the meter and Same again remain available, and only one Buddy state is shown. Open Buddy history, Search details and View held offer; Tab stays in the existing modal drawer and Escape/Close returns focus to its opener.

For real commands use `/gcsp-account.html` in an authenticated employee run. Engage through the preference footer, Pause through the tile, then Resume. Verify activity readback and stable command focus; while an offer is held, Pause must retain that offer and its deadline/review link. Presenter actions cause quiet authoritative rereads. Refreshing the account or disconnecting closes an open drawer and restores page interaction. Accepted search shows finished and order tracking without Pause/Resume. Parent owns real browser command trials and desktop/narrow captures; no screenshots are committed.

## Scoped automated evidence

Initial state/preferences/controller/navigation chunk: 125/125 passed through `_tools/test_stamp.py --targeted HEAD` with an explicit single-worker Node command. An obsolete retired-rail test selector was corrected after its initial failure.

The second boundary chunk initially could not import five files because the worktree lacked the existing declared `pg` package. `npm ci --prefix server --ignore-scripts --no-audit --no-fund` installed the existing lockfile dependencies (no dependency changes). After that, 171/173 passed; the remaining assertions described the replaced header lamp and the old preferences URL and were updated to the current tile/retained shortcut contract. Final integrated validation is recorded below after merging the current base.

The UI ratchet initially reported existing presenter-console cap debt tracked separately under FUCQ-387 and a presenter release-section shrink requiring its owner's cap update. No Buddy/account/category cap was raised. The new Buddy stylesheet has its own 15-line cap. Backend allocation/stock/engine and the full suite are excluded because this change consumes existing activity/command boundaries. Browser review remains separate from scoped DOM checks.
