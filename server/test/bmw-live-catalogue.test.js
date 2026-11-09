import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBmwCatalogueAdapter, describeBmwEquipment, mergeBmwCatalogueFacts } from '../vehicle-evidence/bmw-catalogue-adapter.js';
import { BMW_LIVE_CATALOGUE_PROVIDER, BMW_LIVE_CATALOGUE_SOURCE, bmwCatalogueProviderSelection, createBmwCatalogueProvider,
  createBmwLiveCatalogueProvider, presentBmwLiveCatalogue, selectBmwCatalogueSnapshot } from '../vehicle-evidence/bmw-live-catalogue.js';

// Every response below is a synthetic fixture shaped like the 1 Nov 2026 evidence; no real upstream data or key is used.
const snapshot = JSON.parse(await readFile(new URL('../vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url)));
const KEY = 'fixture-key-7c1e0b52';
const STATE = '3f2b8c1e-6d4a-4b7e-9c0d-1a2b3c4d5e6f';
const PRICE = 987654;
const O = 'https://prod.ucp.bmw.cloud';
const clock = () => new Date('2026-11-09T10:00:00Z');
const FORBIDDEN = ['/garage', 'configuration-state', 'marketing-texts', 'pricing', STATE];

const sample = (over = {}) => ({
  market: 'GB', locale: 'en-GB', catalogueDate: '2026-11-01', orderDate: '2026-11-01', effectDate: '2027-01-05',
  productionDate: '2027-01-05', taxDate: '2027-01-05', modelCode: 'T5MJ', modelRange: 'G61E', rawModelRange: 'G61',
  agModelCode: '72HH', trim: 'S0337', selectedOptions: [...snapshot.selectedOptions].reverse(),
  selectedAccessories: [{ code: 'SE000001', type: 'accessory', quantity: 1 }], selectionComplete: true, ...over,
});
const codesOf = (r) => [...r.selectedOptions, ...r.selectedAccessories.map(({ code }) => code)].sort();
const urls = (r) => {
  const dated = `effect-dates/${r.effectDate}/order-dates/${r.orderDate}`;
  return {
    matrix: `${O}/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/${r.catalogueDate}/order-dates/${r.orderDate}?gfs-policy=none&cluster=default&model-ranges=${r.modelRange}&future-models=true&closest-fallback=true`,
    solver: `${O}/rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb/${dated}/models/${r.modelCode}?included-elements=${codesOf(r).join(',')}&mandatory-elements=${r.trim}&add-rules-for-mandatory-element-classes=fabric,paint,rim&application=connext`,
    options: `${O}/localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb/${dated}/applications/connext/models/${r.modelCode}/options/languages/en?trim=${r.trim}`,
    otd: `${O}/otd/country-groups/eu27+/ag-models/${r.agModelCode}/validity-dates/${r.effectDate}/otd-for-configuration?included-options=${codesOf(r).join(',')}`,
  };
};

const node = (over = {}) => ({ modelCode: 'T5MJ', modelRange: 'G61E', rawModelRange: 'G61', agModelCode: '72HH', orderDate: '2026-11-01',
  effectDate: '2027-01-05', taxDate: '2027-01-05', prodDate: '20270105', technicalData: { length: '0000', height: '0000' }, ...over });
const matrixBody = (nodes = [node()]) => ({ vehicleTree: { ranges: [{ range: 'G61E', models: nodes }] } });
const solverBody = ({ modelCode = 'T5MJ', codes = codesOf(sample()), types = {}, drop = [], add = {}, changes = {}, constructible = true } = {}) => ({
  constructible, configuration: { modelCode, elements: {
    ...Object.fromEntries(codes.filter((code) => !drop.includes(code)).map((code) => [code, { code, type: types[code]
      || (code === 'SE000001' ? 'accessory' : 'option') }])), ...add } },
  configurationState: STATE,
  configurationChanges: { addedElements: {}, removedElements: {}, ignoredElements: {}, invalidElements: {}, ...changes },
});
const optionsBody = () => Object.fromEntries([...snapshot.selectedOptions, 'S03AC'].map((code) => [code, {
  option: code, optionType: code.startsWith('P0') ? 'paint' : code === 'FKSFU' ? 'fabric' : 'other',
  phrases: { longDescription: code === 'S03AC' ? 'Towbar' : `Label ${code}` },
  marketingTexts: { longText: 'Text<br>with markup' }, price: PRICE }]));
const four = [['N_SITZE', 5], ['A_GEPR_V211', 490], ['A_GEPR_V214', 1700], ['E_0_100KMH', 6.1]];
const otdBody = (pairs = four, extra = 0) => ({ businessKey: '1', status: 1, retailPrice: PRICE,
  values: [...pairs, ...Array.from({ length: extra }, (_, i) => [`OTHER_${i}`, i])].map(([referenceName, targetValue]) => ({ referenceName, targetValue })) });

function harness(r, responses, extra = {}) {
  const allowed = new Map(Object.entries(urls(r)).map(([name, url]) => [url, name]));
  const calls = [];
  const transport = async (call) => {
    const name = allowed.get(call.url);
    assert.ok(name, `unexpected request ${call.url}`);
    assert.ok(!FORBIDDEN.some((part) => call.url.includes(part)), `forbidden ${call.url}`);
    assert.equal(call.method, 'GET'); assert.equal(call.credentials, 'omit'); assert.equal(call.body, undefined);
    assert.equal(call.headers['x-api-key'], KEY); assert.equal(call.retries, 0);
    calls.push(name);
    const value = responses[name];
    if (typeof value === 'function') return value(call);
    return { status: 200, body: JSON.stringify(value) };
  };
  return { calls, transport, ...extra };
}
const happy = (r = sample(), over = {}) => ({ matrix: matrixBody(), solver: solverBody(), options: optionsBody(), otd: otdBody(four, 68), ...over });
const live = (transport, over = {}) => createBmwLiveCatalogueProvider({ selected: true, transport, getCredential: () => KEY, clock, ...over });
const run = (responses, r = sample()) => {
  const h = harness(r, responses);
  return live(h.transport).resolve(r).then((result) => ({ result, calls: h.calls }));
};
const allUnknown = (result) => {
  for (const fact of Object.values(result.facts)) assert.equal(fact.state, 'unknown');
  assert.deepEqual(result.unmappedMeasurements, []);
  assert.equal(result.equipment.selected.state, 'unknown');
};

function guardNetwork(context) {
  let external = 0;
  const stop = () => { external += 1; throw new Error('network forbidden'); };
  context.mock.method(globalThis, 'fetch', stop);
  const ready = Promise.all(['node:http', 'node:https'].map(async (name) => {
    const { default: transport } = await import(name);
    context.mock.method(transport, 'request', stop); context.mock.method(transport, 'get', stop);
  }));
  return async () => { await ready; assert.equal(external, 0); };
}

test('default selection is the snapshot adapter and makes no transport call', async (context) => {
  const done = guardNetwork(context);
  let calls = 0;
  const transport = () => { calls += 1; throw new Error('forbidden'); };
  for (const env of [{}, { GCSP_CATALOGUE_PROVIDER: '' }, { GCSP_CATALOGUE_PROVIDER: 'snapshot', GCSP_BMW_UCP_API_KEY: KEY }]) {
    assert.equal(bmwCatalogueProviderSelection(env), 'snapshot');
    const result = await createBmwCatalogueProvider({ env, transport }).resolve(sample());
    assert.equal(result.status, 'ok'); assert.equal(result.sourceKind, 'dated-snapshot');
    assert.equal(result.provider, 'bmw-catalogue-snapshot');
  }
  const adapter = createBmwCatalogueAdapter();
  assert.equal(createBmwCatalogueProvider({ env: {}, snapshotAdapter: adapter }), adapter);
  assert.equal(bmwCatalogueProviderSelection({ GCSP_CATALOGUE_PROVIDER: 'bmw-ucp-live' }), 'live');
  assert.equal(bmwCatalogueProviderSelection({ GCSP_CATALOGUE_PROVIDER: 'Live' }), 'unrecognised');
  assert.equal(calls, 0);
  await done();
});

test('exact live chain makes four ordered reads and keeps every claim distinct', async (context) => {
  const done = guardNetwork(context);
  const request = sample();
  const { result, calls } = await run(happy());
  assert.deepEqual(calls, ['matrix', 'solver', 'options', 'otd']);
  assert.equal(result.provider, BMW_LIVE_CATALOGUE_PROVIDER);
  assert.equal(result.sourceVersion, BMW_LIVE_CATALOGUE_SOURCE);
  assert.equal(result.sourceKind, 'live'); assert.equal(result.snapshotVersion, null);
  assert.equal(result.status, 'partial'); assert.equal(result.failure, null); assert.equal(result.snapshotChoice, null);
  assert.deepEqual(result.requestedIdentity, result.resolvedIdentity);
  assert.deepEqual(result.resolvedIdentity.selectedOptions, [...snapshot.selectedOptions].sort());
  assert.deepEqual(result.resolvedIdentity.selectedAccessories, [{ code: 'SE000001', type: 'accessory', quantity: 1 }]);
  assert.equal(result.resolvedIdentity.productionDate, '2027-01-05');
  assert.deepEqual(result.resolvedLookupIdentity.selectedOptions, result.resolvedIdentity.selectedOptions);
  assert.equal(result.retrievedDate, '2026-11-09'); assert.equal(result.observedDate, '2026-11-09');
  assert.equal(result.catalogueValidity.effectDate, '2027-01-05');
  assert.equal(result.identityProvenance.marketBasis, 'request-path');
  assert.equal(result.identityProvenance.accessoryQuantityBasis, 'request');
  assert.deepEqual(result.resolution, { exact: true, constructible: true, differences: [],
    options: { added: [], removed: [], retyped: [], ignored: [], invalid: [], unrecognised: [] } });
  assert.deepEqual(result.facts.seats, { state: 'known', value: 5, definition: 'SEATS', unit: 'COUNT', completeness: 'complete',
    provenance: { kind: 'observed', source: 'BMW UK OTD', observedDate: '2026-11-09' } });
  assert.equal(result.facts.acceleration.value, 6.1); assert.equal(result.facts.luggageExpanded.value, 1700);
  assert.equal(result.facts.bodyLength.state, 'unknown'); assert.equal(result.facts.bodyLength.reason, 'placeholder-value');
  assert.equal(result.unmappedMeasurements.length, 68);
  assert.deepEqual(result.unmappedMeasurements[0], { state: 'unknown', value: null, reason: 'unmapped-meaning' });
  assert.equal(result.completeness.measurements, 'partial'); assert.equal(result.completeness.availableOptions, 'partial');
  assert.equal(result.equipment.definitions.length, 47);
  assert.equal(result.equipment.definitions.find(({ code }) => code === 'P0300').category, 'paint');
  const selected = describeBmwEquipment(result, 'S0337');
  assert.equal(selected.catalogueSelection.state, 'selected'); assert.equal(selected.definition.state, 'defined');
  assert.equal(selected.definition.label, 'Label S0337'); assert.equal(selected.verifiedVinFitted.state, 'unknown');
  const towbar = describeBmwEquipment(result, 'S03AC');
  assert.equal(towbar.catalogueSelection.state, 'not-selected'); assert.equal(towbar.definition.state, 'unknown');
  assert.equal(towbar.configurableAvailability.state, 'available'); assert.equal(towbar.configurableAvailability.completeness, 'partial');
  assert.deepEqual(result.equipment.selected.accessories, [{ code: 'SE000001', type: 'accessory', quantity: 1 }]);
  assert.equal(mergeBmwCatalogueFacts({}, result).seats.value, 5);
  const text = JSON.stringify(result);
  for (const secret of [KEY, STATE, String(PRICE), 'retailPrice', 'marketing', 'markup', '<br>']) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(request, sample());
  await done();
});

test('status is ok only with four known measurements, no unmapped values and every label known', async () => {
  const { result } = await run(happy(sample(), { otd: otdBody() }));
  assert.equal(result.status, 'ok'); assert.equal(result.completeness.measurements, 'complete');
  const options = optionsBody(); delete options.S0230; options.S02PA.phrases.longDescription = '<b>x</b>';
  const partial = (await run(happy(sample(), { otd: otdBody(), options }))).result;
  assert.equal(partial.status, 'partial'); assert.equal(partial.completeness.optionDefinitions, 'partial');
  assert.equal(partial.equipment.definitions.find(({ code }) => code === 'S0230').label.state, 'unknown');
  assert.equal(partial.equipment.definitions.find(({ code }) => code === 'S02PA').label.value, null);
});

const MUTATIONS = {
  'added option': [{ add: { S09ZZ: { code: 'S09ZZ', type: 'option' } } }, 'live-identity-mismatch', { added: ['S09ZZ'] }, ['selectedOptions']],
  'removed option': [{ drop: ['S0880'] }, 'live-identity-mismatch', { removed: ['S0880'] }, ['selectedOptions']],
  'option retyped as accessory': [{ types: { S0880: 'accessory' } }, 'live-identity-mismatch', { retyped: ['S0880'] }, ['selectedOptions', 'selectedAccessories']],
  'accessory retyped as option': [{ types: { SE000001: 'option' } }, 'live-identity-mismatch', { retyped: ['SE000001'] }, ['selectedOptions', 'selectedAccessories']],
  'unknown element type': [{ types: { S0880: 'package' } }, 'live-identity-mismatch', { retyped: ['S0880'] }, ['selectedOptions']],
  'ignored elements': [{ changes: { ignoredElements: { S0880: { code: 'S0880' } } } }, 'live-identity-mismatch', { ignored: ['S0880'] }, []],
  'invalid elements': [{ changes: { invalidElements: { S0880: { code: 'S0880' } } } }, 'live-identity-mismatch', { invalid: ['S0880'] }, []],
  'source-listed added': [{ changes: { addedElements: { S0880: { code: 'S0880' } } } }, 'live-identity-mismatch', { added: ['S0880'] }, []],
  'unrecognised change': [{ changes: { conflictingElements: { S0880: {} } } }, 'live-identity-mismatch', { unrecognised: ['conflictingElements'] }, []],
  'not constructible': [{ constructible: false }, 'live-not-constructible', {}, []],
  'accessory quantity': [{ add: { SE000001: { code: 'SE000001', type: 'accessory', quantity: 2 } } }, 'live-identity-mismatch', {}, ['selectedAccessories']],
};
for (const [name, [solver, code, lists, fields]] of Object.entries(MUTATIONS)) {
  test(`solver mutation (${name}) is a reported mismatch before options or OTD`, async (context) => {
    const done = guardNetwork(context);
    const { result, calls } = await run(happy(sample(), { solver: solverBody(solver) }));
    assert.deepEqual(calls, ['matrix', 'solver']);
    assert.equal(result.status, 'identity-mismatch'); assert.equal(result.failure.code, code);
    assert.equal(result.resolution.exact, false);
    assert.equal(result.resolution.constructible, solver.constructible ?? true);
    for (const [list, expected] of Object.entries(lists)) assert.deepEqual(result.resolution.options[list], expected);
    assert.deepEqual(result.resolution.differences.map(({ field }) => field), fields);
    assert.deepEqual(result.requestedIdentity.selectedOptions, [...snapshot.selectedOptions].sort());
    assert.equal(result.snapshotChoice, null);
    allUnknown(result);
    assert.ok(!JSON.stringify(result).includes(STATE));
    await done();
  });
}

test('an accessory quantity stated by the source is used as stated', async () => {
  const add = { SE000001: { code: 'SE000001', type: 'accessory', quantity: 1 } };
  const { result } = await run(happy(sample(), { solver: solverBody({ add }) }));
  assert.equal(result.resolution.exact, true); assert.equal(result.identityProvenance.accessoryQuantityBasis, 'source');
});

test('an added option appears in the resolved identity and a retype moves the code, never merging silently', async () => {
  const added = (await run(happy(sample(), { solver: solverBody({ add: { S09ZZ: { code: 'S09ZZ', type: 'option' } } }) }))).result;
  assert.ok(added.resolvedIdentity.selectedOptions.includes('S09ZZ'));
  assert.ok(!added.requestedIdentity.selectedOptions.includes('S09ZZ'));
  assert.notEqual(added.resolvedLookupIdentity, null);
  const retyped = (await run(happy(sample(), { solver: solverBody({ types: { S0880: 'accessory' } }) }))).result;
  assert.ok(!retyped.resolvedIdentity.selectedOptions.includes('S0880'));
  assert.equal(retyped.resolvedIdentity.selectedAccessories.find(({ code }) => code === 'S0880').quantity, 1);
  assert.equal(retyped.identityProvenance.accessoryQuantityBasis, 'assumed');
  const missingTrim = (await run(happy(sample(), { solver: solverBody({ drop: ['S0337'] }) }))).result;
  assert.deepEqual(missingTrim.resolution.differences.map(({ field }) => field), ['selectedOptions', 'trim']);
});

for (const [name, change, field] of [['effect date', { effectDate: '2027-02-01' }, 'effectDate'], ['AG model', { agModelCode: '72HJ' }, 'agModelCode'],
  ['range', { modelRange: 'G60E' }, 'modelRange'], ['raw range', { rawModelRange: 'G60' }, 'rawModelRange'],
  ['order date', { orderDate: '2026-10-01' }, 'orderDate'], ['tax date', { taxDate: '2027-02-01' }, 'taxDate'],
  ['production date', { prodDate: '20270201' }, 'productionDate'], ['missing production date', { prodDate: undefined }, 'productionDate']]) {
  test(`matrix change of ${name} is a mismatch with no solver call`, async (context) => {
    const done = guardNetwork(context);
    const { result, calls } = await run({ matrix: matrixBody([node(change)]) });
    assert.deepEqual(calls, ['matrix']);
    assert.equal(result.status, 'identity-mismatch'); assert.equal(result.failure.code, 'live-identity-mismatch');
    assert.deepEqual(result.resolution.differences.map((item) => item.field), [field]);
    assert.equal(result.resolvedLookupIdentity, null); assert.equal(result.resolvedIdentity.selectedOptions, null);
    allUnknown(result);
    await done();
  });
}

test('a model missing from the live matrix is not found, with no solver call', async () => {
  for (const matrix of [matrixBody([node({ modelCode: 'T5MK' })]), { ranges: [] }, { modelCode: 3 }]) {
    const { result, calls } = await run({ matrix });
    assert.deepEqual(calls, ['matrix']);
    assert.equal(result.status, 'not-found'); assert.equal(result.failure.code, 'live-not-found');
    assert.equal(result.resolvedIdentity, null); allUnknown(result);
  }
});

test('G21 T3MQ resolving to T3SK petrol is rejected before any specification or image join', async (context) => {
  const done = guardNetwork(context);
  const options = ['P0300', 'S0337', 'FKSFU', 'S043L'];
  const request = sample({ modelCode: 'T3MQ', modelRange: 'G21', rawModelRange: 'G21', agModelCode: '22FZ', selectedOptions: options, selectedAccessories: [] });
  const nodes = [node({ modelCode: 'T3MQ', modelRange: 'G21', rawModelRange: 'G21', agModelCode: '22FZ' }),
    node({ modelCode: 'T3SK', modelRange: 'G21', rawModelRange: 'G21', agModelCode: '22FY', prodDate: '20270105' })];
  const { result, calls } = await run({ matrix: matrixBody(nodes), solver: solverBody({ modelCode: 'T3SK', codes: options }) }, request);
  assert.deepEqual(calls, ['matrix', 'solver']);
  assert.equal(result.status, 'identity-mismatch'); assert.equal(result.failure.code, 'live-identity-mismatch');
  assert.equal(result.requestedIdentity.modelCode, 'T3MQ');
  assert.equal(result.resolvedIdentity.modelCode, 'T3SK'); assert.equal(result.resolvedIdentity.agModelCode, '22FY');
  assert.deepEqual(result.resolution.differences.map(({ field }) => field), ['modelCode', 'agModelCode']);
  assert.deepEqual(result.resolution.differences[0], { field: 'modelCode', requested: 'T3MQ', resolved: 'T3SK' });
  assert.equal(result.resolution.constructible, true);
  allUnknown(result);
  assert.deepEqual(mergeBmwCatalogueFacts({ seats: { value: 4 } }, result), { seats: { value: 4 } });
  await done();
});

test('invalid or incomplete requests are rejected before any read', async (context) => {
  const done = guardNetwork(context);
  const dup = sample(); dup.selectedOptions = [...dup.selectedOptions, dup.selectedOptions[0]];
  const bad = [sample({ selectionComplete: false }), dup, sample({ selectedOptions: [] }),
    sample({ selectedAccessories: [{ code: 'SE000001', type: 'option', quantity: 1 }] }),
    sample({ trim: undefined }), sample({ effectDate: '2027-02-30' }), null, 'x'];
  for (const request of bad) {
    const h = harness(sample(), {});
    const result = await live(h.transport).resolve(request);
    assert.equal(result.status, 'invalid-input'); assert.equal(result.failure.code, 'invalid-request');
    assert.equal(result.requestedIdentity, null); assert.deepEqual(h.calls, []); allUnknown(result);
  }
  await done();
});

test('OTD placeholders, strings, negatives and duplicates stay unknown with the adapter reasons', async () => {
  const cases = [
    [[['N_SITZE', '0000']], 'seats', 'placeholder-value'], [[['A_GEPR_V211', '-']], 'luggageNormal', 'placeholder-value'],
    [[['A_GEPR_V214', null]], 'luggageExpanded', 'missing-value'], [[['E_0_100KMH', undefined]], 'acceleration', 'missing-value'],
    [[['E_0_100KMH', '6.1']], 'acceleration', 'malformed-value'], [[['A_GEPR_V211', -1]], 'luggageNormal', 'malformed-value'],
    [[['N_SITZE', 5.5]], 'seats', 'malformed-value'], [[['A_GEPR_V211', 490], ['A_GEPR_V211', 490]], 'luggageNormal', 'malformed-value'],
  ];
  for (const [pairs, name, reason] of cases) {
    const rest = four.filter(([reference]) => !pairs.some(([ref]) => ref === reference));
    const { result } = await run(happy(sample(), { otd: otdBody([...rest, ...pairs]) }));
    assert.equal(result.status, 'partial');
    assert.equal(result.facts[name].state, 'unknown', name); assert.equal(result.facts[name].reason, reason, name);
    assert.equal(result.facts[name].value, null);
    assert.equal(result.completeness.measurements, 'partial');
    const text = JSON.stringify(result);
    assert.ok(!text.includes(String(PRICE)) && !text.includes('retailPrice'));
  }
  const { result } = await run(happy(sample(), { matrix: matrixBody([node({ technicalData: { length: 4800 } })]), otd: otdBody() }));
  assert.equal(result.facts.bodyLength.reason, 'unmapped-source');
});

test('absent access returns a labelled source-unavailable with a non-automatic snapshot offer', async (context) => {
  const done = guardNetwork(context);
  const fail = (result, code) => {
    assert.equal(result.status, 'source-unavailable'); assert.equal(result.failure.code, code);
    assert.equal(result.provider, 'bmw-catalogue-live'); assert.equal(result.sourceKind, 'live');
    assert.equal(result.snapshotChoice.automatic, false); assert.equal(result.snapshotChoice.provider, 'bmw-catalogue-snapshot');
    assert.equal(result.snapshotChoice.kind, 'explicit-snapshot-selection');
    assert.equal(result.resolvedIdentity, null); allUnknown(result);
    assert.ok(!/—/.test(JSON.stringify(result)));
  };
  const h = harness(sample(), {});
  for (const key of [undefined, '', 5, 'a\nb', 'a\rb', 'x'.repeat(4097)]) {
    fail(await live(h.transport, { getCredential: () => key }).resolve(sample()), 'credentials-unavailable');
  }
  fail(await live(h.transport, { getCredential: () => { throw new Error(KEY); } }).resolve(sample()), 'credentials-unavailable');
  fail(await live(h.transport, { getCredential: undefined }).resolve(sample()), 'credentials-unavailable');
  fail(await createBmwCatalogueProvider({ env: { GCSP_CATALOGUE_PROVIDER: 'bmw-ucp-live' }, transport: h.transport }).resolve(sample()), 'credentials-unavailable');
  fail(await createBmwCatalogueProvider({ env: { GCSP_CATALOGUE_PROVIDER: 'bmw-ucp-live', GCSP_BMW_UCP_API_KEY: KEY } }).resolve(sample()), 'transport-unavailable');
  fail(await createBmwCatalogueProvider({ env: { GCSP_CATALOGUE_PROVIDER: 'LIVE', GCSP_BMW_UCP_API_KEY: KEY }, transport: h.transport }).resolve(sample()), 'source-not-selected');
  fail(await createBmwLiveCatalogueProvider({ transport: h.transport, getCredential: () => KEY }).resolve(sample()), 'source-not-selected');
  assert.deepEqual(h.calls, []);
  const market = await live(h.transport).resolve(sample({ market: 'US', locale: 'en-US' }));
  assert.equal(market.status, 'unsupported'); assert.equal(market.failure.code, 'unsupported-market'); assert.equal(market.snapshotChoice, null);
  await done();
});

test('an explicit snapshot selection is a separate call that is never labelled live', async (context) => {
  const done = guardNetwork(context);
  const result = await selectBmwCatalogueSnapshot(sample());
  assert.equal(result.provider, 'bmw-catalogue-snapshot'); assert.equal(result.sourceKind, 'dated-snapshot');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.selection, { kind: 'explicit-snapshot', provider: 'bmw-catalogue-snapshot' });
  const provider = createBmwCatalogueProvider({ env: { GCSP_CATALOGUE_PROVIDER: 'bmw-ucp-live' } });
  assert.equal((await provider.resolve(sample())).sourceKind, 'live');
  await done();
});

test('env selects the live provider and the key never reaches the provider or envelope', async (context) => {
  const done = guardNetwork(context);
  const env = { GCSP_CATALOGUE_PROVIDER: 'bmw-ucp-live', GCSP_BMW_UCP_API_KEY: KEY };
  const h = harness(sample(), happy());
  const provider = createBmwCatalogueProvider({ env, transport: h.transport, clock });
  assert.ok(!JSON.stringify(provider).includes(KEY));
  assert.deepEqual(Object.keys(provider).sort(), ['provider', 'resolve']);
  assert.ok(Object.isFrozen(provider));
  const result = await provider.resolve(sample());
  assert.equal(result.status, 'partial'); assert.equal(result.sourceKind, 'live');
  assert.ok(!JSON.stringify(result).includes(KEY));
  await done();
});

test('upstream failures, raw errors and HTML never reach the envelope or logs', async (context) => {
  const done = guardNetwork(context);
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((name) => context.mock.method(console, name, () => {}));
  const html = '<html>upstream</html>';
  const failures = {
    'throws with key and html': () => { throw new Error(`${KEY} ${html}`); },
    '500 with html': () => ({ status: 500, statusText: 'upstream broke', body: html }),
    '401': () => ({ status: 401, body: '{"message":"upstream denied"}' }),
    '200 not json': () => ({ status: 200, body: html }),
    '200 scalar': () => ({ status: 200, body: '5' }),
    'oversize': () => ({ status: 200, body: 'x'.repeat(4194305) }),
    'redirected': () => ({ status: 200, redirected: true, body: '{}' }),
    'no body': () => ({ status: 200 }),
    'bytes not json': () => ({ status: 200, body: new TextEncoder().encode(html) }),
    'rejected': () => Promise.reject(new Error(`${KEY} upstream`)),
  };
  for (const [name, respond] of Object.entries(failures)) {
    for (const stage of ['matrix', 'solver', 'options', 'otd']) {
      const { result, calls } = await run(happy(sample(), { [stage]: respond }));
      assert.equal(calls.at(-1), stage, name);
      assert.equal(result.status, 'source-unavailable', name); assert.equal(result.failure.code, 'source-failed');
      assert.equal(result.failure.retryable, true); assert.equal(result.snapshotChoice.automatic, false);
      assert.equal(result.sourceKind, 'live'); assert.equal(result.resolvedIdentity, null); allUnknown(result);
      const text = JSON.stringify(result).toLowerCase();
      for (const secret of [KEY, 'html', 'upstream', 'denied', STATE]) assert.ok(!text.includes(secret.toLowerCase()), `${name} ${secret}`);
    }
  }
  const unusable = [{ matrix: matrixBody(), solver: { constructible: 'yes' } }, { matrix: matrixBody(), solver: { constructible: true } },
    { matrix: matrixBody(), solver: { ...solverBody(), configurationChanges: [] } },
    { matrix: matrixBody(), solver: solverBody({ add: { 'bad-code': { code: 'bad-code', type: 'option' } } }) }];
  for (const responses of unusable) assert.equal((await run(responses)).result.failure.code, 'source-failed');
  assert.equal((await live(null).resolve(sample())).failure.code, 'transport-unavailable');
  assert.equal((await live(() => ({}), { clock: () => new Date('x') }).resolve(sample())).failure.code, 'source-failed');
  for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
  await done();
});

test('the solver state token is never read, echoed or reused and no later request carries it', async () => {
  const requests = [];
  const h = harness(sample(), happy());
  const result = await live(async (call) => { requests.push(call.url); return h.transport(call); }).resolve(sample());
  assert.equal(result.status, 'partial'); assert.equal(requests.length, 4);
  assert.ok(requests.every((url) => !url.includes(STATE) && !/configuration-?state/i.test(url)));
  assert.ok(!JSON.stringify(result).includes(STATE));
});

const em = String.fromCharCode(0x2014);
const clean = (presented) => {
  const text = JSON.stringify(presented);
  for (const bad of [KEY, STATE, '<', em, String(PRICE), 'retailPrice']) assert.ok(!text.includes(bad), `presented output contains ${bad}`);
  assert.ok(!/html/i.test(text));
  return text;
};

test('presentation examples: exact live chain keeps identities, live label, source date and equipment claims distinct', async () => {
  const { result } = await run(happy(sample(), { otd: otdBody(four, 3) }));
  const shown = presentBmwLiveCatalogue(result);
  clean(shown);
  assert.equal(shown.sourceKind, 'live'); assert.equal(shown.label, 'Live catalogue (unsupported demo route)');
  assert.equal(shown.source, 'BMW UK configurator, live, retrieved 9 November 2026');
  assert.equal(shown.status, 'partial'); assert.equal(shown.failure, null); assert.equal(shown.snapshotChoice, null);
  assert.equal(shown.identities.requested, shown.identities.resolved);
  assert.equal(shown.identities.requested, 'T5MJ (G61E / G61, AG 72HH), GB en-GB, trim S0337, order 2026-11-01, effect 2027-01-05, production 2027-01-05, tax 2027-01-05, 47 options, 1 accessory');
  assert.deepEqual(shown.differences, []);
  assert.ok(shown.measurements.includes('5 seats (observed)'));
  assert.ok(shown.measurements.includes('6.1 seconds from 0–100 km/h (observed)'));
  assert.ok(shown.measurementEvidence.every((line) => line.includes('observed 9 November 2026')));
  assert.match(shown.completeness, /measurements: partial/); assert.match(shown.completeness, /VIN-fitted equipment: unknown/);
  assert.ok(shown.equipment.some((line) => line.startsWith('S0337 Label S0337') && line.includes('; selected in this catalogue configuration;')));
  assert.ok(shown.equipment.every((line) => line.endsWith('VIN-fitted: unknown.')));
  assert.notEqual(shown.sourceKind, 'dated-snapshot');
});

test('presentation examples: an explicitly selected snapshot is labelled as a dated snapshot, never live', async () => {
  const shown = presentBmwLiveCatalogue(await selectBmwCatalogueSnapshot(sample()));
  clean(shown);
  assert.equal(shown.sourceKind, 'dated-snapshot'); assert.equal(shown.label, 'Dated snapshot');
  assert.equal(shown.selection, 'Dated snapshot explicitly selected.');
  assert.ok(!/live/i.test(shown.source)); assert.ok(!/live/i.test(shown.label)); assert.equal(shown.status, 'ok');
  const direct = presentBmwLiveCatalogue(await createBmwCatalogueAdapter().resolve(sample()));
  assert.equal(direct.selection, null); assert.equal(direct.sourceKind, 'dated-snapshot');
});

test('presentation examples: partial live values show their unknown reasons and never invent a value', async () => {
  const pairs = [['N_SITZE', '0000'], ['A_GEPR_V211', 490], ['A_GEPR_V214', null]];
  const { result } = await run(happy(sample(), { otd: otdBody([...pairs, ['E_0_100KMH', 6.1]], 2) }));
  const shown = presentBmwLiveCatalogue(result);
  clean(shown);
  assert.equal(shown.status, 'partial'); assert.equal(shown.sourceKind, 'live');
  assert.match(shown.measurements[0], /^Seats: unknown \(.+\)$/);
  assert.match(shown.measurements[2], /^Luggage \(expanded\): unknown \(.+\)$/);
  assert.ok(shown.measurements.some((line) => line.startsWith('490 litres (normal,')));
  assert.match(shown.completeness, /measurements: partial/);
  assert.ok(!shown.measurements.some((line) => line.includes('0000')));
});

test('presentation examples: G21 mismatch and access failure keep requested and resolved identities and reasons', async () => {
  const options = ['P0300', 'S0337', 'FKSFU', 'S043L'];
  const request = sample({ modelCode: 'T3MQ', modelRange: 'G21', rawModelRange: 'G21', agModelCode: '22FZ', selectedOptions: options, selectedAccessories: [] });
  const nodes = [node({ modelCode: 'T3MQ', modelRange: 'G21', rawModelRange: 'G21', agModelCode: '22FZ' }),
    node({ modelCode: 'T3SK', modelRange: 'G21', rawModelRange: 'G21', agModelCode: '22FY' })];
  const { result } = await run({ matrix: matrixBody(nodes), solver: solverBody({ modelCode: 'T3SK', codes: options }) }, request);
  const shown = presentBmwLiveCatalogue(result);
  clean(shown);
  assert.equal(shown.label, 'Live catalogue mismatch'); assert.equal(shown.status, 'identity-mismatch'); assert.equal(shown.sourceKind, 'live');
  assert.equal(shown.source, null); assert.equal(shown.failure.code, 'live-identity-mismatch');
  assert.equal(shown.failure.message, 'The live catalogue describes a different configuration or date. No facts were substituted.');
  assert.match(shown.identities.requested, /^T3MQ \(G21 \/ G21, AG 22FZ\)/); assert.match(shown.identities.resolved, /^T3SK \(G21 \/ G21, AG 22FY\)/);
  assert.ok(shown.identities.resolved.includes('22FY'));
  assert.ok(shown.differences.includes('Model: requested T3MQ, resolved T3SK.'));
  assert.ok(shown.differences.includes('AG model: requested 22FZ, resolved 22FY.'));
  assert.deepEqual(shown.measurements, []); assert.deepEqual(shown.measurementEvidence, []); assert.deepEqual(shown.equipment, []);
  assert.equal(shown.snapshotChoice, null);

  const denied = await live(() => { throw new Error('unused'); }, { getCredential: () => undefined }).resolve(sample());
  const failed = presentBmwLiveCatalogue(denied);
  clean(failed);
  assert.equal(failed.label, 'Live catalogue unavailable'); assert.equal(failed.status, 'source-unavailable');
  assert.equal(failed.failure.code, 'credentials-unavailable'); assert.equal(failed.failure.message, 'Live catalogue access is not configured.');
  assert.equal(failed.snapshotChoice, 'Use the dated snapshot observed on 1 November 2026');
  assert.equal(failed.sourceKind, 'live'); assert.match(failed.identities.requested, /^T5MJ /); assert.equal(failed.identities.resolved, 'unknown');
  assert.deepEqual(failed.measurements, []);
});

test('presentation examples: option differences, unknown codes and malformed input use fixed text only', async () => {
  const solver = solverBody({ drop: ['S0880'], add: { S09ZZ: { code: 'S09ZZ', type: 'option' } }, constructible: false,
    changes: { ignoredElements: { S0880: { code: 'S0880' } }, conflictingElements: { S0880: {} } } });
  const { result } = await run(happy(sample(), { solver }));
  const shown = presentBmwLiveCatalogue(result);
  clean(shown);
  for (const line of ['Options: requested 47 options, resolved 47 options.', 'Options added: S09ZZ.', 'Options removed: S0880.', 'Ignored by source: S0880.',
    'Unrecognised source changes: 1.', 'Not constructible.']) assert.ok(shown.differences.includes(line), line);
  assert.equal(shown.failure.code, 'live-not-constructible');
  const hostile = { ...result, failure: { code: 'upstream said <b>no</b>', message: 'raw upstream error' }, status: 'weird',
    resolution: { differences: [{ field: 'modelCode', requested: '<script>', resolved: 'T3SK' }, { field: 'evil', requested: 'x', resolved: 'y' }],
      options: { added: ['<b>', 'S09ZZ'], unrecognised: [] } } };
  const safe = presentBmwLiveCatalogue(hostile);
  clean(safe);
  assert.equal(safe.status, 'source-unavailable'); assert.equal(safe.failure.code, 'source-failed');
  assert.ok(safe.differences.includes('Model: requested unknown, resolved T3SK.'));
  assert.ok(safe.differences.includes('Options added: S09ZZ.')); assert.equal(safe.differences.length, 2);
  for (const input of [null, undefined, 'x', {}, { provider: 'other', status: 'ok', sourceKind: 'live' }, { provider: 'bmw-catalogue-live', sourceKind: 'dated-snapshot' }]) {
    const bad = presentBmwLiveCatalogue(input);
    assert.equal(bad.sourceKind, 'live'); assert.equal(bad.failure.code, 'source-failed');
    assert.equal(bad.identities.requested, 'unknown'); assert.equal(bad.identities.resolved, 'unknown');
    assert.deepEqual(bad.measurements, []);
  }
  const inexact = presentBmwLiveCatalogue({ ...(await run(happy())).result, resolution: { exact: false, differences: [], options: {} } });
  assert.equal(inexact.failure.code, 'source-failed'); assert.deepEqual(inexact.measurements, []);
});

test('presentation labels never cross: live envelopes are never snapshot and snapshots are never live', async () => {
  const envelopes = [(await run(happy())).result, (await run(happy(sample(), { solver: solverBody({ constructible: false }) }))).result,
    await live(() => ({}), { getCredential: () => undefined }).resolve(sample())];
  for (const envelope of envelopes) assert.equal(presentBmwLiveCatalogue(envelope).sourceKind, 'live');
  for (const envelope of [await selectBmwCatalogueSnapshot(sample()), await createBmwCatalogueAdapter().resolve(sample()),
    await createBmwCatalogueAdapter().resolve({ bad: true })]) {
    const shown = presentBmwLiveCatalogue(envelope);
    assert.equal(shown.sourceKind, 'dated-snapshot'); assert.ok(!/live/i.test(JSON.stringify(shown)));
  }
});
