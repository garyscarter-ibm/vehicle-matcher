import { createHash } from 'node:crypto';
import { result } from '../repository/index.js';
import { createVehicleSnapshot } from '../../vehicles/index.js';
import { createSyntheticStockProvider } from './synthetic-provider.js';

// Demo stock on the existing pull port. Cars use the three reviewed structural configurations
// (policy comparison.configurationSet.v1); the stock rows on top are synthetic and run-bound.
const OBSERVED_AT = '2026-11-05T00:00:00.000Z';
const VERSION = 'demo-synthetic-stock-v1';
const LABEL = 'Synthetic demo stock on reviewed structural configurations; not BMW stock or a published corpus';
const UNTIL = '2027-01-01T00:00:00.000Z';
// Demo schemes from eligibility.context.mapping; model eligibility is still decided by policy.
const VISIBILITY = { companyIds: ['demo-bmw-fs-uk', 'demo-bmw-rr-production'],
  schemeIds: ['choices-fs-uk', 'choices-rr-production'], employeeIds: null };
// Model-line specs follow server/mapping.js MODEL_SPECS; insurance group and tags are synthetic.
const MODELS = {
  saloon: { configurationId: 'Q01QRzIwOlJFRlBBSU5ULFJFRlRSSU0=', key: 'G20 Saloon|320i', name: 'Synthetic 3 Series Saloon 320i',
    body: 'saloon', fuel: 'petrol', boot: 480, zeroTo62: 7.4, sizeClass: 2, insuranceGroup: 30, mpg: 45, tags: ['cruiser'] },
  touring: { configurationId: 'Q01QRzIxOlJFRlBBSU5ULFJFRlRSSU0=', key: 'G21 Touring|320i', name: 'Synthetic 3 Series Touring 320i',
    body: 'estate', fuel: 'petrol', boot: 500, zeroTo62: 7.4, sizeClass: 2, insuranceGroup: 30, mpg: 44, tags: ['family'] },
  i5: { configurationId: 'Q01QRzYxOlJFRlBBSU5ULFJFRlRSSU0=', key: 'G61 i5|i5 40', name: 'Synthetic i5 eDrive40 Touring',
    body: 'estate', fuel: 'ev', boot: 490, zeroTo62: 6.1, sizeClass: 3, insuranceGroup: 35, tags: ['electric'] },
};
// The first window is the presenter release cue; later windows release on later ticks.
const WINDOWS = [
  { windowId: 'demo-release-1', availableAt: '2026-11-05T09:30:00.000Z', cars: ['saloon', 'touring', 'touring', 'i5', 'saloon'] },
  { windowId: 'demo-release-2', availableAt: '2026-11-05T12:00:00.000Z', cars: ['touring', 'saloon', 'i5'] },
  { windowId: 'demo-release-3', availableAt: '2026-11-06T09:00:00.000Z', cars: ['touring', 'i5', 'saloon'] },
];

const digest = (...parts) => createHash('sha256').update(parts.join('|')).digest();
function orderUuid(runId, index) {
  const bytes = Buffer.from(digest(VERSION, runId, 'order', index).subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function planFor(runId) {
  const fact = (value, unit = null) => ({ status: 'known', value, unit,
    provenance: { sourceRef: `fixture:${VERSION}`, observedAt: OBSERVED_AT, version: VERSION, assurance: 'synthetic-scenario' } });
  const base = 1000000 + digest(VERSION, runId, 'number').readUInt32BE(0) % 8000000;
  let index = 0;
  const windows = WINDOWS.map((window) => ({ windowId: window.windowId, availableAt: window.availableAt, supplyId: null,
    stock: window.cars.map((kind) => {
      const model = MODELS[kind]; const uuid = orderUuid(runId, index);
      const car = { orderUuid: uuid, orderNumber: String(base + index), configurationId: model.configurationId,
        corpusVersion: VERSION, revision: 1, visibility: structuredClone(VISIBILITY), availability: { availableUntil: UNTIL },
        facts: createVehicleSnapshot({ sourceNamespace: `synthetic:${VERSION}`, identityKind: 'exact-stock',
          sourceKeys: { stockId: uuid }, snapshotVersion: VERSION, observedAt: OBSERVED_AT, display: { name: model.name }, facts: {
            eligibilityModelKey: fact(model.key), body: fact(model.body), fuel: fact(model.fuel), seats: fact(5, 'count'),
            boot: fact(model.boot, 'L'), sizeClass: fact(model.sizeClass, 'ordinal-1-5'), zeroTo62: fact(model.zeroTo62, 's'),
            insuranceGroup: fact(model.insuranceGroup, 'insurance-group'), tags: fact(model.tags),
            ...(model.mpg ? { mpg: fact(model.mpg, 'mpg-imperial') } : {}) } }) };
      index += 1; return car;
    }) }));
  return createSyntheticStockProvider({ runId, version: VERSION, label: LABEL, windows });
}

/** Resolves a run's plan on first pull, so a presenter reset (a new run) needs no re-preparation. */
export function createDemoStockProvider() {
  const plans = new Map();
  return Object.freeze({
    async pull(request) {
      if (typeof request?.runId !== 'string' || !request.runId) return result('unavailable', { reason: 'Stock source is unavailable.', retryable: true });
      if (!plans.has(request.runId)) plans.set(request.runId, planFor(request.runId));
      return plans.get(request.runId).pull(request);
    },
  });
}
