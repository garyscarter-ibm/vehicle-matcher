// The live Order progress page script run over a DOM and a fetch double: the accepted car comes from the order read.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { orderProgressFixtures } from '../../blocks/gcsp/order-progress/fixtures.js';

const { states } = orderProgressFixtures();
const fixture = states['appointment-requested'];
const orderUuid = fixture.stages.value.orderUuid;
const NAME = 'Synthetic 3 Series Saloon 320i';
const dom = new JSDOM('<!doctype html><body><gcsp-order-progress brand="bmw" data-live></gcsp-order-progress></body>', { url: 'https://example.test/', pretendToBeVisual: true });
const { window } = dom;
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'location']) Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
globalThis.addEventListener = window.addEventListener.bind(window);
after(() => window.close());

const reply = (body) => ({ ok: body.status === 'ok', json: async () => structuredClone(body) });
const routes = (order) => ({
  '/api/gcsp/manual/account': { status: 'ok', value: { state: 'ready', account: { name: 'Paula (synthetic)' }, actions: [] } },
  '/api/gcsp/orders/progress/all': { status: 'ok', value: { orders: [{ orderUuid, source: { receivedAt: '2026-11-05T09:00:00.000Z' } }] } },
  '/api/gcsp/orders/progress': fixture.stages, '/api/gcsp/documents': fixture.documents,
  '/api/gcsp/appointments': fixture.appointment, '/api/gcsp/return-plan': fixture.returnPlan,
  '/api/gcsp/manual/order': order,
});
const withFetch = (table) => { globalThis.fetch = async (url) => reply(table[String(url).split('?')[0]] ?? { status: 'unavailable' }); };
const load = (order, tag) => { window.document.body.replaceChildren(); const host = window.document.createElement('gcsp-order-progress');
  host.setAttribute('brand', 'bmw'); host.dataset.live = ''; window.document.body.append(host); withFetch(routes(order)); return import(`../../blocks/gcsp/order-progress/live.js?${tag}`).then(() => host); };
const carName = async (host) => { for (let i = 0; i < 200; i += 1) { const node = host.querySelector('.gcsp-order-car-name'); if (node) return node.textContent; await new Promise((r) => setTimeout(r, 10)); } return null; };

test('the live page shows the accepted car from the order read', async () => {
  const host = await load({ status: 'ok', value: { selection: { stock: { orderUuid, orderNumber: '1', facts: { display: { name: NAME } } } } } }, 'ok');
  assert.equal(await carName(host), NAME);
  assert.doesNotMatch(host.textContent, /Car details not supplied/);
});

test('a failed order read still renders progress with the not supplied line', async () => {
  const host = await load({ status: 'unavailable' }, 'failed');
  assert.equal(await carName(host), 'Car details not supplied');
  assert.match(host.textContent, /Order progress/);
});

test('another order\'s car is never shown', async () => {
  const host = await load({ status: 'ok', value: { selection: { stock: { orderUuid: 'other-order', facts: { display: { name: NAME } } } } } }, 'other');
  assert.equal(await carName(host), 'Car details not supplied');
});
