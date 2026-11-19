// FUCQ-101: Greg kit components (metricTile, dataTable, factList pair), gallery wiring and source rules.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
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
  tile = await import('../../blocks/gcsp/kit/metric-tile.js');
  table = await import('../../blocks/gcsp/kit/data-table.js');
});
beforeEach(() => document.body.replaceChildren());

const host = () => { const root = document.createElement('div'); document.body.append(root); return root; };
// What a sighted reader sees (hidden-only text dropped) and what a screen reader says (aria-hidden dropped).
const strip = (node, sel) => { const c = node.cloneNode(true); c.querySelectorAll(sel).forEach((n) => n.remove()); return c.textContent; };
const shown = (node) => strip(node, '.gcsp-vh');
const spoken = (node) => strip(node, '[aria-hidden="true"]');

test('metricTile: label, figure, note, level and band marking', () => {
  const exact = tile.metricTile({ label: 'Offers made', count: { label: '30', isBand: false }, note: 'Counted once each.', level: 'headline' });
  assert.ok(exact.classList.contains('gcsp-tile-headline'));
  assert.equal(exact.querySelector('.gcsp-tile-label').textContent, 'Offers made');
  assert.equal(exact.querySelector('.gcsp-tile-figure').textContent, '30');
  assert.equal(exact.querySelector('.gcsp-tile-note').textContent, 'Counted once each.');
  assert.equal(exact.dataset.band, undefined);
  const band = tile.metricTile({ label: 'Declined', count: { label: 'fewer than 5', isBand: true, fewerThan: 5 } });
  const bandFigure = band.querySelector('.gcsp-tile-figure');
  assert.equal(band.dataset.band, 'true');
  assert.ok(bandFigure.classList.contains('is-band'));
  assert.equal(shown(bandFigure), '<5');
  assert.equal(spoken(bandFigure), 'fewer than 5');
  assert.equal(bandFigure.querySelector('[aria-hidden="true"]').textContent, '<5');
  assert.doesNotMatch(bandFigure.textContent, /privacy band/);
  const bare = tile.metricTile({ label: 'Declined', count: { label: 'few', isBand: true } }).querySelector('.gcsp-tile-figure');
  assert.equal(bare.textContent, 'few');
  assert.equal(bare.querySelector('.gcsp-vh'), null);
  assert.equal(bare.dataset.band, 'true');
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

test('FUCQ-293: a band is plain figure text, not a dashed placeholder box or an italic muted cell', () => {
  const css = read('blocks/gcsp/kit/gcsp-kit.css');
  const bandRules = css.split('\n').filter((l) => /\.is-band/.test(l) && !/white-space/.test(l));
  assert.deepEqual(bandRules, []);
  assert.doesNotMatch(css, /dashed/);
  assert.doesNotMatch(read('blocks/gcsp/kit/metric-tile.js'), /BAND_DESCRIPTION/);
});

test('dataTable: caption, scopes, numeric columns, scroll region, band cells and empty row', () => {
  const columns = [{ key: 'name', label: 'Model line' }, { key: 'n', label: 'Released', numeric: true }];
  const region = table.dataTable({ caption: 'Stock', columns, rows: [{ name: 'A very long model name', n: { label: 'fewer than 5', isBand: true, fewerThan: 5 } }, { name: 'B', n: '7' }], id: 't1' });
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
  assert.equal(shown(row.children[1]), '<5');
  assert.equal(spoken(row.children[1]), 'fewer than 5');
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
const sources = () => [...walk(join(ROOT, 'blocks/gcsp/greg')), ...walk(join(ROOT, 'blocks/gcsp/kit'))];
const selectorsOf = (rel) => {
  const css = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\s+[^;]+;/g, '').replace(/@media[^{]*\{/g, '');
  return [...css.matchAll(/(?:^|[}\s])([^{}@]+)\{/g)].flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter(Boolean);
};

// Matches the shell check and the contract: only a string first argument is banned.
const STRING_TIMER = /\bset(Timeout|Interval)\s*\(\s*(['"`])/;

test('CSP: no inline scripts, handler attributes, eval, new Function, string timers or HTML injection', () => {
  assert.ok(STRING_TIMER.test("setTimeout('tick()', 5)") && STRING_TIMER.test('setInterval(`x`, 5)'));
  assert.ok(!STRING_TIMER.test('setTimeout(finish, 5)') && !STRING_TIMER.test('setTimeout(() => run(), 16)'));
  const offenders = [];
  for (const f of sources()) {
    const src = readFileSync(f, 'utf8');
    if (f.endsWith('.js')) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
      if (/\beval\s*\(/.test(code)) offenders.push(`${f}: eval`);
      if (/new\s+Function\b/.test(code)) offenders.push(`${f}: new Function`);
      if (STRING_TIMER.test(code)) offenders.push(`${f}: string timer`);
      if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(code)) offenders.push(`${f}: HTML string injection`);
      if (/\.setAttribute\(\s*['"]on[a-z]+['"]/.test(code)) offenders.push(`${f}: handler attribute`);
      if (/\blocation\b|\bhistory\./.test(code)) offenders.push(`${f}: reads location`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no em dash in any string literal of the Greg or kit modules', () => {
  for (const f of sources().filter((p) => p.endsWith('.js'))) {
    read(f.slice(ROOT.length)).split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const s of line.match(/([`'"])(?:\\.|(?!\1).)*\1/g) || []) assert.ok(!s.includes('—'), `${f}:${i + 1}`);
    });
  }
});

test('stylesheets: every selector starts with .gcsp, tokens only, no side stripe', () => {
  for (const file of ['blocks/gcsp/kit/gcsp-kit.css']) {
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
});

test('the gallery shows both kit components; the catalogue and ratchet record them', async () => {
  const { mountComponentGallery } = await import('../../blocks/vehicle-matcher/component-gallery.js');
  const root = host();
  mountComponentGallery(root);
  const group = root.querySelector('.vm-gallery-greg-section');
  assert.ok(group);
  assert.ok(group.querySelector('.gcsp-tile[data-band="true"]'));
  assert.equal(shown(group.querySelector('.gcsp-tile[data-band="true"] .gcsp-tile-figure')), '<5');
  assert.ok(group.querySelector('.gcsp-tile-note'));
  assert.ok(group.querySelectorAll('table').length >= 2);
  assert.ok(group.querySelector('td[data-band="true"]'));
  assert.ok(group.querySelector('.gcsp-table-empty'));
  assert.ok(group.querySelector('.gcsp-table-wrap.is-compare .gcsp-table-th-sub')); assert.ok(root.querySelector('.vm-facts.vm-facts-pair'));
  assert.ok(read('components.html').includes('blocks/gcsp/kit/gcsp-kit.css')); assert.ok(read('components.html').includes('blocks/gcsp/kit/data-table-compare.css'));
  const doc = read('COMPONENTS.md');
  assert.match(doc, /metricTile/);
  assert.match(doc, /dataTable/);
  const ratchet = JSON.parse(read('server/test/ui-ratchet.json'));
  for (const path of ['blocks/gcsp/kit/gcsp-kit.css', 'blocks/gcsp/kit/data-table-compare.css']) {
    const entry = ratchet.stylesheets.find((s) => s.path === path);
    assert.ok(entry, path);
    assert.equal(entry.max_lines, read(path).split('\n').length, path);
  }
});

