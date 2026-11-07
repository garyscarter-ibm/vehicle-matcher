# FUCQ-106 corrected canonical adoption checkpoint

6 November 2026. The reviewed `90cb70ce951a4c9de934e792b8b7fbee0665d934`
package ran **once** under the separate dispatcher grant
`fucq106-typed-90cb70c-0033`: **3 tests, 3 passed, 0 failed, 0 skipped,
0 cancelled**. The grant is consumed. No further execution is authorized.
Story status remains **blocked** on the remaining integration and acceptance gates.

## Reached memory evidence

All three cases use the same real MemoryPolicyProvider read/publication views,
actual FUCQ-100 producer, actual FUCQ-102 private token/account capabilities and
FUCQ-106 decision service with the stored-subject evaluator. Canonical FUCQ-103
source is `0d3a0aa2fcee5d26ad33e587578cff7cce169090`.

1. Reviewed reason adoption and run activation reach the 106 registry and
   confirmed local decline. Replaying the adoption command appends no duplicate
   version; token/account decision replay returns the original outcome. Current
   reason/exclusion provenance stays separate from the retained quote-price pin.
2. Actual dated price publication and activation change the current price.
   Acceptance uses current eligibility while preserving the exact immutable held
   quote, including typed points value/unit and its older price-policy version.
3. Actual dated reason-label publication and activation reach the in-process
   `decision-reasons` HTTP projection through the same actual 102 access instance.
   The historical decision, source event, quote and retained reason stay unchanged.

This is scoped backend memory evidence. Central host/route composition, rendered
105 states, remote selection/release uncertainty, actual 107/108 consumers,
native PostgreSQL and authored full validation remain open. No browser, listener,
network, mail, real-provider or deployed acceptance is claimed. Existing 25/25
independent and 12/12 actual-memory evidence was reused unchanged and not rerun.

## Separate original failure retained

The original grant `fucq106-canonical-fa3320c-0033` reached **2 passes and 1
failure**. That test compared scalar price `1100` with the quote's typed
`{ value: 1100, unit: 'points' }` before publication/acceptance. The dispatcher
reviewed the one-line expected-value correction; no product or quote projection
changed. The corrected run above is a separate execution and receipt.

The original [result](canonical-adoption-result.md),
[checkpoint](canonical-adoption-checkpoint.json),
[log](canonical-adoption-original.log) and
[executed manifest](canonical-adoption-executed-source-plan.json) remain unchanged.
Their statements that the correction was unexecuted describe that earlier
checkpoint; this new receipt records its subsequently authorized execution.
The original and corrected runs are not combined into a wholly passing run.

The pinned [source plan](canonical-adoption-source-plan.json) also retains its
historical planning status and bytes. Actual execution facts are in the new
[checkpoint](canonical-adoption-typed-checkpoint.json),
[grant](canonical-adoption-typed-grant.json) and
[review](canonical-adoption-typed-review.json).

| Reviewed input | SHA256 |
|---|---|
| Source plan | `db0dfa478ddef3594abe5c74c0aaeddeefc61e9bd8fcedee4c0ba832ec178746` |
| Corrected test | `f31dcf480816fec2e9fc8040e87a15d1cbf02ef77222ca0ab1f7894329b4b63f` |
| Unchanged supervisor | `18f1ada157ee7ddda8d9a68ef9159d83cee55b2ca7d71fc5bb2d0b2e06e82a73` |
| Unchanged loader | `9fb07801d9b82066aa8ce8b679d085fbf4c8f74d5348e566acf644c7f3ad4a2a` |

## Resource and teardown receipt

The [source audit](canonical-adoption-typed-source-audit.json) records all 55 pins
matching before and after: 42 source modules, six JSON inputs, five harness files
and two accepted receipts. The [module journal](canonical-adoption-typed-module-journal.json)
records all **43 unique canonical identities**, including the test, with no
per-process duplicate. The complete 966-byte [TAP log](canonical-adoption-typed-original.log)
has SHA256 `ecb0b74ac212ea73ece17cf98b38ff324e11c8b48273f7f6629104bf3e3a375d`.

Child execution took **3.716018542 seconds**; Node reported **3.376815 seconds**.
Supervisor wall including immutable preparation was **7.0334857909999995 seconds**;
the outside observer including source preparation and final audit measured
**12.080518709 seconds**. The 120-second limit bounded child execution, excluding
preparation and audits. One worker's sampled peak RSS was **261,767,168 bytes**
and peak scratch **1,167,200 bytes**, within the 768 MiB RAM / 128 MiB combined
scratch-output / 2 MiB log allocation.

The outside observer retained the original log before the exact supervisor
removed scratch. The [final audit](canonical-adoption-typed-final-audit.json),
after the observer exited, confirms its PID/start identity absent, supervisor
reaped, recorded Node PIDs absent, process group empty, scratch absent,
HostBudget reservation released and the existing `pg` target hash/device/inode
preserved. No dependency links or installs were created. The shared run/audit
allocation retained **79,455 logical bytes / 131,072 allocated bytes** at the
recorded checkpoint; there was no large output or compatibility exception.

**Open-file limitation:** the reviewed supervisor runs `lsof` after scratch
deletion and ignores its error status. Its `openFiles: []` is **not a successful
independent open-file scan**. Process/group/PID, reservation, scratch and dependency
facts were checked independently; the observer closed its log descriptor before
exiting. No stronger open-file claim follows.

This publication changes evidence, the story Result and its own map slices only.
No feature, test, loader, supervisor, original partial receipt, Jira status or
worker claim changes. No acceptance box is checked and no slice is complete.
