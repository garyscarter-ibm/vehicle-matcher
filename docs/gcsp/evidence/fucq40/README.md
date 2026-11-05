# FUCQ-40 registered demo image provider

Implementation plan, 5 November 2026. This story stays in the existing vehicle-evidence image port and dated artifact boundary in the canonical HLD. It adds no service, database, route, registry wiring or consuming screen. The agreed FUCQ-64 body reference `a7fc178`, shell references and shared kit remain the reference for future consumers. Backend presentation assertions cover this story, so new UI screenshots are unnecessary.

## Authority and lifecycle

Gary Carter's FUCQ-40 Jira comment **132468**, dated **5 November 2026**, permits the selected white and black research renders to be displayed and registered/kept as versioned runtime assets for the **GCSP demo environment only**. The story decision records the same authority. This is no permanent entitlement, retail/public-site publication permission or live COSY authorisation.

The deployment operator must include these assets only in the GCSP demo backend artifact and explicitly select `environment: 'gcsp-demo'` when constructing the image adapter. There is no new HTTP delivery route. A later approved demo consumer may call the in-process byte reader; it must preserve provenance/fidelity labels and the existing access boundary. At the end of the demo, disable the composition, remove the two runtime image files and manifest from the versioned runtime tree, deployed artifacts and retained runtime distribution copies, and verify removal. No expiry date has been invented. Immutable research evidence remains separate; do not delete it as test scratch.

## Plan and test selection

1. Add `server/vehicle-evidence/bmw-image-adapter.js`, reusing FUCQ-37's complete catalogue identity validation/canonicalisation. Match full requested source selection, dates, viewpoint and size. Expose explicit safe missing, unsupported, unavailable and identity-mismatch states; never approximate by paint alone.
2. Register a versioned JSON manifest under `server/vehicle-evidence/snapshots/` and byte-identical local images under `server/vehicle-evidence/assets/bmw-gb-i5-images-2026-11-01.v1/`. Preserve both complete observed source selections and the source-typed accessory. The paint change does not prove other equipment fidelity.
3. Assert presentation provenance, representative role, verified model/paint and unknown wheels/interior/equipment. Test offline resolution, actual bytes/hash/type/dimensions, exact identity/view/size failures, missing/corrupt artifacts, safe error projection and mutation isolation.

Changed paths are this evidence directory, the story, the adapter, its manifest/two images and `server/test/bmw-image-adapter.test.js`. The only production caller boundary is the imported `bmwCatalogueLookupIdentity`; no existing caller is rewired. Fixtures are the immutable FUCQ-4 research records and local registered images. There is no configuration, subprocess or network dependency in the adapter.

Narrow iteration: `node --test server/test/bmw-image-adapter.test.js`. Adjacent checks: `node --test server/test/bmw-catalogue-adapter.test.js server/test/exact-listing-decision.test.js`, covering shared identity and retail photo/member isolation. Inspect the strict affected plan before targeted execution. The authored `npm test` remains a final serial integration requirement and will run only after dispatcher coordination. Live providers, keys, generic asset proxies and consuming UI are excluded by scope. Preserve scoped versus full evidence honestly.

Run `fucq40-20261105-image` uses the registered supervisor, one worker, expected 32 MiB scratch/512 MiB RAM/120 seconds per initial chunk. The supervisor owns temporary directories, process groups, host reservations and cleanup receipts; summaries stay outside scratch under the shared `.claude/test-runs/` directory. No large output is expected; any output reaching 256 MiB goes directly to the registered OneDrive destination.

## Source inspection

Both immutable input images were opened locally on 5 November 2026. They show the same front viewpoint and composition of the i5 reference with a visibly white versus black body. This inspection confirms the observed model/paint variation; it does not verify wheels, interior or equipment.

`file` and `sips` independently report WebP VP8, **2560 × 1646** for both. White: 82,798 bytes, SHA-256 `fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe`. Black: 86,286 bytes, SHA-256 `4c38cdb43b6438b7ae54fd1c882280bf744e88a17f2ce43597c5dd2c4890b5de`. These agree with FUCQ-4's evidence README. The source images are immutable inputs and are not disposable allocation.

## Implemented port and consuming seam

Import `createBmwImageAdapter`, `bmwImageLookupIdentity` and `presentBmwImage` from `server/vehicle-evidence/bmw-image-adapter.js`. Trusted composition uses `createBmwImageAdapter({ environment: 'gcsp-demo' })`; omission or any other environment refuses before artifact reads. `resolve({ ...resolvedCatalogueIdentity, selectionComplete: true, viewpoint: 'HEROFRONT', size: { width: 2560, height: 1646 } })` returns the FUCQ-37-style provider/version/source/requested/resolved envelope with `image` metadata only on `ok`. `readAsset(assetId)` returns the same validated evidence plus a server-side `Buffer` as `bytes`. Neither method constructs or returns a browser URL.

The manifest is `server/vehicle-evidence/snapshots/bmw-gb-i5-images-2026-11-01.v1.json`. Local IDs `bmw-i5-white-20261101-v1` / `bmw-i5-black-20261101-v1` bind to their respective complete source identities. The backend files are `server/vehicle-evidence/assets/bmw-gb-i5-images-2026-11-01.v1/alpine-white.webp` and `black-sapphire.webp`. They are not offer, VIN or exact-stock associations. A future gallery/offer caller must resolve its actual configuration, retain the representative caption and use an explicitly approved demo delivery seam. No active offer is fabricated here. Review of `.github/workflows/pages.yml` confirms its static copy set excludes `server/`; no retail publication path was added.

## Scoped validation checkpoint

[Validation receipt](validation.json): 52/52 pass, including 12 image, 22 catalogue and 18 retail exact-listing checks. Image adapter coverage is 100% lines/functions and 94.83% branches in the required scoped run. The strict automatic selector reports no JavaScript selector; the reviewed explicit command was used. The initial adjacent run could not load the existing `pg` dependency; restoring the unchanged server lockfile's dependencies resolved that environment issue. No package file changed.

The authored source-image `shasum -a 256` command passed with both expected digests. Runtime bytes equal their immutable research inputs and pass WebP signature, dimensions, byte length and SHA-256 checks. Tests reject missing/corrupt assets and incomplete/mismatched configuration identity, and block fetch/HTTP/HTTPS transports with zero attempts. Safe presentation/error projections preserve provenance and unknown equipment. The final authored `npm test` checkpoint remains pending dispatcher reservation and an updated integration base; scoped evidence is not a full stamp. A subsequent self-review pins each complete canonical source-identity digest, so corrupt option/accessory/trim metadata cannot establish an unobserved selection. Its authored 13/13 checks pass; refreshed integration evidence remains pending at this checkpoint.
