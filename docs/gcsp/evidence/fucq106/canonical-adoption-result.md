# FUCQ-106 canonical adoption checkpoint: incomplete

6 November 2026. The exact reviewed `fa3320c` supervisor ran **once** under
dispatcher grant `fucq106-canonical-fa3320c-0033`. Result: **3 tests, 2 passed,
1 failed, 0 skipped, 0 cancelled**. No retry or acceptance claim follows.
The earlier 25/25 independent and 12/12 actual-memory evidence was not rerun.

The passing first test proves actual 103 canonical reason adoption and current-run
activation over the same real MemoryPolicyProvider reaches actual 106 reason
projection and confirmed local decline. Actual 100 supplies the offer/quote;
actual 102 supplies token/account capabilities. The original adoption command
retry appends no duplicate version, cross-route decision replay stays immutable,
and reason/exclusion provenance remains separate from the older quote-price pin.

The passing third test proves a real dated reason-label publication/activation
reaches the in-process 106 HTTP registry projection through the same actual 102
access instance. Earlier canonical decline, source event, quote and retained old
reason read remain unchanged. This is backend memory evidence, with no listener,
browser, runtime-host or actual 107/108 consumer claim.

## Failure diagnosis and authorized draft correction

The second test failed at its initial price comparison, before successor price
publication or acceptance. PolicyService returned scalar `monthlyPoints: 1100`;
the actual 100 quote retained the typed value
`monthlyPoints: { value: 1100, unit: 'points' }`. The assertion compared these
different shapes. Their numeric values agree; this demonstrates a new test
contract mismatch, with no demonstrated product/quote projection defect.

The failed check did **not** prove real repricing publication followed by
acceptance of the retained quote. That integration assertion remains outstanding.
The full original 1,780-byte TAP log is preserved byte-for-byte in
[canonical-adoption-original.log](canonical-adoption-original.log), including all
three test names, failure location, actual/expected values and totals.

The dispatcher subsequently authorized only a narrow test correction. One line
changes from:

```js
assert.equal(price.monthlyPoints, quote.monthlyPoints);
```

to:

```js
assert.deepEqual(quote.monthlyPoints, { value: price.monthlyPoints, unit: 'points' });
```

It preserves numeric value **and unit**, performs no coercion, and changes no
product, quote projection or later publication/activation/acceptance assertions.
The correction is **unexecuted**. All 42 feature module and six JSON pins,
supervisor and loader bytes remain unchanged. Original executed source manifest
`ad78da691bf9eaac00e5ffeeda3b851bb096b18bc9640b77ac4b85355b6aa514` is retained as
[canonical-adoption-executed-source-plan.json](canonical-adoption-executed-source-plan.json).
The current source plan pins the corrected draft and therefore no longer matches
the consumed execution gate. Fresh review/allocation is required before any run.

| Review input | SHA256 |
|---|---|
| Revised source plan | `db0dfa478ddef3594abe5c74c0aaeddeefc61e9bd8fcedee4c0ba832ec178746` |
| Corrected test proposal | `f31dcf480816fec2e9fc8040e87a15d1cbf02ef77222ca0ab1f7894329b4b63f` |
| Unchanged supervisor | `18f1ada157ee7ddda8d9a68ef9159d83cee55b2ca7d71fc5bb2d0b2e06e82a73` |
| Unchanged loader | `9fb07801d9b82066aa8ce8b679d085fbf4c8f74d5348e566acf644c7f3ad4a2a` |

The next meaningful selected check is the formerly failed consumer case. The
existing reviewed supervisor still selects all three cases; selection/allocation
must be resolved by the dispatcher before execution. This checkpoint grants no
retry, harness expansion or duplicate successful-case proof.

## Resource and identity receipt

[canonical-adoption-checkpoint.json](canonical-adoption-checkpoint.json) ties the
grant, original reviewed source, tests, full log, result, journal, independent
source audits and final resource audit together. All **43 canonical module
identities** were observed, matching the 42-source-plus-test plan, with no duplicate
path in a process. The 42 source, six input, five harness and two accepted-receipt
pins match before and after the executed run. The later one-line correction is
separately identified and was not run.

Child execution took **3.284345583 seconds**; Node reported 2.878401917 test
seconds. Supervisor wall including immutable preparation was 6.201365541 seconds.
The outside observer measured 11.446099875 seconds including its source
preparation and final audit. The 120-second grant bounded child execution,
not every immutable preparation/audit operation. Sampled child peak RSS was
251,609,088 bytes and peak scratch was 1,167,200 bytes, within the one-worker
768 MiB RAM / 128 MiB scratch-output / 2 MiB log grant.

An outside observer preserved the original successful-and-failed TAP stream
before the exact supervisor removed scratch; it did not alter that supervisor or
feature bytes. Its source and identity are retained for review. After the observer
exited, a separate audit confirmed its PID/start identity absent, the supervisor
reaped, recorded Node PIDs/start identities absent, recorded process group empty,
scratch absent, HostBudget reservation released and the existing `pg` target's
hash/device/inode preserved. No dependency links were created. Retained original
run/audit artifacts occupy 80,809 logical bytes / 131,072 allocated bytes at the
recorded audit, with no large output or compatibility exception.

**Open-file limitation:** the reviewed supervisor calls `lsof` after scratch
deletion and ignores its error status. Its `openFiles: []` is **not** evidence of
a successful independent open-file scan. This checkpoint preserves that limit;
it claims the independently verified process/group/PID, reservation, dependency
and scratch facts above. The observer closed its log descriptor before exiting.

The original plan, full log, totals, journal, result, source-before/source-after
and final audit are retained under the two named run directories in the shared
`.claude/test-runs/fucq106/` area, and their reviewable copies/hashes are committed
beside this document. No feature source changed. Story status remains blocked;
canonical price-publication/acceptance, remote decisions, actual consumers,
runtime/native/full and rendered acceptance gates stay open.
