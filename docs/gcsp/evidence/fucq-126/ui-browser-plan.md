# FUCQ-126 UI browser runner handoff

Authored 5 November 2026. This is a reproduction plan, not executed browser evidence.
Use shell references `screens/00-employee-account.webp`, `screens/01-replace-vehicle.webp`,
body reference `evidence/fucq-6/README.md` at a7fc178, current shared Density tokens,
and Greg's denser operations treatment. No human layout pause is required.

Run each visual state at 1280x900 and 375x812. Record screenshot paths, overflow,
console/page/network failures, actual request/response identity, tab order and visible focus.
The parent allocates the separate browser runner under fresh HostBudget/Scratch limits;
this implementation launched no browser or API/static server.

## Actual service composition

Use existing `createMemoryRepository`, canonical `PolicyService`, `createDemoRuntime`,
`createScenarioService`, `createPresenterControlsService`, real ManualContextService/Greg service
where available and `buildServer`, matching `server/test/gcsp-presenter-controls.test.js`.
Initial `createPresenterSession` is trusted server bootstrap, never a public browser selector.
Retain only safe context/receipt projections; never log raw cookies or service credentials.
Serve static files and API on the same origin (or proxy API), configure that exact allowed Origin.
For HTTP localhost, explicitly select a test-only Lax/Strict identity policy and secureCookies false;
the canonical Secure/None cookies require HTTPS and cannot be bypassed with a browser authority flag.

Open `/gcsp-presenter.html`; default runtime uses actual HTTP routes and no fixture dashboard.
Keep backend source frozen. A missing account/Greg producer is an honest unavailable body,
not permission to substitute fixture data as live evidence. Bootstrap an acting employee/Greg via
actual server switch, preserving the independent presenter cookie. Repeat with an isolated browser
context containing only the acting cookie for the nonpresenter-hidden check.

| State | Reproduction and expected evidence | Boundary |
|---|---|---|
| Idle/open/collapsed | Trusted presenter session; inspect real controls/context/scenario GETs. Verify actual run/time/person. Open with Enter, Tab through fields, Escape to summary. | Actual backend |
| Loading/busy | Slow the actual read or tick response in the runner; while pending verify visible status, disabled actions and one request under rapid clicks. | Actual route with controlled transport delay |
| Tick and UTC/named target | Tick policy step then named/future UTC cue. Match actual advancement and ordered handler receipts. | Actual clock/identity |
| Next release missing | Use actual unregistered-business-handler runtime; future release cue advances and tick reports missing release-pull. No zero-car claim. Repeat after cue is no longer future. | Actual backend; real release/count still outstanding |
| Reset/new run | Choose canonical clock-mechanics catalogue entry, cancel then confirm. Match new run and actual refreshed context/cookie. | Actual scenario/reset mechanics only |
| Scenario unavailable | Select any unavailable business entry; inspect missing capabilities and disabled Reset. | Actual catalogue |
| Principal switch | Actual employee to Greg and back. Verify selected principal equals actual `/context`, navigation contains no principal selector and HTTP surfaces load. | Actual identity and available account/Greg services |
| Lost response/retry | After real command commits, drop response. Retry sends byte-identical original body/ID and actual clock advances only once. | Actual command with controlled transport failure |
| Issuance replay | Drop switch response/cookie delivery; replay may conflict. Verify context match confirms, unknown/different remains uncertain; deliberate fresh issuance changes ID. | Actual identity with controlled transport/cookie loss |
| Refused/committed advance failure | Show typed refused reason; separately advance succeeds and tick fails. Verify actual new UTC time plus failure/handler reason. | Isolated injected handler/failure state, label synthetic |
| Pending | `components.html` GCSP presenter example or injected pending handler adapter. Verify order, missing stages and no release count. | Isolated visual fixture, not business proof |
| Backend outage | Authenticate first, then stop API or route-abort reads/commands. Backend unavailable must stay distinct from typed refusal. Retry original command after loss. | Actual outage/controlled transport |
| Nonpresenter | Only acting employee/Greg cookie; no presenter strip or unauthenticated error text. | Actual access boundary |
| Teardown | Navigate away while read/command response is delayed. No late DOM replacement or stale navigation. | Actual route with delay |

## Automated scope and remaining gates

`run-ui-check.py` owns one module per bounded chunk (120s, 768MiB RSS, 128MiB scratch,
2MiB log) and writes external manifests/checkpoints/impact/cleanup receipts under
`.claude/test-runs/fucq126-ui-20261105`. No full npm suite is claimed. Parent owns final review,
full-lane selection if justified, browser captures and cleanup of exact dependency symlinks.
Real release counts and complete business-scenario reset remain unavailable until their producers
are composed and exercised. A synthetic handler proves rendering only.
