import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
let dom; let activityOffer;
before(async () => { dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true }); globalThis.document = dom.window.document;
  ({ activityOffer } = await import('../../blocks/gcsp/activity/activity-offer.js')); });
after(() => dom?.window.close()); beforeEach(() => document.body.replaceChildren());
const picture = { src: '/assets/brand-hero/bmw.jpg', alt: 'BMW brand scene', kind: 'representative' };
test('no offer and absent imagery stay meaningful; untrusted network sources never become images', () => {
  const none = activityOffer(); assert.match(none.textContent, /No current offer/); assert.equal(none.querySelector('img'), null);
  const bad = activityOffer({ offer: { state: 'active' }, display: { title: 'BMW offer', images: [{ ...picture, src: 'https://remote.example/car.jpg' }] } });
  assert.equal(bad.querySelector('img'), null); assert.match(bad.textContent, /Image unavailable/); assert.match(bad.textContent, /Active/);
  const falseExact = activityOffer({ offer: { state: 'active' }, display: { images: [{ ...picture, kind: 'exact' }] } });
  assert.equal(falseExact.querySelector('img'), null); assert.match(falseExact.textContent, /Image unavailable/);
});
test('multiple representative images use native controls; failed image removes false alt/caption without losing offer facts', () => {
  const display = { title: 'Synthetic BMW offer', images: [picture, { ...picture }] };
  const original = structuredClone(display); const node = activityOffer({ offer: { state: 'active' }, display }); document.body.append(node);
  assert.match(node.textContent, /Representative BMW brand image/); assert.equal(node.querySelectorAll('[data-image]').length, 2);
  const second = node.querySelector('[data-image="1"]'); second.focus(); second.click();
  assert.equal(document.activeElement, second); assert.equal(second.getAttribute('aria-pressed'), 'true');
  assert.equal(node.querySelector('img').alt, picture.alt);
  node.querySelector('img').dispatchEvent(new dom.window.Event('error'));
  assert.equal(node.querySelector('img'), null); assert.equal(node.querySelector('.vm-media-caption'), null);
  assert.match(node.textContent, /Synthetic BMW offer/); assert.match(node.textContent, /Image unavailable/); assert.deepEqual(display, original);
});
