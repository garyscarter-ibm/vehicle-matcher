# Next runtime composition: immutable handoff and case readiness

FUCQ-100 / DEV-2026-11-04-060, 6 November 2026. **Read-only planning checkpoint.**
Root independently accepted runtime `95d77416361f54eb558bbcb40b382cbb45149c27`: 273 checks PASS,
158 source/installed paths, six executables and 49 owned manifests. Root receipt:
shared `.claude/test-runs/ownership/fucq100-runtime-review-0018.json`.
No source adoption, test, listener, browser, native database, full suite or provider execution occurs
in this checkpoint. The existing 9/9 result is reused, not rerun. 100 retains the central composition
writer lane; 69/122 adoption awaits exact published handoffs and a scoped grant.

The [immutable next-source plan](evidence/fucq100/next-runtime-source-plan.json) records the 21-path
case import/resource closure and 12 additional canonical pins. Every blob was read and SHA-256 checked
through scaffold Git. 122 published HEAD/remote was read back as
`aedc5e63cd6cc7c5bb6c9ec424d5018d2f87b639`; its two case product files are byte-identical to
`1baa7775c66651f24df7296c1b285a255d0a2089`. No old 122 foundation files are proposed for adoption.
The closure deliberately binds dependencies to accepted 100 source `95d7741`.

## Canonical handoff

Accepted 100 source identities and installed/source/executable maps are committed in
[evidence/fucq100/runtime-integration.json](evidence/fucq100/runtime-integration.json).
The immutable adoption refs are in
[evidence/fucq100/runtime-adoption-closure.json](evidence/fucq100/runtime-adoption-closure.json).
Pins were relayed to 69/103/126 with root's accepted receipt; no test rerun or source write was requested.

| Canonical 95d7741 module | SHA-256 |
|---|---|
| repository/core | `a6a5ae5f9fe4fd9a9e2d31a4aa38cd99a2ab3a4015c5abefd9a0a229983ad1b0` |
| identity/index | `4c60cd226ecceefcedd86c7da73a410bfabbeddbb05aab1aa997c98639f7612c` |
| clock/index | `98d9e3ad778ad9a38aa3fb5f96f5a68040544ba328b79e263e661ec42c442c45` |
| policy/index | `710f500ac7a601a2f08ed9b76f883917878826c25f069bcfc5275ba7460a8ff0` |
| runtime | `6ac589363f8a6c5abc67e7d63d861389265a942b8da8cfa721bb6942a1461fa7` |
| server/index | `3d400ee9490130a8cf1e39cbf7df40101e60816b74eab72dd29afe00fec00182` |

Runtime's original `readPolicy` is the exact instance used by clock, identity and ScenarioService.
Runtime's returned `policy` is a publication view of the same provider. Preserve those roles; never
construct a replacement provider or brand scenario fixtures with the publication view. The writable
provider is owned/closed only when runtime created it; caller-owned policy stays open.

## 69 stock-read seam: corrected placement

Canonical 66 manual-context/index SHA is
`3e694f3a68b9d3c9f40b44ddb785bec2edce3b3ada43d491995be77a2930fd43`, ports
`c1e7db5012f6d3212b79ad989e6cde5a0e390e2f4bfe50f91ee4c79c8a7a1267`, HTTP
`d49bbb756447e8b91ee90dd54e2240914b45e554d79428e54345a59585d4dc37`, manual-claims/index
`32c80ef72d8329fcdbc4a208d9ab911f68156e6234d3917975754415d04ef059`.

Runtime creates repository manual ports, an account service over those ports, then manualClaims over
that actual account. Existing manual routes use `gcspManualClaims || gcspManual`. Actual
ManualClaimsService.browseStock first reconciles, calls the account, and enriches each eligible decision
with current stock/draft/context versions and terms digest in `claimInput`.

**Correction to 100's initial coordination advice:** decorating only the lower releasedStock port cannot
expose 92 history: ManualContextService.#browseStock reconstructs the returned DTO and drops extra port
metadata. Root independently confirmed this boundary. 69's existing grant is a unique stock-read wrapper
**after** real manualClaims.browseStock and its claimInput enrichment. 100 corrected the advice directly
with 69. Runtime must retain the original manualClaims instance for registration, claim/release/review and
reconciliation. Preserve bound method receivers; a spread of a prototype-backed service drops its methods.
The eventual HTTP routing choice awaits 69's exact wrapper handoff; no new facade/API is invented here.

92's `15a79957` history reader remains an external source proposal. No 92 import/adoption is granted to 100.
Do not pull old 92 identity/repository/clock/runtime dependencies into the canonical closure.

## 122 actual case composition and the concrete missing boundary

Published 122 case index SHA is
`2c62c96bd07cc1dbf57b76dfb0fddc4dc9e77fe22ca689f89d471bd14842ffd3`; HTTP
`d1b48cf2b47e2d19f80c61c90fdd234098d1ae480a591878ebb38f9fb51f0d65`.
Constructor: `createRenewalCaseService({ repository, policy, clock, identity })`. No additional provider,
pool, identity resolver or constructor port is required merely to instantiate it. Accepted 100 runtime
currently constructs no case service and exposes no `gcspCases`; its help/case routes therefore return
unavailable under the normal runtime. Its index already registers optional cases before captured
notifications and clock.reconcileStartup, so that narrow composition slice need not invent a new lifecycle.

A separately granted slice can construct one real case service over those exact shared dependencies,
return/expose it as `gcspCases`, and adopt only the two published 122 case files after closure review.
Manual/buddy expiry stages precede pending-reconciliation; cases register `renewal-risk-cases` in that
pending stage. `Case.start` is memoized. Cases own no timer/pool/observer close hook. Shared captured
notifications consume atomic case-update jobs; keep existing settled-work/unsubscribe/storage shutdown.

That construction does **not** establish actual alternative-car acceptance. The inspected gate has a
concrete source-shape mismatch:

| Boundary | Actual inspected shape |
|---|---|
| 122 `#remedy` alternative-car | Requires `stock.state === 'available'`; reads `stock.facts.recommendationCandidate`, with matching orderUuid/configurationId |
| 100/66 actual released stock | Persists `state === 'released'`, normalized vehicle snapshot in `stock.facts`, availability timing/version in `stock.release.availability`, with exact stock identity and visibility |
| Canonical manual stock port | Includes released/held/allocated rows, checks company/scheme/employee visibility, projects `snapshot: row.facts`, and marks only unheld released stock available |
| 100 actual buddy producer | Conditionally claims that shared released row; hold/claim state and pinned quote/outbox retain repository authority |

Thus canonical released rows fail the 122 state gate before its nested-candidate expectation is reached.
The existing 122 browser harness explicitly creates isolated services and synthetic setup; its success is
not proof that this normal runtime/actual released producer matches that older case stock contract.
122's current implementer has been informed. Root directs that implementer to diagnose after its active browser
freeze/cleanup using the current defects workflow. No synthetic available row, candidate wrapper,
state alias, seed/scorer change or silently bypassed eligibility gate is authorised by this plan.

Help/own-case/list/update with a manual decision can be an independent bounded technical slice; the
alternative-car acceptance remains blocked on the actual producer/consumer contract. Existing
BriefService and POST `/api/gcsp/brief/change-after-decline` supply one-change confirmation, but actual 106
decline and later lifecycle producers still need their own evidence. The case clock consumes completed,
scoped event receipts; manufactured receipts do not prove actual lifecycle integration.

## Proposed same-authority checks: not executed or granted here

Before a later scoped run, freeze exact source/import/input/environment identities, executable hashes,
resource limits, external manifests and finalizers. Select only the new boundary; reuse unchanged 9/9,
122's existing service/browser proofs and 100 isolated checks where identities still match.

- Actual normal runtime dependencies construct one 122 instance. Its authenticated help/list/options/update
  routes use the same repository, writable policy view, clock and identity as buddy/manual/access/capture.
- Preseal startup registers cases exactly once; reset retains the same services and handlers, stale contexts
  fail, and a case startup failure participates in the existing guarded 503 behavior.
- After the contract is resolved, feed a genuinely published release producer through that shared authority.
  readOptions must identify the exact same eligible orderUuid/configurationId and derive policy/brief/time
  facts through the agreed canonical port. A separately inserted available/candidate-shaped fixture is not
  actual-producer proof.
- A real manual or buddy hold on that same row must remove/refuse the alternative, including pending and
  expiry/release states. Attempted case remedy update must revalidate current stock, ownership and versions;
  no parallel reservation store or automatic priority is introduced. Recording a remedy does not itself
  claim or select a car.
- Preserve case owner, reason, next action, DemoClock due time and history across authenticated reloads.
  Case-update outbox capture must share the existing commit/observer authority and settle before close.
- Preference relaxation requires an actual unused decline for that employee/brief, then actual employee
  confirmation. Actual lifecycle exceptions must come from their producer's completed run-scoped receipt.
  Scope these future checks separately if those producers remain unavailable.

No test/listener/browser/native/full grant is requested by declaring those checks. A later exact source
and resource admission is required. Host placement also remains separate: 100's unchanged trusted bootstrap
issues local sessions only for brief/activity entry pages; 122's help/queue pages and Greg harness need their
actual host/entry registration reviewed without modifying the currently excluded bootstrap host implicitly.

## 103 successor and omitted scorer boundary

103 reported canonical successor `0d3a0aa2fcee5d26ad33e587578cff7cce169090`: new 106/115 reviewed JSONs
and additive registry entries, no runtime/index changes. It is recorded, not adopted. Preserve its exact
registry/two JSONs when later composing against 103; copying an older whole closure would drop them.

Read-only comparison also confirms the 103 weighted scorer at
`server/scenarios/employee/index.js` SHA
`50e3b25317158c29605420af080c1ec6bd76ded94d298d33badfc90a4dc0d91c` differs from `95d7741`. That file
is outside the prior adopted `server/gcsp` delta. Its actual changes validate preferenceWeights and use
policyWeight/effectiveImportance in scoring. `95d7741`'s publication/activation/quote-pin evidence does not
establish that weighted scorer behavior. Preserve the 103 scorer on its branch; any 100 adoption requires
an explicit next source decision and relevant changed-boundary validation. No silent scorer replacement.

103's seed SHA is `c58fcd9054fa32cded07c4ee742b39d196f94aa15c8d0fbf7752874954df8a31`, with the existing
presenter-step row. `95d7741` deliberately preserved its reviewed shared baseline seed under the no-seed-edit
grant and exercised actual reviewed-definition adoption. This difference is not permission to overwrite
103's seed or to claim default presenter-step readiness on every composed base. No seed source changed here.

## Status

This is the next finite integration plan, not a delivered combined 69/122/103 successor. Canonical 100
runtime remains published/accepted at `95d7741`; central ownership stays with 100. Await exact 69 wrapper and
122 contract handoffs/readiness before source composition. Keep allocator 96 current-operation/event wiring,
normal remote adapter composition, full 105 authenticated employee-to-spec association, browser/native/full
and final acceptance gates explicit. No additional Jira scope or dependency-link amendment is made.
