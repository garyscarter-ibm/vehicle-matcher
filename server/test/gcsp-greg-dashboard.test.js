// FUCQ-101: Greg dashboard states, bands, refresh, reserved regions, element, kit components and embedding rules.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
let dash;
let fixtures;
let tile;
let table;

function installDom() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException']) {
    Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name] ?? globalThis[name], configurable: true, writable: true });
  }
}
before(async () => {
  installDom();
  dash = await import('../../blocks/gcsp/greg/gcsp-greg.js');
  fixtures = await import('../../blocks/gcsp/greg/fixtures.js');
  tile = await import('../../blocks/gcsp/kit/metric-tile.js');
  table = await import('../../blocks/gcsp/kit/data-table.js');
});
beforeEach(() => document.body.replaceChildren());

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const host = () => { const root = document.createElement('div'); document.body.append(root); return root; };
async function mountFixture(name, extra = {}) {
  const root = host();
  const adapter = fixtures.fixtureAdapter(name);
  const teardown = dash.mountGregDashboard(root, { loadDemand: adapter.loadDemand, ...extra });
  await tick();
  return { root, teardown };
}
const refreshButton = (root) => [...root.querySelectorAll('.gcsp-greg-bar .vm-btn')].find((b) => b.textContent === 'Refresh');
const section = (root, name) => root.querySelector(`[data-section="${name}"]`);
const meta = (root) => root.querySelector('.gcsp-greg-meta').textContent;
const tileByLabel = (root, label) => [...root.querySelectorAll('.gcsp-tile')].find((t) => t.querySelector('.gcsp-tile-label').textContent === label);
const cellsOf = (root, caption) => {
  const t = [...root.querySelectorAll('table')].find((n) => n.querySelector('caption').textContent === caption);
  return [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
};
const visible = (text) => text.replace(/, a privacy band: the exact count is hidden/g, '');

test('the shell shows Greg, Demand and supply current, the rest honestly unavailable, and one h1', async () => {
  const { root } = await mountFixture('populated');
  assert.equal(root.querySelector('.gcsp-account-name').textContent, 'Greg');
  assert.match(root.querySelector('.gcsp-account-context').textContent, /Scheme ordering lead, synthetic demo run/);
  assert.equal(root.querySelector('.gcsp-nav-btn[aria-current="page"]').dataset.key, 'dashboard');
  const disabled = [...root.querySelectorAll('.gcsp-nav-btn[aria-disabled="true"]')];
  assert.deepEqual(disabled.map((b) => b.dataset.key), ['publish', 'tracking', 'next-order']);
  assert.ok(disabled.every((b) => /Not available in this demo/.test(b.textContent) || /Not available in this demo/.test(b.getAttribute('aria-label') || '') || b.closest('li')?.textContent.includes('Not available in this demo')));
  assert.equal(root.querySelectorAll('main h1').length, 1);
  assert.equal(root.querySelector('main h1').textContent, 'Demand and supply');
  assert.equal(root.querySelector('.gcsp-crumb').textContent, 'Demand and supply');
  assert.equal(dash.GREG_NAVIGATION.length, 4);
});

test('populated shows the meta strip, headline tiles, every table and the fixture labels', async () => {
  const { root } = await mountFixture('populated');
  const m = meta(root);
  assert.match(m, /5 Nov 2026, 09:40 GMT \(demo clock\)/);
  assert.match(m, /gcsp-policy-v1/);
  assert.match(m, /1, 2, 3/);
  assert.match(m, /Expressed saved demand/);
  assert.match(m, /not satisfaction and not a prediction/);
  assert.match(m, /fewer than 5/);
  assert.equal(tileByLabel(root, 'Active briefs').querySelector('.gcsp-tile-figure').textContent, '28');
  assert.ok(tileByLabel(root, 'Briefs with no suitable car'));
  assert.ok(tileByLabel(root, 'Offers made'));
  assert.ok(tileByLabel(root, 'Selected'));
  assert.equal(root.querySelectorAll('.gcsp-greg-headline .gcsp-tile').length, 4);
  assert.deepEqual(cellsOf(root, 'By model line')[0].map(visible), ['G01 X3', '5']);
  assert.deepEqual(cellsOf(root, 'By model line')[2].map(visible), ['G26 i4', 'fewer than 5']);
  assert.deepEqual(cellsOf(root, 'By model line')[1].map(visible), ['G21 Touring', '11']);
  assert.ok(cellsOf(root, 'By body style').some((r) => r[0] === 'Estate'));
  assert.ok(cellsOf(root, 'By fuel type').some((r) => r[0] === 'Plug-in hybrid'));
  assert.ok(cellsOf(root, 'By essential requirement').some((r) => r[0] === 'Seats at least 5' && r[1] === 'Confirmed' && r[2] === '15'));
  assert.ok(cellsOf(root, 'By essential requirement').some((r) => r[1] === 'Needs confirmation'));
  const gates = cellsOf(root, 'Briefs with no suitable car, by gate');
  assert.ok(gates.some((r) => r[1] === 'Blocks the offer'));
  assert.ok(gates.some((r) => r[1] === 'Needs confirmation'));
  assert.match(section(root, 'unmet').textContent, /Rows can overlap, so do not add them together/);
  const offers = section(root, 'offers');
  for (const l of ['Offers made', 'Accepted', 'Declined', 'Expired', 'Selected']) assert.ok([...offers.querySelectorAll('.gcsp-tile-label')].some((n) => n.textContent === l), l);
  assert.ok(cellsOf(root, 'Declined offers, by reason').length >= 4);
  assert.deepEqual(cellsOf(root, 'Stock by model line')[1].map(visible), ['G21 Touring', '8', 'fewer than 5', 'fewer than 5']);
  assert.match(root.querySelector('.gcsp-greg-status').textContent, /Figures updated for 5 Nov 2026, 09:40 GMT/);
  for (const h of root.querySelectorAll('.gcsp-greg-body section, .gcsp-greg-regions section')) {
    assert.equal(h.tagName, 'SECTION');
    assert.equal(document.getElementById(h.getAttribute('aria-labelledby')).tagName, 'H2');
  }
});

test('banded counts show their label with a privacy description and no derived digit', async () => {
  const { root } = await mountFixture('banded');
  const bands = [...root.querySelectorAll('.gcsp-greg-body [data-band="true"]')];
  assert.ok(bands.length >= 8);
  for (const b of bands) {
    assert.equal(visible(b.textContent).replace(/\s+/g, ' ').trim().match(/fewer than 5/) !== null, true, b.textContent);
    assert.match(b.textContent, /a privacy band: the exact count is hidden/);
    assert.deepEqual(visible(b.textContent).match(/\d+/g), ['5'], b.textContent);
  }
  assert.match(meta(root), /Counts below 5 show as fewer than 5/);
  assert.equal(tileByLabel(root, 'Active briefs').dataset.band, 'true');
  assert.equal(root.querySelectorAll('.gcsp-greg-bar [role="alert"]').length, 0);
});

test('empty (no briefs) explains itself, keeps the meta strip and stock, and shows no demand tables', async () => {
  const { root } = await mountFixture('empty');
  const status = root.querySelector('.gcsp-greg-body .vm-status');
  assert.match(status.textContent, /No briefs yet/);
  assert.match(status.textContent, /No employee has confirmed a brief yet/);
  assert.match(meta(root), /None yet/);
  assert.equal(root.querySelector('[data-section="demand"]'), null);
  assert.deepEqual(cellsOf(root, 'Stock by model line').map((r) => visible(r[0])), ['G21 Touring', 'G60 Saloon']);
  assert.ok(refreshButton(root));
});

test('no stock released shows an explicit stock message and still shows the unmet gate', async () => {
  const { root } = await mountFixture('no-stock');
  assert.deepEqual(cellsOf(root, 'Stock by model line'), [['No stock has been released yet']]);
  assert.ok(cellsOf(root, 'Briefs with no suitable car, by gate').some((r) => r[0] === 'No stock has been released yet'));
  assert.ok(tileByLabel(root, 'Active briefs'));
});

test('FUCQ-213: unmet table says the stock source is unavailable, not that no stock was released', async () => {
  for (const [source, wording] of [[{ status: 'unavailable' }, 'Stock source unavailable'], [{ status: 'unavailable', reason: 'stale' }, 'Stock data too old to use']]) {
    document.body.replaceChildren();
    const projection = fixtures.fixtureProjection('no-stock'); projection.stock.source = source;
    const { root } = await mountFixture('no-stock', { loadDemand: async () => ({ status: 'ready', projection }) });
    const gates = cellsOf(root, 'Briefs with no suitable car, by gate').map((r) => r[0]);
    assert.ok(gates.includes(wording), gates.join('|')); assert.ok(!gates.includes('No stock has been released yet'));
  }
});

test('conflict shows its message and Refresh reloads', async () => {
  const { root } = await mountFixture('conflict');
  assert.match(root.querySelector('.vm-status').textContent, /figures changed while they were loading/);
  assert.equal(root.querySelectorAll('table').length, 0);
  assert.ok(refreshButton(root));
});

test('refresh fixture: Refresh changes figures, as-of and versions, keeps focus on Refresh and announces it', async () => {
  const { root } = await mountFixture('refresh');
  assert.match(meta(root), /09:40 GMT/);
  const before = cellsOf(root, 'Stock by model line')[1].map(visible);
  const declined = tileByLabel(root, 'Declined').querySelector('.gcsp-tile-figure').textContent;
  const unmet = tileByLabel(root, 'Briefs with no suitable car').querySelector('.gcsp-tile-figure').textContent;
  const button = refreshButton(root);
  button.focus();
  button.click();
  assert.match(root.querySelector('.gcsp-greg-status').textContent, /Refreshing/);
  await tick();
  assert.equal(document.activeElement, button);
  assert.match(meta(root), /10:25 GMT/);
  assert.doesNotMatch(meta(root), /09:40 GMT/);
  assert.notDeepEqual(cellsOf(root, 'Stock by model line')[1].map(visible), before);
  assert.equal(cellsOf(root, 'Stock by model line')[1].map(visible)[1], '9');
  assert.notEqual(tileByLabel(root, 'Declined').querySelector('.gcsp-tile-figure').textContent, declined);
  assert.notEqual(tileByLabel(root, 'Briefs with no suitable car').querySelector('.gcsp-tile-figure').textContent, unmet);
  assert.equal(root.querySelector('.gcsp-greg-status').getAttribute('role'), 'status');
  assert.match(root.querySelector('.gcsp-greg-status').textContent, /Figures updated for 5 Nov 2026, 10:25 GMT/);
  assert.equal(root.querySelector('.gcsp-greg-body').hasAttribute('aria-busy'), false);
});

test('reserved regions are labelled, empty of figures and tables, and returned by teardown.regions', async () => {
  const { root, teardown } = await mountFixture('populated');
  const names = ['publish', 'prediction', 'order-tracking', 'route-comparison', 'case-queue'];
  const nodes = names.map((n) => root.querySelector(`section[data-region="${n}"]`));
  assert.ok(nodes.every(Boolean));
  assert.deepEqual(Object.keys(teardown.regions), ['publish', 'prediction', 'orderTracking', 'routeComparison', 'caseQueue']);
  assert.deepEqual([...root.querySelectorAll('section[data-region]')].map((n) => n.dataset.region), names, 'Next order comes before Order requests');
  assert.equal(nodes[2].id, 'gcsp-order-requests', 'the request link has a stable target');
  assert.deepEqual(Object.values(teardown.regions), nodes);
  for (const node of nodes) {
    assert.equal(node.querySelectorAll('table, .gcsp-tile, dl, svg').length, 0);
    assert.doesNotMatch(node.textContent, /\d/);
    assert.equal(node.querySelectorAll('h2').length, 1);
    assert.equal(document.getElementById(node.getAttribute('aria-labelledby')), node.querySelector('h2'));
    assert.match(node.querySelector('.gcsp-note').textContent, /not built in this demo yet/);
  }
  assert.ok(!root.querySelector('.gcsp-greg-body').contains(nodes[0]), 'regions sit outside the live figures');
});

test('refused shows no figures, no Retry and hides the reserved regions', async () => {
  const { root } = await mountFixture('refused');
  const status = root.querySelector('.gcsp-greg-body .vm-status');
  assert.equal(status.getAttribute('role'), 'alert');
  assert.match(status.textContent, /Only the scheme ordering lead/);
  assert.equal(status.querySelector('.vm-btn'), null);
  // The shell's presenter bar (112fdfe2) holds an empty, hidden dl until a presenter session authorises it.
  assert.equal([...root.querySelectorAll('table, .gcsp-tile, dl')].filter((n) => !n.closest('.gcsp-presenter-region')).length, 0);
  assert.equal(root.querySelector('.gcsp-presenter-controls').hidden, true);
  assert.equal(root.querySelector('.gcsp-greg-regions').hidden, true);
});

test('unavailable has Retry that reloads, and calls onUnavailable', async () => {
  let calls = 0;
  const reasons = [];
  const root = host();
  const teardown = dash.mountGregDashboard(root, {
    loadDemand: async () => (++calls === 1 ? { status: 'unavailable', message: 'down' } : { status: 'ready', projection: fixtures.fixtureProjection('populated') }),
    onUnavailable: (r) => reasons.push(r),
  });
  await tick();
  const status = root.querySelector('.gcsp-greg-body .vm-status');
  assert.equal(status.getAttribute('role'), 'alert');
  assert.match(status.textContent, /down/);
  assert.deepEqual(reasons, ['source-unavailable']);
  assert.equal(root.querySelectorAll('table').length, 0);
  status.querySelector('.vm-btn').click();
  await tick();
  assert.equal(calls, 2);
  assert.ok(tileByLabel(root, 'Active briefs'));
  teardown();
});

test('a malformed projection, a thrown load and a missing adapter all show unavailable', async () => {
  const bad = fixtures.fixtureProjection('populated');
  delete bad.stock;
  const reasons = [];
  const first = host();
  dash.mountGregDashboard(first, { loadDemand: async () => ({ status: 'ready', projection: bad }), onUnavailable: (r) => reasons.push(r) });
  const second = host();
  dash.mountGregDashboard(second, { loadDemand: async () => { throw new Error('boom'); } });
  const third = host();
  dash.mountGregDashboard(third, { onUnavailable: (r) => reasons.push(r) });
  await tick();
  for (const root of [first, second, third]) {
    assert.equal(root.querySelector('.gcsp-greg-body .vm-status').getAttribute('role'), 'alert');
    assert.match(root.querySelector('.gcsp-greg-body .vm-status').textContent, /unavailable/);
    assert.equal(root.querySelectorAll('table, .gcsp-tile').length, 0);
  }
  assert.deepEqual(reasons.sort(), ['malformed-projection', 'no-adapter']);
});

test('loading shows a note, aborts on teardown and leaves the root empty', async () => {
  let signal;
  const root = host();
  const adapter = fixtures.fixtureAdapter('loading');
  const teardown = dash.mountGregDashboard(root, { loadDemand: (o) => { signal = o.signal; return adapter.loadDemand(o); } });
  await tick();
  assert.match(root.querySelector('main').textContent, /Loading the demand figures/);
  assert.equal(signal.aborted, false);
  teardown();
  assert.equal(signal.aborted, true);
  assert.equal(root.children.length, 0);
  teardown();
});

test('an external abort signal also aborts the load', async () => {
  const controller = new AbortController();
  let signal;
  const root = host();
  dash.mountGregDashboard(root, { signal: controller.signal, loadDemand: (o) => { signal = o.signal; return fixtures.fixtureAdapter('loading').loadDemand(o); } });
  controller.abort();
  assert.equal(signal.aborted, true);
});

test('the custom element reads fixture and adapter, emits events, exposes regions and refresh, and tears down', async () => {
  const first = dash.defineGcspGregDashboard(customElements);
  assert.equal(dash.defineGcspGregDashboard(customElements), first);
  const node = document.createElement('gcsp-greg-dashboard');
  node.setAttribute('fixture', 'refresh');
  const events = [];
  node.addEventListener('gcsp:ready', (e) => events.push(e.detail.view));
  document.body.append(node);
  await tick();
  assert.deepEqual(events, ['dashboard']);
  assert.match(node.textContent, /09:40 GMT/);
  assert.equal(Object.keys(node.regions).length, 5);
  await node.refresh();
  await tick();
  assert.match(node.textContent, /10:25 GMT/);
  node.adapter = { loadDemand: async () => ({ status: 'refused', message: 'No.' }) };
  await tick();
  assert.match(node.textContent, /No\./);
  node.remove();
  assert.equal(node.children.length, 0);
  assert.equal(node.regions, null);
  const unknown = document.createElement('gcsp-greg-dashboard');
  unknown.setAttribute('fixture', 'nope');
  const reasons = [];
  unknown.addEventListener('gcsp:unavailable', (e) => reasons.push(e.detail.reason));
  document.body.append(unknown);
  await tick();
  assert.deepEqual(reasons, ['unknown-fixture']);
  assert.match(unknown.textContent, /unavailable/);
});

test('metricTile: label, figure, note, level and band marking', () => {
  const exact = tile.metricTile({ label: 'Offers made', count: { label: '30', isBand: false }, note: 'Counted once each.', level: 'headline' });
  assert.ok(exact.classList.contains('gcsp-tile-headline'));
  assert.equal(exact.querySelector('.gcsp-tile-label').textContent, 'Offers made');
  assert.equal(exact.querySelector('.gcsp-tile-figure').textContent, '30');
  assert.equal(exact.querySelector('.gcsp-tile-note').textContent, 'Counted once each.');
  assert.equal(exact.dataset.band, undefined);
  const band = tile.metricTile({ label: 'Declined', count: { label: 'fewer than 5', isBand: true } });
  assert.equal(band.dataset.band, 'true');
  assert.ok(band.querySelector('.gcsp-tile-figure').classList.contains('is-band'));
  assert.match(band.querySelector('.gcsp-tile-figure').textContent, /^fewer than 5, a privacy band/);
  assert.equal(band.querySelector('.gcsp-tile-note'), null);
  assert.ok(tile.metricTile({ label: 'X', count: { label: '1', isBand: false }, level: 'bogus' }).classList.contains('gcsp-tile-standard'));
  assert.match(tile.metricTile({ label: 'Missing', count: null }).textContent, /Not supplied/);
  assert.match(tile.metricTile({ label: 'Plain', count: 1234 }).textContent, /1,234/);
});

test('dataTable stack: labelled cells and explicit roles only when asked', () => {
  const columns = [{ key: 'name', label: 'Model line' }, { key: 'n', label: 'Released', numeric: true }, { key: 'd', label: 'Difference', numeric: true }];
  const rows = [{ name: 'A', n: '2', d: { label: '+1', emphasis: true } }];
  const on = table.dataTable({ caption: 'Stack', columns, rows, stack: true });
  assert.ok(on.classList.contains('is-stack')); assert.equal(on.getAttribute('role'), 'region'); assert.equal(on.tabIndex, 0);
  const t = on.querySelector('table');
  assert.equal(t.getAttribute('role'), 'table');
  assert.deepEqual([...t.querySelectorAll('thead, tbody')].map((n) => n.getAttribute('role')), ['rowgroup', 'rowgroup']);
  assert.ok([...t.querySelectorAll('tr')].every((r) => r.getAttribute('role') === 'row'));
  assert.deepEqual([...t.querySelectorAll('thead th')].map((n) => n.getAttribute('role')), ['columnheader', 'columnheader', 'columnheader']);
  const [head, ...tds] = t.querySelector('tbody tr').children;
  assert.equal(head.getAttribute('role'), 'rowheader'); assert.equal(head.dataset.label, undefined);
  assert.deepEqual(tds.map((c) => [c.getAttribute('role'), c.dataset.label]), [['cell', 'Released'], ['cell', 'Difference']]);
  assert.equal(tds[1].textContent, '+1');
  const empty = table.dataTable({ caption: 'E', columns, rows: [], stack: true });
  assert.equal(empty.querySelector('tbody td').getAttribute('role'), 'cell');
  const off = table.dataTable({ caption: 'Plain', columns, rows });
  assert.ok(!off.classList.contains('is-stack')); assert.equal(off.querySelector('table').hasAttribute('role'), false);
  assert.equal(off.querySelectorAll('[role]:not([role="region"]), [data-label]').length, 0);
  const css = read('blocks/gcsp/kit/gcsp-kit.css');
  assert.match(css, /@media \(max-width: 640px\) \{[^\n]*\.gcsp \.gcsp-table-wrap\.is-stack thead/);
});

test('dataTable: caption, scopes, numeric columns, scroll region, band cells and empty row', () => {
  const columns = [{ key: 'name', label: 'Model line' }, { key: 'n', label: 'Released', numeric: true }];
  const region = table.dataTable({ caption: 'Stock', columns, rows: [{ name: 'A very long model name', n: { label: 'fewer than 5', isBand: true } }, { name: 'B', n: '7' }], id: 't1' });
  document.body.append(region);
  assert.equal(region.getAttribute('role'), 'region');
  assert.equal(region.tabIndex, 0);
  const tbl = region.querySelector('table');
  assert.equal(document.getElementById(region.getAttribute('aria-labelledby')), tbl.querySelector('caption'));
  assert.equal(tbl.querySelector('caption').textContent, 'Stock');
  const heads = [...tbl.querySelectorAll('thead th')];
  assert.ok(heads.every((h) => h.getAttribute('scope') === 'col'));
  assert.ok(heads[1].classList.contains('is-numeric'));
  const row = tbl.querySelector('tbody tr');
  assert.equal(row.children[0].tagName, 'TH');
  assert.equal(row.children[0].getAttribute('scope'), 'row');
  assert.equal(row.children[1].tagName, 'TD');
  assert.ok(row.children[1].classList.contains('is-numeric'));
  assert.equal(row.children[1].dataset.band, 'true');
  assert.match(row.children[1].textContent, /fewer than 5/);
  assert.equal(tbl.querySelectorAll('tbody tr')[1].children[1].dataset.band, undefined);
  const bold = table.dataTable({ caption: 'Bold', columns, rows: [{ name: { label: 'Changed', emphasis: true }, n: { label: '+1', emphasis: true } }, { name: 'Same', n: 'No change' }] });
  const [changed, same] = bold.querySelectorAll('tbody tr');
  assert.equal(changed.children[0].querySelector('strong').textContent, 'Changed'); assert.equal(changed.children[1].querySelector('strong').textContent, '+1');
  assert.equal(changed.children[1].classList.contains('is-numeric'), true); assert.equal(same.querySelector('strong'), null);
  const empty = table.dataTable({ caption: 'None', columns, rows: [], emptyText: 'Nothing here' });
  const cell = empty.querySelector('tbody td');
  assert.equal(cell.textContent, 'Nothing here');
  assert.equal(cell.colSpan, 2);
  const a = table.dataTable({ caption: 'a', columns, rows: [] });
  const b = table.dataTable({ caption: 'b', columns, rows: [] });
  assert.notEqual(a.getAttribute('aria-labelledby'), b.getAttribute('aria-labelledby'));
});

test('dataTable compare (FUCQ-275): row header | value | value at any width, column detail, missing cells, never stacked', () => {
  const columns = [{ key: 'l', label: 'Detail' }, { key: 'a', label: 'This offer', detail: 'Car A' }, { key: 'b', label: 'Your current car', detail: 'Car B, Sport' }];
  const rows = [{ l: 'Boot', a: '500 litres', b: { label: 'Unknown', missing: true } }, { l: 'Seats', a: null, b: '5' }];
  const region = table.dataTable({ caption: 'Compared', columns, rows, compare: true, stack: true });
  assert.ok(region.classList.contains('is-compare')); assert.ok(!region.classList.contains('is-stack'));
  assert.equal(region.getAttribute('role'), 'region'); assert.equal(region.tabIndex, 0);
  const t = region.querySelector('table'); assert.equal(t.hasAttribute('role'), false);
  assert.equal(t.querySelectorAll('[role]:not([role="region"]), [data-label]').length, 0);
  const heads = [...t.querySelectorAll('thead th')];
  assert.deepEqual(heads.map((h) => h.getAttribute('scope')), ['col', 'col', 'col']);
  assert.equal(heads[0].querySelector('.gcsp-table-th-sub'), null);
  assert.equal(heads[1].firstChild.textContent, 'This offer'); assert.equal(heads[1].querySelector('.gcsp-table-th-sub').textContent, 'Car A');
  assert.equal(heads[2].querySelector('.gcsp-table-th-sub').textContent, 'Car B, Sport');
  const [first, second] = t.querySelectorAll('tbody tr');
  assert.deepEqual([...first.children].map((c) => c.tagName), ['TH', 'TD', 'TD']); assert.equal(first.children[0].getAttribute('scope'), 'row');
  assert.equal(first.children[2].textContent, 'Unknown'); assert.ok(first.children[2].classList.contains('is-missing'));
  assert.equal(first.children[1].classList.contains('is-missing'), false);
  assert.equal(second.children[1].textContent, 'Not supplied'); assert.ok(second.children[1].classList.contains('is-missing'));
  const plain = table.dataTable({ caption: 'Plain', columns, rows });
  assert.ok(!plain.classList.contains('is-compare'));
  const css = read('blocks/gcsp/kit/data-table-compare.css');
  assert.match(css, /\.gcsp \.is-compare \.gcsp-table \{ table-layout: fixed; \}/); assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  for (const selector of selectorsOf('blocks/gcsp/kit/data-table-compare.css')) assert.match(selector, /^\.gcsp /);
});

test('factList pair option (FUCQ-275): a class keeps two columns at narrow width; the default rule is unchanged', async () => {
  const ui = await import('../../blocks/vehicle-matcher/ui.js');
  const rows = [{ label: 'Model', value: 'X' }, { label: 'Colour', value: null }];
  const list = ui.factList(rows, { className: 'vm-facts-pair' });
  assert.ok(list.classList.contains('vm-facts') && list.classList.contains('vm-facts-pair'));
  assert.equal(ui.factList(rows).className, 'vm-facts');
  const css = read('blocks/vehicle-matcher/gcsp-kit.css');
  assert.match(css, /\.gcsp \.vm-facts\.vm-facts-pair \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.gcsp \.vm-facts \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 150px\), 1fr\)\);/);
});

// ---------- source scans ----------
const walk = (dir) => readdirSync(dir).sort().map((n) => join(dir, n)).filter((p) => statSync(p).isFile());
const sources = () => [...walk(join(ROOT, 'blocks/gcsp/greg')), ...walk(join(ROOT, 'blocks/gcsp/kit')), join(ROOT, 'gcsp-greg.html')];
const selectorsOf = (rel) => {
  const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\s+[^;]+;/g, '').replace(/@media[^{]*\{/g, '');
  return [...css.matchAll(/(?:^|[}\s])([^{}@]+)\{/g)].flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter(Boolean);
};

test('CSP: no inline scripts, handler attributes, eval, new Function, string timers or HTML injection', () => {
  const offenders = [];
  for (const f of sources()) {
    const src = readFileSync(f, 'utf8');
    if (f.endsWith('.html')) {
      for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (m[2].trim()) offenders.push('inline script body');
        if (!/\bsrc=/.test(m[1])) offenders.push('script without src');
      }
      if (/\son[a-z]+\s*=/i.test(src)) offenders.push('inline handler attribute');
      if (/javascript:/i.test(src)) offenders.push('javascript: URL');
    } else if (f.endsWith('.js')) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
      if (/\beval\s*\(/.test(code)) offenders.push(`${f}: eval`);
      if (/new\s+Function\b/.test(code)) offenders.push(`${f}: new Function`);
      if (/\bset(Timeout|Interval)\s*\(/.test(code)) offenders.push(`${f}: timer`);
      if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(code)) offenders.push(`${f}: HTML string injection`);
      if (/\.setAttribute\(\s*['"]on[a-z]+['"]/.test(code)) offenders.push(`${f}: handler attribute`);
      if (/\blocation\b|\bhistory\./.test(code) && !f.endsWith('harness.js')) offenders.push(`${f}: reads location`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no em dash in any rendered text or in the page', async () => {
  for (const name of fixtures.FIXTURE_NAMES.filter((n) => n !== 'loading')) {
    document.body.replaceChildren();
    const { root } = await mountFixture(name);
    assert.ok(!root.textContent.includes('—'), name);
  }
  assert.ok(!read('gcsp-greg.html').includes('—'));
  for (const f of sources().filter((p) => p.endsWith('.js'))) {
    read(f.slice(ROOT.length)).split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const s of line.match(/([`'"])(?:\\.|(?!\1).)*\1/g) || []) assert.ok(!s.includes('—'), `${f}:${i + 1}`);
    });
  }
});

test('stylesheets: every selector starts with .gcsp, tokens only, no side stripe, reduced motion honoured', () => {
  for (const file of ['blocks/gcsp/kit/gcsp-kit.css', 'blocks/gcsp/greg/gcsp-greg.css']) {
    const selectors = selectorsOf(file);
    assert.ok(selectors.length >= 10, file);
    assert.deepEqual(selectors.filter((s) => !s.startsWith('.gcsp')), [], file);
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, `${file}: raw hex colour`);
    assert.doesNotMatch(css, /\b(rgb|hsl)a?\(/, `${file}: raw colour function`);
    assert.doesNotMatch(css, /border-(left|right)(-width)?\s*:\s*[^;]*\b([2-9]|\d\d)\d*px/, `${file}: side stripe`);
    const vars = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    assert.ok(vars.every((v) => v.startsWith('--gcsp-') || v.startsWith('--vm-')), file);
  }
  assert.match(read('blocks/gcsp/greg/gcsp-greg.css'), /prefers-reduced-motion: reduce/);
});

test('harness page, register module and fixture whitelist', () => {
  const html = read('gcsp-greg.html');
  for (const href of ['vehicle-matcher/vehicle-matcher.css', 'gcsp/shell/gcsp-shell.css', 'gcsp/employee/gcsp-employee.css', 'gcsp/kit/gcsp-kit.css', 'gcsp/greg/gcsp-greg.css']) assert.ok(html.includes(`blocks/${href}`), href);
  assert.equal([...html.matchAll(/<script\b/g)].length, 1);
  assert.match(html, /blocks\/gcsp\/greg\/harness\.js/);
  assert.match(read('blocks/gcsp/greg/harness.js'), /FIXTURE_NAMES\.includes/);
  assert.match(read('blocks/gcsp/greg/register.js'), /defineGcspGregDashboard\(\)/);
  assert.equal(fixtures.fixtureAdapter('nope'), null);
});

test('the gallery shows both kit components; the catalogue and ratchet record them', async () => {
  const { mountComponentGallery } = await import('../../blocks/vehicle-matcher/component-gallery.js');
  const root = host();
  mountComponentGallery(root);
  const group = root.querySelector('.vm-gallery-greg-section');
  assert.ok(group);
  assert.ok(group.querySelector('.gcsp-tile[data-band="true"]'));
  assert.ok(group.querySelector('.gcsp-tile-note'));
  assert.ok(group.querySelectorAll('table').length >= 2);
  assert.ok(group.querySelector('td[data-band="true"]'));
  assert.ok(group.querySelector('.gcsp-table-empty'));
  assert.ok(group.querySelector('.gcsp-table-wrap.is-compare .gcsp-table-th-sub')); assert.ok(root.querySelector('.vm-facts.vm-facts-pair'));
  assert.ok(read('components.html').includes('blocks/gcsp/kit/gcsp-kit.css')); assert.ok(read('components.html').includes('blocks/gcsp/kit/data-table-compare.css'));
  const doc = read('COMPONENTS.md');
  assert.match(doc, /metricTile/);
  assert.match(doc, /dataTable/);
  assert.match(doc, /mountGregDashboard/);
  const ratchet = JSON.parse(read('server/test/ui-ratchet.json'));
  for (const path of ['blocks/gcsp/kit/gcsp-kit.css', 'blocks/gcsp/kit/data-table-compare.css', 'blocks/gcsp/greg/gcsp-greg.css']) {
    const entry = ratchet.stylesheets.find((s) => s.path === path);
    assert.ok(entry, path);
    assert.equal(entry.max_lines, read(path).split('\n').length, path);
  }
});

test('a lapsed access key shows the restart screen with Reload and hides the reserved regions', async () => {
  const root = host(); const teardown = dash.mountGregDashboard(root, { loadDemand: async () => ({ status: 'access-required' }) }); await tick();
  const status = root.querySelector('.gcsp-greg-body .vm-status');
  assert.equal(status.getAttribute('role'), 'alert'); assert.match(status.textContent, /Demo restarted/);
  assert.deepEqual([...status.querySelectorAll('.vm-btn')].map((b) => b.textContent), ['Reload']);
  assert.equal(root.querySelector('.gcsp-greg-regions').hidden, true); assert.doesNotMatch(root.textContent, /demand figures are unavailable/); teardown();
});
