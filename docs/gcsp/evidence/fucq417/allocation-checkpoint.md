# FUCQ-417 allocation checkpoint

Lead-reviewed on 14 November 2026. The calculation, allocation and bounded evidence slices are complete; integration remains in progress. The Story remains In Progress with all five original acceptance criteria unchecked. Native PostgreSQL and connected presentation gates are outstanding.

## Reviewed source and boundary

- Allocation implementation: `cebac278c5b59acac9fa9a45dc3bc9ea1c37a385`, tree `777039e5bd9d58000b7762065bffe2ae49958049`.
- Parent checkpoint: `0413067da6dea6ddd88f1e4351bcf8d24a508a7e`, after the dispatcher synchronized the current F424 integration source `972312289917b561acde403dbe03b1a809c72694` and guarded-published it. Before this slice, allocator SHA-256 was `b82ac4f6cdbbca13713c6bf03c5cb61ed7b7e864b853a65569a465a0aba7aecf`.
- Branch `dev/DEV-2026-11-13-GC-010`; actual helper base `gcsp-poc-dev`, merge `auto`. Dispatcher retains publication, merge and Jira lifecycle.
- Two changed implementation paths: `server/gcsp/allocation/index.js` and unique `server/test/gcsp-allocation-compact.test.js`. Recommendation/public/gallery/stored-subject code was not changed in this slice.

The entire production diff changes four dispatch lines: import the internal allocation evaluator, default the local helper to compact `evaluate`, dispatch that method, and select detailed `quote` at the existing attempted-quote call. Preparation receives every compact decision; actual attempted claims, including reconstructed successful attempts on a pending resume, receive detailed one-car quotes through the same frozen provider, policy/context, request, clock and source inputs.

The lead read the complete production diff and unique regression file. Independently reversing only those four substitutions reproduces the synchronized allocator byte for byte. Thus F414 `entryOf()`, first-visible raw-stock lookup and independent last-write quote-pool duplicate semantics, every F424 transaction scope/hydration boundary, global contender comparator, receipt writes, decline rules, replay, rollback, CAS and authoritative occupancy paths remain unchanged. No business/scoring/fleet-policy change, top-K, cache or public service expansion was added.

Review result: PASS at this local calculation/allocation boundary; no substantive finding or new defect. No native database, connected rendering or whole-Story acceptance is inferred.

## Semantic and operation evidence

The focused regression imports the actual allocator source twice. Its reference changes only the internal evaluator dispatch back to the former gallery service and resolves existing relative imports to their file URLs. It does not copy allocation/transaction rules or provide a second business implementation.

- For both canonical global tie-break policies, three employees and eight cars produce equal complete outcomes, evaluation receipts, assignment quotes and claim inputs, with reversed source ordering in the reference fixture. All 24 employee/car pairs remain represented.
- Four successive conflict/stale-version failures still reach the fifth candidate, beyond the gallery display cap; all three employees receive assignments and all six candidates remain evaluated.
- A pending run with one saved success and one uncertain attempt resumes after live employee facts, briefs and snapshots change. Detailed quotes retain the old source/brief/policy/clock pins, frozen policy `asOf`, and the uncertain operation ID/input. The live clock is not read. Completed replay performs no extra claim.
- Historical embedded-quote and per-slice `quotes` receipts remain usable without frozen quote-input reconstruction.
- Mixed unknown/ineligible results and no-match outcomes preserve the gallery-backed evaluation receipts and response shape.

On the same 24 employee/car pairs, under each policy:

| Actual allocator path | Terms constructed | Gallery sorts | Global contender sorts |
|---|---:|---:|---:|
| Former gallery dispatch | 27 | 12 | 1 |
| Compact preparation, detailed attempted quotes | 3 | 0 | 1 |

The three detailed terms graphs correspond to the three attempted candidates. The 24 unused planning terms graphs disappear. The counter observes unique frozen EmployeeTerms roots whose stack includes `createEmployeeTerms`, avoiding repository clone/freezing counts. Sort counters distinguish gallery decision arrays from global contender arrays. Temporary wrappers restore in `finally`; commands run with test concurrency 1. These are bounded synthetic operation counts, not database query, latency, load or production-memory measurements.

## Validation and exact identity

All commands use `node --test --test-concurrency=1`:

| Test module | Result | Evidence basis |
|---|---|---|
| `server/test/gcsp-allocation-compact.test.js` | 6 passed, 0 failed, 0 skipped | New actual allocator comparison/fallback/frozen-resume/legacy/mixed cases |
| `server/test/gcsp-allocation.test.js` | 23 passed, 0 failed, 0 skipped | Original Story validate command, including detailed quote/feedback/duplicate/replay cases |
| `server/test/gcsp-allocation-runtime.test.js` | 7 passed, 0 failed, 1 skipped | Original validate command; includes F424 declared-state transaction proof |
| `server/test/gcsp-allocation-index.test.js` | 3 passed, 0 failed, 0 skipped | F414 exact lookup and operation regressions |

New allocation results total **39 passed, 0 failed, 1 skipped**. No initial command/test failure occurred in this slice. The native PostgreSQL case was skipped because `GCSP_DATABASE_URL` is unset; no credentials were printed or database connection attempted by that case. Its skipped result remains an unmet original native acceptance obligation.

The unchanged calculation evidence is reused from [the reviewed calculation checkpoint](calculation-checkpoint.md): compact 22, employee recommendation 29, stored-subject 14; 65 passed, 0 failed, 0 skipped. Recommendation/calculation pins remain unchanged. No matching calculation test was repeated. The employee and stored-subject commands plus the allocation and runtime commands cover all four authored validate commands, with the native case explicitly skipped. Earlier calculation import/fixture failures remain documented in that earlier checkpoint.

The four allocation commands ran before the code commit, with worktree HEAD `0413067da6dea6ddd88f1e4351bcf8d24a508a7e`, committed tree `dfdeaf593b9b942283e5aaa4f48bba58105b13ec`, and observed integration-base ref `972312289917b561acde403dbe03b1a809c72694`. Those HEAD/tree values exclude the then-uncommitted changes. All 14 captured input hashes below match the reviewed committed files; the lead independently checked every hash in each of four final receipts. Runtime is Node `v26.5.0`.

| Captured input | SHA-256 |
|---|---|
| `.claude/scaffolding.json` | `bc89c2a95d4be2612eb069f5a0f3e7e9ffc7bd384c8085374598e0caff00d63d` |
| `server/gcsp/allocation/evaluation-rows.js` | `c898ebec1d9271802804e84b26cb87885f19b7b3a4a379c74485d100973b3f57` |
| `server/gcsp/allocation/index.js` | `93031b7774866ab29b7c2453d135b951df9c8c83265bb44c69da4edd28b7757c` |
| `server/gcsp/policy/seed-v1.json` | `ce6ac503ab8f3a97538c2663227ca3cf117994396c59ed55d1db386a44ccfe12` |
| `server/gcsp/recommendation/index.js` | `870e4b6faf26f7d87b73eb2f359ed626ead2594647effd4ff9a448cbbc065902` |
| `server/scenarios/employee/index.js` | `ba6f32e11244d9ca377b190d70937501cb8bca1f5eb4767973539fa9347cfb20` |
| `server/test/gcsp-allocation-compact.test.js` | `f48fc6ed206b21fbded34b93b5ae49799c73c5597b734e5eb954494020e8e84e` |
| `server/test/gcsp-allocation-index.test.js` | `cefee6785ca2d3a9111673f360a47162a0b0373803e4e53d168e3bd3e4065154` |
| `server/test/gcsp-allocation-runtime.test.js` | `98af37411bbc4a768b1a8000ce4811aad10497129ca397ce4671eeb3f9ec1c74` |
| `server/test/gcsp-allocation.test.js` | `60cd8c14ffb15b8277f84e0556d2ef7237576b4713dc26f6047f60c3c7bc46f9` |
| `server/test/helpers/employee-recommendation.js` | `23e5e9529981671b4e77f08f0dcdfcc7d76a971426c10750e5a8b4fb6e7133df` |
| `server/test/helpers/gcsp-allocation.js` | `f5c942c36689e551ceef06750780f4040f00f7b7288444ff9df05d0808c6d9b6` |
| `server/test/helpers/strict-scope-repository.js` | `b75e3cfec5ba7f53056225dcb3c7d7a997a06466d930a5c6a132b299395b450f` |
| `server/vehicles/index.js` | `873faa815290de68d9e0af765156a49c5f05e6caf0352769fe17ae018a8c6fbe` |

## Resources, agents and retained receipts

Receipt paths below are relative to shared checkout `/Users/garycarter/Code/GitHub/vehicle-matcher`, outside this worktree. The pre-registered `.claude/test-runs/fucq417/ownership-manifest.json` records the allocation resume and four allocations. `.claude/test-runs/fucq417/grub-allocation/` retains the supervisor/finalizer, four ownership records, bounded logs and `summary.json`. Final per-command receipts:

- `gcsp-allocation-compact-1794644998965186000.json`
- `gcsp-allocation-1794645031144864000.json`
- `gcsp-allocation-runtime-1794645044547396000.json`
- `gcsp-allocation-index-1794645133155034000.json`

Independent lead audit `.claude/test-runs/fucq417/allocation-lead-audit.json` verifies final input identities, all four process groups absent (90984, 91380, 91561, 93287), owned scratch `.claude/test-runs/fucq417/scratch/grub-allocation` absent, and current borrowed `pg` path/device/inode/package+entry hashes equal before/after identities. No lead test runtime was allocated. Prior calculation receipts remain intact.

Reported peak scratch is 4096 bytes and peak RSS 466190336 bytes; longest command was the runtime module at about 78 seconds. One worker remained within 2 GiB scratch/600 second chunks, with the registered finalizer, host-budget reserve and OneDrive large-output contract. No large output/archive or dependency installation was required. The preinstalled root `server/node_modules/pg` was borrowed read-only through an import hook in owned scratch; this is dependency resolution, not native PostgreSQL evidence. Existing shared toolchains/dependency links were preserved.

Same Grub, no new spawn/fallback/descendant: requested/selected/effective `gpt-6.1-sol` / `medium`. Saved title and resumed turn model/effort/parentage were independently verified; chat `01a1d917-4227-7021-8670-dbd76c962e65`, parent Wyldstyle chat `01a1d910-a6ba-7d01-9219-8c1e0445b4b8`. Fresh capacity before resume: can_start 3, running 4, free 8.0 GB at 08:27:32Z. Grub is completed/inactive. Wyldstyle lead remains requested/selected/effective Sol/high. Checkpoint map claims expire while awaiting guarded publication.

## Original gates still open

- Run native PostgreSQL on the relevant allocation/runtime path; the selected runtime case was skipped, not passed. Fixture-backed and strict declared-state memory proof do not replace it.
- Inspect connected release/offer/history outcomes at desktop and narrow widths, including no-match and conflict/replay states, under `docs/gcsp/experience-quality.md`, `docs/gcsp/screens/README.md`, `COMPONENTS.md` and frozen baseline `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`. These checks are unrun. No new UI source or presentation shape changed in this isolated slice, so no new screenshot is claimed here.
- Resolve actionable findings at their required boundary before reporting whole-Story completion. All five original AC remain unchecked; no Built/In Review/Done result is asserted by this checkpoint.

Jira writes are resumed within task scope; human collaborators have equal authority; fixed claimed AC, demo delivery/scope control and defect severity rules in `docs/gcsp/build-rules.md` remain binding. The lead stops HEAD mutation after the own-metadata checkpoint for dispatcher guarded publication; no push, merge or deployment was performed by the lead or implementer.
