# FUCQ-102 current backend review — 6 November 2026

The original access service and HTTP adapter are integrated. **32 selected checks passed, zero failures or skips**, on production sources byte-identical to shared `f6ca6ffd019155b3f95df083698132bd58388b81`. This is targeted backend evidence, not full acceptance or a full-suite stamp.

The two existing test files now import the integrated token and buddy-hold modules directly. Their assertions are unchanged; historical external source-overlay environment guards were removed. This makes the original access tests usable in the normal current test tree. No product source changed. The older custom follow-up launcher/test remains on its topic and is not added to the shared test suite by this checkpoint.

```sh
node --test --test-reporter=tap --test-concurrency=1 \
  server/test/gcsp-offer-access.test.js \
  server/test/gcsp-offer-access-producer.test.js
```

## Original acceptance disposition

| Original criterion | Current evidence and remaining work |
|---|---|
| Token exchange | Passing current checks cover hashed environment/run/offer binding, tampering, one-offer credentials, exact origins and the real buildServer request listener. |
| Current offer read | Passing checks cover the stored states, exact persisted expiry, pinned quote/facts, truthful partial current-car inputs and no unrelated employee data. Full current-car presentation is separate FUCQ-105 work. |
| Old links | Real expiry/reset, replay/no-revival, authenticated earlier-run response and generic unknown-token refusal pass. |
| Account route | Real identity/account authority and durable cookie reload produce the same branded offer access; private/forged capabilities are refused. |
| Deployment-configured landing URL | **Still open.** `server/gcsp/offers/offer-token.js` returns relative `/gcsp/offer?...#token=...`; no deployment-configured landing URL input/composition was found in runtime, producer or notification delivery. Tests resolve this relative value against an explicit test origin. That does not demonstrate the configured landing URL required by the original criterion. |

The next implementation step is the existing-scope deployment landing URL configuration and producer/delivery wiring, preserving hashed token binding and safe token custody. This is an unmet original criterion, not a proposed AC addition. Do not change FUCQ-100's original seven criteria or take foreign notification ownership without coordination.

FUCQ-102 is backend-only. FUCQ-105's actual offer-screen/mobile/keyboard and second-browser journey must not become new screenshot requirements on FUCQ-102. No browser, native PostgreSQL, deployed environment or full suite ran in this checkpoint. Existing integrated full-suite evidence remains **1,590 tests: 1,569 pass, 16 fail, 5 skip**, with independent backlog findings and their authorised deferrals retained. Passing this selection does not waive failed/unrun checks or authorise Done.

## Run and cleanup

The existing targeted runner supervised one worker with a 512 MiB RAM allowance, 128 MiB scratch cap and 2 MiB log cap; strict fresh host registry was empty. Runtime was 2.388 seconds with 227,770,368 bytes peak group RSS. No listener, browser or native database was started. Dependency links were temporary references to retained installed dependencies; both links, the owned scratch root and recorded process group were independently verified absent. Sources stayed unchanged; the final raw reservation registry was empty.

An initial admission attempt stopped before launch because the plan named `server/policy/seed-v1.json`. The corrected attempt uses the existing `server/gcsp/policy/seed-v1.json`. The initial failure remains retained; no test assertion or production repair was involved.

Local raw plan, targeted receipt, bounded TAP and ownership receipt remain under `.claude/test-runs/fucq102/current-backend-1944b/`. The parent collection is `.claude/coordination/fucq102-current-backend-root-collection-1944.json`; TAP SHA-256 is `0d944c0548f53ec527af0c4580aab08a8c1beb75770b139c4a72b963d609cb21`. Personal runner, polling setup and raw coordination stay local.

The existing lead was parked; the dispatcher carried this finite review/test integration in the available launcher. No new agent, fallback, model change, Story claim, Jira transition or acceptance checkbox change occurred.
