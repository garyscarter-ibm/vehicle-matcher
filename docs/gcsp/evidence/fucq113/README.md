# FUCQ-113: bounded LearningRecord projection evidence

This first slice adds LearningRecord schema v1, its reusable closed validator and the observed current-run
projection. It adds no screen, data store, generator, manifest or training loader. It does not complete FUCQ-113.

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

Still outstanding: seeded multi-cycle generation through canonical policy keys; real FUCQ-77 configuration-port
execution; deterministic policy-sensitive output; dataset manifests and training-load validation; actual observed
outcome-producer integration; full-story acceptance and the root dispatcher's coordinated full-suite lane.
The separate `policy-handoff.md` is parent-owned planning for that later slice.

No screen changes: supplied 00/01 GCSP shell references, the approved FUCQ-6 body reference at revision `a7fc178`,
COMPONENTS.md and the shared Density theme govern future consuming views. Sample JSON, privacy and typed error
behaviour are this slice's backend experience evidence. No browser capture or human layout gate is claimed.
