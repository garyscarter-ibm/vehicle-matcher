import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runQualification } from './qualification.mjs';

const plan = JSON.parse(await readFile(new URL('../plan.json', import.meta.url)));
const secret = 'SYNTHETIC_HEADER_MUST_NOT_BE_RETAINED';
const model = { modelCode: 'T5MJ', agModelCode: '72HH', modelRange: 'G61', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05' };
const tree = { '5': { modelRanges: { G61E: { models: { T5MJ: model } } } }, I: { modelRanges: { G61E: { models: { T5MJ: model } } } } };
const settings = { settingsVehicleTree: { headers: { 'x-api-key': secret } }, settingsRuleSolver: { headers: { 'x-api-key': secret } } };
const solver = () => ({ constructible: true, configuration: { modelCode: 'T5MJ', elements: Object.fromEntries(plan.knownBuild.completeSelectedElements.map(code => [code, { code, type: plan.knownBuild.selectedAccessories.includes(code) ? 'accessory' : 'option' }])) }, privateNote: 'DO_NOT_RETAIN_PRIVATE_BODY' });
// Synthetic transport fixtures mirror the observed schema; they do not count as source evidence.
function transport(patch = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const category = seen.length === 0 ? 'page' : seen.length === 1 ? 'settings' : seen.length === 2 ? 'tree' : 'solver';
    seen.push({ url: String(url), category, method: init.method, redirect: init.redirect, headers: init.headers });
    if (patch.fetchImpl) return patch.fetchImpl(category, init);
    const value = category === 'page' ? '<script src="/en_GB/settings.synthetic.json"></script>' : category === 'settings' ? (patch.settings ?? settings) : category === 'tree' ? (patch.tree ?? tree) : (patch.solver ?? solver());
    return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status: patch.status ?? 200, headers: { 'content-type': category === 'page' ? 'text/html' : 'application/json' } });
  };
  return { fetchImpl, seen };
}

test('fresh strict model selection gates exactly one known build and retains only semantic fields', async () => {
  const t = transport();
  const result = await runQualification(plan, t);
  assert.equal(result.status, 'completed-known-seed-refresh');
  assert.equal(result.attempts, 4);
  assert.equal(result.build.configurationId, plan.knownBuild.configurationId);
  assert.equal(result.build.completeSelectedElements.length, 48);
  assert.deepEqual(result.build.selectedAccessories, ['SE000001']);
  assert.equal(result.modelSelection.distinctSelectedModels, 1);
  assert.equal(result.additionalConfigurations, 0);
  assert.equal(result.profileActivations, 0);
  assert.equal(result.profileQualification, 'unqualified');
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('DO_NOT_RETAIN_PRIVATE_BODY'), false);
  assert.deepEqual(t.seen.map(item => item.category), ['page', 'settings', 'tree', 'solver']);
  const url = new URL(t.seen[3].url);
  assert.equal(url.pathname, '/rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/models/T5MJ');
  assert.equal(url.searchParams.get('included-elements'), 'FKSFU,P0300,S0337,S043L');
  assert.equal(url.searchParams.get('mandatory-elements'), 'S0337');
  assert.equal(t.seen[2].headers['x-api-key'], secret);
  assert.equal(t.seen.every(item => item.method === 'GET' && item.redirect === 'manual'), true);
});

test('missing full record or conflicting duplicate stops before solver', async () => {
  for (const mutate of [value => { delete value.I; }, value => { value.I.modelRanges.G61E.models.T5MJ.steering = 'LL'; }]) {
    const value = structuredClone(tree); mutate(value);
    const result = await runQualification(plan, transport({ tree: value }));
    assert.equal(result.status, 'stopped');
    assert.equal(result.attempts, 3);
    assert.equal(result.build, null);
  }
});

test('redirect and authentication or rate-limit failures stop without retry', async () => {
  for (const status of [302, 401, 403, 429, 500]) {
    const result = await runQualification(plan, transport({ status }));
    assert.equal(result.status, 'stopped');
    assert.equal(result.attempts, 1);
    assert.equal(result.build, null);
  }
});

test('unconstructible, substituted or incomplete selections never corroborate a build', async () => {
  for (const mutate of [value => { value.constructible = false; }, value => { value.configuration.modelCode = 'OTHER'; }, value => { delete value.configuration.elements.S0337; }, value => { value.configuration.elements = {}; }]) {
    const value = solver(); mutate(value);
    const result = await runQualification(plan, transport({ solver: value }));
    assert.equal(result.status, 'stopped');
    assert.equal(result.attempts, 4);
    assert.equal(result.build, null);
  }
});

test('unclassified accessories, code substitution and changed exact identity stop', async () => {
  for (const mutate of [value => { value.configuration.elements.SE000001.type = 'option'; }, value => { value.configuration.elements.S0337.code = 'S0000'; }, value => { value.configuration.elements.S0999 = { code: 'S0999', type: 'option' }; }, value => { value.configuration.elements.S0337.type = 'unknown'; }]) {
    const value = solver(); mutate(value);
    const result = await runQualification(plan, transport({ solver: value }));
    assert.equal(result.status, 'stopped');
    assert.equal(result.build, null);
    assert.equal(result.additionalConfigurations, 0);
  }
});

test('per-response decoded limit stops streaming before any next request', async () => {
  const result = await runQualification(plan, transport({ fetchImpl: async () => new Response('x'.repeat(1048577), { headers: { 'content-type': 'text/html' } }) }));
  assert.equal(result.stop, 'decoded-byte-limit');
  assert.equal(result.attempts, 1);
});

test('aggregate decoded limit stops even when every response fits its individual cap', async () => {
  const t = transport({ fetchImpl: async category => {
    let text = category === 'page' ? '<script src="/en_GB/settings.synthetic.json"></script>' : category === 'settings' ? JSON.stringify(settings) : JSON.stringify(tree);
    text += ' '.repeat(800000 - text.length);
    return new Response(text, { headers: { 'content-type': category === 'page' ? 'text/html' : 'application/json' } });
  } });
  const result = await runQualification(plan, t);
  assert.equal(result.stop, 'decoded-byte-limit');
  assert.equal(result.attempts, 3);
});

test('wrong content type, malformed JSON and missing settings header refuse safely', async () => {
  const result = await runQualification(plan, transport({ fetchImpl: async () => new Response('PRIVATE_DO_NOT_RETAIN', { headers: { 'content-type': 'text/plain' } }) }));
  assert.equal(result.stop, 'unexpected-content-type');
  assert.equal(result.attempts, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE_DO_NOT_RETAIN'), false);
  const t = transport({ fetchImpl: async category => new Response(category === 'page' ? '<script src="/en_GB/settings.synthetic.json"></script>' : '{', { headers: { 'content-type': category === 'page' ? 'text/html' : 'application/json' } }) });
  const malformed = await runQualification(plan, t);
  assert.equal(malformed.stop, 'unexpected-json');
  assert.equal(malformed.attempts, 2);
  const missing = await runQualification(plan, transport({ settings: {} }));
  assert.equal(missing.stop, 'settings-header-shape');
  assert.equal(missing.attempts, 2);
});

test('transport failure is a safe code without raw exception values', async () => {
  const result = await runQualification(plan, transport({ fetchImpl: async () => { throw Error(secret); } }));
  assert.equal(result.stop, 'transport-failure');
  assert.equal(result.attempts, 1);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('unadmitted execution or expanded request budget is refused before transport', async () => {
  for (const patch of [{ executable: false }, { limits: { ...plan.limits, httpAttempts: 5 } }, { solverUrl: 'https://example.invalid/private' }]) {
    const t = transport();
    const result = await runQualification({ ...plan, ...patch }, t);
    assert.equal(result.status, 'stopped');
    assert.equal(result.attempts, 0);
    assert.equal(t.seen.length, 0);
  }
});

test('wall deadline stops before any subsequent request', async () => {
  let current = 0;
  const result = await runQualification(plan, { now: () => current, fetchImpl: async () => {
    current = 45001;
    return new Response('<script src="/en_GB/settings.synthetic.json"></script>', { headers: { 'content-type': 'text/html' } });
  } });
  assert.equal(result.stop, 'wall-limit');
  assert.equal(result.attempts, 1);
});

test('request deadline covers a stalled response body after headers', { timeout: 12000 }, async () => {
  const result = await runQualification(plan, { fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({ start(controller) { signal.addEventListener('abort', () => controller.error(Error('SYNTHETIC_PRIVATE_ABORT'))); } }), { headers: { 'content-type': 'text/html' } }) });
  assert.equal(result.stop, 'request-timeout');
  assert.equal(result.attempts, 1);
  assert.equal(result.build, null);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_ABORT'), false);
});
