# FUCQ-115 canonical integration plan

6 November 2026. Prepared for dispatcher review; the entry point has not run.
The accepted FUCQ-103 checkpoint is
`0d3a0aa2fcee5d26ad33e587578cff7cce169090`. The catalogue records 73 exact
files (1,216,281 bytes), of which 48 match this checkout, seven differ and 18
are absent. No foreign source is installed into the checkout. No JavaScript
import, generator, training or test allocation has occurred during preparation.

The registry is SHA-256
`4bb860c1f3f06c897924a4f6a4f849e2c95c4dd12ccbb2ab136f14bbfb337507`;
its choice bundle is the exact corrected reviewed proposal, file SHA-256
`89565ec7fa05db042e623c6c88c132542505f7757848e61784f38d49b8391987`,
canonical digest
`dec7093d94d6ce4494c98a92b6aa2e0dc4207c1ee506d1eb449e51c36e9cd54d`.
Both new registered JSON files and the three earlier registered JSONs are in the
finite closure. Its dated command is SHA-256
`f7424c94b73d6a027f89c6b794fe261ea81807469cfa9e0cfc36482bab35f579`.

All common runtime/policy/repository/identity/scorer modules use that single
canonical checkpoint. The five actual FUCQ-113 records modules and published
generator CLI use `ddd884b33311b0d62225e107a4ba7d45a464c146`; own model/CLI
use `a78c66293079645d2dff9e7673e03b5fcecbd081`. Every file appears once in
one scratch mirror. Relative imports and filesystem-relative JSON reads therefore
resolve to the same coherent module identity graph. The old hook loader is not
used. The only dependency link is scratch-owned `server/node_modules`, pointing
to the existing main-clone installation. The worktree receives no dependency link.

Five earlier baseline dependencies differ from the approved 27-file pilot:
clock, identity, policy index/publication and employee scorer. Their selected bytes
and earlier hashes are explicit in `fucq115-canonical-source-plan.json`. The actual
FUCQ-99 Greg module remains byte-identical. The scorer delta adds validated optional
policy preference weights; no implementation is copied or edited. The adopted
canonical clock/identity/publication changes supply the actual activation interface.
PostgreSQL and corpus modules in the static import graph remain inactive: explicit
memory mode, no database open, corpus load or collection. The migration directory
URL is inactive. The CLI project-root directory URL resolves within the mirror.

The proposed command, after an exact dispatcher grant, is:

```text
python3 -B docs/gcsp/models/fucq115-canonical-supervisor.py --execute --dispatcher-grant GRANT
```

The supervisor's `--plan` command only rehashes sources, helpers, environment
identity, Node executable and pg package; it allocates no test resources. Python
AST parsing of both preparation scripts and catalogue/identity verification passed.
JavaScript syntax and behavior have deliberately not been executed before review.

One fresh `_tools/test_resources.py` HostBudget worker owns 120 seconds, at most
768 MiB RAM, 128 MiB combined scratch/output and 2 MiB logs. The indivisible unit
requires 256 MiB RAM and expects 32 MiB disk. Selected retained output is capped at
32 MiB; each compact dataset is capped at 16 MiB, snapshots at 8 MiB and summaries
at 2 MiB. Source bytes add 1.2 MiB. All source/data starts under an externally
manifested absolute scratch root. After the process stops and joins, selected
outputs move on the same volume into an owned retained directory, without a
second data copy. Duplicate CLI records/manifests and the source mirror are removed.
No automatic retry follows an executed failure. Reservation/group/scratch absence,
input identities and the installed dependency target are checked in the final receipt.
All database/PG/GCSP/NODE overrides, debug, trace and preload environment is removed;
owned TMPDIR/TMP/TEMP is propagated. No credential file is read.

The entry point performs the following sequential checks, stopping on failure:

1. Construct actual `MemoryPolicyProvider({store})` with the unmodified canonical
   seed, and actual memory `createGcspRuntime` with explicit environment/bootstrap.
   Obtain real sessions and drive the actual cookie handler in process, opening no
   listener. Advance actual DemoClock to 6 November at 09:00:00 UTC.
2. Adopt learning into `fucq115-learning-v2`; advance one second and adopt choice
   definitions into `fucq115-choice-model-v3`; advance one second and publish the
   exact five-change command into `fucq115-dataset-80x4-v4`. Verify ordinary cookie
   activation, same-provider readback, retry append-once, retained history/prices.
3. Use actual `loadLearningPolicy` at 09:00:02 UTC without altering any snapshot,
   hash, timestamp or provenance. Invoke the actual generator CLI once with seed
   `fucq115-canonical-80x4-v1` and explicit `--allow-fixtures`. Validate 320 records,
   retain compact manifest-backed data/policy/snapshot, inspect usable cycle/cohort
   support and censoring, and require the actual earlier/later/G8-10 split.
4. Train the existing model and prepare actual FUCQ-99/FUCQ-29 baselines using
   earlier training briefs only. Require real later/familiar/unseen metrics and
   retain adverse deltas/thin classes. Exact missing or banded demand remains
   typed unavailable; no hidden counts or changed privacy thresholds.
5. Write and verify the content-addressed immutable artifact and safe summary.
   Invoke the actual training CLI on that dataset/policy and require the same
   artifact. This second training is the explicit CLI-reproduction acceptance
   check. The default no-argument CLI integration remains a later owned-source
   change after the committed dataset/policy location is established.
6. Only after successful evaluation, publish the model reference through actual
   dated PolicyService in this isolated memory run, activate with the same cookie,
   verify `readActiveChoiceModel`, historical unavailable reference and retry.

A typed failure retains the actual dataset/support reached and its phase, code and
field; it does not create an evaluated summary or activate a model. Structural
configuration provenance stays explicit even with 320 records. No BMW calibration,
actual corpus, unavailable live producer, browser, native database, shared/live
activation or full-suite result is established by this run. Existing 13/13 tests
retain their original identity; this composition is new scoped integration evidence.
The dispatcher still owns the later serial full-suite lane and shared source merge.
