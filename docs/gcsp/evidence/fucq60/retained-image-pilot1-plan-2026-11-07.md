# FUCQ-60 retained image pilot 1

Status: code built, scoped checks passed, and the parent-approved actual 349-source isolated proof passed once. Ordinary publication is not run and remains the parent integration session's separate decision after independent code and security review. See [the proof receipt](retained-image-pilot1-results/README.md).

The pilot reuses the retained F42 white i5 image for the one exact matching 1 November v1 configuration. It does not bridge v2 selections to a v1 identity. The existing `images.jsonl` association carries the image while every immutable configuration row keeps its original `imageIds: []`. Publisher validation admits that additive association only when the code-owned image registration, complete requested/resolved source identity and actual published bytes all match F42. The registry and active verifier include validated associations in effective image lookup and missing-image counts. There are no new wire fields, UI, dependencies, services or source requests.

## Stable code and selected checks

Pilot code: `9883e3c7`; integrated parent `1fb95f5e` at `d0873843` on `dev/DEV-2026-11-04-035`. The only merge conflict was in local lookup construction; the result retains `approvedImages`, `releaseLimits` and `sourceArtifactRoot`.

Changed pilot paths:

- `server/gcsp/vehicle-evidence/corpus-publisher.js`: exact registered additive association and effective missing-image summary.
- `server/gcsp/vehicle-evidence/registered-corpus-images.js`: code-owned registration, source identity and asset verification.
- `server/gcsp/vehicle-evidence/synthetic-registry.js`: validated configuration-to-image index without record mutation.
- `server/gcsp/vehicle-evidence/local-vehicle-lookup.js`: cold-load image approval alongside packaging options.
- `scripts/gcsp/verify-fleet.mjs`: independent retained-image association reconciliation.
- `server/test/gcsp-retained-image.test.js`: immutable-history, cold lookup, active-audit and rejection guards.
- `assets/gcsp-vehicle-evidence/fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe.webp`: original 82,798-byte WebP, copied locally without conversion.

The affected-test selector is Python-oriented, so these JavaScript checks were selected from reviewed callers and boundaries. One worker was used throughout, with 512 MiB host / 448 MiB child / 64 MiB scratch / 90 seconds per chunk. The external supervisor registered its finalizer and ownership manifest before scratch allocation, removed the owned dependency link, stopped process groups, deleted scratch and released each host reservation. No leftovers were recorded.

| Code identity | Check | Result |
| --- | --- | --- |
| Before parent integration | New pilot guard | 4/4 pass |
| Before parent integration | Publication | 7/7 pass |
| Before parent integration | Registry and indexed corpus | 15/15 pass |
| Unchanged F42/enrichment code | Existing enrichment and image contracts | 30/30 pass, reused after integration |
| Before parent integration | Fleet verifier | 6/6 pass |
| Integrated `d0873843` | Pilot guard | 4/4 pass |
| Integrated `d0873843` | Publisher, registry, index and verifier boundaries | 28/28 pass |
| Integrated `d0873843` | Release artifact packaging guards | 6/6 pass |

The first red failed on the old reciprocal-image restriction. A later red independently exposed the active verifier's old image expectation. One intervening setup run failed because the test omitted the required `offline: true`; that setup was corrected and its failed receipt retained. Passing counts above exclude those failed runs. There were no skipped tests. The full suite, SQL, browser, live source collection, ordinary-store activation and a 10,000-configuration proof were excluded because this change is one offline image association with no altered source/configuration/VIN contracts. The 3,621-row scale proof remains separate evidence and is not rerun.

Scoped receipts and bounded coverage observations are retained locally under `.claude/f58-63-overnight-20261106/f60/retained-image-pilot1/`. The compact impact entry is `.claude/test-runs/impact/fucq60-retained-image.json`.

## Exact actual-data candidate proof

Reproducer: [reproduce-retained-image-pilot1.mjs](reproduce-retained-image-pilot1.mjs). The supervisor will invoke:

```text
/opt/homebrew/bin/node --max-old-space-size=256 docs/gcsp/evidence/fucq60/reproduce-retained-image-pilot1.mjs --receipt <owned-output>/actual-receipt.json
```

The whitelist environment has no database, source credentials or demo access key. `TMPDIR`, `TMP` and `TEMP` refer to one supervisor-owned absolute scratch root; an external ownership manifest, host reservation and finalizer are registered first. The existing installed dependency directory is exposed only by a temporary, inode-checked symlink owned by the supervisor. No install occurs. The 19,556 KiB ordinary store and transient candidate/publication copies fit the existing 64 MiB scratch limit; the same 512/448 MiB RAM, 90-second and one-worker bounds apply. A limit failure is recorded and replanned, not described as passing.

Inputs are pinned to ordinary manifest `8af582cf0dc60488daa6a6bf105d0eb80bcda98d77958960f98abd5e2e15c3e9`, version `2026-11-07.4`, and configuration SHA-256 `da5c54020b9ccf2eddef8160a8df4e501f7ce57884b195bd275e242ff843f2f5` (6,500,952 bytes). This is 350 total rows: 349 source configurations and one structural reference, plus the one existing VIN association.

The proof will:

1. Hash the complete source-store tree and copy it unchanged to owned scratch. All writes target that isolated copy or the explicit receipt.
2. Retain every row through the real publisher and add only `APPROVED_CORPUS_IMAGES[0]`, under candidate version `2026-11-07.4-image-pilot1` and the same dataset. Assert byte equality of both `configurations.jsonl` and `vins.jsonl` before publication.
3. Publish only to the isolated copy. Compare every history configuration/full-row digest entry, VIN/physical-car association and prior dataset entry with the original; only one new dataset version may be added.
4. Cold-start both the real registry and default local composition. Resolve the exact imaged configuration through the consuming application port; require the representative label, exact static asset, unchanged original row and unknown physical production date.
5. Run the active verifier for all 350 configurations and one retained VIN. Use one worker and `sampleSize: 351`, so loopback HTTP covers all 351 routes and necessarily includes the imaged configuration. Require zero reconciliation/HTTP errors, zero external/source calls and a closed loopback server.
6. Rehash the complete source store to prove it unchanged. Retain a concise receipt with hashes, counts, fidelity limits, history comparison, audit and resources. The finalizer removes all scratch, the temporary dependency link and host reservation, then verifies their absence and no live owned process groups.

The image remains `representative-configuration`, HEROFRONT, 2560×1646, WebP, SHA-256 `fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe`, 82,798 bytes. Its F42 model/paint observation remains valid; wheels, interior, equipment match and exact-car appearance remain unknown. The F42 source manifest and its historical wording are unchanged. The later source/retention/display authorisation already covers this reuse.

This isolated proof does not establish complete FUCQ-60 acceptance, broader image coverage, public delivery or active publication. The parent owns independent review, shared integration, Jira and any publication decision.
