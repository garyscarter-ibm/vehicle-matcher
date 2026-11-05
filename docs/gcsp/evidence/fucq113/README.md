# FUCQ-113: bounded LearningRecord projection evidence

The first slice adds LearningRecord schema v1, its reusable closed validator and the observed current-run
projection. The second adds a pure seeded generator, immutable PolicyService snapshot preparation, complete
manifest and training reader. Neither adds a screen or data store; full FUCQ-113 acceptance remains outstanding.

`server/test/fixtures/gcsp-learning-record.json` is an explicitly fictional contract sample, checked by the same
validator as service output. Its observed provenance describes a projection over saved demonstration rows, not
BMW employee history. The sample shows a captured offer with pending acceptance, unknown selection, unknown
historical terms/context/exposure, and no inferred decline, expiry, wait or later satisfaction.

`server/test/gcsp-learning-records.test.js` creates confirmed briefs with the actual BriefService, then inserts
small, explicitly labelled outcome repository fixtures. Those fixtures exercise saved version association,
quoted points, role/run refusal, privacy and concurrency. They are not actual offer/decision-producer acceptance.
The returned reference fields are run-scoped digests; source names, actors, contact details, free-text reasons,
trip/usage histories, current-car feedback, source blobs, token metadata and scores are excluded.

Historical alternatives and exposure remain unknown even when current stock is visible. Historical entitlement
context comes only from the saved dated allowance quote. Missing quote/terms stays unknown; missing confirmed
brief, inconsistent joins and malformed records fail safely. Unmatched current briefs have unknown outcomes,
not no-choice labels. Repository storage timestamps are not promoted to business-clock event times.

Read failures preserve typed unavailable/refusal results; a changed complete repository read or clock causes a
refresh conflict. Employee, forged-role and stale-run requests are refused through the real identity port.
Pending acceptance is independently unknown for completed selection and cannot become a confirmed acceptance.
Explicit expiry remains distinct from decline; elapsed wall/demo time alone does not mark expiry.
Canonical rejected offers without a decision record project to typed unclassified declines.

Explicit offered/accepted/rejected/declined/expired/selected business timestamps, pending starts and the matching
completed/pending decision timestamp are retained through the supported public-port bindings documented in
shared-contracts.md. Missing event times remain null. Malformed, future or conflicting evidence fails safely;
waited outcomes cannot coexist with offer/selection/acceptance/decline/expiry outcomes. Confirmed brief and quote
times cannot exceed the projection clock; quote validity can. Acceptance/selection have no inferred time order.
The timestamp regressions overlay explicit fields on public read results because the current repository schema
does not yet persist these event fields. This is contract evidence, not proof of timestamp-producing integration.

Validation command: `node --test server/test/gcsp-learning-records.test.js`, offline with database connection
aliases removed. The launcher uses `_tools/test_resources.py` supervision, one worker, a 120-second cap,
768 MiB RSS, 128 MiB owned scratch and 2 MiB bounded logs. Retained launcher/checkpoint/ownership/summary
receipts live outside disposable scratch under the shared `.claude/test-runs/fucq113-projection/` root.
No full suite, native database, browser, service listener, real employee extract or external transport is used.

The generator slice is checked through public PolicyService reads against a complete explicitly fictional
successor fixture, never published or adopted by tests. It covers deterministic repeatability without wall time,
global randomness or network; stable multi-cycle intent; one central no-choice change; scarce exact-car
competition; decline/expiry release and exposure; release/eligibility/essential/points gates; separate noisy
outcomes; pre-materialisation bounds; exact corpus-port identity refusal; and manifest tamper, duplicate and
mixed-provenance refusal. The validator accepts an optional opaque `orderRef` on known alternatives, allowing
two exact cars with one configuration; old alternative shapes remain valid and extra fields remain rejected.
Synthetic exposure measures continuous supply availability up to a choice and can predate personal access;
it is not a claim of personal viewing/impressions. Observed historical exposure remains unknown.

The retained `server/test/fixtures/gcsp-learning-dataset.json` is a 70,045-byte six-record/two-cycle synthetic
sample with a complete fixture policy snapshot, actual comparison overlays and counts (4 offered/accepted/
selected, 2 waited). The fixture's extra seats/space/etc. are labelled synthetic test inputs, not real catalogue
measurements. The reproduction test independently prepares its explicit source and compares all output.
Manifest readers regenerate a bounded expected dataset, so consistency hashes do not claim authenticity.

The generator launcher and resource/impact receipts live under the shared
`.claude/test-runs/fucq113-generator/`; the same small offline supervision limits apply. `policy-handoff.md`
records the exact candidate-definition schema, canonical bundle digest and file SHA256 for FUCQ-103 review.
Final scoped proof: 36/36 passed (the complete learning-records module), 10.92 seconds, peak RSS 224.9 MiB,
zero measured scratch bytes. All owned scratch and process groups were removed/stopped, reservations released
and the owned dependency symlink removed; final cleanup and source identity are in `final-receipt.json`.

Still outstanding: reviewed `learning.*` adoption; actual FUCQ-77 corpus execution and
confirmed feature/provenance mapping; actual observed outcome-producer integration; full-story acceptance
and the root dispatcher's coordinated full-suite lane. Structural fixtures establish none of those gates.

No screen changes: supplied 00/01 GCSP shell references, the approved FUCQ-6 body reference at revision `a7fc178`,
COMPONENTS.md and the shared Density theme govern future consuming views. Sample JSON, privacy and typed error
behaviour are this slice's backend experience evidence. No browser capture or human layout gate is claimed.

## Bounded generation CLI

`node scripts/gcsp/generate-learning-records.mjs --help` describes the file-backed generation path. It
uses FilePolicyProvider and PolicyService, reading the selected immutable source header for its policy pin
and default as-of instant. It never chooses a database provider from environment variables. An explicit
`--corpus-store` opens an already published local registry read-only and refuses unavailable/recovered
selection. `--snapshot` instead replays a complete prepared snapshot; it cannot be combined with policy or
corpus selection flags. Snapshot/manifest hashes prove consistency, not authenticity.

The explicit structural-sample trial is:

```sh
node scripts/gcsp/generate-learning-records.mjs --seed fictional-learning-sample-v1 \
  --snapshot /absolute/path/to/prepared-snapshot.json --allow-fixtures \
  --output /absolute/path/to/new-output-directory
```

The sample snapshot is `server/test/fixtures/gcsp-learning-dataset.json`'s `manifest.snapshot` value,
extracted explicitly by the caller. This sample is not a real-corpus run. By default the CLI requires a
corpus configuration source; `--allow-fixtures` explicitly permits the manifest's labelled fixture source.
It prints bounded counts and paths, writes `records.json` first and `manifest.json` last, and preserves
existing output paths. Training joins those two JSON values as `{ manifest, records }` and calls
`readLearningDataset`; records without the manifest remain invalid. Generated output is separate from
committed sources and is never a substitute for retained immutable inputs.

`node scripts/gcsp/generate-learning-records.mjs --seed 1` currently exits 2 with typed
`policy-unavailable` at `learning.cohortSize`, and writes no dataset: immutable seed-v1 has not adopted
learning keys. Use a complete reviewed successor with `--policy-file` after adoption, an explicit corpus
store and a new output directory. No policy is adopted or registry published by this script.

`server/test/gcsp-learning-records-cli.test.js` exercises the actual executable success/refusal paths,
complete file-backed successor reads, identical reruns, explicit fixture permission, untouched existing
output, malformed snapshots/options and unavailable corpus. Parent resource receipts are retained at
`.claude/test-runs/fucq113-parent-cli/`; the source remains offline and no native database grant is claimed.
