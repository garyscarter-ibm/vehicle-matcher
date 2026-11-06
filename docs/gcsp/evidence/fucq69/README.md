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
- `released-integration`: not started; consume the published FUCQ-92 release-history contract and prove the actual release producer feeds the same shared pool as buddy search. Verify pre-first-tick versus genuinely empty/suitable-stock states, then one exact released order through browse, explicit claim, authoritative readback and the FUCQ-70 handoff without reclaiming. An injected released-stock port or gallery fixture cannot complete this slice. Producer/contract access and a coordinated integration run remain outstanding; the gallery owns no release command.
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
