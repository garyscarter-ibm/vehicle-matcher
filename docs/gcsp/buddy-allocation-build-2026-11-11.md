# Buddy tile and Presenter Allocation

Gary approved recommendation A for both [visual concepts](mockups/buddy-allocation-2026-11-11/README.md) on 11 November 2026 and requested a parallel build. The prior preferences navigation removal remains delivered; its page source is retained.

- FUCQ-397 / DEV-2026-11-11-GC-004 brings Buddy into Your cars: compact tile beside preferences, two recent events, Pause/Resume and history/detail drawers. Preferences and permission authority remain intact. Pausing retains held offers. The separate activity source remains available while its navigation moves into the tile.
- FUCQ-398 / DEV-2026-11-11-GC-005 adds a separate Presenter Allocation section. Counts cover Buddy offers in the current run. Pending means awaiting employee response; declined and accepted reflect authoritative outcomes. Expired is not declined; reconciliation is not acceptance. Existing Buddy Allocated stock occupancy remains distinct.

Both reuse existing adapters and kit components. This changes page composition and read projections within existing architecture boundaries; no new service, storage or external connection is introduced. Follow the [experience contract](experience-quality.md), [build rules](build-rules.md), supplied shell reference and approved option A screens.

Parallel implementation uses isolated story worktrees. Pussyfoot and Yosemite Sam were each requested and selected as `gpt-6.1-sol` / `medium` by the repository tiers tool, with no fallback or descendants. The parent owns integration, catalogue, tracker and product-map updates. Planned integration gates include scoped regression checks, real adapter/state review, desktop/narrow rendered inspection and keyboard checks for changed controls. Completion and collaborator acceptance remain separate.


## Delivered integration

Both approved Option A implementations are merged into `gcsp-poc`: Presenter source `834c733c`, Buddy `56117eee`. The shared catalogue/gallery includes Buddy and its eight read-only states, and documents the separate Allocation region and authoritative readback callback. The parent corrected inherited pause/resume history labels after the live check (6/6 scoped regression checks passed).

Buddy uses explicit editor-gated pause-search/resume-search operations on the existing brief service, preserving saved grants and held offers while retaining upstream Engage/Disengage gates and accepted/stale-version protections. The separate activity rail item is removed, while its underlying page/routes remain in source. The preferences menu removal remains delivered.

Presenter's final integrated functional scope passed150/150. Buddy command/service/controller checks passed44/44; corrected tile6/6 and fixture parity1/1 passed, with composite caller/copy evidence and earlier failures retained in the per-story records. Actual desktop/narrow review verified Buddy Pause/Resume with a held offer and all three drawers, and Presenter pending, employee decline, readback and reset. Accepted is covered in authoritative projection/state checks, not a final real-browser decision. No full-suite or hosted production smoke claim is made.

Separate Low backlog defects remain: FUCQ-387 existing CSS ratchet debt; FUCQ-400 narrow existing Presenter header overlap; FUCQ-401 mixed offer-creation and DemoClock history timestamps. These do not expand the approved stories or imply accepted/Done status. Stories are ready for collaborator review.

Evidence: [Buddy](evidence/fucq-397/README.md), [Allocation](evidence/fucq-398/README.md). Captures are retained in the current chat outputs. Parent stops the two temporary review servers and removes owned disposable scratch during finalization; the existing visual-concept server is retained.
