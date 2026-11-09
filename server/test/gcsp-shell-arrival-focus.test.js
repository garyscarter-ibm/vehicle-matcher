// FUCQ-280: arrival focus on the page h1, and a ring on script-focused headings only after keyboard input.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installDom, resetDom, settle } from './dom-harness.js';
import { activityFixtures } from '../../blocks/gcsp/activity/activity-fixtures.js';

let dom; let shellMod; let emp; let kit;
const cleanups = [];
const QUIET = 'data-gcsp-quiet-focus';
const account = { status: 'ready', name: 'Paula (synthetic)', context: 'Synthetic' };
const root = () => { const node = document.createElement('div'); document.body.append(node); return node; };
const press = (key) => document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
const click = () => document.body.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
const heading = (text) => { const h = document.createElement('h1'); h.textContent = text; return h; };

before(async () => {
  dom = installDom();
  shellMod = await import('../../blocks/gcsp/shell/portal-shell.js');
  emp = await import('../../blocks/gcsp/employee/gcsp-employee.js');
  kit = await import('../../blocks/gcsp/kit/arrival-focus.js');
});
after(() => { cleanups.splice(0).forEach((c) => c()); dom.window.close(); });
beforeEach(() => { cleanups.splice(0).forEach((c) => c()); resetDom(); });

function employee(renderBody) {
  const node = root();
  cleanups.push(emp.mountEmployee(node, { loadAccount: async () => account, renderBody }));
  return node;
}

test('arrival on a mountEmployee page puts focus on the h1, quietly', async () => {
  const node = employee((main) => { main.replaceChildren(heading('Your cars')); });
  await settle(node, (r) => document.activeElement === r.querySelector('main h1'), { timeout: 800 });
  const h1 = node.querySelector('main h1');
  assert.equal(document.activeElement, h1);
  assert.equal(h1.hasAttribute(QUIET), true);
});

test('arrival waits for a late h1 and survives a repaint before any input', async () => {
  const node = employee((main) => { main.replaceChildren(heading('One')); setTimeout(() => main.replaceChildren(heading('Two')), 20); });
  await settle(node, (r) => r.querySelector('main h1')?.textContent === 'Two');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(document.activeElement, node.querySelector('main h1'));
});

test('arrival on the offer leaves focus on the h1', async () => {
  const { mountOffer } = await import('../../blocks/gcsp/offer/gcsp-offer.js');
  const { offerFixture } = await import('../../blocks/gcsp/offer/fixtures.js');
  const node = root();
  cleanups.push(mountOffer(node, { account, read: async () => offerFixture('pending') }));
  await settle(node, (r) => r.querySelector('main h1')?.textContent === 'Your car offer' && document.activeElement === r.querySelector('main h1'), { timeout: 800 });
  assert.equal(document.activeElement, node.querySelector('main h1'));
});

test('arrival on the car brief leaves focus on the h1', async () => {
  const { mountBrief } = await import('../../blocks/gcsp/brief/gcsp-brief.js');
  const fixture = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq94/representative-snapshot.json', import.meta.url)));
  const node = root();
  const transport = { preview: async () => fixture.preview, saveDraft: async () => ({ status: 'unavailable' }), confirm: async () => ({ status: 'unavailable' }) };
  cleanups.push(mountBrief(node, { loadAccount: async () => account, transport, loadEditor: async () => ({ status: 'ok', value: fixture.edited.value }) }));
  await settle(node, (r) => document.activeElement === r.querySelector('main h1'), { timeout: 800 });
  assert.equal(document.activeElement, node.querySelector('main h1'));
});

test('a brief reload started from Try again lands on the new h1', async () => {
  const { mountBrief } = await import('../../blocks/gcsp/brief/gcsp-brief.js');
  const fixture = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq94/representative-snapshot.json', import.meta.url)));
  const node = root(); let reads = 0;
  const transport = { preview: async () => fixture.preview, saveDraft: async () => ({ status: 'unavailable' }), confirm: async () => ({ status: 'unavailable' }) };
  cleanups.push(mountBrief(node, { loadAccount: async () => account, transport,
    loadEditor: async () => (++reads === 1 ? { status: 'unavailable' } : { status: 'ok', value: fixture.edited.value }) }));
  await settle(node, (r) => r.querySelector('main .vm-status button'));
  press('Enter');
  node.querySelector('main .vm-status button').focus();
  node.querySelector('main .vm-status button').click();
  await settle(node, (r) => r.querySelector('main h1') && document.activeElement === r.querySelector('main h1'), { timeout: 800 });
});

test('arrival on buddy activity lands on the h1 and a quiet refresh does not move it to a control', async () => {
  const { mountActivity } = await import('../../blocks/gcsp/activity/gcsp-activity.js');
  const node = root();
  const stop = mountActivity(node, { adapter: { loadAccount: async () => account, readActivity: async () => structuredClone(activityFixtures.snapshots['never-checked']) } });
  cleanups.push(stop);
  await settle(node, (r) => r.querySelector('.gcsp-action-trigger') && document.activeElement === r.querySelector('main h1'), { timeout: 800 });
  assert.equal(document.activeElement, node.querySelector('main h1'));
  await stop.refresh();
  assert.equal(document.activeElement, node.querySelector('main h1'));
});

test('script heading focus with no input or pointer input is quiet; after a keydown it is not', () => {
  const shell = shellMod.portalShell({});
  document.body.append(shell.root);
  cleanups.push(shell.destroy);
  const first = heading('First'); const second = heading('Second');
  shell.main.append(first, second);
  kit.focusHeading(first);
  assert.equal(document.activeElement, first);
  assert.equal(first.hasAttribute(QUIET), true, 'no input yet');
  click();
  kit.focusHeading(second);
  assert.equal(second.hasAttribute(QUIET), true, 'pointer input');
  assert.equal(first.hasAttribute(QUIET), false, 'marker leaves with focus');
  press('Shift');
  kit.focusHeading(first);
  assert.equal(first.hasAttribute(QUIET), true, 'a lone modifier is not keyboard use');
  press('Tab');
  assert.equal(first.hasAttribute(QUIET), false, 'a key press while focused brings the ring back');
  kit.focusHeading(second);
  assert.equal(second.hasAttribute(QUIET), false, 'keyboard input');
});

test('a focused control is never stolen when main repaints', async () => {
  const node = employee((main) => { const b = document.createElement('button'); b.textContent = 'Act'; main.replaceChildren(b); b.focus(); });
  await settle(node, (r) => r.querySelector('main button'));
  const button = node.querySelector('main button');
  assert.equal(document.activeElement, button);
  node.querySelector('main').append(heading('Late'));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(document.activeElement, button);
});

test('arrival stops after the first user input', async () => {
  const node = employee((main) => { const p = document.createElement('p'); p.textContent = 'Loading'; main.replaceChildren(p); });
  await settle(node, (r) => r.querySelector('main p'));
  press('a');
  node.querySelector('main').append(heading('Late'));
  await new Promise((r) => setTimeout(r, 20));
  assert.notEqual(document.activeElement, node.querySelector('main h1'));
});

test('destroy removes the listeners and the observer', () => {
  const shell = shellMod.portalShell({ arrivalFocus: true });
  document.body.append(shell.root);
  shell.destroy();
  const h = heading('Gone'); document.body.append(h);
  kit.focusHeading(h);
  assert.equal(h.hasAttribute(QUIET), false);
});

test('the kit stylesheet keeps the keyboard ring and removes the script one', async () => {
  const css = await readFile(new URL('../../blocks/gcsp/kit/arrival-focus.css', import.meta.url), 'utf8');
  assert.match(css, /\[data-gcsp-quiet-focus\]:focus\s*\{\s*outline:\s*none/);
  assert.match(css, /:is\(h1, h2, h3\)\[tabindex="-1"\]:focus:not\(:focus-visible\)/);
  assert.match(css, /\[tabindex\]:focus-visible\s*\{[^}]*outline:\s*2px solid/);
});
