# Immutable configuration corpus and synthetic VIN publication

FUCQ-54 implementation plan, 5 November 2026. The live 4 November Q7/Q13 correction is binding: immutable configurations use configurationId; exact stock orders remain run-scoped PostgreSQL state; VIN maps contain delivered/current cars only.

## Implementation slices

1. **Artifact contract and validation (7 points).** Add corpus-publisher.js, bounded synthetic fixture helper and publication tests. Canonical configuration IDs use the existing stock.configuration.* assumptions through PolicyService. Retain source configuration facts, optional exact catalogue evidence and image-role/provenance separately from fictional VIN associations projected from FUCQ-53. Build deterministic manifest/checksums/counts/coverage; validate the entire candidate including profiles/signatures/references and presentation fields before selection.
2. **Atomic activation and retained history (6 points).** Add synthetic-registry.js, registry tests and explicit-path local CLI. Stage whole candidates, lock writers, sync immutable version files, retain identity associations before atomically replacing the selection pointer. Reopen validated selections on restart, recover the last good selection after interruption, retain synthetic routing through deactivation/failure, and reject historical/configuration/version drift. Document ports, CLI, provenance and operational limits.

## Validation selection

Changed paths are only the two vehicle-evidence modules, local CLI, their named tests/helper, this record, the HLD text and story result. Boundaries: existing PolicyService, profile registry/generator, FUCQ-39 snapshot contract and FUCQ-53 allocation output. Narrow checks are the two authored node --test commands and their combined presentation checks, plus existing profile/generator/allocation/snapshot tests for the reused contracts. The affected selector has no JavaScript plug-in; use explicit scoped evidence rather than its full fallback. The authored npm test is the final integration checkpoint after agreeing the executable base with the dispatcher. No native SQL/live provider/browser run is required by this offline capability. There is no screen/control; future consumers retain the supplied portal shell palette/header/sidebar and Used Cars body direction under experience-quality.md and COMPONENTS.md.

Resource identity: fucq54-20261105-corpus-publication. Ownership, supervisor/finalizer, checkpoints and compact impact evidence are under shared .claude/test-runs; one actual Node test worker, <=2 GiB scratch and ten minutes per chunk. Small synthetic fixtures only, no bulk collection or image downloads.

## Design status

Text describes the implemented publisher after its validation receipt below. The existing canonical draw.io remains authoritative for topology. Diagram changes are preapproved but no existing background diagram tab is available; no fresh diagram render proof is claimed. No new service, public writer/reset endpoint, runtime dependency or deployment change is introduced.

## Artifact and lookup contract

The packaged `server/data/gcsp/vehicle-evidence/publication-reference.v1/` contains four files: `manifest.json`, `configurations.jsonl`, `vins.jsonl` and `images.jsonl`. It is 17,954 bytes: one exact retained GB catalogue configuration and one explicitly fictional canonical identity for a US/LHD structural reference, with one current-car VIN and no images. The two rows prove the contract; they do not satisfy FUCQ-77's 200 real configurations or the later 10,000 target. `qualification` states this limitation. The real catalogue row does not invent physical model year, steering, plant or build date; the future 5 January 2027 catalogue production context remains inside its original dated evidence.

`writeCorpusCandidate(absoluteDirectory, input, options)` packages explicit configuration records and projects delivered/current associations from the complete, integrity-checked FUCQ-53 allocation inventory. It omits run-specific stock/order UUIDs, order numbers and wholesaler IDs. `vinAllocationOrigin` retains the original fictional seed/run/dataset as historical provenance. The allocator inventory remains the allocator's responsibility and is not copied into the publication. Empty VIN/image files are valid when their manifest counts are zero; a missing/empty configuration corpus is unavailable or invalid.

Configuration records retain `configurationId`, `snapshotVersion`, `canonicalIdentity`, `canonicalSignature`, source `configuration`, `sourceContext`, the original FUCQ-39 `catalogue` envelope where applicable, and `imageIds`. All source identity/date/options/measurement-unit/unknown fields survive unchanged. Canonical identity consumes the existing `stock.configuration.modelCodeField`, `.codeSeparator`, `.includePaintAndUpholstery` and `.encoding` assumptions through `PolicyService`; the manifest pins their full dated provenance. Supported rule changes must resolve through that service. Missing/unsupported rules, modified retained policy provenance and generator/profile drift fail explicitly. Technical schema/version/format checks are protocol invariants, not a second policy table.

The structural reference has fictional `REF1:REFERENCE` canonical codes, labelled synthetic separately from the source facts; the actual BMW AG/VG codes and selected equipment remain unknown. That exemplar cannot qualify as a real collected configuration. VIN profile selection validates the explicit configuration facts rather than deriving market, steering, dates or selection from VIN spelling.

Images require exact records from a trusted caller's `approvedImages` list, with a published asset reference, observed date and matching representative role/fidelity. The default list is empty; the CLI authorises no assets. The small corpus therefore reports `imageState: unavailable`, rather than using the unapproved research renders. Tests use a labelled fictional published-image contract only. This capability downloads or registers no image and claims no new access, retention or image permission.

`createSyntheticRegistry({root, policyService, policyRead, approvedImages?})` exposes:

- `load()` validates the selected complete version and independent history; it returns an active version or a finite source-unavailable report, with any recovered last-good version identified.
- `getConfiguration(configurationId)` and `getVin(vin17OrVin7)` return detached records from one captured snapshot, with `ok`/`partial`, `not-found`, `invalid-input` or `source-unavailable` outcomes. A valid corpus can contain partial facts. VIN results carry `identityKind: synthetic`, a fictional-association notice and `liveEligible: false`.
- `classifyIdentity(vin)` reads the durable inventory independently of active configuration availability. Known old VIN17/VIN7 values remain synthetic after deactivation, failed activation and restart. Missing/corrupt history fails closed; this closed service never authorises live forwarding, including for unknown input. A later provider-routing consumer must preserve that guard and distinguish unavailable from not-found.
- `publish(absoluteCandidateDirectory)` and `deactivate()` are explicit local operator operations. There are no public write/reset routes. FUCQ-55 owns the later HTTP wrapper over the in-process port; no HTTP call back into this backend is needed.

There is no repository, clock, employee state, policy-writing, stock, eligibility, points, release, hold/allocation or telemetry capability in this port. A demo run reset changes those separate mutable contracts and has no writer to the immutable store.

## Publication, failure and recovery

A publisher validates the entire candidate, stages all four files away from active readers, validates the staged bytes again, syncs files/directories, retains the complete immutable version under `versions/<manifest-sha256>/`, then durably writes `identity-inventory.json` before atomically replacing `active.json`. `last-good.json` and the selection's previous reference retain the recovery point. The inventory keeps configuration digests and original datasets, all historical VIN/physical-car associations and dataset/version digests; it contains no stock orders. No garbage collector deletes retained versions or routing history.

Readers capture either the old complete snapshot or the new one. Existing reader instances explicitly call `load()` to adopt another instance's selection; no asynchronous watcher mixes records. A candidate changed during staging, unsupported profile/schema, missing/truncated JSONL, checksum/count/coverage mismatch, duplicate ID/VIN, dangling reference or historical association conflict is rejected with the still-active version. An existing dataset/version cannot acquire different bytes. Additions retain earlier identities and origins; an explicit deactivation clears active availability while retaining synthetic routing inventory. Cold absence is `source-unavailable`, never a successful empty registry.

Writer admission uses unique same-host PID/token claim files and ordered tickets. A competing or incomplete live claim returns a finite busy report; there is no wait loop. Dead claims use unique filenames, so recovery cannot unlink a newly acquired writer's claim. On the next publication, dead-owned stage directories and interrupted atomic-write files are reclaimed. If a process exits after history retention but before selection, old data remains active and the new identities stay conservatively reserved. Repeating publication safely completes it. Invalid selected bytes trigger full validation of the previous selection; recovery is reported as source-unavailable with `recovered: true` and the readable previous version. Missing/damaged independent history requires restoration from retained operator backups; code never recreates it from an empty default when published state exists.

The store is a single-host filesystem boundary inside the existing backend deployment, not a multi-host shared filesystem lock service. Normal writers never modify retained version files. Integrity is SHA-256/checksum-based, not a claim of cryptographic authenticity against a malicious store administrator. The bounded loader accepts regular artifacts up to 64 MiB each and up to 100,000 configuration rows; larger publication needs an explicitly reviewed streaming extension. No new persistence service, runtime dependency or deployment topology is introduced. Persistence/packaging of the selected corpus and history across a deployed host replacement remains part of the existing release record; this local proof does not claim a deployed persistent disk.

## Repeatable local operation

From the repository root, replace `/ABS/vehicle-matcher` with the actual absolute checkout path. Use a retained runtime directory beneath the existing backend packaging root, outside source commits. This example reads the packaged small candidate without rewriting it:

```sh
node server/scripts/publish-synthetic-vin-dataset.mjs validate \
  --artifacts /ABS/vehicle-matcher/server/data/gcsp/vehicle-evidence/publication-reference.v1 \
  --run-id local-publication --as-of 2026-11-05T00:00:00.000Z

node server/scripts/publish-synthetic-vin-dataset.mjs publish \
  --artifacts /ABS/vehicle-matcher/server/data/gcsp/vehicle-evidence/publication-reference.v1 \
  --store /ABS/vehicle-matcher/server/data/gcsp/vehicle-evidence/local-runtime \
  --run-id local-publication --as-of 2026-11-05T00:00:00.000Z

node server/scripts/publish-synthetic-vin-dataset.mjs load \
  --store /ABS/vehicle-matcher/server/data/gcsp/vehicle-evidence/local-runtime \
  --run-id local-publication --as-of 2026-11-05T00:00:00.000Z
```

Repeat `publish` for an idempotent result with unchanged selected bytes and history. `deactivate` takes the same store/run/date arguments and keeps the independent inventory. `prepare --input /ABS/input.json --artifacts /ABS/new-candidate ...` builds a fresh candidate from the documented input shape, uses temporary sibling staging, and leaves input/allocation state unchanged. Optional `--policy-version` pins the initial policy read; loaded manifests resolve their retained version through the same canonical service. Output is one JSON report; exit 0 means success, 1 means rejected/unavailable/conflict, and 2 means malformed command/arguments. Failure reports name the rejected constraint and still-active version without printing complete input or any secret.

Large production/generated artifacts and archives must follow the project's OneDrive/output policy; the 18 KB contract fixture is the only new committed dataset. No 200/10,000 collection or real-provider request forms part of these commands.

## Validation evidence and experience

The two authored suites cover whole-candidate checksum/schema/profile/reference/provenance/count rejection, semantic source-context consistency, source-backed facts, approved image contract/fidelity, deterministic packaging, idempotent reload, additions/original datasets, restart/reset independence, historical conflicts, paused old-or-new readers, competing writer, abrupt subprocess exit, every injected publication phase, corruption recovery, durable deactivation routing and the actual CLI. An instrumented presentation test observes zero live `fetch` calls. Existing allocator/profile/generator and FUCQ-39 catalogue suites cover the reused integration boundaries. Integrated scoped verification passes 72/72 tests. The authored final `npm test` checkpoint passes 614 total / 612 passed / 0 failed / 2 managed-PostgreSQL skips at integrated e5c5dd1 (base 04e3484), full stamp key 918ce2d4ec3a, 5 November 2026 02:25 UTC. The story Result retains exact tree, environment, resource cleanup and strict targeted evidence. No configured managed database was available for the two external checks.

No screen/control changes, new component or screenshot is required. Loader reports and detached records preserve dates, units, explicit unknowns, source/synthetic labels and representative/missing image states across success, replay and rejected activation under [experience-quality.md](experience-quality.md), [screens/README.md](screens/README.md) and [COMPONENTS.md](../../COMPONENTS.md). Future views retain the supplied shell/header/sidebar/palette and Used Cars body direction. The canonical draw.io topology is unchanged; no existing background diagram tab is available and no new diagram render proof is claimed.
