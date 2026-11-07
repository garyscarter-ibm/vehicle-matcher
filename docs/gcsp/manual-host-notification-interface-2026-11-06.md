# Manual host clock and context notification boundary

FUCQ-100 / FUCQ-126 coordination, 6 November 2026. Static source facts and bounded proposal only.
Product source remains f179ae6. Owned C1 harness repair9c890d9/cataloguec6a977a0 is frozen separately
for delta review. This note changes no product, test, TEST profile, installed dependency or harness.
[Exact source hashes](evidence/fucq100/manual-host-interface.json) pin the twelve files inspected.

## Actual central entry

| Surface | Current source contract |
| --- | --- |
| `gcsp-account.html` | Loads only `blocks/gcsp/account/harness.js`. No presenter controls element/script or host notification source. |
| Account harness | Fixture branch is read-only. Connected branch calls `mountManualJourney(host)` without options; it supplies no `subscribeClock`, gallery/review adapter override or context/navigation hook. |
| Manual journey | Optional `subscribeClock(listener)` may return an unsubscribe function; disposal calls it. On a callback, gallery refreshes stock and claim readback; setup/review refresh their reads. Account is not refreshed by this callback. No reset/principal signal type or context invalidation callback exists. |
| Account and shared employee shell | Account mounts the employee shell; that shell imports `portal-shell.js`. This path does not mount/import126 presenter controls. A presenter-bar disclosure component alone is not a controller or event producer. |
| Actual126 controls module | `mountPresenterControls` exposes adapter, commandId and navigate options. It has no state-change emitter/subscription option. Successful reset and independently confirmed principal switch call `navigate(workspace())`; workspace resolves to `/gcsp-presenter.html`. Tick updates its own readback. |
| Central local host | `/gcsp-presenter.html` is absent from this checkout and excluded by `scripts/gcsp-demo.mjs` public/session-page allowlists. Its workspace integration is separately owned126 source, not part of the30-leaf adoption. |

These facts confirm that the optional journey hook is not wired into the actual account entry.
They also show that subscribing to the existing clock callback alone cannot implement context change:
its current contract refreshes reads in the mounted view, retains that view's controller state, and does
not distinguish a new run/principal or refresh the account view. No existing event API can be cited as
an agreed producer for it. The current source establishes no mounted reset/principal refresh integration.

## Authority and preparation that navigation cannot invent

`GET /api/gcsp/context` resolves the current server-owned acting cookie. Principal switching writes
its new acting cookie and returns actual context. Named reset renews presenter cookies via
`renewPresenterAfterReset`; a successful renewal issues a valid presenter acting session as well.
The local static-page bootstrap calls `runtime.createLocalSession()` only when acting-session
resolution is not ok. It does not replace a valid presenter/Greg session with a default employee.
A reload therefore cannot be presented as proof of fresh employee preparation after reset.

Fresh employee authority/manual records must come from the actual backend preparation and/or agreed
scenario preparation. After a new run, stock must come from a separately prepared run-bound source;
missing preparation remains unavailable. Browser notifications, navigation targets and GET reads cannot
supply those records, claim another principal, reuse old-run facts or prove a positive C5 reset journey.
The C1 TEST helper released to122 remains exactly01c07f8 and makes none of these delivery claims.

## Bounded next source proposal for owner review

100 can own a small runtime-host adapter beside account/harness and wire its unsubscribe function into
the existing journey lifetime, once126 supplies an agreed real change producer or navigation handoff.
The proposed division is:

1. A confirmed ordinary tick in the same actual run/principal triggers current authoritative GET reads
   through the existing `subscribeClock` seam; no POST is repeated. Account refresh needs an explicit
   reviewed addition if the host must update that view on a tick.
2. A confirmed reset/principal change invalidates the old host generation and its callbacks. Resolve
   `/api/gcsp/context` through the actual credentialed adapter before mounting fresh employee UI or
   using126's agreed workspace route. Dispose old controllers/listeners; do not transfer old hints,
   unsaved edits, claim descriptors or retry commands into a different run/principal.
3. A refusal, lost response or unavailable current context remains explicit recovery. An uncertain
   control action is not a successful context-change notification and must not mint a new command.
4. For full-document navigation,126 owns the delivered workspace/route and actual cookie-confirmed
   destination;100 owns any manual-host handoff. For a mounted-host callback,126 must publish the
   callback contract and producer. No global DOM event, BroadcastChannel, cross-tab contract, polling
   interval or browser-time release is introduced by this note.

This is a proposal, not a newly agreed callback name or permission to adopt126 workspace/shell files.
Future100 scope is account/harness plus a small owned runtime-host adapter and any narrowly justified
journey change; shared controller,66/96, policy, source-profile and lifecycle ownership stays separate.
Keep the current C1/test/profile/helper freeze unchanged while this source delta is reviewed.

Before future execution, freeze the real emitter/navigation source, host code and exact resources.
Require evidence for: same-run tick causes only fresh reads; actual reset/principal change disposes
old generation and mounts only verified current authority; uncertain/refused change retains truthful
recovery without mutation replay; old callbacks and bfcache/other-tab behavior follow the specifically
agreed host contract; fresh new-run preparation/refusal is real. Reuse69/70 C3 where unchanged rather
than duplicate its journey suite. Browser/accessibility/visual and final integration gates remain open.

All findings here are from static file reads/hashes. No Node import/syntax, server, listener, browser,
probe, test, failure injection or resource allocation was performed for this interface note.
