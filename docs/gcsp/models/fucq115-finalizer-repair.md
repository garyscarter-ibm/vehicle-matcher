# Finalizer entry and direct-handle refinement

6 November 2026. Author-only follow-up to5724a80 and the dispatcher's concrete
finalizer-entry/direct-handle notice. This is the current future-harness proposal;
it supersedes the earlier author-only admission2c7596db. No runtime reproduction,
test or new execution grant exists. The actual73533d7 activation and independent
261-check audit remain accepted at their original identities; no model/data/
training/settings/metrics/activation replay follows helper authoring.

Source review confirms two remaining interruption edges in5724a80. Raised handled
cancellation could leave the supervisor's first cleanup block before it entered
the later `Finalizer.finish` block. Inside the direct-handle fallback, a poll or
terminate exception could skip wait and kill escalation. Separately, the finalizer
set its attempted latch before a stable result existed, and a final receipt-write
failure escaped its result return. These are future-harness control-flow findings,
not claims that an accepted run hit those paths. The diagnosis and exact source
basis are in `fucq115-finalizer-repair-receipt.json` and the Story's Decided section.

The supervisor now enters `CancellationScope` before execute can allocate test
resources. Its SIGTERM/SIGINT handler only latches bounded signal identities.
Safe checks turn that state into KeyboardInterrupt before acquisition/launch,
during sampling before the launch gate opens, and during final verification.
The finalizer attaches to this active scope before host acquisition. Scope exit
calls it unconditionally before restoring handlers, including when manifest or
pipe operations prevented the supervisor reaching its own finalizer block. The
existing narrower creation/registration guard remains. No `atexit` callback is
the sole cleanup path for handled cancellation or manifest-write exceptions.

Fallback `stop_direct_handle` now attempts wait even when poll/terminate raises;
an unresolved first wait proceeds to kill and a second wait. Error recording
requires no manifest I/O before these attempts. It returns joined only after a
successful wait; unresolved join raises and resources stay preserved. Original
pending-registration refusal and exact descendant/PID-start ownership rules
remain. This change does not authorise signalling a foreign numeric process group.

The finalizer creates its stable failed result before setting attempted. Receipt
write exceptions mark that result failed and return it for safe reentry, instead
of returning None or claiming a successful unpersisted receipt. Process proof,
scratch physical/open-file checks, absence-before-deletion and strict owned
reservation release are unchanged. A failure after a reached physical cleanup
retains its actual absence fields while reporting failed receipt publication.

Static AST comparison verifies the entire `make_budget` definition unchanged from
5724a80, including strict malformed/duplicate/foreign ledger handling, no pruning,
owner identity, accounting bounds and owned release/readback. `process_snapshot`,
`definitely_absent` and `make_scratch` are also AST-identical. No shared helper,
dependency, source graph, immutable artifact, data or policy input changed.

| Current review file | SHA-256 |
|---|---|
| `fucq115-activation-admission.json` | `5b15f6d48946d64b5e075d07e8e6c6cf6cd788bf22b7721428b6d1688176bce8` |
| `fucq115-activation-resources.py` | `40f2446431b7588336fcf8750581a7b87d03a059e77ccb7a1182363085e351d2` |
| `fucq115-activation-supervisor.py` | `efeec15e17936f6bd9bcae347fc384f4eb80b20a3b5d3822fa626a16323bcd14` |
| `fucq115-activation-freeze.py` | `28ad3a2fa5af1a8a6fa37244dfa15481c7fe1dfa5725f032d7f45b69c9e0b192` |
| `fucq115-activation-source-plan.json` | `f884ae94ff85455aa8d56c38e0ed7e2be58d960a862e99359f5f318694fa65aa` |

The metadata refreeze changes only supervisor/resources content length and SHA:
202 other nodes, all other admission fields,138 installed files/14 packages/
37 absence probes and all77 source rows/4,349,951B are unchanged. AST parse,
compilation without execution, static scope/finalizer/direct-handle call-site
checks and unchanged-evidence comparison passed. No changed lifecycle module,
JavaScript, Node, OS process query, resource reservation or test scratch ran.
Immutable Git comparisons used the unchanged scaffolding read helper only.

Independent helper review must precede any required runtime selection. The
minimum proposed lifecycle cases are in `fucq115-final-validation-plan.md`; none
ran. Parent owns the actual FUCQ-100 central-composition/consumer-repair/source-
impact checkpoint, then combined-source/full coordination. No full grant exists.
Actual corpus/outcome-producer dependence stays parked. No calibration or
live/native/producer pass is inferred from structural fixtures or author checks.
