# FUCQ-61 accounting reconciliation — 7 November 2026

The bounded retained collection scopes reconcile **19,978 actual GETs and 13,744 solver operations**, with six recorded source-operation failures, including two timeouts, and zero recorded substitutions. This covers 32 named live allocations using 1,559 non-overlapping counter snapshots. It is an exact sum for those scopes; it does not claim all historical acquisition/diagnostic traffic. The 13,747 spent-index entries remain a separate exclusion inventory.

The numerical and semantic result is unchanged: **10,351 retained admitted source configurations, exactly 10,000 selected, zero shortfall**. No new collection, runtime proof, test, acceptance/Done transition or BUILD prerequisite is introduced. This addresses the documentary remainder in the assessment at `b80b76ec16f603e0420eea7d7e5d7387ab0b7159`; [reconciliation.json](reconciliation.json) holds exact metadata pins, selection recipes, counter digests, budget comparisons and limits. Existing closeout and assessment documents are unchanged.

## Recovered operations and outcomes

| Measure | Reconciled observation |
| --- | ---: |
| Actual source calls / HTTP attempts | 19,978 / 19,978 |
| page / settings | 1,559 / 1,559 |
| discover / options | 1,558 / 1,558 |
| solver operations | 13,744 |
| Decoded response bytes | 1,478,961,751 |
| Recorded source failures / timeouts | 6 / 2 (timeouts are included in failures) |
| Recorded substitutions | 0 |
| Known accepted solver outcomes | 10,417 |
| Known rejected / duplicate outcomes | 2,946 / 375 |
| Failed solver operations without a resolved outcome | 5 |
| Lost interrupted-200 callback outcome, classification unknown | 1 |

The solver accounting is `10,417 + 2,946 + 375 + 5 + 1 = 13,744`. A source failure, timeout, failed proof, failed supervisor and an unretained accepted outcome are different measures. Eleven series-level incomplete stops are not relabelled eleven source failures. The five failed solver operations remain failures without resolved selections; one further failure occurred during bootstrap.

Twenty final series observations cover 19 allocations and reproduce 19,176 GETs, 13,086 solves and 1,443,440,076 decoded bytes from 1,523 existing child receipts. The 1,511 completed session/chunk IDs are unique. The remaining 12 receipts are eleven active interrupted sessions plus the trim pilot already included in its parent GET/byte total. Twelve earlier receipt scopes and the interrupted-200 trace add 802 GETs and 658 solves. Earlier pilot context counters are selected once; continuation uses allocation counters rather than cumulative counters.

The final typed-axis resume replaces four earlier cumulative observations. The 790-axis pilot sessions 001–004 and suffix sessions 005–101 are disjoint under one original allowance. The trim parent already includes the pilot's 12 GETs/bytes, so those are not added again; its 252 newly accepted suffix rows omit eight pilot admissions. Parent union audit snapshots are lineage evidence, never operation addends. Exact receipt bytes are newly pinned here; the parent's `primarySha256` is not assumed to be a receipt-file hash. This is a counter reconciliation, not a fresh audit of every primary/event trace.

The retained admission bridge is independently explicit:

- `9,754` newly accepted in the selected series observations + `563` earlier retained admissions + `8` omitted trim-pilot admissions + `26` separately proved interrupted-session admissions = `10,351`.
- The same count follows from measured live outcomes: `10,417` accepted − `52` lost interrupted-200 callbacks − `15` other withheld raw admissions + `1` dated-capture admission with zero replay traffic = `10,351`.
- The 26 proved active admissions are G42 remaining session060 seven, G42 unspent session005 seven, G42 unspent2248 session118 six, and F70 optional5535 session239 six. Other active raw admissions remain withheld: optional1556 three, optional2815 two, optional3623 one, breadth phase02 five and phase02c four.

## Declared plans, actuals and exclusions

The original finite plans compare as follows. Reused/resume plans do not create extra allowances. Each mapped actual GET count remains within its stated attempt allowance on the specified pilot/suffix basis; this is not a whole-run RAM, timing or acceptance pass.

| Original allocation | Candidate allowance | GET allowance | Actual GETs |
| --- | ---: | ---: | ---: |
| f70-model-axis790 | 790 | 1194 | 1194 |
| f70-optional-axis-pilot32 | 32 | 48 | 48 |
| f70-optional-axis-suffix1156 | 1156 | 1736 | 1736 |
| f70-optional-axis-suffix1556 | 1556 | 2336 | 600 |
| f70-optional-axis-suffix2660 | 2660 | 3992 | 1649 |
| f70-optional-axis-suffix2815 | 2815 | 4227 | 231 |
| f70-optional-axis-suffix3623 | 3623 | 5439 | 1206 |
| f70-optional-axis-suffix5535 | 5535 | 8307 | 2868 |
| f70-trim-package260 | 252 | 284 suffix + 12 pilot | 296 (260 solves total) |
| f70-typed-axis1024 | 1024 | 1152 | 1152 |
| g42-remaining-typed-pool | 2768 | 4152 | 720 |
| g42-unspent-typed-pool-1304 | 1304 | 1956 | 1956 |
| g42-unspent-typed-pool | 2288 | 3432 | 60 |
| g42-unspent-typed-pool-2248 | 2248 | 3372 | 1416 |
| scheme-breadth30-phase01-960 | 960 | 1440 | 950 |
| scheme-breadth30-phase01c-320 | 320 | 480 | 480 |
| scheme-breadth30-phase02-960 | 960 | 1440 | 143 |
| scheme-breadth30-phase02c-864 | 864 | 1296 | 1031 |
| scheme-breadth30-phase03-960 | 960 | 1440 | 1440 |

The exact selected cohort preserves 8,051 baseline rows, then 366 novelty additions and 1,583 deterministic hash-ordered additions. It preserves all 1,562 observed groups and 4,522 observed category tokens across 43 VG and 26 AG codes, 22 paint and 33 upholstery codes. Selected raw ranges are F70 5,396; G21 430; G26 214; G42 2,408; G61 341; U10 222; U11 989. The 351 surplus admitted rows and one nonqualifying North American reference are explicitly excluded from the source target; VIN associations do not increase it. Exact distributions and complete selection/equipment states remain in [the retained coverage report](../exact10000-closeout-2026-11-07/coverage.json).

These are the declared finite source contexts and observed raw selection categories. Semantic model, body and powertrain remain unknown; no advance representative-population quota is invented. Q13 places five-WMI/VIN assurance with delivered/current cars, and F77's scheme-model-line obligation stays separate. Unknown technical facts and limited representative imagery remain explicit, as permitted by the original contract.

The interrupted-200 allocation is a preserved failed boundary: 57 GETs, 53 solver attempts, supervisor exit −15 after 119.241270666 seconds, zero retained capacity. Its measured peak 492,797,952 bytes exceeded its 469,762,048-byte child ceiling before termination. It is not presented as a within-all-resource-limits success. Its source checkpoint and full binding artifacts were lost; 52 callbacks recorded accepted outcomes, while the 53rd has no retained callback. Exact classification of that missing outcome is **irrecoverable from the retained run evidence**. Unknown is not zero and the run gains no admission credit.

A single comparable whole-run active duration or combined budget percentage cannot be recovered from these timing fields. The series child receipts sum 6,960,134 collector-reported milliseconds, but that excludes some preparation, proof and reservation intervals. Phase01c's 1,586.701568584 seconds includes original global-phase time; its continuation audit records 294.666675584 seconds. Phase02c likewise has 1,074.821964083 original-global versus 629.599782083 continuation seconds. Typed-axis reports time since its original reservation; interrupted-200 retains supervisor duration after losing its final source checkpoint. These fields remain named per allocation. Earlier acquisition traffic for the initial dated capture is also outside the 32-allocation sum: its admission proof reports zero replay source calls, not the historical acquisition budget. Those exact whole-history measures remain named gaps for collaborator acceptance.

## Failure isolation, expired access and cached replay

The JSON pins the existing interruption, additive publish/restart, rollback, local replay and continuation receipts. The forced SIGTERM/SIGKILL harness retains its primary/checkpoint outside scratch and adds zero source capacity. The actual two-process continuation preserves predecessor bytes/outcomes/IDs, does not repeat either solver, and makes zero calls on completed restart. Its ten GETs and zero cache hits remain visible; the separate Medium bootstrap cache-refetch defect is deferred and unfixed.

The existing `.12` additive restart preserves 8,052 prior rows and exact identities. The corrupt-current-manifest and changed-supplement cases recover `.11` manifest `77f4dc0ad4b88d0c3d233e4e5f8634b07f105461a52ef7d534ffa8fe5b6155ab`, preserve selection/history and restore exact `.12`. Existing cached local proof matches all 10,002 direct, retained and local HTTP references with zero errors at those boundaries. The 2,707 configured-consumer failures remain deferred/unfixed; strict CLI completion and native stock proof remain unestablished. A fresh upstream rebuild or public deployment is not required by F61's alternative of documented cached replay.

Expired-access evidence is specifically the retained 401/403/429 durable-stop/no-retry tests in `server/test/gcsp-fleet-collector.test.js` at lines 198 and 598, plus source-batch continuation refusal at line 261. Current test/session hashes match the existing composite scoped evidence of 133 passing collector/model/source checks. No tests ran in this review. No actual expired upstream capability was newly exercised against the published 10k store. The access-refusal and separate immutable staging/rollback proofs establish their component boundaries; a combined real-expiry/live-store assertion is not invented. This remaining evidence distinction is available for acceptance disposition, not a new BUILD gate.

Only new concise documents were written. Verification selects JSON parse/readback, metadata byte stability and hashes, receipt identity deduplication, counter/admission arithmetic, plan comparisons, recorded code/test identity equality, local link resolution and whitespace. No raw source bodies, privacy replay, network/source collection, tests, runtime, SQL, browser, descendants, scratch, production, root/status/map or Jira edits were added. Scratch allocated/removed: zero; no compatibility exception or disposable leftovers. The pre-existing unowned bytecode file is preserved. Agent Minnie Mouse requested/selected `gpt-6.1-sol` / `medium`; effective runtime unverified.

Scoped static validation passed: 87 metadata pins and 19 deterministic receipt-set digests covering 1,523 child receipts were rechecked; counter/admission arithmetic, JSON readback and both local links passed. Git whitespace validation passed before commit. No tests or source calls ran.
