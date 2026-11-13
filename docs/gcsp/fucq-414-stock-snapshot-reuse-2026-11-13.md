# FUCQ-414: immutable stock snapshot reuse

Story `DEV-2026-11-13-GC-007`, five points; claimed by `garyscarter-ibm` at `806d481647cb467f01d0cfcf45cf1d172a61c956`. Work is confined to its prepared worker branch, `dev/DEV-2026-11-13-GC-007`. The worker's own scaffolding API independently resolved `gcsp-poc-dev` before work. Claims, Jira, publication, integration, closure and worktree cleanup remain with the dispatcher. No acceptance or deployment is inferred from a checkpoint.

## Contract and readiness

The four original native criteria remain fixed: reuse a validated immutable stock snapshot; preserve validation and exact identities, including VIN rejection; preserve decisions, explanations, historical replay and employee isolation with bounded ownership; inspect connected release/offer/history at desktop and narrow widths, including no-match and conflict/replay. The final criterion remains a required gate even though no screen implementation is planned.

The existing recommendation `validateSource` → `createVehicleSnapshot` boundary and immutable vehicle constructors permit independent implementation. No allocation, policy, Angular, Java or repository interface change is required. Source ownership is limited to `server/gcsp/recommendation/index.js`, `server/vehicles/index.js` and new isolated `server/test/gcsp-stock-snapshot-reuse.test.js`. Shared test helpers and existing tests remain unchanged. Other Story owners retain allocation, policy, build/configuration, Angular, Java, identity and persistence files.

Follow `AGENTS.md`, `build-rules.md` (especially Demo delivery and scope control), `demo-brief.md`, `experience-quality.md`, `technical-readiness-2026-11-05.md`, `screens/README.md`, `COMPONENTS.md`, the migration kickoff and coordination records. Jira writes resumed on 13 November, within existing authority. Collaborators have equal authority. Child-only HTTP 422 diagnostics do not stop authorised work while the launcher works. Known separate findings FUCQ-400 (Low header overlap) and FUCQ-484 (Medium baseline migration-discovery assertion) are not repairs here. New lower-than-High defects must be linked separately without expanding this Story.

## Stable delivery plan

The product-map plan declares `reuse`, `proof`, `connected`, and `review`. Existing verified component associations are preserved. No slice becomes complete from a worker exit or isolated passing test alone.

Use constructor provenance held weakly to recognise only snapshots already validated and deeply frozen by the vehicle module. Preserve exact object identity, never substitute by configuration/version. Avoid traversing that trusted graph during provider cloning and final result freezing. All mutable/unrecognised snapshots retain the existing clone/validate path. Employee facts, current-car inputs, briefs and availability remain per-evaluation values. No suitability, policy, employee, stock-array or release cache is introduced.

## Validation selection and resources

Run the native commands unchanged, initially as a baseline and after relevant changes:

```sh
node --test --test-concurrency=1 server/test/employee-recommendation.test.js
node --test --test-concurrency=1 server/test/gcsp-recommendation-stored-subject.test.js
node --test --test-concurrency=1 server/test/gcsp-vin-allocation.test.js
node --test --test-concurrency=1 server/test/gcsp-stock-snapshot-reuse.test.js
```

Select additional vehicle/retail and actual producer/offer boundaries from inspected callers. Proof uses small synthetic inputs, full outcome equality and operation counts. No large-load or full-suite run is justified solely by completion. Native PostgreSQL remains necessary for relevant database-path claims; memory fixtures and skipped native checks prove neither. Connected rendered review, applicable Safari/private/keyboard/CSP/accessibility evidence and independent final review must be recorded explicitly.

The launcher owns resource finalisation. Evidence is outside disposable scratch under root `.claude/test-runs/fucq414/`. Each allocation needs an external ownership manifest and supervisor finalizer, scoped TMP variables, one worker initially, at most 2 GiB scratch and ten-minute chunks, bounded logs and measured identity/time/RSS/disk. Keep a 5 GiB emergency reserve and adapt near 30 GiB. Resolve the actual configured OneDrive destination before outputs above 256 MiB; none are planned. Stop/join owned children and verify scratch absence independently. Do not remove worktrees, dependencies or source data as test cleanup.

## Agents and observations

- Lead: Foghorn Leghorn, saved title verified by `set_thread_title`; chat `01a1d70b-7e3d-74c2-ba6d-d52f3181668e`. Requested/selected `gpt-6.1-sol` / `high`, no fallback; effective runtime pair is not independently exposed by that title response.
- Implementer: Mr Potato Head, `/root/mr_potato_head`; fresh capacity reported `can_start=3`, then authoritative tier routing selected requested `gpt-6.1-sol` / `medium`, no fallback. One reuse/proof slice, no descendants. Saved-title and effective-runtime evidence pending their report.

## Delivery evidence

Implementation, measured proof, independent review, connected/native gates and final filesystem receipt are pending. This record is a planning checkpoint, not Built or accepted.
