# FUCQ-415 equipment evidence reuse

Story `DEV-2026-11-13-GC-008`, five points, claimed at `e2a724ab74a95465561a013193d6695c81f9005a` on `dev/DEV-2026-11-13-GC-008`. Integration base is `gcsp-poc-dev`. Mary-Sue Walton leads this increment. Original native Node acceptance remains fixed; Java parity does not replace it.

## Readiness and plan

`scorePreferences` in `server/scenarios/employee/index.js` gates option facts through `confirmedFact`, then calls `scoreOptionEvidence`. That gate uses known status, non-null value, source/version/observation provenance and configured assurance. Equipment derivation consumes selection kind, complete, codes and activeCodes, equipment policy and preference definitions. It does not consume configuration ID or employee preference values. Recommendation uses detached assumption reads from PolicyService, so immutable preparation must happen once at that owned boundary without freezing externally supplied mutable objects.

Stable slices:

1. `admission`: admit immutable policy/preferences, preserve mutable/malformed behavior, and use the complete relevant signature.
2. `reuse`: bounded evidence reuse, detached results, semantic-equivalence and production operation evidence including eviction/reset/recomputation.
3. `connected`: actual release/offer/history integration and independent rendered review at desktop/narrow widths, no-match and conflict/replay; record native PostgreSQL and browser/environment limitations honestly.

Components already associate FUCQ-415 with `recommendation` and `catalogue`; no component boundary changes. No UI/design work is planned. Visual references remain `docs/gcsp/screens/README.md`, `COMPONENTS.md` and frozen body behavior `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`, under `docs/gcsp/experience-quality.md`. New screenshots are unnecessary for isolated computation; connected acceptance is still required.

## Validation and resource ownership

Selected checks are `node --test --test-concurrency=1 server/test/fucq415-option-evidence.test.js`, `node --test --test-concurrency=1 server/test/employee-option-preferences.test.js` and `node --test --test-concurrency=1 server/test/gcsp-case-options.test.js`. The focused regression will compare complete evidence and scoring against the uncached mutable path, exercise production recommendation reuse and certainty changes, malformed/mutable policies, colliding versions, bounded eviction/reset and detached outputs. No full suite is justified for this internal boundary. Native PostgreSQL and actual connected browser evidence are separate gates.

Resource manifests and retained bounded logs live under `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq415`. Each allocation owns its scratch/finalizer and propagates TMPDIR/TMP/TEMP. Start with one worker, at most 2 GiB scratch and ten minutes per chunk; preserve 5 GiB emergency reserve and adapt below 30 GiB. Outputs over 256 MiB go directly to `/Users/garycarter/Library/CloudStorage/OneDrive-IBM/_agent-output/vehicle-matcher/fucq415`. Stop/join owned processes, remove only owned disposable scratch and verify absence. Native clusters require a coordinated serial window; no running app or foreign cluster is touched.

## Delivery state

Implementation `906e008c8619c02bed3fae2fc167c15486c2b781` changes only the two planned production files and `server/test/fucq415-option-evidence.test.js`. The caller's certainty/provenance gate still executes for every score. Recursively frozen JSON policy and preference graphs use weak identity lookup and eight bounded content admissions; changed content sharing a version gets a distinct admission. Mutable, shallow-frozen, accessor, custom-prototype, non-JSON and primitive preference inputs retain uncached validation. Derived evidence uses a 256-entry LRU keyed by admission, kind, completeness, sorted unique codes and activeCodes. Results are detached on both misses and hits. Recommendation prepares only its owned detached policy assumption once per evaluation. Employee preferences, whole recommendations and configuration IDs are not cache keys or cached outcomes.

The lead reviewed the complete production/test diff and actual callers. Cool Cat independently returned **PASS — no blocking or major issues found**, reviewing source, caller certainty, selected tests, native/proof scripts, cleanup and all ten captures; they verified 22 source hashes and ten image hashes without rerunning tests or allocating resources. Native/file status remains In Progress and the lease remains held; no Built/Done transition or acceptance exception is requested. Known Low FUCQ-400 and separate Medium FUCQ-484/487/488 remain unresolved and outside this Story. Jira writes resumed 13 November; collaborators have equal authority. Child-only HTTP 422 does not stop authorised work while the launcher remains available.

## Selected evidence and exact source

The latest matching selected Node files total **92 tests, 92 pass, zero fail or skip**. These are scoped checks, not a full-suite stamp or latency benchmark:

| Selected command (`node --test --test-concurrency=1`) | Result | Source |
| --- | --- | --- |
| `server/test/fucq415-option-evidence.test.js` | 11/11 | `906e008c`, repeated in integrated 83-test proof |
| `server/test/employee-option-preferences.test.js` | 9/9 | Same |
| `server/test/gcsp-case-options.test.js` | 63/63 | Same |
| `server/test/gcsp-allocation-runtime.test.js` | 8/8, including actual native PostgreSQL receipt persistence | `cb5064ed3090ca61adf90c5ea1fb5accfb3fc250` |
| `server/test/gcsp-generated-configuration-offer.test.js` with `GCSP_FUCQ393_NATIVE_PRODUCER=1` | 1/1, actual native generated stock → recommendation → quote → offer | `cb5064ed` |

The integrated 83-test targeted proof ran at clean `58182d4cb267cc78535cc27b540fe6e7ab21dab2`, pre-run producer `0ad0ded87f6c914cec869555304e1a48ddf45387`, with its named base resolving to `a2e786551e0075cbb4d6482a972373db38da49e8`. It is retained at `henery-hawk/targeted-ed43b284285f8e53d0e39867c95a0a5194845677393010f20690b04d152c6cbe-default-1794618553474518000.json` under the shared evidence root above. The later guarded sync used producer `a593e4fbd98ab2b1141c876d9aadb470717fa968` and yielded worker `cb5064ed`. All 22 recorded Node/test/helper hashes matched; producer movement was Java/shared metadata, so the 83 successful checks were retained without rerunning. During native validation the named base subsequently resolved to `b1be1d59c6d8416ac61cc3807e5311292293bdb6`; this is an observed ref movement, not the tested worker identity. Parent sync/resource audits are `.claude/fucq415-parent-sync-0114.json`, `.claude/fucq415-parent-resource-henery-0114.json` and `.claude/fucq415-parent-resource-native-browser-0125.json` in the root checkout.

Focused regressions compare complete immutable evidence and scoring with mutable uncached results, including replacement/bundles/enums, completeness, unknown facts, changed assurance, same configuration ID with different selections, different employees, same-version content changes, malformed/mutable inputs, detachment, admission/result eviction and reset. Actual counters prove bounded derivation reuse; no elapsed-time improvement is asserted.

## Connected rendering and remaining acceptance

The exact worker source ran in an owned hosted PostgreSQL app against an isolated native PostgreSQL cluster, Unix socket only on port 65415. The proof exercised scenario reset, brief draft/confirm, release tick, allocation, pending offer, API acceptance, identical replay and a changed-input 409/conflict. Chrome `157.0.8103.51`, headless with a fresh owned profile and reduced motion, passed **42/42 checks**, with no page/console/blocked-external faults. Cache diagnostics ended at **one validation, 26 derivations and 19 hits**, from zeroed counters. These are actual observations, not synthetic hit expectations.

The lead viewed all ten `henery-hawk/browser/captures/{no-match-history,release,pending-offer,conflict-replay-offer,accepted-history}-{1440,375}.png` files. Captures use 1440×1000 and 375×812 viewports. Offer costs, specification, hold/decision actions, accepted state and search history remain readable; narrow employee surfaces wrap without horizontal page overflow. The narrow presenter header overlap remains visible and is the existing separately tracked Low FUCQ-400. The accepted screen after the conflict proves retained state, not a separately rendered conflict message. Setup and decision commands were API-driven; Tab focus was sampled. Closed image-viewer interactions and every lazy image were not verified.

Original AC1–3 have lead and independent source/selected-test review evidence. AC4 remains partial with the recorded experience variants: actual Safari/private browsing, full keyboard/accessibility, deployed hosted-dev and hosted Angular/Java/OIDC are unrun. Original acceptance wording and scope are unchanged; desktop/narrow local PostgreSQL evidence does not establish those variants or collaborator acceptance. Cool Cat explicitly made no Built/Done recommendation.

## Failures, checkpoints and cleanup

The mechanic first lacked installed `pg`, then encountered invalid test fixtures (frozen snapshot mutation, invalid assurance and known facts paired with unknown assurance); it stopped at its repair limit with 8/9 focused tests. The implementer initially omitted unit `s` from an unknown acceleration fixture, corrected it, then passed 11/11 and the affected consumers. These attempts remain in the receipts and are not represented as product failures remaining at handoff.

The original integrated application test exited **0** with 83/83 passing. Its external supervisor hung because `select` reported closed stdout as readable and `os.read` returned `b''` without ending the drain loop. Owned supervisor PID 20868 received SIGTERM and the registered finalizer exited 0; native/browser work had not started at that checkpoint. The runner now breaks on EOF; a child-closes-output probe exited 0 in 0.478 seconds. Only incomplete native/browser work resumed. `henery-hawk/resumed-resource-summary.json` is the current complete receipt; the overwritten historical `resource-summary.json` is explicitly labelled reconstructed, **not byte-identical to its original**. The original targeted proof and logs are unchanged; the independent parent audit preserves the old checkpoint.

Native commands took 87.208 and 13.461 seconds; browser proof took 32.852 seconds. Sampled peak scratch was **138,324,473 bytes**, sampled owned process-group plus exact PostgreSQL RSS **683,687,936 bytes**. Finalizer and `pg_ctl stop` exited 0; **138,032,776 bytes** of owned scratch were removed. Scratch/profile, owned browser/PG processes and test schemas were absent after cleanup. The PostgreSQL/browser local working-data exception was bounded and removed; no ≥256 MiB output or archive was created. Earlier integrated-run peak RAM was unmeasured after the supervisor hang; its reported zero is not a measurement.

After all checks and review, the lead verified and removed only the owned dependency symlink, inode 186330083, pointing to root `server/node_modules`. The link is absent and the installed target is preserved; target `pg/package.json` SHA-256 remains `b1e53333a3d0c2c47c49a5cb919d221135dc03145df740925b899bc2baacc435`. Receipt: `lead-final-resource-receipt.json` under the shared evidence root. No owned test resources remain.

Agent settings, requested/selected with no fallback: Mary-Sue Walton lead `gpt-6.1-sol/high`; Tweety mechanic `gpt-6-luna/high`; Doc Hudson implementer `gpt-6.1-sol/medium`; Henery Hawk runner `gpt-6-luna/high`; Cool Cat independent reviewer `gpt-6.1-sol/high`. All titles and effective saved turn contexts were independently verified; reviewer's saved turn context is line 8, chat `01a1d7ac-d407-78d0-8bf1-e65fa20cefd7`. Children ran sequentially, without descendants.
