import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
let dom; let actionMenu;
before(async () => {
  dom = new JSDOM('<!doctype html><body><button id="outside">Outside</button></body>', { pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  ({ actionMenu } = await import('../../blocks/gcsp/kit/action-menu.js'));
});
after(() => dom?.window.close());
beforeEach(() => document.querySelectorAll('.gcsp-action-menu').forEach((node) => node.destroy()));
const key = (node, value) => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));

test('menu has a named three-dot trigger, keyboard items, Escape and restored focus', () => {
  let selected = 0;
  const { root, trigger } = actionMenu({ label: 'Search actions', items: [{ label: 'Pause Search', onSelect: () => { selected += 1; } }, { label: 'Other action' }] });
  document.body.append(root); trigger.focus(); key(trigger, 'ArrowDown');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'menu'); assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const items = root.querySelectorAll('[role="menuitem"]'); assert.equal(document.activeElement, items[0]);
  key(items[0], 'ArrowDown'); assert.equal(document.activeElement, items[1]);
  key(items[1], 'Home'); assert.equal(document.activeElement, items[0]);
  key(items[0], 'Escape'); assert.equal(trigger.getAttribute('aria-expanded'), 'false'); assert.equal(document.activeElement, trigger);
  trigger.click(); items[0].click(); assert.equal(selected, 1); assert.equal(document.activeElement, trigger);
  root.destroy();
});

test('disabled menu action explains its limit; outside dismissal and teardown release document handlers', () => {
  let calls = 0;
  const { root, trigger } = actionMenu({ items: [{ label: 'Resume Search', disabled: true, reason: 'Preview only', onSelect: () => { calls += 1; } }] });
  document.body.append(root); trigger.click();
  const item = root.querySelector('[role="menuitem"]'); assert.equal(item.getAttribute('aria-disabled'), 'true');
  assert.match(document.getElementById(item.getAttribute('aria-describedby')).textContent, /Preview only/);
  item.click(); assert.equal(calls, 0); assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  document.getElementById('outside').dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false'); assert.equal(document.activeElement, trigger);
  trigger.click(); root.destroy(); root.destroy(); assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});
