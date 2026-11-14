# FUCQ-414: immutable stock snapshot reuse

Story `DEV-2026-11-13-GC-007`, five points; claimed by `garyscarter-ibm` at `806d481647cb467f01d0cfcf45cf1d172a61c956`. Work is confined to its prepared worker branch, `dev/DEV-2026-11-13-GC-007`. The worker's own scaffolding API independently resolved `gcsp-poc-dev` before work. Claims, Jira, publication, integration, closure and worktree cleanup remain with the dispatcher. No acceptance or deployment is inferred from a checkpoint.

## Contract and readiness

The four original criteria remain fixed: reuse a validated immutable stock snapshot; preserve validation and exact identities, including VIN rejection; preserve decisions, explanations, historical replay and employee isolation with bounded ownership; inspect connected release/offer/history at desktop and narrow widths, including no-match and conflict/replay. The final criterion remains a required gate even though no screen implementation is planned.

The initial recommendation/vehicle-only checkpoint did not reach the real allocation boundary: `tx.list` returns mutable detached copies even though committed memory rows are sealed. Independent review found this unmet original AC1. The dispatcher coordinated file ownership and authorised a narrow extension to `server/gcsp/allocation/index.js`: prepare one detached validated immutable snapshot per release pool entry, preserving malformed fallback. The original four criteria and five-point estimate remain fixed. Source ownership also includes `server/gcsp/recommendation/index.js`, `server/vehicles/index.js` and the isolated new `server/test/gcsp-stock-snapshot-reuse.test.js`. Shared tests/helpers, policy, repository, build/configuration, Angular, Java and identity remain unchanged by this Story. Latest upstream F409 allocation indexing, F412 policy compilation and F423 persistence changes are preserved in the integrated validation inputs.

Follow `AGENTS.md`, `build-rules.md` (especially Demo delivery and scope control), `demo-brief.md`, `experience-quality.md`, `technical-readiness-2026-11-05.md`, `screens/README.md`, `COMPONENTS.md`, the migration kickoff and coordination records. Jira writes resumed on 13 November, within existing authority. Collaborators have equal authority. Child-only HTTP 422 diagnostics do not stop authorised work while the launcher works. Known separate findings FUCQ-400 (Low header overlap) and FUCQ-484 (Medium baseline migration-discovery assertion) are not repairs here. New lower-than-High defects must be linked separately without expanding this Story.

## Stable delivery plan

The product-map plan declares `reuse`, `proof`, `connected`, and `review`. Existing verified component associations are preserved. No slice becomes complete from a worker exit or isolated passing test alone.

Use weak exact-object provenance for validated snapshots, including deeply immutable external data admitted after validation. Repository insertion clones input and seals committed rows, but `tx.list` returns mutable copies. Allocation's `entryOf` now constructs a detached validated snapshot once before the employee loop; malformed input remains on the old evaluator rejection path. Caller-owned mutable input is never frozen or cached. Descriptor-based admission must exclude shallow-frozen or accessor-backed data. Preserve exact stock identity, never substitute by configuration/version. Avoid traversing the admitted graph during provider cloning and final result freezing. All mutable/unrecognised snapshots retain the existing clone/validate path. Employee facts, current-car inputs, briefs and availability remain per-evaluation values. No suitability, policy, employee, stock-array or release cache is introduced.

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

- Lead: Foghorn Leghorn, saved title verified by `set_thread_title`; chat `01a1d70b-7e3d-74c2-ba6d-d52f3181668e`. Requested/selected `gpt-6.1-sol` / `high`, no fallback; the title response alone did not expose runtime settings; saved turn-context verification below now confirms the requested pair.
- Implementer: Mr Potato Head, `/root/mr_potato_head`; fresh capacity reported `can_start=3`, then authoritative tier routing selected requested `gpt-6.1-sol` / `medium`, no fallback. One reuse/proof slice, no descendants. Saved title confirmed; runtime settings had not yet been independently inspected at that stage; see the final saved-context verification below. Final report received and worker observation expired.

## Delivery evidence

The first unchanged baseline attempt could not load `pg` (`ERR_MODULE_NOT_FOUND`, Node v26.5.0). An owned temporary worker `server/node_modules` link to existing installed dependencies resolved the setup without installation or lockfile changes. All three unchanged baselines then passed: recommendation 29/29, stored subject 14/14, VIN allocation 17/17, no skips. The original nine-case focused RED run executed 9 tests: 4 passed, 5 failed, including behavioral identity failures. Its initial charging fixture used unsupported `eq`; that fixture was corrected to the existing `equals` contract. Failed attempts remain in the retained logs.

Evidence and supervisor are under root `.claude/test-runs/fucq414/mr-potato-head/`; baseline receipts independently report scratch removed. The lead additionally read the source diff, affected allocation/repository callers and focused tests. Review requested preservation fixes for hidden immutable fields and function-valued source/rows; those are changes in this implementation, not deferred baseline defects.

The sealed implementation run passed focused 14, employee recommendation 29, stored-subject 14 and vehicle-snapshot 20: **77 passed, zero failures or skips**. An independent lead run passed focused 14 and vehicle-snapshot 20: **34 passed, zero failures or skips**. Earlier VIN allocation 17 and retail compatibility 169 passed before the final conservative clone fallback guards; those earlier results are not represented as final-source validation. Source hashes and exact commands are retained in `mr-potato-head/result.json`, `sealed-receipt.json` and `lead/independent-receipt.json`; the code/test impact map is retained under `.claude/test-runs/impact/fucq414-*`.

Across six evaluations of an already admitted snapshot, measured whole-snapshot clone/validation/freeze/descriptor counts are 0/0/0/0. Three mutable evaluations perform 3/3/3/0. A persisted unbranded immutable input first performs 0/1/1/18, then its next six evaluations perform 0/0/0/0. These are bounded operation counts, not a production latency or load claim. Exact identities, duplicate/order/VIN rejection, complete result equality, stored-subject replay, release/time changes and employee/current-car/brief/availability isolation are covered. Lead review also checked hidden fields, non-enumerable array indices, accessor/exotic containers and stale-context refusal ordering.

Both finalizers report scratch removed. Lead independently verified both scratch paths and the temporary dependency link absent; installed dependencies were preserved with the `pg/package.json` hash unchanged. Maximum child RSS across implementer runs was 390,234,112 bytes and maximum chunk 32.543 seconds. Scratch disk was observed only at finalization (0 bytes), so transient peak disk is unmeasured. Retained outputs are bounded logs, manifests and receipts, not copied dependencies or inputs.

The original implementation/proof checkpoint was superseded by independent review of the real producer boundary. Final producer proof, integrated checks, rendered evidence and acceptance limitations are recorded below. This record does not claim Built or acceptance.


## Review correction and integrated evidence

Speedy Gonzales independently traced allocation `prepare` → real `tx.list` → repository `cloneJson` → mutable `r.facts` → recommendation. The original frozen-input test did not prove this caller; the reviewer correctly treated AC1 as unmet. The new regression uses the actual composed memory repository/runtime, inserts one exact stock row, verifies a real transaction read is mutable, engages two employees, then runs allocation against the shared pool. With the old boundary it executed and failed with **2 validations / 2 whole-source snapshot clones**. The corrected boundary passes with **1 validation / 0 whole-source snapshot clones**, two ineligible employee decisions, no assignments, and the independent mutable transaction read still unfrozen. This is a bounded operation-count result, not a latency claim. The earlier regression setup error (missing preference import) is retained separately and is not the RED proof.

The allocation change canonicalises only a per-release pool entry. It leaves the repository row untouched; catches constructor rejection so the evaluator retains existing malformed/VIN/identity failure behavior; and preserves F409's first-row lookup. Persisted plan/quote reconstruction retains normal mutable validation. No cross-release ownership, employee result cache or suitability cache is added.

Final integration uses an owned small source mirror: worker F414 recommendation, vehicle, allocation and focused test plus every changed upstream server file through `e4b8195bb35b9e1984e1ceba678f8a3b1e1663a7`. Thus F409 indexing, F412 policy compilation and F423 mutation-journal persistence remain present. Prior integration at `4c657fac` passed VIN17, retail169, runtime6, offer-access11 and generated-offer1: **204 pass, 0 fail, 13 skips** (runtime native PostgreSQL1, offer decisions12 without `FUCQ106_MODULE_MAP`). The affected F423 rerun at `0ab125ae` passed **18, failed0, skipped13**. Retained Pugh summaries preserve exact commands/hashes; successful verbose logs were removed after summarisation, so paths in old receipts do not imply those logs remain.

Native database environment variables were unset, localhost5432 had no listener, and no existing compatible hosted service was available. No database or infrastructure was provisioned. Native F423 write-set checks were not run. The reviewed39-module historical FUCQ106 closure was not fabricated or repointed to claim current implementation evidence. These skipped/unrun paths remain acceptance limits.

## Connected rendered evidence

An owned memory host loads the changed Node modules from the integration mirror and uses real HTTP release ticks and decisions. No API response routing, foreign host or historical fixture envelope substitutes for the runtime. It resets its own mechanics scenario, engages Paula with three preference categories, releases stock, renders no-match and positive outcomes, accepts an actual produced offer, repeats the identical command and verifies an altered replay conflicts. Routine tick outcomes are compact counts: the script uses real `allocation.consumeTriggers()` to hydrate persisted allocation detail. Earlier capture failures were harness setup/projection errors and are retained as attempts1–4, not alleged product defects.

The first successful connected run passed **39/39 checks**, retained ten captures at **1440×1000 and375×812**, and had no browser faults. It covers no-match history, presenter release, pending offer, accepted current offer after conflict/replay, and accepted history. The decision/replay/conflict actions are API-driven; the screenshots show the resulting current state, not an interactive conflict-error UI trial. New owned Chrome profile, reduced motion, Tab sampling, no horizontal page overflow and no inline handlers were checked. Safari and a complete keyboard/accessibility audit remain unrun. This memory run cannot prove native database behavior. The successful pre-correction run's supervisor reported `source_unchanged=false` because the focused test was being appended while it ran; its production recommendation/vehicle hashes still match the earlier checkpoint. A final matched-source rerun is required below.

Speedy independently inspected all ten captures against the experience contract and agreed reference: readable shell, grounded no-match explanation, coherent exact vehicle/terms/trade-offs, accepted offer and history. The narrow presenter capture retains the known Low FUCQ-400 header overlap; it is not described as repaired and does not expand this Story. No new blocking or major visual finding was identified.

Evidence root: `.claude/test-runs/fucq414/`. Browser scripts, manifests, attempt results, screenshots and receipts are in `browser/`; actual mutable-boundary RED and final selected checks are in `boundary/`. All scratch/profile processes belong to the launcher. Finalizers precede allocation and stop/join the owned process group, remove scratch, reconcile only the exact profile path and verify installed dependency hashes. Reported RSS is the direct child maximum rather than the entire browser tree. Disk is sampled at the endpoint; transient peak is unmeasured.


## Final source check results

On final production hashes, `boundary/result.json` records **81 pass / 0 fail / 1 native PostgreSQL skip** across these unchanged commands, each with `node --test --test-concurrency=1 server/test/<name>.test.js`:

| Test name | Pass | Skip |
| --- | ---: | ---: |
| gcsp-stock-snapshot-reuse | 15 | 0 |
| gcsp-allocation-index | 3 | 0 |
| gcsp-allocation | 23 | 0 |
| gcsp-allocation-runtime | 6 | 1 |
| gcsp-policy-eligibility-compiled | 5 | 0 |
| gcsp-offer-access-producer | 11 | 0 |
| gcsp-generated-configuration-offer | 1 | 0 |
| gcsp-vin-allocation | 17 | 0 |

The finalizer reports source unchanged, scratch absent, dependency target preserved and owned child stopped. Total96.744 seconds; longest chunk69.990 seconds. The original supervisor receipt carried an old `allocation_boundary_commit=0ab` label from its template: the actual manifest and all eight upstream override hashes were independently checked against `e4b8195b`; the correction is explicit in `boundary/result.json`, not represented as a new execution. Full suite, load and native write-set runs remain unrun.

Final source SHA256:

- recommendation: `89acb070a718195a4eec7f36b6fd9a337e1e96b240bbcdd8d005a190a13a82e4`
- vehicles: `873faa815290de68d9e0af765156a49c5f05e6caf0352769fe17ae018a8c6fbe`
- allocation: `fe5814ad4f243bbc449eb451be1cf03bcb8516249f8747994a3025ff927a0905`
- focused test: `f0fd15f7157772095a8b4d082ff66e23e475dfe35879636dfc9b90fa40ab2b75`

Additional delegated observations: Pugh requested/selected `gpt-6-luna` / `high`, no fallback, completed the bounded integration runs; Speedy Gonzales requested/selected `gpt-6.1-sol` / `high`, no fallback, read-only independent review. Their saved titles were verified. No reviewer test allocation or descendants were requested. Saved turn-context verification below now confirms these settings. All delegated briefs retained the original project scope, resource duties, equal collaborator authority, Jira resumption, false422 handling and demo-delivery rules.


## Final review and handoff

Independent reviewer **Speedy Gonzales: PASS, no blocking or major findings**. The initial major caller-boundary finding is resolved by source checkpoint `1bdd082a52fbc98321eb4b12fb6dbba874c5be9d`; earlier plan and implementation checkpoints are `c12e70a719933fc85d4362cb8cc17f3bc221572d` and `1dd73f784cdda6d06692fe39b22a6350d7ab6c56`. The reviewer independently matched final source/upstream hashes to both final receipts, checked the actual mutable-boundary proof, reviewed all ten captures and confirmed resource teardown. Review completion does not establish full acceptance.

Final matched-source Chrome run again passed **39/39 checks**, ten captures, zero faults, with `source_unchanged=true`. It served the exact copied F414 Node sources plus upstream `e4b8195b` overrides; existing worker legacy presentation assets were linked unchanged. This is the owned local memory variant, not the remote hosted or Angular/Java/OIDC build. Capture paths are under `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq414/browser/captures/` (`no-match-history`, `release`, `pending-offer`, `conflict-replay-offer`, `accepted-history`, each `-1440.png` and `-375.png`). Final browser receipt:30.237 seconds total,29.023-second child,726,614,016-byte direct-child RSS,32,687,319-byte scratch endpoint. Final boundary direct-child RSS was551,518,208 bytes with17,826,937-byte scratch endpoint. Neither receipt establishes whole-browser or transient disk peaks.

`final-resource-audit.json` independently verifies all implementer/lead/Pugh/boundary/browser scratch roots, owned browser profiles and temporary dependency links absent, no owned profile processes, unchanged source/upstream hashes and installed `pg/package.json` SHA256 `b1e53333a3d0c2c47c49a5cb919d221135dc03145df740925b899bc2baacc435`. Retained evidence is about3.3MiB, with no large archive or duplicated dependency/input store. No service, worktree, source data or foreign process was removed.

After the tested e4 boundary, F425 hydration batching merged at `42c40d2f` (cleanup `e5ec78bc`) and F424 was claimed at `826b9819`. The F425 source delta is confined to native PostgreSQL evidence hydration (`postgres.js`), its README and native evidence test. Static inspection finds no route into the exercised memory allocation path, so the scoped memory/Chrome proof is reused without a duplicate run. **The F414+F425 native combination remains untested.** No repository change was made by F414. The product map preserves the latest shared branch's other Story facts, including F439 and the F424 claim; only F414 delivery observations are changed.

Status: **implementation and independent review complete; acceptance evidence pending, not Built**. AC1/AC2 have direct final-source proof; AC3 has scoped decisions/replay/isolation evidence and AC4 has connected desktop/narrow memory evidence. Native PostgreSQL and the restricted FUCQ106 suite, Safari and full keyboard/accessibility verification remain unverified. Known Low FUCQ-400 and Medium FUCQ-484 remain separate backlog defects. No new defect was found in the final implementation. No Jira, claim, publication, shared merge or closure action was taken by this worker; the dispatcher retains them. Worker allocation edits are complete; the dispatcher retains the file reservation until serialized integration and explicit release.

Outstanding collaborator check: the dispatcher should arrange the remaining approved native/connected acceptance evidence (or obtain a specific collaborator decision on its limits) before any Built/Done claim. No infrastructure provisioning or test-map substitution is authorised here.

The first documentation/map commit attempt was refused by shared checkout mutex contention (30-second timeout). The dispatcher completed metadata repair at `90d328dc`, published the F440 claim at `09a13e78`, and resumed this worker for the scoped records commit. The original handoff patch remains retained as diagnostic history. No lock bypass, worker push or shared merge was attempted.

Final metadata reconciliation preserves all **301 other Story rows exactly** from shared `09a13e787e0e5858106a74e92c3ee09e54d8b532`; only F414 delivery observations are applied. Parent resource audit `.claude/fucq414-parent-resource-check-2300.json` independently inspected13 manifests and confirmed8 distinct owned scratch/profile roots absent. Existing requested/selected model and effort evidence is retained; final saved-context verification below adds actual runtime confirmation without a new agent or test allocation. Source hashes still match the final tested e4 integration manifest. This resumed step changes documentation, the own Result and map only; F425 native PostgreSQL and all remaining acceptance limits remain open.


## Published-base sync and saved runtime verification

Published `gcsp-poc-dev` at `09a13e787e0e5858106a74e92c3ee09e54d8b532` is now an ancestor of this worker via merge `1057ccf2b2355edee917c403a09c447865e93ab2`. The adapter/mutex merge resolved only the product-map conflict, retaining F414 observations and all301 other Story rows exactly. F414 recommendation, vehicles, allocation and regression hashes remain identical to the final tested e4 manifest. The published delta's only Node runtime change since e4 is F425's PostgreSQL hydration; its unrun native combination remains explicit. No new tests or source changes were made for the sync. The full staged whitespace check failed on inherited foreign `_dev` files and brand SVG whitespace; F414-owned paths passed. Foreign content was retained unchanged.

Read-only inspection of `~/.codex/sessions/2026/11/13/` matched each session's parent/path metadata and actual saved `turn_context` records. Requested and selected settings now match independently observed saved settings (no fallback):

| Saved title | Session ID | Requested / selected / observed | Saved turn contexts |
| --- | --- | --- | ---: |
| Mr Potato Head | `01a1d70e-32ee-75f2-8e24-047be3d3f163` | `gpt-6.1-sol` / `medium` | 1 |
| Pugh | `01a1d71c-6783-7662-92ea-56b69c0e1f8f` | `gpt-6-luna` / `high` | 2 |
| Speedy Gonzales | `01a1d729-3c69-7fe2-8e8a-ce21fee8da84` | `gpt-6.1-sol` / `high` | 1 |
| Foghorn Leghorn | `01a1d70b-7e3d-74c2-ba6d-d52f3181668e` | `gpt-6.1-sol` / `high` | 6 at inspection |

All three child saved titles were independently re-read through Codex `read_thread` and match the table. `agent-settings-verification.json` retains exact session paths, line numbers, timestamps, turn IDs and record hashes; no settings were altered. This supersedes the earlier limitation that the runtime pair had not been independently exposed.

The final native read reports **FUCQ-414 In Progress**; its own file remains `_dev/in-progress/DEV-2026-11-13-GC-007.md`. The remote Story lease remains held by `garyscarter-ibm` (client `516ca3553159`, taken `2026-11-13T22:32:06Z`, lease commit `5d5f61f9727c874c8fcd7d9748d2c0305ff65e1e`). Native status, file location, lease and all four original AC remain unchanged; this worker only records the current observation. The local Result remains blocked on acceptance evidence: native PostgreSQL/FUCQ106, Safari and full accessibility are open, with no Built/Done transition. Exact read receipts are `final-native-status.json`, `final-lease-read.json` and `base-sync.json`. Parent retains publication, checkpoint integration, lifecycle and allocation reservation/release.


## Scoped experience continuation, 14 November 2026

Parent resumed this existing lead for the remaining connected experience proof after a read-only reassessment. Parent adapter/mutex/lease-guarded fast-forward `551d9079` → `8c045bf2aa3048f0e569c3e127527345410f25a6` is recorded in `.claude/fucq414-parent-preproof-sync-0301.json`; it does not relabel any historical execution. Original AC, claim, five-point scope and pending acceptance remain unchanged. Only this delivery note, the own Story and own product-map row may change. No product source, native suite, deployment, Jira or lifecycle work is included.

Current source/input mapping is retained under shared `.claude/test-runs/fucq414/connected-experience/evidence-inputs.json`. All 22 F415 recorded inputs match except `server/gcsp/repository/postgres.js` (`44d721d7...` → `4c2018ac...`). That is the F421 freshness probe; migration 0010 is also new. Current relevant Node product source, focused F414 test, allocation-runtime/generated-offer tests and legacy visible assets match F421 tested tree `fb31d459ca8fdbff211b122b581274d7eeccbed3`. The recommendation differs from the original F414 checkpoint only through F415 option-evidence configuration preparation; F414 cloneSource and immutable-snapshot boundary remain unchanged. Allocation adds four F424 receipt-scope arguments; entryOf remains unchanged.

| Original AC | Evidence reused at its actual tested boundary |
| --- | --- |
| AC1 reuse | Original F414 actual mutable repository/two-employee RED 2 validations/2 clones → GREEN 1/0; F424 passed unchanged snapshot suite 15/15. F415 option-cache counters are not F414 snapshot counts. |
| AC2 fallback/identity/VIN | Original focused 15 and VIN 17; vehicle constructor and focused test unchanged. |
| AC3 equivalence/history/isolation | F413 native allocation-runtime 7/7; F415 runtime 8/8 including native six-release case and explicitly native generated producer 1/1 at `cb5064ed`; F421 runtime 8/8 and revision/concurrency/rollback 4/4 at `fb31d459`, matching current relevant product source. These cover the later F425/F424/F421 repository combination; no duplicate native suites selected. |
| AC4 connected | Reuse F415 locally hosted native PostgreSQL Chrome 42/42, ten 1440/375 captures at `cb5064ed`, and original F414 reviewed memory captures. F415 predates F421's native freshness probe. Decisions/replay/conflict are API-driven; screenshots prove resulting accepted states, not interactive conflict UI. Safari/private/full keyboard/accessibility were unrun. |

The historical twelve F106 integration cases remain skipped without the exact reviewed supervisor/module map. Its 39-module approval applies to the historical immutable source closure (`docs/gcsp/evidence/fucq106/integration-plan.md`, `docs/gcsp/offer-decisions-contract.md`). It will not be fabricated or repointed; the chosen current-app path does not use it. F413's known F484 failure and known Low F400 remain recorded, separate and unfixed.

Read-only Safari feasibility: Safari.app and /usr/bin/safaridriver exist, but the native automation inventory reports: “The Mac is locked and automatic unlock could not unlock it.” Safari cannot be driven in this environment. No unlock, permission or settings change is requested. Safari and native assistive-technology checks remain unrun; headless Chromium private-context and relevant keyboard/focus/accessibility checks can proceed. This is an environmental limitation, not a passing browser result.

Selected next proof only: real current Node host backed by a wholly owned isolated local PostgreSQL cluster; one headless Chromium private context, sequential desktop 1440×1000 and narrow 375×812 checks of release, no-match, pending offer and accepted/history. Inspect sequential keyboard traversal, accessible roles/names/state, visible/unobscured focus, dialog/focus behaviour where present, relevant live status, and private-context isolation. Reuse the reviewed Chrome visual matrix; retain only new focus/problem evidence. Setup/accept/replay/conflict API actions stay explicitly identified. A failed product assertion stops for diagnosis, without source repair or scope expansion. No complete accessibility, Safari, remote hosted, Angular/Java/OIDC or live BMW acceptance is inferred.

Before any runtime/scratch/profile/cluster/link allocation, the runner must record exact commands/source/input hashes and register the supervisor finalizer under shared `fucq414/connected-experience/`. One worker, ≤2 GiB scratch, ≤10-minute first chunk, 5 GiB emergency reserve, bounded aggregate RSS/logs and measured cleanup; outputs above 256 MiB go directly to `/Users/garycarter/Library/CloudStorage/OneDrive-IBM/_agent-output/vehicle-matcher/fucq414`. Borrowed dependencies/runtime/cache remain intact. This section records selection and reused evidence, not a new executed check or acceptance.
