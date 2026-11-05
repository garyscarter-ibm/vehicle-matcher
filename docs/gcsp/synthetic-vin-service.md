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
