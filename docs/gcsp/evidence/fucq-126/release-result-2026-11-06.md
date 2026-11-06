# Owned presenter release-result repair

6 November 2026. The presenter now consumes FUCQ-92's committed `orderUuids` result shape. This closes the owned controller contract mismatch identified in the [95d7741 source assessment](integration-assessment-95d7741-2026-11-06.md). Actual producer/runtime composition and business acceptance remain open.

## Diagnosis and change

At presenter base `906aa44d2a277753327a4c5d0c8d9e77132f10d4`, the controller expected integer `outcome.value.released`. The actual FUCQ-92 source at `15a79957e61d81612311d3aab7dbf77733dc4e0d` supplies newly released `orderUuids`, with no such integer. The mismatch was established by source review; no actual producer/runtime execution is claimed.

The controller requires one registered `stock-release` / `release-pull` handler and one successful matching outcome. Current run, tick and event identities must agree; the result must have a known kind and a unique array of exact lowercase UUID-v4 order IDs. A genuine empty release reports zero. Missing, malformed, duplicate, pending, refused or mismatched evidence reports release unavailable. Cumulative `visibleOrderUuids` and unrelated integer fields never determine the count. A committed release remains visible if a later handler becomes pending/refused.

Command bodies/retries, real reset cookie recovery/navigation, picker/focus identity and the six business preparation gates were not changed. No FUCQ-92 module or foreign composed-runtime source was imported. FUCQ-100 remains central writer and FUCQ-103 registry writer; paused FUCQ-96 remains paused.

## Selected validation

Both explicitly selected modules passed, serially, against unchanged frozen inputs:

```text
/opt/homebrew/bin/node --test --test-concurrency=1 server/test/gcsp-presenter-controls-render.test.js
/opt/homebrew/bin/node --test --test-concurrency=1 server/test/ui-ratchet.test.js
```

The controller module exercises positive/zero/replayed release, committed release followed by later pending/refused work, and 28 named invalid-result variants. Existing command retry, reset recovery, workspace/HTTP adapter, authorization and keyboard/focus regression cases remain in that module. V8 file-worker observations confirm execution of `releasedCarCount`, `exactOrderId`, controller projection, HTTP adapter and workspace functions; these are not per-assertion coverage claims. The ratchet checks the existing component boundaries and stylesheet caps.

`test_stamp.py --targeted 906aa44d… --command '<the two explicit files>' --reason '<owned contract and component coverage>' --dry-run` confirmed the explicit scoped plan. Actual execution used the owned supervisor, not an automatic broad selection. The Node reporter's text did not match the receipt's summary extractor; module exit status and observed function coverage are retained, and no numeric test total is claimed.

The [result receipt](release-result-results-2026-11-06.json) records commands, source hashes, executable/dependency identities, timing and cleanup. Its frozen plan contains 2,085 exact file identities, including a conservative block-source/ratchet input set and both adopted installed dependency trees. The controller's literal relative module closure contains 25 modules and no unresolved path. Installed dependencies were read in place, with no install or copy. Plan/source digest: `5ad82861590e2fb08236dbcab79d0f2dd236c03ba8c18a4605fdd0ee16788ba2`.

## Resource receipt and independent teardown

Each chunk had a fresh HostBudget and one worker, limited to 120 seconds, 768 MiB RAM, 128 MiB scratch and 2 MiB log. An external ownership manifest preceded every scratch root; the supervisor supplied owned TMP paths, removed Node/npm option and database/PG environment aliases, stopped/joined owned process groups and released reservations in finalizers. No database credentials were read.

| Selected module | Process wall seconds | Peak RSS bytes | Removed scratch bytes |
|---|---:|---:|---:|
| Controller/adapter | 1.115 | 277,299,200 | 3,170,400 |
| Component ratchet | 0.295 | 27,262,976 | 299,104 |

A separate post-exit audit verified both owner/child start identities absent, both process groups absent, both exact scratch roots absent, no matching open files, no owned reservations and no successful verbose logs. All 2,085 source identities and dependency links remained unchanged. Retained output is the finite plan, concise receipts, ownership records and impact summaries under shared `.claude/test-runs/fucq126-release-result-20261106/` and `.claude/test-runs/impact/`. The bounded local scratch exception was macOS Node IPC/V8 coverage; no scratch remains.

## Remaining evidence

This is selected controller/adapter and component proof. No browser, listener, native database, full-suite, source-provider or mixed-runtime execution was admitted or performed. The changed count/copy has no new browser capture; the earlier 34 browser checks and 50 inspected captures keep their original source identity and scope.

Actual authenticated HTTP-to-controller release proof still needs the real FUCQ-92 producer composed with canonical FUCQ-100 services. Trusted provider data for each new run after reset and reviewed atomic business preparation remain central integration gates. All six authored business scenarios remain unavailable; this repair establishes no business journey completion. All seven product-map slice states, Jira observation time and recorded worker observations are preserved. Agents: parent only; no new delegation.
