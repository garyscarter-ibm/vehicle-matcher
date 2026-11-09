# FUCQ-115 canonical 80x4 result

6 November 2026. The single dispatcher-granted run
`fucq115-canonical-35fd9e5-0033` completed actual canonical adoption, publication,
320-record generation, projection and temporal/cohort partitioning, then stopped
with typed `baseline-unavailable` at `baseline.context`. No evaluation metrics,
trained artifact, training CLI reproduction or model-reference activation were
delivered. The unavailable panel fixture remains unchanged. No retry occurred.

The exact source proposal is `35fd9e5`; execution HEAD was
`bc67ffd54ab87cfb1091230821da5b9d56b80968`. All 73 source pins and helper
identities matched before execution and remained unchanged after it. The actual
MemoryPolicyProvider used the unmodified canonical seed and actual memory runtime.
Actual DemoClock reached 6 November 2026 at 09:00:02 UTC through real advances.
Learning and choice adoption, the exact five-change dated publication, ordinary
same-cookie activation, same-provider pinned readback, retry append-once and
historical policy/price preservation all passed. No seed, snapshot hash, timestamp
or provenance was rewritten.

Actual `loadLearningPolicy` and the published FUCQ-113 generator CLI produced 320
synthetic records over four cycles with seed `fucq115-canonical-80x4-v1`.
The exact validated dataset and canonical training-policy bytes are committed as
`choice-training-dataset.json` and `choice-training-policy.json`.

| Identity | SHA-256 |
| --- | --- |
| Dataset file, 2,075,907 bytes | `49738aadd1f22ffee43df4d6d9e06695cb1ada6cca3c033bc8c0913b13dc6926` |
| Dataset content hash | `93a5146fcfe3c242ca713dd8964a8a56f8408c406daa708faeb223ca010bdf59` |
| Canonical policy file, 406,539 bytes | `c2079525f409b0b8b94e23d2fbd0b0b8cba0dfe54bc22d46476ae3ec8a3b0f85` |
| Prepared learning snapshot | `05078e5f267764b1162f9d28b604c5ee2401964eee4c367b028ee04e62e166fc` |

Projection excluded ten censored outcomes and four outcomes projected beyond their
cycle. Earlier-cycle G8-10 choices are excluded from training; later G8-10 is the
unseen group. All chronology, partition-support and future-feature guards passed.

| Partition | Choices | Waits | Selected or accepted | Nonempty vehicle choice sets |
| --- | ---: | ---: | ---: | ---: |
| Training, cycles 0/1 | 123 | 120 | 3 | 5 |
| Later, cycles 2/3 | 152 | 145 | 7 | 8 |
| Unseen G8-10, included in later | 31 | 27 | 4 | 5 |

There are 121 familiar later choices and 31 excluded earlier G8-10 choices.
Training spans G1-6, G7 and G11-14. The raw generator reports 291 waits, 29 offers,
19 acceptances, 18 selections, two declines and eight expiries; event counts
overlap. Most records have no feasible available vehicle. This is a reproducible
engineering dataset with very thin vehicle-choice evidence. It does not establish
useful calibration or generalisation; eventual class/cohort metrics must retain
that weakness. Configurations are explicitly `reviewed-fixtures`, not a published
vehicle corpus or observed employee choices.

The failure is in own baseline composition. `prepareActualChoiceBaselines` creates
a new isolated repository/runtime run using the original run-scoped PolicyService.
Canonical `MemoryPolicyProvider.#records` starts every new run from its unchanged
seed; it does not copy the training run's adopted history. Actual DemoClock
initialisation derives a different run ID and resolves that run's active version.
Its resulting Greg context therefore cannot match the required training version,
and the adapter correctly fails closed. Relevant immutable canonical source lines:
`policy/memory-provider.js:12-18`, `clock/index.js:51-68`,
`identity/index.js:199-211`; own guard is `predict/model/baselines.js` at
`baseline.context`. This is not a missing privacy count diagnosis: execution did
not reach demand evaluation.

A correction needs an explicitly retained, unchanged canonical policy history for
the isolated baseline, actual clock advancement to the training read instant, and
equality checks against the original pinned training source. It must preserve
run scopes and dated activation. The next proof should read the exact retained
dataset and policy rather than rerun adoption/generation. Any newly exposed
privacy/count failure must remain typed unavailable. A new exact source/harness
review and bounded execution grant precedes that proof.

Supervisor wall time was 5.230332 seconds, sampled RSS 233,553,920 bytes and peak
scratch 7,223,553 bytes, within 120s/768MiB/128MiB/2MiB/one-worker bounds. Exit
code was 2 with no resource-limit issue. Selected retained allocation is 2,600,960
bytes. Retained data plus the two deliberate durable input copies occupies
5,087,232 bytes, far below the combined bound. Installed dependency directory,
pg directory and package device/inode/identity remain unchanged. Owned process
groups, scratch and reservation are absent; no worktree dependency link exists.

Exact resource/retention/source evidence is in `fucq115-canonical-run-receipt.json`.
The ignored external run directory is
`.claude/test-runs/fucq115/canonical-80x4-b19b3684d8e549349f06ead8dafe715c`.
Its `summary.json`, external ownership manifest, bounded log and four retained
files remain for dispatcher inspection. The old 13/13 result is reused only at
its original source identity. There is no full-suite, native, browser, shared/live
activation, corpus or calibration result.
