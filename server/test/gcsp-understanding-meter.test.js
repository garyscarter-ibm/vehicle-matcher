import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom; let understandingMeter;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'Event']) {
    Object.defineProperty(globalThis, name, { value: name === 'window' ? dom.window : dom.window[name], configurable: true, writable: true });
  }
  ({ understandingMeter } = await import('../../blocks/gcsp/kit/understanding-meter.js'));
});
after(() => dom.window.close());

const filled = (view) => [...view.root.querySelectorAll('.gcsp-understanding-meter i')].filter((n) => n.classList.contains('is-filled')).length;
const figure = (view) => view.root.querySelector('.gcsp-understanding-value');

test('shows n / max, eleven aria-hidden segments and a spoken name at 1, 6 and 11', () => {
  for (const value of [1, 6, 11]) {
    const view = understandingMeter({ id: `m${value}`, value, maximum: 11 });
    assert.equal(figure(view).textContent, `${value} / 11`);
    assert.equal(figure(view).getAttribute('aria-label'), `Buddy understanding ${value} out of 11`);
    assert.equal(view.root.querySelectorAll('.gcsp-understanding-meter i').length, 11);
    assert.equal(view.root.querySelector('.gcsp-understanding-meter').getAttribute('aria-hidden'), 'true');
    assert.equal(filled(view), value);
    assert.equal(view.root.dataset.kind, 'input-completeness'); assert.equal(view.root.hasAttribute('role'), false);
    assert.equal(view.root.querySelector('.gcsp-understanding-label').textContent, 'Buddy understanding');
  }
});

test('update repaints in place, and pending adds (saving) without changing the figure', () => {
  const view = understandingMeter({ id: 'm', value: 3, maximum: 11 });
  const node = figure(view);
  view.update({ value: 6, maximum: 11, pending: true });
  assert.equal(figure(view), node); assert.equal(node.textContent, '6 / 11'); assert.equal(filled(view), 6);
  assert.equal(node.getAttribute('aria-label'), 'Buddy understanding 6 out of 11 (saving)');
  assert.ok(view.root.classList.contains('is-pending'));
  view.update({ value: 6, maximum: 11, pending: true, failed: true });
  assert.equal(node.getAttribute('aria-label'), 'Buddy understanding 6 out of 11 (not saved)');
  view.update({ value: 6, maximum: 11, pending: false, failed: true });
  assert.equal(node.getAttribute('aria-label'), 'Buddy understanding 6 out of 11', 'failed only reads while the figure is unconfirmed'); assert.ok(!view.root.classList.contains('is-pending'));
});

test('clamps to the range, needs an id, and never uses confidence, probability or fit words', () => {
  const view = understandingMeter({ id: 'm', value: 40, maximum: 11 });
  assert.equal(figure(view).textContent, '11 / 11');
  view.update({ value: -2, maximum: 11 }); assert.equal(figure(view).textContent, '0 / 11');
  assert.throws(() => understandingMeter({}), TypeError);
  assert.doesNotMatch(view.root.outerHTML, /confidence|probabilit|\bfit\b/i);
});
