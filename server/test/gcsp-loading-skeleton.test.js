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
