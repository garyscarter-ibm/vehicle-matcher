import { createHash } from 'node:crypto';
import { result } from '../repository/index.js';
import { createVehicleSnapshot } from '../../vehicles/index.js';
import { createSyntheticStockProvider } from './synthetic-provider.js';
import { createSyntheticProductionAdapter } from '../supply/synthetic-production.js';

// Demo stock on the existing pull port. Cars use the three reviewed structural configurations
// (policy comparison.configurationSet.v1); the stock rows on top are synthetic and run-bound.
const OBSERVED_AT = '2026-11-05T00:00:00.000Z';
const VERSION = 'demo-synthetic-stock-v1';
const LABEL = 'Synthetic demo stock on reviewed structural configurations; not BMW stock or a published corpus';
const UNTIL = '2027-01-01T00:00:00.000Z';
// Confirmed supply releases after the policy lead time, so its cars outlast the fixed demo window.
const SUPPLY_UNTIL = '2027-12-31T00:00:00.000Z';
const PRODUCTION_VERSION = 'demo-synthetic-production-v1';
// Demo schemes from eligibility.context.mapping; model eligibility is still decided by policy.
export const DEMO_STOCK_NAMESPACE = `synthetic:${VERSION}`;
export const VISIBILITY = { companyIds: ['demo-bmw-fs-uk', 'demo-bmw-rr-production'],
  schemeIds: ['choices-fs-uk', 'choices-rr-production'], employeeIds: null };
// Model-line specs follow server/mapping.js MODEL_SPECS; insurance group and tags are synthetic.
const MODELS = {
  saloon: { model: '3 Series Saloon', derivative: '320i', configurationId: 'Q01QRzIwOlJFRlBBSU5ULFJFRlRSSU0=', key: 'G20 Saloon|320i', name: 'Synthetic 3 Series Saloon 320i',
    body: 'saloon', fuel: 'petrol', boot: 480, zeroTo62: 7.4, sizeClass: 2, insuranceGroup: 30, mpg: 45, tags: ['cruiser'] },
  touring: { model: '3 Series Touring', derivative: '320i', configurationId: 'Q01QRzIxOlJFRlBBSU5ULFJFRlRSSU0=', key: 'G21 Touring|320i', name: 'Synthetic 3 Series Touring 320i',
    body: 'estate', fuel: 'petrol', boot: 500, zeroTo62: 7.4, sizeClass: 2, insuranceGroup: 30, mpg: 44, tags: ['family'] },
  i5: { model: 'i5 Touring', derivative: 'eDrive40', configurationId: 'Q01QRzYxOlJFRlBBSU5ULFJFRlRSSU0=', key: 'G61 i5|i5 40', name: 'Synthetic i5 eDrive40 Touring',
    body: 'estate', fuel: 'ev', boot: 490, zeroTo62: 6.1, sizeClass: 3, insuranceGroup: 35, tags: ['electric'] },
};
// Generated-stock lines with no demo car (FUCQ-77 mappings): line specs from MODEL_SPECS, insurance group and tags synthetic.
// 0-62 varies by derivative (M135, M240i), so it stays unknown until FUCQ-77 supplies per-derivative facts.
const f70 = { body: 'hatchback', fuel: 'petrol', boot: 380, sizeClass: 1 };
const g42 = { body: 'coupe', fuel: 'petrol', boot: 390, sizeClass: 1, seats: 4, tags: ['sporty'] };
const BROWSE_LINES = [
  { ...f70, key: 'F70 Sports Hatch|120', insuranceGroup: 22, tags: ['city'] },
  { ...f70, key: 'F70 Sports Hatch|M135', insuranceGroup: 36, tags: ['sporty'] },
  { ...g42, key: 'G42 Coupe|220i', insuranceGroup: 29 },
  { ...g42, key: 'G42 Coupe|230i', insuranceGroup: 33 },
  { ...g42, key: 'G42 Coupe|M240i', insuranceGroup: 42 },
];
// Browse facts of a model line by its eligibility key, as { name: { value, unit } }; shared with generated stock.
export function modelBrowseFacts(key) {
  const model = [...Object.values(MODELS), ...BROWSE_LINES].find((row) => row.key === key);
  return model ? browseFacts(model) : null;
}
const digest = (...parts) => createHash('sha256').update(parts.join('|')).digest();
function orderUuid(runId, index) {
  const bytes = Buffer.from(digest(VERSION, runId, 'order', index).subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function browseFacts(model) {
  return { body: { value: model.body, unit: null }, fuel: { value: model.fuel, unit: null }, seats: { value: model.seats ?? 5, unit: 'count' },
    boot: { value: model.boot, unit: 'L' }, sizeClass: { value: model.sizeClass, unit: 'ordinal-1-5' },
    ...(typeof model.zeroTo62 === 'number' ? { zeroTo62: { value: model.zeroTo62, unit: 's' } } : {}),
    insuranceGroup: { value: model.insuranceGroup, unit: 'insurance-group' }, tags: { value: model.tags, unit: null },
    ...(model.mpg ? { mpg: { value: model.mpg, unit: 'mpg-imperial' } } : {}) };
}

// Windows come from policy: supply.release.windows offsets from a clock.scenario.v1 named cue.
async function windowsFor(policy, request) {
  const read = { runId: request.runId, asOf: request.asOf, policyVersion: request.policyVersion };
  const [spec, clock] = await Promise.all([policy.getAssumption('supply.release.windows', read), policy.getAssumption('clock.scenario.v1', read)]);
  const config = spec.value?.value; const times = clock.value?.value?.namedTimes;
  const at = typeof config?.cue === 'string' && times && Object.hasOwn(times, config.cue) ? Date.parse(times[config.cue]) : NaN;
  const list = config?.windows;
  if (spec.status !== 'ok' || clock.status !== 'ok' || !Number.isFinite(at) || !Array.isArray(list) || list.length === 0
    || new Set(list.map((row) => row?.windowId)).size !== list.length
    || list.some((row) => typeof row?.windowId !== 'string' || !row.windowId || !Number.isSafeInteger(row.offsetMinutes)
      || !Array.isArray(row.cars) || row.cars.length === 0 || row.cars.some((kind) => !Object.hasOwn(MODELS, kind)))) return null;
  return list.map((row) => ({ windowId: row.windowId, availableAt: new Date(at + row.offsetMinutes * 60000).toISOString(), cars: row.cars }));
}

const fact = (value, unit = null) => ({ status: 'known', value, unit,
  provenance: { sourceRef: `fixture:${VERSION}`, observedAt: OBSERVED_AT, version: VERSION, assurance: 'synthetic-scenario' } });
function exactCar(kind, uuid, orderNumber, until, namespace = DEMO_STOCK_NAMESPACE) {
  const model = MODELS[kind];
  return { orderUuid: uuid, orderNumber, configurationId: model.configurationId,
    corpusVersion: VERSION, revision: 1, visibility: structuredClone(VISIBILITY), availability: { availableUntil: until },
    facts: createVehicleSnapshot({ sourceNamespace: namespace, identityKind: 'exact-stock',
      sourceKeys: { stockId: uuid }, snapshotVersion: VERSION, observedAt: OBSERVED_AT, display: { name: model.name }, facts: {
        eligibilityModelKey: fact(model.key), ...Object.fromEntries(Object.entries(browseFacts(model)).map(([name, row]) => [name, fact(row.value, row.unit)])) } }) };
}

function planFor(runId, windowPlan) {
  const base = 1000000 + digest(VERSION, runId, 'number').readUInt32BE(0) % 8000000;
  let index = 0;
  const windows = windowPlan.map((window) => ({ windowId: window.windowId, availableAt: window.availableAt, supplyId: null,
    stock: window.cars.map((kind) => { const car = exactCar(kind, orderUuid(runId, index), String(base + index), UNTIL); index += 1; return car; }) }));
  return createSyntheticStockProvider({ runId, version: VERSION, label: LABEL, windows });
}

/** Resolves a run's plan on first pull from PolicyService, so a presenter reset (a new run) needs no re-preparation. */
export function createDemoStockProvider({ policy } = {}) {
  const plans = new Map();
  const unavailable = () => result('unavailable', { reason: 'Stock source is unavailable.', retryable: true });
  return Object.freeze({
    async pull(request) {
      if (typeof request?.runId !== 'string' || !request.runId || typeof policy?.getAssumption !== 'function') return unavailable();
      if (!plans.has(request.runId)) {
        let windowPlan;
        try { windowPlan = await windowsFor(policy, request); } catch { windowPlan = null; }
        if (!windowPlan) return unavailable();
        plans.set(request.runId, planFor(request.runId, windowPlan));
      }
      return plans.get(request.runId).pull(request);
    },
  });
}

// Supply cars keep their own namespace, so the run-stock chooser never mistakes a generated run for demo stock.
const SUPPLY_NAMESPACE = 'synthetic:demo-confirmed-supply-v1';
// Seven-digit numbers from 9100000 up never meet the demo windows (at most 9000009).
function supplyWindow(runId, row, held) {
  const first = 9100000 + digest(VERSION, runId, row.supplyId, 'number').readUInt32BE(0) % 800000;
  return { windowId: `supply-${row.supplyId}`, availableAt: row.eligibleFrom, supplyId: row.supplyId,
    stock: Array.from({ length: held.quantity }, (_, i) => exactCar(held.kind, orderUuid(runId, `${row.supplyId}:${i}`), String(first + i), SUPPLY_UNTIL, SUPPLY_NAMESPACE)) };
}

/** Synthetic stand-in for the ordering system. Its state is process memory, keyed by run and supply. */
export function createDemoUpstream() {
  const confirmed = new Map();
  const inner = createSyntheticProductionAdapter({ sourceVersion: PRODUCTION_VERSION,
    choices: Object.values(MODELS).map(({ model, derivative }) => ({ model, derivative })) });
  const production = Object.freeze({
    describe: (...args) => inner.describe(...args),
    submit: (...args) => inner.submit(...args),
    async respond(call) {
      const out = await inner.respond(call);
      const kind = Object.keys(MODELS).find((key) => MODELS[key].model === call.request?.model && MODELS[key].derivative === call.request?.derivative);
      if (out.status === 'ok' && out.value.state === 'confirmed' && kind) confirmed.set(`${call.runId}|${out.value.supplyId}`, { kind, quantity: out.value.quantity });
      return out;
    },
  });
  return Object.freeze({ production, lookup: (runId, supplyId) => confirmed.get(`${runId}|${supplyId}`) ?? null });
}

/** Wraps any pull provider: eligible confirmed supply releases first, then the run's own source (demo or generated). */
export function withConfirmedSupply(provider, upstream) {
  if (typeof provider?.pull !== 'function' || typeof upstream?.lookup !== 'function') throw new TypeError('Supply a pull provider and the demo upstream.');
  return Object.freeze({
    async pull(request) {
      const queued = typeof request?.runId === 'string' && Array.isArray(request.queuedSupply) ? request.queuedSupply : [];
      const windows = queued.flatMap((row) => { const held = upstream.lookup(request.runId, row.supplyId); return held ? [supplyWindow(request.runId, row, held)] : []; });
      if (windows.length) {
        const out = await createSyntheticStockProvider({ runId: request.runId, version: VERSION, label: LABEL, windows }).pull(request);
        if (out.status !== 'ok' || out.value.tranche) return out;
      }
      return provider.pull(request);
    },
    ...(typeof provider.prepareRun === 'function' ? { prepareRun: (runId) => provider.prepareRun(runId) } : {}),
    ...(typeof provider.describe === 'function' ? { describe: (runId) => provider.describe(runId) } : {}),
  });
}
