# Proposed isolated real-service proof — FUCQ-70

**Not admitted or executed.** This is the precise next bounded request for the dispatcher's source-overlay/test lane. The independently reviewed metadata/controller/DOM checkpoint and source hashes are in `details-validation.json` and `controller-view-validation.json`. No private environment file, listener, native database, browser, real mail or upstream stock action is involved.

## Immutable inputs

Use the committed FUCQ-70 story checkpoint supplying this file, not an unreviewed shared merge. Verify every review source hash from those receipts before allocation. The metadata contract SHA-256 is `1dfcb1bd0206842e90769a12cb92e765ab991d11be1c10fecfa74ab18b48a4d7`; the UI contract SHA-256 is `efcce4466102d152b69d5159be833ec0f421a23ddb04604fa73dc7766325c416`.

Admit exactly these three existing frozen files from `abed0960618fd67a160d857b65029c0f64c9a2a7`, read through the shared scaffolding Git API, into a disposable overlay:

| Overlay path | SHA-256 |
| --- | --- |
| `server/gcsp/manual-claims/index.js` | `32c80ef72d8329fcdbc4a208d9ab911f68156e6234d3917975754415d04ef059` |
| `server/gcsp/adapters/manual-stock.js` | `66e8d7de1662ac778ebc789aa9f93085abb9d2fafed528baf0fd90a9cb6bc771` |
| `server/gcsp/manual-context/index.js` | `3e694f3a68b9d3c9f40b44ddb785bec2edce3b3ada43d491995be77a2930fd43` |

The replacement manual-context source is necessary because it implements occupied-draft safety and the semantic hashing agreed with claims. The frozen claim contract at `f81855fe1814657b8a2b0bbd949ac8e204dec44e:docs/gcsp/manual-claims-contract.md` is SHA-256 `9c31f6f368ed4ed616c755eed168ae6bd75869cf65c4efc811eb0a2cd0cff294`. No producer file is changed in a working tree or committed into FUCQ-70.

## Construction and ownership

After grant, write one dedicated small `docs/gcsp/evidence/fucq70/real-services.test.mjs` probe, review and hash it before execution. Its only execution target is the isolated overlay. Use current real memory repository, canonical PolicyService, DemoIdentity, DemoClock, manual fixture seeder, review metadata and review controller. Construct the actual frozen ManualContextService/ManualClaimsService with the synthetic local stock-action adapter and explicitly register its clock handler. Two small exact released synthetic orders are sufficient; do not copy a corpus. Read all active timing/form bounds from PolicyService and label data synthetic.

Read-only links to the necessary unchanged GCSP modules, policy seed and controller files preserve their source identities. Use file-level links within overlay directories so the three admitted frozen paths can coexist with current dependencies. Resolve all relative module dependencies inside the overlay with Node `--preserve-symlinks`; verify the final import graph before launch. Record every link and file hash, and check all inputs again after the run. The server's observed installed `pg` directory may be linked only inside the owned overlay, with device/inode/package hash recorded. No install, source mutation or checkout dependency link is needed. If another executable source is required, stop before running and propose the exact delta.

The root `_tools/test_resources.py` supervisor owns an external manifest and finalizer at shared `.claude/test-runs/fucq70/real-services/`; all test/proof files and overlay links go beneath its one absolute run-owned scratch root. Use one Node process/test worker, 120 seconds, 768 MiB RSS, 128 MiB scratch and 2 MiB streamed logs. Refresh HostBudget before admission, unset ordinary database aliases and propagate owned TMPDIR/TMP/TEMP. Intended command inside that owned root: `node --preserve-symlinks --test --test-concurrency=1 real-services.test.mjs`. Persist compact pass/failure/checkpoint evidence outside scratch. Stop/join owned processes, remove only manifest-owned overlay/scratch and verify roots, groups, reservations and links absent on every exit; independently audit from the lead. Preserve installed dependencies, working trees and package files.

## Selected acceptance boundary

1. Prepare a real current employee session and complete manual draft; browse the real frozen service and explicitly claim one exact returned `claimInput`. Assert one occupying hold/claim and its pinned quote. Wrap only transport counting around actual service calls; no success doubles.
2. Mount/load the actual review controller against real claim and details service methods. Assert no second claim operation, exact identity/quote/stock number and initial pinned-draft details. Save valid changed contact/return details; assert independent metadata revision, unchanged draft/quote/stock/hold/deadline and policy pin.
3. Continue through one actual review transition. Assert a current active order-review callback, saved exact metadata version and its fixed deadline. Reopen/read/retry; assert the same hold and no renewed deadline. Exercise a changed metadata revision to prove fresh readback still blocks unreviewed continuation.
4. Advance the real DemoClock through presenter operations to exact expiry, then tick/reload. Assert continuation disabled, safe local inputs retained and synthetic stock reconciled by the real handler. In a fresh isolated setup, cancel/change with invalid contact fields; assert confirmed release before navigation and no extra hold.

This proves only actual in-process FUCQ-66/review memory integration. It does not satisfy rendered FUCQ-69 handoff, pending HTTP202/session/origin composition, remote-provider uncertainty, native PostgreSQL, FUCQ-71 selection freeze/order readback, browser/visual or full-suite acceptance. Those remain separately owned gates.

## Current Jira reconciliation

On 5 November at this checkpoint, the lead re-read FUCQ-70 (issue124524, updated `2026-11-05T17:31:02.593-0600`) and both current comments. Comment167305 requests current-context reconciliation and preserves active file ownership. Gary's comment132593 explicitly confirms this independent review metadata/controller scope and FUCQ-69's sole claim POST. The original authored acceptance remains unchanged; the worker-owned technical-readiness note remains preserved. No Jira description, dependency, lifecycle or claim is amended here.
