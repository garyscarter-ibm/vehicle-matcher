import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal((await transport.read()).status, 'unavailable');
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

test('no nested DTO projection can silently bind an unreviewed successful read to the view', async () => {
  const adapter = createOfferHttpAdapter({ location: { href: 'https://example.test/gcsp/offer?offerId=one' }, fetch: async () => response() });
  assert.equal((await adapter.read()).status, 'unavailable');
});
