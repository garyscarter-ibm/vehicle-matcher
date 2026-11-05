# Proposed actual producer → access proof

This is a source/composition plan for root coordination, not an executed integration
or a runtime-bootstrap change. Producer source is published FUCQ-100
`a7fc8580efba36c329b2479711d6b66db53962bd`; consumer is published FUCQ-102
`a3fdcdfdc7b5d6c0c4f38744101b355ab6359bed`, based on
`b95b4c8ad8a4534cbf03f287eb62fc8a57bbda96`.

## Exact finite source set

`producer-source-plan.json` records SHA-256 identities for 35 transitive JavaScript
modules reached from BuddyHoldService, the real manual fixtures, DemoClock runtime,
PolicyService and the existing recommendation fixture helper. Twenty-nine modules
match the published source and worktree byte for byte. The following six require
immutable scratch overlays; no foreign working tree or broad branch merge is needed:

| Published path | SHA-256 |
|---|---|
| `server/gcsp/offers/buddy-hold.js` | `b9f1a9be9cf42552a56313492bf0703b49ed715ffe2059f477ee11637c44b3d6` |
| `server/gcsp/offers/buddy-remote.js` | `0284045ab38c22c305019ad4a560724aa233e830c6c37186d5661da430c59e01` |
| `server/gcsp/offers/current-car-comparison.js` | `c5aaf8b2e3123301d50f3dade21e89e4f88abf12ede4e2c7ed801adbc56099cd` |
| `server/gcsp/offers/offer-token.js` | `325b699d7dfdb435cd8713015017aa68bf735582f127d7d64a0e0fc819f7b915` |
| `server/gcsp/recommendation/index.js` | `08acfe895804cf60dcc178591ecbdd1816f12ce70944f832f1ae394902c7e172` |
| `server/gcsp/repository/core.js` | `a6a5ae5f9fe4fd9a9e2d31a4aa38cd99a2ab3a4015c5abefd9a0a229983ad1b0` |

The recommendation change supplies the producer's stored-subject evaluator while
retaining employee authentication at its public service. The repository change
omits raw offer links from automatic outbox insert receipts and rehydrates replay
only from digest-validated original input. Using the older core would invalidate
the intended credential-custody proof. Both differences were read and reviewed.

## Proposed loader and ownership

After root releases this integration scope, extend the owned supervisor to read
these exact committed blobs through `scaffold_git.py`, verify hashes before writing,
and place only the six modules under its manifest-owned scratch root. An explicit
ESM resolver maps each canonical worktree path to its corresponding overlay, maps
relative overlay dependencies back to the verified canonical source map, and
rejects unplanned overlay imports. All callers share one canonical module identity
for the repaired core/recommendation/token. Existing modules remain read-only.
Keep the current retained `pg` entry mapping without opening a database. Record the
loader, module map, source hashes, policy seed and test identity in the strict receipt.

Use one worker, a fresh HostBudget reservation, 120 seconds, 768 MiB RAM, 128 MiB
combined scratch/output and 2 MiB logs. Establish the external ownership manifest
and finalizer before creating scratch. Unset database aliases and HTTP debug tracing.
No browser, mail transport, external service, native database or runtime bootstrap
is part of this proof. A streamed/in-process access handler is sufficient; this
chunk needs no additional listener. Retain safe summaries/samples and bounded failure
logs; stop/join owned groups, remove scratch, release the reservation and verify
process/filesystem/dependency absence in the receipt.

## Selected integration checks

1. Build a real memory repository, PolicyService and DemoClock/identity runtime.
   Seed through `seedManualDemoContext`, switch the real presenter to Paula, advance
   to noon, save and confirm the brief with search/hold consent, and insert one
   explicitly synthetic released exact-stock car through the repository. Read its
   actual employee/slot revisions and allocate through the real BuddyHoldService.
2. Extract the raw link only from committed notification-outbox custody in memory.
   Use its actual run/offer coordinates and published verifier to exchange through
   the current access service. Assert pinned quote/hold/facts/terms identities,
   DISPLAY-only current-car model/source projection and absence of internal binding.
3. Replay allocation/exchange and cookie reload; assert a single offer/hold and
   unchanged persisted deadline. Exercise the account route with the real identity.
   Inspect custody through boolean assertions only: raw token absent from producer
   return, offers, event receipts, command receipts and safe DTO; fresh cookie absent
   from all stored rows. Never print credentials, links or token-bearing errors.
4. Start the producer's real expiry handler and advance DemoClock to the persisted
   deadline. Verify actual expired offer/hold and released stock, then old-link and
   repeated reads without revival. Reset through DemoClock and verify authenticated
   earlier-run response, with unknown/tampered links still generic not-found.
5. Run the existing 28 access checks under the same exact module composition, so the
   changed core/recommendation boundary cannot silently replace prior evidence.

The existing synthetic checks cover remote-pending presentation; actual remote
uncertainty remains a separate explicit integration gate. Full current-car specs
and points remain unavailable in the producer contract. Runtime/bootstrap,
deployment, browser and authored full-suite acceptance remain open after this chunk.

## Decision timing observation

The recommendation quote validity is one hour while the buddy hold duration is two
hours under the current policy. The published access presentation currently removes
both actions when the quote expires, while its state remains pending until hold
expiry. This plan preserves that published behavior. Root/FUCQ-106 should confirm
the intended decline behavior at that boundary before changing the action contract.
