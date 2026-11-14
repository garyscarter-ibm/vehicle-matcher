// Offline generator for order-plan-parity/service-cases.json.gz: Node createOrderPlanService over scripted ports, and the real
// read/preview operations with recorded ports. Never run by the Java tests: node services/gcsp-api/src/test/parity/order-plan-service-parity.mjs
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

register('./forecast-spy-loader.mjs', import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const { createOrderPlanService, createPolicyOrderPlanCatalog, createOrderPlanOperations } = await import(join(root, 'server/gcsp/predict/plan/index.js'));
const { createPolicyService } = await import(join(root, 'server/gcsp/policy/index.js'));
const { fixture } = await import(join(root, 'server/test/helpers/order-plan-fixture.js'));
const { inputDigest } = await import(join(root, 'server/gcsp/repository/index.js'));
const outPath = join(root, 'services/gcsp-api/src/test/resources/order-plan-parity/service-cases.json.gz');
const seed = JSON.parse(await readFile(join(root, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const ASOF = '2026-11-06T00:00:00.000Z';
const RUN = 'service-parity-run';
const cases = [];

// ---- createOrderPlanService over scripted ports -------------------------------------------------------------------------
const scratch = await mkdtemp(join(tmpdir(), 'gcsp-order-plan-service-parity-'));
let counter = 0;
async function policyService(ops = []) {
  const value = clone(seed);
  for (const op of ops) {
    if (op.op === 'remove') value.assumptions = value.assumptions.filter((a) => !a.key.startsWith(op.prefix));
    else if (op.op === 'set') value.assumptions.find((a) => a.key === op.key).value = op.value;
    else if (op.op === 'patch') { let t = value.assumptions.find((a) => a.key === op.key).value; for (const p of op.path.slice(0, -1)) t = t[p]; t[op.path.at(-1)] = op.value; }
  }
  const path = join(scratch, `seed-${counter++}.json`);
  await writeFile(path, JSON.stringify(value));
  return createPolicyService({ filePath: path, retainedFilePaths: [] });
}
const ent = (n, o = {}) => ({ entitlementId: `ent-${n}`, employeeId: `emp-${n}`, renewalId: `ren-${n}`, entitlementSlotId: `slot-${n}`, companyId: 'co-1', schemeId: 'sch-1',
  renewalAt: '2026-12-20T00:00:00.000Z', acceptableDerivativeIds: ['g21-touring-320i', 'g20-saloon-320i'], gates: [], ...o });
const car = (id, derivativeId, o = {}) => ({ stockId: id, derivativeId, availableAt: '2026-11-01T00:00:00.000Z', heldForEntitlementSlotId: null,
  visibility: { companyIds: ['co-1'], schemeIds: ['sch-1'], employeeIds: null }, ...o });
const BASE_ENTS = [ent(1), ent(2, { acceptableDerivativeIds: ['g21-touring-320i'] }), ent(3, { acceptableDerivativeIds: ['g61-i5-40'], renewalAt: '2027-01-15T00:00:00.000Z' })];
const BASE_STOCK = [car('veh-1', 'g21-touring-320i'), car('veh-2', 'g20-saloon-320i', { visibility: { companyIds: ['co-1'], schemeIds: ['sch-1'], employeeIds: ['emp-9'] } }),
  car('veh-3', 'g61-i5-40', { heldForEntitlementSlotId: 'slot-3' }), car('veh-4', 'g20-saloon-330e', { heldForEntitlementSlotId: 'slot-404' })];
const BASE_INBOUND = [{ supplyId: 'ack-1', derivativeId: 'g21-touring-320i', quantity: 1, releasedQuantity: 0, state: 'confirmed', expectedAt: '2026-12-10T00:00:00.000Z',
  provenance: { sourceVersion: 'production-v1' } }];

// Port scripts: each call takes the next entry (the last repeats). An entry is {overlay, omit} on a base value, or {raw} returned as is.
function forecastBase(c, read) {
  return { runId: read.runId, asOf: read.asOf, policyVersion: read.policyVersion, version: 'forecast-v1', cohortVersion: 'cohort-v1',
    forecast: { basis: 'service-parity', horizonEnd: read.horizonEnd, entitlements: clone(c.entitlements ?? BASE_ENTS), limitations: ['Service parity fixture.'] } };
}
function supplyBase(c, read) {
  return { runId: read.runId, asOf: read.asOf, versions: { stock: 'stock-v1', supply: 'supply-v1', catalog: `${read.policyVersion}:order-plan-catalog.v1` },
    stock: clone(c.stock ?? BASE_STOCK), inbound: clone(c.inbound ?? BASE_INBOUND), requests: [{ requestId: 'req-1', commandId: 'cmd-1', derivativeId: 'g21-touring-320i', quantity: 1, state: 'requested', requestedAt: ASOF }],
    responses: [], unboundStock: { count: 1, models: ['3 Series Saloon'] } };
}
function materialize(entry, base) {
  if (entry.raw) return clone(entry.raw);
  const value = { ...base, ...clone(entry.overlay ?? {}) };
  for (const key of entry.omit ?? []) delete value[key];
  if (value.forecast && value.forecast.horizonEnd === undefined && !(entry.omit ?? []).includes('horizonEnd')) value.forecast.horizonEnd = base.forecast?.horizonEnd;
  return { status: 'ok', contractVersion: '1.0.0', value };
}

async function serviceCase(id, c = {}) {
  const policyVersion = c.policyVersion ?? seed.policyVersion;
  const policy = await policyService(c.ops);
  const roles = c.roles ?? ['greg'];
  const calls = { forecast: 0, supply: 0, clock: 0 };
  const pick = (script, n) => script[Math.min(n, script.length - 1)];
  const forecastScript = c.forecast ?? [{}]; const supplyScript = c.supply ?? [{}]; const clockScript = c.clock ?? [{ now: ASOF, clockVersion: 'clock-v1' }];
  const seen = { forecast: [], supply: [] };
  const service = createOrderPlanService({ policy, catalog: createPolicyOrderPlanCatalog({ policy }),
    identity: { async requireRole() { return roles.includes('greg') ? { status: 'ok' } : { status: 'forbidden', reason: 'This person cannot perform that action.', contractVersion: '1.0.0' }; } },
    clock: { async now(context) { const entry = pick(clockScript, calls.clock++); return { status: 'ok', value: { runId: context.runId, ...entry } }; } },
    forecast: { async readForecast(context, read) { const out = materialize(pick(forecastScript, calls.forecast++), forecastBase(c, read)); seen.forecast.push(clone(out)); return out; } },
    supply: { async readSupply(context, read) { const out = materialize(pick(supplyScript, calls.supply++), supplyBase(c, read)); seen.supply.push(clone(out)); return out; } } });
  const expected = await service.readPlan({ runId: RUN, policyVersion });
  cases.push({ id, kind: 'service', roles, runId: RUN, policyVersion, ops: c.ops ?? [], clock: clockScript, forecast: seen.forecast, supply: seen.supply,
    expected: clone(expected) });
}
const bump = { overlay: { version: 'forecast-v2' } };
await serviceCase('service/feasible-read');
await serviceCase('service/no-demand-no-supply', { entitlements: [], stock: [], inbound: [] });
await serviceCase('service/supply-activity-defaults', { supply: [{ omit: ['requests', 'responses', 'unboundStock'] }] });
await serviceCase('service/restricted-visibility-and-holds');
await serviceCase('service/infeasible-bounds', { ops: [{ op: 'set', key: 'orderPlan.budgetMinor', value: 0 }, { op: 'patch', key: 'orderPlan.derivativeBounds', path: [3, 'min'], value: 2 }] });
await serviceCase('service/unsupported-129-entitlements', { entitlements: Array.from({ length: 129 }, (_, i) => ent(i)) });
await serviceCase('service/forecast-changed-between-loads', { forecast: [{}, bump] });
await serviceCase('service/supply-changed-between-loads', { supply: [{}, { overlay: { versions: { stock: 'stock-v2', supply: 'supply-v1', catalog: `${seed.policyVersion}:order-plan-catalog.v1` } } }] });
await serviceCase('service/clock-version-changed', { clock: [{ now: ASOF, clockVersion: 'clock-v1' }, { now: ASOF, clockVersion: 'clock-v2' }] });
await serviceCase('service/forecast-unavailable', { forecast: [{ raw: { status: 'unavailable', code: 'planning-forecast-not-configured', contractVersion: '1.0.0' } }] });
await serviceCase('service/supply-unavailable', { supply: [{ raw: { status: 'unavailable', code: 'planning-supply-not-configured', contractVersion: '1.0.0' } }] });
await serviceCase('service/supply-conflict-second-load', { supply: [{}, { raw: { status: 'conflict', code: 'planning-supply-changed', contractVersion: '1.0.0' } }] });
await serviceCase('service/catalog-removed', { ops: [{ op: 'remove', prefix: 'orderPlan.catalog.v1' }] });
await serviceCase('service/policy-incomplete', { ops: [{ op: 'remove', prefix: 'orderPlan.budgetMinor' }] });
await serviceCase('service/horizon-out-of-range', { ops: [{ op: 'set', key: 'orderPlan.horizonDays', value: 1e12 }] });
await serviceCase('service/horizon-not-a-number', { ops: [{ op: 'set', key: 'orderPlan.horizonDays', value: 'soon' }] });
await serviceCase('service/version-mismatch-supply-catalog', { supply: [{ overlay: { versions: { stock: 's', supply: 'p', catalog: 'other:catalog' } } }] });
await serviceCase('service/version-mismatch-forecast-policy', { forecast: [{ overlay: { policyVersion: 'other-policy' } }] });
await serviceCase('service/version-mismatch-forecast-asof', { forecast: [{ overlay: { asOf: '2026-11-05T00:00:00.000Z' } }] });
await serviceCase('service/version-mismatch-run', { supply: [{ overlay: { runId: 'someone-else' } }] });
await serviceCase('service/stock-visibility-missing', { stock: [{ stockId: 'x', derivativeId: 'g21-touring-320i', availableAt: '2026-11-01T00:00:00.000Z', heldForEntitlementSlotId: null }] });
await serviceCase('service/entitlement-without-company', { entitlements: [ent(1, { companyId: '' })] });
await serviceCase('service/forecast-missing-entitlements', { forecast: [{ overlay: { forecast: { basis: 'x', limitations: [] } } }] });
await serviceCase('service/pinned-policy-version-unknown', { policyVersion: 'no-such-version' });
await serviceCase('service/not-greg', { roles: ['employee'] });
await rm(scratch, { recursive: true, force: true });

// ---- createOrderPlanOperations over the real Node fixture, forecast and supply values recorded --------------------------------
const cleanups = [];
const f = await fixture({ after: (fn) => cleanups.push(fn) });
const supplySeen = [];
const recording = { async readSupply(context, read) { const out = await f.fake.readSupply(context, read); supplySeen.push(clone(out)); return out; } };
const ops = createOrderPlanOperations({ repository: f.repository, policy: f.policy, identity: f.identity, clock: f.clock, supply: recording, requests: f.fake });
const time = (await f.clock.now(f.context)).value;
const forecasts = {}; let supply = null;
const opCases = [];
const touring = (patch) => (bounds) => bounds.map((b) => (b.derivativeId === 'g21-touring-320i' ? { ...b, ...patch } : b));
const derivativeBounds = await f.active('orderPlan.derivativeBounds'); const modelBounds = await f.active('orderPlan.modelBounds');
const model = (patch) => modelBounds.map((b) => (b.modelId === 'g21-touring' ? { ...b, ...patch } : b));
const calls = [
  ['ops/read', 'read', null],
  ['ops/preview-budget', 'preview', { changes: [{ key: 'orderPlan.budgetMinor', value: 2500000 }] }],
  ['ops/preview-budget-zero', 'preview', { changes: [{ key: 'orderPlan.budgetMinor', value: 0 }] }],
  ['ops/preview-derivative-bounds', 'preview', { changes: [{ key: 'orderPlan.derivativeBounds', value: touring({ min: 2 })(derivativeBounds) }] }],
  ['ops/preview-model-bounds', 'preview', { changes: [{ key: 'orderPlan.modelBounds', value: model({ min: 2 }) }] }],
  ['ops/preview-all-keys-unsorted', 'preview', { changes: [{ key: 'orderPlan.modelBounds', value: [...model({ max: 3 })].reverse() },
    { key: 'orderPlan.budgetMinor', value: 40000000 }, { key: 'orderPlan.derivativeBounds', value: touring({ max: 3 })(derivativeBounds) }] }],
  ['ops/preview-infeasible-after-edit', 'preview', { changes: [{ key: 'orderPlan.budgetMinor', value: 0 }, { key: 'orderPlan.derivativeBounds', value: touring({ min: 2 })(derivativeBounds) }] }],
  ['ops/preview-not-editable', 'preview', { changes: [{ key: 'orderPlan.horizonDays', value: 10 }] }],
  ['ops/preview-two-not-editable', 'preview', { changes: [{ key: 'orderPlan.currency', value: 'EUR' }, { key: 'supply.leadTimeDays', value: 1 }] }],
  ['ops/preview-empty-changes', 'preview', { changes: [] }],
  ['ops/preview-duplicate-key', 'preview', { changes: [{ key: 'orderPlan.budgetMinor', value: 1 }, { key: 'orderPlan.budgetMinor', value: 2 }] }],
  ['ops/preview-too-many', 'preview', { changes: [{ key: 'orderPlan.budgetMinor', value: 1 }, { key: 'orderPlan.modelBounds', value: modelBounds }, { key: 'orderPlan.derivativeBounds', value: derivativeBounds }, { key: 'orderPlan.budgetMinor', value: 3 }] }],
  ['ops/preview-extra-field-on-change', 'preview', { changes: [{ key: 'orderPlan.budgetMinor', value: 1, note: 'x' }] }],
  ['ops/preview-change-without-value', 'preview', { changes: [{ key: 'orderPlan.budgetMinor' }] }],
  ['ops/preview-changes-not-array', 'preview', { changes: { key: 'orderPlan.budgetMinor', value: 1 } }],
  ['ops/preview-budget-negative', 'preview', { changes: [{ key: 'orderPlan.budgetMinor', value: -1 }] }],
  ['ops/preview-budget-fraction', 'preview', { changes: [{ key: 'orderPlan.budgetMinor', value: 1.5 }] }],
  ['ops/preview-budget-text', 'preview', { changes: [{ key: 'orderPlan.budgetMinor', value: '100' }] }],
  ['ops/preview-bounds-min-above-max', 'preview', { changes: [{ key: 'orderPlan.derivativeBounds', value: touring({ min: 4, max: 3 })(derivativeBounds) }] }],
  ['ops/preview-bounds-missing-id', 'preview', { changes: [{ key: 'orderPlan.derivativeBounds', value: derivativeBounds.slice(1) }] }],
  ['ops/preview-bounds-unknown-id', 'preview', { changes: [{ key: 'orderPlan.derivativeBounds', value: [...derivativeBounds.slice(1), { derivativeId: 'nope', min: 0, max: 1 }] }] }],
  ['ops/preview-bounds-duplicate-id', 'preview', { changes: [{ key: 'orderPlan.derivativeBounds', value: [...derivativeBounds.slice(1), derivativeBounds[1]] }] }],
  ['ops/preview-bounds-extra-field', 'preview', { changes: [{ key: 'orderPlan.derivativeBounds', value: derivativeBounds.map((b) => ({ ...b, note: 'x' })) }] }],
  ['ops/preview-bounds-not-integer', 'preview', { changes: [{ key: 'orderPlan.modelBounds', value: model({ min: 0.5 }) }] }],
  ['ops/preview-input-extra-field', 'preview', { changes: [{ key: 'orderPlan.budgetMinor', value: 1 }], commandId: 'x' }],
  ['ops/preview-input-missing', 'preview', null],
  ['ops/preview-input-array', 'preview', []],
];
for (const [id, op, input] of calls) {
  globalThis.__forecastSpy = []; supplySeen.length = 0;
  const before = await f.state();
  const out = op === 'read' ? await ops.readPlan(f.context) : await ops.previewPlan(f.context, input ?? undefined);
  assert.deepEqual(await f.state(), before, `${id} wrote`);
  for (const { read, out: result } of globalThis.__forecastSpy) {
    if (forecasts[read.policyVersion]) assert.equal(inputDigest(forecasts[read.policyVersion]), inputDigest(result), `${id} forecast differs for ${read.policyVersion}`);
    forecasts[read.policyVersion] = result;
  }
  for (const out2 of supplySeen) { if (supply) assert.equal(inputDigest(supply), inputDigest(out2)); supply = out2; }
  if (out.status === 'ok') { assert.ok(out.value.learned, `${id} learned`); delete out.value.learned; }
  opCases.push({ id, op, input, expected: clone(out) });
}
for (const [id, op, input] of [['ops/read-by-employee', 'read', null], ['ops/preview-by-employee', 'preview', { changes: [{ key: 'orderPlan.budgetMinor', value: 1 }] }]]) {
  const out = op === 'read' ? await ops.readPlan(f.employee) : await ops.previewPlan(f.employee, input);
  opCases.push({ id, op, input, roles: ['employee'], expected: clone(out) });
}
cases.push({ id: 'ops/recorded-ports', kind: 'ops-ports', runId: f.context.runId, policyVersion: f.context.policyVersion, clock: { now: time.now, clockVersion: time.clockVersion }, forecasts, supply });
for (const c of opCases) cases.push({ ...c, kind: 'ops', roles: c.roles ?? ['greg'] });
for (const fn of cleanups) await fn();

const text = `${JSON.stringify(cases)}\n`;
await writeFile(outPath, gzipSync(text, { level: 9, mtime: 0 }));
const statuses = {}; for (const c of cases) { const s = c.expected?.status; if (s) statuses[`${c.kind}:${s}${c.expected.value?.plan?.status ? `/${c.expected.value.plan.status}` : c.expected.status !== 'ok' ? `/${c.expected.code ?? ''}` : ''}`] = (statuses[`${c.kind}:${s}${c.expected.value?.plan?.status ? `/${c.expected.value.plan.status}` : c.expected.status !== 'ok' ? `/${c.expected.code ?? ''}` : ''}`] ?? 0) + 1; }
console.log(`${cases.length} cases, ${text.length} bytes of JSON`, JSON.stringify(statuses, null, 1));
console.log('forecast versions recorded', Object.keys(forecasts).length);
process.exit(0);
