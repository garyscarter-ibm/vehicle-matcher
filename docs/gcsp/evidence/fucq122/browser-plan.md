# FUCQ-122 browser and integration plan

Prepared 5 November 2026. The browser matrix is incomplete; the first granted execution outcomes are recorded below. Source guard baseline is `d4b501f110d33b4a10288c358c0e76a61aee2505`, including shared tooling/map checkpoint `b11a7e6` and this story's durable slice facts. Product code remains the tested `0a3a3a1` case implementation (employee `49a6fbc`, queue `41bc7d5`, actual authenticated Greg/Paula renderer journey). The dispatcher granted exact execution HEAD `95b7313`. A native-keyboard harness correction now requires reviewed pushed source and a renewed grant before further browser allocation.

Use the supplied shell screenshots `docs/gcsp/screens/00-employee-account.webp` and `01-replace-vehicle.webp`, body reference `docs/gcsp/evidence/fucq-6/README.md` at a7fc178, current Density tokens and Greg's denser operational treatment. Inspect each capture personally. No human layout-review pause applies.

## Bounded source and resources

The runner will serve repository assets and the actual `buildServer` API on one loopback origin. Compose the real memory repository, canonical PolicyService, trusted identity, DemoClock, ManualContextService/account, BriefService, RenewalCaseService and Greg service. Use actual trusted session issuance for Paula/Greg. A localhost-only test policy may select `identity.session.sameSite=Lax` with `secureCookies:false`; record this override. Never log raw cookies, credentials or access keys. Block all external browser requests. No native database, live BMW, real mail or deployment is needed.

Run one smoke chunk, then separate desktop1280x900 and narrow375x812 chunks. Each has a fresh shared HostBudget reservation, at most120 seconds,2560MiB recursive owned RSS (minimum2048MiB),128MiB scratch and2MiB logs. Record an external ownership manifest before allocation under shared `.claude/test-runs/fucq122-options/browser/`; use run-owned `/tmp/fucq122-browser-<id>` for profile/cache/IPC. Persist source hashes, output path, ports, PID/start identities and detached Chrome descendants. Finalizers terminate/kill/join owned children, release reservations and verify process groups, profile paths, open files, ports and scratch are absent. Retain compact screenshots and JSON summaries under this evidence directory, below128MiB per chunk. Adopt dependencies read-only; no install or new environment.

## Required matrix

At both widths, retain a screenshot path, current source identity, observed state, overflow check, visible focus, keyboard trace and console/page/network findings for each row. Exercise native controls with Tab, Shift+Tab, Enter and Space; record the focused element before and after asynchronous saves/errors.

| Surface/state | Reproduction and expected result | Evidence boundary |
|---|---|---|
| Paula no case/help available | Actual account/session, no cases. Open help disclosure, enter reason, review and cancel. Repository and route audit remain read-only. | Actual API and renderer |
| Confirm help request | Review effect; submit only explicit confirmation. One case exists, named scheme-team owner, date/history, due time and request reason match actual readback. | Actual API and renderer |
| Greg queue and open | Actual list/options routes; employee, deadline, trigger/request, reason, status, owner and due displayed. Toggle deadline/status sorting; select/open using keyboard. | Actual API and renderer |
| Update and manual remedy | Select only server nextStatuses, record update then manual-decision remedy. Reload Paula and verify actual history, actor and next action. Stale expected version conflicts without success. | Actual API and renderer |
| Single preference change | Seed an explicitly synthetic recorded decline, confirm actual brief; Greg chooses one projected preference/value. Paula reviews old/new values and explicitly confirms through BriefService. Reload preserves every other preference/weight/essential and case status. | Actual API; prior decline is test setup, not offer producer proof |
| Deadline trigger | Set the supplied current contract date in test setup, invoke actual authenticated DemoClock tick and show the case from registered renewal-risk handler. Replay duplicates nothing. | Actual deadline producer; no fabricated lifecycle exception receipt |
| In progress, waiting, resolved, closed | Use actual permitted updates where possible; each current readback has matching status/history/remedy. Isolated read-only previews may supplement visual coverage and are labelled. | Actual API or explicit preview per capture |
| Feasible options | Show exact evaluated car/one preference, known reviewed release date, manual choice and policy-gated extension. Unavailable source/date/brief is explained. Canonical policy decides permissions. | Actual server projection; any synthetic stock/date is labelled setup |
| Empty queue/loading | Empty actual run. Delay a real response to inspect busy status and disabled controls. | Actual route with controlled transport delay |
| Source/access/stale failure | Abort actual transport or use refused session/run. No false empty/success message. Restore and refresh current state. | Actual outage/access or explicitly labelled isolated failure |
| Uncertain retry | Drop one committed command reply, retry byte-identical ID/payload and verify one mutation. | Actual command plus controlled transport loss |
| Teardown | Navigate/unmount while read/save is delayed; later reply does not alter detached surface. | Actual route with controlled delay |
| Every preview state | Help and queue read-only fixture entries cover all authored request/trigger/status/failure snapshots. No preview command succeeds. | Explicit visual preview only |

## Integration work still required

The published Greg harness attaches `gcsp-case-queue` into the reserved region, but this base's `gcsp-greg.html` does not load `blocks/gcsp/cases/register.js` or `gcsp-case-queue.css` (which imports the shared case styles). FUCQ-103 owns the released Greg composition lane; coordinate those two additive host references without editing its in-flight source.

This base's `createGcspRuntime` does not compose RenewalCaseService or expose `gcspCases` in dependencies. Its existing `buildServer` routes/startup already support that port. FUCQ-103 owns `server/gcsp/runtime.js`; integrate the case service using the same repository/policy/clock/identity, then verify the delivered runtime through actual HTTP. `scripts/gcsp-demo.mjs` currently allowlists brief/activity pages only. Leave the external activity/order-progress host and lifecycle producer ownership intact; their authored placement/integration evidence remains incomplete until exercised.

After scoped/browser/current-base readiness, request the dispatcher's sole full-suite lane for authored exact `npm test`, same-source strict test stamp and final resource audit. A green scoped run or visual preview does not complete these gates.

## Prepared executable chunks

The runner and supervisor are `browser-runner.mjs` and `browser-supervisor.py` in this directory. Preparation was syntax checked only; actual initial execution outcomes are recorded below. No browser, API listener, static server, Chrome profile or browser reservation was created during preparation. After the dispatcher explicitly grants the lane on the pushed source, invoke one chunk at a time from this worktree:

```sh
python3 -B docs/gcsp/evidence/fucq122/browser-supervisor.py smoke-desktop
```

Inspect the smoke screenshots and receipt before continuing. Then run separate `journey-desktop`, `journey-narrow`, `options-deadline-desktop`, `options-deadline-narrow`, `resilience-desktop`, `resilience-narrow`, `previews-desktop` and `previews-narrow` chunks through the same supervisor. Do not parallelize them. Every invocation gets a unique `<chunk>-<id>`; reruns retain earlier failures. Each creates external receipts under `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq122-options/browser/<chunk>-<id>/` and compact screenshots/results under `docs/gcsp/evidence/fucq122/browser/<chunk>-<id>/`.

| Chunk | Concrete coverage |
|---|---|
| smoke | Actual Paula account/help and Greg empty queue; read-only state digest, keyboard disclosure, Tab and visible focus, assets/errors/overflow. |
| journey, each width | Actual request review/cancel/confirm; Greg sort/open, in-progress, manual remedy, single-preference proposal; Paula review/confirm/reload with unchanged essentials/weights/other preferences; actual resolved/closed state and dated history. |
| options-deadline, each width | Actual registered deadline clock handler and replay; synthetic contract date/decline/stock/facts supplied explicitly; exact evaluated car, single preference, persisted reviewed release source/date, manual option and alternate canonical extension policy. Missing brief/stock/release is captured before setup. |
| resilience, each width | Actual empty queue and held real list response; held committed help reply/busy control; committed reply loss plus byte-identical retry/one mutation; actual stale-version and employee-to-Greg forbidden response; real read transport abort/recovery; delayed actual read/save unmount without hidden reload. |
| previews, each width | Every authored employee/queue fixture state, including isolated stale-run; clearly labelled synthetic evidence, expected state copy, preview writes refused and repository unchanged. |

`results.json` records each screenshot's source, observed text/status, document overflow, focus outline/position, keyboard trace checkpoint and actual-versus-preview boundary. Native actions use Tab/Shift+Tab/Enter/Space. Select values open the native popup with Space, use Home/ArrowDown against enabled option indices, explicitly commit with Enter, re-resolve the control after redraw, assert its observed value, then Tab. The trace retains the previous selection and actual committed index/value even on an assertion failure. Text/date entry uses the native fill API after keyboard focus and is explicitly recorded as automated entry, not keyboard-only proof. Network evidence retains only safe method/path/status and command/case/brief/option projections, never headers or cookies. External requests are blocked. Console/page/static-asset/unexpected transport failures prevent a pass; deliberately controlled failures are recorded separately.

The supervisor refuses changes outside this evidence directory against `d4b501f110d33b4a10288c358c0e76a61aee2505`, apart from the exact pre-existing `server/node_modules` symlink (target and inode). It hashes the product paths, runner, supervisor and plan before/after, and records exact execution HEAD. Later source/tooling/map changes require reviewed refreezing before browser execution. The supervisor reserves 2560 MiB with a 2048 MiB minimum, measures recursive owned RSS, and applies a conservative 128 MiB combined scratch/retained-evidence ceiling in addition to the individual limits. Ownership includes PID/start identities, PGIDs, ports and output directory identity. Cleanup checks detached processes, open files, ports, monitor join, scratch and reservation absence; uncertain scratch remains named and preserved. The runner also rejects response-observer or teardown errors that arrive after the journey assertions.

Unchecked runtime assumptions remain: installed Chrome/CDP and Playwright behavior, browser cookie acceptance with the explicit localhost override, platform `ps`/`lsof` identity sampling, keyboard/native-select behavior, available host budget and elapsed time per chunk. Syntax checks do not verify selectors or service execution. An actual run may expose a harness or product defect; retain that failed receipt, diagnose it, and re-review source identity before a fresh chunk. The isolated service composition is executable against current interfaces; delivered runtime composition, released Greg host wiring, activity/order-progress placement and lifecycle/offer producers remain outside its evidence boundary.

## First granted execution checkpoint

At exact HEAD `95b731353b422a34b45fda02d837a45818dc70d5`, `smoke-desktop-69d40af0c52b` passed actual authenticated Paula account/help and Greg queue reads. The lead personally inspected both original captures: shared type/spacing, visible focused help button, readable empty queue and no horizontal overflow. Parent checks independently verified identities/groups/profile/open files/ports/scratch/reservation absent, adopted dependency identities unchanged and source unchanged. The larger of the two RSS samplers reported 2,196,275,200 bytes; combined scratch/evidence peaked at 1,381,911 bytes. Receipt and parent review are in the shared browser run directory.

The next `journey-desktop-53d494d74c50` stopped at `select('Case to work', caseId)` after the actual confirmed help request persisted. The previous helper repeatedly read the unchanged DOM selection after Home/ArrowDown, without committing a native popup with Enter. This is a harness keyboard-sequence diagnosis; no product failure has been established. Three Paula captures were personally inspected and are retained, but this run is incomplete and proves no Greg journey. Source remained unchanged. Peak RSS was 2,198,437,888 bytes, combined allocation 2,977,689 bytes; cleanup was independently verified, including both closed ports and absent profile/open files.

Further browser allocations are stopped. The evidence-only correction opens and explicitly commits the native popup and records the committed value. Syntax/source-guard checks can validate preparation, but actual keyboard behavior must pass under a renewed dispatcher grant on the corrected pushed HEAD. Preserve the original failed receipt. The earlier smoke remains evidence only for its recorded source and captures.
