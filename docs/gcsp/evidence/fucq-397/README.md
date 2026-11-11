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


## Integration validation, 11 November 2026

Merged the agreed local `gcsp-poc` checkpoint `d3a768d32f5ca6f2b167c4b472450c594be6a887`, preserving the role-adaptive Greg navigation and Account engagement semantics. The tile uses distinct `/api/gcsp/brief/pause-search` and `/resume-search` editor commands: both check brief/draft versions and accepted-search status, Resume applies the Account minimum, and Pause retains consent and existing holds. The standalone Engage/Disengage commands and legacy aliases retain their upstream behavior.

The first integrated command chunk passed 44/44, covering actual HTTP transport/controller/service, held-offer retention, grant retention, stale brief/draft versions, Resume minimum refusal, accepted read-only checks including the transactional race, legacy aliases, and employee/ordering role composition. Boundary validation passed 347/349; the failures were an outdated Account fixture lacking the new roles field and an old Active-label assertion. Quality validation passed 164/168; two checks expected the retired rail label instead of the existing Your buddy heading, while two stylesheet failures were already known: FUCQ-387 presenter-console.css 44 lines against cap 39, and release-section.css 15 against cap 17 before the separate Presenter merge. These unrelated stylesheets were not changed here. The fixture and heading assertions were aligned with the merged contracts and rerun below.

Final affected checks include Account/tile rendering, editor command/service regressions, controller behavior and all painted-copy checks. Browser acceptance and screenshots remain the parent's integration responsibility. These are scoped checks, not a full-suite claim.


The final focused rerun passed 133/134 (Account/tile, service commands, controller, and all painted-copy checks). The remaining parity assertion identified the same new roles field in the separate Sam unsupported-scheme snapshot; after aligning both snapshots, its exact rerun passed 1/1. The tile's retained-grant paused state visibly reads Paused, while shared legacy status wording remains intact; the tile tests were rerun after that presentation correction. This is composite scoped evidence, with all observed failures retained above. Final browser acceptance remains unrun here.
