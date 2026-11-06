# Atomic accepted-offer ordering coordination proposal

6 November 2026. Author-only response to the dispatcher's108 readiness finding.
No feature or shared source was edited, imported or executed; no tests/resources
were allocated. This is a concrete contract and change-scope proposal for root,
71 and108 coordination. It is not a new ordering adapter, HTTP write endpoint,
implementation or acceptance claim. Source hashes are in
[ordering-join-proposal.json](ordering-join-proposal.json).

## Verified cause

71 is pinned to `ed20ca2a774d9368b4fce87a7e69b5e2ae30a7e8`.
Its contract lines17–19 requires its existing converter to call
`commitSelection(tx)` while the hold is active, then allocate in the same
transaction. `manual-order/index.js` lines103/118 rejects an allocated hold/slot.
106's current `decision.js` allocates hold/claim/offer/stock/slot before writing
its decision and accepted event. A later event consumer cannot join the earlier
transaction and cannot satisfy71 by submitting the already allocated hold.
106 source at `53cbb58` and canonical `90cb70c` is byte-identical for this path.

Two further contracts need meaningful source-specific treatment:

- 71 requires `quote.draftVersion === source.expectedDraftVersion`. Actual100 buddy
 quotes have `briefVersion` and no `draftVersion`. A confirmed preference brief
 is not a manual order-detail draft containing confirmed driver, contract,
 collection, contact and old-contract choices. Equal integers do not relate them.
- 71 also requires `quote.policyVersion === context.policyVersion`.106 deliberately
 accepts a valid held quote priced under an older policy while current eligibility
 uses the new active policy. Copying a newer price, changing the quote's policy
 or rejecting that supported case would invalidate the retained-price contract.

The source diagnosis is a static trace. No reproduced execution or product fix is
claimed, and all frozen proofs remain at their original source identities.

## Owned106 seam

Retain106 as the sole offer/allocation writer. Add a trusted **third argument** to
its existing method; do not add public command fields or another allocation API:

```js
await decisions.decide(offerAccessContext, input, {
  selectionJoin: {
    contractVersion: 'selection-order-join:1',
    operationId,   // existing71 stable selection key
    intentDigest,  // existing71 inputDigest(intent)
    commitSelection, // trusted async function(tx), never JSON
  },
});
```

71 supplies the operation key and complete intent digest beside its existing
callback in the trusted `convertSelection` options. The digest includes its actual
terms, declarations, source, quote and stock/version intent.108 threads them to
106 without substituting another ordering service or maintaining mutable shared
request/capability caches. Reuse71's stable allocation command ID; the final108
composition must keep that mapping deterministic across token/account retries.

The106 constructor receives an explicit trusted `acceptanceMode`:
`isolated-checkpoint` or `ordering-atomic`. Missing mode refuses a **new** accept
inside repository work. The isolated mode is only for labelled checkpoint
composition. Integrated runtime uses `ordering-atomic`; it requires the join for
every new accept. Decline never calls the callback. Public JSON cannot configure
a mode, supply a callback or bypass the trusted composition.

Inside the existing106 transaction:

1. Run the same access, run/time, exact version/hold/stock/slot, current policy,
   original quote and stored-subject accept checks.
2. After `#accept` returns `ok`, while the hold/claim remain active and slot is
   unallocated, call71's `commitSelection(tx)` **on that same tx**. No nested
   repository transaction or ordering-provider execute/reconcile occurs here.
3. Require a complete `ok` callback result and read the resulting71 operation
   through the same tx. Verify operation ID/digest, `selection-order`, pending
   allocation phase, `atomicConversion: true`, run/employee/slot and exact held
   order/quote/source/version binding. A `pending`, malformed, wrong-scope or
   non-ok callback result refuses; it is not permission for partial local commit.
4. Perform106's unchanged conditional allocation writes and persist its decision
   and accepted event in that transaction. Any callback exception/refusal,
   conditional-write failure, decision insert failure or event-receipt failure
   aborts **selection intent/history and106 state together**.
5. After commit,71's ordinary submit/drive/reconciliation uses that same operation
   and its existing adapter. Provider uncertainty stays pending with allocation
   occupied. The accepted event can wake/observe the existing intent; it cannot
   create a second selection or replay allocation.

The callback's transaction handle expires with the repository transaction. It
must not escape to a task, timer or later event handler. Checks based on a prepared
source snapshot must compare actual durable versions within the joined tx;
preparation alone is not authority.

## Replay and historical acceptance

Keep the existing absent-join schema1 command digest byte-for-byte. With a join,
use a versioned digest containing existing input/binding and only the stable
`contractVersion`, `operationId` and `intentDigest`; omit callback identity and
all credentials. Changing terms/declarations/join identity under the same106
command conflicts. The persisted operation must match this digest binding.

The repository resolves an existing command receipt before invoking work. Thus
an exact joined retry performs no callback, CAS, decision insert or source event.
A later71 submit can observe/drive its existing operation without allocating again.
The mandatory-join check belongs **inside** repository work: an identical original
historical unjoined command can still return its original outcome. Adding a join
to that old command changes intent and conflicts; it must not backfill an ordering
intent into an already accepted offer. Another command meets the terminal-state
conflict. No migration, speculative recovery or reopening is implied.

## 71/108 source and version coordination

Keep71's cart branch unchanged. For a buddy source,108 prepares a labelled basis
with the actual offer/quote IDs and revisions, pinned and current confirmed brief
versions, retained quote-price policy, current eligibility policy, and independent
real ordering-detail draft/context version. The71 callback validates this typed
basis instead of requiring a manual-origin `quote.draftVersion` or equating quote
price policy with active policy. No field is renamed to make an assertion pass.

`source.expectedDraftVersion`, if retained in the existing71 command, continues
to mean a **real complete order-detail draft** from the existing ManualContext
service. Its confirmed driver/licence, contract, collection/contact and old
contract remain separate from buddy preferences. The callback must recheck that
real draft/version and source authority in the joined tx. If the actual service
cannot supply/revalidate those details for a buddy hold,108/root coordinates the
owning service extension; it stays typed not-ready/unavailable until then. Never
fabricate a draft, default contact/licence or copy `briefVersion` into that field.

Keep the raw held quote unchanged.71's selection snapshot records both retained
quote provenance and current terms/eligibility/allowance provenance.108 rechecks
`PolicyService.getAllowance` at the current run policy against the **original typed
held price**, preserving points units; it never substitutes current
`getPointsCost`. Current allowance refusal rolls the joined transaction back.
71 retains active hold/expiry, stock facts/configuration/seven-digit order identity,
employee, slot, clock, terms and declaration checks.

The canonical106 seed pin lacks71's published `ordering.terms.v1` and
`ordering.approvalStages.v1` keys. Their live use requires publication/adoption
through the same canonical provider. Do not replace the canonical seed with71's
branch seed, split providers or add consumer defaults.

71 currently requires a genuine employee identity.106's service scope has no
employee roles; its private one-offer capability is not an employee credential.
108/root must compose actual ordering authority for both entry routes without
manufacturing a context or silently claiming token/account parity. That source
binding remains an actual integration criterion; this proposal does not change
public authorization or invent a new permission.

## Concrete implementation scope

- **106-owned, after shared contract review:** only `server/gcsp/offers/decision.js`
 needs the trusted option, versioned digest binding, explicit acceptance mode and
 pre-allocation hook/operation verification. Add its contract and focused owned
 regression cases at a new reviewed source checkpoint. Keep `decision-http.js`
 body allowlist unchanged.
- **71-owned, coordinated through root:** pass stable operation/digest metadata
 alongside the existing callback; add source-specific buddy version/quote
 validation and immutable snapshot basis while preserving the manual branch.
 Actual ordering-detail validation must remain with its existing authority.
- **108-owned:** actual buddy converter/orchestration, current allowance check,
 terms/declarations/details binding and event-to-existing-operation observation.
 Existing71 owns adapter execution/reconciliation and target state names.
- **Root/owning leads:** bind the existing decision handler's accept path through
 108; direct new106 accept cannot bypass mandatory join. Decline stays106. Resolve
 actual authority, canonical ordering policy and later account/offer projections.
 Brief selection association needs its agreed writer/projection; do not mutate
 confirmed brief history or claim that snapshot linkage alone completes it.

The next evidence should cover callback timing, success atomicity, every callback
and later-write rollback, exact replay/cross-route/reopen, changed intent,
historical replay without backfill, absent mandatory join, distinct real draft and
brief versions, retained price with a current allowance change, and71 uncertain
provider reconciliation. Include source/detail/clock/policy races and actual
ownership. No checks have run; final code/test/helper/dependency pins, source union
review and a fresh bounded grant are required first.

The remote71/108 execution seam remains parked. No new adapter, endpoint, shared
write,96 source/unpause, native/full/browser/listener/network/mail, Jira, claim or
acceptance change follows. Existing25/12/3 and105/107 evidence remains unchanged.
