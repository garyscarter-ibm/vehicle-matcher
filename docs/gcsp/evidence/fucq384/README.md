# FUCQ-384 definition checkpoint — 11 November 2026

Status: **blocked/checkpoint**, pending independent review and original AC4 integration. This checkpoint implements the supported definition seed, keyed resolver and additive vehicle-evidence adapter contract. It does not establish Story acceptance or completion.

## Source identity and coverage

`_tools/seed_configuration_definitions.py` reproduces `configuration-definitions.v1.json` from retained BMW UK `options.json` reports and the active local `gcsp-demo-fleet` population. No upstream collection or service call is used. The seed retains exact source URL/context, market, model, generation/AG applicability, dates, retained file paths and hashes. Conflicting or incompatible definitions remain unknown.

| Identity | Value |
| --- | --- |
| Definition version | `configuration-definitions-2026-11-11.v1` |
| Seed SHA-256 | `7327f922585d0a5eabe5dca00363bc2f2e7ed29816c9c91bb17a304beddab939` |
| Corpus manifest digest | `7c9cc707ab44b36f9cb5eb64b54170b25d914d5ee7e31722384c737612c45a9c` |
| Configuration JSONL SHA-256 | `8e855b0d9f94c7deae99243a94145eb3f0628ae6d1243c8b10e023c62a8e05f3` |
| Retained reports / exact variants | 54 / 40 |
| Fully labelled active configurations | 239 / 240 |
| Resolved selected codes | 11,900 / 11,947 |

The retained G61/i5 configuration has no matching options-language report and accounts for all 47 codes unresolved by this seed; their complete list is retained in the seed's `population.unresolvedCodes`. Its existing snapshot definitions remain available separately. Retained sources provide no evidenced swatch colours, so swatches remain explicitly unknown. Labels describe selected catalogue equipment, with verified physical-car fitment unknown. Availability, unselected equipment and quantities are not inferred.

## Integration APIs

`createConfigurationDefinitionIndex(seed, { digest })` compiles exact-context and selected-code maps once, exposing `resolve(record)`, `identity()`, `coverage()` and `diagnostics()`. `loadConfigurationDefinitionIndex()` caches the bounded, hash-pinned local seed load. Diagnostics expose one index build and resolution counts; request-time resolution does not scan the catalogue.

`withConfigurationDefinitions(registry, { index = loadConfigurationDefinitionIndex() } = {})` decorates async `getConfiguration(id)` and `getVin(id)` using detached results, preserves the registry's other APIs and adds async `definitionStatus()`. It retains original selected/available/fitted evidence, joins only selected definitions and attaches `definitionResolution` metadata. The local lookup composes `withConfigurationDefinitions(withDisplayImages(registry))`. Seed-load failure remains explicit as `definition-seed-unavailable`.

`selectedConfigurationDefinitionFacts(details)` accepts the existing vehicle-evidence DTO and returns supported canonical `colour`, `interior` and `options` facts. Seed-resolved labels carry the definition version/digest; retained definitions that the seed did not resolve keep their original snapshot version. Each fact retains its source reference, observed date and `model-reference` assurance. Missing labels have a concise count when there are readable options. No parallel snapshot namespace is introduced.

Mixed option arrays keep the canonical scalar provenance fields: `sourceRef` is JSON containing each readable option's `{code, sourceRef, observedAt, version}` in value order; `version` is the common version or a JSON list of contributing versions; `observedAt` is the latest contributing observation, with every individual date retained in the reference. Homogeneous arrays retain the ordinary single-source provenance. Values and the canonical snapshot schema are unchanged.

For future authorised producer integration, decorate the registry before `factsForConfiguration`. The current `stock-generator.ensureExtra` wraps extras in generator provenance; it must deliberately preserve these canonical attributed facts. FUCQ-382 must also reconcile `facts.syntheticIdentity` and the full exact snapshot before quote pinning. Those producer repairs are not included here.

## Scoped evidence and remaining acceptance

- 89 checks passed, zero failed/skipped across configuration definitions, indexed corpus, evidence lookup, vehicle details v2, strict adapter contract and BuddyHold quote compatibility (5.1 seconds).
- A subsequently added actual retained-registry/local-lookup integration check passed, zero failed/skipped (13.2 seconds). Implementation code was unchanged between these runs. Total: **90 scoped checks passed**; this is not a full-suite result.
- The BuddyHold test uses a real retained source record, the definition helper, fixture stock and the actual newly pinned quote path. A changed dictionary version leaves that persisted quote unchanged. **Its producer is a fixture**; it does not prove actual generated-stock integration.
- Earlier attempts recorded seven passes plus one module-load failure caused by missing `pg` resolution in the worktree, then 34 passes/two alternate-provider equality fixture failures caused by optional local resolution metadata. Existing dependency symlinks and narrowly adjusted comparisons resolved those causes. These failures remain in the run evidence.

Original AC4's actual generated-stock → recommendation → newly pinned quote path remains unrun under the explicit diagnosis-only/no-pickup FUCQ-382 hold. Actual offer/current-car desktop and narrow rendered comparison, long/unknown-label critique and independent review remain outstanding. No UI completion, live producer integration, full acceptance, historical quote rewrite, policy/ranking change or completion of FUCQ-337/FUCQ-60 is claimed.

The affected selector had no plugin and proposed a full-suite fallback. That broad fallback was not run: these explicit regression and caller-boundary modules cover this bounded seed/adapter checkpoint. Per-test coverage contexts are unavailable in the current Node harness; the impact map records reviewed ownership and unknown boundaries instead of treating unobserved coverage as irrelevant.

Run metadata and resource receipt: `/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-fucq380-20261111/f384/`. Supervised test evidence and ownership manifests are under shared `.claude/test-runs/`; exact filenames are recorded in `validation-summary.json` and `resource-receipt.json`. All four run-owned test scratch roots and both temporary dependency symlinks were removed and their absence verified. Installed dependencies and retained corpus inputs were preserved; no large output, browser profile or database working-set exception was used.

## Independent-review provenance correction

Barnyard Dawg's P2 finding exposed an unmet original provenance/version criterion in this unmerged checkpoint. The helper used the active seed version whenever resolution metadata existed, including labels preserved from the source snapshot. The active retained G61/i5 record has six original definitions, no options-language source and zero seed resolutions across 47 selected codes. Its readable Alpine White, Veganza and Lumbar Support facts were therefore incorrectly stamped with the seed identity.

The correction uses the code-level resolution outcome to distinguish joined labels from retained labels. Retained facts preserve `bmw-gb-i5-2026-11-01.v1`; mixed arrays explicitly retain all contributing origins as described above. No corpus, seed, producer, identity, policy or UI value change is included.

Two new regressions failed against the unchanged helper for the reported attribution error (zero passes, two failures, zero skipped; 0.5 seconds). After correction, **95 scoped checks passed, zero failed/skipped**, across configuration definitions, strict vehicle-details adapter, BuddyHold and canonical vehicle snapshots (5.6 seconds). The tests include the actual retained G61/i5 record, a clearly controlled one-code mixed join and canonical snapshot retention. The earlier 90 checks remain evidence for the preceding checkpoint; they are not combined into a new full-suite claim.

Revision metadata, exact commands/code identity, red/green checkpoints, impact map and cleanup receipt are under `/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-fucq380-20261111/f384/revision1/`. Both revision-owned scratch roots and temporary dependency links were removed and verified absent. During this revision the collaborator separately authorised FUCQ-382; the parent owns that dispatch. Original AC4 still awaits actual FUCQ-382 producer proof, integrated comparison review and acceptance; status stays **blocked/checkpoint**.
