# FUCQ-309 scalar preparation localization plan

**Plan only. No launch is authorised.** The clean result is pushed as `6a7acab973c88a95371ad355223a30bdc3e2ef4c`. It still OOMs at 192.787 seconds after current completes at 135.235 seconds, with progress 1/6 and zero result rows. The next useful question is which side of the first buddy preparation receipt/normalization boundary fails. No further production repair is selected.

The proposed single diagnostic uses the same actual HTTP request, untouched production source and Node binary, original 1,000 employees, comparison-a/b/c, current+buddy, no overlays and 128/16 MiB worker limits. The 1,800-second application timer remains unchanged. Only its diagnostic worker imports the retained source observer; source transformations are explicit instrumented variants and cannot count as clean acceptance or comparative-speed evidence.

## Exact transformations and retained state

`transforms.json` contains every exact anchor/replacement and both original/transformed SHA256 values. `planned-source-diff.patch` is the complete diagnostic diff. Static parsing passed for all three transformed modules, the observer, HTTP harness and supervisor. Nothing was imported or executed for these checks.

| Original source boundary | Added scalar observation |
| --- | --- |
| `comparison/experiments.js`, before/after `openComparisonRun` and after `run.close` | First comparison-a/buddy route identity, ready and close. Only existing primitive seed/route/inputHash/policyHash and employee/car counts are passed. |
| `allocation/index.js:221`, `prepareAndRecord` entry and prepared destructuring | Preparation entry, then numeric slice/contender totals after `prepare` returns. |
| `allocation/index.js:224`, first line of the preparation transaction callback | Actual callback entry, distinct from the backend marker after queue acquisition and shallow draft creation. |
| `allocation/index.js:227`, after cursor `recordReceipt` returns | Cursor status, before its existing early return. |
| `allocation/index.js:231`, after each evaluation `recordReceipt` returns | A scalar counter emits only first, each 128th, final or non-ok completion. It receives `saved.status`, never the slice or outcome graph. |
| `allocation/index.js:234-236`, immediately before/after pending large-plan `recordReceipt` | Entry and completion status around the original await. |
| `comparison/private-repository.js:121`, before/after `work(draft)` | Backend callback boundaries for the selected recording transaction, with commit boolean only. |
| `comparison/private-repository.js:124`, before/after `store.state = draft` | Normalization boundaries around the original setter. |
| `allocation/index.js:315`, after the awaited helper returns | Helper status, then observation is disabled for further preparations. |

The observer retains booleans and integers; its transformation definitions are static source metadata. No run, repository, snapshot, plan, slice, receipt or outcome object is passed to or retained by it. There are no WeakRefs/dereferences, graph walks, forced GC, injected stops, added worker awaits/yields or additional timers. All business arguments, branches and existing awaits remain. Worker timing and GC can still change because any source observation adds work.

Output is at most 60 phase JSON lines plus three source-hash lines and one target-identity line. Only scalar fields are emitted synchronously to stderr. Reaching the cap stops observation without throwing. A logging failure disables observation; an incomplete/damaged log cannot support absence-based localization. There are no diagnostic `parentPort` messages and no transformation of `worker.js`, so pre-plan logging cannot enter the production startup protocol.

## Expected inference and limits

| Observed boundary before missing successor | Smallest supported interval |
| --- | --- |
| Prepared counts; no backend-before | Queue/acquisition or existing pre-callback shallow draft setup, including the existing forwarding yield. It does not prove no transaction entered. |
| Backend-before; no actual preparation-callback entry | Generic context/duplicate receipt/session/callback-entry interval. A new command is expected but not asserted as observed. |
| Callback entry; no cursor completion | Cursor receipt construction/await, including generic JSON validation, canonical digest, row and guard-return cloning. |
| Cursor completion and slice ordinal k; no next selected ordinal/large-plan-before | Evaluation receipt interval bounded by the last observed count. It does not identify a particular clone or retained object. |
| Large-plan-before; no completion | Large pending-plan construction/recordReceipt interval. Validation, digest, stored-row clone and guard-return clone remain distinct candidates. |
| Large-plan completion; no backend completion | Callback return and generic command-transaction receipt/finalization. |
| Normalize-before; no normalize-after | Structural normalization in the state setter. It does not identify a particular interned node or prove a retaining cause. |
| Normalize-after; no helper return | Receipt-index follow-up, backend return, serialized release or helper resolution. |
| Helper returned ok before a later OOM | First preparation recording/normalization passed; later plan/cursor/quote/cache/claim remains unlocalized. No additional observation/run follows automatically. |

Interpret absence only with an intact captured log, matching source hashes and unused observation cap. Any hook/hash/anchor failure is observer setup failure. A logged interval is a diagnostic boundary; neither the interval nor its heap sample alone proves the production retaining cause. The clean-v4 reproduction remains separate.

## Proposed one-attempt resource contract

Use one shared **768 MiB RAM / 32 MiB scratch** reservation, one worker and a **600-second diagnostic command limit**. The clean attempt measured 433.2 MiB process RSS and failed after about 193 seconds; 600 seconds bounds an unexpected continuation without adding a phase-triggered stop. The application still has its original 1,800-second timer. A supervisor timeout is an interrupted diagnostic, never evidence of successful acceptance.

Before any authorised launch, recheck the pinned HEAD/source/dependency/runtime/input/harness identities, current host demand, the machine reservation registry and free space. Serialize other heavy tests/proofs, use the 5 GiB emergency reserve and reduce independent work if below preferred 30 GiB. No large artifact is expected; >=256 MiB output would go directly to the existing OneDrive destination. No compatibility exception is planned.

The retained supervisor refuses a second launch for this run identity and sets `retryable=false`. Existing `test_resources` writes the external ownership manifest before creating an absolute scratch root, propagates TMPDIR/TMP/TEMP, checkpoints outside scratch and registers cancellation/finalization. Any exit/timeout must stop and join the owned process group, remove scratch, release the reservation and independently verify filesystem/process absence. Preserve only bounded logs, scalar phases, summary, identities and cleanup receipts. No automatically resumed run is allowed.

`plan.json` pins the exact proposed command, 303 production hashes, 65 dependency hashes, runtime binary, policy and deterministic input metadata. The `pg` hook remains resolve-only. `http.mjs` and `supervisor.py` are prepared executable bytes for review, not evidence that a run occurred. `static-preflight.json` records only static parsing; `identity-preflight.json` records read-only identity verification. No scratch allocation or worker/HTTP/replay attempt was made while preparing this plan.

The parent must review these exact transformations and inference limits before authorising a launch. Original acceptance remains unmet and unchanged. FUCQ-348 stays independent and unfixed; native PostgreSQL/F71/full-suite gaps and prior timing/observer caveats remain preserved.
