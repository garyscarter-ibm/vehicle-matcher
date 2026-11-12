# Notification row divider, 12 November 2026

Gary reported a recurring divider above **Notification email** and confirmed the extra line is
the issue. His supplied screenshot was inspected at
`/Users/garycarter/Documents/screenshots/Screenshot 2026-11-12 at 00.04.01.png`.
The original attachment is retained beside this report under
`evidence/notification-divider-2026-11-12/reported.png`.

## Diagnosis before repair

Severity Low: isolated presentation fault. The disclosure still starts closed at the bottom of
Your details; this report does not identify a delivery or saved-address failure. Origin is the
composition change `b33df2c1`, already documented in
[employee notification settings](employee-delivery-email-2026-11-11.md). An exact native Jira Story
origin for this small composition change is unresolved; no new issue is created while Jira writes
remain paused.

Reproduction at `3300d33f`: mount the normal account composition with the complete ordered list of
stylesheets from `gcsp-account.html`. The notification disclosure has a computed 1 px top border.
Expected: the containing table row supplies its divider, with no second line inside the value cell.
The baseline browser assertion failed with `1px !== 0px`; screenshot:
`/Users/garycarter/Documents/Codex/2026-11-11/emai/outputs/notification-divider-before-1440.png`.
Supervisor log: `.claude/test-runs/logs/20261112-000700-6q_xpj5e` (1 failed, expected reproduction).

Cause: `.gcsp .gcsp-account-email-settings` has the same specificity as the shared
`.gcsp .gcsp-details` rule. Manual setup, gallery and review stylesheets loaded after the account
stylesheet import the shared employee stylesheet again, restoring its border and top padding.
The earlier reduced browser preview omitted these later stylesheets and missed the cascade.
The deployed account CSS still contains the earlier override; this is not evidence of its removal.

Smallest repair: qualify the account's existing override with its disclosure class, keeping it
more specific than the shared rule regardless of this load order. Other disclosures retain their
shared border, and no settings or delivery logic changes. The browser check now reads the complete
stylesheet sequence from the real account HTML and explicitly checks border and top padding,
alongside closed/open, keyboard, save/clear and narrow layout behaviour.

## Result

The disclosure now uses `.gcsp .gcsp-details.gcsp-account-email-settings` for its existing zero-border,
zero-padding rule. No HTML, JavaScript, shared component default or data changed.

- Final settings, account-render and local Chrome run: **80 passed, 0 failed, 0 skipped** at base
  `3300d33f`. Both 1440 px and 390 px layouts have computed border/padding of zero, remain collapsed
  by default, open/save/clear/close by keyboard and have no horizontal overflow or browser errors.
  Receipt: `.claude/test-runs/targeted-55347a60d00bf137f3e19effdf8a9d01157cb8f8ec77d390094db01ab8902d45-default-1794442077591448000.json`.
- Account stylesheet ratchet: **2 passed, 0 failed**, limited to the changed stylesheet's growth
  and shrink guards. The whole UI ratchet was not selected. Receipt:
  `.claude/test-runs/targeted-55347a60d00bf137f3e19effdf8a9d01157cb8f8ec77d390094db01ab8902d45-default-1794442092355922000.json`.
- Desktop and narrow captures were visually inspected. All three supervised runs, including the
  expected failing reproduction, removed their owned scratch. `git diff --check` passed.

Evidence: [reported screenshot](evidence/notification-divider-2026-11-12/reported.png),
[fixed desktop](evidence/notification-divider-2026-11-12/desktop.png),
[fixed narrow](evidence/notification-divider-2026-11-12/narrow.png) and
[browser checks](evidence/notification-divider-2026-11-12/checks.json).
The reported attachment's SHA256 is
`67f92ef75ab7e272f10faa2fdd58e0c33cd8f971519e196bcdcb9a2fe4691f6b`; retained bytes match the supplied file.
The local browser check remains at
`/Users/garycarter/Documents/Codex/2026-11-11/emai/work/notification-email-visual.test.mjs`.

Browser verification uses the actual page's stylesheet list with a local account adapter. No live
employee setting or email was changed; no authenticated hosted-UI pass or full-suite pass is claimed.
Jira writes remain paused.
