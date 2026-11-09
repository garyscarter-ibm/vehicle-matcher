# FUCQ-102 → 105 → 107: reload-safe decline follow-up entry

6 November 2026. **Proposal for plan review only.** No product source, public contract or test has changed. This checkpoint does not authorise implementation, a mixed-source run, runtime wiring, browser work, Jira changes or story acceptance.

## Diagnosis and source basis

The intended employee journey is a completed offer decline followed by FUCQ-107's brief-refinement question. The published contracts leave an entry gap:

- FUCQ-106 persists a decision and a completed native decline-event receipt atomically with releasing the local hold. Its successful public response already contains the opaque `decisionId`.
- FUCQ-105's controller calls `decide()` and then refreshes the authoritative offer read, including after a lost response. It does not retain the successful POST payload. FUCQ-102's safe read DTO and 105's strict projection contain no follow-up selector.
- FUCQ-107 accepts a `decisionId`, requires a real employee session, and verifies the owned decision, native event and released source. Its newly published client requires the host to supply `decisionId`; it does not resolve an offer into a decline. A successful 106 response alone therefore cannot provide durable entry after reload.

This is a source-confirmed contract gap, not an executed reproduction. Its originating capabilities are FUCQ-102 (authenticated offer read), FUCQ-105 (employee offer presentation), FUCQ-106 (persisted decision) and FUCQ-107 (post-decline refinement), as recorded in `docs/gcsp/fucq-86-90-stories.md`. The source manifest is [followup-entry-source-plan.json](followup-entry-source-plan.json); it contains exact refs, SHA-256 hashes and published-head readbacks. Key pins:

| Capability | Inspected implementation ref | Relevant source |
|---|---|---|
| 102 | `4a56d386f031e7cf5a1fdeaefdcc612fb35cbd7b` | `server/gcsp/offers/access.js`, `access-http.js`, offer-access contract |
| 105 | `cf5a7d38b6d669e8e8d2708812bfff5a9a438b80` | offer controller, projection, HTTP adapter, host and view |
| 106 | `5ce74f94a968db081a38d104a4eeacf66860c83f` | `server/gcsp/offers/decision.js`, `decision-http.js`, decisions contract |
| 107 | `16839323f070f7c0ab81eb1ebf728627d283c71d` | `server/gcsp/offers/followup.js`, `followup-http.js` |

107's inspected backend is byte-identical in published descendants `805c0c53e855b6486d771e0e5ee567b4a302f46f` and `942c85400f81e68f89681ea489443e8aca11b9fd`. The former adds validation history; the latter adds the authored, unexecuted client and composition proposal. The latest remote readback is `942c854`; its client host accepts `decisionId`, trusted `loadAccount`, 105's `projectOffer` and `openOffer(reference)`. Client validation and durable entry remain open. 106's decision implementation is byte-identical to the `53cbb58d6b9eeb776dd6e70fb27c862972cfb150` source referenced by 107. Older `97e36` decision source is not this contract basis. These inspection pins do not establish an executed import graph or actual-producer integration proof.

## Proposed additive public contract

Extend the existing successful schema-version-1 offer DTO with one field:

```js
followup: null | { decisionId: 'offer-decision:<opaque digest>' }
```

Reuse the exact persisted 106 `decisionId`; do not derive a replacement from an offer ID, command or event, create a mapping table, or expose additional internal IDs. The actual 106 format is `offer-decision:` plus an opaque digest and contains no employee ID. A selector is not an authorisation capability.

Emit a non-null value only for the exact authenticated offer's verified completed decline, with terminal `rejected`/`declined` offer and released buddy hold. All other successfully read states have `followup: null`, including active offers, accepted, expired, superseded, decision-pending and release-pending. Never infer completion from the UI state or POST success alone.

For a known declined offer, `followup: null` means that a usable source could not be verified; it does not mean that no follow-up exists. Keep the already-verified declined presentation, with no available decision actions. In 105, show concise follow-up-unavailable copy and an explicit offer refresh action; do not show the question, fabricate a selector, retry a decline or automatically loop. For compatibility, 105 treats an absent field from an older 102 producer the same as null. A backend/query failure or mixed read remains 102's typed retryable `unavailable` result for the whole read. This distinction preserves the known terminal outcome when source rows are missing or malformed, while refusing a read whose sources could not be inspected consistently.

## Lookup, authentication and consistency

Implement a private helper inside the existing 102 `OfferAccessService.read()`, after its existing `#guard` and offer/hold/quote checks, before the final consistency rereads. Keep the same privately branded WeakMap and service instance used by access handlers and injected into 106. Do not introduce an event-ID endpoint or accept a browser-selected decision ID on the 102 read route. The lookup starts from the guarded offer and its existing run-scoped repository context.

1. Require the terminal declined offer and released buddy hold with `releaseReason === 'offer-declined'`. Query `decisions` by the guarded `offerId` in that run, then require a single matching decline; conflicting, duplicate or malformed decision rows produce no handle. Check its persisted ID, positive row version, owner, offer and hold bindings, typed reason and successful declined outcome. Require `outcome.value.decisionId` to equal the selected row ID and `originalResponse` to agree with the original successful result produced by 106.
2. Query only the native `event_receipts` namespace `offer-decisions:events:v1` and `eventType: 'offer-declined'`, then select the one event matching that decision. The repository's existing query port supports these top-level filters; nested matching remains internal. Do not treat automatic insert/command receipts or arbitrary event namespaces as decline evidence. Require exactly one matching receipt.
3. Validate completed receipt state, successful outcome, schema/type and receipt/event ID agreement, `inputDigest(event)` and exact digest-equivalence of `receipt.inputVersions` with `decision.versions`. Match event run, owner, offer, hold, quote, car, entitlement slot, renewal, reason, policy and brief authority. Validate its DemoClock timestamp and refuse a handle for a future event. Only the opaque decision handle enters the new DTO; omit event, employee, actor, command, receipt and access-session IDs from this addition and its diagnostics.
4. Align with 107's source checks: linked offer/hold/quote ownership and quote policy must agree; hold type, slot, renewal and released reason must match the event; quote car, owner, slot and pinned brief must agree. Match event policy, decision reason policy and `decision.versions.policy` to current run policy; separately match quote policy to `decision.versions.quotePolicy`. Keep `decision.versions.brief` (the confirmed historical brief at decline) distinct from `decision.versions.pinnedBrief` (the quoted brief). They can differ. Verify the event's historical confirmed brief exists through an exact run/employee/brief-version read of the existing immutable `briefs` table; do not impersonate an employee or invoke employee-only BriefService using a token context. This is verification of immutable history, not permission to read or expose the employee's current brief.
5. Validate current offer/hold/immutable quote revisions against the successful terminal `decision.outcome.value` revisions and IDs. 106's `decision.versions.offer` and `.hold` are **pre-write** pins; terminal outcome versions are **post-write**. Never compare pre-write pins directly to current terminal versions. The quote version remains the immutable quote pin. Current stock may legitimately change after release; retain 102's existing stock-read consistency checks without requiring stock to remain released or to keep the decision's old version. A follow-up entry does not reserve the car again.
6. Extend 102's existing mixed-read refusal to the additional rows and query membership. Requery the exact decision set and matching native receipt set, and reread observed historical rows, comparing IDs, versions and validated content. A newly matching, removed or changed row during the read must not escape the check. Recheck current run, guarded offer, clock version/time, and existing hold/quote/stock versions across the full lookup. Continue to return typed `unavailable` for any detected race. Use the repository's existing read/query ports; do not use a transaction as a read wrapper because that records a command receipt. Preserve the existing bounded consistency model; this plan does not claim a new atomic snapshot guarantee across separate reads.

A valid offer-link session may recover this one offer's opaque handle. It cannot become an employee session: 107 independently calls `identity.requireRole(context, 'employee')`, verifies ownership before linked reads, and enforces current-run, policy and version authority. Account reads continue to use `authorizeResource(..., 'read')`; decisions still require `write`. Reload must obtain a fresh authentic context through `fromSession`/`fromAccount` on the same composed service, never serialize, clone, transplant or manufacture a brand. 107 receives the ordinary authenticated employee context through its existing middleware, not the 102 capability object.

Missing decisions, no matching native receipt, duplicates, bad digests, mismatched pins, malformed authority or a nonterminal release produce no handle. If the repository cannot perform a required read/query, return typed `unavailable`. These read paths do not write, repair history, append receipts, extend deadlines, release holds, alter a brief or invoke allocation/evaluation.

## Consumer coordination and ownership

| Owner | Proposed work after plan review | Review boundary |
|---|---|---|
| 102 / Hugo | Private verified lookup, additive DTO projection, contract and focused evidence | Existing access-owned source only; no repository/schema/identity/producer/runtime edits |
| 105 lead | Strictly validate and preserve only `followup.decisionId`; connect declined view/host to 107; unavailable/retry presentation | Retain controller's authoritative post-decision refresh, including transport failure; no dependence on POST payload |
| 107 lead | Confirm selector compatibility and adopt the verified entry through its newly authored client/view | Existing `GET /api/gcsp/offer-followup?decisionId=...` and `POST /api/gcsp/offer-followup/confirm`; no new write port; client still awaits validation |
| Dispatcher/integration lead | Coordinate exact source pins, file claims, host wiring and a separately reviewed validation graph | Shared lifecycle, authentication and same-service-instance composition remain explicit integration work |

105's existing offer email URL parser accepts only `offerId` and `runId`; do not append `decisionId` there. The proposed host mounts follow-up from the refreshed DTO and retains the original offer coordinates for reload. Any separate follow-up navigation is a 105/107 client design to review, not an existing route claimed by this plan. 105's controller currently clones its projection, so its strict projection is the field-preservation boundary; changing POST-result storage is unnecessary.

107's opaque public `receiptReference` repair for saved brief changes remains intact. Do not expose the canonical internal brief-event ID or alter the canonical BriefService event format. Root relays this checkpoint to 105/107; their agreement and any changed source hashes must be recorded before implementation or mixed-source execution. Jira journey dependencies alone do not block independent work against this agreed contract; actual unavailable interfaces, conflicting ownership, source limits and explicit holds still apply.

## Proposed validation and remaining gates

**Describe only; no commands executed or grants implied.** Reuse the unchanged 102 timing/access 32/32 evidence at `4a56d38` and `decline-timing-result.md`; do not rerun it just to confirm this document. After plan review and implementation, select checks for the new lookup, changed 105 projection and actual consumer boundary:

- Actual pinned 100 producer → 102 authentic access → 106 local decline; deliberately lose the POST response, reload through 102/105, recover the same persisted handle, then use a real employee session for 107 question and confirmation. Include reload after the brief change so 107 can report the saved result truthfully.
- Valid account and offer-link reads; token-only refusal at 107; wrong owner/run, stale session, foreign access instance, cloned brand and mismatched offer selectors. No handle or linked-source data leaks on failed authentication.
- No decline, missing/duplicate/malformed decision or receipt, incorrect namespace/type, digest/version/owner/slot/renewal/car/policy/brief mismatches, future event and missing historical confirmed brief. Confirm declined-with-null and source-unavailable/race presentations separately.
- Pending and release-pending states, terminal outcome revisions, older pinned versus later decision brief, car reuse after release, and changed query membership or row/clock/run versions during reads. No question until verified completion.
- Read-only invariants: repository rows, deadlines and receipt counts unchanged by reads; exact DTO allowlist; new field contains only the required decision handle. Confirm 105 refresh/clone, URL allowlist, explicit retry and accessible keyboard/responsive presentation with shared components/tokens and the agreed GCSP shell/Used Cars body reference.

Before importing or executing 106/107, prepare and review a fresh finite import graph and exact source/helper/environment hashes. Use a new owned external run manifest, shared `.claude/test-runs/fucq102/` evidence and HostBudget reservation; default one worker, 120 seconds, 768 MiB aggregate memory, 128 MiB combined scratch/output and 2 MiB logs, reduced for measured pressure. Enumerate children/process groups, scratch, dependency links and any ports; preserve bounded original logs/counts and source identities, then verify teardown and reservation absence. No listener/browser/native DB/full-suite or external transport allocation is included here; those require the separately coordinated lane. Preserve the existing installed dependencies. No new dependency or >=256 MiB generated output is proposed.

Actual 106/107 integration, client/browser evidence, central bootstrap/deployment/shutdown, remote uncertainty and authored full validation remain open. No identity, central runtime, shared seed or paused FUCQ-96 scope is added. This checkpoint changes no claim, product-map completion, Jira status or acceptance decision.

Agents: Hugo; requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants. Documentation and source inspection only; product implementation and test execution await plan review.
