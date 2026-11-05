# FUCQ-122 browser and integration plan

Prepared 5 November 2026. This is a plan, not executed browser evidence. The employee source checkpoint is `49a6fbc`, and actual authenticated loopback HTTP/renderer proof is `104ed9c`. Freeze the queue checkpoint before browser allocation. The dispatcher currently grants the browser lane to FUCQ-126; this story has no browser or full-suite grant yet.

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

The published Greg harness attaches `gcsp-case-queue` into the reserved region, but this base's `gcsp-greg.html` does not load `blocks/gcsp/cases/register.js` or `gcsp-cases.css`. FUCQ-103 owns the released Greg composition lane; coordinate those two additive host references without editing its in-flight source.

This base's `createGcspRuntime` does not compose RenewalCaseService or expose `gcspCases` in dependencies. Its existing `buildServer` routes/startup already support that port. FUCQ-103 owns `server/gcsp/runtime.js`; integrate the case service using the same repository/policy/clock/identity, then verify the delivered runtime through actual HTTP. `scripts/gcsp-demo.mjs` currently allowlists brief/activity pages only. Leave the external activity/order-progress host and lifecycle producer ownership intact; their authored placement/integration evidence remains incomplete until exercised.

After scoped/browser/current-base readiness, request the dispatcher's sole full-suite lane for authored exact `npm test`, same-source strict test stamp and final resource audit. A green scoped run or visual preview does not complete these gates.
