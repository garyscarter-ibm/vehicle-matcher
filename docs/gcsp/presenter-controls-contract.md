# Presenter controls backend contract · FUCQ-126

Additive contract, 5 November 2026. FUCQ-84 remains the identity/session authority;
FUCQ-85 owns clock/tick mechanics; FUCQ-125 owns catalogue/reset preparation.
No new store, migration, browser authority or business producer is introduced.

## Routes and readback

`buildServer({ gcspClock, gcspIdentity, gcspScenarios? })` registers these routes through
its shared gate/context boundary. Both require the independent presenter cookie
(`purpose: presenter-control`, role presenter), exact allowed Origin for commands,
strict fields/no query selectors and `Cache-Control: no-store`. The employee/Greg acting
context remains independently available from `GET /api/gcsp/context`.

`GET /api/gcsp/presenter/controls` returns the usual `ok` envelope with:

- Existing clock/scenario state: `runId`, `now`, `clockVersion`, `runVersion`, `versions`,
  `lastTick`, and, when the scenario service is present, `catalogueVersion` and `currentScenario`.
  Without the scenario service `currentScenario` is null; no scenario identity is invented.
- `controls: { policyVersion, step, namedTimes, nextRelease }`. `step` is the complete canonical
  assumption row `clock.presenter.stepSeconds`; its value is a positive integer, unit seconds.
  The seed records 60 seconds as assumed, with basis/source/date. No client copy or fallback.
  Missing or invalid step configuration makes presenter controls unavailable. Existing core clock
  operations and runs pinned to earlier immutable policies remain usable.
- `nextRelease: { status: available, to: release, at }` only while the configured named `release`
  cue is in the future, otherwise `{ status: unavailable, reason }`. This is a time cue;
  release-handler availability is reported by the actual tick, and never inferred from the cue.
- `principals: [{ principalId, name, roles }]`, projected and authorised by DemoIdentityAdapter.
  Employee IDs, scheme/grade/slot, session credentials and hashes are excluded from this list.
  The existing switch endpoint validates this selector again and issues the acting cookie.

Read-back failures preserve the shared typed refusal/unavailable envelope. The catalogue and
reset remain at `/api/gcsp/presenter/scenarios` and `/api/gcsp/presenter/scenarios/reset`;
missing business scenario capabilities remain unavailable through the existing service.

## Composed command and replay

`POST /api/gcsp/presenter/controls/tick` accepts only:

```json
{ "commandId": "presenter-unique-command", "expectedClockVersion": "1", "mode": "step" }
```

`mode: to` additionally requires `to` (configured named time or future UTC ISO instant).
`mode: next-release` targets the future named `release` cue. `step` reads the policy step.
`to` is forbidden on other modes; browser `bySeconds`, `eventId`, `inputDigest`, identity/run
fields and other unknown properties are rejected. No future cue returns explicit unavailable
without advancing; backward/invalid targets return invalid; a changed expected version is stale.

The server hashes the **entire original input**, including `expectedClockVersion`, and first
persists a durable plan through TransactionRepository. It stores the exact resolved target and
stable advance/tick IDs derived from the command ID. It then calls existing `advance` and `tick`
in sequence. Every retry sends exactly the original body/command ID. The durable plan and
existing subcommand receipts reuse the original target, advance outcome and tick even after a
lost response, a later clock movement or backend reopening. Changed input under a planned
command ID conflicts before another advancement. A new command needs fresh state/version.
Failed validation before a plan is committed creates no work or replayable plan receipt.
An interrupted tick uses its existing resumable event and completed handler receipts.

Success returns `ok { advance, tick }`. `advance` contains the actual committed time/version.
`tick` is FUCQ-85's unmodified tick projection, with actual ordered handler results,
`missingStages` and `state: completed|pending`. Missing release handlers yield a missing
`release-pull` stage and **no released count**, even when a future release cue exists.
The UI may show a count only from an actual release handler's explicitly reported result.

If advancement succeeded but tick fails, the original typed top-level failure includes
`advance` and, when readable, `tick` (the current lastTick, only for the same event ID).
This distinguishes committed time from incomplete handler work. Existing interrupted-clock
HTTP compatibility remains `unavailable`/retryable; the additive `handlerOutcome` and persisted
ordered outcome preserve the actual service refusal/reason. Pending/uncertain states remain
pending and cannot be shown as completed releases or accepted remote work.

The composition does not introduce an atomic transaction around service/network handlers.
An interleaved new clock movement may make the original tick stale after a committed advance;
that response exposes the advancement and requires reconciliation, never a second advancement.
Do not issue a fresh command merely because a response was lost: retry the original first.

## Session switching and boundaries

`POST /api/gcsp/session/switch` remains `{ principalId, commandId }`, with credential only in
Set-Cookie. Raw cookie values are never stored in receipts. An issuance replay may return
conflict because the original cookie cannot be recovered. Read current context to confirm the
acting principal; a new deliberate issuance uses a fresh command ID. Never claim a switch from
a guessed principal or reuse presenter roles as the acting employee's permissions.

Scoped tests validate backend presentation contracts and the UI consumer below. The UI follows experience-quality.md, supplied shell references
`screens/00-employee-account.webp` and `screens/01-replace-vehicle.webp`, the reviewed employee
body at `evidence/fucq-6/README.md` revision a7fc178, COMPONENTS.md and current shared Density
tokens. Actual release counts, full journey reset, browser evidence and live PostgreSQL remain
separate integration acceptance; synthetic handlers do not prove those producers exist.

## UI consumer · FUCQ-126

`blocks/gcsp/presenter-controls/controls.js` mounts the shared collapsible presenter strip;
`register.js` registers `<gcsp-presenter-controls>`. The shell mounts it by default and reveals
it only after a successful server CONTROL read, independently of the acting role. Embedders
and isolated fixtures use `presenterControls: false`, or inject `{ adapter, commandId, navigate }`.
The employee mount forwards `ctx.presenterControls` to the shell. Native labelled controls and
Escape preserve stable field/summary focus across readback updates; styles use shared Density tokens.

The controller captures one immutable command body and ID per deliberate action, blocks all
concurrent commands, and retains that same object for an uncertain-response retry. Version and
target edits cannot rewrite a retry. A switch is confirmed only by rereading actual `/context`;
an unknown/different principal keeps the outcome uncertain/refused, with separate original retry
and deliberate fresh-issuance actions. No credentials are stored or replayed by the browser.
Reset requires confirmation, captures the selected catalogue/version identity, and rereads controls
and actual context after the server's cookie renewal. A committed reset with failed session renewal
shows the new run and the trusted-bootstrap instruction.

`gcsp-presenter.html` is the real context-selected workspace. Its runtime reads `/context` then
mounts the existing employee account or Greg dashboard using HTTP adapters, or a presenter shell.
It has no default fixture and no principal URL selector. Confirmed switches navigate to this
workspace within the same packaged base path. `gcsp-greg.html` remains its separate fixture host.

Last-tick readback renders the server's `handlerOrder` and matching `outcomes`, missing stages and
pending/refused results. A release count is displayed only when an actual successful `release-pull`
handler explicitly supplies integer `outcome.value.released`. Missing counts say release unavailable;
future cues alone establish no cars. A failed composed tick keeps the actual committed advance.
A known successful pending tick receipt keeps its pending handler details visible while allowing a
deliberate next action or reset; it is not treated as an unknown command outcome. Typed field
explanations in `reasons: [{ field, reason }]` are shown alongside the outcome/code.
The UI adds no policy fallback, business producer or source authority. Scoped DOM/transport checks
and isolated gallery fixtures establish presentation behavior; browser captures, actual business
release/count and full business-scenario reset remain separate acceptance evidence.

## Existing policy and producer integration gates

The new assumed step in the edited seed applies only when that snapshot is first imported. An
existing stored `gcsp-policy-v1` is immutable: neither reseeding it nor rewriting its rows is an
adoption mechanism. The current publisher patches existing keys and cannot introduce this new
assumption. Existing database-backed runs therefore need a reviewed successor snapshot/key
adoption mechanism, then actual activation and run pinning through the policy work (FUCQ-103/83).
Until then, `presenter-step-unavailable` is the honest control result; core clock operations still
work. No local step fallback or database mutation is part of FUCQ-126.

For completion, compose the actual FUCQ-92 release producer and actual FUCQ-125 business scenario
preparers, then exercise next release, verify the reported number against actual inventory, and
reset into another available business scenario with a new run/context. Preserve ordered receipts
and run/policy identities. The clock-mechanics scenario, an unavailable catalogue row, or a
synthetic handler only proves that narrower boundary. These business acceptance items stay open.
