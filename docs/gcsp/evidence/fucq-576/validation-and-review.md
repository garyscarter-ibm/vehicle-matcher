# FUCQ-576–578 scoped validation and review

All nine original acceptance items are implemented and evidenced in this test-only increment. The shared scoped command remains **RED: 155 tests, 151 passed, 4 failed, 0 skipped/cancelled/todo**; it is not a full-suite or acceptance claim.

The seven modules ran serially once with Node 24.22.3, `--test --test-concurrency=1` and `NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=1536"`. Their default-variant targeted receipts use base/HEAD `361510f6572570a14e8ee2c8a0fd66a203a84c0e`, tree `31873fb752eab20c463782d55410a487a7ef54ce`, tracked diff SHA-256 `68492b7d4a44a2913ea87bd3c2eaeee3d0b96eb733dea87942f006e715399752`, and complete selected input identity `8d957d1a656ac665b318c182a55ddff907e237d1a2bdecf19fb0329e032b1601`. Lord Business and Kronk independently matched all 209 tested input hashes and the actual tracked diff before metadata changes. No runtime rerun was made for this review.

| Module under `server/test/` | Passed | Failed |
|---|---:|---:|
| gcsp-comparison-generator.test.js |16|0|
| gcsp-comparison-current.test.js |14|0|
| gcsp-comparison-buddy.test.js |12|0|
| gcsp-comparison-measures.test.js |36|0|
| gcsp-learning-records.test.js |46|0|
| gcsp-manual-review.test.js |14|0|
| gcsp-lifecycle-return.test.js |13|4|

The six F576 exact comparisons pass, along with complete shapes, training boundary, deterministic replay, immutable manifests/results and original refusal cases. All 56 fixture JSON-pointer deltas match [field-causality.md](field-causality.md); none remains unexplained. Both F577 handoffs pass, including recorded/current contract, driver/contact, entered `returnOdometer`, home collection and separate return. The generated case now also directly exercises missing, negative, fractional, over-limit and unavailable-policy refusals with unchanged repository snapshots; manual-review retains canonical maximum boundaries. F578 records real reads beyond `withReadScope`, explicitly forbids all three current mutation methods, and retains immutable policy checks.

Russell ruled on 23 November 2026: “Keep those 37 report-only for F555; preserve the full RED result and require every other check.” Each remaining failure was matched by exact module and full name to the preserved 37-case inventory; this ruling applies toF555, adds no broader waiver, and changes no test inventory or assertion:

- `chunk-08-tap-130`: FUCQ-168: a confirmed return is recorded with location, appointment, demo-clock time and provider reference, and only then changes the current car.
- `chunk-08-tap-136`: FUCQ-168: a ready handover completed through the real appointment service makes the new order her current car; not-ready and refused completions do not.
- `chunk-08-tap-137`: FUCQ-251: after the handover is completed Paula can still plan a separate return, and the current car follows FUCQ-168.
- `chunk-08-tap-138`: FUCQ-252: the account projection reports the confirmed current-car relationship, and nothing while none is confirmed.

The wrapper recorded `fail:4` with an empty `failed_names` because it matched TAP `not ok` while Node 24 emitted `✖`. The original failed receipt and raw log are unchanged. Names were recovered from the raw lifecycle log, SHA-256 `95fa4856927b9a1bd7726c2f1a74c5425df1c265e12b4f6eaf91025be0041cd8`; no retry or suppression occurred. The original full batch RED also remains preserved.

Kronk independently reviewed source, all original acceptance clauses, real callees, fixture deltas, generator/counterfactual evidence, scoped logs/stamps and resource receipts: **PASS — no blocking or major issues found.** Requested/selected reviewer and lead pairing was `gpt-6.1-sol/high`, no fallback; effective runtime settings were not independently observable. Evidence helper reported `ready:[]`, `missing:[]` for each Bug. No screenshots were supplied or required: production/UI behaviour, policy/schema/data, Java parity resources and the frozen baseline are unchanged. Existing canonical PolicyService and bounded offline fixture contracts remain the data strategy; no new store, SQL or production workload is introduced.

Generation ran once in 26.36 s, measured peak inclusive RSS 522,534,912B and scratch/runroot 656,096B. Its original INCOMPLETE supervisor receipt remains preserved with the separate unchanged-input/owned-link reassessment described in [README.md](README.md). The final seven-module run completed in 88.73 s, one worker/heavy slot with 3 GiB RAM/2 GiB scratch limits; maximum retained scratch-manifest peak 250,912B and 47,786B aggregate logs. No final-module peak RSS is asserted. Lead independently verified all eight generation/final-run scratch roots absent, original process/start identities and groups absent, both owned dependency links absent, installs preserved, and own host/heavy tokens absent. No OneDrive path was accessed or checked.

Retained evidence in the shared root checkout:

- `.claude/test-runs/f555-resume-20261123/f576-validation/run/`: once-only producer receipts, candidates, causal ledger and unchanged original INCOMPLETE receipt plus supplemental reassessment.
- `.claude/test-runs/f555-resume-20261123/f576-validation/final-validation/run/`: unchanged final RED receipt, raw logs, six successful targeted stamps and seven ownership manifests.
- `.Codex/test-runs/impact/f576-f578-8d957d1a656ac665b318c182a55ddff907e237d1a2bdecf19fb0329e032b1601.json`: affected functions/fixtures/subprocess boundaries, timings and exact failure-name reconciliation.
- `.claude/test-runs/f555-overnight-20261123/fixture-lead/`: independent review and final source/failure/resource observation.

Full suites are deferred to the dispatcher covering batch. The report-only ruling preserves these exact four failures; every other required check and original F555 human sign-off remains required. No deployment/smoke was performed or authorized by these fixture Bugs.
