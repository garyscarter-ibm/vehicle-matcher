# Launcher case journey source checkpoint, 6 November 2026

Authored one test in `server/test/gcsp-cases-local-demo.test.js`: **local HTTPS launcher serves case entries and connects trusted Paula and Greg actions with persisted reload**.

The test uses the existing `startGcspDemo({ runtime, tls })` and `createLocalHttpsFixture`, explicit memory mode, the central runtime's shared case service, real authenticated HTTPS and the existing help, dashboard and queue controllers. Trusted identity ports establish distinct Paula/Greg sessions in the same run. The actual help/Greg pages and their referenced assets must be served; no temporary page or replacement runtime is supplied. Greg demand uses its real HTTP adapter. The queue mounts in the real dashboard controller's reserved region.

The scenario checks that help opening/review writes no case, explicit confirmation creates one owned case, Greg reads real options and reviews without mutation, one confirmed in-progress/manual-decision update persists, and Paula's controller reload shows the same case/action/history. The due time is derived from the projected DemoClock instant. No stock, decline, lifecycle receipt, policy default or successful transport response is fabricated. Repository readback checks the state behind the actual HTTP replies.

This is authored source only. No application import, syntax/AST check, test, fixture execution, native tool, listener, browser or resource reservation ran. The older DEV-084 worktree lacks the central composition and HTTPS helper; execution is pending adoption into the combined central source. Do not copy those files into this branch or silently skip the test when they are absent. The interface basis is central checkpoint `fb3357213020830423979581ba58ce7e6a43e8bf`: `server/gcsp/runtime.js`, `scripts/gcsp-demo.mjs`, `server/test/helpers/local-https.js` and the existing HTTPS runtime tests. FUCQ-100 is independently updating page/session composition. This test is not a new FUCQ-100 merge gate.

The client explicitly attaches each trusted actor's cookies. It does not implement a browser cookie jar, Cookie Path matching or adoption of HTML `Set-Cookie` replies. The API cookies' `/api/gcsp` scope means a browser can omit them on HTML navigation. Consequently, this test cannot prove that page bootstrap preserves a deliberate Greg switch; FUCQ-100's central regression and rendered navigation check own that boundary. JSDOM mounts exported real controllers into source-derived hosts; it does not execute HTML module scripts, verify their browser upgrade order, establish separate browser contexts, or provide native-control/visual evidence.

After central adoption and a separate execution grant, the proposed selection is:

```text
node --test --test-concurrency=1 server/test/gcsp-cases-local-demo.test.js
```

Use the existing resource supervisor with one worker and the recorded scoped bounds of 120 seconds, 512 MiB RSS, 128 MiB owned scratch and 2 MiB logs. The launcher owns its manifest, reservation, bounded output and final absence receipt. The existing HTTPS fixture owns its test-only certificate directory under the supervisor's TMPDIR; the test closes controllers/JSDOM/launcher, restores globals and uses the fixture's existing teardown. Preserve a failure and stop; no retry is authorised by this source checkpoint. Runtime resource sufficiency remains unmeasured for this new selection.

Original FUCQ-122 acceptance remains open, including activity/order-progress placement, the remaining state/remedy/browser matrix, actual source/lifecycle integration, shared-kit quality, authored full/native/integration checks and final cleanup. Existing scoped evidence retains its original source and limits. Project equal-authority, build/experience/technical-readiness and IBM422 rules remain in force. No shared helper, runtime, server, launcher, foreign test, controller packet, failure record or retained evidence was changed by this slice.
