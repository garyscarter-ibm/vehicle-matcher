# FUCQ-414: immutable stock snapshot reuse

Story `DEV-2026-11-13-GC-007`, five points; claimed by `garyscarter-ibm` at `806d481647cb467f01d0cfcf45cf1d172a61c956`. Work is confined to its prepared worker branch, `dev/DEV-2026-11-13-GC-007`. The worker's own scaffolding API independently resolved `gcsp-poc-dev` before work. Claims, Jira, publication, integration, closure and worktree cleanup remain with the dispatcher. No acceptance or deployment is inferred from a checkpoint.

## Contract and readiness

The four original native criteria remain fixed: reuse a validated immutable stock snapshot; preserve validation and exact identities, including VIN rejection; preserve decisions, explanations, historical replay and employee isolation with bounded ownership; inspect connected release/offer/history at desktop and narrow widths, including no-match and conflict/replay. The final criterion remains a required gate even though no screen implementation is planned.

The existing recommendation `validateSource` → `createVehicleSnapshot` boundary and immutable vehicle constructors permit independent implementation. No allocation, policy, Angular, Java or repository interface change is required. Source ownership is limited to `server/gcsp/recommendation/index.js`, `server/vehicles/index.js` and new isolated `server/test/gcsp-stock-snapshot-reuse.test.js`. Shared test helpers and existing tests remain unchanged. Other Story owners retain allocation, policy, build/configuration, Angular, Java, identity and persistence files.

Follow `AGENTS.md`, `build-rules.md` (especially Demo delivery and scope control), `demo-brief.md`, `experience-quality.md`, `technical-readiness-2026-11-05.md`, `screens/README.md`, `COMPONENTS.md`, the migration kickoff and coordination records. Jira writes resumed on 13 November, within existing authority. Collaborators have equal authority. Child-only HTTP 422 diagnostics do not stop authorised work while the launcher works. Known separate findings FUCQ-400 (Low header overlap) and FUCQ-484 (Medium baseline migration-discovery assertion) are not repairs here. New lower-than-High defects must be linked separately without expanding this Story.

## Stable delivery plan

The product-map plan declares `reuse`, `proof`, `connected`, and `review`. Existing verified component associations are preserved. No slice becomes complete from a worker exit or isolated passing test alone.

Use weak exact-object provenance for validated snapshots, including deeply immutable external data admitted after validation. Repository insertion clones input and seals committed rows; allocation's `entryOf` passes `r.facts` from `tx.list`, so constructor outputs alone would miss actual shared repository inputs. Descriptor-based admission must exclude shallow-frozen or accessor-backed data. Preserve exact stock identity, never substitute by configuration/version. Avoid traversing the admitted graph during provider cloning and final result freezing. All mutable/unrecognised snapshots retain the existing clone/validate path. Employee facts, current-car inputs, briefs and availability remain per-evaluation values. No suitability, policy, employee, stock-array or release cache is introduced.

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
- Implementer: Mr Potato Head, `/root/mr_potato_head`; fresh capacity reported `can_start=3`, then authoritative tier routing selected requested `gpt-6.1-sol` / `medium`, no fallback. One reuse/proof slice, no descendants. Saved title confirmed; effective runtime settings are not independently exposed. Final report received and worker observation expired.

## Delivery evidence

The first unchanged baseline attempt could not load `pg` (`ERR_MODULE_NOT_FOUND`, Node v26.5.0). An owned temporary worker `server/node_modules` link to existing installed dependencies resolved the setup without installation or lockfile changes. All three unchanged baselines then passed: recommendation 29/29, stored subject 14/14, VIN allocation 17/17, no skips. The original nine-case focused RED run executed 9 tests: 4 passed, 5 failed, including behavioral identity failures. Its initial charging fixture used unsupported `eq`; that fixture was corrected to the existing `equals` contract. Failed attempts remain in the retained logs.

Evidence and supervisor are under root `.claude/test-runs/fucq414/mr-potato-head/`; baseline receipts independently report scratch removed. The lead additionally read the source diff, affected allocation/repository callers and focused tests. Review requested preservation fixes for hidden immutable fields and function-valued source/rows; those are changes in this implementation, not deferred baseline defects.

The sealed implementation run passed focused 14, employee recommendation 29, stored-subject 14 and vehicle-snapshot 20: **77 passed, zero failures or skips**. An independent lead run passed focused 14 and vehicle-snapshot 20: **34 passed, zero failures or skips**. Earlier VIN allocation 17 and retail compatibility 169 passed before the final conservative clone fallback guards; those earlier results are not represented as final-source validation. Source hashes and exact commands are retained in `mr-potato-head/result.json`, `sealed-receipt.json` and `lead/independent-receipt.json`; the code/test impact map is retained under `.claude/test-runs/impact/fucq414-*`.

Across six evaluations of an already admitted snapshot, measured whole-snapshot clone/validation/freeze/descriptor counts are 0/0/0/0. Three mutable evaluations perform 3/3/3/0. A persisted unbranded immutable input first performs 0/1/1/18, then its next six evaluations perform 0/0/0/0. These are bounded operation counts, not a production latency or load claim. Exact identities, duplicate/order/VIN rejection, complete result equality, stored-subject replay, release/time changes and employee/current-car/brief/availability isolation are covered. Lead review also checked hidden fields, non-enumerable array indices, accessor/exotic containers and stale-context refusal ordering.

Both finalizers report scratch removed. Lead independently verified both scratch paths and the temporary dependency link absent; installed dependencies were preserved with the `pg/package.json` hash unchanged. Maximum child RSS across implementer runs was 390,234,112 bytes and maximum chunk 32.543 seconds. Scratch disk was observed only at finalization (0 bytes), so transient peak disk is unmeasured. Retained outputs are bounded logs, manifests and receipts, not copied dependencies or inputs.

The implementation/proof slices are complete as a checkpoint. Independent final review and connected/native gates remain pending. This record does not claim Built or acceptance.
