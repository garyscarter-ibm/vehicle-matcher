# FUCQ-124 browser evidence: lifecycle after selection

8 November 2026. Keyboard-only walkthrough of Paula's journey from FUCQ-109's accepted second offer through approval, the replacement handover, documents and readiness, and a separate return plan, then a basic help request, at 1280x900 and 375x812. It runs against the hosted entry exactly as Render starts it. The retained difficult cases that the browser cannot set up are covered by `server/test/gcsp-lifecycle-e2e.test.js` (see "Not reachable from the browser").

- **Run against code commit:** `95af5708` (branch `dev/DEV-2026-11-04-087`, includes the FUCQ-184 and FUCQ-185 fixes). The runner itself was committed after the runs; it does not touch app code.
- **Stock mode:** default generated run stock, as Render runs it (no `GCSP_STOCK_SOURCE`). It gives the same three eligible cars and the same Saloon second offer at both widths, and every time value below is demo-clock time, so the run repeats.
- **Host:** `node index.js` in `server/` with `GCSP_RUNTIME=1`, `GCSP_REPOSITORY_MODE=memory`, a throwaway `DEMO_ACCESS_KEY`, on `127.0.0.1` port 8840 (1280) or 8841 (375). Nothing stubbed, no live external calls, no PostgreSQL.
- **Browser:** headless Google Chrome 157 through the playwright-core import FUCQ-109's runner already uses; a fresh profile per run, removed afterwards.

## How to run

From the repository root, one viewport per run, run sequentially (each takes about 12 minutes; the last 19 steps are this story's):

```sh
export TMPDIR=<owned scratch dir> FUCQ110_SCRATCH=<owned scratch dir>
FUCQ110_CHUNK=desktop perl -e 'alarm shift; exec @ARGV' 1500 node docs/gcsp/evidence/fucq-110/browser-walkthrough.mjs
FUCQ110_CHUNK=narrow  perl -e 'alarm shift; exec @ARGV' 1500 node docs/gcsp/evidence/fucq-110/browser-walkthrough.mjs
FUCQ110_VARIANT=overdue FUCQ110_CHUNK=desktop perl -e 'alarm shift; exec @ARGV' 1500 node docs/gcsp/evidence/fucq-110/browser-walkthrough.mjs
```

`FUCQ110_PORT` (8840 to 8849 only), `FUCQ110_STOCK=demo` and `FUCQ110_VARIANT=overdue` are optional. The runner is a copy of `../fucq-89/browser-walkthrough.mjs` (FUCQ-109) with its journey kept and the lifecycle steps added; the FUCQ-109 prelude is not photographed here, see `../fucq-89/browser/`. Every expected stage, tick count, delay and item time is read from `server/gcsp/policy/seed-v1.json`, not typed into the script. It kills Chrome and the server on exit and removes its profile.

## Results

| Run | Run ID | Result | Steps | Keyboard checks | Focus visible | Overflow (max px) | Console errors | Failed or bad requests |
|---|---|---|---|---|---|---|---|---|
| 1280 (`results-desktop.json`) | `demo-727fe469…` | passed | 39/39 | 43/43 | 10/10 | 0 | 6 x 404, 1 x 404 favicon, 0 page errors | see observation 6 |
| 375 (`results-narrow.json`) | `demo-ee81f6b1…` | passed | 39/39 | 43/43 | 10/10 | 0 | same | same |
| 1280 overdue variant (`results-overdue-desktop.json`) | `demo-93410cfc…` | passed | 32/32 | 36/36 | 8/8 | 0 | same kind | same |

Each run starts from its own scenario reset. Every action is Tab, arrows, Space, Enter or typing: the keyboard checks record each one, including typing a UTC target and pressing **Tick to target**.

**A transient result worth knowing:** two earlier 375 runs on the same code stopped at the FUCQ-109 prelude step "Presenter Next release publishes the first stock release" (240 second wait for the release to finish) while the Mac was busy; the third attempt passed. The 1280 run and the other widths never hit it. Not investigated further; it is before this story's steps.

## Steps and screenshots

Steps 1 to 19 below are this story's; the FUCQ-109 steps before them are in the results files. Screenshots are one per state, full page, PNG. Where a step also has a focus capture, the results file lists it.

| # | Step ID | What it proves | 1280 | 375 | 1280 screenshot | 375 screenshot |
|---|---|---|---|---|---|---|
| 1 | `offer-accepted` | Paula accepts with the keyboard and the outcome shows | pass | pass | `browser/1280-02-offer-accepted.png` | `browser/375-02-offer-accepted.png` |
| 2 | `order-progress` | Order progress shows the accepted car name (FUCQ-185) and the approval stages not started | pass | pass | `browser/1280-03-order-progress.png` | `browser/375-03-order-progress.png` |
| 3 | `approval-started` | One Tick starts "HR approval" | pass | pass | `browser/1280-04-approval-started.png` | `browser/375-04-approval-started.png` |
| 4 | `approval-hr-approval` | 2 Ticks approve "HR approval", "sales-manager approval" starts | pass | pass | `browser/1280-05-approval-hr-approval.png` | `browser/375-05-approval-hr-approval.png` |
| 5 | `approval-sales-manager-approval` | 2 Ticks approve "sales-manager approval", "sent to ordering" starts | pass | pass | `browser/1280-06-approval-sales-manager-approval.png` | `browser/375-06-approval-sales-manager-approval.png` |
| 6 | `approval-sent-to-ordering` | 1 Tick approve "sent to ordering" | pass | pass | `browser/1280-07-approval-sent-to-ordering.png` | `browser/375-07-approval-sent-to-ordering.png` |
| 7 | `handover-offered` | Handover section offers the policy slots | pass | pass | `browser/1280-08-handover-offered.png` | `browser/375-08-handover-offered.png` |
| 8 | `handover-requested` | Enter on the first slot requests it; the page says not booked yet | pass | pass | `browser/1280-09-handover-requested.png` | `browser/375-09-handover-requested.png` |
| 9 | `handover-confirmed` | After 1800 seconds of demo time the retailer confirms the handover | pass | pass | `browser/1280-10-handover-confirmed.png` | `browser/375-10-handover-confirmed.png` |
| 10 | `documents-open` | Documents and checks list the employee task and the other owners, not ready yet | pass | pass | `browser/1280-11-documents-open.png` | `browser/375-11-documents-open.png` |
| 11 | `documents-task-complete` | Enter on the task button completes the employee document task | pass | pass | `browser/1280-12-documents-task-complete.png` | `browser/375-12-documents-task-complete.png` |
| 12 | `documents-ready` | After the last keyed item time the page reads ready for handover | pass | pass | `browser/1280-13-documents-ready.png` | `browser/375-13-documents-ready.png` |
| 13 | `return-offered` | Return section offers both choices and says the current car stays yours | pass | pass | `browser/1280-14-return-offered.png` | `browser/375-14-return-offered.png` |
| 14 | `return-requested` | Enter on the first separate-return slot requests it; the page says not booked yet | pass | pass | `browser/1280-15-return-requested.png` | `browser/375-15-return-requested.png` |
| 15 | `return-scheduled` | After 1800 seconds of demo time the return is scheduled | pass | pass | `browser/1280-16-return-scheduled.png` | `browser/375-16-return-scheduled.png` |
| 16 | `order-progress-final` | Whole page after the plan: stages done, handover booked, documents ready, return booked | pass | pass | `browser/1280-17-order-progress-final.png` | `browser/375-17-order-progress-final.png` |
| 17 | `current-car-unchanged` | Your cars page still shows the current Fictional BMW 320i Touring as current | pass | pass | `browser/1280-18-current-car-unchanged.png` | `browser/375-18-current-car-unchanged.png` |
| 18 | `help-case` | Renewal help: Ask for help, review, confirm; the case shows its named owner and status | pass | pass | `browser/1280-19-help-case.png` | `browser/375-19-help-case.png` |
| 19 | `current-car-after-help` | Your cars page after the help request: current car still current | pass | pass | `browser/1280-20-current-car-after-help.png` | `browser/375-20-current-car-after-help.png` |

The overdue variant's screenshots are `browser/overdue-1280-*.png` (the document steps are `overdue-1280-12-documents-due-time.png` and `overdue-1280-13-documents-overdue.png`).

What each state showed (1280 run; the 375 run is identical in content):

1. Order progress names the accepted car (Synthetic 3 Series Saloon 320i, the car just accepted) instead of "Car details not supplied" (FUCQ-185). Stages: Selection received Done 5 Nov 09:31, then HR approval, Sales-manager approval and Sent to ordering Not started.
2. Approvals, one **Tick** (60 seconds) at a time, re-read after each: tick 1 HR approval Current step 09:32; ticks 2 and 3 HR Done 09:34 and Sales-manager Current; ticks 4 and 5 Sales-manager Done 09:36 and Sent to ordering Current; tick 6 Sent to ordering Done 09:37. The counts are the policy's `lifecycle.approval.ticks.v1`.
3. Handover offered: six slots (7, 8, 9 Nov at 09:00 and 13:00). Request 7 Nov 09:00: "Not booked yet", owner Retailer. **Tick to target** 5 Nov 10:06 (29 minutes later): still requested. One **Tick** to 10:07: "Booked: 7 Nov 2026, 09:00".
4. Documents: Vehicle agreement (Waiting for you, button "Acknowledge the agreement"), Driving licence check, Vehicle preparation and Delivery to the retailer in progress; "Not ready for handover". Acknowledge, then **Tick to target** 7 Nov 09:37: all Complete, "Ready for handover".
5. Return plan (FUCQ-184): the section reads normally, with no "Return plan unavailable". Separate day, 9 Nov 09:00 requested, "Not booked yet"; after 29 minutes still requested; one **Tick**: "Return booked: 9 Nov 2026, 09:00".
6. Your cars: the current-car card still reads Fictional BMW 320i Touring, Status current, contract ends 1 December 2026, before and after the help request.
7. Help (Renewal help, from the left menu): Ask for help, review, confirm gives a Renewal case Open, Owner Scheme team, Next action "Scheme team to review your renewal and contact you.", due on the keyed response time (2026-11-08 10:07:00 UTC when opened at 7 Nov 10:07).

## Not reachable from the browser

These retained cases have no browser control, so they are not in this evidence. Each is repeatable through its test in `server/test/gcsp-lifecycle-e2e.test.js`: HR approval off and a changed delay (policy edit; Greg's publish screen only edits price plans and weights), approval declined with a named renewal-risk case (seed policy value, no presenter control), the live-shaped ordering stub reporting unsupported (the launcher cannot boot a live adapter) and the manual cart order through the same services (FUCQ-73's route). The manual scenario steps are in `../../manual-acceptance-scenarios.md`, section "Lifecycle after selection · FUCQ-124". The overdue document is reachable and has its own variant run above.

## Observations

Every screenshot was viewed. Nothing found in this story's lifecycle screens needed a fix beyond FUCQ-184 and FUCQ-185 (fixed earlier in this branch). The items below are recorded, not fixed; each is below High, so each becomes a linked backlog Bug (originating Story FUCQ-124) for independent review. Suggested severity:

| # | Severity | Where | Observation |
|---|---|---|---|
| 1 | Medium | Your cars after acceptance | A "No ordering entitlement. Scheme support can check your entitlement." banner stays at the top of the page while the same page shows the accepted order and the current car. It reads as if something is wrong. `browser/1280-18-current-car-unchanged.png` |
| 2 | Medium | Your cars after acceptance | The "Your car offer: Your buddy found a car for you ... View your offer" card is still shown after the offer was accepted, and again after the help request. Same screenshot, and `1280-20-current-car-after-help.png` |
| 3 | Low | Order progress, happy path | The page has no help control unless an order is declined or a time change is proposed, so "open help from order progress" is not possible on the happy path. Help is reached from the left menu (Renewal help) instead. |
| 4 | Low | Order progress | "Handover history" and "Return history" headings are as large as the section headings above them, which flattens the hierarchy (`1280-16-return-scheduled.png`). |
| 5 | Low | Renewal help case | The case shows a long raw reference, both "Owner" and "Owner role" as "Scheme team", and a due time in ISO form (2026-11-08 10:07:00 UTC) where the rest of the portal uses "7 Nov 2026, 10:07" (`1280-19-help-case.png`). |
| 6 | Low | Console | The presenter and Your cars pages request `/api/gcsp/manual/draft` and log a 404 when no manual draft exists (6 per run). Navigation also aborts in-flight `/api/gcsp/presenter/controls` reads (net::ERR_ABORTED, benign). No page errors. |
| 7 | Low | Demo clock | After the return is scheduled the demo clock (7 Nov 10:07) is past the booked handover (7 Nov 09:00) yet the page still reads Booked. Physical completion is FUCQ-171, so this is a limitation rather than a defect. |

Known and not re-raised: "No image for this car yet" on synthetic stock.

## Limitations

- The PostgreSQL provider was not run for this story; the evidence is the memory repository. This is recorded as unrun, not passed.
- Headless Chrome only (one version), one fixture and the default generated stock; no hand trial by Russell or a BMW representative is claimed.
- Physical completion, no-show, a missed return and Greg's remedy for Paula are FUCQ-171 and not covered here; see `fucq171/README.md`.
- The run's page reads are reloads: the order progress page does not refresh itself after a Tick (the walkthrough reopens it, and the manual steps say so).
