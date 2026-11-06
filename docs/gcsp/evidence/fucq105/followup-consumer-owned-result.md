# FUCQ-105 owned follow-up consumer result

6 November 2026. **Scoped consumer PASS; parent functional audit FAIL; independent cleanup PASS. Whole-story acceptance remains open.**

The tested and pushed revision is `d9a2c04f40d0bfb263e1c3bfb71b7e7ace455226`, source-plan SHA256 `19af2c40040919e88ed082a484fbb68997964b90be232b2e68e374d64189a243`. The root standing delivery envelope SHA256 is `319a5cf1ec640b5daa998cd79b87191250624ccb2ac7c9c56a267d0e89a78563`; grants name the actual delegated issuer. Root delta review is `.claude/test-runs/ownership/fucq105-owned-delta-review-1055.json`. Unchanged reviews were reused; no descendants or unchanged retry ran.

## Diagnosis and correction

The actual1042 run failed at the confirmation checkpoint after reaching the first two checkpoints. Its selected test HTTP shim emitted string chunks from `Readable.from([body])`, while real `server/gcsp/identity/http.js:readBody` combines native request byte chunks with `Buffer.concat`. This rejected the confirmation body before the real107 service could save it. The correction is `Readable.from([Buffer.from(body)])`. Production105/100/102/106/107 modules, the100turn wait, assertions and input semantics are unchanged; there is no evidence of timing flakiness or a107 product defect.

The only helper-body change is the exact envelope-preapproved `fields[5].strip()` at bounds telemetry identity ingestion. It produces SHA256 `be8176354fb6b17792171be7cc88f5bc76f35100195932dd571e4809ef5d5890`, correcting future padded helper-owner start values without rewriting old evidence. Necessary source-plan/parent pin references were refreshed. Membership remains73 product modules/137 product edges/24 test edges/12 file inputs/10 harness members.

## Selected actual result

Run `fucq105-followup-20261106-105614-owned1` used the existing finite supervisor and selected only `server/test/gcsp-offer-view-followup-consumer.test.js`:

- Tests1, pass1, fail0, skipped0, cancelled0; all four named checkpoints completed. Actual supervisor exit0 and worker exit0.
- Native decline and lost-response reload; fresh employee account and mounted real107 question; confirmed brief3/public receipt and original-coordinate saved reload; malformed/raced-source refusal, read-only refresh and teardown all passed.
-74 observed unique identities are73 product modules plus the test. Strict targeted key `22aa8e0926e843a654d32cf34955c32e969ee090d1527ee70ec58b42dc909446`, default variant/base `b95b4c8ad8a4534cbf03f287eb62fc8a57bbda96`.
- Worker4.929s, preparation17.307s, supervisor36.600s at summary. Aggregate charged peak475,676,672B; peak combined7,154,368B. The actual reservation was the full805,306,368B RAM/134,217,728B disk. Limits remained worker120s/supervisor240s, retained8MiB and one worker.
- Supervisor recorded direct joins, removed scratch and released its exact row; the final helper journal closed with406/406 joins, no issue or pending handle. Original summaries, strict receipt, manifest, journal and source/input bytes were retained.

The complete original outputs are under shared `.claude/test-runs/fucq105/fucq105-followup-20261106-105614-owned1`. The delegated result receipt is `.claude/test-runs/ownership/fucq105-owned-selected-result-20261106-105614.json`, SHA256 `7a021c14c84dc55f9e59768476f8b9885406a2bd2522ab424667e09d0701f8f7`.

## Parent failure and evidence limits

The separately reserved existing parent/auditor ran once: actual auditor exit1, parent exit1. Parent stdout reported `ResourceError`, retained scratch/row and no postwrite verification; stderr retained both Python atexit traces ending in `BoundError: Helper direct join or durable ownership is unresolved`. Complete tool output is preserved in `.claude/test-runs/ownership/fucq105-owned-parent-wait-20261106-105614.json`, SHA256 `b8b8e667184fdab5faf76706058769ba6513a6c5f31ffe09669501863f09fb3f`.

The auditor journal closed cleanly with16/16 helper joins. The parent journal recorded17/17 direct joins but sticky `HelperOperationFailed` and capture17/PID19777 still pending in state `joined`; the parent child19741 was directly joined but its lifecycle stayed unresolved. The auditor recorded `BoundError` after18 true checks, before any retained-dependency verification result was recorded. Progress inside the immutable-source loop is not retained. Its parent-captured stdout/stderr were empty and both EOF-complete flags false; these are incomplete audit captures, not passing streams.

The initiating error cannot be identified from these saved diagnostics. `HelperOwnership.capture` retains a generic operation-failure flag; the auditor stores an exception type; scratch cleanup can replace the earlier exception with `ResourceError`. Neither the original helper command nor its first error message is retained. This is an explicit first-cause evidence gap, not proof of a leak or a specific traversal/timing defect. No further helper-body change or retry was made. A focused review of this failure is the next validation step.

The execution tool exposes merged stdout/stderr. The sole supervisor JSON and the parent leading JSON/atexit diagnostics are source-attributed in the retained wait receipts; no separate OS-pipe capture or independent root observation by this lead is claimed. The root also retained its observed parent wait.

## Independent cleanup and remaining acceptance

Root independently reconciled exactly the failed parent run: cleanup-only PASS1826, `.claude/test-runs/ownership/fucq105-parent-root-reconcile-1055.json`, SHA256 `55d31ebe297bfa18db18df9245b7a6f39b55086f6cde441fc0715d2cd9a1e0e6`. All retained owner/consumer/auditor/helper PIDs/groups/open paths were absent. Root removed only the inode-bound empty parent scratch and its exact dead full reservation row, preserving every foreign row and original consumer/audit byte hash. This lead performed no parallel cleanup mutation or retry. Journals retain counts/current/last helper identities, not a complete historical helper PID list; the independent receipt states that limit.

Root additionally verified all17 protected original directory/file identities and byte hashes against the before-audit snapshot: `.claude/test-runs/ownership/fucq105-protected-originals-root-1101.json`, SHA256 `af2dff94e0c191e56b883c185467d0e54e8a6bc3a6c9e08ce1b002cd218a134c`. The passing consumer evidence is preserved and is not rerun to clear the parent-audit failure.

Cleanup success does not convert the parent functional audit to PASS. Delivered host/gate/HTTPS-cookie entry, canonical question-policy registration, desktop/375px rendered keyboard/reduced-motion and second-browser evidence, native DB, full-suite lane and final collaborator acceptance remain open. No visual/component/style change was made; the agreed shell/FUCQ64/shared-kit references remain binding. Story and slice acceptance are not advanced.

Agents: Hippety Hopper; requested/selected `gpt-6.1-sol` / `high`; no fallback or descendants.
