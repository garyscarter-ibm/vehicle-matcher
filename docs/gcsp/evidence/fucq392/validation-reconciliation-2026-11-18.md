# FUCQ-392 diagnostic delivery reconciliation — 18 November 2026

The original three diagnostic acceptance criteria are met by retained scoped proof on exact matching inputs. This increment changes evidence and the claimed Bug result only. The existing repair is `770538da3acc7491e3ce5ed0b30be186679ec7ff`; no product source, release pin, cache, store or database is changed. Parent retains integration, covering batch and native acceptance.

## Original acceptance and current proof

| Original criterion | Matching retained evidence |
| --- | --- |
| Real offline restore/CLI reports deterministic existing-store rejection and preserves the old pointer/inventory | Case 13 executes the real CLI/restore against two independently valid small corpora with the same dataset/version. It reports `publish-existing` / `store-rejected`, validation `existing` / `conflict` and `dataset-version-conflict` on one URL/path-free JSON line. Exact `active.json` and inventory bytes remain unchanged and the old version reloads. |
| Caught publication filesystem failure reports safe errno without path/URL | Case 64 injects an `ENOSPC` exception at the real registry publication staging boundary. Result retains errno `ENOSPC`, syscall `write`, phase `publication` and bounded cause, omits the private path, preserves pointer/inventory and omits diagnostic from public presentation. The raw filesystem message is excluded by the production `corpusFailure` errno branch; `boundDiagnostic` rejects URL-bearing strings. |
| Relevant artifact restore, registry and CLI boundaries pass | Retained five-file run passes **64/64**, zero failures, cancellations or skips, exact **Node 20.20.2** on macOS arm64. Case 22 separately checks the one-line CLI validation envelope using a stubbed failure; it supplements the real-composition cases above and is not substituted for them. |

The serial command was:

```sh
node --test --test-concurrency=1 server/test/gcsp-fleet-artifacts.test.js server/test/gcsp-fleet-build-entry.test.js server/test/gcsp-vin-registry.test.js server/test/gcsp-vin-publication.test.js server/test/gcsp-policy-service.test.js
```

This is the retained FUCQ-396 proof, run `f396-61140`, selected for the actual shared artifact/policy boundary. Runner duration **8.241 s**, supervised test chunk **8.797 s**. Its original tested HEAD was `578ace04ff597e38fba66f4782db5e8b32d1606d` plus the recorded F396 test delta. On F392's claimed worktree at `ec240de0640bdd662dc583d9736fdb91b050630c`, all **53/53** recorded source/test/dependency inputs were rehashed and match. The canonical input code key is `a1573b2d5b1cb573487f9e4235ca42b4b8bdf7828d655129610fc43164278608`. `reconciliation-inputs-2026-11-18.md` retains all pins, the three case identities/timings, runtime checksums and source receipt/log hashes. Exact equality permits proof reuse; no duplicate runtime was started.

The Node 20.20.2 archive and binary were verified before use. The proof used small synthetic stores, real CLI/publication code, code-approved fixture descriptors and retained file policy, with an unavailable loopback database URL. No live provider or production database was required by the original offline diagnostic acceptance. Fixture substitutions preserve the actual CLI/restore/registry implementation; they do not prove a Render deployment.

## Diagnosis, security and data boundary

Current source still passes the publisher result into `validationFailed(..., 'existing', ..., 'store-rejected')` and preserves caught exceptions through `corpusFailure(error, 'publication')`. The CLI emits bounded validation in its existing single JSON line; public presentation omits diagnostics. Source review confirms no relaxation of source, approval, signature/checksum, immutable identity, retained-history or offline selection rules. No extra input/network authority is introduced. The separate F396 file-policy composition repair is already integrated and is not counted as new F392 implementation.

Data strategy is **default, reuse the existing agreed FUCQ-62 atomic filesystem publication contract**: active pointer, immutable versions and identity inventory remain authoritative; staged rejection must leave selection/history intact. This is a diagnostic projection only, adding no store, schema, query, scan or persistent representation. Relevant operation/cost proof is the bounded synthetic real-CLI conflict and publication exception above, within the existing publication transaction and validation bounds. Contract references: the original Bug and `render-restore-diagnostic-2026-11-11.md`; framework delta assessed against `plugin/skills/design-with-drawio/data-design.md` in the canonical scaffolding repository.

The historical **35/35 Node 26.5.0** result and red-before-repair regressions remain identified in the 11 November evidence. Its named raw targeted receipt is absent locally and was not inspected or relabelled as current proof. No V8/per-worker/per-test measured coverage contexts were collected in the reused run. The impact map records static ownership, fixture/config/subprocess edges and executed checks, not measured coverage; unobserved paths remain unknown. No second run was made solely to populate coverage.

## Resources and limits

No new test/build/review scratch, browser, subprocess worker, dependency link, archive or database was created for this documentation reconciliation: **0 B new scratch cleanup**. Only the small durable Markdown/JSON evidence and Bug result are retained. No OneDrive access, foreground interaction or model descendants.

The reused proof's supervisor reports peak scratch **131,776,704 allocated B**, peak RSS **317,603,840 B**, final outer removal **89,833,664 allocated B** and cleanup issues `[]`. The 41,511,345-logical-byte archive was removed earlier; its allocated deletion total was not measured, so these quantities are not summed. Independent observation on **18 November at 02:16:02 UTC** found all 13 recorded PIDs, owned root/links/reservation and lane absent. This is a timestamped prior observation, not a claim of a fresh cleanup operation. Full lifecycle details and independent review remain in `../fucq396/validation-review-2026-11-18.md` and `../fucq396/independent-review-2026-11-18.md`.

**Full suite: deferred to parent covering batch.** The Bug is ready for scoped delivery review, not native acceptance until the green batch covers integration. Live Render recovery, the historical intermittent source/admission failure and managed-database availability remain unverified separate matters. No successful deployment, cache purge, source collection, full fleet download or native Done transition is claimed or required by these original diagnostic criteria. No screen or user-visible UI behavior changes; visual critique is not applicable to this docs-only increment.
