# Retained canonical policy input for offline baselines

6 November 2026. Authored correction for dispatcher delta review. No new execution
has occurred since the stopped canonical320 run; no generator replay is proposed.

The captured training version is scoped to the original canonical memory run.
Creating another run against that same MemoryPolicyProvider correctly starts from
the original seed. Copying another run's authority or rewriting its policy-read
scope would violate the interface. Offline training instead receives explicit,
unchanged immutable policy versions through the existing FilePolicyProvider.

The committed `choice-training-policy.json` is the exact actual published v4
snapshot already retained by the granted run. The accompanying
`choice-training-policy-base.json` is byte-identical to canonical checkpoint
`0d3a0aa2fcee5d26ad33e587578cff7cce169090:server/gcsp/policy/seed-v1.json`:
493,879 bytes, SHA-256
`c58fcd9054fa32cded07c4ee742b39d196f94aa15c8d0fbf7752874954df8a31`.
Both versions retain their actual timestamps, values and provenance. No version,
effective date, row, hash or policy provider implementation is changed. These are
the two actual versions needed for this offline bootstrap; missing intermediate
adoption versions are not reconstructed or claimed as retained snapshots.

The original canonical learning/choice adoption, dated publication, same-cookie
activation and history/price checks retain their executed evidence. The next
phase consumes their actual dataset and published snapshot as immutable offline
inputs. It does not claim a new canonical adoption or model activation result.

`prepareActualChoiceBaselines` now reads the pinned training snapshot before
allocating its isolated repository. Its actual runtime may start at the canonical
scenario's 5 November instant. With the explicit historical source available,
actual identity can issue the presenter at that time. The adapter advances actual
DemoClock to the requested training read instant before switching to Greg, allowing
the existing identity activation operation to select the dated training version.
It rejects a clock already beyond that instant; it never rewinds or edits state.
It requires the isolated-run policy snapshot to have exactly the same digest as
the original training snapshot, and requires an empty initial brief population.
Only the latest earlier-training brief per employee is then inserted. Existing
version, privacy and exact-count guards remain in force.

The training CLI's default source is now the two committed immutable policy
inputs, alongside its committed dataset. Both files are required; there is no
missing-file fallback. An explicit `--policy-file` has no implicit history;
`--retained-policy-file` supplies that caller's historical version explicitly.
This uses the existing FilePolicyProvider `retainedFilePaths` interface. Missing
or invalid sources return typed `choice-policy-unavailable`. The CLI continues
to train offline and does not publish or activate a model.

Review scope is two owned source files and one exact historical input. No shared
Greg, scorer, clock, identity, schema, seed, registry, provider or runtime source
is edited. Planned validation is one bounded retained-input integration using the
same73-file canonical/113 graph with only the owned baseline/CLI delta, plus the
three immutable committed inputs. It will call the default training CLI once,
inspect the actual metrics/artifact if available, and retain the first typed
failure otherwise. Structural configuration provenance, 291 raw waits and the
3training/7later chosen vehicles remain explicit. No unchanged training retry,
regeneration, source mutation to fit results, hidden count reconstruction or
privacy-threshold change is authorised by this proposal.

JavaScript behavior and the future-dated baseline bootstrap remain untested until
the exact retained-input plan receives a new execution grant. The prior13/13 and
canonical generation result retain their original tested identities.
