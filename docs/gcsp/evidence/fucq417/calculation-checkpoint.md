# FUCQ-417 calculation checkpoint

Reviewed by Wyldstyle on 14 November 2026. Only the `calculation` slice is complete. The Story remains In Progress with all five original acceptance criteria unchecked. Allocation wiring, the remaining evidence slice and integration are unfinished.

## Source identity

- Branch: `dev/DEV-2026-11-13-GC-010`.
- Reviewed implementation: `5bb69de28136f85bef2df608db1108b099ae5713`, tree `e07ba8f23424cd9862f021f4afcda08e415f86ab`.
- Implementation parent and published plan: `eccd46e7333f71082f52ceccae28c39a851a409d`.
- Exactly two implementation paths: `server/gcsp/recommendation/index.js` and `server/test/gcsp-recommendation-compact.test.js`.
- Helper configuration independently rechecked before metadata edits: actual base `gcsp-poc-dev`, inbox merge `auto`. Dispatcher retains publication, merge and native lifecycle.

The three final commands ran before the implementation commit, with worktree HEAD `eccd46e7333f71082f52ceccae28c39a851a409d` and its committed tree `968e43444d53245d798a1c2f444599f6a652b6fd`. Those HEAD/tree values do not include the then-uncommitted source. The seven captured input hashes below match the reviewed committed files; both lead and dispatcher verified them. The integration-base ref observed by these final receipts was `6640f3b9ab287155cba36abc9a49f625160232a5`; it is an observation, not a merge or integration-test claim. Worker runtime: Node `v26.5.0`.

| Captured input | SHA-256 |
|---|---|
| `.claude/scaffolding.json` | `bc89c2a95d4be2612eb069f5a0f3e7e9ffc7bd384c8085374598e0caff00d63d` |
| `server/gcsp/policy/seed-v1.json` | `ce6ac503ab8f3a97538c2663227ca3cf117994396c59ed55d1db386a44ccfe12` |
| `server/gcsp/recommendation/index.js` | `870e4b6faf26f7d87b73eb2f359ed626ead2594647effd4ff9a448cbbc065902` |
| `server/test/employee-recommendation.test.js` | `d3c45cebac415976e851110359d4f75e2996a3a38c2d4473ae06f178c83e6a82` |
| `server/test/gcsp-recommendation-compact.test.js` | `f5936ad18bef74d0c5798f253dc30126e8d19ab768c20390037dbbe0916450ef` |
| `server/test/gcsp-recommendation-stored-subject.test.js` | `1d1b33592dbc0eadf74cb9150e11b6fc51b64e4174e67123e315b75cd8d9512b` |
| `server/test/helpers/employee-recommendation.js` | `23e5e9529981671b4e77f08f0dcdfcc7d76a971426c10750e5a8b4fb6e7133df` |

## Semantic review

The lead reviewed the complete recommendation diff and new regression file against the previous gallery implementation, `createEmployeeTerms()` and its primitive/provenance/date validators, and `rankEmployeeRecommendations()`.

- Shared candidate calculation preserves policy, provider and practical gates. Timing gates remain an explicit operation using the current clock and availability; charging outcomes join in the original decision order. No cache or scoring/policy rule was added.
- Internal `createAllocationRecommendationEvaluator({ provider, policy, time })` exposes `evaluate(context, request)` for compact decisions and `quote(context, request)` for detailed decisions. Both retain provider order, all fallback candidates and complete decision/version/feedback pins. Neither constructs a recommendations gallery or invokes its ranker.
- Compact rows omit `snapshot`, `terms`, `brief`, `employeeFacts` and `evidence`; detailed rows reconstruct the existing decision shape. Detailed quote tests compare one-car results with the corresponding complete gallery decision, including explanation evidence and snapshot identity. They prove this calculation boundary with fixtures, not the allocation transaction path.
- Generated terms have a fixed shape. The compact path validates variable amounts, source/policy text and generated validity before skipping terms construction. Canonical operation time and generated ISO expiry satisfy the existing constructor's remaining date constraints. Detailed/gallery projections still use `createEmployeeTerms()`. Explicit ranking validation preserves the old malformed-policy failure without gallery sorting.
- Public service keys remain `recommend` and `previewUnsaved`; stored-subject behavior remains unchanged. The new tests cover metadata, gates, feedback, missing terms, malformed inputs, immutability and complete source ordering. Existing gallery and stored-subject regressions pass.
- Allocation code, `entryOf()`/duplicate-ID handling, F414 snapshot admission, F415 feedback calculations, and F424 transaction-scope arguments were not edited. Global contender ordering, attempted-claim transaction/replay/CAS/occupancy integration still require the allocation slice and its checks.

Review result: no substantive finding at this delivery boundary. No new defect or authorized acceptance exception is asserted. The repeated primitive/ranking validation must remain aligned with its existing constructors/ranker if those contracts change.

## Scoped validation and operations

Reused the retained final results after exact input verification; no matching tests were repeated for this lead review.

| Command | Final result |
|---|---|
| `node --test --test-concurrency=1 server/test/gcsp-recommendation-compact.test.js` | 22 passed, 0 failed, 0 skipped |
| `node --test --test-concurrency=1 server/test/employee-recommendation.test.js` | 29 passed, 0 failed, 0 skipped |
| `node --test --test-concurrency=1 server/test/gcsp-recommendation-stored-subject.test.js` | 14 passed, 0 failed, 0 skipped |

The same eight synthetic candidates produced these bounded counters. Terms counts observe constructed/frozen EmployeeTerms graphs; sort counts observe gallery decision arrays, not every sort inside scoring. The test restores both temporary wrappers in `finally` and runs with concurrency 1.

| Projection | Terms graphs | Gallery sorts |
|---|---:|---:|
| Gallery | 8 | 2 |
| Compact | 0 | 0 |
| Detailed | 8 | 0 |

This demonstrates the new calculation boundary only. It does not yet measure a wired allocation operation, database queries, latency or production-scale memory.

Earlier attempts remain retained: an isolated-worktree missing-`pg` import failed before test cases; the first loaded compact run passed 19/20 because a fixture used an unknown policy model while expecting exclusion. The fixture was corrected to the existing excluded M340i model. There was no product workaround or dependency install. An earlier passing compact run also predates the final source and is superseded by the final receipt below.

## Retained receipts and resource ownership

All paths in this paragraph are relative to the shared checkout `/Users/garycarter/Code/GitHub/vehicle-matcher`, outside this worktree. Bounded local receipts remain under `.claude/test-runs/fucq417/`: `ownership-manifest.json`, `grub/summary.json`, the supervisor/finalizer, per-run ownership records and logs. Final command receipts are:

- `grub/gcsp-recommendation-compact-1794643806662969000.json`
- `grub/employee-recommendation-1794643815386683000.json`
- `grub/gcsp-recommendation-stored-subject-1794643830700491000.json`

Dispatcher audit `.claude/fucq417-calculation-parent-audit-0815.json` independently verifies seven inputs, cleanup and counts; this lead also rechecked final hashes and owned process-group/scratch absence. No lead test runtime was allocated. All six owned groups (71736, 72775, 73350, 73871, 74030, 74155) and scratch `.claude/test-runs/fucq417/scratch/grub` are absent. Reported peak scratch is 4096 bytes and peak RSS 300285952 bytes, within the one-worker, 2 GiB scratch/600 second contract. No large output/archive was generated.

Tests borrowed the preinstalled root `server/node_modules/pg` read-only via an import hook in owned scratch. Receipt device/inode and entry/package hashes remained unchanged; this is dependency resolution evidence, not a native PostgreSQL connection. Existing shared toolchains and dependency links were preserved.

Agents: Wyldstyle lead requested/selected/effective `gpt-6.1-sol` / `high`; Grub implementer requested/selected/effective `gpt-6.1-sol` / `medium`, no fallback. Grub chat `01a1d917-4227-7021-8670-dbd76c962e65`; title, runtime and parentage were independently verified. Grub is completed/inactive. Map claims expire at this checkpoint while the lead awaits dispatcher publication; no worker activity is inferred from commits.

## Remaining original obligations

- Wire compact planning and detailed attempted-claim reconstruction into allocation while preserving global deterministic contender order and every fallback, frozen inputs/clock/policy/source, explanation references, replay, rollback, CAS and authoritative occupancy.
- Run `node --test --test-concurrency=1 server/test/gcsp-allocation.test.js` and `node --test --test-concurrency=1 server/test/gcsp-allocation-runtime.test.js`; both are unrun for this checkpoint.
- Complete the allocation-level semantic/operation evidence and relevant native PostgreSQL path. No native database proof was run here.
- Complete connected desktop/narrow release, offer and history inspection including no-match, conflict and replay outcomes under `docs/gcsp/experience-quality.md`, the supplied shell references, `COMPONENTS.md` and frozen baseline `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`. These original checks remain unrun. No screen, response consumer or UI source was changed in this isolated calculation slice, so new screenshots are unnecessary at this boundary.

Jira writes are resumed within task scope, all human collaborators have equal authority, original AC remain fixed, and `docs/gcsp/build-rules.md` demo delivery/scope control applies. This checkpoint establishes neither whole-Story acceptance nor permission for a Done transition. No push, merge or deployment was performed by the lead.
