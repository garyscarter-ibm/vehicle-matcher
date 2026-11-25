# FUCQ-582 historical/current comparison readers

The four required Greg comparison failures are repaired in the allocated test consumers. The once-only unchanged diagnostic ran 69 tests: 65 passed, four failed, none skipped. The final scoped run ran all three complete owning modules and `gcsp-painted-copy-words.test.js`: **80 passed, zero failed or skipped**. This is scoped evidence; the post-merge canonical npm batch and acceptance remain pending.

The new historical reference contains both complete original server fixture envelopes independently extracted from revision `361510f6572570a14e8ee2c8a0fd66a203a84c0e`. Their serialization recreates the original file bytes. Tests assert the immutable revision, source paths and SHA-256 values, then compare the complete literal `storedResult` objects by deep equality:

| Envelope | Original byte SHA-256 |
|---|---|
| Process | `89da1123ed5c0d144de8023336f5643ce99d859cde086868b333a69bc0df7d63` |
| Experiment | `27ebe66556a1e711b867d2a56124793ad09d4a23fec5b67c6a17fc5028aee286` |

Current server fixtures continue to feed current adapter, view and malformed-input checks. Their full policy hash and result IDs are now explicit assertions. The current experiment override also renders current provenance. Frozen gallery checks retain policy prefix `97df1a052794` and the historical result identity. Complete equality, record, hash and refusal assertions remain intact. Production, blocks/gallery references, generators, current goldens and Java inputs are unchanged.

Both runs used Node 24.22.3, `--test --test-concurrency=1`, and the existing pinned root/server dependency environment. No installation occurred. The final direct command selected:

```text
node --test --test-concurrency=1 server/test/gcsp-greg-comparison-experiments.test.js server/test/gcsp-greg-comparison-render.test.js server/test/gcsp-greg-comparison-rerun-render.test.js server/test/gcsp-painted-copy-words.test.js
```

The caller/import search found the allocated modules, painted-copy, unchanged comparison-measures producer checks and `ComparisonRunnerSupport.fixture` / `ComparisonMeasuresTest`. F576's existing 36/36 comparison-measures evidence remains applicable to unchanged source/current fixture bytes; its field ledger explains the eight process and twenty experiment identity deltas. Java inputs are unchanged; this work makes no new Java runtime claim. There is no screen or runtime behavior change, so no new screenshots, browser, database or startup checks are required by this test-only contract. No supplied images: `ready:[]`, `missing:[]`.

Marvin the Martian independently reviewed the full changed modules, fixture provenance, original three acceptance items and protected bytes. **Code/spec: passed. Security: passed.** No blocking or major findings. The added reads use fixed repository-local URLs; no shell, network, credential or configuration boundary changes. Reviewer requested/selected `gpt-6.1-sol/high`, no fallback; effective runtime pair is unobservable. Lead Kronk retained the same requested/selected pair.

A separate independent supplement verified the actual 80/80 log, the four repaired cases passing once each, complete four-module argv, tested/reviewed source hashes, tracked plus untracked targeted identity and fresh absence of both owners, groups, scratch roots and dependency links. Source commit: `6d0c1665b3f823224021663e880ecf2512c9e505`, tree `3f51d96c6f5b1e316e962d7f67d8dd1566b497e8`. Metadata additions leave the tested source unchanged.

The pre-edit run took 4.18 seconds with sampled peak group RSS 509,509,632 bytes; the final run took 9.38 seconds with sampled peak 508,510,208 bytes. Each had one worker, 2 GiB scratch ceiling, 5 GiB free-space emergency reserve and a 600-second limit. Each owned scratch root held only its 32-byte ownership token. Finalizers removed both roots and exact inode/target dependency links, verified process groups absent and preserved installed environments. No heavy token, Java, Chrome, database, real mail or OneDrive access occurred. The parent `test_stamp` also reported its scratch removed.

Retained evidence under the shared root checkout:

- `.claude/test-runs/f555-overnight-20261123/f582-validation/`: original diagnostic/final logs and ownership receipts, validation summary and independent review evidence.
- `.claude/test-runs/targeted-f64c111732033410f4f3efd152000be15cebb50306a827704d497dfc21514637-default-1795484070152429000.json`: passed scoped default-variant evidence, base `34b0750c88767a7f5241be166c78c730e57c2a63`, code key `f64c111732033410f4f3efd152000be15cebb50306a827704d497dfc21514637`.
- `.Codex/test-runs/impact/f582-f64c111732033410f4f3efd152000be15cebb50306a827704d497dfc21514637.json`: selected modules, fixture/caller boundaries, timing and exclusions.

The diagnostic receipt's failure-name array is empty because Node emitted `✖`, while the wrapper recognized TAP `not ok`. The unchanged raw log identifies exactly the four claimed failures; the supplemental summary records them. Original receipts/logs are preserved.

The original canonical result remains RED: 4,284 tests / 4,177 passed / 41 failed / 66 skipped, exit 1. The exact 37 human-authorized report-only cases remain unchanged. Root owns one exact unfiltered `npm test` after merge, retaining all 248 files and every report-only case. No deployment or smoke check was performed.
