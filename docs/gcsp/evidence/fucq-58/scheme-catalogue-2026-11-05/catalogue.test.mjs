import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCatalogue, runDiscovery, DISCOVERY } from './catalogue.mjs';

const record = (overrides = {}) => ({ modelCode: '11FA', agModelCode: '11FA', modelRange: 'F70', steering: 'RL', orderDate: '2026-11-01', effectDate: '2026-11-01', ...overrides });
const tree = () => ({ '1': { modelRanges: { F70: { models: { '11FA': record() }, lines: { BASIC: { defaultModel: { modelCode: 'COMPACT' } } } } } } });
const plan = () => structuredClone(DISCOVERY);
const response = (body, type = 'application/json', status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
const settings = { APP: { backend: { settingsVehicleTree: { headers: { 'x-api-key': 'synthetic-public-setting' } } } } };
const transport = (overrides = {}) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (overrides[calls.length]) return overrides[calls.length](url, options);
    if (calls.length === 1) return response('<html>/en_GB/settings.test123.json</html>', 'text/html');
    if (calls.length === 2) return response(settings);
    return response(tree());
  };
  return { calls, fetchImpl };
};

test('full direct model context is retained, compact references and unknown data are excluded', () => {
  const input = tree();
  input['1'].modelRanges.F70.models['11FA'].opaqueUrl = 'https://invalid.example/private';
  input['1'].modelRanges.F70.models['11FA'].vin = 'PRIVATE-FIXTURE';
  const before = structuredClone(input);
  const result = projectCatalogue(input, 'F70');
  assert.equal(result.requestedRangeFound, true);
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].modelRangeField, 'F70');
  assert.deepEqual(result.models[0].paths, [['1', 'modelRanges', 'F70', 'models', '11FA']]);
  assert.equal(result.models[0].steeringLiteral, 'RL');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes('opaqueUrl'), false);
  assert.deepEqual(input, before);
});
test('consistent repeated group appearances collapse without adding configurations', () => {
  const input = tree(); input.I = structuredClone(input['1']);
  const result = projectCatalogue(input, 'F70');
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].paths.length, 2);
  assert.equal(result.newConfigurations, 0);
});
test('conflicting duplicate context refuses selection', () => {
  const input = tree(); input.I = structuredClone(input['1']); input.I.modelRanges.F70.models['11FA'].agModelCode = '22FB';
  assert.throws(() => projectCatalogue(input, 'F70'), /duplicate-context-conflict/);
});
test('fallback range is explicit and does not qualify requested historical generation', () => {
  const result = projectCatalogue(tree(), 'F44');
  assert.equal(result.requestedRangeFound, false);
  assert.deepEqual(result.returnedRangeKeys, ['F70']);
  assert.equal(result.models[0].catalogueRangeKey, 'F70');
  assert.equal(result.coverageStatus, 'requested-range-unmatched');
});
test('empty successful JSON is bounded negative evidence, never global unavailability', () => {
  const result = projectCatalogue({}, 'F44');
  assert.equal(result.requestedRangeFound, false);
  assert.equal(result.models.length, 0);
  assert.equal(result.coverageStatus, 'requested-range-unmatched');
  assert.equal(result.globalAvailability, 'unknown');
});
test('full identity, literal case and real calendar dates are required', () => {
  for (const overrides of [{ modelCode: 'WRONG' }, { agModelCode: '' }, { steering: 'rl' }, { effectDate: '2026-02-30' }, { orderDate: '2026-11-02' }]) {
    const input = tree(); input['1'].modelRanges.F70.models['11FA'] = record(overrides);
    assert.throws(() => projectCatalogue(input, 'F70'), /model-context/);
  }
});
test('range map key and model range field stay separate', () => {
  const input = tree(); input['1'].modelRanges.F70.models['11FA'].modelRange = 'F70E';
  const result = projectCatalogue(input, 'F70');
  assert.equal(result.models[0].catalogueRangeKey, 'F70');
  assert.equal(result.models[0].modelRangeField, 'F70E');
});
test('output and traversal count are finite', () => {
  const input = tree();
  for (let i = 0; i < 257; i++) input['1'].modelRanges.F70.models['M' + String(i).padStart(3, '0')] = record({ modelCode: 'M' + String(i).padStart(3, '0') });
  assert.throws(() => projectCatalogue(input, 'F70'), /model-count-limit/);
});
test('four read-only serial requests, exact admitted endpoints and no credential retention', async () => {
  const t = transport();
  const result = await runDiscovery(plan(), { fetchImpl: t.fetchImpl });
  assert.equal(result.status, 'completed-discovery');
  assert.equal(t.calls.length, 4);
  assert.equal(result.observations.length, 2);
  assert.equal(result.newConfigurations, 0);
  assert.equal(result.profileActivations, 0);
  for (const { options } of t.calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual'); assert.equal(options.cache, 'no-store');
  }
  assert.equal(JSON.stringify(result).includes('synthetic-public-setting'), false);
});
test('changed plan fails with zero egress', async () => {
  const t = transport(); const p = plan(); p.targets[0].range = 'G61E';
  const result = await runDiscovery(p, { fetchImpl: t.fetchImpl });
  assert.equal(result.stop, 'execution-plan-refused'); assert.equal(t.calls.length, 0);
});
test('redirect, rate limit and unexpected content stop with no retries or body retention', async () => {
  for (const custom of [() => response('PRIVATE', 'text/html', 302), () => response('PRIVATE', 'text/html', 429), () => response('PRIVATE', 'text/plain')]) {
    const t = transport({ 1: custom });
    const result = await runDiscovery(plan(), { fetchImpl: t.fetchImpl });
    assert.equal(result.status, 'stopped'); assert.equal(t.calls.length, 1);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});
test('ambiguous settings discovery stops before header access', async () => {
  const t = transport({ 1: () => response('/en_GB/settings.one.json /en_GB/settings.two.json', 'text/html') });
  const result = await runDiscovery(plan(), { fetchImpl: t.fetchImpl });
  assert.equal(result.stop, 'settings-discovery-shape'); assert.equal(t.calls.length, 1);
});
test('oversize declared and streamed bodies stop at the boundary', async () => {
  for (const declared of [false, true]) {
    const t = transport({ 1: () => new Response('x'.repeat(declared ? 1 : 1048577), { headers: { 'content-type': 'text/html', ...(declared ? { 'content-length': '1048577' } : {}) } }) });
    const result = await runDiscovery(plan(), { fetchImpl: t.fetchImpl });
    assert.match(result.stop, /^(declared-response-too-large|decoded-byte-limit)$/); assert.equal(t.calls.length, 1);
  }
});
test('wall time stops later requests and preserves attempted-request evidence', async () => {
  let time = 0; const t = transport({ 1: () => { time = 45000; return response('/en_GB/settings.one.json', 'text/html'); } });
  const result = await runDiscovery(plan(), { fetchImpl: t.fetchImpl, now: () => time });
  assert.equal(result.stop, 'wall-limit'); assert.equal(t.calls.length, 1); assert.equal(result.requests[0].status, 200);
});
test('complete request timeout also bounds a stalled response body', async () => {
  const t = transport({ 1: (_url, options) => new Response(new ReadableStream({ start(controller) {
    options.signal.addEventListener('abort', () => controller.error(new Error('synthetic-stall-aborted')), { once: true });
  } }), { headers: { 'content-type': 'text/html' } }) });
  const started = Date.now();
  const result = await runDiscovery(plan(), { fetchImpl: t.fetchImpl });
  assert.equal(result.stop, 'request-timeout'); assert.equal(t.calls.length, 1);
  assert.ok(Date.now() - started < 12000);
});
