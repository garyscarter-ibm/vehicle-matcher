# Preferences navigation · 11 November 2026

Gary requested removal of the standalone Your preferences page from app navigation, retaining its code. The shared rail now contains Your cars, Buddy activity and Order progress; the account menu keeps Renewal help. Existing setup/review shortcuts now lead to the inline preferences section on Your cars. The legacy page and editor remain directly loadable in source, with an explicit view label.

Scoped verification: 119 distinct current checks pass across shell navigation, shell rendering, offer routes and manual reservation release/navigation. The first combined run was 118/119: the adapted manual-review test clicked the already-current Your cars item. Selecting Order progress corrected the test destination; all 13 manual-review checks then passed. No runtime source changes followed the passing shell/offer checks. The full suite was not selected because server, matching, stock and Presenter behavior are unchanged.

Local read-only fixture inspected at 1280×720 and 375×812. Desktop expanded rail/account menu shows the remaining destinations and Renewal help; Escape restores account-button focus. Narrow page layout inspected. Captures: [desktop](preferences-navigation-check.jpg), [narrow](preferences-navigation-mobile.jpg).

One test worker through the repository supervisor. Both run receipts confirm scratch removed. Retained local impact record: `.claude/test-runs/impact/preferences-navigation-83be297c05b51516.json`. Concept work is separate and remains unapproved for implementation.
