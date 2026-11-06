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

## FUCQ-103 read-only review acknowledgement

On6November2026, FUCQ-103 independently reported the published proposal at
`9e2c2764dbe36f2ec45737b0833aeb78a54a7613` matches file SHA-256
`89565ec7fa05db042e623c6c88c132542505f7757848e61784f38d49b8391987` and canonical
bundle digest `dec7093d94d6ce4494c98a92b6aa2e0dc4207c1ee506d1eb449e51c36e9cd54d`.
They accepted the214-character basis correction at read-only review. Registration
and adoption are explicitly not yet implemented/published; this is not canonical
activation or permission to run the320-record dataset.

The reported existing interface reference is
`3f1cc3414d700b1028ff1fec640a40591324b728`:
`PolicyService.withPublicationPorts({ identity, clock, repository })`, then
`adoptReviewedAssumptions(gregContext, { commandId, expectedActiveVersion,
policyVersion, effectiveFrom, definitionSetId })`. Its five-key command supports
missing-only append, original-command retry and current-run activation while
retaining tuned values/provenance. This is upstream-reported interface context;
Pluto has not imported or independently exercised that source. The dispatcher
still reviews the finite immutable source composition before use.

FUCQ-103 will supply a verified immutable registration/adoption checkpoint and
dated existing-key publication inputs for cohort80/cycles4/record bound>=320/
choice bound40000 and a comparison start at/after pinned preparation. Read back
through one pinned PolicyService; never edit snapshot hashes or provenance to
bypass publication. Existing13/13checks and clean-park receipts remain unchanged.

## Canonical checkpoint and finite execution proposal

FUCQ-103 published `0d3a0aa2fcee5d26ad33e587578cff7cce169090`; the
dispatcher independently accepted its canonical registry/adoption evidence on
6 November 2026. That supersedes the unpublished upstream state above. Pluto
read the immutable registry, two added JSONs, actual runtime/activation interfaces,
consumer adoption test and exact dated command without importing JavaScript.

`fucq115-canonical-source-plan.json` records the proposed 73-file, 1,216,281-byte
coherent graph: canonical 103 common modules, immutable published 113 records/CLI,
and unchanged own model/CLI. Its SHA-256 is
`4736eb27feccd18d83c9f105d7a71d1130e1edd75006974c211fac208d1293a3`.
All five registered JSON dependencies are included. Five earlier baseline
dependencies differ; their old and selected hashes are explicit. No mixed shared
module identity, rewritten foreign source or policy snapshot overlay is proposed.

The complete sequential harness, exact command, source delta, output caps and
120s/768MiB/128MiB/2MiB one-worker resource plan are in
`fucq115-canonical-plan.md`, `fucq115-canonical-run.mjs` and
`fucq115-canonical-supervisor.py`. Source/catalogue/hash checks and Python AST
parsing passed. The supervisor `--plan` rehashed all 73 sources and own helpers;
no JavaScript import, syntax/test allocation, generator or training occurred.
The proposed run still needs dispatcher source/harness review before execution.
No new allocation or dependency link exists. Prior scoped13/13 remains the latest
executed model-test evidence, with its original identity; full acceptance remains
open, including actual320-record training and both baseline holdouts.

## Granted canonical generation result

The exact reviewed grant `fucq115-canonical-35fd9e5-0033` was executed once.
Actual canonical adoption/dating, ordinary activation/history/prices/retry, actual
FUCQ-113 CLI generation of320 records, manifest validation and leakage-safe split
passed. The dataset/policy bytes are now committed inputs. Split counts are
123training/152later/31unseen/121familiar; training has only3 chosen vehicles,
later7, and the raw data has291 waits. Structural configurations and thin evidence
remain explicit. `fucq115-canonical-result.md` and the compact run receipt contain
exact identities, counts, limits, failure diagnosis and cleanup.

The run stopped at own `baseline.context`, before baseline metrics/artifact/CLI
reproduction/model activation. A new baseline runtime creates a different policy
run; actual MemoryPolicyProvider correctly starts it from the unmodified seed,
which cannot equal the required adopted training version. No unchanged retry or
generator replay occurred. Supervisor wall5.230332s/RSS233,553,920B/scratch7,223,553B;
owned groups/scratch/reservation absent, dependency target inodes unchanged.
Retained output2,600,960B; retained plus deliberate durable inputs5,087,232B.
The dispatcher authorises read-only diagnosis and a narrow owned-model correction
with a finite retained-input resume proposal; execution needs exact delta review.

## Narrow correction and retained-input proposal

Published `1e6e4a42911bc58e5bce3f3f88fbeb464c7c5fcf`: own baseline/CLI
correction and exact actual historical seed. No shared source/provider change.
The CLI explicitly requires the actual captured current plus original historical
input, while the baseline advances actual clock and verifies identical snapshots
and empty initial briefs. Full rationale is `fucq115-baseline-correction.md`.

`fucq115-retained-plan.md` and its76-file source catalogue/entry/supervisor propose
one default CLI attempt from the exact committed dataset and actual policy inputs,
with no generation/adoption/publication/activation replay. Source-plan SHA-256
`6a7f276a99307aba3af2b07498859bb3a8659025099f087fa89fc741b134a797`.
Python AST and exact-source `--plan` checks passed; no JavaScript execution or new
resource allocation occurred. Both changed source files remain behaviorally
untested. Execution requires a new exact dispatcher review/grant. Actual baseline
metrics, artifact, default CLI success, model activation and final/full gates remain.

## Actual retained-input evaluation delivered

Grant `fucq115-retained-c3e4c7a-0033` ran the default CLI once, successfully.
Actual62-employee earlier-brief demand and deterministic-fit baselines were
computed with unchanged privacy rules. Later152-choice logloss/Brier:
learned0.1969166895/0.0564266199, expressed demand0.2078671946/0.0511443681,
deterministic fit0.2124969079/0.0510270732. Lower overall logloss and worse Brier
are both retained. Unseen31-choice and familiar121-choice metrics, reliability,
class/cohort and thin flags are computed in the actual artifact and summary.

Artifact ID `sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d`
is committed unchanged under `artifacts/`; safe summary fixture now contains exact
actual evaluated output. Optimizer hit1500-iteration limit (gradient0.0002379891
above1e-6); only3 training/7later chosen vehicles and8 later nonempty vehicle sets.
All3 structural configurations lack seats/boot facts, so capacity-effect evidence
is absent. Perfect wait-only cohort scores do not prove predictive skill.
See `fucq115-evaluation-result.md` and `fucq115-retained-run-receipt.json`.

Supervisor wall1.363722709s/RSS198,983,680B/scratch4,708,929B/exit0. Retained172,128B,
retained+durable outputs340,064B. Sources/inputs/helpers/dependency identities and
device/inodes unchanged; groups/scratch/reservation/link absent. No new model
activation, generation/adoption replay, full/native/browser/corpus/live proof.
Actual dated reference publication and final integration remain open.


### Existing-artifact activation proposal · 6 November 2026

Dispatcher audit of retained training/evaluation/artifact at e3f1e0b passed44
checks. The next directive limits work to a finite actual model-reference
publication/activation proposal on the same artifact and dates/provenance.
`docs/gcsp/models/fucq115-activation-plan.md` describes77 exact files: all76
reviewed source rows unchanged plus the existing immutable artifact. The new
entry point re-establishes actual ordinary-cookie canonical history to the
identical captured v4, schedules only the reference at09:00:03UTC, verifies the
before/after clock boundary, active/historical artifact reads, unchanged unrelated
rows and retry append-once. This explicit fresh isolated setup replay needs a
new exact grant. No dataset/settings tuning, generation, baseline evaluation or
training rerun is proposed.

Read-only catalogue/identity `--plan`, Python AST and finite-entry static review
passed. No JavaScript imported/executed, resources allocated, dependency link or
activation run created. Actual activation and final scoped/full integration stay
open; no built/accepted claim. The original synthetic limitations, optimizer
iteration-limit and worse Brier results remain unchanged.


### Strict activation harness proposal · 6 November 2026

Dibble independently passed the original77-source/217-edge activation behavior,
but held execution for pre-import identity, native injection, strict ledger and
recursive process/RSS/teardown gaps. The dispatcher authorised only narrow owned
harness authoring. `docs/gcsp/models/fucq115-activation-harness-repair.md` records
the diagnosis, repair, exact hashes and proposed command. Frozen admission SHA
`c4667c215fbaca5a15413df46e181118d5a8cde66dd2a127f0adb7b15bc13909` covers204
physical/content identities,138 installed files across14 pg dependency packages
and37 missing-resolution probes. No FUCQ-100/shared helper is copied or changed.

The unchanged activation entry/catalogue/artifact remain pinned. A gated launcher,
strict owned resource wrapper and exact frozen admission replace the unsafe
inherited paths; malformed/unknown states preserve resources rather than claiming
cleanup. Author-only AST/static symbols, metadata freeze and exact `--plan` passed;
no JS/OS proof, test, resource reservation, activation, generation, training or
tuning ran. Independent repair review, actual activation and final scoped/full
integration remain open. Own worker observation expires at this handoff; no built
or Jira acceptance transition.


### Granted activation attempt · 6 November 2026

Independent repaired admission PASS granted one exact run under
`fucq115-activation-918ce04-0139`, source918ce045. It exited1 at initial strict
`make_scratch -> process_snapshot` with SnapshotUncertain, before ownership
manifest/checkpoint/finalizer, HostBudget/reservation, scratch allocation or any
Node/runtime/activation call. No retry or source edit. Actual activation remains
open; see `docs/gcsp/models/fucq115-activation-result.md` and the compact
`fucq115-activation-run-receipt.json` for exact source/grant/paths/log hashes and
reached/unreached evidence. Post-attempt stdlib-only204-pin/138-file/14-package/
37-absence audit is unchanged. Worktree dependency link absent. No allocated
resource cleanup success is manufactured for the unreached phase.

The rejected OS row/global condition was not retained by the frozen preallocation
probe, so cause remains unresolved pending bounded diagnostic evidence and new
dispatcher scope. Prior evaluation/immutable artifact/adverse results unchanged;
no training, tuning, settings, native/browser/network/full or production work.
Own worker observation expires at handoff; no built or acceptance transition.


### Authorised OS schema diagnosis and repair proposal · 6 November 2026

Original failed activation evidence is published at fbff6ae and preserved. One
authorised bounded read-only macOS ps query returned0/no stderr/662rows; all
rejections came from trailing padding in its final lstart column. The20 retained
metadata samples pass the existing strict date regex after outer trim (0before/
20after). No full command arguments or environment values retained.

The minimal owned repair adds only lstart outer normalization before unchanged
strict validation; no shared helper, supervisor, entry, artifact, training or
source-graph edit. Frozen admission
`1fc1376aadeaa5e6652bf923356ae457074ae43697750f819ddb31934b55c9d9`
differs from c4667c21 in only the resource helper identity. AST/static symbols,
metadata freeze/delta and exact --plan pass. This does not prove the repaired live
probe or activation; no retry/test/Node/resource allocation ran. Exact current
command/hashes and diagnosis: `docs/gcsp/models/fucq115-activation-os-repair.md`
and `fucq115-activation-os-diagnosis.json`. Await independent review/new concrete
grant. Policy/acceptance remain blocked; own worker expires at handoff.
