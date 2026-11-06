# Actual activation attempt stopped before allocation

6 November 2026. One exact command ran under independent admission PASS and
`fucq115-activation-918ce04-0139`, on source
`918ce04510fd327e860809e7de53bd636d1cf7da`. It exited1 at the first strict
`process_snapshot()` inside `make_scratch`, raising `SnapshotUncertain: OS process
snapshot is incomplete or malformed`. No retry, source change, data generation,
training, settings change or metric recomputation followed.

Reached: the frozen204-identity admission,138 installed files/14 packages and37
missing-resolution probes; all77 immutable source rows/4,349,951 bytes; the
allowlisted environment; the external execution plan and empty retained directory.

The failure preceded ownership-manifest/checkpoint/finalizer registration,
HostBudget construction/acquisition, Scratch.__enter__, and every Node/gated
launcher/runtime/cookie/clock/policy/activation call. This is a preallocation
launcher failure. It is neither an activation pass nor a cleanup-after-allocation
pass. No reservation was acquired, ledger mutated or test child/scratch directory
created by the reached path. The completed Python launcher and its synchronous
metadata probes exited; no Node process was started. No process-absence proof is
invented for a phase that did not run.

The run directory is:

```text
.claude/test-runs/fucq115/artifact-activation-v2-9efcc10376a148da9ca09142fb576a38
```

It originally contained only `plan.json` and an empty `retained/`: no ownership
directory or execution checkpoint. `launcher-failure.log` now preserves the exact
stderr copied from the completed tool result, which also remains in the chat's
original transcript. `failure-receipt.json` is explicitly post-attempt evidence,
not a manufactured execution checkpoint. The committed compact counterpart is
`fucq115-activation-run-receipt.json`. Plan SHA-256:
`6be5544bf1930ded5eae13713944498941100a214b1ce274db01d6780ff9f481`;
launcher stderr SHA-256:
`a3c62b262f614a58dbf4e74f484144b2604b0c7b24e45343ab950e34876d34b5`.
No successful activation command/report exists.

A post-attempt stdlib-only physical/content audit rechecked all204 frozen rows,
138 installed files/14 packages and37 absence probes: unchanged. No helper import,
Node or further OS/process proof was launched by this audit. The worktree dependency
link remains absent; installed dependencies, immutable artifact and original
77-row source catalogue remain unchanged.

Diagnosis is bounded: the strict snapshot validator refused the initial host
query. It does not persist the specific rejected row/global query condition at
this preallocation boundary, so the cause is unresolved. The next diagnostic
needs bounded rejected-field/query evidence before any parser repair is justified.
No assumption about the invalid field or OS state is claimed. Future diagnostic,
source/harness repair and execution scope remain with dispatcher review; the
single grant is consumed and no automatic retry is permitted.

Actual dated activation and final scoped/full integration remain open. Existing
training/evaluation/artifact evidence retains its original identity, adverse
Brier scores, optimizer iteration-limit and thin synthetic structural support.
Story completion, acceptance and production activation are not claimed.
