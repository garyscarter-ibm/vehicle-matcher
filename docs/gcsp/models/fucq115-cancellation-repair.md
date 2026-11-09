# Cancellation-safe launch proposal

Current follow-up: `fucq115-finalizer-repair.md` extends this5724a80 author-only
proposal for finalizer entry, direct-handle wait/escalation and receipt-write
failure. Its admission5b15f6d4 supersedes the historical2c7596db table below.
Neither author-only proposal has runtime proof or an execution grant.

6 November 2026. Dispatcher authorised author-only repair/refreeze after accepting
the actual activation result. No new execution grant, runtime reproduction,
lifecycle test or activation/training/settings/metrics/full run accompanies this
proposal. Original failed918ce04 and successful73533d7 evidence stays unchanged;
publication checkpoint `c4b72aaf53b412f4092bd8925ffd0bb6c7831b84` remains its parent.

Diagnosis: source review of73533d7 confirms the reported gap. The supervisor's
local `Popen` result existed before `tree.register` captured and persisted it.
Handled cancellation between those statements could leave `tree.process` empty;
`_stop_join` could then mark joined and `proof` could accept an empty ownership
list. The affected consumer is the finalizer's process-proof gate before scratch
deletion and reservation release. This is a possible interruption path, not a
claim that the accepted run hit it; independent kernel/ledger/scratch absence
evidence for that run remains valid. Shared helpers and production code are outside
the repair. The current diagnosis and exact static basis are also in the Story's
Decided section and `fucq115-cancellation-repair-receipt.json`.

`ProcessTree.launch` now owns creation. It temporarily defers handled SIGTERM and
SIGINT, persists a `creating` state before `Popen`, retains the returned handle in
the tree, registers the leader/recursive observations, saves `registered`, and
reads the manifest back strictly before clearing a pending latch. Previous signal
handlers are restored before a deferred cancellation raises KeyboardInterrupt.
Thus cancellation can escape before the supervisor's local return assignment
while the tree already holds the handle and persisted ownership. The supervisor's
finally block recovers that handle for pipe closure as well as tree cleanup.

An exception during creation, initial registration or readback leaves the pending
latch set. Both `_stop_join` and `proof` reject incomplete registration, including
creation that did not return a handle. An existing unregistered handle is retained
as an unknown-start PID/group when possible and receives direct stop/join best
effort in `finally`, even if metadata persistence/probing fails. That best effort
never clears the pending latch: scratch and reservation stay preserved rather
than accepting absence. Original descendant identity checks, strict snapshots,
ledger semantics, gate byte, log/resource bounds and finalizer deletion/release
conditions stay in force. No new numeric-group signalling is introduced.

Only the owned supervisor and resource helper changed executable bytes. The
refreeze retains204 nodes,138 installed files/14 packages/37 absence probes and
all77 immutable source rows/4,349,951B. Exactly two node identities changed, only
their content length and SHA;202 nodes and all other admission fields match the
accepted admission. Source graph, entry, launcher, artifact and data/settings
inputs are unchanged. The original admission is recoverable byte-for-byte from
73533d7 or c4b72aa with SHA1fc1376aadeaa5e6652bf923356ae457074ae43697750f819ddb31934b55c9d9.

| Review file | SHA-256 |
|---|---|
| `fucq115-activation-admission.json` | `2c7596db6b70126e71bda2902b4aeec92c3f1d883963ad1f175fdb4f0667e073` |
| `fucq115-activation-resources.py` | `b759c332df8393a7a0ded5f287406631295aba2c706105a332afc7961c7f4c55` |
| `fucq115-activation-supervisor.py` | `0c9c5d6241ec5cd56349ecb099dc2036b07a22f90128ae632e651eae1630d230` |
| `fucq115-activation-freeze.py` | `28ad3a2fa5af1a8a6fa37244dfa15481c7fe1dfa5725f032d7f45b69c9e0b192` |
| `fucq115-activation-source-plan.json` | `f884ae94ff85455aa8d56c38e0ed7e2be58d960a862e99359f5f318694fa65aa` |

Author checks passed: AST parse and compilation without execution; static
single-Popen ownership/call-site and cleanup-guard checks; complete metadata
refreeze/delta; unchanged entry/source catalogue/artifact and original receipts.
These checks do not prove signal timing, OS stop/join behavior or the repaired
lifecycle. No changed lifecycle module import, Node, OS process query, resource
reservation, test scratch or reproduction was used for these checks. Git reads
through the unchanged scaffolding helper were limited to immutable source/evidence
and the fixed shared-ref comparison.

Before any runtime use, independently review this exact delta and agree only the
needed finite lifecycle fault checks in `fucq115-final-validation-plan.md`, with
their own bounded source/admission and grant. The current activation entry would
replay already accepted behavior and is not selected merely to test the harness.
Any final integrated selected/full proof needs its own agreed combined source,
not just this activation catalogue. No execution command is authorised here.
