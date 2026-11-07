# Proposed presenter handoff for the actual account host

6 November 2026. **Proposal for root/100 review; no implementation or execution grant.**
The six-case physical candidate at `953cf2201dc96e1adbfb000abe47169852c094ee`
and its manifest remain unchanged. This proposal follows 100's exact interface note at
`04e88f4e77f5e1b7d0596532b69440dce43c37dc`,
`docs/gcsp/manual-host-notification-interface-2026-11-06.md`, and its twelve-source receipt
`docs/gcsp/evidence/fucq100/manual-host-interface.json`, read through scaffold Git.

## Decided source facts and proposed destination

The actual destination for this bounded C5 path should be the existing `/gcsp-account.html`,
already a local host session page, with its existing `gcsp-account` journey root. The 100-owned
account harness would mount one presenter controller in a separate region immediately before
that root, keeping the controller alive when a journey generation is disposed. Reuse the
existing presenterBar and presenter-region styles; add no second portal header/sidebar.
The fixture branch remains read-only and does not mount a mutation producer.

100's connected harness currently supplies no presenter controller or subscribeClock. Its
central shell also has no presenter mount slot. This proposal therefore requires an actual
100-owned mount, rather than assuming that a disclosure component already produces changes.
100 can place the small coordinator at `blocks/gcsp/account/presenter-host.js` and call it from
`blocks/gcsp/account/harness.js`. It owns mounting/disposal of the region and manual journey.
100 should consume the required presenter styles explicitly; adopting the entire 126 shell or
workspace is unnecessary for this path.

For this mounted host, override the existing `navigate` option. The callback requests local
context invalidation and re-entry into that same account host; it does not follow its supplied
URL. This is a concrete producer: accepted126 already invokes `navigate` after acknowledged
reset, independently confirmed switch, or its existing confirmed stale-run reset recovery.
The emitted URL `/gcsp-presenter.html` is not a delivered central destination. This proposal
does not add it to an allowlist or claim that the separate126 workspace is adopted.

## Proposed callback and subscription contract

126 would make one additive controller option, **proposed name `onClockReadback`**:

```js
mountPresenterControls(presenterRegion, {
  adapter: presenterAdapter,
  navigate: () => coordinator.invalidateContext(),
  onClockReadback: (readback) => coordinator.refreshClock(readback),
});
```

The new callback runs after an ordinary tick/release action has settled and actual credentialed
`readControls` plus `readContext` GETs establish coherent run/principal authority and a new
clock version. Its finite payload is `{ runId, principalId, clockVersion, tickId }` from those
readbacks. It carries no cookies, command body, stock rows or authority object. It reports
current readback rather than claiming that every handler succeeded. Initial mounting, selection
changes, failed GETs and unresolved/lost mutation replies do not emit a confirmed change.
Original-command retry and refusal semantics remain with the existing controller.

The coordinator owns one local listener set implementing the existing journey option
`subscribeClock(listener) -> unsubscribe`. On coherent same-run/principal clock readback,
it first rechecks actual GET context, then invokes only listeners belonging to the current
host generation. This triggers the existing gallery/claim/setup/review reads without any POST.
100 adds a narrow account-view GET refresh branch, since the existing subscriber omits account.
That branch must preserve the account controller's pending/uncertain operation and must not
remount it into a fresh mutation command. No global event name, polling, cross-tab channel or
generic event bus is proposed.

`invalidateContext()` synchronously increments the host generation, aborts outstanding reads,
unsubscribes the old journey and calls its teardown before starting a fresh credentialed
`GET /api/gcsp/context`. Every continuation checks its captured generation after each await.
Only a successful current response can choose a new mount. Old hints, edits, claim descriptors,
retry commands and callbacks are discarded across run/principal changes. The persistent
presenter controller keeps ownership of any unresolved command; the coordinator never retries it.

A verified employee context mounts a new manual journey using actual HTTP adapters and fresh
reads. A valid presenter/Greg context shows the existing concise role/availability status and
the presenter chooser in this bounded employee host; it does not mount employee UI or infer a
default employee. A missing/unavailable context shows recovery with an explicit GET retry.
Reset cookie renewal can leave a valid presenter context: re-entry does not call backend
bootstrap, manufacture employee records, select another principal or prepare a new source.
Fresh-run missing preparation/source remains unavailable. Greg's full dashboard remains its
separate destination and is not silently added to this bounded C5 scope.

## Acceptance for a separately released implementation

- The actual connected account entry visibly mounts exactly one authorized presenter controller
  and disposes it with the host. The controller's real callbacks reach the concrete coordinator.
- A confirmed same-authority clock change refreshes account or the mounted journey through
  authoritative reads. Pending operations keep their original identity; no subscriber sends POSTs.
- Actual reset/switch re-entry disposes the previous generation before fresh authority is read.
  Late old GETs and queued journey callbacks cannot remount or mutate the new generation.
- Uncertain/refused actions retain truthful recovery. A reset with unavailable cookie renewal
  cannot be presented as a fresh employee session or positive business release.
- A freshly verified employee with unprepared manual/source state receives real unavailable
  responses. No old-run facts, provider window, claim or fixture is transferred.
- `pagehide` disposes the host. On a persisted `pageshow`, create a fresh coordinator/controller
  and reread authority before remounting. Other-tab synchronization is outside this local
  contract; backend stale/context checks and deliberate re-entry remain the recovery boundary.

## Validate and ownership limits

126's proposed delta is the optional clock-readback producer in `controls.js`, its focused
controller tests and the component API catalogue. 100 owns its mount/coordinator, explicit
style consumption and narrow account/journey read refresh. Neither party changes policy,
run-bound source preparation or mutation ownership. Root should release those named bounded
implementation slices after agreement on this contract. No100 files are edited here.

Future validation selects actual controller-to-host callback cases, same-run GET-only refresh,
reset/principal cookie confirmation, unavailable renewal/context, late-generation disposal,
original retry preservation and page lifetime. Reuse unchanged C3 journey proof. Freeze a new
candidate for any changed controller/host bytes; do not mutate the admitted six-case graph in
place or automatically rerun it. A positive business/reset journey still requires real preparation.

Apply `docs/gcsp/experience-quality.md`, `COMPONENTS.md`, the shell/palette references in
`docs/gcsp/screens/README.md` and the approved employee body reference
`docs/gcsp/evidence/fucq-6/README.md` revision `a7fc178`. Reuse presenterBar, controlled pickers,
statusScreen and the existing tokens. The future host change needs functional/CSP/ratchet
coverage plus desktop/narrow keyboard and rendered inspection. This document changes no
screen and makes no new visual acceptance claim.

Validation of this proposal was source reading, source hashing and link/whitespace inspection
only. No product/Node import, syntax command, test, probe, browser, scratch or reservation ran.
