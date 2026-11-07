# FUCQ-71 acknowledgement adoption into FUCQ-100 — 6 November 2026

Adopt only the published acknowledgement correction at `698887b55b134d4d6d4e95642cc93b9ea9603f73`, plus its owning test suite and response fixture. The ordering production file is byte-identical to that checkpoint; no foreign branch is merged. Existing FUCQ-100 runtime/cart/lifecycle composition remains.

The actual FUCQ-112 consumer reads top-level `renewalId`, `orderUuid` and `occurredAt`; the old acknowledged receipt supplied `at` and nested `order`. The correction pins consistent existing employee/default-slot renewal authority before allocation. A hold alone, missing authority, malformed IDs or disagreement leave explicit null. Only a confirmed handoff adds the consumer fields; existing `at` and `order` remain. A delayed acknowledgement keeps the pinned old renewal and cannot suppress a later renewal. Old operations are not backfilled.

The owning 29-pass/one-optional-skip evidence and independent code/security reviews remain scoped to their original branch and pinned consumer. This adoption imports the existing local `RenewalCaseService` normally. It also replaces the owning optional mutable FUCQ-66 worktree injection with static imports of this candidate's actual manual-context/claims/stock adapter. All authored seam cases are now unconditional; no environment source injection, copied consumer predicate or substitute service exists. These tests have not run on the combined candidate.

Selected next validation is the actual `server/test/gcsp-manual-order.test.js` suite, including acknowledgement/tick suppression, eight authority variants, delayed acknowledgement across a renewal change, pending/failed handoffs and actual manual claims conversion. Existing consumer/runtime contracts and the authored final integrated suite still apply. The separate registry grant is consumed; it does not authorise this next execution. No syntax/import/test/setup/probe/allocation occurred while adopting. No screen change or rendered evidence is claimed.

Current source identities:

- `server/gcsp/manual-order/index.js`: `a12f7c2abfb4e487355cee999359859b0936b9a22075755884087566c7a42c8c`.
- `server/test/gcsp-manual-order.test.js`: `d6b2a63f9a89139cdc15c2f55136d530b0c04a5450b6c5d6a42b8f8dc847f709`.
- `docs/gcsp/evidence/fucq71/response-fixtures.json`: `13a9df42020c7b802011c03cd081f04e141b4667da4506bc5a6fb673d220a30d`.

Independent source review: Stanley Tiger PASS; report `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/reviews/fucq100-fucq71-adoption-source-20261106.md`, SHA256 `f9f5e7629888b4a0fffd2c4f4b74e89c988691c01f1f921fb6069a088b220d05`. Requested/selected `gpt-6.1-sol` / `high`; no fallback or descendants. Current adapted-suite execution remains ungranted.
