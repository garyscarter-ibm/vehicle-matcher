# FUCQ-366 What happened feed: rendered check

Desktop 1280 only (Gary, 10 November 2026). Headless Chrome over CDP against `GCSP_RUNTIME=1 GCSP_REPOSITORY_MODE=memory GCSP_OFFLINE=1` on `http://localhost:9640`, tree `dev/DEV-2026-11-10-GC-043` after merging gcsp-poc b46642ce (FUCQ-362 included), uncommitted feed changes.

| File | State |
|---|---|
| `01-empty-run-1280.png` | After a confirmed Start again: one row, "Thu 5 Nov, 9:00am  Scheme started, no cars on the scheme yet", at the very end of the Basic stage. |
| `02-after-release-1280.png` | After Release: "Fri 6 Nov, 11:30am Offer email sent" with **View email**, "6 cars released", "Scheme started", newest first. |
| `03-email-drawer-1280.png` | Enter on View email: the kit side drawer ("Captured email", the subject as title) with the sandboxed email frame, 480 px wide, scrim behind. |
| `04-focus-returned-1280.png` | Escape closed the drawer; focus is back on the same View email button with its 2px ring. |

Checked by keyboard: Enter opens the drawer and focuses its title; Tab cycles Close, Open the offer, the email frame, Plain-text version, Delivery attempts and back to Close, never leaving the drawer; Escape and the Close button both close it and return focus to View email; Space reopens it. A second release (Monday) added "Offer email sent", "Hold lapsed" and "3 cars released" above Friday's rows. No console errors; the painted feed has no em dash, no UTC and none of the banned words. Feed rows name no employee.

Independent critique (Sylvester, runner): 01, 02 and 04 pass. In 03 the email body itself shows `runId=demo-...` in its offer link and the frame is a fixed 520 px with inner scrolling; both come from the existing captured email and `messageList` detail, unchanged here and identical on `gcsp-outbox.html`.
