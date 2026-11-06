# FUCQ-100 original seven-criterion disposition — 6 November 2026

FUCQ-100 remains In Progress. Its implementation checkpoint is integrated, but current shared-source evidence does not establish the original AC5 next-candidate caller, and the authored `npm test` target failed. These are separate matters for the dispatcher’s acceptance disposition. No acceptance boxes are changed by this audit.

The seven backend criteria remain fixed. The former eighth Resume/browser criterion belongs to FUCQ-149, awaiting collaborator review and prioritisation. Deferred FUCQ-140–146 findings retain their recorded severity, evidence and human dispositions; they do not become new FUCQ-100 closure criteria. The integration merge is not acceptance or a passing suite. This follows [build-rules.md](../../build-rules.md#demo-delivery-and-scope-control).

## Source and retained evidence

Read-only source audit: shared `gcsp-poc` at `52ec27f9d51d9c820dd5d4461773fdad0b153467`; topic `dev/DEV-2026-11-04-060` at `aa26e9b3e5954c058571219abe928f94a91974f5`. Both matched their upstream and were clean before this metadata update. Shared history contains integration `55d0831823a88ee24b977762c862645afc3c12cd` and evidence publication `bcea33a56053877299d20a91d53a3a0cd4497d94`.

The [corrected required result](required-npm-corrected-result-2026-11-06.md) records `npm test` on `0a061129f324f9de991327d34a2002f90728e8f7`, tree `22eaba3916234c4b9d18f7314f8ed26f12f758fd`: **1,590 tests / 1,569 pass / 16 fail / five skip, exit 1**. The receipt and original spec log still match their recorded SHA256 values (`00c330a36dbcc2f7fc7ff141f578499d25695cd0c1d5c6f238e7e7dd82f6f357` and `4678439e6f05dae94b7bbc5b0b6f78f4cf2bff85b4d70f2b45c6abd4cdd37b44`). This is retained execution evidence, not a new run.

A scoped Git comparison from that tested commit to each audited head found no changes under `server/gcsp/`, or in these five tests: `gcsp-buddy-hold`, `gcsp-buddy-runtime-integration`, `gcsp-buddy-expiry`, `gcsp-buddy-remote`, and `gcsp-repository-contract` (all `.test.js` under `server/test/`). The table below reuses those recorded outcomes for the matching source. It does not assert that the current installed environment was rerun or that the whole current suite passes.

## Original criteria

| AC | Retained execution evidence | Remaining qualification |
|---|---|---|
| 1 — atomic transaction and revalidation | `gcsp-buddy-hold.test.js:64,142,152,168,181,202,276,288,298`: pinned quote/hold/offer/outbox, rollback, revalidation, races and claim-port contract passed. | Constructed allocation-shaped candidates test the consumer port; the shared F96 producer/caller is missing as detailed below. |
| 2 — policy/demo-clock expiry | `gcsp-buddy-hold.test.js:132` and `gcsp-buddy-runtime-integration.test.js:138` passed policy duration and exact server deadline checks. | Backend evidence; no new browser criterion is introduced. |
| 3 — opaque bound token and containment | `gcsp-buddy-hold.test.js:95,124` passed cryptographic binding and plaintext containment, including repository receipts. | No live sending or new browser acceptance claim. |
| 4 — common exclusive authority | Both dynamic cases at `gcsp-buddy-runtime-integration.test.js:170` passed: actual composed manual claim excludes buddy and actual buddy claim excludes manual. Raw shared constraint checks at `gcsp-buddy-hold.test.js:210` also passed. | The actual two-service evidence supersedes the earlier statement that only raw repository exclusion was proved. Native SQL remains unrun. |
| 5 — failed/stale outcome reaches allocation and it tries next candidate; failed claim has no offer/job | Current claim-port stale/conflict zero-write tests passed (`gcsp-buddy-hold.test.js:142,152,288`). An older genuine allocator fallback proof passed 2/2. | Current shared source has no production caller; the older proof’s inputs differ. Do not describe constructed candidates as the current actual next-candidate path. |
| 6 — tick expiry/release/receipt without decline/priority | All five top-level cases and their variants in `gcsp-buddy-expiry.test.js` passed, including actual tick (`:82`) and fresh backend startup (`:109`). | Three composed runtime tests failed earlier handler-list expectations; assertions after those failures remain unverified. The separate expiry results remain intact. |
| 7 — remote-shaped pending and reconciliation | All 17 top-level cases and variants in `gcsp-buddy-remote.test.js` passed, including pending without offer/token (`:133`), confirmation (`:148`), startup (`:165`) and later tick (`:189`). | Controlled synthetic adapter acknowledgments exercise the agreed remote-shaped port. They do not establish live BMW behavior. |

This table is an evidence disposition, not acceptance approval. All seven claimed boxes remain unchecked.

## AC5: exact current implementation boundary

A bounded search of current production JavaScript/TypeScript source under `server/`, `scripts/`, `blocks/` and `shared/` found only the `tryClaim` definition at `server/gcsp/offers/buddy-hold.js:162`; all invocations found are tests. No production `createAllocationService` or `resolveEmployeeContext` implementation was found. `server/gcsp/allocation/index.js` is absent.

`server/gcsp/runtime.js:108` constructs the buddy hold service. Its dependency object (`:120–130`) and returned services (`:146`) expose buddy and contain no allocator. `server/gcsp/identity/index.js` has session/presenter/role/resource methods but lacks `resolveEmployeeContext`. The missing boundary is therefore the F96 allocator’s contender loop and its trusted employee-context resolver/composition into the shared runtime. The buddy claim consumer exists; a missing shared caller cannot be verified by rerunning that consumer alone.

Current SHA256 identities:

| Path | SHA256 |
|---|---|
| `server/gcsp/runtime.js` | `27ab9d02d5fa9b8777b40101f598b1c5b54be1145232e45dfe9a5a0d33672a5f` |
| `server/gcsp/identity/index.js` | `4c60cd226ecceefcedd86c7da73a410bfabbeddbb05aab1aa997c98639f7612c` |
| `server/gcsp/offers/buddy-hold.js` | `b9f1a9be9cf42552a56313492bf0703b49ed715ffe2059f477ee11637c44b3d6` |

No F96 source was edited or adopted. The current shared story `_dev/in-progress/DEV-2026-11-04-059.md` identifies FUCQ-96, `claimed_by: usget`, and has no `paused` field. Earlier coordination wording conflated it with DEV-2026-11-04-017/FUCQ-46; this audit establishes no story-specific F96 pause. Preserve foreign ownership and any separately verified external run pause. There is no ready current-runtime command to propose while the caller is absent. The dispatcher will route the allocator and trusted resolver/composition question to F96’s existing owner, identify the approved current source, and separately release any minimal actual caller/fallback proof. This audit does not turn every F96 journey or startup behavior into a new F100 AC.

## What the older proof really established

The retained isolated proof used allocator and identity blobs from F96 commit `6f15d4d524e7a207ce705befe1d52d8c54ce1cfa` with the real buddy service at F100 checkpoint `6d6ecf02a736d474f00898d7233e02b223a3a0c1`. The exact allocator blob SHA256 is `41a2408c17574102891344fcc57f3df56a046199c896037b58b28d00fbab2dc5`; identity is `6997dcdb24f4bb4bc7388394229d6a4e219e4aa46f4662b64aca4c6ecb447732`.

In that allocator, lines 158–170 select the next contender, skip an already assigned employee/slot/renewal/car, resolve the employee context, invoke `claim.tryClaim`, record `ok`, `conflict` or `stale-version`, assign only on `ok`, and advance the contender index. It is real producer control flow.

The proof wrapper delegated to the actual buddy transaction. Before the first claim it performed a real stock CAS; the actual outcomes were `stale-version`, then `ok` for another car. The proof asserted one successful hold/claim/quote/offer/outbox total, no offer or hold for the stale car, that stale car still released/available, stable same-event replay, and token containment. The first case also explicitly linked the successful outbox to its offer. This is stronger than a constructed-candidate unit test and must not be erased from the record.

Local retained records under `.claude/test-runs/fucq100/` are `pinned96-plan-v1.json`, `fucq100-pinned96-P-a26f69263a40454db99bae203484b35f-plan.json`, its `-receipt.json`, `parent-pinned96-audit.json`, and `pinned96-supervisor.py`. The supervisor’s `PROOF` constant retains the tested source (SHA256 `8d09f8e2a140d1ed79c67ea28d176c1e19a6dd3f72b906511c8c9e9d7940eb54`). The receipt records **two tests / two pass / zero fail or skip, exit 0**, on 5 November 2026 around 22:52 UTC. Its successful 329-byte raw log was not retained (`log_retained: false`, `retained_log: null`); no original TAP availability is claimed.

The inner worker recorded scratch not yet absent before finalization. The outer receipt and independent parent audit subsequently confirm scratch, process groups/PIDs, owner and reservation absent. Preserve both stages rather than rewriting the original worker result.

Of the receipt’s 39 source hashes, 29 match current shared source and ten differ: clock, identity, buddy-hold, offer-token, policy index/publish/seed, recommendation, employee scenario, and buddy-hold test. The loader also deliberately substituted the pinned identity and allocator. The historical result remains valid for those frozen inputs; it is neither exact-current evidence nor proof that the allocator is now composed in shared runtime. Its old command is not authorised for reuse by this metadata update.

## Repository and full-suite obligations

The original repository validation is retained: the raw corrected log records PASS for both `memory: shared TransactionRepository contract` and `postgresql driver double (not live SQL): shared TransactionRepository contract`. The driver double checks adapter/transaction behavior; it does not execute PostgreSQL SQL. The native shared contract and native second-occupying-hold constraint were skipped; five native cases were skipped across the full run because `GCSP_DATABASE_URL` was unset. No database URL or credentials were read for this audit.

F100’s original criteria refer to F81’s repository and shared authority. They do not add an automatic live/native database or BMW validation gate. Keep the native limitation explicit for its existing storage/deployment scope, while retaining the passing memory/driver-double repository-contract evidence for this story. Likewise, controlled remote-shaped acknowledgment is the authored backend port scope, not successful live BMW integration.

The authored `npm test passes` target remains factually unmet: 16 failures, including the already backlogged product/fixture findings, and five skips. Their diagnoses, unreached downstream assertions and authorised merge exception remain in the corrected result and linked backlog; no failure is relabelled PASS. The dispatcher must record the original validation/acceptance disposition separately from the completed integration merge. FUCQ-140–146 and proposed F149 work are not silently added as closure gates or repaired here.

This checkpoint changes only this report and the current story metadata. Validation is static: source/receipt hashes, retained log outcomes, exact scoped Git comparisons, links and diff inspection. No tests, services, browser, native/live calls, claims, agents, Jira/map changes, merge or closure were launched.

## Published F96 compatibility addendum — 6 November 2026

Read-only assessment of live `origin/dev/DEV-2026-11-04-059` at **`d12358bcd02f4c10a5dc9f0851efe94bc2c9d864`**, verified twice against the advertised remote ref, versus shared **`6d5eb9c4dcbb56e26198a12b51d8474e1305cde8`**. Required objects were already present; no fetch or foreign worktree was needed. The named source paths also have no delta at subsequent shared `567136bac3d00b76c0692f9c493f6520c1cd547b`.

The current published F96 source is located. This supersedes the earlier next step to locate it; it does not establish shared runtime integration or passing current execution:

- `server/gcsp/allocation/index.js:173` implements `allocate(presenterContext, event)`. Its real contender loop at `:200` resolves an employee context, calls `claim.tryClaim` at `:207`, records `ok`/`conflict`/`stale-version`, assigns only successful claims, and advances the contender index. `register()` at `:132` connects persisted release/brief trigger consumption to the existing `buddy-allocation` clock stage. Allocator SHA256: `499d32cc9b8ad28f0c14d4e913db0a79a9069322306f6512146b73f530dd8566`.
- `server/gcsp/identity/index.js:206` supplies the trusted presenter-only `resolveEmployeeContext(controller, employeeId)` seam, checking adapter ownership, configured/seeded scheme and slot authority, run and expiry, and issuing no new session/cookie. Identity SHA256: `6997dcdb24f4bb4bc7388394229d6a4e219e4aa46f4662b64aca4c6ecb447732`.
- The F96 candidate structurally matches F100 `BuddyHoldService.tryClaim`: exact owner/run/car, renewal, quote, reasons/ranking fields, operation ID derived from `[runId, eventId, employeeId, orderUuid]`, and seven expected versions: stock, slot, brief, permission, employee, policy and clock. This is static compatibility, not an executed quote/eligibility or transaction result.

The smallest proposed additive source handoff is the allocator module; its resolver method added to current shared identity while preserving newer policy activation and `readPresenterPrincipals`; `runtime.js` construction using the existing repository/policy/clock/identity and **`claim: buddy`**, exposed through runtime dependencies; and `server/index.js` registration before clock sealing/reconciliation. Do not replace the whole older F96 identity or runtime files. Existing policy already supplies the allocation keys/stage and excludes allocation from unattended startup. No new unattended identity design or startup allocation is required for this F100 handoff.

F96's retained producer failure used older F92 stock state `available`. Current shared `server/gcsp/stock/index.js:96` writes **`state: 'released'`**, matching F100's guard and manual-stock reader, while availability remains `available`. That historical state mismatch is not a current code blocker. This correction supplies no new passing producer trial; later guards remain unexecuted.

Minimum proposed proof after approved composition: (1) actual composed allocator → real buddy success, one hold/claim/quote/offer/outbox, and stable same-event replay; (2) a real stock CAS makes the first claim stale, the allocator tries a different candidate, only the successful offer/outbox exists, and replay duplicates nothing. Existing F96 mocked-claim tests cannot replace these two cases. Current-source cases and exact supervisor/source pins must be authored/frozen before a runnable command or execution grant; none is supplied or launched here.

F96 remains `claimed_by: usget`. No owner contact occurred, the historical external dispatcher chat was not verified, and no story-specific pause or credit limitation is established. This checkpoint authorises only evidence/owned-record publication: no foreign edits/adoption/claim/lease/merge, product changes or tests. The dispatcher routes the additive proposal through the existing F96 owner and decides source authorisation, execution admission and eventual F100 acceptance. The original seven ACs, failed full-suite result, F149 boundary and deferred-Bug dispositions remain unchanged.
