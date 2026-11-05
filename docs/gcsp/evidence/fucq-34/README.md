# FUCQ-34 browser evidence

Browser work froze on 5 November 2026 at product source `312eaa005bc2390b8c449b6c4deaf7b511e7e22a`. The records preserve each run’s original source and harness SHA; earlier evidence is not relabelled as testing this final source. Automated checks and the final story decision are recorded separately in `automated-validation.json` and the story Result.

## Results and provenance

| Record | Source | Result |
| --- | --- | --- |
| `navigation-smoke.json` | `4e792374659d2080b85d67aacc1f4e905c01373d` | BMW mount and captures passed; historical teardown stopped with rc -15. |
| `navigation-matrix.json` | `c49d8424729ca8ef5c9d22a8f65985c908888667` | 30/30 mounts: six brands × five modes at 320×740. Added header labels, destinations, consumed-key absence, viewport rectangles and no overlap passed. This is not a claim that every mode’s body fits. |
| `navigation-flows.json`, exact archive `navigation-flows-history-first.json` | `c49d8424729ca8ef5c9d22a8f65985c908888667` | Seven passing assertions: five functional flows and two Ferrari attribution diagnostics, then a retained BFCache wait failure. Both Ferrari body-fit cases remain false. |
| `navigation-flows-continuation.json` | `312eaa005bc2390b8c449b6c4deaf7b511e7e22a` | 15/15 new assertions passed after the picker token fix. Prerequisites reconstructed by this run do not duplicate the historical assertions. |
| `navigation-keyboard.json` | `312eaa005bc2390b8c449b6c4deaf7b511e7e22a` | 5/6 assertions passed; native select ArrowDown/Enter remained unchanged. |
| `navigation-keyboard-question-settled.json` | `312eaa005bc2390b8c449b6c4deaf7b511e7e22a` | One targeted repeat of the existing questionnaire radio assertion, plus a settled replacement capture. It adds no new capability count. |

Across the two flow records there are 20 passing functional assertions and two passing Ferrari attribution diagnostics. The first run reached the correct launcher URL on Back but Playwright’s `goBack(waitUntil: 'domcontentloaded')` timed out on BFCache. The continuation uses native history Back/Forward with observable state waits and passes. The original timeout remains in both historical files.

The continuation covers actual picker Tab/focus/Enter and button geometry at 1280/320, national BMW answer-hash/context continuity through Back/Forward, desktop and narrow launcher/retail repeats, BMW→MINI→Ford fresh starts, mode/scope/API preservation with dealer/hash resets, MINI label recomputation, employee-boundary sanitisation and return to separately retained retail context, direct Ford `block.html`, local API override, consumed synthetic key, real frontend session gate, deployed-default API interception and refresh continuity. Its browser error arrays are empty.

## Visual findings and limits

The picker’s return link originally lacked shared button geometry outside `.vm`. `brand-picker-before-token-fix.png` preserves the defect. The parent’s picker-only token correction is in `312eaa0`; the continuation measures at least 44px height, nonzero padding, viewport fit and visible focus. `brand-picker-fresh-start.png` and `brand-picker-narrow-focus.png` show the correction.

Ferrari swipe and head-to-head retain 36px body overflow at 320px. Removing only the two added FUCQ-34 header links leaves the same overflow. The offending right-column `button.vm-mingle-tile.vm-mingle-tile-use` reaches about x=356.17px; the headers fit. The four `ferrari-*-narrow-before.png` / `ferrari-*-narrow-without-added-links.png` captures and raw case metrics preserve this limitation. Passing attribution diagnostics do not turn the body-fit failures green. `ferrari-source-comparison.json`, authored by the parent, separately records five relevant layout/copy/CSS/token files unchanged from claim baseline `dfb2c06`.

The native brand control was reached by actual Tab before exactly one ArrowDown/Enter attempt. The precondition record is `focused: true`, `focusVisible: true`, semantic tag `SELECT`, associated label `Choose a brand`, outline `rgb(11, 108, 126) solid 2px`, initial value `bmw`. The bounded option attempt left both before and after at `bmw`; it is a retained automation limitation, not a passing brand-selection check or proof that human native keyboard selection fails. `keyboard-native-select-focus.png` shows its visible focus. Brand routing is independently exercised by selectOption in the flow records. A collaborator manual native-popup trial remains required; no result is claimed here.

Actual header Tab/focus and Enter, Used cars Enter, and questionnaire radio ArrowDown/selection/advance pass. The radio test goes from “Could you charge a car at home or work?” to “What will this car mostly do?” through the real onPick callback. The initial `keyboard-question-option-unsettled.png` was captured during a transition and is retained as an unsuitable visual capture. Its replacement `keyboard-question-option.png` was personally inspected by the browser implementer after opacity reached 1 and running animations reached 0; the replacement is legible. The story lead personally inspected this replacement and the selected final captures. Other selected captures are `bmw-desktop-header.png`, `bmw-narrow-header.png`, `mini-narrow-header.png`, `launcher-selected-bmw.png`, `launcher-narrow-selected-bmw.png`, `ford-retail-theme.png` and `keyboard-header-focus.png`.

## Fixture and resource scope

`capture-navigation.mjs` serves the actual frontend and real `buildServer` with six injected synthetic vehicle pools, `photo: null`, and inert nearby/location/enrichment providers. Browser egress is blocked. Requests to the deployed default API origin and explicit local API URLs are fulfilled through the local fixture interception seam. This proves browser integration with synthetic data, not live stock or an employee integration. The employee entry remains an unavailable FUCQ-35 boundary.

The completed matrix and later runs used the external browser supervisor, a fresh shared HostBudget, 2560 MiB recursive RSS ceiling, minimum 2048 MiB grant, 128 MiB scratch, 120 seconds and 2 MiB logs. `browser-resource-summary.json` retains exact receipt and independent-cleanup contents plus hashes from the external records directory `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq34/`.

| Run | Process rc | Peak RSS bytes | Scratch bytes | Seconds |
| --- | --- | --- | --- | --- |
| Matrix | 0 | 1,736,474,624 | 13,525,080 | 27.10 |
| First flows | 1 (retained BFCache wait failure) | 1,726,087,168 | 11,561,816 | 23.37 |
| Continuation | 0 | 1,708,277,760 | 12,274,872 | 22.72 |
| Keyboard | 0 (assertions still 5/6) | 1,711,587,328 | 10,561,049 | 7.68 |
| Settled question only | 0 | 1,706,999,808 | 10,467,001 | 7.99 |

Three earlier attempts stopped before mounting at their cap: 801,882,112 B RSS, a reduced-process diagnostic at 852,410,368 B, and ordinary Chrome at 1,664,008,192 B. Reduced-process flags were removed. These are resource failures, not passing checks. The successful smoke mounted but its Node process was stopped with rc -15 because teardown waited twice for a SIGTERM-exited child. The harness now checks `signalCode` and bounds browser.close(). Historical startup/smoke disposition and independent cleanup remain in the external smoke receipts.

The historical matrix audit recorded supervisor-group PIDs and the unique profile, but did not retain full descendant/profile/crashpad ownership or exact dynamic API/CDP ports. Recorded PIDs/profile were independently absent afterwards; retrospective full ownership or dynamic-port proof is not claimed. Later runs audit descendants, unique profile matches and crashpad references across process groups, reject escapes, retain exact static/API/CDP ports, and independently verify cleanup. Every later recorded Chrome PID, exact group, profile, scratch directory and reservation token is absent, with all three exact ports closed. No unrelated process was broadly killed. The final question-only run observed 12 owned Chrome PIDs, no escapes, and closed ports 31461/55328/55333.

## Repeat and manual trial

From the worktree, run a separately granted supervised chunk using the adapter-verified product commit:

```sh
/usr/bin/python3 -B /Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq34/browser-supervisor.py command --owner lead --name browser-CHUNK --command 'SOURCE_COMMIT=<verified-40-character-commit> /opt/homebrew/bin/node docs/gcsp/evidence/fucq-34/capture-navigation.mjs CHUNK'
```

Chunks are `smoke`, `matrix`, `flows`, and `keyboard`; `flows --continue` records only the continuation, and `keyboard --question-only` captures just the actual questionnaire radio action after settling. The harness needs the configured Chrome and playwright-core paths, the repo’s existing dependencies, and the supervisor-supplied TMPDIR. A new source/harness identity creates fresh checkpoint records; preserve historical records before rerunning. Check HostBudget/other lane reservations first and independently verify exact ownership and ports after completion. Browser chunks are frozen for the current handoff; do not rerun while the parent owns the full-test lane.

For a human trial using the same synthetic pools, start these two foreground commands from the repository in separate terminals. The fixture helper imports `buildServer` without the live-stock startup warmers and injects the same inert providers as the browser harness:

```sh
node docs/gcsp/evidence/fucq-34/serve-fixture.mjs
```

```sh
npm run serve
```

Open `http://localhost:3000/index.html?experience=launcher&api=http%3A%2F%2F127.0.0.1%3A8787` in a fresh private window. This is the known starting state: All brands, no saved retail return or answers, a local synthetic API and no employee integration. Stop both foreground commands with Ctrl+C after the trial. Reset by closing that private window and opening the same URL in a new private window.

1. Tab to “Choose a brand”, use the OS-native keyboard interaction to select MINI, confirm the Used cars label and destination change, then use Enter to open retail. Return through “All car experiences” and verify MINI remains selected.
2. Open `http://localhost:3000/index.html?brand=bmw&mode=questionnaire&scope=national&api=http%3A%2F%2F127.0.0.1%3A8787`, complete the questionnaire and note its `#m=` answer hash. Use “All car experiences” then Used cars; refresh and traverse Back/Forward. Expect BMW, questionnaire lock, national scope, API and answers to remain. “Copy share link” must carry that public context without a consumed access key.
3. Use “Change brand”, read the reset explanation and choose MINI, then Ford. Expect a fresh answer state, retained valid mode/scope/API and each programme's own label. Open `/block.html?brand=ford&mode=questionnaire&api=http%3A%2F%2F127.0.0.1%3A8787` directly and expect the Ford block without a compulsory launcher step.
4. Inspect at 320px and desktop, including visible keyboard focus. Employee cars remains unavailable. Ferrari swipe/head-to-head retain the documented 36px body overflow; the new header links fit.

Record the browser/OS, build, chosen inputs and outcome, including any refusal or mismatch. Automated observations are retained above; no human native-popup pass or live-stock result is claimed. No new policy/allowance assumptions are introduced by these navigation checks.

Agents: browser evidence implementer requested, selected and effective `gpt-6.1-sol / medium`, independently verified by the parent, no fallback. No product changes, full tests, subagents, commits or pushes were performed by this role.

## Lead review and final integration

The story lead inspected the final captures named above, including the visible native SELECT focus, the settled radio result and both widths of the corrected picker. The new navigation controls are legible, fit their viewports and have visible focus. The Ferrari body limitation is retained and attributable to unchanged mode layout. No confirmed new product defect remains.

Final integrated source `91a473b3995d2d3573a80bfb0d1e3ec71f087c3a` includes shared base `f635ea2467bbd8b27dd23ec1302e6cb43ece8efd`. Its incoming deployment filters and blueprint test do not change these browser assets. Current exact full:1125 total,1123 passed,2 optional PostgreSQL skips,0 failed; strict matching key `a59e5317e6932c5b4fcde7ea5ffb6eb5524a9675712128532559b3a7f5e0bb8c`. See `automated-validation.json` and `resource-validation.json` for complete current identities and the 38-manifest final cleanup inventory.
