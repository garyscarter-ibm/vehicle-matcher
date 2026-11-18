# FUCQ-483 scoped repair evidence — 18 November 2026

Status: **partial**. The engagement regression is repaired in the lifecycle fixture, but the original acceptance item requiring the whole lifecycle suite to pass remains unmet. Neither original acceptance box is changed by this checkpoint. No integration, lease closure or Jira acceptance is claimed.

## Scope and identity

Base/claim: `6c5b656379f9478172ee95502c48fb3affb21488`. Allocated source: `server/test/gcsp-lifecycle-e2e.test.js` plus the dispatcher-authorised optional callback seam in `server/test/helpers/gcsp-journey.js`. Product brief gate, canonical policy, Account editor and Angular source were read only; F441 ownership is untouched.

The local `saveLifecycleBrief` reads `brief.accountPreferences.v1` through PolicyService, retains Body and the five-seat essential, and supplies the current canonical minimum: Body plus Sportiness and Comfort at their policy opening midpoints with medium importance. Charging is confirmed only for the pre-existing confirmed-charging variant. It saves over the real draft route, verifies the editor reports exactly the category minimum and zero remaining, then confirms over the real route. Both Buddy journeys receive this callback. The advanced-help and charging-unconfirmed paths use the same local fixture.

`walkPaulasPath` defaults to the existing `saveBrief`. Exact baseline transformation was checked: only its optional parameter and two call targets differ. `saveBrief` is byte-unchanged. Other default consumers (`gcsp-brief-after-accept.test.js`, `gcsp-critical-path.test.js`) were reviewed as unchanged and not rerun. This is scoped selection evidence, not runtime proof of those callers.

Tested SHA-256:

| File | SHA-256 |
| --- | --- |
| `server/test/gcsp-lifecycle-e2e.test.js` | `ec4bd3fecbe91f296b4e509c154ce0a6aaa8a7f842918bb7d2515544fd53be76` |
| `server/test/helpers/gcsp-journey.js` | `fe556b8287fb2e1b8b2fdec4c9fe2ea75a5e1b94e84f1d9d6ae636b2a6eddba0` |
| `server/gcsp/brief/index.js` (unchanged) | `0092f990514d933048acd6f81819d46f26302fe9e762f5596136453eac077b76` |
| `server/gcsp/brief/editor.js` (unchanged) | `b8fedb480ae11edd9a37482a136c21e49b01569f0187ec63a0ee7616ba34f9d6` |
| `server/gcsp/policy/seed-v1.json` (unchanged) | `23ce0fef1d65e9e54c3b6ddc65361f2abd92e0bb8071c05b4f9797daafad4591` |

## Selected validation

The plan was recorded before testing. Node v26.7.0, one Node test worker, real launcher composition over loopback HTTPS with memory repositories and synthetic stock; no native database or live provider. These checks own the changed fixture and its real legacy draft/confirm boundary. No Java, Angular, product UI, build or deployment change. Shared test-support changes require the parent's covering batch; **full suite: deferred to batch**. No green batch is represented here.

| Code | Command | Result | Supervisor time |
| --- | --- | --- | --- |
| Unchanged claim | `node --test --test-concurrency=1 server/test/gcsp-lifecycle-e2e.test.js` | 79 total: 20 pass, 13 fail, 46 skipped | 77.497 s |
| Corrected source above | `node --test --test-concurrency=1 server/test/gcsp-lifecycle-e2e.test.js server/test/gcsp-buddy-engagement.test.js` | 102 total: 58 pass, 10 fail, 34 skipped | 79.765 s |

The corrected result comprises 23/23 Buddy engagement tests passing and 79 lifecycle tests (35 pass, 10 fail, 34 skipped). Node counts both failing child checks and their five failing parent tests; there are five distinct failing leaf checks. All four previously refused engagement setup sites now pass. The advanced-help scenario and FUCQ-258 charging-unconfirmed scenario pass through their remaining checks. The two Buddy paths now advance to the existing allocation-detail assertion, so skipped downstream steps remain unproven. Sparse public confirmation, category counting, Same again, minimum loss, stale versions, aliases and idempotency all retain their existing green gate tests.

Syntax checks for both source files and `git diff --check` pass. The strict affected selector was inspected with `--dry-run`; no successful test stamp is claimed. The shared impact map is `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact/fucq483-20261118.json`; it records file/function ownership, fixture/config edges, timing, skipped boundaries and exact identities. No existing measured coverage-context selector serves this Node path; no second coverage-only suite was run.

## Remaining failures: diagnosis and minimal next work

1. **Two actor-snapshot equality failures, already red in the unchanged run.** The actual equality diff adds Greg's manual profile/current contract and entitlement-slot contract/renewal fields, with their versions and updated timestamps. This is substantive actor preparation, not arbitrary timestamp drift or a createdAt-only mismatch. `identity/http.js:113` prepares an employee on switch; Greg now has both `greg` and `employee` roles, and runtime wires preparation to `seedManualDemoContext`. Dual-role origin: `d3a768d32f5ca6f2b167c4b472450c594be6a887`. Proposed separate minimal fixture arrangement: prepare the actors required by each scenario before taking its immutable allocation-input snapshot. Assertions are preserved; no repair is included here.
2. **Greg handover readiness, already red in the unchanged run.** Expected refusal is 409, actual is `503 handover-readiness-unavailable`. `DocumentsService.#employeeOrOperator` checks `employee` before `greg`/`presenter`; dual-role Greg is treated as employee and fails ownership for Paula's order. `AppointmentService.complete` maps that non-ok readiness read to 503. Relevant origins: documents precedence `0f46baf7677d7bc4c84f084c66911cac04a6c474`, appointment mapping `f17b3c19bbae4996419ec68ecd01f5b0da2fdbae`, and the dual-role change above. This establishes a separate product route problem; a role-aware readiness access repair needs separate Bug intake and regression scope. It is not an engagement-gate defect. Parent owns intake; native Jira inventory was unavailable, so no separate Bug creation or duplicate-free claim is made.
3. **Two newly reached allocation-detail assertions.** Both throw `TypeError: Cannot read properties of undefined (reading 'find')` at `helpers/gcsp-journey.js:225`. The previous engagement failure prevented reaching this line. The helper reads `ticks.first.outcome('buddy-allocation').allocations`. The current clock registration invokes `consumeTriggers(context, { summary: true })`, which returns `summary` instead; clock also compacts legacy detailed outcomes. Origin: `b07598a6a6de8192b724317b8fea3e1aaa0d4063`, “bound release allocation clock results.” Canonical detailed reads are retained. Proposed separate minimal test repair: read canonical allocation detail from its supported service/receipt path and preserve the tie-break/one-car assertions. No claim is made about scoring or later assertions because execution stopped at this shape mismatch. No additional shared-helper change is included in this Bug checkpoint.

The dispatcher explicitly directed independent failures to remain diagnosed and unmodified. These failures keep the original whole-lifecycle-pass item open.

## Unexpected engagement-route audit

Bounded source review covered the Node brief service/editor/HTTP routes, canonical policy, legacy brief controls, Account preferences controller and Angular preference store (read only). The Account controller waits for queued saves and refuses Engage when the authoritative Buddy readback has remaining categories. The Angular store similarly guards the remaining count. The server recomputes the category gate for the content and brief/draft versions it is about to confirm; public legacy draft/confirm and pause/resume aliases share that gate. Sparse direct public confirmation is an intentional refusal and is proved by the unchanged green engagement tests. The corrected fixture now succeeds through those actual routes.

No unexpected **engagement** refusal route was established by that review. This is not exhaustive rendered UI, native-Java parity or live-provider validation. The separate Greg handover route defect above is retained for parent intake. Because this patch changes only test input and an optional test callback, with no screen, product response or user-visible behaviour change, a rendered visual critique is not applicable to this checkpoint.

## Resource and cleanup evidence

All outputs are bounded local files. **No OneDrive access.** The supervisor registered its finalizer before creating `/private/tmp/vm-poller-20261118-f483`, propagated owned TMPDIR/TMP/TEMP, used one worker, and reserved the shared HostBudget lane. Limits were 2 GiB scratch, 2 GiB RSS, 600 s/chunk, and a 5 GiB emergency disk reserve.

| Phase | Peak measured scratch | Peak RSS | Outer removed bytes | Final scratch |
| --- | ---: | ---: | ---: | --- |
| Before | 12,448 B | 595,279,872 B | 0 B | absent |
| After | 12,448 B | 561,233,920 B | 0 B | absent |

Inner test fixtures removed their transient files before outer teardown; outer `removedBytes: 0` does not mean zero allocation. Both receipts report no cleanup issues. The runtime lane was released to Sulley after the final chunk. The worktree-only dependency symlink `server/node_modules` was created for the run and points to the existing primary installation; it was removed at final cleanup and its absence verified in `final-cleanup.json`. The installed dependency tree is preserved. No other runtime allocation is retained.

Local detailed evidence: `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f483/` contains `plan.json`, `supervise.py`, `before.log`, `after.log`, both ownership manifests, both receipts and `corrected-inputs.json`. Logs are retained failure evidence, not successful output trees.

## Independent review

Mater completed independent pinned-source/security and retained-receipt review: no actionable defect in the allocated repair. Scoped source/security assessment passed; overall Bug acceptance remains partial/red and integration held. Exact report: `independent-review-2026-11-18.md`. Reviewer ran no additional runtime or scratch (0 B cleanup), with no OneDrive access. Final cleanup verified the exact owned scratch and dependency symlink absent with no leftovers; the existing primary dependency target was not removed.
