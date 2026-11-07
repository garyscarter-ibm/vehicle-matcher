# FUCQ-92 release-history handoff for GC-007 / FUCQ-69

Prepared 5 November 2026. The producer-owned read seam is implemented and narrowly validated. Shared manual/HTTP/startup composition remains with its owner.

## Immutable references

- Repaired release producer: `6b3484fb30a056c5bdb0249d81db34f68e1a897d:server/gcsp/stock/index.js`, SHA-256 `7a41fbb67e5349d26748b5f0be5103eb1f6b6765a9b90ebe71a7d5416f9ea9aa`; unchanged by the additive read seam.
- Published producer contract before the additive reader: the same commit, `docs/gcsp/stock-release-contract.md`, SHA-256 `859614b5c289520e5236df43ddb720509c7c65e309d32e6ffd0ca9ac6ef2006b`.
- Current read source: `server/gcsp/stock/history-port.js`, SHA-256 `4bbd6d6f668b806876e81cc672b8361d820308d03d88e4086c1999142ff3e6ba`. It and the extended `docs/gcsp/stock-release-contract.md` are committed with this handoff; use this handoff's exact published commit as their immutable reference.
- F69 contract: `8a3e3bf1c7df44f13f8d432ffc4e9b8598161bbf:docs/gcsp/manual-gallery-contract.md`, SHA-256 `436e7531249a9118af5f37bf7728b8d299432121bf817b92acd2aee2e3be6295`, read and verified. Its authenticated `GET /api/gcsp/manual/stock` owns server visibility/gates; it defines no existing release-history fields.

## Actual read interface and safe projection

Import `createStockReleaseHistoryPort` directly from `server/gcsp/stock/history-port.js`, construct it with the actual `{ repository, identity, clock }`, and call `await port.read(authenticatedEmployeeContext)` behind the existing authenticated manual boundary. No new route, command, event, store or fallback context is introduced. Preserve the existing typed status/value envelope and non-ok outcomes.

A successful value is `{ runId, observedAt, history: { state: 'none-visible' | 'released', releasedCarCount, releaseCount, latestReleasedAt: null | instant, sourceVersions: [] }, source: { state: 'current-version-unknown' } }`. The port uses actual `identity.requireRole(context, 'employee')`, then checks current active run/time before and after reads. Fabricated, nonemployee, expired and stale contexts are refused; changing clock observation requires refresh.

Authoritative history consists of successful completed current-run F92 `event_receipts` (`consumerId: stock-release`, `eventType: stock-released`, outcome kind `stock-released`). Newly released exact UUIDs must match retained stock tranche/window/supply/instant/policy/source provenance. Held/allocated and legacy operational available rows remain historical evidence. Every retained release needs its confirmed receipt. Missing/invalid visibility or missing/mismatched provenance returns unavailable, never zero.

The port applies retained company/scheme/employee visibility before counting. It returns only visible confirmed car count, distinct nonempty visible tranche count, latest visible confirmed release instant and historical source versions; no identities or raw receipts. Replays/empty tranches add no history. `none-visible` means no confirmed release visible to this employee, not no global releases. History remains released when cars are held, allocated, unsuitable or filtered out. The separate actual browse/decision projection owns current matching stock; gallery composition can distinguish visible history absent from no current matching stock without manufacturing availability.

Current provider metadata remains unknown even after historical release versions exist. The pull-only provider has no metadata/health read, and no-release outcomes persist no source metadata. No claim of a healthy/current source or a before-first-release provider version is made.

## Minimal trusted composition and executability

```js
import { createStockReleaseHistoryPort } from './gcsp/stock/history-port.js';
const releaseHistory = createStockReleaseHistoryPort({ repository, identity, clock });
const history = await releaseHistory.read(authenticatedEmployeeContext);
// Keep non-ok outcomes typed; combine ok history with the separate browse result.
```

The existing release producer itself remains `createStockReleaseService({ repository, policy, clock, identity, provider })` with `register()` before DemoClock ticks and Greg-authorized `queueConfirmedSupply(...)`. A normal existing presenter tick invokes release-pull; it commits exact stock and its receipt atomically. It and the read port execute now with the real runtime components and explicitly labelled offline TEST input. Real F77/F78 source data/provider, actual acknowledged supply producer, shared startup/gallery composition and native PostgreSQL remain unproved. Fixtures cannot complete these edges.

## Scoped evidence

`release-history-proof.json` records 13/13 focused actual identity/DemoClock/memory-repository checks, zero skips: authentication/scope, reset/time changes, visibility, retained occupation/legacy history, provenance failures, tranche counting/replay and read-only behavior.

`actual-consumer-proof.json` retains the unchanged proof `b005905fd090699035cf06ffb4f45cc510204d49106b027f5333739e2c75e792`: F92 `6b3484fb30a056c5bdb0249d81db34f68e1a897d`, F96 `d12358bcd02f4c10a5dc9f0851efe94bc2c9d864`, F100 `b4154ce3bfe195564a2d9f17980309d76e545eba`, 3/3. Actual same-tick receipt/pause/replay, unknown-expiry refusal and one atomic hold/offer/outbox pass. The additive reader leaves that exact release producer and its imports unchanged, so the fixed-pin proof is retained without repetition. No fresh full suite, native/live proof, Jira completion or released-run gallery/browser integration is claimed.
