# FUCQ-360 presenter console: rendered check

Desktop 1280 only (Gary, 10 November 2026). Headless Chrome against `GCSP_RUNTIME=1 GCSP_REPOSITORY_MODE=memory GCSP_OFFLINE=1` on one local origin, tree `dev/DEV-2026-11-10-GC-037`.

| File | State |
|---|---|
| `01-basic-1280.png` | Basic, the default: headline, **Release tomorrow's cars**, **Start again**, **Open the portal**. No portal header or rail. |
| `02-advanced-scenario-1280.png` | Advanced after a reload (remembered in sessionStorage), Scenario tab. |
| `03-advanced-clock-1280.png` | Clock tab after a keyboard Tick. |
| `04-advanced-last-tick-1280.png` | Last tick tab with the released count and step results. |

Checked: every Basic and Advanced control reached by Tab with a visible 2px focus ring; tab arrows, Home and End; Basic Release posted `presenter/controls/tick` with `mode: next-release`; Advanced Tick posted `mode: step`; Start again opened Scenario with Reset scenario focused, Enter showed the confirmation, Confirm posted `presenter/scenarios/reset` and the page returned to the console. No em dash and none of the banned words in painted text; no page or console errors. An independent visual critique against the approved mockup led to one fix (Last tick alignment).
