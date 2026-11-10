import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let dom; let mod;
before(async () => {
  dom = new JSDOM('<!doctype html><body class="gcsp"></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement']) globalThis[name] = name === 'window' ? dom.window : dom.window[name];
  mod = await import('../../blocks/gcsp/kit/release-grid.js');
});
beforeEach(() => document.body.replaceChildren());
after(() => dom.window.close());
const tiles = (n) => Array.from({ length: n }, (_, at) => ({ id: `car-${at}`, imageSrc: `/img/${at}.webp`, label: `Model ${at}, Colour ${at}` }));
const all = (srcs) => Promise.resolve(new Set(srcs));
const still = () => ({ matches: false }); const calm = () => ({ matches: true });
const key = (node, name, extra = {}) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, ...extra }));
const cellsOf = (grid) => [...grid.root.querySelectorAll('[role="gridcell"]')];
const mount = (options = {}) => { const grid = mod.releaseGrid({ preload: all, matchMedia: calm, ...options }); document.body.append(grid.root); return grid; };

test('a grid of rows and labelled cells with one tab stop', async () => {
  const grid = mount({ columns: 4, label: 'Released cars' }); await grid.show(tiles(10), { animate: false });
  assert.equal(grid.root.getAttribute('role'), 'grid'); assert.equal(grid.root.getAttribute('aria-label'), 'Released cars');
  assert.equal(grid.root.style.getPropertyValue('--gcsp-release-columns'), '4');
  const rows = [...grid.root.querySelectorAll('[role="row"]')]; assert.deepEqual(rows.map((row) => row.children.length), [4, 4, 2]);
  const cells = cellsOf(grid); assert.equal(cells.length, 10);
  assert.equal(cells[3].getAttribute('aria-label'), 'Model 3, Colour 3'); assert.equal(cells[3].querySelector('img').getAttribute('alt'), '');
  assert.deepEqual(cells.map((cell) => cell.tabIndex).filter((n) => n === 0).length, 1); assert.equal(cells[0].tabIndex, 0);
  assert.equal(grid.root.hasAttribute('aria-busy'), false);
  const tip = grid.root.querySelector('.gcsp-release-tip'); assert.equal(tip.getAttribute('aria-hidden'), 'true');
  grid.destroy();
});

test('arrow, Home, End and Ctrl keys move focus and clamp at the edges', async () => {
  const grid = mount({ columns: 4 }); await grid.show(tiles(10), { animate: false }); const cells = cellsOf(grid);
  const press = (name, extra) => { key(document.activeElement, name, extra); return cells.indexOf(document.activeElement); };
  cells[0].focus(); assert.equal(press('ArrowLeft'), 0); assert.equal(press('ArrowUp'), 0);
  assert.equal(press('ArrowRight'), 1); assert.equal(press('ArrowDown'), 5); assert.equal(press('ArrowDown'), 9);
  assert.equal(press('ArrowDown'), 9); assert.equal(press('ArrowRight'), 9); assert.equal(press('ArrowUp'), 5);
  assert.equal(press('ArrowLeft'), 4); assert.equal(press('Home'), 4); assert.equal(press('End'), 7);
  assert.equal(press('Home', { ctrlKey: true }), 0); assert.equal(press('End', { ctrlKey: true }), 9);
  assert.equal(press('Home'), 8); assert.equal(press('End'), 9);
  assert.equal(cells.filter((cell) => cell.tabIndex === 0).length, 1); assert.equal(cells[9].tabIndex, 0);
  grid.destroy();
});

test('the tip shows the focused tile label, and focus inside moves to the new first tile on re-render', async () => {
  const grid = mount({ columns: 4 }); await grid.show(tiles(6), { animate: false });
  cellsOf(grid)[2].focus(); const tip = grid.root.querySelector('.gcsp-release-tip');
  assert.equal(tip.hidden, false); assert.equal(tip.textContent, 'Model 2, Colour 2');
  await grid.show(tiles(3), { animate: false }); assert.equal(document.activeElement, cellsOf(grid)[0]);
  document.activeElement.blur(); await grid.show(tiles(3), { animate: false }); assert.equal(document.body.contains(document.activeElement) && grid.root.contains(document.activeElement), false);
  grid.destroy();
});

test('tiles stay out of the DOM, with aria-busy, until the preload resolves', async () => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const grid = mount({ preload: () => gate }); const shown = grid.show(tiles(5), { animate: false });
  await Promise.resolve(); assert.equal(grid.root.getAttribute('aria-busy'), 'true'); assert.equal(cellsOf(grid).length, 0);
  release(new Set(tiles(5).map((tile) => tile.imageSrc))); await shown;
  assert.equal(cellsOf(grid).length, 5); assert.equal(grid.root.hasAttribute('aria-busy'), false); grid.destroy();
});

test('a tile whose image did not load shows its label as text', async () => {
  const grid = mount({ preload: (srcs) => Promise.resolve(new Set(srcs.filter((src) => src !== '/img/1.webp'))) });
  await grid.show(tiles(3), { animate: false }); const cells = cellsOf(grid);
  assert.ok(cells[0].querySelector('img')); assert.equal(cells[1].querySelector('img'), null);
  assert.equal(cells[1].textContent, 'Model 1, Colour 1'); grid.destroy();
});

test('reduced motion puts every tile in its final state at once, with no delay', async () => {
  const grid = mount({ matchMedia: calm }); await grid.show(tiles(20));
  for (const cell of cellsOf(grid)) { assert.ok(cell.classList.contains('is-in')); assert.ok(!cell.classList.contains('is-queued')); assert.equal(cell.style.getPropertyValue('--gcsp-release-delay'), ''); }
  grid.destroy();
});

test('animate: false is final at once even when motion is allowed', async () => {
  const grid = mount({ matchMedia: still }); await grid.show(tiles(6), { animate: false });
  for (const cell of cellsOf(grid)) { assert.ok(cell.classList.contains('is-in')); assert.equal(cell.style.getPropertyValue('--gcsp-release-delay'), ''); }
  grid.destroy();
});

test('animated tiles get staggered delays that land the grid in about 1.2s', async () => {
  const grid = mount({ matchMedia: still }); const started = Date.now(); const done = grid.show(tiles(20));
  await new Promise((resolve) => setTimeout(resolve, 60)); const cells = cellsOf(grid);
  const delays = cells.map((cell) => parseInt(cell.style.getPropertyValue('--gcsp-release-delay'), 10));
  assert.equal(delays[0], 0); assert.ok(delays.every((ms, at) => at === 0 || ms > delays[at - 1]));
  assert.ok(delays[19] + 350 >= 1150 && delays[19] + 350 <= 1250, String(delays[19]));
  assert.ok(cells.every((cell) => cell.classList.contains('is-in'))); assert.equal(grid.root.hasAttribute('aria-busy'), false);
  await done; assert.ok(Date.now() - started >= 1100); grid.destroy();
});

test('a newer show or clear cancels an older pending one', async () => {
  const gates = []; const grid = mount({ preload: () => new Promise((resolve) => gates.push(resolve)) });
  const first = grid.show(tiles(3), { animate: false }); const second = grid.show(tiles(5), { animate: false });
  await Promise.resolve(); gates[0](new Set()); await first; assert.equal(cellsOf(grid).length, 0);
  gates[1](new Set()); await second; assert.equal(cellsOf(grid).length, 5);
  const third = grid.show(tiles(2), { animate: false }); await Promise.resolve(); grid.clear(); gates[2](new Set()); await third;
  assert.equal(cellsOf(grid).length, 0); assert.equal(grid.root.hasAttribute('aria-busy'), false); grid.destroy();
});

test('the kit stylesheet is scoped, token-only and has a reduced-motion fallback', () => {
  const css = readFileSync(new URL('../../blocks/gcsp/kit/release-grid.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce/); assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|border-(left|right)\s*:/i);
  for (const line of css.split('\n').filter((row) => /^\.|^@media/.test(row))) assert.match(line, /^\.gcsp |^@media/);
  assert.doesNotMatch(readFileSync(new URL('../../blocks/gcsp/kit/release-grid.js', import.meta.url), 'utf8'), /eval\(|new Function|innerHTML/);
});
