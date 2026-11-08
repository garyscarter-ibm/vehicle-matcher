# Manual review readiness — 5 November 2026

FUCQ-66 is parked at code checkpoint `abed0960618fd67a160d857b65029c0f64c9a2a7`
(input digest `205c551cbc5a744e905eaa5ec1f6486bdc616be82bc477566d81291d20d47791`).
This note records existing interfaces and a **proposed, unimplemented FUCQ-70 protocol**.
FUCQ-70 remains unclaimed; the dispatcher is routing the proposal to its external owner through
`MSG-2026-11-05-GC-006`. This note neither takes that claim nor changes backlog scope or Jira links.
Apply [technical readiness](technical-readiness-2026-11-05.md): existing interfaces permit independent
work, while missing contracts and live integration remain completion gates.

## Existing code boundary

References below describe the frozen code checkpoint, relative to the repository root.

| Evidence | Consequence |
| --- | --- |
| `server/gcsp/manual-context/index.js:231–234` | `saveDraft` refuses an occupying or allocated cart hold with `release-required`. |
| `server/gcsp/manual-context/index.js:250–255` | Every successful save increments `draftVersion`, including contact-only edits. |
| `server/gcsp/manual-claims/index.js:313–327` | Review requires the current hold revision and the quote's pinned/current draft version. |
| `server/gcsp/manual-context/http.js:13`; `server/gcsp/manual-claims/http.js:12` | Existing routes expose account/draft/stock, claim/quote, review and release. There is no public post-claim review-details save/read. |
| `server/gcsp/repository/schema.js:20` | Existing `event_receipts` outcomes can carry versioned metadata without adding a schema. |
| `server/index.js:867` | `deps.gcspRoutes` permits a separately owned route factory while the FUCQ-66 routes remain frozen. |
| `server/gcsp/policy/seed-v1.json:11779–11781` | `manual.context.v1` currently bounds special requirements at 500 and return mileage at 500000. Runtime consumers must use PolicyService rather than duplicate those seed values. |

The current edit sequence is confirmed release → save a fresh draft version → browse → conditional
reacquisition. The employee may lose the car. Preserving a hold while editing review details therefore
requires a separate metadata protocol. The published [claim contract](manual-claims-contract.md) at
`f81855fe1814657b8a2b0bbd949ac8e204dec44e` remains the FUCQ-69 interface: pass server `claimInput`
unchanged plus a stable `commandId` per selection attempt; current claim/quote reads remain authoritative.

## Proposed review-details protocol — not implemented

```text
GET /api/gcsp/manual/review-details

POST /api/gcsp/manual/review-details
{
  commandId, holdId, quoteId,
  expectedHoldVersion, expectedDraftVersion, expectedReviewDetailsVersion,
  details: {
    contact: { phone, email },
    expectedReturnMileage,
    specialRequirements
  }
}
```

The server derives run, employee and entitlement slot from trusted context and verifies the hold,
quote and pinned draft binding. `reviewDetailsVersion` starts at zero; initial values come from the
**exact pinned draft receipt**, not an arbitrary latest draft. A read returns the binding, metadata
revision, saved safe inputs, policy constraints and current edit/continue authority. Append versioned
metadata outcomes to a hold-namespaced `event_receipts` consumer. Exact result and error shapes still
need agreement with the owning implementations.

An atomic save must check ownership, binding, current hold revision, active/unexpired state against
the persisted demo clock, expected metadata revision and submission lock. It must not call
`saveDraft`, `beginReview`, claim or allocation, or change the quote, stock, policy pin or expiry.
A stable command/payload retry returns its original save receipt; the client still reads current
claim authority before continuing. Phone and email are required. Old-contract/replacement context
is server-derived; return mileage uses miles and applies only to replacement (null/absent for a new
order). PolicyService supplies bounds and UI constraints. Special requests do not reconfigure the
car or its terms. After expiry, readback may retain safe inputs while continuation is disabled.
Cancel/release must remain possible with invalid form inputs.

**Missing FUCQ-71 contract:** compare and freeze the exact `reviewDetailsVersion` in the same repository
transaction as selection intent. A separate read followed by allocation permits a racing save.
A proposed `freezeReviewDetails(tx, …)` port would return the immutable snapshot/lock using the caller's
transaction, without nesting another repository transaction. Refuse later saves once selection is
received, pending or allocated, even if the hold temporarily remains active. Pending uncertainty must
not unlock editing. FUCQ-71 must explicitly define whether terminal failure can restore editing.
Order readback and print must consume the frozen snapshot rather than original draft contact fields.

Independent FUCQ-70 work can own `blocks/gcsp/manual-review/` (controller, adapter, custom element and
harness), `server/gcsp/manual-review/` (validation, metadata service and route factory), and
`server/test/gcsp-manual-review.test.js`, with coordinated shared-kit/gallery changes only as needed.
Keep frozen FUCQ-66, manual-context, repository/schema and timeout files outside that scope. Agree the
metadata and freeze ports before treating them as available producers. Validation must cover revision
races, retry/replay, expiry, reopen, policy boundaries (including 500 characters) and submission/save
races. Live producer/freeze integration remains outstanding. Apply [experience quality](experience-quality.md),
`COMPONENTS.md`, shell references 00/01 and the Used Cars body reference at `a7fc178`, including truthful
pending/unavailable/expired states, accessible invalid inputs, desktop/narrow and keyboard inspection,
and the custom-element/CSP constraints.

## FUCQ-66 blocker and remaining gates

The latest native observation failed during setup after **54.166 seconds**: a new policy connection
exceeded the configured 5000 ms establishment timeout at 5001 ms (`maximumClients:2`, queued/total/idle
all zero). `manual.context.v1` returned `source-unavailable`; unchecked setup account access then threw
`TypeError`. There were 859 SQL completions and zero SQL statement errors. Connection establishment
is the verified proximal blocker; DNS/TLS/network/service cause remains unresolved. This does not
establish a deterministic review or stored-data defect. Earlier lock/statement-timeout and pure
checkout-queue hypotheses remain unconfirmed. Production timeouts are unchanged.

Completed proof checkpoints are the reviewed credential-unset scoped checks (**67 pass, 10 explicit
native skips, zero failures**), release-before-change (**1/1**), and native case01 claim/replay/confirmed
release plus repository/separate-process persistence (**1/1**, 222.601 seconds). Case01 inputs were
verified identical in the final source and its proof is reusable. Partial case02 review/reopen/deadline
assertions do not complete its startup proof.

The complete development plan is recorded in `.product-map/work.json`. Remaining gates are complete
native case02; cases03–08 (tick, allocation, SQL rollback, pending claim/release/selection); configured
repository/constraint contract; authored credential-unset `npm test` under the dispatcher's sole full
lane with strict status before/after in the identical environment; integrated manual consumers; and
completed manual/buddy services proving exclusivity both ways. Raw repository contention does not
prove the last gate. **All seven authored FUCQ-66 acceptance criteria remain unchecked.** Rendered
manual-screen acceptance belongs to the consuming FUCQ-70/72 work.

Resume native work only after dispatcher-coordinated connection-establishment diagnosis or changed
environment evidence and an explicit next scoped native grant. No unchanged lifecycle retry is
planned. A full-suite grant remains separately withheld. Source, claims, merge/closure, Jira and
heartbeat coordination remain with their current owners.

[Committed native evidence](evidence/fucq-6/fucq-66-native-validation-2026-11-05.json) preserves source
identities, failures and cleanup. All 15 diagnostic allocations had absent roots/groups/reservations;
the last database inventory restored the original four-schema baseline. The two adopted dependency
directories have now been identity/open-use checked and removed, freeing **27,910,144 allocated bytes**;
package/lock hashes are unchanged. The local manifest and receipt are
`.claude/test-runs/fucq66/dependency-cleanup-v10-{manifest,receipt}.json` in the shared checkout.
No database calls or retests were made for this docs/map checkpoint. Bounded diagnostics and the
worktree are retained; the dispatcher's independent final audit remains outstanding. Map inputs were
seeded from committed shared revision `69081a8d64597082e4c2660ebe642c11e362b870` without merging a new
application base. Existing component associations, unrelated story facts and Jira observation times
are preserved. Actions publication is configured upstream; served refresh is not verified here.
