# FUCQ-116 evidence: documents and vehicle readiness

Backend only. No screen, so screenshots don't apply. The later order progress screen (FUCQ-110) builds on the response shapes in `server/test/fixtures/gcsp-lifecycle-documents-outcomes.json`. That screen remains bound by `docs/gcsp/experience-quality.md`, `docs/gcsp/screens/README.md` and `COMPONENTS.md`.

## What exists

| Path | Role |
|---|---|
| `server/gcsp/lifecycle/documents/index.js` | `LifecycleDocumentService`: tick handler `lifecycle-documents` (`pending-reconciliation`), `readItems`, `readReadiness`, `completeTask`, `observeStage` |
| `server/gcsp/lifecycle/documents/policy.js` | Reads the three keyed assumptions through PolicyService and fails closed |
| `server/gcsp/lifecycle/documents/http.js` | `GET /api/gcsp/documents`, `GET /api/gcsp/documents/readiness?orderUuid=`, `POST /api/gcsp/documents/tasks/complete` |
| `server/gcsp/adapters/synthetic-ordering-documents.js` | `ordering.documentStatus.v1` capability (synthetic) and a live-shaped stub that refuses writes |
| `server/test/fixtures/gcsp-lifecycle-documents-policy-patch.json` | Exact additive canonical-seed rows, for the serial policy lane |

## Boundaries that stay open

- **Stage producer.** The opening stage comes from FUCQ-111's `lifecycleStages.read` (`lifecycle.stages.v1`). The consumer also uses an optional `listOrders(context)` to find orders on a tick; that is a contract refinement proposed to FUCQ-111. The tests inject a fixture, which proves only the consumer mechanics.
- **Renewal authority.** `renewalId` is read from the employee or slot row. When it is absent, exception receipts carry `renewalId: null` and `renewalAuthority: "missing"`, and the renewal-case consumer ignores them. No ID is invented.
- **Shared lanes.** Seed rows, `server/index.js` and runtime composition, `shared-contracts.md` and the product map are prepared as patches, not committed.
- **Not run.** `npm test`, native PostgreSQL, the live provider.

## Targeted validation

`node --test --test-concurrency=1 server/test/gcsp-lifecycle-documents.test.js` ran at commit bfaa959 through a bounded launcher. Result: 10 tests, 10 pass, 0 fail, about 4 s wall time, peak RSS about 230 MB, 0 B scratch, 1 KB log.

The launcher works under these limits: one worker, 120 s, 1024 MiB RAM, 128 MiB combined scratch and log, 2 MiB log, 256 KiB receipt, with 5 GiB disk and 512 MiB RAM held in reserve. Admission charges every ledger row at the larger of its reserved and observed size, and refuses when available memory is unknown. It never rewrites an unreadable ledger and treats unknown RSS as over the limit. On every outcome it stops and joins the process group and verifies it is empty, checks `lsof` for open files under scratch, removes scratch by inode, and releases only its own reservation, with readback.
