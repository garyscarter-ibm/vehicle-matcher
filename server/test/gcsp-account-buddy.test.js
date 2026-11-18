import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://account.test/', pretendToBeVisual: true });
for (const name of ['document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) globalThis[name] = dom.window[name];
after(() => dom.window.close());
const find = (root, label) => [...root.querySelectorAll('button')].find((node) => node.textContent === label);

test('the shared gallery includes all eight Buddy tile outcomes without issuing commands', async () => {
  const { buddyTileExamples } = await import('../../blocks/gcsp/kit/buddy-tile-gallery.js');
  const gallery = buddyTileExamples();
  assert.deepEqual([...gallery.querySelectorAll('[data-buddy-tile-example]')].map((node) => node.dataset.buddyTileExample),
    ['active', 'paused', 'unset', 'held', 'unavailable', 'finished', 'inactive', 'loading']);
  assert.equal(gallery.querySelectorAll('.gcsp-buddy-tile').length, 8);
  assert.equal(find(gallery.querySelector('[data-buddy-tile-example=paused]'), 'Resume search').disabled, true);
});
