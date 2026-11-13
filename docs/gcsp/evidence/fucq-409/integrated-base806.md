# FUCQ-409 integrated-base validation — 13 November 2026

Result: **built**, original four criteria still supported. Worker merge `2003405b37b386cefdd85557a1f09f7a8b5e4371` has parents `732365f1b7ec6d39a22eb9d45a9fe03bdb0f3dea` and dispatcher-selected base `806d481647cb467f01d0cfcf45cf1d172a61c956`. The scaffold Git API held the shared checkout mutex and merged into the worker without conflict, with the Codex trailer. No base push/merge, Jira write, closure or claim/worktree deletion was performed.

The base adds claims, design/contract updates, the Java foundation and FUCQ-422's repository mutation journal (`b28dae05`). It does not change the allocation implementation or existing GCSP UI. The migration overlays explicitly retain the native performance Story's authored Node acceptance; they do not expand this Story to Java, OIDC or actual email delivery. FUCQ-414's recommendation/vehicles lane remains separate from this allocation writer.

Preservation audit: all **301 other Story map rows** exactly match the base, including observations/worker claims. All **421 base `_dev` files** except this Story's own Result match their base blob identities, retaining newer claim and lifecycle metadata. This Story's original four acceptance texts remain unchanged. The worker's result/slices and reviewer receipts are retained.

## Selected revalidation

Executed once on clean merge HEAD `2003405b`, tree recorded in `integrated-base806.json`:

```sh
node --test --test-concurrency=1 \
  server/test/gcsp-allocation.test.js \
  server/test/gcsp-allocation-ownership.test.js \
  server/test/gcsp-allocation-index.test.js \
  server/test/gcsp-allocation-runtime.test.js \
  server/test/gcsp-scenario-main-journey.test.js
```

**39 cases: 38 passed, zero failed/cancelled, one skipped**, native PostgreSQL URL unset. Supervisor exit 0, 106.146 seconds, sampled peak RSS 704,577,536 bytes, peak scratch 1,212,672 bytes removed. This is scoped integration evidence, not a full-suite or native PostgreSQL stamp. The older targeted operation stamp remains historical matching-source evidence; no new stamp is fabricated.

- AC1: semantic/service regressions and actual-source identity/order assertions pass after the journal merge, including revision/provenance, deterministic contenders, retry and replay.
- AC2: mixed eligible/ineligible missing/ambiguous date cases pass; guards and date selection are unchanged.
- AC3: actual construction/lookup operation proof and composed visible-pool index counts pass. The claim remains limited to stock resolution.
- AC4: connected runtime/main journey pass on the integrated repository, including real hold/offer/outbox, stale and occupied first-claim fall-through and replay. All 20 source/input hashes recorded for browser run 6 still match, including every captured view/controller, allocation, stock and scenario source. Repository core changed indirectly and is covered by this fresh connected run. Reuse all 14 independently inspected captures and Cool Cat's original read-only review for the unchanged implementation/screens; no new rendered review is claimed.

Allocation SHA256 remains `9c6153bbdd4e32ebcf5d2e87a2fd251472ef0980e1ea8279d980ebbf6efe4b1c`. Integrated repository core SHA256 is `e380c7fa9047bcd17485ca5788af85160a12ab4ad074e976696814f295aa73e3`. The resource supervisor verifies selected source hashes again after execution.

## Evidence and resources

Local retrieval directory: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq409/`. Retained files: `integrated-base806-plan.json`, `run-base806.py`, `integrated-base806.json`, `integration-base806-before.json`, `integration-base806-identity.json`, `integrated-base806-resource-receipt.json`, and `logs/integrated-base806/chunk-0001.log`.

One worker, 1,536 MiB RAM and 64 MiB scratch reservation, 300-second chunk limit, five-GiB reserve; installed `test_resources.py` owns process-group, scratch and host-reservation finalization. Final read-only audit confirms **all 17 owned manifests removed, all scratch roots and process groups absent**. Existing ignored dependency links remain as directed. No new large output/archive was produced. The prior OneDrive capture location and local-copy/cloud-sharing limits remain unchanged.

Final metadata checks passed: Story schema, whitespace, selected source/capture hashes, original acceptance/claim identity and own-row-only map changes. Product map builds 20 components; FUCQ-409 has no conflict, no active worker and 100% developed/awaiting Story review transition. The six pre-existing unrelated FUCQ-58–63 diagnostics are unchanged.

Lead Charlie Dog: requested/selected/effective `gpt-6.1-sol/high`, no fallback, saved title verified; owns this revalidation and final receipt. Reviewer Cool Cat: requested/selected/effective `gpt-6.1-sol/high`, no fallback, title/runtime verified; original review chat `01a1d702-b216-79d0-b864-c322cdfef3cd`, scope `ef586adf..3575614b`, no allocated tests/browser/service/scratch. No child or descendant was launched for this integration checkpoint. Parent dispatcher retains worker publication, serialized integration, Jira transition, closure and final cleanup; built does not infer collaborator acceptance/Done.
