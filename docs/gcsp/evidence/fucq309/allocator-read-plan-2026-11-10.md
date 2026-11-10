# FUCQ-309 allocator read ownership implementation plan

**Goal:** complete the original default comparison at unchanged inputs and worker policy by keeping the allocator's private pending-plan reads compact.

**Architecture:** retain ordinary mutable, caller-isolated repository reads. Add an optional comparison-private allocation receipt read that returns an explicitly immutable modern pending plan and projects quote inputs before cloning. The allocator uses this capability when present, keeps its ordinary and legacy fallback, and ends transient preparation ownership before processing claims. Existing allocator/repository components and their connection are unchanged; the design-with-drawio internal-refactor exception applies.

**Tech stack:** existing Node.js ES modules, generic repository composition and built-in node:test; no new dependency.

**Spec:** original FUCQ-309 fixed acceptance, `docs/gcsp/build-rules.md`, `docs/gcsp/experience-quality.md`; independent assessment and authorised shared scope are retained in `.claude/dev-poller-20261110/fucq309-architecture-review.md` and `fucq309-shared-scope-decision.json` in the shared checkout.

## Current diagnosis and constraints

All three canonical HTTP attempts remain failed after one of six steps with zero results. The current c7 source crosses first normalization and detached plan readback, reaching 125.29 MiB sampled used heap. Ordinary recursive cloning expands shared committed storage into a large mutable graph retained through claim processing. The quote cache retains complete evaluation bodies although reconstruction consumes only quotes/quoteInputs. Preparation ownership after commit was not measured; lexical scope alone proves no collection.

`backend-work-start` is after queue acquisition and shallow draft/table-array creation. The missing second marker does not prove no transaction entered; possible draft creation, cursor reads, identity/quote and claim setup remain uninstrumented. The exact terminal operation remains unknown. Preserve the canonical-v3 245.865-second sampling gap and differing application/supervisor clocks without a speed or continuous-responsiveness claim.

The parent reassessed shared ownership: topic f6175561 and supported main 95f39141 share allocation blob `7594c82620a340bc8e6ff2799c8ad9fbc4241c96`; no active GC claim was found. Archived GC leases are preserved. Recheck newly observed overlap before shared writes/integration.

Only `server/gcsp/comparison/private-repository.js`, narrow `server/gcsp/allocation/index.js` consumer changes, proportionate tests and records are authorised. Generic core/memory, shared hold/offer writers, allocation choices/order/values, policy, 128/16 MiB limits, 1,800-second deadline, original AC and source/access boundaries stay fixed. No descendants while four slots are occupied. Lead requested/selected Sol/xhigh, no fallback, implements in the existing worktree under the capacity-zero exception.

## One coherent repair slice

Files: the two authorised production paths; `server/test/gcsp-comparison-memory.test.js`; a narrow allocation ownership test file and its existing fixture helper only where provider injection is required. Existing allocation, route/measures and job tests remain unchanged unless a demonstrated regression requires an assertion.

Proposed private extension:

```js
await repository.readAllocationReceipt(context, receiptRef, 'plan');
await repository.readAllocationReceipt(context, receiptRef, 'quote-inputs');
```

The method uses the same serialized state and unchanged generic read validation over a minimal receipt projection. It must validate context, environment, reference and run scope before returning an alias. Only deeply immutable rows owned by a branded comparison store qualify for plan aliasing; unsupported/legacy forms use ordinary detached reads. Quote-input projections are selected from committed data before the generic clone, and contain only existing quotes/quoteInputs. Invalid context, rolled-back data, missing rows and closed handles retain their ordinary refusal behavior. No raw mutable stored row escapes.

Allocator fallback and cache shape:

```js
const readAllocationReceipt = (context, reference, projection) =>
  typeof repository.readAllocationReceipt === 'function'
    ? repository.readAllocationReceipt(context, reference, projection)
    : repository.read(context, reference);
// The cache owns only consumed quote material, even with an ordinary provider.
const { quotes, quoteInputs } = slice.value.outcome.value;
sliceRows.set(contender.employeeId, { quotes, quoteInputs });
```

- [ ] Correct the public phase interpretation and record this diagnosis before production edits.
- [ ] Add a regression proving modern view reads reuse deeply frozen committed plan storage, while ordinary reads remain detached/mutable and quote projections exclude evaluation data before cloning. Test run/environment/ref validation, collision variants, rollback/replay, close, and unbranded-store fallback. Run the new exact selection red against c7 and retain the expected missing-capability failure.
- [ ] Implement the private optional read and small allocator consumer. Move prepare-and-record ownership into an awaited helper that returns only the existing marker before reading the committed plan. Keep normal cursor reads mutable, legacy plan/cursor paths compatible, and completed-result/hydration reads ordinary.
- [ ] Add/execute real allocation regressions using both providers: completed outcomes/replay, pending retry, legacy inline quote/plan/cursor forms, caller mutation isolation and quote input cache behavior. Assert real allocation effects, operation IDs and independently hand-checked results.
- [ ] Review the production diff against fixed AC and every consumer boundary, run the selected green chunks, then commit/push the coherent repair. Keep all historical failed/skipped/unrun checks.
- [ ] Return exact production/test hashes, scoped evidence and measured 100/300 equality/ownership data for independent scoped review before a new canonical run.
- [ ] After review, run one bounded canonical-scale first-buddy checkpoint to measure compact view and actual preparation lifetime; then the original actual HTTP 1,000/three-seed/six-step 128/16/1,800 proof. No speculative proof series, extra allowance or fixture substitute. Only the full stored truthful result can satisfy canonical acceptance.

## Selected validation and resource contract

The shared impact record `.claude/test-runs/impact/fucq309-20261110-plan.json` is reviewed and refreshed for each production identity. Start with focused private ownership/projection regressions, then exact collision variant and private repository contracts. Run affected `gcsp-allocation.test.js`, triggers/runtime/identity allocation callers and the new ownership regression; then current/buddy/measures, exact 100/300 input/record/decisions/totals/measures diagnostics, and worker/job/HTTP checks on a stable tree. Reuse unchanged generic contract evidence; native PostgreSQL/F71 process readback and full suite remain unrun because this is a bounded private read/allocator-consumer seam.

All tests/proofs use the existing FUCQ-309 supervisor, external ownership manifest, machine-wide reservation and owned TMPDIR/TMP/TEMP. Initially one worker, 1,024 MiB RAM reservation, at most 64 MiB scratch, 2 MiB bounded logs and at most 600 seconds per chunk. Expected scratch is near zero and peak RSS below 512 MiB for focused checks; split/replan if measured timing/allocation requires it. Coordinate the host budget with the parent's B runner. A later indivisible full HTTP proof needs its separate 1,900-second plan against the unchanged 1,800-second application deadline.

Checkpoint code/input/environment identity and results outside scratch. Finalizers stop/join owned children, remove scratch and independently verify absence. All 43 preceding completed roots were absent at handoff. Preserve the unconfirmed 102,133-byte jira_sync bytecode. Retain concise evidence; no heap snapshots, archives or large output are planned. No UI source/contract changes are intended; unchanged exact outputs can support skipped UI critique, subject to review.
