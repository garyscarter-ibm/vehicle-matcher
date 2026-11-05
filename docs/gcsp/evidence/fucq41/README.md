# FUCQ-41 image fidelity contract

5 November 2026. Isolated server capability; no screen, component, retail mapper or runtime composition changes.

## Plan and boundaries

Extend the existing image adapter and its tests. Exact registered configuration images remain representative catalogue renders. An explicit `fallback: "bmw-i5-generic-20261101-v1"` choice may reuse the already permitted white catalogue asset as generic imagery after a missing, unsupported or mismatched configuration image. Generic results retain requested identity, omit matched/resolved configuration identity and paint, and mark every visual attribute unknown. A successful exact selection takes precedence. Invalid identities, provider/version changes and a requested VIN illustration or exact-car photo cannot use this choice to bypass their guards.

The existing finite manifest and asset integrity checks still govern every result. No new asset, URL, source request, provider, service or permission is introduced. Gary Carter's FUCQ-40 comment 132468 permits these two versioned assets only for the GCSP demo. After the demo, disable/remove runtime manifests/assets and deployed/distributed copies and verify removal; immutable research remains separate.

`presentBmwImage` supplies concise representative/missing labels, safe alt/caption/message and per-attribute state/labels. Its catalogue projection refuses VIN-illustration/exact-photo roles and elevated fidelity. Backend assertions replace screenshots: no screen changes; the agreed shell is `docs/gcsp/screens/`, body reference `a7fc178`, and existing mediaWell/result-card/brand behaviour remains protected. No PolicyService assumptions are read or added.

## Selected validation

- `node --test server/test/bmw-image-adapter.test.js`: exact identity, broken/malformed inputs, explicit generic fallback, roles, unknown attributes, safe presentation and independent valid catalogue facts.
- `node --test server/test/render.test.js server/test/brand.test.js`: unchanged used-car media and brands.
- Authored `npm test` complete file set, serialized as `node --test --test-concurrency=1 server/test/**/*.test.js`, after the dispatcher grants the serial slot.

The affected-test selector has no JavaScript dependency plugin; explicit scoped commands cover reviewed adapter/catalogue/asset/presentation boundaries. No browser, retail source, live access or native database proof is claimed. Full validation is an explicit story requirement.

Run identity: `fucq41-20261105-image-fidelity`. Ownership/finalizer and compact plan/impact/receipts are under shared `.claude/test-runs/ownership`, `impact`, and `receipts`. One worker, 32 MiB scratch, 256 MiB narrow RAM, 120 second narrow chunks; full chunk initially 768 MiB/600 seconds. HostBudget admission preserves live foreign reservations. All temporary variables use the owned root; supervisor joins process groups and removes exact owned scratch. Expected output is small; any archive or output reaching 256 MiB goes directly to OneDrive `vehicle-matcher/_agent-output/fucq41-20261105-image-fidelity/`.

## Results

Scoped adapter validation passed 17/17, with no skips or failures. The four new contract cases failed before implementation while the 13 existing cases passed. Required validation measured adapter coverage: 100% lines/functions and 97.85% branches. Node supplies aggregate coverage, not per-test contexts; unobserved branches remain unknown. Render/brand compatibility passed 118/118, no skips/failures, in 6.7 seconds. The required integrated full suite passed 1,103 of 1,105 tests, with two explicit native PostgreSQL skips and zero failures. Actual returned representative, explicit generic fallback and missing-image projections are retained in `presentation-examples.json` and were generated/asserted/inspected.

The adapter change/test identity is retained in the shared receipt `source-identity.json`; targeted proof key `1335deb053f0`, default variant, base/HEAD `6e5870dae05f`. Scratch and reservation were removed after each completed chunk. No browser or local compatibility exception was required.

The first retail attempt exposed a missing pre-existing `pg` install before render assertions; a temporary owned worktree overlay restored the identical locked `pg` 8.23.1 installation. The installed 139-file content digest is `10195441734c41efe671ffff4d2d3baa169809431fe6f49139c3da2c29f37dbf`. Its initial target in story 94 was replaced by the identical retained story 69 target; neither installation was changed. The 256 MiB retail retry was interrupted at 270,647,296 bytes RSS with no assertion failures; fresh HostBudget admission of 384 MiB completed the same scoped command at 330,907,648 bytes peak RSS. The source/test files remained unchanged throughout. This is dependency setup, not native PostgreSQL execution.

The scoped checkpoint is retained at shared `.claude/test-runs/receipts/fucq41-20261105-image-fidelity/scoped-checkpoint.json`. Filesystem/process inspection verified all six owned scratch roots, groups and reservation tokens absent. The owned `pg` symlink and empty, inode-checked `server/node_modules` overlay were removed; story 69's installation remains unchanged. Disposable successful proof output/code removed: 1,532 bytes; bounded expected-red failure evidence and compact identities/results remain. No cloud scratch, compatibility exception or cleanup leftover exists.

## Integrated full validation

The dispatcher granted the serial slot after FUCQ-94 merged. Verified base `ade262aa81c7ccbf0043e0f5658a7052f501734e` was merged through the git wrapper's checkout mutex, preserving published history. Tested HEAD `8fa94c10d3d84b2a6b0cba822616083127fc3dfc`, tree `73aecac45d545b06a24ac71a12aa303e129dd582`. The 115 integrated paths include brief runtime/UI/shared controls and Driver's Guide changes; the image adapter/catalogue/manifest/assets remained unchanged. The authored complete 58-file selection justified this one full run; no duplicate scoped run was needed.

Exact command: `node --test --test-concurrency=1 'server/test/**/*.test.js'`. Result: 1,105 tests, 1,103 passed, zero failed/cancelled, two skipped; 52.5 seconds. `GCSP_DATABASE_URL` was unset, so native constraints and PostgreSQL repository integration were explicitly skipped. This does not prove native durable storage. The generic shell stamp cannot parse Node counts (`ran: null`, `skipped: 0`); the counts above were read from Node's output and are retained separately.

Matching status: `stamp: key 7a9071082ee3 (tree 73aecac45d54, HEAD 8fa94c10), tests passed, wall 52s, 2026-11-05T14:56:17+0000, variant default, Python 3.14.7`. The complete stamp key is `7a9071082ee3793c7e3fbdc17ffb6af533790d423ac8c0eed40b0fc92849ea23`; execution environment hash is `a5ae6431dcc08f6071844c0598c47b95ede6deb22f53957db84192e7783d275e`. [Full validation and reproduction metadata](full-validation.json) retain the exact execution identity, Node v26.7.0 binary hash, stamp, dependency identities, limits and cleanup receipt.

Fresh run `fucq41-20261105-integrated-full-01` registered its external ownership manifest and supervisor finalizer before allocation. One worker, 768 MiB RAM/32 MiB scratch/600 seconds; measured peak 327,942,144 bytes RSS and 332,928 bytes scratch. Fresh HostBudget admission preserved foreign reservations. All 1,070 tracked hashes and all 139 installed dependency-file hashes matched before/after testing; the temporary overlay used only retained story 69, with no dependency on story 94's worktree. Independent inspection confirmed scratch root, child root/group/reservation and overlay absent, retained installation unchanged. Successful logs removed: 28,195 logical bytes (36,864 allocated bytes). Compact plan, identities, checkpoint and `final-receipt.json` remain under the shared run receipts; no cloud scratch, compatibility exception or leftovers. Result/evidence documentation is the only change after proof and is excluded from the code stamp.

No new screen requires screenshots. `presentBmwImage` assertions and actual examples cover representative, missing and unknown states. Future consuming screens retain `docs/gcsp/screens/README.md`, the approved FUCQ-64 shell/body reference `docs/gcsp/evidence/fucq-6/README.md` at `a7fc178`, and `COMPONENTS.md` obligations. The demo-only asset retirement duty above remains binding.
