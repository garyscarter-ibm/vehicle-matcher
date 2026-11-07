# F71 acknowledgement correction, 6 November 2026

The actual F112 consumer in F100 commit `4037b762086113e4970f651161471b603d39b4d5` reads top-level `renewalId`, `orderUuid` and `occurredAt` from a completed `selection-acknowledged` receipt. F71 previously emitted `at` and nested `order`, so a genuine acknowledged selection could still open a renewal-deadline case. The original producer reproduced that failure against the digest-admitted consumer before the correction.

The correction pins the actual renewal relation inside the existing selection transaction before allocation. The employee must already match the trusted context and default entitlement slot; that slot and the hold must belong to the same employee/slot. At least the employee or slot must supply a valid renewal ID. Every supplied employee/slot/optional-hold ID must be valid and equal; the hold alone cannot establish the relation. Missing, malformed or conflicting authority is stored as explicit `null`. Confirmed acknowledgement adds the three required consumer fields and retains `at`/`order`. Delayed acknowledgement uses the immutable selection snapshot, so an acknowledgement for an earlier renewal cannot suppress a later renewal's case. Existing completed operations are not backfilled; older pending snapshots without a renewal acknowledge with `null`. Pending and failed handoffs emit no acknowledgement.

`plan.json` is the unchanged pre-code, pre-grant plan; its original waiting status is historical. `admission.json` fixes red and green code identities. `scoped.py` is the frozen bounded runner. `result.json` records source/dependency identities, results, coverage context limits, resource receipts and cleanup.

The owning test imports the actual pinned `server/gcsp/cases/index.js` Git blob in memory through `GCSP_F71_CASE_SOURCE_BASE64`, admits its SHA256 before execution, and relocates only its five relative imports. It does not copy GC production files or recreate its matching predicate. The local repository, PolicyService, DemoClock and identity are exercised. Three boundary dependencies are byte-identical to the consumer pin. Local core/recommendation differ from GC; the tested tick path does not invoke remedies/recommendation. This establishes the pinned consumer contract, not the full GC source union or configured native/live integration.

The authorised serial checks completed:

| Check | Result |
| --- | --- |
| Original producer with actual pinned F112 consumer | 1 expected assertion failure: one unwanted deadline case |
| Corrected owning manual-order file | 26 pass, 1 explicit optional skip |
| Three selected renewal-case boundaries | 3 pass, no skip |
| Green total | 29 pass, 1 skip, 0 fail/cancel |

All new tests executed: real acknowledgement/consumer tick, eight authority variants, lost acknowledgement across a real renewal change with one provider write, and pending/unsupported handoffs. The skip is the pre-existing optional held-F66 mutable-worktree injection, excluded by the frozen plan. No full suite was run. The tested production/test hashes remain unchanged; targeted code key is `8b0745d5c6d0e5ee93a587996ce5c328bae89a1ca94bf37102699f49f6e0253d`.

Three supervised serial chunks used one worker each, with 64 MiB scratch, 384 MiB charged RSS, 120 seconds and 1 MiB logs per chunk. Measured maximum charged sampled RSS was 248,250,368 B and scratch was 610,400 B; 1,749,280 B aggregate scratch was removed. Independent final audit found all owned roots, recorded process/group identities, reservation tokens, temporary dependency link and owned empty parent absent. All 139 borrowed dependency files retained their content/device/inode identities. Successful logs/raw coverage were removed; the useful original red log, compact receipts, ownership manifests, targeted proofs and coverage summaries remain. There is no compatibility exception, large output or leftover.

Retained supervisor evidence is under `/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-resume-20261106/completion-focus/f71-repair/`: `red-5dafc2705a894c5b8e0dbc9510c9f1ad.json` and matching useful `.log`, `owning-90882d61e3af4529930ece8d7f3e03ea.json`, `boundary-efd06981dfe143188393ba6fa2c1e4b9.json`, `final-cleanup.json`, `ownership/`, and the named targeted evidence directories in `result.json`. The impact map is `/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact/fucq71-acknowledgement-20261106.json`. The test lane was released immediately after final green cleanup; no further tests run.

F100 already adopts the F71 ordering service, canonical ordering keys, trusted runtime and clock handler, and has an actual cart and same-origin offer host. F111 already understands the completed acknowledged operation. The actual manual-claims atomic `convertSelection`, F106/F108 buddy ordering join, public F71 submit/frontend join and account-history integration remain open. Configured native acceptance stays with Gary. F71 remains In Progress; the parent owns independent review, publication, exact GC adoption, Jira/map/claims and closure.
