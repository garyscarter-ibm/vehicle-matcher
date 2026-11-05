# FUCQ-94 supporting backend validation and resources

5 November 2026, run `fucq94-20261105-editor`. This is a scoped backend checkpoint, not whole-story completion. The dispatcher released the exact paths in `supporting-contract-proposal.md`. Existing approved recommendation semantics and source gates, no-write preview and independent consent remain binding.

## Impact selection before execution

Changed paths: new `server/gcsp/brief/editor.js`, additive `server/gcsp/brief/http.js`, trusted server-only recommendation entry in `server/gcsp/recommendation/index.js`, shared content validation in `server/scenarios/employee/index.js`, one canonical `brief.editor.v1` assumption in `server/gcsp/policy/seed-v1.json`, serial injection in `server/index.js`, additive `docs/gcsp/shared-contracts.md`, new `server/test/gcsp-brief-editor.test.js`. The own controller/test may change only to admit the accepted empty equipment requirement. No existing UI/shared-kit/gallery edits.

Regression targets: sourced immutable context and typed permissions; canonical defaults/questions; exact unsaved base/draft versions without fabricated approval; actual preference/importance influence; explicit charging yes/no/unknown; untouched provider essentials, eligibility, allowance, driver, timing and stock gates; forged authority rejection; stale context; no repository/allocation/hold/mail effects. Affected callers are BriefService route consumers and the existing approved recommendation adapter. Public approved routes remain strict. Index composition has the broader existing `api.test.js` boundary check.

The automatic selector was already inspected for the controller: its unsupported-language full-suite fallback is not accepted. Explicit scoped commands, one Node worker each, through the registered supervisor:

1. `node --test --test-concurrency=1 --experimental-test-coverage server/test/gcsp-brief-editor.test.js server/test/gcsp-brief-controller.test.js`.
2. `node --test --test-concurrency=1 --experimental-test-coverage server/test/gcsp-brief.test.js server/test/employee-recommendation-api.test.js server/test/gcsp-policy-service.test.js server/test/employee-recommendation.test.js server/test/feedback-actions.test.js server/test/api.test.js`.

Both are wrapped by `_tools/test_stamp.py --targeted gcsp-poc` with this explicit impact reason. The first command can be narrowed to the new editor module while iterating. Reuse passing evidence when source/test/input/environment identity is unchanged. Coverage is measured during these required checks; Node provides file/function coverage, not per-test coverage contexts, so the shared impact map records this limitation alongside reviewed ownership/fixture/config edges.

Reviewed direct callers of the extracted validator and explicit-no gate include approved recommendation units and employee feedback recomputation (`server/scenarios/employee/feedback.js`). Add their two focused files to the boundary chunk before execution; this protects the changed shared function's callers without expanding to the full suite. The impact map and supervisor command reflect this addition.

FUCQ-95 commit `1bcea40338c8d1f1464f963fae831c4b0fb38784` remains outside this tree. Inspect its frozen brief HTTP/index/contracts seam to plan reconciliation, but do not copy/cherry-pick its implementation or tests. Combined activity-route validation is pending. No full suite, browser, render or ratchet run belongs to this backend-only slice: no mounted screen changes, and no screenshot claim follows from presentation-contract tests.

Frozen seam review: FUCQ-95 leaves `createBriefRoutes(service)` unchanged and introduces separate `createActivityRoutes(deps.gcspActivity)` immediately after its existing brief call. FUCQ-94 adds only the second editor-service argument to that brief call. Reconciliation must retain both calls and the separate activity import. Its shared-contract additions describe activity GET separately; retain both additive sections and version rows. This read-only review establishes a reconciliation plan, not combined execution evidence.

## Owned resources and teardown

External manifest: shared `.claude/test-runs/ownership/fucq94-20261105-editor.json`. Registered finalizer: adjacent `fucq94-20261105-editor-supervisor.py`. Exact disposable root: `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/scratch/fucq94-20261105-editor`. Receipts: shared `.claude/test-runs/receipts/fucq94-20261105-editor/`. All TMPDIR/TMP/TEMP and npm cache stay inside owned scratch. HostBudget acquires its short-held machine-wide reservation for each chunk.

Expected per chunk: at most 128 MiB scratch, 768 MiB RSS, 180 seconds, one test worker. Expected total installation and checks: under five minutes. Start with smaller module checks; replan after each chunk. Preserve the 5 GiB emergency reserve; reduce/split on low headroom. Nothing approaching 256 MiB is planned; if that changes, write directly to `/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/_agent-output/fucq94-20261105-editor/` with a revised plan.

Restore only the existing pinned `pg` via bounded `npm ci --ignore-scripts --no-audit --no-fund` in this worktree's `server/`, using its unchanged lockfile and owned npm cache/TMP. `server/node_modules` is a retained installed environment, not disposable scratch. Record lock hashes, package versions and installed allocation; preserve it. No dependency symlink or other package authority is introduced.

Restoration result: passed in 0.742 seconds, peak RSS 102,367,232 bytes and owned cache/TMP peak 2,920,288 bytes. Lock SHA-256 remained `6adf33f5d00f92bb4ae33c6d10b1ebafdeeb00b359c969010865e27fc490d12e`. Retained `pg` is 8.23.1; installed environment totals 475,201 logical / 851,968 allocated bytes. Shared receipt: `.claude/test-runs/receipts/fucq94-20261105-editor/retained-install.json`. Scratch, owned groups and reservation were verified absent. No compatibility exception.

The supervisor stops/joins owned process groups, releases reservations, removes exact scratch and verifies absence in `finally`. Retain compact code/input/environment identity, check counts, timing, coverage summary and bounded useful failures; remove successful verbose log trees after retaining their summary. Reconcile nested test-stamp-owned scratch and log manifests before final receipt. No deletion of other runs, installed environments, source/worktrees or user documents is permitted.

## Implementer allocation

Fresh tiers/capacity/date at 13:01:13 UTC selected Sonnet `gpt-6.1-sol` / `medium`; no fallback. Capacity's configured count was advisory under the explicit human session override in the main checkout's `.claude/dev-poller-directive.md`; the dispatcher reconciled the actual fourth tool slot and measured host headroom before allocation. Child `/root/brief_editor_fucq94/editor_impl` has no descendant authority. The dispatcher independently verified effective `gpt-6.1-sol` / `medium` in session `01a1abcd-083c-78d0-be5e-215a5257ae56` metadata and first turn context. Source/test edits are separate from the lead's serial index/contracts changes; one test lane is shared.
