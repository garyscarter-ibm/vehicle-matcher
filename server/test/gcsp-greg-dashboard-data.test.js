// Data layer for the Greg dashboard (FUCQ-101): view adapter, HTTP adapter and fixtures. No network, no port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { toDashboardView, DemandViewError } from '../../blocks/gcsp/greg/demand-view.js';
import { gateInfo, keyLabel, requirementText } from '../../blocks/gcsp/greg/demand-copy.js';
import { outcomeToState, createGregHttpAdapter } from '../../blocks/gcsp/greg/http-adapter.js';
import { FIXTURE_NAMES, fixtureAdapter } from '../../blocks/gcsp/greg/fixtures.js';
import { setup, confirm, release, offer, readDemand, saved } from './helpers/greg-demand-run.js';

const row = (rows, key) => rows.find((r) => r.key === key);
const GREG_DIR = new URL('../../blocks/gcsp/greg/', import.meta.url);
const ready = ['populated', 'after-release-decline', 'empty', 'no-stock', 'banded'];

test('real service: each step of the demo changes the view figures and versions', async () => {
  const f = await setup();
  const empty = toDashboardView(await readDemand(f));
  assert.equal(empty.flags.noBriefs, true);
  assert.equal(empty.flags.noStockReleased, true);
  assert.equal(empty.meta.briefVersionsLabel, 'None yet');

  await confirm(f, saved(7));
  const brief = toDashboardView(await readDemand(f));
  assert.equal(brief.flags.noBriefs, false);
  assert.equal(brief.flags.noStockReleased, true);
  assert.equal(brief.demand.activeBriefs.count.label, '1');
  assert.deepEqual(brief.meta.briefVersions, [1]);
  const none = row(brief.demand.unmetByGate, 'no-released-stock');
  assert.equal(none.count.label, '1');
  assert.equal(none.severity, 'blocker');
  assert.match(none.label, /No stock has been released/);
  assert.equal(row(brief.demand.byModelLine, 'G21 Touring').label, 'G21 Touring');
  assert.equal(row(brief.demand.byBody, 'estate').label, 'Estate');
  assert.ok(brief.demand.essentials.some((e) => e.label === 'Seats at least 7' && e.state === 'confirmed'));

  await release(f, 1);
  const released = toDashboardView(await readDemand(f));
  assert.equal(released.flags.noStockReleased, false);
  assert.equal(row(released.stock.rows, 'G21 Touring').released.label, '1');
  assert.equal(row(released.demand.unmetByGate, 'essential-unmet:seats').label, 'Essential not met: Seats');
  assert.equal(row(released.demand.unmetByGate, 'no-released-stock'), undefined);

  await offer(f, 2, 'declined', 'decline', { code: 'body-style', label: 'Body style', attribute: 'body' });
  const declined = toDashboardView(await readDemand(f));
  assert.equal(declined.offers.declined.count.label, '1');
  assert.equal(row(declined.offers.declinedByReason, 'body-style').label, 'Body style');
  assert.equal(declined.offers.made.count.label, '1');

  await offer(f, 3, 'selected', 'select');
  const selected = toDashboardView(await readDemand(f));
  assert.equal(selected.offers.selected.count.label, '1');
  assert.equal(row(selected.stock.rows, 'G21 Touring').allocated.label, '1');

  const versions = [empty, brief, released, declined, selected].map((v) => v.meta.projectionVersion);
  assert.equal(new Set(versions).size, 5);
  assert.ok(versions.every((v) => v.startsWith(v.slice(0, 8)) && v.length > 8));
});

test('real service: canonical threshold shows only "fewer than 5" bands and no other number', async () => {
  const f = await setup({ canonical: true });
  await confirm(f);
  await offer(f, 1, 'declined', 'decline', { type: 'body' });
  const view = toDashboardView(await readDemand(f));
  assert.equal(view.meta.threshold, 5);
  assert.match(view.meta.privacyNote, /below 5 show as <5,/);
  const counts = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.count && typeof node.count.label === 'string') counts.push(node.count);
    if (node.released && node.held && node.allocated) counts.push(node.released, node.held, node.allocated);
    for (const value of Object.values(node)) walk(value);
  };
  walk(view);
  assert.ok(counts.length > 10);
  for (const count of counts) {
    assert.equal(count.isBand, true);
    assert.equal(count.label, 'fewer than 5');
    assert.deepEqual(count.label.match(/\d+/g), ['5']);
  }
  assert.equal(view.flags.hasBands, true);
});

// Same keys at every level; arrays compare each element to the first expected one. A count is exact or band; an essential's value is polymorphic.
const COUNT_KEYS = { exact: 'kind,label,value', band: 'fewerThan,kind,label' };
function shapeIssues(actual, expected, path = '$') {
  if (actual === null || expected === null || /essentials.*\.value$/.test(path)) return [];
  if (/\.count$/.test(path) && actual?.kind) {
    return Object.keys(actual).sort().join() === COUNT_KEYS[actual.kind] ? [] : [`${path}: bad ${actual.kind} count keys`];
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [`${path}: array mismatch`];
    if (!actual.length || !expected.length) return [];
    return actual.flatMap((item, i) => shapeIssues(item, expected[0], `${path}[${i}]`));
  }
  if (typeof expected === 'object' || typeof actual === 'object') {
    if (typeof expected !== typeof actual) return [`${path}: type mismatch`];
    const a = Object.keys(actual).sort(); const e = Object.keys(expected).sort();
    if (a.join() !== e.join()) return [`${path}: keys ${a} differ from ${e}`];
    return a.flatMap((key) => shapeIssues(actual[key], expected[key], `${path}.${key}`));
  }
  return typeof actual === typeof expected ? [] : [`${path}: ${typeof actual} vs ${typeof expected}`];
}

test('every fixture projection has the shape of a real readDemand value and the view accepts it', async () => {
  const f = await setup();
  await confirm(f, saved(7));
  await offer(f, 1, 'accepted', 'accept'); await offer(f, 2, 'declined', 'decline', { type: 'body' });
  await offer(f, 3, 'expired'); await offer(f, 4, 'selected', 'select'); await offer(f, 5, 'active');
  const real = await readDemand(f);
  assert.deepEqual(shapeIssues(real, real), []);
  assert.ok(shapeIssues({ ...real, extra: 1 }, real).length, 'comparator catches an extra key');
  assert.ok(shapeIssues({ ...real, demand: { ...real.demand, unmet: {} } }, real).length, 'comparator catches a missing nested key');
  for (const name of ready) {
    const first = await fixtureAdapter(name).loadDemand();
    assert.equal(first.status, 'ready', name);
    assert.deepEqual(shapeIssues(first.projection, real), [], name);
    const view = toDashboardView(first.projection);
    assert.equal(view.meta.basisLabel, 'Expressed saved demand');
    assert.notEqual(first.projection, (await fixtureAdapter(name).loadDemand()).projection);
  }
});

test('fixtures: states, copies, refresh sequence and abort', async () => {
  assert.equal(fixtureAdapter('nope'), null);
  for (const name of FIXTURE_NAMES) assert.ok(fixtureAdapter(name), name);
  const view = async (name) => toDashboardView((await fixtureAdapter(name).loadDemand()).projection);
  assert.equal((await view('empty')).flags.noBriefs, true);
  const noStock = await view('no-stock');
  assert.equal(noStock.flags.noStockReleased, true);
  assert.equal(row(noStock.demand.unmetByGate, 'no-released-stock').count.isBand, false);
  const banded = await view('banded');
  assert.equal(banded.flags.hasBands, true);
  assert.ok(banded.demand.byModelLine.every((r) => r.count.isBand));

  const first = await fixtureAdapter('populated').loadDemand();
  first.projection.demand.activeBriefs.count.label = 'changed';
  assert.notEqual((await fixtureAdapter('populated').loadDemand()).projection.demand.activeBriefs.count.label, 'changed');

  const refresh = fixtureAdapter('refresh');
  const a = (await refresh.loadDemand()).projection; const b = (await refresh.loadDemand()).projection; const c = (await refresh.loadDemand()).projection;
  const after = (await fixtureAdapter('after-release-decline').loadDemand()).projection;
  const populated = (await fixtureAdapter('populated').loadDemand()).projection;
  assert.deepEqual(a, populated); assert.deepEqual(b, after); assert.deepEqual(c, after);
  assert.ok(Date.parse(b.asOf) > Date.parse(a.asOf));
  assert.notEqual(a.projectionVersion, b.projectionVersion);
  const stockOf = (p) => p.stock.byModelLine.find((r) => r.key === 'G21 Touring').released.count.value;
  assert.equal(stockOf(b), stockOf(a) + 1);
  assert.equal(b.offers.declined.count.value, a.offers.declined.count.value + 1);
  assert.ok(b.demand.unmet.total.count.value < a.demand.unmet.total.count.value);

  for (const [name, status] of [['unavailable', 'unavailable'], ['refused', 'refused'], ['conflict', 'conflict']]) {
    const out = await fixtureAdapter(name).loadDemand();
    assert.equal(out.status, status); assert.ok(out.message);
  }
  const controller = new AbortController();
  const pending = fixtureAdapter('loading').loadDemand({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('toDashboardView: bands keep their label, nothing is summed, malformed input throws DemandViewError', async () => {
  const projection = (await fixtureAdapter('populated').loadDemand()).projection;
  const view = toDashboardView(projection);
  assert.deepEqual(view.headline.map((h) => h.key), ['activeBriefs', 'unmetTotal', 'made', 'selected']);
  assert.equal(view.demand.activeBriefs.count.label, '28');
  const model = view.demand.byModelLine;
  assert.equal(row(model, 'unspecified').label, 'No preference stated');
  assert.equal(row(model, 'G26 i4').count.isBand, true);
  assert.equal(row(model, 'G26 i4').count.label, 'fewer than 5');
  assert.equal(row(view.demand.byFuel, 'phev').label, 'Plug-in hybrid');
  assert.equal(row(view.stock.rows, 'unconfirmed').label, 'Model line not confirmed');
  assert.equal(view.meta.asOfText, '5 Nov 2026, 09:40 GMT');
  assert.equal(view.meta.projectionVersionShort.length, 8);
  assert.deepEqual(view.meta.policyVersions, ['gcsp-policy-v1']);
  assert.equal(view.meta.clockVersion, '41');
  assert.ok(view.demand.essentials.some((e) => e.state === 'needs-confirmation' && e.stateLabel === 'Needs confirmation'));
  assert.equal(view.meta.basisLabel, 'Expressed saved demand');

  for (const key of ['demand', 'offers', 'stock', 'privacy', 'asOf', 'versions']) {
    const broken = structuredClone(projection); delete broken[key];
    assert.throws(() => toDashboardView(broken), DemandViewError, key);
  }
  const mixed = structuredClone(projection); mixed.demand.activeBriefs.count = { kind: 'band', fewerThan: 5, label: 'fewer than 5', value: 3 };
  assert.throws(() => toDashboardView(mixed), DemandViewError);
  for (const input of [null, undefined, 'x', [], {}]) assert.throws(() => toDashboardView(input), DemandViewError);
});

test('gate and key labels cover known codes and keep unknown codes visible', () => {
  assert.deepEqual(gateInfo('essential-unmet:seats'), { code: 'essential-unmet', field: 'seats', label: 'Essential not met: Seats', severity: 'blocker' });
  assert.equal(gateInfo('driver-unconfirmed').severity, 'needs-confirmation');
  assert.equal(gateInfo('stock-not-visible').severity, 'blocker');
  assert.equal(gateInfo('declined-unchanged').severity, 'blocker');
  for (const code of ['availability-expired', 'not-available', 'not-yet-available', 'policy-exclude', 'required-by']) assert.equal(gateInfo(code).severity, 'blocker', code);
  for (const code of ['availability-date-unconfirmed', 'availability-unconfirmed', 'eligibility-unconfirmed', 'employee-essentials-unconfirmed']) assert.equal(gateInfo(code).severity, 'needs-confirmation', code);
  const unknown = gateInfo('something-new:wheel');
  assert.equal(unknown.severity, 'unknown');
  assert.match(unknown.label, /something-new:wheel/);
  assert.equal(keyLabel('suv'), 'SUV');
  assert.equal(keyLabel('unspecified'), 'No preference stated');
  assert.equal(requirementText({ field: 'seats', operator: 'gte', value: 5, unit: 'count' }), 'Seats at least 5');
  assert.equal(requirementText({ field: 'modelLine', operator: 'equals', value: 'G21 Touring', unit: null }), 'Model line is G21 Touring');
});

test('outcomeToState maps every HTTP outcome to one view state', async () => {
  const value = { demand: {}, offers: {}, stock: {} };
  assert.deepEqual(outcomeToState(200, { status: 'ok', value }), { status: 'ready', projection: value });
  for (const code of [401, 403]) {
    const out = outcomeToState(code, { status: 'forbidden' });
    assert.equal(out.status, 'refused'); assert.match(out.message, /Only the scheme ordering lead can open this dashboard/);
  }
  const stale = outcomeToState(409, { status: 'stale-run' });
  assert.equal(stale.status, 'refused'); assert.match(stale.message, /restarted/);
  const conflict = outcomeToState(409, { status: 'conflict' });
  assert.equal(conflict.status, 'conflict'); assert.match(conflict.message, /Refresh/);
  for (const [code, body] of [[503, { status: 'unavailable' }], [500, null], [200, null], [200, { status: 'ok', value: {} }], [200, 'garbage'], [404, {}], [409, {}]]) {
    assert.equal(outcomeToState(code, body).status, 'unavailable', `${code}`);
  }
});

test('http adapter: URL, method, credentials, headers, errors and abort', async () => {
  let seen;
  const value = { demand: {}, offers: {}, stock: {} };
  const respond = (status, body) => async (url, init) => { seen = { url, init }; return { status, json: async () => { if (body === undefined) throw new SyntaxError('bad'); return body; } }; };
  const adapter = createGregHttpAdapter({ base: 'https://api.example.test', fetchImpl: respond(200, { status: 'ok', value }) });
  assert.deepEqual(await adapter.loadDemand(), { status: 'ready', projection: value });
  assert.equal(seen.url, 'https://api.example.test/api/gcsp/greg/demand');
  assert.equal(seen.init.method, 'GET'); assert.equal(seen.init.credentials, 'include');
  assert.equal(seen.init.headers.Accept, 'application/json');
  assert.equal((await createGregHttpAdapter({ fetchImpl: respond(200, { status: 'ok', value }) }).loadDemand()) && seen.url, '/api/gcsp/greg/demand');
  assert.equal((await createGregHttpAdapter({ fetchImpl: respond(403, { status: 'forbidden' }) }).loadDemand()).status, 'refused');
  assert.equal((await createGregHttpAdapter({ fetchImpl: respond(409, { status: 'conflict' }) }).loadDemand()).status, 'conflict');
  assert.equal((await createGregHttpAdapter({ fetchImpl: respond(500, undefined) }).loadDemand()).status, 'unavailable');
  assert.equal((await createGregHttpAdapter({ fetchImpl: async () => { throw new TypeError('offline'); } }).loadDemand()).status, 'unavailable');
  const controller = new AbortController(); controller.abort();
  const aborting = createGregHttpAdapter({ fetchImpl: async () => { throw new DOMException('Aborted', 'AbortError'); } });
  await assert.rejects(aborting.loadDemand({ signal: controller.signal }), { name: 'AbortError' });
});

test('no em dash in any projected string, and no inline-script patterns in blocks/gcsp/greg', async () => {
  const strings = [];
  const collect = (node) => {
    if (typeof node === 'string') strings.push(node);
    else if (node && typeof node === 'object') Object.values(node).forEach(collect);
  };
  for (const name of FIXTURE_NAMES.filter((n) => n !== 'loading')) {
    const out = await fixtureAdapter(name).loadDemand();
    collect(out);
    if (out.projection) collect(toDashboardView(out.projection));
  }
  for (const code of ['no-released-stock', 'stock-not-visible', 'declined-unchanged', 'essential-unmet:seats', 'mystery:thing']) collect(gateInfo(code));
  collect([outcomeToState(401, null), outcomeToState(409, { status: 'stale-run' }), outcomeToState(409, { status: 'conflict' }), outcomeToState(500, null)]);
  assert.ok(strings.length > 200);
  for (const text of strings) assert.equal(/[—–]/.test(text), false, text);

  const files = (await readdir(GREG_DIR)).filter((n) => n.endsWith('.js'));
  assert.ok(files.length >= 4);
  for (const file of files) {
    const source = await readFile(new URL(file, GREG_DIR), 'utf8');
    assert.equal(/[—–]/.test(source.replace(/\/\/.*$/gm, '')), false, `${file} em dash in code`);
    assert.equal(/\bon[a-z]+\s*=/.test(source), false, `${file} inline handler`);
    assert.equal(/\beval\s*\(/.test(source), false, `${file} eval`);
    assert.equal(/new Function/.test(source), false, `${file} new Function`);
    assert.equal(/set(Timeout|Interval)\s*\(\s*['"`]/.test(source), false, `${file} string timer`);
  }
});

test('a 401 with no status (lapsed access key) reads access-required; a status keeps its refusal', async () => {
  const respond = (status, body) => async () => ({ status, json: async () => { if (body === undefined) throw new SyntaxError('bad'); return body; } });
  for (const body of [{ error: 'Unauthorized' }, undefined, null]) assert.deepEqual(outcomeToState(401, body), { status: 'access-required' });
  for (const body of [{ error: 'Unauthorized' }, undefined]) assert.deepEqual(await createGregHttpAdapter({ fetchImpl: respond(401, body) }).loadDemand(), { status: 'access-required' });
  assert.equal(outcomeToState(403, { error: 'Forbidden' }).status, 'refused');
  assert.equal((await createGregHttpAdapter({ fetchImpl: respond(401, { status: 'missing-session' }) }).loadDemand()).status, 'refused');
});
