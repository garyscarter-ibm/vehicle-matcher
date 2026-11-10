// FUCQ-332: "Check current state" shows pending, then unchanged, changed or failed feedback.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createOfferView } from '../../blocks/gcsp/offer/offer-view.js';
import { offerFixture } from '../../blocks/gcsp/offer/fixtures.js';
import { createOfferController } from '../../blocks/gcsp/offer/offer-controller.js';

let dom;
before(() => { dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.HTMLElement = dom.window.HTMLElement;
});
after(() => dom.window.close());
beforeEach(() => document.body.replaceChildren());

// A read port the test answers by hand, so the pending moment can be observed.
function mount(first, links) {
  let answer = first; let gate = null;
  const read = async () => { if (gate) await gate.promise; return typeof answer === 'function' ? answer() : answer; };
  const root = document.createElement('div'); document.body.append(root);
  const c = createOfferController({ read });
  const view = createOfferView(root, { refresh: () => c.refresh(), links }); const unsubscribe = c.subscribe(view.update);
  const line = () => root.querySelector('[data-offer-check]');
  const live = () => root.querySelector('[data-offer-announcement]');
  const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
  const press = async () => {
    let open; gate = { promise: new Promise((resolve) => { open = resolve; }) };
    const control = root.querySelector('[data-offer-action="refresh"]'); control.focus(); control.click();
    const pendingText = line()?.textContent; const pendingHidden = line()?.hidden;
    gate = null; open(); await settle(); await settle();
    return { pendingText, pendingHidden };
  };
  return { root, c, set: (next) => { answer = next; }, press, line, live, done: () => { unsubscribe(); c.destroy(); view.destroy(); root.remove(); } };
}
const fixture = (name, change = () => {}) => { const value = offerFixture(name); change(value.value); return value; };

test('an unchanged offer shows pending, then confirms the check finished without implying an action', async () => {
  const m = mount(fixture('expired')); await m.c.refresh();
  assert.equal(m.line()?.hidden, true, 'no check line before the first check');
  const { pendingText, pendingHidden } = await m.press();
  assert.equal(pendingText, 'Checking the current offer state.'); assert.equal(pendingHidden, false);
  assert.equal(m.line().textContent, 'Check complete. Nothing has changed.'); assert.equal(m.line().hidden, false);
  assert.equal(m.live().textContent, 'Check complete. Nothing has changed.');
  assert.doesNotMatch(m.line().textContent, /accepted|declined|sent|recorded/i);
  assert.equal(document.activeElement.dataset.offerAction, 'refresh', 'focus stays on the check control');
  assert.equal(m.root.querySelectorAll('[role="status"]').length, 1, 'one live region per view');
  await m.press(); assert.equal(m.live().textContent, 'Check complete. Nothing has changed.', 'a second check is announced again');
  m.done();
});

test('a check that finds the offer accepted names the new state and keeps the onward links', async () => {
  const m = mount(fixture('pending'), { orderProgress: '/gcsp-order.html', cars: '/gcsp-account.html' }); await m.c.refresh();
  m.set(fixture('selection-hr')); await m.press();
  assert.equal(m.root.querySelector('h1').textContent, 'Offer accepted');
  assert.equal(m.line().textContent, 'Check complete. Current state: accepted.');
  assert.equal(m.live().textContent, 'Check complete. Current state: accepted.');
  assert.deepEqual([...m.root.querySelectorAll('.gcsp-offer-actions .vm-btn')].map((b) => b.textContent), ['Track your order', 'Back to Your cars']);
  assert.equal(document.activeElement.dataset.offerAction, 'refresh');
  m.done();
});

test('a check that finds the offer expired names it and keeps the next step', async () => {
  const m = mount(fixture('pending')); await m.c.refresh();
  m.set(fixture('expired')); await m.press();
  assert.equal(m.root.querySelector('h1').textContent, 'Offer expired');
  assert.equal(m.line().textContent, 'Check complete. Current state: expired.');
  assert.match(m.root.textContent, /Open your account to check for a new offer\./);
  m.done();
});

test('a check that finds the offer declined names it, with no second decision control', async () => {
  const m = mount(fixture('pending')); await m.c.refresh();
  m.set(fixture('declined')); await m.press();
  assert.equal(m.line().textContent, 'Check complete. Current state: declined.');
  assert.equal(m.root.querySelector('[data-offer-action="accept"], [data-offer-action="decline"]'), null);
  m.done();
});

test('a changed detail on the same offer says the details were updated', async () => {
  const m = mount(fixture('pending')); await m.c.refresh();
  m.set(fixture('pending', (v) => { v.card.members[0].display.line = 'Order no. 0123457'; })); await m.press();
  assert.equal(m.line().textContent, 'Check complete. The offer details have been updated.');
  m.done();
});

test('a failed readback shows an error with Try again, and the retry reports the state it finds', async () => {
  const m = mount(fixture('pending')); await m.c.refresh();
  m.set({ status: 'unavailable' }); await m.press();
  assert.equal(m.root.querySelector('h1').textContent, 'Your offer could not be loaded');
  assert.equal(m.line().textContent, 'Check not completed. Try again in a moment.');
  assert.equal(m.live().textContent, 'Check not completed. Try again in a moment.');
  assert.equal(m.root.querySelector('[data-offer-action="refresh"]').textContent, 'Try again');
  assert.equal(document.activeElement.textContent, 'Try again');
  m.set(() => { throw new Error('offline'); }); await m.press();
  assert.equal(m.line().textContent, 'Check not completed. Try again in a moment.');
  m.set(fixture('pending')); await m.press();
  assert.equal(m.root.querySelector('h1').textContent, 'Your car offer');
  assert.equal(m.line().textContent, 'Check complete. Current state: open for your decision.');
  m.done();
});

test('a background read clears an old check result and never shows the check line', async () => {
  const m = mount(fixture('pending')); await m.c.refresh();
  await m.press(); assert.equal(m.line().hidden, false);
  m.set(fixture('expired')); await m.c.refresh();
  assert.equal(m.line().hidden, true); assert.equal(m.live().textContent, 'Offer expired');
  m.done();
});
