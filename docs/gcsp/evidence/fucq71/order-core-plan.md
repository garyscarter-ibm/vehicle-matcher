# FUCQ-71 isolated ordering checkpoint

Run: `fucq71-20261105-order-core`; branch `dev/DEV-2026-11-04-071`; claimed base `16433da`.

The first slice (estimated 8 points) implements the already agreed HLD ordering component, not a new architecture: versioned terms, one persisted selection intent per employee/entitlement, the existing claims allocation port, synthetic ordering and tick reconciliation. No runtime/HTTP wiring or screen. FUCQ-72 owns rendering against F64 `a7fc178`, `docs/gcsp/screens/README.md`, `COMPONENTS.md` and the experience contract. No human layout pause applies before the working demo.

Owned paths: `server/gcsp/manual-order/`, `server/gcsp/adapters/synthetic-ordering.js`, `server/test/gcsp-manual-order.test.js`, `docs/gcsp/manual-order-contract.md`, this evidence directory, and the claimed story's result. Shared runtime/index, claims, policy seed, repository, migration registry, shared-contracts and repository-contract tests remain untouched.

The actual FUCQ-66 backend port is inspected read-only in held DEV-069. `allocate(context,input)` commits its own transaction; remote pending is not allocated. The isolated checkpoint stores selection-received plus pending before invoking that port, then verifies allocated hold, claim, stock and slot before external ordering. This cannot prove the final requirement that selection and allocation share one transaction. A coordinated F66 transactional conversion seam and native SQL repository/reopen tests remain gates. Buddy uses the same source envelope and an injected buddy converter; no buddy behaviour is invented.

Terms/declarations and approval stages are required reads from proposed canonical `ordering.terms.v1` and `ordering.approvalStages.v1` PolicyService keys. No deployed success until these are centrally installed; tests add explicit dated synthetic rows via the real PolicyService provider. No local active defaults.

Selected checks: new named order tests; existing clock and repository contract boundary commands only as necessary. Inspect strict affected plan first; explicit command selection is appropriate because these modules have no callers yet and no observed coverage map. No full suite initially. Final story still requires npm test, extended configured SQL contract/reopen and producer integration. No live BMW/HTTP/mail/credential/provisioning calls.

Resource plan: one worker, <=300 seconds, <=512 MiB RAM, <=32 MiB scratch per chunk; bounded 1 MiB logs; shared HostBudget reservation and Scratch supervisor finalizer before allocation. Shared ownership/checkpoints/impact metadata is under `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/`. Scratch is private temporary storage with owned TMPDIR/TMP/TEMP, stopped/joined groups and verified removal. Any >=256 MiB output goes directly to `/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/_agent-output/fucq71-20261105-order-core/`. Preserve source/dependencies/user files. Retain compact summaries and bounded useful failures, remove successful verbose logs. Smaller chunks on low headroom; keep 5 GiB reserve.

Agents: requested/selected lead `gpt-6.1-sol` / `high`; no fallback; first slice in lead because dispatcher allocated all four actual slots. No descendants spawned.

Restart checkpoint, 5 November 2026: current nine-test identity passed 9/9 (zero skipped), including the unchanged held DEV069 producer. Run `fucq-71-restart-20261105-2310`; 7.47 seconds, RSS 170,213,376 bytes, scratch zero, owned root removed and reservation released. Native SQL and atomic conversion remain explicit gates. Full plan on current product map after base integration: ordering-core; claim-conversion; runtime-contracts; integration.
