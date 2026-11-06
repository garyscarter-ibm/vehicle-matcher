import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOfferHttpTransport, createOfferHttpAdapter } from '../../blocks/gcsp/offer/http-adapter.js';

const response = (value = { status: 'ok', value: { state: 'pending' } }, ok = true) => ({ ok,
  headers: { get: () => 'application/json; charset=utf-8' }, json: async () => value });
function setup(href, fetch = async () => response()) {
  const changes = []; const calls = [];
  const transport = createOfferHttpTransport({ location: { href }, history: { replaceState: (...args) => changes.push(args) },
    fetch: async (...args) => { calls.push(args); return fetch(...args); } });
  return { transport, changes, calls };
}

test('fragment is cleared synchronously; token travels only in one same-origin exchange body', async () => {
  const { transport, changes, calls } = setup('https://example.test/gcsp/offer?offerId=one&runId=run#token=synthetic-credential');
  assert.deepEqual(changes, [[null, '', '/gcsp/offer?offerId=one&runId=run']]);
  assert.equal(calls.length, 0);
  const result = await transport.read(); assert.equal(result.status, 'ok');
  assert.equal(calls[0][0], 'https://example.test/api/gcsp/offers/access');
  const options = calls[0][1];
  assert.deepEqual(JSON.parse(options.body), { offerId: 'one', runId: 'run', token: 'synthetic-credential' });
  assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer');
  assert.equal(JSON.stringify(transport).includes('synthetic-credential'), false);
  await transport.read(); assert.equal(calls[1][1].method, 'GET');
  assert.equal(calls[1][0], 'https://example.test/api/gcsp/offers/one?runId=run');
  assert.equal(calls[1][1].body, undefined);
});

test('failed exchange discards credential; refresh never resends its token', async () => {
  const { transport, calls } = setup('https://example.test/gcsp/offer?offerId=one&runId=run#token=synthetic-credential', async () => { throw new Error('network'); });
  const result = await transport.read(); assert.equal(result.status, 'unavailable'); assert.equal(result.accessExchange, 'failed');
  await transport.read(); assert.equal(calls.length, 2); assert.equal(calls[1][1].method, 'GET');
  assert.equal(calls[1][1].body, undefined);
});

test('account and reloaded email entries use exact GET locators without browser identity claims', async () => {
  for (const [query, expected] of [['offerId=one', '/api/gcsp/offers/one'], ['offerId=one&runId=old', '/api/gcsp/offers/one?runId=old']]) {
    const { transport, calls, changes } = setup(`https://example.test/gcsp/offer?${query}`);
    await transport.read(); assert.equal(calls[0][0], `https://example.test${expected}`); assert.equal(changes.length, 0);
  }
});

test('ambiguous locators, identity selectors, malformed fragments and insecure transport fail closed', async () => {
  for (const suffix of ['?offerId=one&offerId=two', '?offerId=one&employeeId=paula', '?offerId=one#token=credential',
    '?offerId=one&runId=run#token=one&token=two', '?offerId=one&runId=run#token=', '?offerId=one&runId=run#token=one&extra=value']) {
    const { transport, calls } = setup(`https://example.test/gcsp/offer${suffix}`);
    assert.equal((await transport.read()).status, 'not-found'); assert.equal(calls.length, 0);
  }
  const insecure = setup('http://example.test/gcsp/offer?offerId=one&runId=run#token=one');
  assert.equal((await insecure.transport.read()).status, 'not-found'); assert.equal(insecure.calls.length, 0);
});

test('failure to remove the fragment prevents token exchange', async () => {
  let calls = 0;
  const transport = createOfferHttpTransport({ location: { href: 'https://example.test/gcsp/offer?offerId=one&runId=run#token=one' },
    history: { replaceState() { throw new Error('unavailable'); } }, fetch: async () => { calls++; } });
  assert.equal((await transport.read()).status, 'not-found'); assert.equal(calls, 0);
});

test('typed refusals survive while malformed, non-JSON and HTTP success contradictions are unavailable', async () => {
  for (const status of ['stale-run', 'not-found', 'forbidden', 'pending', 'unavailable']) {
    const { transport } = setup('https://example.test/gcsp/offer?offerId=one', async () => response({ status }, false));
    assert.equal((await transport.read()).status, status);
  }
  for (const answer of [response({ status: 'ok', value: {} }, false), response({ status: 'ok' }), response({ status: 'anything' }),
    { ok: true, headers: { get: () => 'text/html' }, json: async () => ({ status: 'ok', value: {} }) }]) {
    const { transport } = setup('https://example.test/gcsp/offer?offerId=one', async () => answer);
    assert.equal((await transport.read()).status, 'unavailable');
  }
});

test('malformed successful DTO remains unavailable with the approved projection', async () => {
  const adapter = createOfferHttpAdapter({ location: { href: 'https://example.test/gcsp/offer?offerId=one' }, fetch: async () => response() });
  assert.equal((await adapter.read()).status, 'unavailable');
});

test('default HTTP display adapter binds the reviewed102 sample and retains exact locator/points', async () => {
  const value = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/representative-access.json', import.meta.url), 'utf8'));
  let method;
  const adapter = createOfferHttpAdapter({ location: { href: `https://example.test/gcsp/offer?offerId=${value.offerId}` },
    fetch: async (url, options) => { method = options.method; return response({ status: 'ok', value }); } });
  const result = await adapter.read(); assert.equal(result.status, 'ok'); assert.equal(method, 'GET');
  assert.equal(result.value.card.members[0].display.line, 'Order no. 0999987');
  assert.equal(result.value.card.members[0].terms[0].value, 1100);
  assert.equal(result.value.currentCar, null);
});

test('default HTTP adapter reads approved partial comparison without adding identity or decision authority', async () => {
  const value = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/comparison-access.json', import.meta.url), 'utf8'));
  const calls = [];
  const adapter = createOfferHttpAdapter({ location: { href: `https://example.test/gcsp/offer?offerId=${value.offerId}&runId=${value.runId}` },
    fetch: async (...args) => { calls.push(args); return response({ status: 'ok', value }); } });
  const result = await adapter.read(); assert.equal(result.status, 'ok');
  assert.equal(result.value.currentCar.display.name, value.comparison.currentCar.model);
  assert.deepEqual(result.value.currentCar.source, value.comparison.currentCar.source);
  assert.equal(result.value.comparisonAvailable, false); assert.equal(adapter.decide, undefined);
  assert.equal(calls[0][0], `https://example.test/api/gcsp/offers/${value.offerId}?runId=${value.runId}`);
  assert.equal(calls[0][1].method, 'GET'); assert.equal(calls[0][1].body, undefined);
});

test('published decline-only access DTO retains actions and exact pins; a later unavailable read returns no cached car', async () => {
  const value = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/producer-decline-access.json', import.meta.url), 'utf8'));
  let answer = response({ status: 'ok', value });
  const adapter = createOfferHttpAdapter({ location: { href: `https://example.test/gcsp/offer?offerId=${value.offerId}&runId=${value.runId}` },
    fetch: async () => answer });
  const current = await adapter.read(); assert.equal(current.status, 'ok');
  assert.deepEqual(current.value.actions, { accept: false, decline: true });
  assert.equal(current.value.reference.offerId, value.offerId); assert.equal(current.value.expiresAt, value.expiresAt);
  assert.equal(current.value.currentCar.source.observedAt, '2026-11-05T09:00:00.000Z'); assert.equal(adapter.decide, undefined);
  answer = response({ status: 'unavailable' }, false);
  assert.deepEqual(await adapter.read(), { status: 'unavailable' });
});

test('refresh scheduling requests server reads, skips busy requests and cancels without advancing time', async () => {
  const scheduled = new Map(); let nextId = 0; let events = 0; let resolveRead;
  const adapter = createOfferHttpAdapter({ location: { href: 'https://example.test/gcsp/offer?offerId=one' },
    schedule: (callback, milliseconds) => { assert.equal(milliseconds, 5000); scheduled.set(++nextId, callback); return nextId; },
    cancel: (id) => scheduled.delete(id), fetch: () => new Promise((resolve) => { resolveRead = resolve; }) });
  const unsubscribe = adapter.subscribeClock(() => { events++; });
  const tick = () => { const [id, callback] = scheduled.entries().next().value; scheduled.delete(id); callback(); };
  const reading = adapter.read(); tick(); assert.equal(events, 0); assert.equal(scheduled.size, 1);
  resolveRead(response({ status: 'not-found' }, false)); await reading;
  tick(); assert.equal(events, 1); assert.equal(scheduled.size, 1);
  unsubscribe(); assert.equal(scheduled.size, 0);
});
