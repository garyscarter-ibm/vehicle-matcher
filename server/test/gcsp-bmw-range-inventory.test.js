/** Small synthetic source protocol fixtures; zero live traffic or admitted configurations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputDigest } from '../gcsp/repository/core.js';
import * as source from '../../scripts/gcsp/public-bmw-source.mjs';
import * as registration from '../../scripts/gcsp/bmw-public-registration.mjs';
import { createCollectionSession } from '../../scripts/gcsp/collection-session.mjs';

const version = 'f59-range-inventory-20261107.v1';
const moment = () => Date.parse('2026-11-07T12:00:00Z');
const functions = () => {
  for (const key of ['validatePublicBmwInventoryPlan', 'publicBmwInventoryOperations', 'projectBmwRangeInventory', 'validatePublicBmwInventoryObservation'])
    assert.equal(typeof source[key], 'function', `the separate observation-only inventory stage must expose ${key}`);
  return source;
};
function plan() {
  return { schemaVersion: 'bmw-source-range-inventory-plan.v1', planId: 'g42-inventory-fixture', qualificationDate: '2026-11-07',
    source: { id: 'bmw-uk-public', kind: 'public-bmw-uk', version },
    inventoryRegistration: { schemaVersion: 'bmw-public-range-inventory-registration.v1', market: 'GB', locale: 'en-GB',
      catalogueRangeKey: 'G42', pageModelCode: '2PMC', treeEffectDate: '2026-11-01', treeOrderDate: '2026-11-01' },
    limits: { maxAttempts: 1, retryDelayMs: 0, concurrency: 1, imageRequests: 0, sourceAttempts: 3,
      sourceBytes: 4194304, responseBytes: 1048576, operationTimeoutMs: 10000, deadlineMs: 90000, checkpointBytes: 4194304,
      cacheEntries: 8, cacheRetentionMs: 86400000, requestBudgets: { page: 1, settings: 1, discover: 1 } } };
}
function tree() {
  const model = { modelCode: '2PMC', agModelCode: '12CM', modelRange: 'G42', steering: 'RL',
    orderDate: '2026-11-01', effectDate: '2027-01-05', modelName: 'Fixture Coupe', unknown: 'PRIVATE_UNKNOWN' };
  const range = { models: { '2PMC': model, '2PMD': { ...model, modelCode: '2PMD', agModelCode: '22CM', steering: 'LL' } },
    lines: { S0337: { option: 'S0337', defaultModel: { modelCode: '2PMC', agModelCode: '12CM' }, includedTransmissionVariants: [
      { configuration: { modelCode: '2PMC', elements: { S0337: { type: 'option' } } } },
      { configuration: { modelCode: '2PMD', elements: { S0337: { type: 'option' } } } },
    ], unknown: 'PRIVATE_LINE' } }, unknown: 'PRIVATE_RANGE', pricing: { amount: 99999 } };
  return { 2: { modelRanges: { G42: range } }, I: { modelRanges: { G42: structuredClone(range) } },
    OTHER: { modelRanges: { SECRET: { models: { RAW: 'PRIVATE_OTHER' } } } } };
}
async function setup(t, mutate = () => {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bmw-range-inventory-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const p = plan(); const raw = tree(); const settings = { APP: { backend: { settingsVehicleTree: { 'x-api-key': 'PRIVATE_BOOTSTRAP' } } } };
  const fixture = { p, raw, settings }; mutate(fixture); const calls = [];
  const http = { kind: 'fixture', fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/configure/')) return new Response('settings.fixture.json', { headers: { 'content-type': 'text/html' } });
    if (url.includes('/settings.')) return Response.json(settings);
    if (url.includes('/vehicle-trees/')) return Response.json(raw);
    throw new Error('unexpected inventory egress');
  } };
  return { ...fixture, calls, statePath: join(dir, 'primary.json'), http };
}
async function session(f) {
  const api = functions(); const p = api.validatePublicBmwInventoryPlan(f.p);
  return createCollectionSession({ identity: { planDigest: inputDigest(p) }, operations: api.publicBmwInventoryOperations(p), limits: p.limits,
    statePath: f.statePath, http: f.http, now: moment, initialState: { inventoryObservation: null, accepted: [] },
    validateState: (state) => {
      assert.deepEqual(state.accepted, []);
      if (state.inventoryObservation) api.validatePublicBmwInventoryObservation(p, state.inventoryObservation, 'source-fixture');
    } });
}
async function collect(f) {
  const work = await session(f);
  return work.withCheckpoint(async ({ state, execute, commit }) => {
    if (!state.inventoryObservation) {
      const page = await execute('page', {}); await execute('settings', { path: page.settingsPath });
      state.inventoryObservation = await execute('discover', {}); await commit('inventory-observed');
    }
    return structuredClone(state.inventoryObservation);
  });
}

test('inventory registration pins only literal request inputs and refuses presumed returned facts or construction budgets', () => {
  const api = functions(); const p = plan(); assert.deepEqual(api.validatePublicBmwInventoryPlan(p), p);
  assert.equal(registration.BMW_INVENTORY_SOURCE_VERSION, version);
  for (const [key, value] of Object.entries({ agModelCode: '12CM', aliases: ['2'], rawModelRange: 'G42', effectDate: '2027-01-05', steering: 'RL', optionsTrim: 'S0337' })) {
    const bad = structuredClone(p); bad.inventoryRegistration[key] = value;
    assert.throws(() => api.validatePublicBmwInventoryPlan(bad), { code: 'source-inventory-plan' });
  }
  for (const mutate of [p => { delete p.inventoryRegistration.treeEffectDate; }, p => { p.inventoryRegistration.treeOrderDate = '2026-02-30'; },
    p => { p.limits.requestBudgets.options = 1; }, p => { p.candidates = []; }, p => { p.modelRegistration = {}; }]) {
    const bad = plan(); mutate(bad); assert.throws(() => api.validatePublicBmwInventoryPlan(bad), { code: 'source-inventory-plan' });
  }
});

test('direct inventory preserves actual future model dates, full observed aliases and same-response line pointers without assuming AG', async (t) => {
  const f = await setup(t); const retained = await collect(f); const report = retained.document.report;
  assert.equal(f.calls.length, 3); assert.deepEqual(report.observedAliases, ['2', 'I']);
  assert.equal(report.modelNodes.length, 4); assert.equal(report.modelNodes[0].facts.effectDate, '2027-01-05');
  assert.deepEqual(report.modelAliases.find(r => r.modelKey === '2PMC').aliases, ['2', 'I']);
  assert.equal(report.modelAliases.find(r => r.modelKey === '2PMC').consistent, true);
  assert.equal(report.seedPresent, true); assert.equal(report.additionalConfigurations, 0);
  assert.equal(report.lineRows.find(r => r.pointer === '/2/modelRanges/G42/lines/S0337/defaultModel/agModelCode').value, '12CM');
  assert.equal(report.lineRows.find(r => r.pointer === '/2/modelRanges/G42/lines/S0337/includedTransmissionVariants/0/configuration/elements/S0337').type, 'object');
  const encoded = await readFile(f.statePath, 'utf8'); assert.doesNotMatch(encoded, /PRIVATE_BOOTSTRAP|PRIVATE_UNKNOWN|PRIVATE_LINE|PRIVATE_RANGE|PRIVATE_OTHER|99999/);
  const urls = registration.bmwInventoryRequestUrls(f.p.inventoryRegistration); assert.equal(f.calls[0].url, urls.page); assert.equal(f.calls[2].url, urls.discover);
  assert.match(f.calls[2].url, /effect-dates\/2026-11-01\/order-dates\/2026-11-01/);
  assert.deepEqual(f.calls[2].options.headers, { 'x-api-key': 'PRIVATE_BOOTSTRAP' });
  await collect(f); assert.equal(f.calls.length, 3);
});

test('inventory reports missing seed, missing and invalid direct fields, key mismatch and conflicting aliases as gaps', () => {
  const api = functions(); const p = plan(); const raw = tree();
  delete raw[2].modelRanges.G42.models['2PMC'].agModelCode;
  raw[2].modelRanges.G42.models['2PMC'].effectDate = 'INVALID';
  raw.I.modelRanges.G42.models['2PMC'].agModelCode = '99CM';
  raw.I.modelRanges.G42.models['2PMD'].modelCode = 'OTHER';
  p.inventoryRegistration.pageModelCode = 'ZZZZ';
  const r = api.projectBmwRangeInventory(raw, p.inventoryRegistration);
  assert.equal(r.seedPresent, false); assert.equal(r.modelAliases.find(r => r.modelKey === '2PMC').consistent, false);
  assert.deepEqual(r.modelNodes[0].missingFields, ['agModelCode']); assert.deepEqual(r.modelNodes[0].invalidFields, [{ field: 'effectDate', type: 'string' }]);
  assert.equal(r.modelNodes.find(r => r.pointer === '/I/modelRanges/G42/models/2PMD').issues.includes('model-key-mismatch'), true);
  assert.equal(JSON.stringify(r).includes('INVALID'), false);
});

test('inventory refuses absent full models and finite alias, model, line and safe-projection bounds without truncation', () => {
  const api = functions();
  for (const mutate of [raw => { delete raw[2].modelRanges.G42.models; }, raw => { for (let i = 0; i < 9; i++) raw['A' + i] = structuredClone(raw[2]); },
    raw => { raw[2].modelRanges.G42.models = Object.fromEntries(Array.from({length: 129}, (_, i) => ['M' + String(i).padStart(3, '0'), {}])); },
    raw => { raw[2].modelRanges.G42.lines = Object.fromEntries(Array.from({length: 129}, (_, i) => ['S' + i, {}])); }]) {
    const raw = tree(); mutate(raw); assert.throws(() => api.projectBmwRangeInventory(raw, plan().inventoryRegistration), error => /^source-inventory-/.test(error.code));
  }
});

test('inventory source version rejects options and solver capabilities and refuses mutated endpoint or query before fetch', async (t) => {
  const f = await setup(t); const api = functions(); const p = f.p; const r = p.inventoryRegistration;
  for (const capability of ['bmw-options', 'bmw-solver']) {
    await assert.rejects(createCollectionSession({ identity: { planDigest: inputDigest(p) }, limits: { ...p.limits, requestBudgets: { bad: 1 } }, statePath: f.statePath, http: f.http,
      operations: { bad: { kind: 'read-only-http', sourceId: 'bmw-uk-public', sourceVersion: version, capability, requestRegistration: r,
        prepare: async () => ({ method: 'GET', url: registration.bmwInventoryRequestUrls(r).page, headers: {} }), project: v => v } } }), { code: 'invalid-session' });
  }
  for (const [capability, url] of [['bmw-page', 'https://configure.bmw.co.uk/en_GB/configure/G21/T3PF'],
    ['bmw-model-tree', registration.bmwInventoryRequestUrls(r).discover + '&extra=true'],
    ['bmw-model-tree', registration.bmwInventoryRequestUrls(r).discover.replace('G42', 'G21')]]) {
    const work = await createCollectionSession({ identity: { planDigest: inputDigest(p) }, limits: { ...p.limits, requestBudgets: { bad: 1 } }, statePath: f.statePath, http: f.http,
      operations: { bad: { kind: 'read-only-http', sourceId: 'bmw-uk-public', sourceVersion: version, capability, requestRegistration: r,
        prepare: async () => ({ method: 'GET', url, headers: {} }), project: v => v } } });
    await assert.rejects(work.withCheckpoint(({ execute }) => execute('bad', {})), { code: 'source-endpoint-refused' });
  }
  assert.equal(f.calls.length, 0); assert.equal(Object.keys(api.publicBmwInventoryOperations(p)).join(','), 'page,settings,discover');
});

test('retained inventory hashes, request metadata and direct projections are revalidated after outer resealing', async (t) => {
  const api = functions(); const f = await setup(t); await collect(f); const bytes = await readFile(f.statePath); const original = JSON.parse(bytes);
  for (const mutate of [r => { r.document.report.modelNodes[0].facts.agModelCode = '99CM'; },
    r => { r.document.observation.request.url += '&changed=1'; }, r => { r.sha256 = '0'.repeat(64); }]) {
    const env = structuredClone(original); mutate(env.content.inventoryObservation); env.contentDigest = inputDigest(env.content);
    await writeFile(f.statePath, JSON.stringify(env)); await assert.rejects(collect(f), { code: 'source-inventory-binding' });
  }
  api.validatePublicBmwInventoryObservation(f.p, original.content.inventoryObservation, 'source-fixture');
});

test('strict JSON and header-privacy rules fail closed before retaining inventory', async (t) => {
  functions();
  for (const body of ['{"2":{},"2":{}}', '{"2":']) {
    const f = await setup(t); const fetch = f.http.fetch; f.http.fetch = (url, options) => url.includes('/vehicle-trees/') ? new Response(body, {headers:{'content-type':'application/json'}}) : fetch(url, options);
    await assert.rejects(collect(f), error => /^source-/.test(error.code));
  }
  const f = await setup(t, ({raw}) => { raw[2].modelRanges.G42.models['2PMC'].modelName = 'PRIVATE_BOOTSTRAP'; });
  await assert.rejects(collect(f), { code: 'source-sensitive-projection' });
  assert.equal((await readFile(f.statePath, 'utf8')).includes('PRIVATE_BOOTSTRAP'), false);
});


test('safe inventory output stops at its byte ceiling and never silently omits a late alias', () => {
  const api = functions(); const raw = tree();
  const model = raw[2].modelRanges.G42.models['2PMC'];
  raw[2].modelRanges.G42.models = Object.fromEntries(Array.from({length:128}, (_, i) => {
    const modelCode = 'M' + String(i).padStart(3, '0');
    return [modelCode, {...model, modelCode, modelName:'x'.repeat(160),modelNameRaw:'y'.repeat(160),derivative:'z'.repeat(160)}];
  }));
  raw.I = structuredClone(raw[2]);
  assert.throws(() => api.projectBmwRangeInventory(raw, plan().inventoryRegistration), {code:'source-inventory-output-limit'});
});

test('a caller cannot manufacture executor metadata for an inventory response', () => {
  const api = functions(); const p = plan(); const descriptor = api.publicBmwInventoryOperations(p).discover;
  assert.throws(() => descriptor.project(tree(), {}, {schemaVersion:'collection-http-observation.v1', sourceVersion:version}), {code:'source-observation-metadata'});
});


test('large unrelated line properties and element payloads do not consume relationship rows', () => {
  const raw = tree();
  for (const alias of ['2', 'I']) {
    const line = raw[alias].modelRanges.G42.lines.S0337;
    for (let i = 0; i < 1600; i++) line['unrelated' + i] = { description: 'PRIVATE_LARGE_LINE', price: i, nested: { text: 'PRIVATE_NESTED' } };
    for (const variant of line.includedTransmissionVariants) {
      for (let i = 0; i < 1600; i++) variant.configuration.elements['OTHER' + i] = { code: 'PRIVATE_ELEMENT', type: 'option' };
      variant.configuration.elements.S0337 = { type: 'option', payload: Object.fromEntries(Array.from({length:1600}, (_,i) => ['p' + i, 'PRIVATE_TRIM_PAYLOAD'])) };
    }
  }
  const report = functions().projectBmwRangeInventory(raw, plan().inventoryRegistration);
  assert.equal(report.modelNodes.length, 4); assert.deepEqual(report.observedAliases, ['2', 'I']);
  assert.ok(report.lineRows.length < 48);
  assert.equal(report.lineRows.find(row => row.pointer.endsWith('/0/configuration/elements/S0337')).type, 'object');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|unrelated|OTHER|payload|price|description|\/type/);
});

test('finite relationship collection and row ceilings expose only safe path count and type diagnostics', () => {
  const raw = tree(); raw[2].modelRanges.G42.lines.S0337.includedTransmissionVariants = Array.from({length:129}, () => ({}));
  assert.throws(() => functions().projectBmwRangeInventory(raw, plan().inventoryRegistration), error => {
    assert.equal(error.code, 'source-inventory-line-limit');
    assert.deepEqual(error.inventoryDiagnostic, {schemaVersion:'bmw-inventory-limit.v1', path:'/2/modelRanges/G42/lines/S0337/includedTransmissionVariants', kind:'entries', count:129, limit:128, type:'array'});
    return true;
  });
  const many = tree(); delete many.I;
  many[2].modelRanges.G42.lines = Object.fromEntries(Array.from({length:128}, (_,i) => ['S' + i, {option:'S' + i, defaultModel:{modelCode:'2PMC',agModelCode:'12CM'}, includedTransmissionVariants:[{configuration:{modelCode:'2PMC', elements:{['S'+i]:{}}}}]}]));
  assert.throws(() => functions().projectBmwRangeInventory(many, plan().inventoryRegistration), error => {
    assert.equal(error.code,'source-inventory-line-limit'); assert.equal(error.inventoryDiagnostic.kind,'rows');
    assert.equal(error.inventoryDiagnostic.count,769); assert.equal(error.inventoryDiagnostic.limit,768); return true;
  });
});
