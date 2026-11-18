# FUCQ-466 canonical decision boundary checkpoint

Status: **partial**, 18 November 2026. Original Story acceptance remains open pending connected visual/source review and the matching covering batch, hosted development topology, real registered OIDC and actual agreed-recipient email evidence. No external email was sent.

The HTTP decision accepts Angular's `runId` and `expectedQuoteVersion` and binds them to the owner and immutable quote revision before writes. The compact internal API remains available. Local decisions save immutable run-clock and quote facts inside their custody/order transaction; the public receipt reads the exact persisted selection operation and actual acknowledged, pending or refused outcome. A response read does not submit or reconcile a provider command. Remote intent/custody semantics are unchanged.

Actual Angular consumer replay found a separate pending identity mismatch: the initial 202 envelope returned a generated `decisionId`, while `OfferClient.pendingIdentityMatches` compares returned identities to the submitted command. The HTTP pending projection now exposes the operation, offer and command coordinates; the durable internal receipt retains its decision ID. No `value` envelope is required for 202: Angular explicitly parses that branch through `parseOfferFailure`.

## Scoped observations

| Check | Actual result |
| --- | --- |
| Parser behavioral RED | Canonical owner command rejected 400 where the owner guard should have returned 403 |
| Receipt behavioral RED | Started app accepted the decision but its compact response failed the public field contract |
| Local HTTP regressions | 24 passed: canonical accept/decline, owner/run/revision guards, replay, changed-input refusal and unchanged HTTP route coverage |
| Real ordering outcomes | 3 passed: missing clock rolls back all writes; actual execute with lost acknowledgement remains pending; explicit reconciliation reads its stored real order; definitive refusal retains allocated selection and failure |
| Remote/auth composition | 2 passed, then remote pending projection regression 1 passed; actual signed JWT, local JWKS and owned PostgreSQL |
| Whole affected offers package | 147 passed, 0 failures/errors/skips, 105 seconds Maven time; includes native races, Node parity and controlled remote boundaries |
| Untouched Angular consumers | Seven actual response fixtures accepted: local accepted/declined, pending/refused/reconciled ordering remote 202 and retained quote/current ordering policy; wrong run/command/private extra field rejected for completed receipts |

The first test launch lacked JAVA_HOME; no test ran. A new pending fixture first failed compilation (missing throws declaration), then JDBC setup rejected Instant; both fixture errors were corrected before the green run. The consumer replay was genuinely RED on the initial remote decision ID before the HTTP projection correction. These failures are retained locally rather than relabelled as passing.

Commands use `_tools/gcsp-offer-decision-contract-proof.cjs` over the unmodified Angular validator and Maven selectors `gcsp.api.offers.**`, with direct `OidcRemoteOfferHttpTest` / `AuthRouteTableHttpTest` chunks. The replay result and consumer hash are in `angular-consumer-2026-11-18.md`. Full suite: deferred to the dispatcher's single coordinated covering batch. The edited shared journey support and new nested test profile are declared triggers for that covering proof; no duplicate full suite is authorized here.

## Resource evidence

Run ownership and supervisor are outside scratch under `.claude/poller/run-20261117-2335/resources/hugh-466-*`. Each Maven chunk owns a fresh native PostgreSQL 17 cluster on localhost:55566, one worker, atomic `/tmp/vm-poller-java-verify.lock`, HostBudget, 2 GiB scratch / 2304 MiB RAM / 600 second bounds, local scratch `/private/tmp/vm-poller-20261118-hugh-466/<label>` and a finalizer. No Render database or old shared cluster is used. No OneDrive location was accessed.

Through the offers chunk, maximum measured scratch was 1,235,290,688 bytes, maximum process-tree RSS 2,256,846,848 bytes. Its finalizer removed 1,246,304,416 bytes and verified scratch absent. All earlier chunk receipts also report scratch absent. Existing bounded Maven target cache is retained (40,549,792 bytes after offers). Logs and compact cleanup receipts remain locally in `resources/hugh-466-evidence`; they contain no bearer tokens or keys.

Ordering/auth/startup scoped checks passed 134 tests. The integrated learning caller was refreshed to the canonical command and immutable receipt serverNow; its package first ran 33 tests with one legacy timestamp assertion failure, corrected and rerun with the affected test. The final policy/learning chunk passed five tests. Actual native Angular command/screens/restart and independent source/visual review remain in progress, followed by the dispatcher covering full validation. FUCQ-467 owns unresolved remote/decline composed proof; the existing 202 inline-success case establishes only its named case. FUCQ-510 remains evidence reconciliation, not a new coding or lifecycle gate.


## Retained-policy review correction

Independent review identified a valid quote retained at an older policy while current ordering uses a successor policy: the initial projection returned 503 after the acceptance transaction committed. Native PostgreSQL regression reproduced expected 200/actual 503, then passed with the correction. A valid exact selection still requires matching owner, run, slot, stock, hold, quote, selection policy/terms policy and actual persisted operation state. When only quote policy differs, the accepted receipt keeps its historical policy and operation ID and returns null for the optional inline selection, which the unchanged strict Angular consumer accepts. It never relabels ordering terms as quote policy. The existing current-offer read remains the saved ordering-progress route. The connected browser proof exercises that route separately.

The final scoped command selected `gcsp.api.offers.OfferBrowserDecisionPgTest,gcsp.api.learning.LearningCaptureHttpTest`: five tests passed, no failures/errors/skips. Receipt `policy-learning-green-receipt.json` reports the owned native cluster stopped and scratch absent. No full suite was rerun.
