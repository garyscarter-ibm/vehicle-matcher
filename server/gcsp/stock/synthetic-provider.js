import { ok } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';
import { STOCK_PULL_VERSION, text, validCar } from './port.js';

/** Offline source simulation. Visibility advances only when its list is pulled on a tick.
 * Reconstruct visibility from committed release receipts, never a process-local cursor.
 */
export function createSyntheticStockProvider({ runId, version, windows, label }) {
  if (!text(runId) || !text(version) || !text(label) || !Array.isArray(windows)
    || windows.some((window) => !text(window.windowId) || !validInstant(window.availableAt)
      || !(window.supplyId === null || text(window.supplyId)) || !Array.isArray(window.stock) || !window.stock.every(validCar))
    || new Set(windows.map((row) => row.windowId)).size !== windows.length
    || new Set(windows.flatMap((row) => row.stock.map((car) => car.orderUuid))).size !== windows.flatMap((row) => row.stock).length) {
    throw new TypeError('Supply a labelled, run-bound synthetic tranche plan with exact cars.');
  }
  const plan = structuredClone(windows);
  return Object.freeze({
    async pull(request) {
      if (request.runId !== runId) return { status: 'stale-run', reason: 'Stock plan belongs to another run.' };
      const known = new Set(request.released.flatMap((row) => row.orderUuids));
      let tranche = null;
      for (const window of plan) {
        if (Date.parse(window.availableAt) > Date.parse(request.asOf)) continue;
        if (window.supplyId !== null && !request.queuedSupply.some((row) => row.supplyId === window.supplyId
          && Date.parse(row.eligibleFrom) <= Date.parse(request.asOf))) continue;
        const next = window.stock.filter((row) => !known.has(row.orderUuid)).slice(0, request.releaseSize);
        if (!next.length) continue;
        tranche = { trancheId: `${version}:${window.windowId}:${window.stock.findIndex((row) => row.orderUuid === next[0].orderUuid)}`,
          windowId: window.windowId, availableAt: window.availableAt, supplyId: window.supplyId, orderUuids: next.map((row) => row.orderUuid) };
        next.forEach((row) => known.add(row.orderUuid));
        break;
      }
      return ok({ schemaVersion: STOCK_PULL_VERSION, runId, observedAt: request.asOf,
        source: { providerId: 'synthetic-stock', mode: 'synthetic', version, label }, tranche,
        stock: plan.flatMap((window) => window.stock).filter((row) => known.has(row.orderUuid)) });
    },
  });
}

/** A target-shaped read fixture exercises the identical pull port; no live adapter. */
export function createStockPullFixtureProvider(readSnapshot) {
  if (typeof readSnapshot !== 'function') throw new TypeError('Supply a snapshot fixture reader.');
  return Object.freeze({ async pull(request) { return readSnapshot(structuredClone(request)); } });
}
