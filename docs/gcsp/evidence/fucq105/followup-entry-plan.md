# FUCQ-105: verified declined follow-up entry

6 November 2026. Root authorised **authoring only** against the additive 102 interface reviewed at `373d89a61fe1ea0a8728fffc6a4a1ac52de1e0ed`. This checkpoint contains consumer source and regression cases, with static source/hash inspection only. No JavaScript, product imports, tests, supervisors, source mirrors, browser, listener, native database or live requests were executed. It grants no story acceptance or lifecycle change.

## Agreed read and presentation boundary

The successful schema-version-1 102 DTO adds `followup: null | { decisionId: 'offer-decision:<64 lowercase hex characters>' }`. Only the already authenticated exact-offer read can verify and supply the selector, using actual106 completed native decline/released-hold/history/digest/policy/post-write revision and consistent query/clock evidence. The selector provides no employee authority. 102 owns that lookup and whole-DTO refusal for unavailable or racing source reads; 105 never queries an event or reconstructs a decision ID.

105's projector preserves exactly that one-field shape only for a declined DTO with a terminal rejected/declined offer and released hold. Missing legacy fields, null and malformed or extra-key handles become null while preserving the known decline. No private actor/event/command/session data is copied. The controller validates the handle again before cloning a presentation, and snapshots remain isolated. It continues to ignore the decision POST payload and refresh authoritative state after every command, including a lost response. A later read or reload can supply the handle; no POST result or browser storage is required.

The declined view retains the car and recorded outcome, then shows a labelled **Your next offer** region. A missing handle or mount port shows **Follow-up unavailable. Check the current offer again.** The existing **Check current state** button rereads the offer and permits one new account/mount attempt. It cannot repeat a decline or confirmation. Automatic offer polls preserve a mounted question and its keyboard focus; an unchanged unavailable result does not loop account loading or mounting. Changed or removed handles, unavailable authority, different presentation structure and disconnect tear down the old child. Losing a focused child moves focus to the retained refresh control.

## Host port agreed with the inspected 107 interface

`mountOffer(root, adapter)` accepts an optional trusted host port:

```js
followup: {
  loadAccount({ signal }), // ordinary authenticated employee account loader
  mount(body, { decisionId, signal }) // synchronous mount returning a teardown function
}
```

105 waits for a fresh `loadAccount` result with `status: 'ready'` before invoking `mount`. `adapter.account` is display data and cannot satisfy this check. The host binds the loader to the existing employee session; 105 neither synthesises that session nor copies an offer-link capability into 107. 107 independently requires and verifies the real employee session and decision ownership on every HTTP operation. A token-only offer read may expose a selector yet still have no usable follow-up. Account refusal/transport failure/mount failure retains the declined state with explicit unavailable copy; it prints no provider detail.

The inspected 107 port at `94e05ff9070aa19f5deb3e9997dfed96cc268473` exports `mountFollowupBody(body, ctx)` and accepts `decisionId`, `signal`, `projectOffer` and `openOffer`. The shared host can bind it without a 105→107 import:

```js
followup: {
  loadAccount: trustedEmployeeAccountLoader,
  mount: (body, { decisionId, signal }) => mountFollowupBody(body, {
    decisionId, signal, projectOffer: toOfferPresentation, openOffer: trustedOpenOffer
  })
}
```

This is an integration contract, not installed runtime wiring. 107 owns its HTTP transport, independent session checks, question, confirmation idempotency and saved-change lifecycle. 105 passes only the selector and abort signal to the injected mount; the host supplies the projector and next-offer navigation in its closure. The original offer URL continues to accept only `offerId` and optional `runId`; no decision selector enters the URL, fragment, navigation reference or local storage. No new HTTP route, write port, identity mode or shared runtime edit is introduced. Cross-owner confirmation and the final combined source graph remain root's integration work.

## Components and validation boundary

Component plan: reuse the existing portal shell, exact-member card, `el`, heading, note/status text and `button`; the follow-up region is page composition. No kit primitive, CSS, catalogue signature, gallery component or ratchet limit is added. The agreed GCSP shell/palette and Used Cars body reference in `docs/gcsp/experience-quality.md` continue to apply. The catalogue records the additive host composition.

The ten authored consumer checks in `server/test/gcsp-offer-view-followup-entry.test.js` cover strict/legacy/null/extra-key handles and nondeclined states, clone isolation, successful and lost POST responses versus readback/reload, URL allowlisting, unavailable decline/refresh, stable question/focus and changed-entry cleanup, fresh account refusal, exact mount context, late account response after disconnect, and mount failure without automatic retry. They use explicitly labelled sample DTOs and contract ports; they prove no real account, 102 lookup or 106/107 composition until separately executed and integrated. **None has run.**

After root reviews the published source identities, select this dedicated test and affected projection/controller/HTTP/render/decision tests, plus UI ratchet/CSP checks. New helper imports make the old 133-check evidence insufficient for these changed consumer bytes. Preserve the old evidence as historical; do not rerun an unchanged proof merely to refresh a number. Before execution, prepare a new exact finite closure, dependencies, supervisor/loader/command pins, unique owned external manifest and shared HostBudget admission. The proposed consumer-only check can reuse retained jsdom without importing 107, but requires its own reviewed execution identity. Root's existing one-worker/120s/768MiB maximum/128MiB combined/2MiB log limits and independent cleanup duties apply to any later admitted run; no run identity or grant has been created here.

`followup-entry-source-plan.json` freezes the local consumer closure/test input and inspected immutable upstream ports. 102's new implementation pin and the final mixed 102/106/107 union are still outstanding. A complete actual-producer proof must lose the actual106 decline response, reload actual102/105, recover the same verified handle, then read/confirm through a real107 employee session and reload saved state. Missing/malformed sources versus repository/query races need distinct presentations. No sample or injected port closes those gates. Desktop1280/narrow375 keyboard/reduced-motion, normal email/account/cookie entry, second-browser, shared gate/host and authored full validation remain open; the browser lane stays UNALLOCATED.

## Existing mixed decision proof stays separate

The original actual106 memory proposal at `9090aff3b5779a6c80c4c9af099e8363726d2718` is retained as an immutable predecessor, with source-plan SHA256 `ce28e76ff4df809c7d68717eb8b2d6c65d7b50da863cf8ceac5b6f304174e4b1`, 51 modules/94 JavaScript edges/11 file inputs and original105 production pins. Its product/test/loader bytes and two cases/four checkpoints remain the basis of the separate [cancellation-safety harness successor](decision-mixed-cancellation-plan.md). That successor refreezes owned lifecycle/supervisor/auditor identities under root's authoring notice; the uncorrected predecessor is not a future launch proposal. This follow-up delta is not substituted into that product graph. Root must review the exact successor helper and composition identities before any execution. No seven-checkpoint rerun or extra grant is inferred.

Agents: Hippety Hopper, existing requested/selected `gpt-6.1-sol` / `high`; no new spawn, fallback or descendants. Authoring only; technical pickup against the agreed interface does not imply completed integration or acceptance.
