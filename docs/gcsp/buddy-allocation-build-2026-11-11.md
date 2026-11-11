# Buddy tile and Presenter Allocation

Gary approved recommendation A for both [visual concepts](mockups/buddy-allocation-2026-11-11/README.md) on 11 November 2026 and requested a parallel build. The prior preferences navigation removal remains delivered; its page source is retained.

- FUCQ-397 / DEV-2026-11-11-GC-004 brings Buddy into Your cars: compact tile beside preferences, two recent events, Pause/Resume and history/detail drawers. Preferences and permission authority remain intact. Pausing retains held offers. The separate activity source remains available while its navigation moves into the tile.
- FUCQ-398 / DEV-2026-11-11-GC-005 adds a separate Presenter Allocation section. Counts cover Buddy offers in the current run. Pending means awaiting employee response; declined and accepted reflect authoritative outcomes. Expired is not declined; reconciliation is not acceptance. Existing Buddy Allocated stock occupancy remains distinct.

Both reuse existing adapters and kit components. This changes page composition and read projections within existing architecture boundaries; no new service, storage or external connection is introduced. Follow the [experience contract](experience-quality.md), [build rules](build-rules.md), supplied shell reference and approved option A screens.

Parallel implementation uses isolated story worktrees. Pussyfoot and Yosemite Sam were each requested and selected as `gpt-6.1-sol` / `medium` by the repository tiers tool, with no fallback or descendants. The parent owns integration, catalogue, tracker and product-map updates. Planned integration gates include scoped regression checks, real adapter/state review, desktop/narrow rendered inspection and keyboard checks for changed controls. Completion and collaborator acceptance remain separate.
