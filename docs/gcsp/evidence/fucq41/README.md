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

Scoped adapter validation passed 17/17, with no skips or failures. The four new contract cases failed before implementation while the 13 existing cases passed. Required validation measured adapter coverage: 100% lines/functions and 97.85% branches. Node supplies aggregate coverage, not per-test contexts; unobserved branches remain unknown. Render/brand compatibility passed 118/118, no skips/failures, in 6.7 seconds. The required full suite is awaiting its serial allocation. Actual returned representative, explicit generic fallback and missing-image projections are retained in `presentation-examples.json` and were generated/asserted/inspected.

The adapter change/test identity is retained in the shared receipt `source-identity.json`; targeted proof key `1335deb053f0`, default variant, base/HEAD `6e5870dae05f`. Scratch and reservation were removed after each completed chunk. No browser or local compatibility exception was required.

The first retail attempt exposed a missing pre-existing `pg` install before render assertions; a temporary owned worktree link restores the identical locked `pg` 8.23.1 installation. The installed 139-file content digest is `10195441734c41efe671ffff4d2d3baa169809431fe6f49139c3da2c29f37dbf`. Its initial target in story 94 was replaced by the identical retained story 69 target; neither installation was changed. The 256 MiB retail retry was interrupted at 270,647,296 bytes RSS with no assertion failures; fresh HostBudget admission of 384 MiB completed the same scoped command. The source/test files remained unchanged throughout. This is dependency setup, not native PostgreSQL execution.
