# FUCQ-122 keyboard check: Paula's Renewal help entry (not committed)

Worktree: .claude/worktrees/DEV-2026-11-04-084 at c371c51c.
Server: hosted entry on http://127.0.0.1:8793 (memory repository, runtime on, demo key local-check-122, throwaway). Started and stopped by this run. Port 8793 had no listener after stop.
Host: 127.0.0.1 only. The earlier localhost:8792 attempt was abandoned because the browser moved to localhost:8791, another server's cookie scope.

| Step | Result | What was seen |
|---|---|---|
| 1. Open presenter at 1280, enter key, submit | Pass | Redirected to /gcsp/access, key accepted, landed on "GCSP presenter workspace" at 127.0.0.1:8793. URL stable over 5 s. |
| 2. Paula as acting principal | Pass with deviation | Paula (demo-paula) was already the checked option and "Account: Paula (fictional)" was shown. I clicked the Paula option (mouse). No session/switch POST was seen on 8793. "Switch principal" could not be reached (below the 900 px viewport, scroll_to and JS focus did not bring it into clickable position), so it was not pressed. Method: click, not keyboard. |
| 3. Open Paula's activity page | Pass | gcsp-activity-live.html, title "Buddy activity · GCSP", Paula shown. |
| 4.1 Open "Get help with your renewal" disclosure with Enter | Pass | Tab count from top to the disclosure summary: 7 (1 Skip to content, 2 Paula account, 3 Your car brief, 4 Buddy activity, 5 Show labels, 6 Presenter controls, 7 Get help with your renewal). Enter opened it (details open). Focus stayed on the summary with a visible focus ring. |
| 4.2 Activate "Ask for help" | Pass with deviation | Tab from the summary went to "Ask for help". Enter opened a form, not a separate review step: a textarea (focused), "Review help request" and "Cancel". Brief said a review step; the form step was what showed. "Review help request" was not pressed. |
| 4.3 Cancel, never Confirm | Pass with deviation | Cancel was reached by Tab from the textarea through "Review help request" (not pressed) to "Cancel", and activated with Enter. There was no Confirm on this page. Form closed. |
| 4.4 Focus after cancel | Pass | Focus went to "Get help with your renewal" summary, with a visible focus ring. The "Ask for help" button is back. |
| 5. No writes during 4.1 to 4.4 | Pass | read_network_requests for 127.0.0.1:8793 showed GETs only (including /api/gcsp/cases and /api/gcsp/help at load). No POST, PUT or PATCH. The buffer is limited to recent requests. |
| 6. 375 x 812, reload, step 4.1 only | Pass | Mobile tab count to the disclosure: 5 (Skip, empty link, Paula, Presenter controls, Get help). Enter opened it. scrollWidth 375 = innerWidth 375, so no horizontal overflow. |
| 7. Console errors | One | Single error: "Failed to load resource: 404" on load. This matches the GET /api/gcsp/manual/draft 404, which appears on every load. No JS exceptions. |
| 8. Reset and stop | Pass | Viewport reset to desktop. Server stopped; no listener on 8793. |

Also observed: the tab moved to localhost:8791 during the earlier run (on another server, not touched). A POST /api/gcsp/session/switch appeared against localhost:8791 in the buffer before this run. Not issued by this run, unknown source.
