import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let dom; let buddyEngagement;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'Event']) {
    Object.defineProperty(globalThis, name, { value: name === 'window' ? dom.window : dom.window[name], configurable: true, writable: true });
  }
  ({ buddyEngagement } = await import('../../blocks/gcsp/kit/buddy-engagement.js'));
});
after(() => dom.window.close());

test('states carry their meaning in words, with an aria-hidden lamp and no live region', () => {
  const cases = [['engaged', 'Buddy engaged'], ['disengaged', 'Buddy disengaged'], ['unknown', 'Buddy status unavailable'], ['nonsense', 'Buddy status unavailable']];
  for (const [state, text] of cases) {
    const view = buddyEngagement({ id: `b-${state}`, state });
    assert.equal(view.root.tagName, 'P'); assert.equal(view.root.id, `b-${state}`);
    assert.equal(view.root.textContent, text);
    assert.equal(view.root.querySelector('.gcsp-buddy-lamp').getAttribute('aria-hidden'), 'true');
    assert.equal(view.root.hasAttribute('role'), false); assert.equal(view.root.hasAttribute('aria-live'), false);
  }
});

test('update repaints in place and unknown never reads as engaged', () => {
  const view = buddyEngagement({ id: 'b' }); const root = view.root;
  assert.equal(root.dataset.state, 'unknown'); assert.ok(!root.classList.contains('is-engaged'));
  view.update('engaged'); assert.equal(view.root, root); assert.equal(root.textContent, 'Buddy engaged'); assert.ok(root.classList.contains('is-engaged'));
  view.update('disengaged'); assert.equal(root.textContent, 'Buddy disengaged'); assert.ok(!root.classList.contains('is-engaged'));
  assert.throws(() => buddyEngagement({}), TypeError);
});

test('the stylesheet is static: 18px lamp, no animation or transition, neutral unknown', () => {
  const css = readFileSync(new URL('../../blocks/gcsp/kit/buddy-engagement.css', import.meta.url), 'utf8');
  assert.match(css, /width: 18px; height: 18px/); assert.doesNotMatch(css, /animation|transition|@keyframes/);
  assert.match(css, /is-unknown \.gcsp-buddy-lamp \{ background: var\(--gcsp-text-muted\)/);
  assert.match(css, /is-engaged \.gcsp-buddy-lamp \{ background: var\(--gcsp-success\)/);
});
