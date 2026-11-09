# FUCQ-171 browser evidence: terminal handover, return and advanced renewal help

9 November 2026. Browser evidence for the later routes that FUCQ-124 did not cover, at 1280x900 and 375x812, as Paula (`/gcsp-account.html`, `/gcsp-help.html`) and Greg (`/gcsp-case-queue.html`). Keyboard-driven wherever a control exists. The routes themselves are proven by `server/test/gcsp-lifecycle-e2e.test.js` (the five `FUCQ-171 ...` tests); this folder shows them on screen. The repeatable scenario steps are in `../../../manual-acceptance-scenarios.md`, section "Terminal lifecycle and advanced help".

- **Run against code commit:** `1a9bea41` (branch `dev/DEV-2026-11-07-005`). No application code changed in this story; the runner was committed after the runs.
- **Host:** in-process, not the spawned `node index.js` entry. Each scenario builds its own runtime with `createGcspRuntime` (memory repository, `mode: 'memory'`), serves the real API with `buildServer` and serves the same HTML, CSS and blocks from a plain loopback file server on `127.0.0.1` ports 9160 to 9164. Nothing is stubbed; no live external calls; no PostgreSQL.
- **Stock:** manual-order scenarios (T1 to T5) use the composition test stock (`createCompositionTestProfile`, one synthetic order, as FUCQ-169). The advanced help scenario (T6) uses the demo stock (`createDemoStockProvider`) with the offer journey adopted, as the e2e tests do.
- **Browser:** headless Google Chrome (`--headless=new`, own profile under the owned scratch directory) through the same playwright-core import as FUCQ-109, 124 and 169. The session cookie is injected per principal because the runtime's `Secure; SameSite=None` cookie is refused on plain `http://127.0.0.1` (recorded per principal in the results `cookieMode`; the fallback is a Lax cookie).
- **Principals:** Paula is the manual runtime's local session, or the `demo-paula` switch session in T6. Greg is the `demo-greg` session from `POST /api/gcsp/session/switch` called with a presenter session. The presenter session calls the completion and no-show routes.

## How to run

From the repository root, one viewport per run, run sequentially (about 75 seconds each on an idle Mac):

```sh
export TMPDIR=<owned scratch dir>
FUCQ171_SCRATCH=$TMPDIR FUCQ171_CHUNK=desktop perl -e 'alarm shift; exec @ARGV' 1500 node docs/gcsp/evidence/fucq-110/fucq171/browser-capture.mjs
FUCQ171_SCRATCH=$TMPDIR FUCQ171_CHUNK=narrow  perl -e 'alarm shift; exec @ARGV' 1500 node docs/gcsp/evidence/fucq-110/fucq171/browser-capture.mjs
```

`FUCQ171_OUTPUT` (default: this folder) and `FUCQ171_ONLY=handover,noshow,returned,missed,help` are optional. Ports 9160 to 9169 only. The runner kills Chrome by process group on exit and writes `results-<width>.json`. Every expected state, owner, next step and delay is read through `PolicyService` (keys listed in the scenarios doc), not typed into the script.

## Results

| Run | Result | Checks | Keyboard (Tab reaches control / focus ring visible) | Overflow (max px) | Console errors | Failed requests | PNGs |
|---|---|---|---|---|---|---|---|
| 1280 (`results-1280.json`) | passed | 199/199 | 33/33 and 33/33 | 0 | 0 (see observation 6) | 0 | 11 |
| 375 (`results-375.json`) | passed | 199/199 | 33/33 and 33/33 | 0 | 0 (see observation 6) | 0 | 11 |

At 375 px the Renewal-risk cases table on Greg's queue is 1,050 px wide and scrolls inside its own box (recorded as `scrollContained`, not page overflow; see observation 7). Every capture was also checked for em dashes in body text, CSP violations and external requests: none.

## Steps and screenshots

"Browser" means the step is done in the page with the keyboard; "API" means no browser control exists for it. Screenshots are one per state, full page, PNG, named `browser/<width>-<number>-<name>.png`.

| # | Scenario | Principal | What it proves | Via | Screenshot (1280 and 375) |
|---|---|---|---|---|---|
| 01 | T1 | Paula | Completion refused with 409 `handover-not-ready` (API, keyed owner and next step); page shows Booked and "Not ready for handover. Still to do: ..." | API refusal, browser read | `01-handover-blocked` |
| 02 | T2 | Paula | Acknowledge with Tab and Enter, ready, presenter completes; "Handover complete", return plan names the new order as current car | browser (task), API (tick, completion) | `02-handover-completed` |
| 03 | T3 | Paula | No-show: "Handover missed", fresh slots, first button focused with a visible ring | API (no-show), browser | `03-no-show-rebook-focus` |
| 04 | T3 | Paula | Enter rebooks: "Handover time requested.", "Requested ... Not booked yet.", "Earlier handover missed" | browser | `04-rebooked` |
| 05 | T4 | Paula | Confirmed return: "Returned", `SYN-RET-` reference, current car (new) and returned car (old) in a separate section | API (policy-keyed outcome), browser read | `05-returned` |
| 06 | T5 | Greg | Missed return: one open case for Paula in the queue, opened with Tab and Enter | API (outcome, tick), browser | `06-missed-case-greg-queue` |
| 07 | T6 | Paula | Help request (Tab, Enter): "Your help request was recorded.", one case, owner Scheme team, her words as the latest update | browser | `07-paula-help-requested` |
| 08 | T6 | Greg | Case moved to In progress, then Remedy proposed with one body-style change; the queue shows the proposal and the confirmation-required note | browser | `08-greg-remedy-proposed` |
| 09 | T6 | Paula | Review and confirm the single change: "Your preference change was confirmed ..."; brief version 2, case still Remedy proposed | browser | `09-paula-confirmed-change` |
| 10 | T6 | Greg | Resolve keeping the confirmed remedy; Paula's row reads Resolved | browser | `10-greg-resolved` |
| 11 | T6 | Paula | Reload: Resolved, "Recorded remedy", "You confirmed this preference change" | browser | `11-paula-resolved` |

Checked in the runner without a PNG: Paula's missed-return view (T5, "Return missed", owner Scheme team, "stays yours until it is returned"), attempt 2 completed after the rebooking (T3, `attempt` 2, new order current), the review screen before Greg's remedy (T6, "One preference change", "Required through the employee brief"), and the allocation inputs (T6: only Paula's brief row moved across the whole case).

## What each state showed

1. **Blocked (01):** the Handover section reads "Booked: 7 Nov 2026, 09:00" (owner Retailer); Documents reads "Not ready for handover" and lists the four keyed items, with the vehicle agreement waiting for Paula and the other three in progress. The Returning section already offers both return choices because the handover is scheduled.
2. **Completed (02):** "Handover complete: 7 Nov 2026, 12:30", "Your handover is complete.", history Requested, Booked, Handover complete, no buttons. Returning your current car lists the new order as Current car and the old contract as "Car to return"; the separate-day choices are offered because the handover is completed.
3. **No-show and rebooked (03, 04):** "Handover missed" with six slot buttons; after Enter "Requested 9 Nov 2026, 09:00. Not booked yet.", owner Retailer, "Earlier handover missed", history Requested, Booked, Handover missed, Requested.
4. **Returned (05):** "Returned: 9 Nov 2026, 14:30", owner Retailer, "Your current car has been returned. Nothing more is needed from you.", `SYN-RET-...`, Current car (new) and Returned car (old), with the return and handover histories separate.
5. **Missed return, Greg (06):** the queue shows one row for Paula, status Open, owner Scheme team, trigger `lifecycle-exception`; the opened case shows the reason, next action and the record form. The remedy options listed under the form are unavailable in this manual-order run (no confirmed brief, no recorded decline).
6. **Help (07 to 11):** Paula's request lands on the case the deadline rule had already opened (one case, owner Scheme team). Greg moves it through In progress to Remedy proposed (body style, one preference). Until Paula confirms, her brief is version 1 and the case cannot be resolved; after her confirmation the brief is version 2 and Greg's resolve is accepted. Paula's reload shows the persisted Resolved case and the Recorded remedy.

## Not reachable from the browser

Each is repeatable only through the runner or the named e2e step (`server/test/gcsp-lifecycle-e2e.test.js`):

- **Handover completion and no-show:** presenter routes with no page control (the presenter strip has Tick controls only). Manual handoff lifecycle step 3 and 4, no-show then rebooking steps 2 and 6.
- **Return outcome (returned or missed):** a policy key (`lifecycle.return.outcome.v1`, `enabled` and `outcome`) that must be set before boot; Greg's publish screen does not edit it. Buddy lifecycle steps 4 and 5, missed return steps 2 to 4.
- **Case opened by a lifecycle exception:** a keyed rule on the next presenter tick; the runner ticks the clock by service, the presenter strip's Tick does the same.
- **Advanced help setup:** the first offer, its decline and the clock move to the deadline window are done over the routes before the browser steps (as the e2e setup step); the browser steps are 07 to 11.
- **Greg resolving without Paula's confirmation:** refused by the server; shown only in e2e step 6, not in the browser.
- **Manual handoff versus buddy lifecycle:** the browser evidence uses the manual order for T1 to T5 (FUCQ-72's route, through the same services); the buddy variant (T4's first handover) is the e2e buddy lifecycle test.

## Observations

Every screenshot was viewed. Each is below High, so each becomes a linked backlog Bug (originating Story FUCQ-171), recorded here and not fixed. Suggested severity:

| # | Severity | Where | Observation |
|---|---|---|---|
| 1 | Medium | Your cars after completion (02) and after a confirmed return (05) | The current-car card still shows "Fictional BMW 320i Touring" as current. After the handover completes the return plan already names the new order as current; after the return the old car is returned but the card does not change. Known as FUCQ-252 for the return; the same card is stale after completion too. |
| 2 | Medium | Greg's queue and Paula's help, missed return (06) | The case opened by a missed return reads "Opened from Missed handover appointment", and the queue trigger shows the raw `lifecycle-exception` with the generic reason "A configured lifecycle exception needs scheme-team review." `lifecycle.return.outcome.v1` reuses the exception type `appointment-no-show`, and the label is keyed on that type alone. |
| 3 | Medium (slice A) | `RenewalCaseService.readOptions` (`server/gcsp/cases/index.js`, about line 285) | The whole options read answers unavailable when any candidate car yields unknowns, for example a brief without a confirmed charging essential. T6 sets Paula's brief with charging confirmed to avoid it (as the e2e test does); a hand trial on a brief with charging not ready will hit it. |
| 4 | Low | Order progress (02, 05) | The stage tracker stays at "Sent to ordering" after completion and return (FUCQ-253, known). The completed handover shows Owner "You". |
| 5 | Low | Presenter routes | The presenter can record a no-show or a completion before the booked slot time, and the missed slot is offered again among the fresh slots (03 offers 9 Nov 09:00 after missing 9 Nov 09:00). It is a synthetic presenter control, so noted as a limitation. |
| 6 | Low | Console | Paula's help page requests `/api/gcsp/presenter/controls` as an employee-only session and logs three 403s per run (one per page load). Nothing shows on screen. The runner records them as this observation, not as failures. |
| 7 | Low | Greg's queue at 375 px (06, 08, 10) | The cases table scrolls sideways inside its box, so the Status and Owner columns are off screen without scrolling, and the Case to work option truncates ("Paula (fictional) · Remedy proposed · 2..."). No page overflow. |
| 8 | Low | Paula's help after resolution (11) | A resolved case still reads "You confirmed this preference change. The scheme team will review the case." |
| 9 | Low | Rebook focus (FUCQ-254, known) | In these runs focus was not lost to the page body after Enter on a rebook button at either width (the focus check passed), so this capture neither reproduces nor closes FUCQ-254. |

## Failed, skipped and unrun

- **Failed:** none in the final runs. Earlier development runs failed on the runner itself (the help page's details element is closed until opened; the queue lists Alex's case first; a typo in a string); they are not evidence.
- **Keyboard fallbacks:** type-ahead worked for every native select except the proposed-value select in step 08, where ArrowDown did not change the value and the runner used `selectOption` (recorded in `notes`). Text entry, buttons and the summary toggle were keyboard only.
- **Unrun:** PostgreSQL (native) is not installed here; evidence is the memory repository only. The spawned hosted entry (`node index.js`) and the generated run stock were not used. No hand trial by Russell or a BMW representative is claimed. The buddy-route lifecycle is covered by the e2e test, not the browser.
- **Not photographed:** the Paula missed-return page, attempt 2 completed, and the Greg review screen (text checks only; see above). 22 PNGs in total, two over a round 20.
