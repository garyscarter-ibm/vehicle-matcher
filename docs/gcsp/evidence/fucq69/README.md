# FUCQ-69 released car browser

## Independent projection checkpoint

The manual browser consumes only the existing authenticated `GET /api/gcsp/manual/stock` read adapter. Its DOM-free projection retains the complete `decisions` collection, one exact shared-card member per `orderUuid`, all snapshot/terms/provenance data and server revisions. Search, series/body filters and name/points/collection sorting do not rank, reserve or write stock. Unknown observations remain unknown; CO2 needs its supplied measurement basis and unit.

`createManualGalleryController` loads/refreshes with stale-response protection and disconnect cancellation. Detail inspection creates no claim. Review requires an eligible exact decision and a complete server-issued `claimInput`; a host callback receives that input unchanged plus a stable command ID for a matching selection attempt. Missing or mismatched exact identity fails closed.

FUCQ-66 contract: `f81855f:docs/gcsp/manual-claims-contract.md`, independently read through `scaffold_git.py`, SHA-256 `9c31f6f368ed4ed616c755eed168ae6bd75869cf65c4efc811eb0a2cd0cff294`. The current branch's base manual service predates that wrapper; missing `claimInput` therefore disables review until integration. No client revision synthesis or claim payload fallback exists.

## Validation scope

Selected command: `node --test server/test/gcsp-manual-gallery.test.js`. It covers full exact reachability beyond five, record/eligibility counts, search/filter/sort, typed zero/unknown emissions and contributions, selected identity/terms/fitted facts, model-reference separation, recoverable errors, asynchronous stale responses and teardown, the actual manual-context service and read-only HTTP boundary. Every database URL/PG alias is unset for offline tests. Small synthetic fixtures are unit-test inputs only. Actual service input is a bounded released-stock read-port fixture, not a FUCQ-92 release run or a live provider.

Implementer scoped result: 13 passed, 0 failed, 0 skipped on unchanged source at base `ddc6bb5`. Exact source/command/dependency identity and cleanup are retained under the shared checkout `.claude/test-runs/fucq69-projection/`. Independent parent scoped verification also passed 13 tests, 0 failed and 0 skipped (0.525 seconds, peak RSS 143,048,704 bytes), with all 71 source identities unchanged and `check-story DEV-2026-11-04-068` OK. Receipt: `.claude/test-runs/fucq69-parent-review/parent-review-receipt.json`; source stamp `93c9ffaa676840610cbb9c1f31736475b8a9feb6e4628757e7b8bafda507e1ff`. The first mutex-blocked attempt launched no Node process and is retained separately. Parent independently verified the absent scratch root/process group and dependency link; shared dependencies remain intact. These ignored receipt directories are local operational evidence, not portable source artifacts.

No full/native/browser check is claimed at this checkpoint. Each supervised run reserves HostBudget, writes the ownership manifest outside its scratch root, runs one bounded worker and removes owned scratch. The only dependency adoption is an inode-verified temporary link to the existing `server/node_modules` (`pg` 8.23.1); its finalizer removes the exact link and preserves the shared installation.

## Reference and remaining acceptance

Shell: `docs/gcsp/screens/00-employee-account.webp` and `01-replace-vehicle.webp`. Historical field evidence: `03-vehicle-series.png`, `04-vehicle-models.png`, `05-vehicle-details.webp`. Body: `docs/gcsp/evidence/fucq-6/README.md` revision `a7fc178`, with the current shared Density theme. Lead inspected these images and `representative-desktop.png`; no personal screenshot values entered fixtures.

Rendered custom element, exact details and additive shared gallery/catalogue/ratchet changes are now implemented and have the scoped evidence below. Remaining: desktop/320px/keyboard/image-failure evidence; FUCQ-92 release-history projection and actual released-run browse-to-claim integration; authored shared-kit/ratchet/render checks and serial full suite. `empty-stock` does not establish that no release tick has run. The projection recognises an explicitly supplied `nothing-released-yet` state for presentation only; the current producer does not supply it, and its fixture test is not producer proof.


## Complete delivery plan

Stable slice IDs include every remaining integration gate:

- `projection`: complete at its independent interface boundary. Published checkpoint `34862e7` evidence is retained above; the later controller reset and refreshed-filter recovery are covered by the current independent 131/0/0 UI checkpoint below. The separate released integration slice remains required.
- `rendered-browser`: in progress. Shared-card composition, stable labelled native controls, exact details, explicit claim transport/reconciliation, standard custom element, single-gallery examples and additive ratchet pass the scoped UI checkpoint. Granted desktop/320px/keyboard and agent visual inspection against the recorded reference remain required.
- `released-integration`: in progress. The actual F92 registered release tick/confirmed receipt now feeds the authenticated F100/F66 manual-stock HTTP read in the nine-case scoped proof below. Delivered wiring and metadata presentation remain open, followed by one exact released order through explicit claim, authoritative readback and the FUCQ-70 handoff without reclaiming. The bounded offline TEST provider and occupied-state fixtures do not complete those acceptance gates; the gallery owns no release command.
- `final-validation`: not started; recheck affected callers after shared integration, meet each story acceptance item, then run the authored full suite at the dispatcher's serial lane on unchanged source. Preserve exact command/source/environment identities and the final resource receipt; no full-suite or native result is inferred from scoped checks.

All test allocations use the supervisor/HostBudget contract, one bounded worker and an external ownership manifest. Browser allocation requires the dispatcher's separate readiness grant, with recursive owned browser/profile/port cleanup. Claims and release services, runtime registration and repository-contract files remain with their designated story lanes.


## Rendered implementation checkpoint

`mountManualGallery`/`<gcsp-manual-gallery>` compose existing shared cards, media, forms, facts, status controls and employee shell. Each card is one exact order; details retain allowance, monthly points/contribution/terms, equipment/specification/history and image/fact provenance. Native controls stay mounted through updates, retain temporarily unavailable selections and support focus return from details. The single component gallery and explicit read-only harness use a bounded dated three-car fixture; the default HTTP adapter has no fixture fallback and uses current authenticated reads.

The separate claim controller initially checks current authority. Only explicit Review POSTs the unchanged issued `claimInput` plus the stable command ID, coalescing repeated clicks. A complete current authenticated read must match the exact car, pinned quote, revisions, context/digest and unexpired server time before callback/event delivery. Pending, unavailable, existing or allocated claims block new choices. Explicit retry preserves the same command; verified terminal recovery requires receipt identity or a definitive failed attempt, so an older terminal hold cannot clear a newer uncertain operation. Reload exposes the current envelope for host routing without inventing an original descriptor/command/event. The FUCQ-70 composition boundary is documented in `docs/gcsp/manual-gallery-contract.md`; end-to-end consumer integration remains outstanding.

Lead reviewed the implementer source and affected shared callers. The implementer's initial serial projection/render result was 28/0/0; after the final terminal-hold correction, the affected rendered test file passed 17/0/0 and unchanged projection evidence was retained. The lead independently audited the current source, all implementer allocations and dependency identities in `.claude/test-runs/fucq69-rendered/parent-resource-audit.json`.

Independent parent selected command:

```sh
node --max-old-space-size=512 --test --test-concurrency=1 \
  server/test/gcsp-manual-gallery.test.js \
  server/test/gcsp-manual-gallery-render.test.js \
  server/test/shared-kit-contracts.test.js \
  server/test/ui-ratchet.test.js server/test/render.test.js
```

Result: **131 passed, 0 failed, 0 skipped**, 7.036 seconds supervised wall time, peak RSS 314,802,176 bytes. Tested at base `3db3de0` with the exact uncommitted rendered source hashes frozen. Checkpoint identity `203d98350d1a4f90347bcb545aad89a7de268cce38634b9012212ff6f1c1f1a1`; external summary/ownership/log and compact independent final audit are under `.claude/test-runs/fucq69-rendered-parent/`, including `parent-review-receipt.json`. The existing Taz runner reported a transient held mutex without launching tests; after a successful one-shot parent probe, the lead ran this unchanged selected plan directly, with no duplicate worker. No test ran under the Git mutex. `check-story DEV-2026-11-04-068` is OK. The lead independently verified all 174 consumed source identities, scratch/process-group/reservation absence, exact dependency-link removal and unchanged shared dependency/lock identities in the final receipt.

Browser preparation is in `browser-plan.md`, `browser-runner.mjs` and `browser-supervisor.py`. Supervised Python AST/Node syntax checks pass; their scratch/groups/reservations are verified absent in `.claude/test-runs/fucq69-browser-helper-syntax/receipt.json`. **At that preparation checkpoint no browser launch or grant was claimed.** The first separately granted smoke and its incomplete result are recorded below; no matrix is complete. The required real released-run, FUCQ-70 and authored serial full-suite gates remain open; scoped fixtures do not prove them.


## First desktop smoke · 6 November 2026

One dispatcher-granted `smoke-desktop` at exact `84af623` is **incomplete** because the evidence helper omitted the existing shell logo from its allowlist and returned 403. Both captures were inspected; packaged Density fonts and the trusted native series filter passed their checks. Preserve the failure and exact source/keyboard/capture/cleanup evidence in [the smoke record](browser/smoke-desktop-c29e8def39c3/README.md). This is a diagnosed helper asset gap, not a demonstrated product defect. That first grant is consumed; the separately granted corrected smoke is recorded below. The follow-up static closure/allowlist correction leaves all 174 product hashes and the 131-check proof unchanged. Released producer/claim/review integration and final full-suite gates remain open.


## Corrected desktop smoke · 6 November 2026

One separately granted `smoke-desktop` at exact `5147ba4`, reference `fucq69-smoke-5147ba4-0018`, passed in 3.169 seconds. Both original captures were inspected: the shell logos and Density heading render, three exact cards filter to the expected two through trusted native keyboard input, counts update, and Tab exposes visible Body-style focus. No overflow, fit scores, HTTP/page errors or external requests were observed. The [complete smoke record](browser/smoke-desktop-49bf496834ac/README.md) retains originals, source/runtime catalogue and independent cleanup evidence. All 122 browser and 174 product source hashes remain unchanged; the 131/0/0 product proof is reused. No matrix, 320px/detail/recovery-state acceptance, producer/claim/FUCQ-70 integration or full suite is inferred. The browser lane is released and no further run is authorised by this consumed grant.


## Released-stock read integration · 6 November 2026

The separately granted run at exact `6574dd2fe604f8bf6065dd8b810b8c27f1717114` passed **9/9, no failures/skips/cancellations**. The [portable result](released-integration/released-read-42ddd6eb4d16/README.md) retains the original plan, receipt, cleaned log and independent parent audit. It composes immutable F100 `95d77416361f54eb558bbcb40b382cbb45149c27` with exactly four F92 producer/history files at `15a79957e61d81612311d3aab7dbf77733dc4e0d`, actual F66 browse enrichment and the actual authenticated HTTP handler through a test-only bound facade. Original exact decisions/claimInput and typed failures remain intact; employee-visible history is added after claims enrichment. No shared runtime or route source was adopted or edited.

The actual registered release tick and confirmed receipt are exercised with an offline TEST provider using canonical snapshots. Occupied-state patches cover only the read boundary. `none-visible` is employee-relative; historical provenance does not establish current source health/version. No-write assertions apply to clean/nonexpired reads and preserve existing pending/expiry reconciliation.

Node supervised wall was 10.249757833 s; total supervisor wall was 16.981543709 s. Their 6.731785876 s difference includes materialization and finalization; preparation was not separately timed and synchronous local Git reads were outside the Node deadline. No strict preparation bound is claimed. Peak recursive RSS was 265,207,808 B; the later sampled combined disk peak was 2,325,696 B. The parent verified immutable107/own6/materialized163/pg54/lock/Node identities, unchanged product174, and absence of owned scratch, processes/group, owner and reservation. No listener/browser/native/install/link/loader was allocated.

Grant `fucq69-release-6574dd2-0033` is consumed. This proof advances the released-integration slice while delivered F100 wiring/host integration, visible history UI, full desktop/320px/keyboard/recovery matrices, actual browse→claim→readback→F70, and final serial full-suite acceptance remain open. F77/F78, real acknowledgement and native acceptance are separate. No further integration/browser/native/full run is authorised by this result.


## Next actual gallery-to-review plan · 6 November 2026

The [author-only journey plan](journey-plan.md) and [candidate source catalogue](journey-source-plan.json) pin 176 existing files/119 modules/355 literal edges around published100 eligibility38be4f5, actual92 and69/70 interfaces. F100 now solely owns the setup-ready→gallery→review host extension and runtime/server wiring. Two proposed DOM cases target rendered callback/event and current-authority reload; a single desktop success smoke is proposed separately. No product code/test/helper is adopted or executed here. Missing exact successor/provider/reset/host-entry/package/harness pins and explicit grants remain admission gates; prior9/70six/25/131 evidence stays at its original boundary. Broader visual, source, native and final acceptance remain open.


## History and blocked Back source checkpoint · 6 November 2026

Authored changes in `gallery-model.js` and `gcsp-manual-gallery.js` display validated employee-visible release history, latest UTC demo release time and unknown current source version without altering exact selections or current suitability. Invalid supplied history fails unavailable; absent optional metadata invents no absence. The live Back control is visible, disabled and explained during blocked/inflight/unknown reservation authority, with a current-state handler guard; only authoritative nonoccupying recovery enables it. No host, server or claims code changed.

Four new component-boundary cases are authored in `server/test/gcsp-manual-gallery-history-back.test.js`: history/filter/selection isolation; employee-relative absence and invalid metadata; rendered history; and guarded Back through check/inflight/pending/unavailable/matching terminal read, plus read-only compatibility. **No Node import, syntax check, test or browser has run for these changed bytes.** Source/diff review is static only. The earlier131-check and smoke results remain historical evidence for their original source; they do not validate this changed frontend. The accepted9released-read and70sixprotocol boundaries remain unchanged. Exact finite test/helper/package freeze follows this source checkpoint, then dispatcher review/grant precedes execution. F100 host/runtime successor6ef6c5f is external and not adopted here.


## History/Back finite execution proposal · 6 November 2026

The [component plan](history-back-plan.md), [exact catalogue](history-back-closure.json) and [dedicated supervisor](history-back-supervisor.py) freeze only the new four-case test against published product `0fa03f5eaced52eea7dbb8e3628a0a34318c8f41`: 17 JavaScript modules/29 import edges, 21 copied source/config/asset paths, and the existing JSDOM 30.0.1 closure (38 packages/59 dependency-peer edges/1,833 regular files/22,361,356 logical bytes). Nested dependency versions and two absent optional peers are explicit. All materialized source/config/assets and three published guards were statically matched to that commit's Git blobs.

Catalogue SHA-256: `ebd23ad78184730c399584cdfe27c18d459629f977261f94334dad4f41cf19ad`; supervisor: `e31520735e0df2884ae358fad89d9c171cd69d04eebdc116270a9e958e9a084b`; plan: `073088c9a886238f563c689728d6d1051edb8278d4251ef354145cbc160af385`. The caller must supply the reviewed catalogue hash and a separate dispatcher grant. The helper verifies itself and frozen inputs before importing the resource tool, copies approved packages with ordinary resolution/global lookup disabled, retains the original bounded named TAP, and requires exact4/4 with zero failures/skips/cancellations/todo. One worker, 120-second preparation and separate120-second execution bounds, 768MiB aggregate sampled RSS/128MiB combined disk/2MiB original log; strict HostBudget, external ownership/checkpoint, recursive stop/join and independent parent cleanup audit remain required.

The new helper incorporates the dispatcher's shared child-creation cancellation finding: masked creation/registration, restored child mask, enclosing cleanup of an unregistered local handle, and absence that includes the original group. This is source review only. No Node import, Python/Node syntax probe, test/helper run, browser/native/full execution, scratch/reservation/listener or dependency installation/link was allocated. Static catalogue/JSON/diff checks do not establish passing component behavior. Prior evidence remains at its original inputs; actual producer/host/claim→F70 and visual/full acceptance stay open. F100's updated external7238bec composition plan is acknowledged without adoption or mixed execution.


## Static HOLD repairs and fresh admission proposal · 6 November 2026

The original `2c2b8ea` harness proposal is **held** after independent static review found four real source defects: telemetry failure could bypass direct local-child stop/join; inherited registry behavior could prune foreign rows and tolerate missing/duplicate ledgers or token-only mutations; numeric group adoption/PID-keyed history could lose start ownership; and vm_stat plus helper/probe environments were not fully pinned/clean. No failed runtime or injected reproduction is claimed.

The revised [supervisor](history-back-supervisor.py) and [complete failure-path narrative](history-back-plan.md#static-hold-repair-narrative--6-november-2026) protect direct Popen-handle cleanup with an independent finalizer, keep every PID/start observation, validate every group before adoption/signaling, and retain sticky uncertainty. The independent HostBudget-registry adapter requires the existing frozen physical lock and regular strict JSON ledger; it preserves/fully charges every foreign row and binds own mutation/release/readback to exact owner/root/allocation/previous state. Supervisor environment is replaced before helper import/probes; vm_stat is newly pinned. Unknown cleanup retains named scratch/reservation for independent parent audit.

Revised catalogue SHA-256: `228cbd4b3f808c75ec625d6dd63e11ee06a3a860ec2a6c523ce8f73bf71ba5f6`; helper: `162a811442d1421c14f2ca8139cbe78941c33f7026a00b5f4e88cb54837e650b`; plan: `71471aad77d34a5c28ed7b4a93e9d4861dc65c57e29183ad2e534137814a95ec`. Only helper/plan guards, admission metadata and the vm_stat tool pin change in the catalogue. Comparison with the published prior JSON confirms unchanged product/source/dependency rows, 21/17/29/four cases/38/59/1,833/22,361,356-byte inventory, original tools, command, expected names and installed guards. There was no broad package re-enumeration or refreeze. Product remains `0fa03f5`; actual C3 central `f179ae6`/forthcoming labelled TEST profile remain separate and unadopted here.

All work is author-only: no helper import/compile/syntax/test, runtime resource probe, injected failure, browser/native/full execution or test allocation. Exact revised admission requires fresh root review and a separate grant. All prior evidence boundaries and broader acceptance gates remain open.


## Three-path helper revision after scoped HOLD · 6 November 2026

Root retained the earlier lifecycle/dependency review findings and held `99b7d59` on three remaining paths. The revised helper now requires fresh locked `registry()`/`bound()` owner/PID/start/root/allocation proof immediately before scratch deletion and keeps that lock through the shared inode check/delete. Verification/cleanup/probe accounting stays active through final receipt writes: sampled RSS, conservative kernel-high-water/current-tree RAM charge and combined disk are separately recorded and checked against the actual grant. Accounting failures remain sticky and never gate the protected unconditional direct-child join. The ledger opens `O_NONBLOCK` before descriptor regular-file validation, so a substituted FIFO is rejected before any JSON read. The [three-path failure narrative](history-back-plan.md#three-remaining-static-hold-paths--6-november-2026) details the source paths. No runtime reproduction is claimed.

Current catalogue SHA-256: `3f3db2f80b7937e195155cb06efd1f1892cf51f0db6d21559d96defe98ad1aa4`; helper: `0067416f49a8f10a4b05f317b30c7b11142d7a4398352d1e90d2a208fcaa927b`; plan: `ff633e5919f5cd13420e6a7f22a96ab0c627ae7996d79853623174ee3fba3d85`. The JSON comparison preserves product0fa03f5, 21 source rows/17 modules/29 import edges/four ordered cases, all38packages/59edges/1833files/22,361,356B, tools/physical host admission/environment/limits/command. Only helper/plan guards and revision metadata change. No broad source/dependency re-enumeration, helper syntax/import/test, runtime resource probe, injected failure or test allocation occurred. Fresh root review and a separate grant remain required; broader acceptance stays open.


## Final receipt bound revision · 6 November 2026

The `bc741b1` narrow review passed fresh locked scratch deletion and nonblocking ledger admission, retaining the earlier lifecycle/source/dependency/case/tool/limit findings. Its one remaining HOLD was the last receipt rewrite after the final accounting checkpoint. The revised [helper](history-back-supervisor.py) removes the recursive final-proof rewrite path: validate a finite JSON structure, reserve64MiB serialization RAM/4MiB final-output disk headroom, pre-encode a <=1MiB receipt and <=16KiB checkpoint, then atomically write those bytes once. The allowance includes ordering/token/output buffers, copies, both retained files and atomic temporaries. Bounds/headroom failures return incomplete; unknown headroom preserves the initial incomplete checkpoint rather than attempting output. The [final-output narrative](history-back-plan.md#final-output-accounting-edge--6-november-2026) requires independent parent postwrite size/hash/JSON/allocation/bounds/resource auditing and controller exit0 before acceptance. No self-measured postwrite peak or runtime reproduction is claimed.

Revised catalogue SHA-256: `c786b36faff60cc984caa5afbf5e13cf2c19d9db983f2e109d57f19e7dc0f0c0`; helper: `a1eed95114bd17df4589af65765dea4ce50841260cf640828db27902054b0dc6`; plan: `281eaf1c234e957edc016a493b0f7a0b6d2612618052ff9116ba5dc56b4839fe`. Product0fa03f5/source/dependency/import/four ordered cases/tool/host-admission/environment/limit/command pins are unchanged by catalogue comparison. Only own helper/plan guards and revision history change. No helper import/syntax/probe/test, injected failure or allocation ran. Root must review this single path and separately grant execution; all broader acceptance remains open.
