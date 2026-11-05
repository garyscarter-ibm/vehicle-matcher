import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountHttpAdapter } from '../../blocks/gcsp/shell/account-runtime.js';

test('pure shared account adapter uses only the existing endpoint and presentation fields', async () => {
  const calls = []; const abort = new AbortController();
  const adapter = createAccountHttpAdapter({ baseURL: 'https://local.invalid/', signal: abort.signal,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ status: 'ok', value: { state: 'ready',
        account: { name: 'Paula (fictional)', gradeId: 'G7', employeeId: 'private-id' } } }) };
    } });
  assert.deepEqual(await adapter.loadAccount(), { status: 'ready', name: 'Paula (fictional)', context: 'Grade G7' });
  assert.equal(calls[0].url, 'https://local.invalid/api/gcsp/manual/account');
  assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.signal, abort.signal); assert.equal(globalThis.document, undefined);
  const override = new AbortController(); await adapter.loadAccount({ signal: override.signal });
  assert.equal(calls[1].init.signal, override.signal);
});

test('shared account adapter keeps missing, refused, malformed and failed account data unavailable', async () => {
  for (const value of [{ status: 'ok', value: { state: 'no-entitlement', account: { name: 'Paula' } } },
    { status: 'ok', value: { state: 'ready', account: { gradeId: 'G7' } } }, { status: 'unavailable' }]) {
    const adapter = createAccountHttpAdapter({ fetch: async () => ({ ok: true, json: async () => value }) });
    assert.deepEqual(await adapter.loadAccount(), { status: 'unavailable' });
  }
  const failed = createAccountHttpAdapter({ fetch: async () => { throw Error('offline'); } });
  assert.deepEqual(await failed.loadAccount(), { status: 'unavailable' });
  const denied = createAccountHttpAdapter({ fetch: async () => ({ ok: false, json: async () => ({ status: 'ok', value: { state: 'ready', account: { name: 'Paula' } } }) }) });
  assert.deepEqual(await denied.loadAccount(), { status: 'unavailable' });
});
