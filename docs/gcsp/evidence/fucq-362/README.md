# FUCQ-362 Basic console: rendered check

Desktop 1280 only (Gary, 10 November 2026). Headless Chrome over CDP against `GCSP_RUNTIME=1 GCSP_REPOSITORY_MODE=memory GCSP_OFFLINE=1` on `http://localhost:9601`, tree `dev/DEV-2026-11-10-GC-039` after merging gcsp-poc f5fa4a14.

| File | State |
|---|---|
| `01-basic-ready-1280.png` | After a confirmed Start again: "Day 1 · Thu 5 Nov, 9:00am", "Ready for the next release", **Release tomorrow's cars**. |
| `02-start-again-confirm-1280.png` | The Start again confirmation, with Start again and Cancel. |
| `03-after-release-1280.png` | After the Friday release: "Day 2 · Fri 6 Nov, 11:30am", "6 cars released", **Release Monday's cars**, next release Mon 9 Nov, 11:30am. |
| `04-keyboard-release-1280.png` | After Enter on the focused Release: focus stays on **Release the next day's cars** with a visible 2px ring. |

Checked: the boot run (no saved preferences) showed a disabled **Waiting for preferences**. Start again posted `presenter/scenarios/reset` for `main-successful-journey` with the current run id and version. Release posted `presenter/controls/tick` with `mode: to` at the next weekday 11:30am UK time (Thursday to Friday, Friday to Monday). Tab order: Advanced, Release, Start again, Open the portal, each with a 2px ring. Enter on Start again opened the confirmation with focus on its Start again; Escape closed it and returned focus. No UTC, ISO time, "tick", employee name, offer, em dash or banned word on screen.

The run starts on the canonical clock scenario start (Thu 5 Nov); the spec's suggested Mon 9 Nov start is a policy change outside this story.
