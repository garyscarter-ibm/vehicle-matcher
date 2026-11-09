import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BMW_LIVE_CATALOGUE_OPERATION_POLICY, BMW_LIVE_CATALOGUE_SOURCE, createBmwCatalogueProvider } from '../vehicle-evidence/bmw-live-catalogue.js';
import { EVIDENCE_LIVE, EVIDENCE_OFFLINE, MAX_CONSECUTIVE_FAILURES, MAX_REQUEST_CAP, OVERSIZE_MARKER, VERIFY_LIVE_CATALOGUE_VERSION, assertRedacted,
  createGuardedTransport, createMemoryLedger, defaultVerificationTarget, fetchTransport, main, runVerification } from '../../scripts/gcsp/verify-live-catalogue.mjs';

// Offline only: every response is a synthetic fixture; transports are injected and no network, port or real key is used.
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
const FAMILY_ORDER = ['matrix', 'solver', 'options', 'otd'];

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

// ---- harness ----
const LIVE_ENV = Object.freeze({ GCSP_CATALOGUE_PROVIDER: 'bmw-ucp-live', GCSP_BMW_UCP_API_KEY: KEY });
const HOST = 'prod.ucp.bmw.cloud';
const MARKER = 'UPSTREAM-SECRET-BODY';
const sleep = (ms, signal) => (signal ? new Promise(() => {}) : Promise.resolve());
const json = (value) => ({ status: 200, body: JSON.stringify(value) });
const status = (code, extra = {}) => () => ({ status: code, body: MARKER, headers: {}, ...extra });
const ROOT = new URL('../../', import.meta.url);

/** Transport over urls(request): records calls and the interleaving with ledger appends. */
function rig(request, responses = {}, { ledger = createMemoryLedger() } = {}) {
  const allowed = new Map(Object.entries(urls(request)).map(([name, url]) => [url, name]));
  const order = [];
  const calls = [];
  const wrapped = { append: (entry) => { order.push(`ledger:${entry.family ?? 'refused'}`); ledger.append(entry); }, count: () => ledger.count(), entries: () => ledger.entries() };
  const transport = async (call) => {
    const name = allowed.get(call.url) ?? 'unexpected';
    calls.push({ name, method: call.method, url: call.url });
    order.push(`call:${name}`);
    const value = responses[name];
    if (typeof value === 'function') return value(call);
    if (value === undefined) throw new Error(`no fixture for ${name}`);
    return json(value);
  };
  return { transport, calls, order, ledger: wrapped, store: ledger };
}
const happyResponses = () => ({ matrix: matrixBody(), solver: solverBody(), options: optionsBody(), otd: otdBody(four, 68) });
const verify = (r, options = {}) => runVerification({ env: LIVE_ENV, transport: r.transport, clock, sleep, ledger: r.ledger,
  evidenceClass: EVIDENCE_OFFLINE, ...options });
const keysOf = (value, found = []) => {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, found));
  else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) { found.push(name); keysOf(item, found); }
  return found;
};
/** Every serialised artefact must be free of the key, URLs, upstream text and the forbidden vocabulary. */
function assertClean(report, r) {
  const text = JSON.stringify([report, r.store.entries()]);
  for (const bad of [KEY, MARKER, 'http', 'x-api-key', STATE, '<']) assert.ok(!text.includes(bad), bad);
  assert.ok(keysOf(report).every((name) => !/eligib|points|telemetry|garage/i.test(name)));
  for (const call of r.calls) {
    assert.equal(call.method, 'GET');
    assert.ok(!['/garage', 'anonymous-configurations', 'configuration-state', 'marketing-texts', 'pricing'].some((part) => call.url.includes(part)));
  }
}
const sink = () => { const chunks = []; return { write: (text) => { chunks.push(String(text)); return true; }, text: () => chunks.join('') }; };
function guardHttp(context) {
  let external = 0;
  const stop = () => { external += 1; throw new Error('network forbidden'); };
  const ready = Promise.all(['node:http', 'node:https'].map(async (name) => {
    const { default: transport } = await import(name);
    context.mock.method(transport, 'request', stop); context.mock.method(transport, 'get', stop);
  }));
  return async () => { await ready; assert.equal(external, 0); };
}
const rmTemp = async (dir) => {
  await rm(dir, { recursive: true, force: true });
  assert.equal(existsSync(dir), false);
};

// ---- tests ----
test('offline positive: four ordered reads, each ledgered before its call, every comparison matches', async (context) => {
  const done = guardNetwork(context);
  const request = defaultVerificationTarget();
  assert.deepEqual(request, { ...sample(), selectedOptions: [...snapshot.selectedOptions].sort() });
  const r = rig(request, happyResponses());
  const report = await verify(r, { request });
  assert.equal(report.verdict, 'pass'); assert.equal(report.outcome, 'completed'); assert.deepEqual(report.reasons, []);
  assert.equal(report.evidenceClass, 'offline-mock'); assert.equal(report.satisfiesLivePositive, false);
  assert.equal(report.harnessVersion, VERIFY_LIVE_CATALOGUE_VERSION); assert.equal(report.credential, 'present');
  assert.equal(report.requestCount, 4); assert.equal(report.ledgerEntries, 4); assert.equal(r.store.count(), 4);
  assert.deepEqual(r.order, ['ledger:matrix', 'call:matrix', 'ledger:solver', 'call:solver', 'ledger:options', 'call:options', 'ledger:otd', 'call:otd']);
  assert.deepEqual(r.store.entries().map(({ family, host, attempt, seq }) => [seq, host, family, attempt]),
    FAMILY_ORDER.map((family, index) => [index + 1, HOST, family, 1]));
  assert.ok(r.store.entries().every((entry) => entry.at === '2026-11-09T10:00:00.000Z'));
  assert.deepEqual(report.hostsContacted, [HOST]); assert.equal(report.stopReason, null);
  assert.deepEqual(report.refusedRequests, { count: 0, reasons: {} }); assert.equal(report.cap, MAX_REQUEST_CAP);
  assert.equal(report.status, 'partial'); assert.equal(report.provider, 'bmw-catalogue-live');
  assert.equal(report.sourceVersion, BMW_LIVE_CATALOGUE_SOURCE); assert.equal(report.sourceRoute, 'unsupported-demo');
  assert.equal(report.policyVersion, BMW_LIVE_CATALOGUE_OPERATION_POLICY.version); assert.equal(report.retrievedDate, '2026-11-09');
  assert.equal(report.comparisons.identity.length, 12);
  assert.ok(report.comparisons.identity.every(({ match }) => match));
  assert.deepEqual(report.comparisons.identity.filter(({ field }) => /Date$/.test(field)).map(({ field }) => field),
    ['catalogueDate', 'orderDate', 'effectDate', 'productionDate', 'taxDate']);
  assert.equal(report.comparisons.options.complete, true); assert.equal(report.comparisons.accessories.equal, true);
  assert.equal(report.comparisons.constructible, true); assert.equal(report.comparisons.exact, true);
  assert.deepEqual(report.comparisons.technical.map(({ fact, code, unit, normalised, sourceValue, match }) => [fact, code, unit, normalised.state, normalised.value, sourceValue, match]),
    [['seats', 'N_SITZE', 'COUNT', 'known', 5, 5, true], ['luggageNormal', 'A_GEPR_V211', 'LITRES', 'known', 490, 490, true],
      ['luggageExpanded', 'A_GEPR_V214', 'LITRES', 'known', 1700, 1700, true], ['acceleration', 'E_0_100KMH', 'SECONDS', 'known', 6.1, 6.1, true]]);
  assert.equal(report.presentation.label, 'Live catalogue (unsupported demo route)');
  assert.equal(report.presentation.source, 'BMW UK configurator, live, retrieved 9 November 2026');
  assert.ok(report.presentation.requested.startsWith('T5MJ (G61E / G61, AG 72HH), GB en-GB')); assert.equal(report.presentation.failureMessage, null);
  assert.equal(report.snapshotChoice, null); assert.equal(report.unknownFactExample.name, 'bodyLength'); assert.equal(report.unknownFactExample.reason, 'placeholder-value');
  assert.ok(report.limitations.length >= 4);
  assertClean(report, r);
  const liveClass = await verify(rig(request, happyResponses()), { request, evidenceClass: EVIDENCE_LIVE });
  assert.equal(liveClass.verdict, 'pass'); assert.equal(liveClass.satisfiesLivePositive, true);
  await done();
});

test('a source that is not selected or has no key is not run and sends nothing', async (context) => {
  const done = guardNetwork(context);
  const cases = [[{}, 'source-not-selected', 'absent'], [{ GCSP_CATALOGUE_PROVIDER: 'snapshot', GCSP_BMW_UCP_API_KEY: KEY }, 'source-not-selected', 'present'],
    [{ GCSP_CATALOGUE_PROVIDER: 'Live', GCSP_BMW_UCP_API_KEY: KEY }, 'source-not-selected', 'present'],
    [{ GCSP_CATALOGUE_PROVIDER: 'bmw-ucp-live' }, 'credentials-unavailable', 'absent'],
    [{ GCSP_CATALOGUE_PROVIDER: 'bmw-ucp-live', GCSP_BMW_UCP_API_KEY: '' }, 'credentials-unavailable', 'absent']];
  for (const [env, reason, credential] of cases) {
    let called = 0;
    const ledger = createMemoryLedger();
    const report = await runVerification({ env, transport: () => { called += 1; throw new Error('forbidden'); }, clock, sleep, ledger, evidenceClass: EVIDENCE_OFFLINE });
    assert.equal(called, 0); assert.equal(ledger.count(), 0);
    assert.equal(report.outcome, 'not-run'); assert.equal(report.reason, reason); assert.equal(report.credential, credential);
    assert.equal(report.requestCount, 0); assert.equal(report.satisfiesLivePositive, false); assert.notEqual(report.verdict, 'pass');
    const text = JSON.stringify(report);
    assert.ok(!text.includes(KEY)); assert.ok(!/length/i.test(text));
  }
  await done();
});

test('the request cap bounds forwarded requests and invalid caps or classes throw', async (context) => {
  const done = guardNetwork(context);
  const request = defaultVerificationTarget();
  const three = rig(request, { matrix: status(503) });
  const capped = await verify(three, { request, requestCap: 3 });
  assert.ok(capped.requestCount <= 3); assert.equal(three.calls.length, capped.requestCount); assert.notEqual(capped.verdict, 'pass');
  assertClean(capped, three);
  const one = rig(request, { matrix: status(503) });
  const tight = await verify(one, { request, requestCap: 1 });
  assert.equal(tight.requestCount, 1); assert.equal(one.calls.length, 1); assert.deepEqual(tight.refusedRequests, { count: 1, reasons: { 'cap-reached': 1 } });
  assert.equal(tight.cap, 1); assert.notEqual(tight.verdict, 'pass'); assert.ok(tight.reasons.includes('request-refused') || tight.verdict === 'source-unavailable');
  assert.ok(one.store.entries().some((entry) => entry.refused === 'cap-reached'));
  assertClean(tight, one);
  for (const bad of [0, 9, -1, 1.5, '3', NaN, null]) {
    await assert.rejects(verify(rig(request, happyResponses()), { request, requestCap: bad }), TypeError);
  }
  for (const bad of [undefined, 'live', 'offline']) {
    await assert.rejects(verify(rig(request, happyResponses()), { request, evidenceClass: bad }), TypeError);
  }
  assert.equal(MAX_REQUEST_CAP, 8); assert.equal(MAX_CONSECUTIVE_FAILURES, 3);
  await done();
});

test('auth refusal, rate limit and challenges stop the run and nothing is sent afterwards', async (context) => {
  const done = guardNetwork(context);
  const request = defaultVerificationTarget();
  const cases = [['auth-refused', status(401)], ['auth-refused', status(403)], ['rate-limited', status(429, { headers: { 'Retry-After': '30' } })],
    ['challenge', () => ({ status: 200, body: `<html>${MARKER}</html>`, headers: { 'content-type': 'text/html' } })],
    ['challenge', () => ({ status: 200, body: MARKER })], ['challenge', () => ({ status: 200, body: '{"ok":true}', headers: { 'content-type': 'text/html' } })],
    ['challenge', () => ({ status: 503, body: 'Please solve the CAPTCHA' })], ['challenge', () => ({ status: 200, body: 'Challenge page', headers: { 'content-type': 'application/json' } })]];
  for (const [reason, respond] of cases) {
    const r = rig(request, { matrix: respond, solver: solverBody(), options: optionsBody(), otd: otdBody() });
    const report = await verify(r, { request });
    assert.equal(report.verdict, 'stopped', reason); assert.equal(report.stopReason, reason);
    assert.ok(report.requestCount <= MAX_REQUEST_CAP); assert.equal(r.calls.length, report.requestCount);
    assert.deepEqual(r.calls.map(({ name }) => name), ['matrix']); assert.equal(report.satisfiesLivePositive, false);
    assert.equal(r.order.filter((item) => item.startsWith('call:')).length, 1);
    assertClean(report, r);
  }
  await done();
});

test('the guard stops on three consecutive failures, resets on parseable JSON and then refuses everything', async (context) => {
  const done = guardNetwork(context);
  const call = { method: 'GET', url: urls(sample()).matrix };
  const build = (script) => {
    const ledger = createMemoryLedger();
    let inner = 0;
    const guard = createGuardedTransport({ transport: async () => { inner += 1; return script[(inner - 1) % script.length](); }, ledger, clock, requestCap: 8 });
    const send = async () => { guard.trace({ type: 'request', host: HOST, family: 'matrix', attempt: 1 }); return guard.transport(call); };
    return { guard, ledger, send, inner: () => inner };
  };
  const boom = () => { throw new Error('boom'); };
  const bad = () => ({ status: 503, body: MARKER });
  const good = () => json({ ok: true });
  const three = build([boom, bad, boom]);
  await assert.rejects(three.send(), /boom/); assert.equal((await three.send()).status, 503); await assert.rejects(three.send(), /boom/);
  assert.equal(three.guard.summary().stopReason, 'consecutive-failures');
  await assert.rejects(three.send(), /refused: stopped/);
  assert.equal(three.inner(), 3); assert.deepEqual(three.guard.summary().refusedReasons, { stopped: 1 });
  const reset = build([boom, bad, good, boom, bad, good]);
  await assert.rejects(reset.send()); await reset.send(); await reset.send(); await assert.rejects(reset.send()); await reset.send(); await reset.send();
  assert.equal(reset.guard.summary().stopReason, null); assert.equal(reset.inner(), 6);
  assert.equal(reset.guard.body('matrix'), '{"ok":true}');
  await done();
});

test('a ledger that throws or records nothing means the guard refuses and the transport is never called', async (context) => {
  const done = guardNetwork(context);
  const request = defaultVerificationTarget();
  const broken = [{ append: () => { throw new Error('disk full'); }, count: () => 0, entries: () => [] },
    { append: () => {}, count: () => 0, entries: () => [] }];
  for (const ledger of broken) {
    const r = rig(request, happyResponses());
    const report = await verify({ ...r, ledger }, { request });
    assert.equal(r.calls.length, 0); assert.equal(report.requestCount, 0); assert.notEqual(report.verdict, 'pass');
    assert.ok(report.refusedRequests.count >= 1); assert.equal(Object.keys(report.refusedRequests.reasons).join(), 'ledger-not-written');
    assert.ok(report.reasons.includes('ledger-incomplete') || report.verdict === 'source-unavailable');
  }
  const ledger = createMemoryLedger();
  let inner = 0;
  const guard = createGuardedTransport({ transport: async () => { inner += 1; return json({}); }, ledger, clock });
  await assert.rejects(guard.transport({ method: 'GET', url: urls(sample()).matrix }), /refused: ledger-not-written/);
  assert.equal(inner, 0);
  await done();
});

test('forbidden requests are refused before the transport and recorded', async (context) => {
  const done = guardNetwork(context);
  const ledger = createMemoryLedger();
  let inner = 0;
  const guard = createGuardedTransport({ transport: async () => { inner += 1; return json({}); }, ledger, clock });
  const good = urls(sample()).matrix;
  const attempts = [[{ method: 'POST', url: good }, 'method-not-get'], [{ method: 'GET', url: good, body: '{}' }, 'method-not-get'],
    [{ method: 'GET', url: 'https://example.invalid/model-matrices' }, 'host-not-allowed'], [{ method: 'GET', url: `http://${HOST}/otd` }, 'host-not-allowed'],
    [{ method: 'GET', url: 'not a url' }, 'host-not-allowed'], [{ method: 'GET', url: `https://${HOST}:8443/otd` }, 'host-not-allowed'],
    ...['/garage/x', '/anonymous-configurations', '/configuration-state/abc', '/marketing-texts/x', '/pricing/x', '/GARAGE', '/%70ricing']
      .map((path) => [{ method: 'GET', url: `${O}${path}` }, 'forbidden-path'])];
  for (const [call, reason] of attempts) {
    guard.trace({ type: 'request', host: HOST, family: 'matrix', attempt: 1 });
    await assert.rejects(guard.transport(call), new RegExp(`refused: ${reason}`), JSON.stringify(call.url));
  }
  assert.equal(inner, 0);
  const summary = guard.summary();
  assert.equal(summary.refusedCount, attempts.length); assert.equal(summary.forwarded, 0); assert.deepEqual(summary.hosts, []);
  assert.deepEqual(summary.refusedReasons, { 'method-not-get': 2, 'host-not-allowed': 4, 'forbidden-path': 7 });
  assert.equal(ledger.entries().filter((entry) => entry.refused).length, attempts.length);
  guard.trace({ type: 'request', host: HOST, family: 'matrix', attempt: 1 });
  assert.equal((await guard.transport({ method: 'GET', url: good })).status, 200);
  assert.equal(inner, 1); assert.deepEqual(guard.summary().hosts, [HOST]);
  assert.throws(() => createGuardedTransport({ transport: () => {}, ledger: {} }), TypeError);
  assert.throws(() => createGuardedTransport({ transport: () => {}, ledger, requestCap: 0 }), TypeError);
  await done();
});

test('AC3: a controlled T3MQ to T3SK substitution is rejected after two reads and never passes', async (context) => {
  const done = guardNetwork(context);
  const options = ['P0300', 'S0337', 'FKSFU', 'S043L'];
  const request = sample({ modelCode: 'T3MQ', modelRange: 'G21', rawModelRange: 'G21', agModelCode: '22FZ', selectedOptions: options, selectedAccessories: [] });
  const nodes = [node({ modelCode: 'T3MQ', modelRange: 'G21', rawModelRange: 'G21', agModelCode: '22FZ' }),
    node({ modelCode: 'T3SK', modelRange: 'G21', rawModelRange: 'G21', agModelCode: '22FY', prodDate: '20270105' })];
  const make = () => rig(request, { matrix: matrixBody(nodes), solver: solverBody({ modelCode: 'T3SK', codes: options }) });
  for (const evidenceClass of [EVIDENCE_OFFLINE, EVIDENCE_LIVE]) {
    const report = await verify(make(), { request, evidenceClass });
    assert.equal(report.verdict, 'identity-mismatch'); assert.equal(report.satisfiesLivePositive, false);
    assert.equal(report.status, 'identity-mismatch'); assert.equal(report.failureCode, 'live-identity-mismatch');
    assert.deepEqual(report.differences[0], { field: 'modelCode', requested: 'T3MQ', resolved: 'T3SK' });
    assert.deepEqual(report.differences.map(({ field }) => field), ['modelCode', 'agModelCode']);
    assert.equal(report.comparisons.identity.find(({ field }) => field === 'modelCode').match, false);
    assert.equal(report.comparisons.exact, false);
    assert.ok(report.comparisons.technical.every(({ normalised, sourceValue, match }) => normalised.state === 'unknown' && sourceValue === null && match === false));
    assert.equal(report.presentation.label, 'Live catalogue mismatch');
    assert.ok(report.presentation.resolved.startsWith('T3SK (G21 / G21, AG 22FY)'));
  }
  const single = make();
  const report = await verify(single, { request });
  assert.deepEqual(single.calls.map(({ name }) => name), ['matrix', 'solver']);
  assert.equal(report.ledgerEntries, 2); assert.equal(report.requestCount, 2); assert.equal(single.store.count(), 2);
  assertClean(report, single);
  await done();
});

test('AC4: an unavailable source yields source-unavailable with a labelled, non-automatic snapshot choice or none', async (context) => {
  const done = guardNetwork(context);
  const request = defaultVerificationTarget();
  const throwing = () => { throw new Error(`${KEY} ${MARKER}`); };
  const a = rig(request, { matrix: status(503) });
  const down = await verify(a, { request, requestCap: 8 });
  assert.equal(down.verdict, 'source-unavailable'); assert.equal(down.failureCode, 'source-server-error'); assert.equal(down.requestCount, 2);
  assert.equal(down.stopReason, null); assertClean(down, a);

  const b = rig(request, { matrix: throwing });
  const report = await verify(b, { request });
  assert.equal(report.verdict, 'source-unavailable'); assert.equal(report.failureCode, 'source-failed'); assert.equal(report.requestCount, 2);
  assert.equal(report.satisfiesLivePositive, false); assert.equal(report.status, 'source-unavailable');
  assert.equal(report.snapshotChoice.automatic, false); assert.equal(report.snapshotChoice.provider, 'bmw-catalogue-snapshot');
  assert.equal(report.snapshotChoice.observedDate, '2026-11-01'); assert.equal(report.snapshotChoice.label, 'Use the dated snapshot observed on 1 November 2026');
  assert.equal(report.presentation.label, 'Live catalogue unavailable');
  assert.equal(report.presentation.failureMessage, 'The live catalogue could not be read. No facts were substituted.');
  assert.equal(report.presentation.snapshotChoice, 'Use the dated snapshot observed on 1 November 2026');
  assert.ok(report.comparisons.technical.every(({ normalised, match }) => normalised.state === 'unknown' && normalised.value === null && match === false));
  assert.equal(report.comparisons.constructible, false); assert.deepEqual(report.differences, []);
  assertClean(report, b);

  const other = defaultVerificationTarget(); other.trim = 'S0488';
  const c = rig(other, { matrix: throwing });
  const none = await verify(c, { request: other });
  assert.equal(none.verdict, 'source-unavailable'); assert.equal(none.snapshotChoice, null); assert.equal(none.presentation.snapshotChoice, null);
  assert.equal(none.presentation.label, 'Live catalogue unavailable');
  assert.ok(none.comparisons.technical.every(({ normalised }) => normalised.value === null));
  assertClean(none, c);
  await done();
});

test('assertRedacted rejects secrets, URLs, header names, markup and UUIDs and passes a clean report', async () => {
  for (const bad of [`value ${KEY}`, 'see https://prod.ucp.bmw.cloud/otd', 'http://x', 'X-API-KEY: 1', '<html>', 'a<b', `id ${STATE}`]) {
    assert.throws(() => assertRedacted(bad, [KEY]), /Redaction check failed/, bad);
  }
  assert.throws(() => assertRedacted('secret-two inside', ['', 'secret-two']), /Redaction check failed/);
  const request = defaultVerificationTarget();
  const r = rig(request, happyResponses());
  const report = await verify(r, { request });
  assert.doesNotThrow(() => assertRedacted(JSON.stringify(report), [KEY]));
  assert.doesNotThrow(() => assertRedacted('', [])); assert.doesNotThrow(() => assertRedacted('plain text 123', [undefined, null, '']));
});

test('main without --live prints a plan, sends nothing and never builds a transport', async (context) => {
  const done = guardNetwork(context);
  let built = 0;
  const transportFactory = () => { built += 1; throw new Error('forbidden'); };
  const stdout = sink(); const stderr = sink();
  assert.equal(await main([], { env: LIVE_ENV, stdout, stderr, clock, transportFactory }), 0);
  const text = stdout.text();
  assert.ok(text.includes('No request sent. Pass --live after the runbook preconditions are recorded.'));
  for (const line of ['Provider selection: live', 'Credential: present', 'Request cap: 8', 'matrix, solver, options, otd on prod.ucp.bmw.cloud', 'T5MJ (G61E / G61, AG 72HH)']) {
    assert.ok(text.includes(line), line);
  }
  assert.ok(!text.includes(KEY)); assert.equal(stderr.text(), '');
  const absent = sink();
  assert.equal(await main(['--max-requests', '3'], { env: {}, stdout: absent, stderr, clock, transportFactory }), 0);
  assert.ok(absent.text().includes('Provider selection: snapshot')); assert.ok(absent.text().includes('Credential: absent')); assert.ok(absent.text().includes('Request cap: 3'));
  assert.equal(built, 0);
  await done();
});

test('main rejects secrets on the command line and any unknown or malformed argument with exit 2', async (context) => {
  const done = guardNetwork(context);
  let built = 0;
  const transportFactory = () => { built += 1; return () => { throw new Error('forbidden'); }; };
  const bad = [['--api-key=x'], ['--key', 'x'], ['--token', 'x'], ['--unknown'], ['stray'], ['--live'], ['--max-requests', '9'], ['--max-requests', '0'],
    ['--max-requests'], ['--max-requests', '2x'], ['--out'], ['--out', '--live'], ['--target', 'a', '--target', 'b'], ['--live', '--out', 'x', '--api-key'], ['--out=dir']];
  for (const argv of bad) {
    const stdout = sink(); const stderr = sink();
    assert.equal(await main(argv, { env: LIVE_ENV, stdout, stderr, clock, transportFactory }), 2, argv.join(' '));
    assert.ok(stderr.text().startsWith('Usage:')); assert.equal(stdout.text(), ''); assert.ok(!stderr.text().includes(KEY));
  }
  assert.equal(await main(['--target', '/nonexistent/target.json'], { env: LIVE_ENV, stdout: sink(), stderr: sink(), clock, transportFactory }), 2);
  assert.equal(built, 0);
  await done();
});

test('main --live without selection or key exits 3 and sends nothing', async (context) => {
  const done = guardNetwork(context);
  let built = 0;
  const transportFactory = () => { built += 1; return () => { throw new Error('forbidden'); }; };
  const out = join(tmpdir(), `vlc-never-created-${process.pid}`);
  for (const env of [{}, { GCSP_BMW_UCP_API_KEY: KEY }, { GCSP_CATALOGUE_PROVIDER: 'bmw-ucp-live' }, { GCSP_CATALOGUE_PROVIDER: 'snapshot', GCSP_BMW_UCP_API_KEY: KEY }]) {
    const stderr = sink();
    assert.equal(await main(['--live', '--out', out], { env, stdout: sink(), stderr, clock, transportFactory }), 3);
    assert.ok(stderr.text().includes('No request sent.')); assert.ok(!stderr.text().includes(KEY));
  }
  assert.equal(built, 0); assert.equal(existsSync(out), false);
  await done();
});

test('main --live with a fake transport writes a 0600 ledger and report that never hold the key', async (context) => {
  const done = guardNetwork(context);
  const dir = await mkdtemp(join(tmpdir(), 'vlc-'));
  try {
    const request = defaultVerificationTarget();
    const target = join(dir, 'target.json');
    await writeFile(target, JSON.stringify(request));
    const r = rig(request, happyResponses());
    let built = 0;
    const stdout = sink(); const stderr = sink();
    const out = join(dir, 'out');
    const code = await main(['--live', '--target', target, '--out', out, '--max-requests', '5'], { env: LIVE_ENV, stdout, stderr, clock,
      transportFactory: () => { built += 1; return r.transport; } });
    assert.equal(code, 0); assert.equal(built, 1); assert.equal(stderr.text(), '');
    const ledgerText = await readFile(join(out, 'ledger.jsonl'), 'utf8');
    assert.equal(ledgerText.trim().split('\n').length, 4);
    const reportText = await readFile(join(out, 'report.json'), 'utf8');
    for (const text of [ledgerText, reportText, stdout.text()]) { assert.ok(!text.includes(KEY)); assert.ok(!text.includes('http')); }
    for (const file of ['ledger.jsonl', 'report.json']) assert.equal((await stat(join(out, file))).mode & 0o777, 0o600);
    assert.equal((await stat(out)).mode & 0o077, 0);
    const report = JSON.parse(reportText);
    assert.equal(report.verdict, 'pass'); assert.equal(report.evidenceClass, 'live-demo-run-unsupported-route');
    assert.equal(report.satisfiesLivePositive, true); assert.equal(report.cap, 5); assert.equal(report.requestCount, 4);
    assert.ok(stdout.text().startsWith('Verdict: pass. Requests sent: 4 of 5.'));
    assert.deepEqual(r.calls.map(({ name }) => name), FAMILY_ORDER);

    const refused = rig(request, { matrix: status(401) });
    const out2 = join(dir, 'out2');
    assert.equal(await main(['--live', '--out', out2], { env: LIVE_ENV, stdout: sink(), stderr: sink(), clock, transportFactory: () => refused.transport }), 1);
    const stopped = JSON.parse(await readFile(join(out2, 'report.json'), 'utf8'));
    assert.equal(stopped.verdict, 'stopped'); assert.equal(stopped.stopReason, 'auth-refused'); assert.equal(stopped.satisfiesLivePositive, false);
    assert.equal(refused.calls.length, 1);
    assert.ok(!(await readFile(join(out2, 'ledger.jsonl'), 'utf8')).includes(KEY));
  } finally { await rmTemp(dir); }
  await done();
});

test('fetchTransport passes the fixed fetch options and bounds the body', async (context) => {
  const done = guardHttp(context);
  const seen = [];
  const controller = new AbortController();
  const reply = (make) => context.mock.method(globalThis, 'fetch', async (url, options) => { seen.push([url, options]); return make(); });
  const call = { method: 'GET', url: `${O}/otd/x`, headers: { 'x-api-key': KEY, accept: 'application/json' }, signal: controller.signal, maxResponseBytes: 10 };
  const stream = (...parts) => new ReadableStream({ start(c) { parts.forEach((part) => c.enqueue(new TextEncoder().encode(part))); c.close(); } });
  reply(() => new Response(stream('{"a":', '1}'), { status: 200, headers: { 'content-type': 'application/json' } }));
  const ok = await fetchTransport(call);
  const [url, options] = seen[0];
  assert.equal(url, call.url); assert.equal(options.method, 'GET'); assert.deepEqual(options.headers, call.headers);
  assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store'); assert.equal(options.signal, controller.signal);
  assert.equal(ok.status, 200); assert.equal(ok.body, '{"a":1}'); assert.equal(ok.redirected, false); assert.equal(ok.headers.get('content-type'), 'application/json');
  globalThis.fetch.mock.restore();
  reply(() => new Response('x'.repeat(50), { status: 200 }));
  assert.equal((await fetchTransport(call)).body, OVERSIZE_MARKER);
  globalThis.fetch.mock.restore();
  reply(() => ({ status: 200, headers: new Headers(), text: async () => 'y'.repeat(50) }));
  assert.equal((await fetchTransport(call)).body, OVERSIZE_MARKER);
  globalThis.fetch.mock.restore();
  reply(() => ({ status: 302, headers: new Headers(), text: async () => '' }));
  assert.equal((await fetchTransport(call)).redirected, true);
  globalThis.fetch.mock.restore();
  reply(() => new Response(null, { status: 204 }));
  assert.equal((await fetchTransport({ ...call, maxResponseBytes: undefined })).body, '');
  globalThis.fetch.mock.restore();
  context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(fetchTransport(call), TypeError);
  await done();
});

test('AC6: importing or planning sends nothing, and nothing in the build, server or workflows can reach the harness', async (context) => {
  const done = guardNetwork(context);
  const fresh = await import(new URL('../../scripts/gcsp/verify-live-catalogue.mjs?fresh-import', import.meta.url).href);
  assert.equal(typeof fresh.main, 'function'); assert.equal(typeof fresh.runVerification, 'function');

  const script = fileURLToPath(new URL('scripts/gcsp/verify-live-catalogue.mjs', ROOT));
  const cleanEnv = { PATH: process.env.PATH };
  const plan = spawnSync(process.execPath, [script], { env: cleanEnv, encoding: 'utf8', cwd: tmpdir() });
  assert.equal(plan.status, 0); assert.ok(plan.stdout.includes('No request sent.')); assert.ok(plan.stdout.includes('Provider selection: snapshot')); assert.equal(plan.stderr, '');
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(script).href)});`], { env: cleanEnv, encoding: 'utf8', cwd: tmpdir() });
  assert.equal(imported.status, 0); assert.equal(imported.stdout, ''); assert.equal(imported.stderr, '');
  const live = spawnSync(process.execPath, [script, '--live', '--out', join(tmpdir(), `vlc-never-created-${process.pid}`)], { env: cleanEnv, encoding: 'utf8', cwd: tmpdir() });
  assert.equal(live.status, 3); assert.equal(existsSync(join(tmpdir(), `vlc-never-created-${process.pid}`)), false);

  const pkg = JSON.parse(await readFile(new URL('package.json', ROOT), 'utf8'));
  for (const [name, command] of Object.entries(pkg.scripts)) {
    assert.ok(!/verify-live-catalogue|--live|bmw-live-catalogue/.test(command), name);
  }
  assert.ok(pkg.scripts.test && pkg.scripts.server);

  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules' && full !== fileURLToPath(new URL('server/test', ROOT)).replace(/\/$/, '')) await walk(full); }
      else if (/\.(js|mjs|cjs|json)$/.test(entry.name)) files.push(full);
    }
  };
  await walk(fileURLToPath(new URL('server', ROOT)));
  assert.ok(files.length > 20);
  const evidenceDir = fileURLToPath(new URL('server/vehicle-evidence/', ROOT));
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.ok(!text.includes('verify-live-catalogue'), file);
    if (!file.startsWith(evidenceDir)) assert.ok(!text.includes('bmw-live-catalogue'), file);
  }
  const flows = fileURLToPath(new URL('.github/workflows/', ROOT));
  for (const name of await readdir(flows)) assert.ok(!(await readFile(join(flows, name), 'utf8')).includes('verify-live-catalogue'), name);

  let called = 0;
  const provider = createBmwCatalogueProvider({ env: {}, transport: () => { called += 1; throw new Error('forbidden'); } });
  const result = await provider.resolve(defaultVerificationTarget());
  assert.equal(result.provider, 'bmw-catalogue-snapshot'); assert.equal(result.sourceKind, 'dated-snapshot'); assert.equal(result.status, 'ok');
  assert.equal(called, 0);
  await done();
});
