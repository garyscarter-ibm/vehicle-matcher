# Corrected HTTPS accounting validation — 1357

6 November 2026. The authorised finite continuation completed: corrected TLS2 **2/2 PASS** and the exact host-guard selection **1/1 PASS**, each with bounded resource accounting and complete cleanup. Both grants are consumed once. This is targeted HTTPS evidence; FUCQ-100 acceptance remains unchecked. [Exact commands, receipts, metrics and original-file hashes](local-https-corrected-result-1357.json).

| Chunk | Grant state | Actual outcome | Charged RSS peak | Combined disk/log peaks | Worker / total |
|---|---|---|---:|---:|---:|
| Corrected TLS2 | New 1357 grant consumed once | Exit 0; 2 tests / 2 passes | 615,464,960 B | 1,564,864 / 643,023 B | 5.631 / 99.149 s |
| Host guard | Same remaining original allocation consumed once | Exit 0; 1 test / 1 pass | 725,336,064 B | 2,506,944 / 1,471,415 B | 7.546 / 113.211 s |

Both original TAP logs have zero failures, skips, cancellations and todos. Only the two granted TLS titles and the single granted host title executed. Per-chunk limits were one worker, 120s work/180s total, 805,306,368 B charged RAM, 134,217,728 B combined disk, 2,097,152 B logs/journals and 262,144 B receipts. Metadata reduced the host work allowance to 66.966s before its 7.546s worker.

The same unchanged execution-plan SHA256 `3683906c123d334c3a1a68e2c73f3fcb3515f6c772c38180639a04a0d87fbcdc` binds both receipts. Reviewed product/test checkpoint `657c3a79695d8ab4670ebd1db1fb3edcaa83d382` and the corrected accounting topology remain unchanged. TLS2 tested clean published `f1bca47c9d6a2123b847532e1664a18f44895207`; host guard tested clean published `948561ec21a9563520408d8e438fa33bd2613dcd`. The first evidence publication changed only these two unpinned result files.

Independent pre-execution reviews were by Stanley Tiger, requested/selected `gpt-6.1-sol/high`, no fallback or descendants:

- TLS2: `.claude/reviews/fucq100-stanley-tiger-corrected-tls2-1357.md`, SHA256 `dc1c5911e7f5afcda6b76f6d7bd14743b83b57635bbefbec07f0f23753493c35`.
- Host admission, including corrected first originals: `.claude/reviews/fucq100-stanley-tiger-corrected-brief1-1357.md`, SHA256 `d804c88e34960a9f680fb3a0e52d972c1b153267be9847f83cd5cb394e34482e`.

Original receipts remain under shared `.claude/test-runs/fucq100/https-accounting-1357/`: TLS2 `receipt.json` SHA256 `c17a0ebbad4ea7164bbb3cca78eaf6c65b37fbca4a3c858e6581589f712537a8`; brief1 `receipt.json` SHA256 `ccb2994f85098f402d6ef788060e7e65a1ea2b8a8faa658b6fc4610ebb0d0542`. Original TAP, exact targeted proofs, execution/provisional records, certificate/module journals and ownership manifests remain ignored alongside them.

Fresh locked admission counted the complete raw reservation rows for each chunk and charged the full 768MiB RAM/128MiB disk allocations with the required 512MiB physical-memory/5GiB disk reserves. The host's immediate pre-launch record has one row, 2,715,009,024 B physical memory and 205,234,225,152 B free disk. Direct Darwin native-spawn completion records native wait4/broker/probe peaks of 2,195,456/22,020,096/1,441,792 B for TLS2 and 2,179,072/21,577,728/1,425,408 B for host guard. Both native exits and Node broker closes are 0 with no error/signal.

For each chunk, all 36 retained launches joined, all six cleanup fields are true, lsof returned 1 with empty output, exact scratch device/inode deletion completed and exact reservation release/readback passed. No cleanup errors were recorded. Some short-lived direct-probe histories have null starts; these are not group-signal anchors. All retained launch and native/broker identities have concrete starts. Reviewed strict absence requires ProcessLookupError for null-start histories. No claim is made that every observed probe had a start anchor.

Final collection `.claude/coordination/fucq100-corrected-final-collection-1357.json` passed 2,344 checks with no failures: exact TAP/joins/resource records, same-plan/review/proof bindings, all 219 sources/13 helpers/498 graph edges, 1,890 installed files/38 package namespaces, 38 physical executable/native/platform rows, input memberships and document pins. Both module journals contain only admitted paths/hashes. The collector independently checked scratch absence and locked exact-token absence; it made no new process/open-file probes or runtime launch. Full native load-coordinate resolution was revalidated by the unchanged driver before and after each selected execution.

Disabled1344 source-only plans and all original1315 plans/reports/receipts remain preserved. Original TLS2's old grant remains consumed; its functional 2/2 and cleanup do not gain retroactive resource PASS. [Earlier resource HOLD and source-only repair](local-https-result.md); [finite execution contract](local-https-execution-contract-1357.md). No grant remains available in this finite flow and no rerun is authorised.

No browser, trust installation, native/live database, sender/external service, full suite or unchanged lifecycle/consumer rerun occurred. Browser Secure-cookie/offer journey, rendered 1280/375px/keyboard/reduced motion and remaining integration/full/native/provider acceptance stay open. Module observations are not function/branch coverage. Root retains independent final collection, claim/Jira/shared-map/merge/acceptance; F71/F108 atomic-ordering, F71/F112 receipt gaps, F96/F139 pauses/date holds and foreign ownership remain unchanged. Historical lifecycle3/3, offer2/2 and renewal19/20 remain historical; F122 owns the available/released mismatch.
