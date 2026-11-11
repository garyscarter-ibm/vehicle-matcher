// loadingSkeleton (kit): page-shaped placeholder with one status line for assistive tech.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<body></body>'); globalThis.document = dom.window.document;
const { loadingSkeleton } = await import('../../blocks/gcsp/kit/loading-skeleton.js');

test('one status line, hidden shapes and a busy root', () => {
  const root = loadingSkeleton({ label: 'Loading your account and cars.' });
  const status = root.querySelectorAll('[role="status"]');
  assert.equal(status.length, 1); assert.equal(status[0].textContent, 'Loading your account and cars.');
  assert.equal(root.getAttribute('aria-busy'), 'true');
  assert.equal(root.querySelector('.gcsp-skeleton-shapes').getAttribute('aria-hidden'), 'true');
  assert.equal(root.querySelector('.gcsp-skeleton-shapes').textContent, '', 'shapes carry no text');
});
test('each layout draws its own shape, unknown layouts fall back to page, role null leaves the line plain', () => {
  assert.ok(loadingSkeleton({ layout: 'page' }).querySelector('.gcsp-skeleton-media'));
  assert.equal(loadingSkeleton({ layout: 'form' }).querySelectorAll('.gcsp-skeleton-panel').length, 2);
  assert.equal(loadingSkeleton({ layout: 'timeline' }).querySelector('.gcsp-skeleton-media'), null);
  assert.equal(loadingSkeleton({ layout: 'nope' }).dataset.layout, 'page');
  assert.equal(loadingSkeleton({ role: null }).querySelector('[role]'), null);
});
test('the sweep stops for reduced motion through the shell rule, and the shell imports the sheet', () => {
  const shell = readFileSync(new URL('../../blocks/gcsp/shell/gcsp-shell.css', import.meta.url), 'utf8');
  assert.match(shell, /@import "\.\.\/kit\/loading-skeleton\.css";/);
  assert.match(shell, /prefers-reduced-motion: reduce\)\s*{\s*\.gcsp \*[^}]*animation: none !important/);
});

test('the console layout draws a heading, buttons, a panel and rows, with one status line', () => {
  const root = loadingSkeleton({ label: 'Loading the presenter console', layout: 'console' });
  assert.equal(root.dataset.layout, 'console'); assert.equal(root.querySelectorAll('.gcsp-skeleton-actions .gcsp-skeleton-button').length, 2);
  assert.ok(root.querySelector('.gcsp-skeleton-panel')); assert.ok(root.querySelector('.gcsp-skeleton-rows')); assert.equal(root.querySelectorAll('[role="status"]').length, 1);
  assert.equal(loadingSkeleton({ layout: 'section', role: null }).dataset.layout, 'section');
});

test('the feature layout is Your cars: a title, one full-bleed car panel, a panel and rows', () => {
  const root = loadingSkeleton({ layout: 'feature' });
  assert.equal(root.dataset.layout, 'feature');
  const feature = root.querySelector('.gcsp-skeleton-feature');
  assert.ok(feature?.classList.contains('gcsp-skeleton-card')); assert.ok(feature.querySelector('.gcsp-skeleton-media'));
  assert.equal(root.querySelectorAll('.gcsp-skeleton-panel').length, 1); assert.equal(root.querySelectorAll('.gcsp-skeleton-rows').length, 1);
});

test('release layouts mirror car tiles, labelled counters and label/bar/count rows without live announcements', () => {
  const cars = loadingSkeleton({ layout: 'release-grid', items: 8, role: null });
  assert.equal(cars.querySelectorAll('.gcsp-release-tile').length, 8); assert.equal(cars.querySelector('[tabindex],[role]'), null);
  const stats = loadingSkeleton({ layout: 'stats', labels: ['Latest release', 'Total released'], role: null });
  assert.deepEqual([...stats.querySelectorAll('.vm-fact-label')].map((node) => node.textContent), ['Latest release', 'Total released']);
  assert.equal(stats.querySelectorAll('.gcsp-skeleton-stat-value').length, 2);
  const bars = loadingSkeleton({ layout: 'bars', items: 4, role: null });
  assert.equal(bars.querySelectorAll('.gcsp-count-bars-row').length, 4);
  assert.ok([...bars.querySelectorAll('.gcsp-count-bars-row')].every((row) => row.children.length === 3));
  for (const root of [cars, stats, bars]) { assert.equal(root.querySelector('.gcsp-skeleton-shapes').getAttribute('aria-hidden'), 'true'); assert.equal(root.querySelector('[role="status"]'), null); }
});
