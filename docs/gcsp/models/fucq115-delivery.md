# FUCQ-115 delivery evidence

## Independent optimizer checkpoint

Pluto reviewed the five new model/test files (329 lines), their imports and their
acceptance boundary. No production consumer imports them. Features use vehicle
attributes, confirmed categorical preferences, separate importance and confirmed
seat/boot spare capacity, plus missingness and the wait intercept. Code has no
runtime policy defaults, network or persistent-state effects.

Scoped command: `node --test --test-concurrency=1 server/test/gcsp-choice-model.test.js`.
Ran 6, passed 6, failed 0, skipped 0. Test duration 222ms; supervisor wall 0.585s.
Known-logit unit input: 4,000 seeded choices over three candidates plus wait, truth
`[0.7, -1.1, -0.4]`, coefficient tolerance 0.15, L2 0.0001. This experiment proves
optimizer recovery, not FUCQ-113 generator integration or BMW calibration. Other
checks cover analytic gradient central differences, extreme utilities, malformed
inputs, meaningful feature interactions and temporal/cohort leakage refusal.

Validation base: `fc1e283a079aa2ffe6e0a78fe74ba3002e7b9cda`; contract checkpoint
`dd9b334319b113f1285ad35527a6a69abbdf8407`. Tested file SHA-256 identities:

| File | SHA-256 |
|---|---|
| `server/gcsp/predict/model/features.js` | `36983ebd66dffa5bd79bbea6cf274232882a203572d174ffc0977787f9d54878` |
| `server/gcsp/predict/model/index.js` | `b10247d76b6afdd9b54b51d8edb453aeee4feeb09ed05dff5a5b0586aa10a0f3` |
| `server/gcsp/predict/model/optimizer.js` | `f7dee4b01895f1e4d0f2d3c335fe657cb44ac3eefd5cd3fb43e67e47b15c9e1b` |
| `server/gcsp/predict/model/split.js` | `7865dcb3c41921f5598918db268860ee68c5ab4b20a2577c393f3c86cd80b154` |
| `server/test/gcsp-choice-model.test.js` | `bb4c20cfde030163603f60c6ad65d9c6ec888ca5fe7f6d340eb562d2d6c9b0e4` |

Resource receipt: `_tools/test_resources.py`, one worker, 120s/768MiB/128MiB/2MiB
bounds. Sampled peak RSS 21,970,944 bytes, scratch 0 bytes, retained log 735 bytes.
External manifest:
`.claude/test-runs/fucq115/ownership/fae9f98d2d3e4ec4a2eae16721b873af.json`.
Owned `/private/tmp/test-stamp-shard-fae9f98d2d3e4ec4a2eae16721b873af` removed and
host reservation absent, both checked after stop/join. Checkpoint and concise
summary: `.claude/test-runs/fucq115/optimizer-v1-summary.json`, impact selection
`impact.json`. Two launcher setup errors (wrong unit field/path before allocation)
were corrected; neither allocated a test child. No filesystem leftovers or large
output exception. Database aliases, NODE_OPTIONS and debug/trace environment were
removed from the offline child.

Remaining gates: reviewed source import; meaningful actual generated dataset;
actual expressed-demand and deterministic-fit baselines; computed held-out metrics;
immutable artifact and safe panel fixture; canonical key adoption and dated model
publication/historical reads; authored CLI and final root-granted full validation.
No full stamp, live producer, corpus delivery or story completion is claimed.

## Evaluation, artifact and actual-source checkpoint

The extended dedicated command passed **11/11**, no skips, in 928ms. Exact tested
identities and cleanup receipts are in `fucq115-scoped-receipt.json`. This adds
computed log loss/Brier/reliability/class/cohort metrics, explicit missing-baseline
refusal, adverse comparison retention, canonical artifact digest and atomic
exclusive publication/corruption checks, and real PolicyService dated publication
and historical reads over a clearly labelled alternative test source. Changing
regularization through that publication changes the next training coefficients.
The arithmetic baseline fixture is explicitly not actual FUCQ-99/FUCQ-29 evidence.
The initial test launch encountered missing `pg`; the worktree now has an untracked borrowed
`server/node_modules` link to the existing installed main-clone dependency tree.
No package was installed and no database was contacted.

Lead review includes new module imports and the explicit seven-definition policy
proposal. Its canonical reviewed-bundle digest is
`71cf67e576c531445e416d18d67999038bb5f13ede13b269091abcd701adc117`;
file SHA-256 `1c3fb9e359c448b1cae0bd1070a680df6285f1140a940a882df3bab664c1ed30`.
The unseen group was corrected to canonical `G8-10` after inspecting
`comparison.gradeDistribution`. The earlier six-row/G8 proposal is superseded.
No canonical adoption is claimed. Probability conversion, smoothing order,
exact-alternative class mass and missing/banded data refusal are explicit in the
contract. `fucq115-baseline-source-proposal.json` supplies the finite 27-file
existing-source closure for root review before actual FUCQ-99 composition.

With the dispatcher's exact source approval, the actual FUCQ-113 reader,
`createLearningDataset` and published CLI replay the original snapshot byte for
byte. No source was edited: seven immutable missing sources were read through an
owned-scratch loader, preserving the 22 matching shared module identities.
Projection retains all six usable choices; the intended later/unseen split refuses
with `partition-support`. Support is three G7 choices in cycle 0 and three G7
choices in cycle 1, with four selected/accepted and two explicit waits. Data hash
`864468030afbc284a296223c6f038ac86ccf5f1f37f1828e50c34cc26e1315fc`.
This remains schema/source integration evidence, not calibration or holdout proof.
The safe panel fixture remains `status: unavailable`, with null metrics and no
invented success, until those evaluation gates can pass.

Latest dedicated supervisor: wall 1.052s, sampled RSS 206,471,168 bytes, scratch
8,288 bytes. Actual-source projection/replay: wall 0.275s, scratch 311,424 bytes.
Both remain within 120s/768MiB/128MiB/2MiB/one-worker bounds. All owned children
stopped/joined; both scratch roots and host reservations verified absent. Manifests
and retained bounded logs are referenced in the committed compact receipt.
The test selector remains scoped; no full test stamp or native/live proof.

## Offline pipeline and actual baseline adapter checkpoint

The dedicated command now passes **13/13**, no skips, in 955ms. The new offline
pipeline composes reader validation, temporal/cohort partitioning, training, actual
baseline preparation, held-out metric comparisons, immutable artifact and safe
summary. CLI `scripts/gcsp/train-choice-model.mjs` has explicit bounded inputs and
returns typed unavailable for missing data; it never activates a model. The CLI
training/default-data acceptance remains open, because the meaningful committed
dataset and canonical key adoption are still absent.

The dispatcher independently verified and approved all 27 immutable actual
FUCQ-99/Greg, FUCQ-29/scorer and clock/repository sources. A fresh supervised pilot
uses those actual services on the same six-record structural sample, with an
explicit alternative policy source solely for contract evidence. Actual FUCQ-99
reads three earlier-example employees; the adapter refuses absent/banded exact
body shares. Actual FUCQ-29 scorePreferences produces a normalized distribution
without claiming calibration. No baseline evaluation score or held-out result is
invented. Numerical pure-contract checks separately cover exact-alternative class
mass, smoothing before normalization, reserved pinned wait mass, zero/negative fit
and missing/suppressed demand. One floating-point strict-equality assertion was
corrected to a 1e-12 probability tolerance.

The compact receipt now includes the full approved baseline source identity and
all own code/CLI inputs. Dedicated wall 1.295s, sampled RSS 205,340,672 bytes,
scratch 8,288 bytes. Actual baseline pilot wall 0.539s, scratch 311,424 bytes. Owned
groups stopped/joined; scratch and reservations verified absent. Existing pg 8.23.1
is borrowed through the explicitly untracked server/node_modules symlink; it is
never staged and must be removed and verified at final parking. No source ignore
rule or installed environment was changed.

## Clean park and exact resume boundary

Independent checkpoints are published through `5f9a589de373ee089dcdcff47e1ad360b62a50ce`.
The dispatcher is coordinating FUCQ-103 canonical adoption/publication, rather than
another collaborator's approval. All collaborators retain equal authority.

Remaining input is a complete immutable PolicyService source with the reviewed
seven-row bundle adopted through FUCQ-103 and a dated publication for a meaningful
actual FUCQ-113 run. Proposed generator changes: learning.cohortSize 80, cycles 4,
maximumGeneratedRecords at least 320, maximumChoiceEntries 40,000; preserve all
declared noise, waits, prices and response assumptions. Set comparison.startsAt
at/after the preparation read instant: FUCQ-113 feature facts use policyRead.asOf,
and this consumer refuses future feature/term/exposure evidence. Split earlier
cycles 0/1, evaluate 2/3 and exclude canonical grade group G8-10 from all training.
Verify actual support and exact FUCQ-99 demand shares; do not alter privacy bands,
invent missing counts or mutate a snapshot to make a run pass. Root-reviewed exact
source composition is required at resume; no broad source merge is implied.

Then exercise the actual generator/manifest and CLI, inspect held-out baselines and
thin classes, retain adverse results and model artifact under owned paths, publish
its reference through the existing policy operation, check historical pins and
complete root-granted final integration/full validation. Real corpus and observed
producer evidence remain distinct from a structural-fixture synthetic pipeline.

Final receipt verifies 11 owned scratch roots removed and all 11 reservations
absent. The exact borrowed dependency symlink was removed; its installed pg 8.23.1
target remains untouched (package SHA-256 in `fucq115-scoped-receipt.json`). Retained
bounded manifests/checkpoints/logs total 256,256 allocated bytes under
`.claude/test-runs/fucq115`; no owned filesystem/process leftovers. Only Pluto's
observed worker claim was expired at parking. No other story/map row was changed.

## Reviewed-definition metadata correction

FUCQ-103 review found the baseline basis was 287 characters; its schema allows
256. Shortened only that basis to 214 characters and regenerated the canonical
sorted-key JavaScript bundle digest. A deep comparison verifies every setting,
value and other shape/provenance field is unchanged; every basis is within256.
The current proposal file SHA-256 is `89565ec7fa05db042e623c6c88c132542505f7757848e61784f38d49b8391987`,
bundle digest `dec7093d94d6ce4494c98a92b6aa2e0dc4207c1ee506d1eb449e51c36e9cd54d`.
This supersedes the prior seven-row metadata proposal. Existing13/13 and actual
baseline/source evidence above retains its original tested identities; no code or
statistical input changed, so no duplicate test allocation was made. The borrowed
link remains absent and all prior cleanup receipts stand.
