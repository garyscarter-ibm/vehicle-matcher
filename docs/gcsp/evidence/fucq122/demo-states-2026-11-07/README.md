# FUCQ-122 retained employee states, 7 November 2026

Browser check of `gcsp-help.html?fixture=<state>` served over loopback HTTP (`scripts/serve.js`, port 3100)
from the DEV-2026-11-04-084 worktree after merging `gcsp-poc`. Named fixtures are read-only synthetic
snapshots: they prove rendering, focus and announcements, not live service writes. Live request, update and
reload evidence is the earlier `current-host-browser-2026-11-06/` set.

| Width | States captured |
| --- | --- |
| 1280×900 | none, request, trigger, in-progress, resolved, closed, loading, unavailable; help open, request form, confirmation review, confirmation refused; request history |
| 375×812 | the same eight states; help open, request form; request history |

Observed at both widths: no document overflow; no inline scripts or inline handlers; loading and
unavailable use `role=status` / `role=alert`. Keyboard only: Tab reaches "Get help with your renewal"
(9 Tabs at 1280, 4 at 375), Enter opens it with "Opening help changes nothing", Ask for help focuses the
labelled textarea, Review shows "This opens a scheme-team case or adds to your existing case" before
Confirm, Cancel returns focus to the summary. At 1280, Confirm against the read-only fixture showed the
refusal as an alert and moved focus to it; no success was implied. Focus rings were visible throughout.

Console: only 404s for `/api/gcsp/presenter/controls`, which the static server does not serve (the
presenter bar on the page); not a product defect.

`1280-trigger.jpg`, both `*-request-history.jpg` files and the two `1280-none-confirm-*.jpg` files were
retaken after the readable owner role, trigger and actor labels landed.
