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

Remaining: rendered custom element and exact detail composition; shared gallery/catalogue/ratchet additions; desktop/320px/keyboard/image-failure evidence; FUCQ-92 release-history projection and actual released-run browse-to-claim integration; authored shared-kit/ratchet/render checks and serial full suite. `empty-stock` does not establish that no release tick has run. The projection recognises an explicitly supplied `nothing-released-yet` state for presentation only; the current producer does not supply it, and its fixture test is not producer proof.
