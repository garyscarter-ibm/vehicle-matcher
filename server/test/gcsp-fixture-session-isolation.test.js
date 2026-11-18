import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://gcsp.test/' });
  for (const key of ['window', 'document', 'location', 'HTMLElement', 'customElements', 'CustomEvent', 'Node', 'DOMException']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true, writable: true });
  }
});
beforeEach(() => document.body.replaceChildren());
after(() => dom.window.close());

test('component gallery account examples have no live sign-out action in any state', async () => {
  const { mountComponentGallery } = await import('../../blocks/vehicle-matcher/component-gallery.js');
  const root = document.createElement('div'); document.body.append(root); mountComponentGallery(root);
  assert.equal(root.querySelectorAll('.gcsp-header').length, 4);
  assert.equal(root.querySelectorAll('.gcsp-account-details').length, 2);
  assert.equal(root.querySelector('.gcsp-account-signout'), null);
});
