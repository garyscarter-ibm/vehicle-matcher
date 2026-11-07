# Reviewed consumer definitions and isolated dated policy

6 November 2026. Dispatcher-approved additive canonical registry scope following
the released, incomplete desktop smoke. No shared/live policy is activated.

| Registered file under `server/gcsp/policy/reviewed/` | Exact reviewed source | Byte SHA-256 |
| --- | --- | --- |
| `offer-decline-reasons-v1.json` | `da4a2c824d7d73b118185c4cfc6395d4e9254e4f:docs/gcsp/evidence/fucq106/reviewed-offer-decline-reasons-v1.proposal.json` | `1f1b632be83ddef1a5656288b4e40c0378736cda5c21fcf03de68544dfbe688f` |
| `fucq115-choice-model-v1.json` | `9e2c2764dbe36f2ec45737b0833aeb78a54a7613:docs/gcsp/models/fucq115-policy-proposal.json` | `89565ec7fa05db042e623c6c88c132542505f7757848e61784f38d49b8391987` |

The reason definition set is `offer-decline-reasons-v1`, revision `1`, canonical
digest `2d7be8d50ff899dd4c72ed3490bcfc888e092196ef19b44d5d0519de76f00b4d`.
Its one key `offer.declineReasons.v1` holds schema version 1 and the reviewed typed
body-style, size, fuel and equipment reasons. The choice set is
`fucq115-choice-model-v1`, revision `choice-model-definitions.v1`, canonical digest
`dec7093d94d6ce4494c98a92b6aa2e0dc4207c1ee506d1eb449e51c36e9cd54d`.
Its seven keys retain the reviewed regularization, split, feature set, optimizer,
evaluation, unavailable model reference and explicit uncalibrated baseline mapping.

The earlier `97234e8` choice proposal had a 287-character baseline basis, exceeding
the existing registry's 256-character limit. The corrected immutable proposal
shortens only that basis to 214 characters and recomputes the digest. All values,
settings, shapes and other provenance remain identical; the validator is unchanged.
The parent independently checked both exact files and canonical digests.

`reviewed-definitions.js` reads, validates and deeply freezes both additions with
the existing presenter, Greg editor and learning bundles. No provider, schema,
seed, identity, activation, runtime, generator or browser source changes accompany
the registration. The only adoption operation remains:

```js
policy.adoptReviewedAssumptions(gregContext, {
  commandId, expectedActiveVersion, policyVersion, effectiveFrom, definitionSetId,
});
```

Definitions remain server-owned. The existing same-provider publication CAS adds
only missing keys, retains existing tuned values/provenance, rejects an all-present
no-op, reconciles the original command retry and activates the current run through
the existing path. Current-run reason policy provenance is separate from a quote's
pinned price policy. Registering a bundle alone creates no policy version and
proves neither FUCQ-106's decision consumer nor a trained FUCQ-115 model.

## Isolated dataset preparation command

`fucq115-dated-policy-command.json` is an explicit reviewed operation input, not a
second active source or a seed overlay. Its assumed, dated patches change only
`learning.cohortSize` to 80, `learning.cycles` to 4,
`learning.maximumGeneratedRecords` to 320, `learning.maximumChoiceEntries` to
40000 and `comparison.startsAt` to `2026-11-06T09:00:02.000Z`. Each patch records
the contract source, source date 6 November 2026 and its finite trial basis.
All other learning/comparison values, grade groups, wait/noise and prices remain
canonical. This is a synthetic domain instant; session lifetime uses its separate
wall-clock port.

The executable isolated proof uses the delivered memory runtime with an actual
`MemoryPolicyProvider({store})` and its unmodified file seed. Supply the required
environment/command bootstrap fields. The existing scenario starts on 5 November;
move the real DemoClock forward to `2026-11-06T09:00:00.000Z` using its ordinary
presenter `advance` command. Do not rewrite the scenario or policy snapshot.
Use the runtime's original read policy for clock/scenario identity boundaries;
the returned writable policy view shares that provider.

1. At 09:00:00, adopt `fucq113-learning-v1` from `gcsp-policy-v1` into
   `fucq115-learning-v2` with a stable isolated command.
2. Advance DemoClock one second. Adopt `fucq115-choice-model-v1` into
   `fucq115-choice-model-v3`, expected version `fucq115-learning-v2`.
3. Advance another second. Pass the exact dated command JSON to the existing
   server-only `publishPolicyVersion(gregContext, command)`.
4. Resolve the same ordinary employee session through `/api/gcsp/context` to
   activate `fucq115-dataset-80x4-v4`. Read all preparation inputs through one
   pinned PolicyService read `{runId, asOf: command.effectiveFrom,
   policyVersion: command.policyVersion}`. Read back every value and provenance;
   preserve retained policies and price plans. Retry the same command unchanged
   to verify exactly one append.

The generator remains FUCQ-113's separately reviewed published source. Its
`loadLearningPolicy({policyService, policyRead, corpus})` must produce the snapshot
itself. `generateLearningRecords(seed, snapshot)` may use one explicit seed; do
not edit the resulting snapshot hash, feature timestamps or provenance. Cycle zero
starts at the pinned preparation instant, so records need not precede feature
observation. Useful earlier/later and G8-10 holdout support, actual baseline
distributions, 320 records, entry caps, censoring and model evaluation still require
their own executed FUCQ-115 evidence. Structural fixture configuration provenance
remains synthetic; this setup proves no BMW corpus or live producer.

## Validation scope

`consumer-registration` selects the six new consumer checks plus the fifteen
existing learning, presenter adoption, editor and delivered-runtime checks.
`consumer-adoption` selects only the six new checks for a corrected test fixture.
Both modes use `scoped-supervisor.py`, one worker, 120 seconds, 768MiB RAM, 128MiB
scratch and 2MiB logs, external ownership manifests, fresh HostBudget reservations,
selected source/command pins and teardown. Database aliases, PG, Node preload/
coverage and debug/trace environment names are removed without retaining values.
The new regression covers exact immutable registration, actual same-provider
adoption/ordinary activation/original retry, old snapshots and prices, tuned-key
preservation and the real dated publication/readback operation.

The reviewed results below record this boundary. No browser retry/journey,
PostgreSQL/native proof, full suite, generator, training, external send or live
activation is part of this check. The old browser source catalogue is intentionally
superseded by this registry delta; a later executable catalogue must include both
new JSON dependencies and the actual central scenario composition before admission.


## Reviewed result

New `consumer-adoption` checks: **6/6 passed**, zero skips, in 4.717 test seconds.
Summary:
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/ownership/fucq103-backend-f094a7406b414e0483c609286d05937c-summary.json`.
Matching manifest has the same basename ending `-manifest.json`.
All 56 selected source pins match the executed tree and parent rehash. Peak RSS is
275,398,656 bytes; peak scratch 4,096 bytes, removed. Retained summary/manifest
allocation is 16,384 bytes, independently matched; scratch plus retained has a
conservative 20,480-byte upper bound. Owned scratch, PID/start identities, group,
ports 65023/65028/65030/65035, reservation and temporary links are absent; existing
dependency targets remain. Parent independently checked the actual resources.

The preceding `consumer-registration` run passed the **15 existing regression
checks** with the same production registry/JSONs and unchanged existing test/helper
inputs. Its overall result was 18 passed, three new-fixture failures, zero skips.
Summary basename: `fucq103-backend-4cc7611e87214269863b9b84b9b2fb24-summary.json`
in the same shared ownership directory. The new helper initially omitted required
runtime environment/command bootstrap fields; the corrected helper supplies them
and advances actual DemoClock to the dated preparation instant. Only that new
fixture and supervisor selection metadata changed before the focused six-check
rerun; the parent compared every other earlier pin. The failed receipt remains
available with verified cleanup. Existing checks are reused transparently rather
than represented as one passing 21-check run.

Registry SHA-256: `4bb860c1f3f06c897924a4f6a4f849e2c95c4dd12ccbb2ab136f14bbfb337507`.
Dated command byte SHA-256:
`f7424c94b73d6a027f89c6b794fe261ea81807469cfa9e0cfc36482bab35f579`.
No production method or seed changed. Price/history preservation is proved through
canonical adoption and dated readback; the unchanged delivered-runtime regression
also preserves actual calculated quote/hold/offer terms. FUCQ-106 consumer uptake,
actual FUCQ-115 generator/training and browser/full/native gates remain separate.

Runner: Cool Cat, requested/selected/effective `gpt-6-luna` / `high`, no fallback
or descendants. Effective settings/title were independently verified earlier in
this session. Parent owns source review, named-path commit/push and handoff.
