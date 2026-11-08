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
  for (const value of [{ status: 'ok', value: { state: 'absent-hr-account', account: null } },
    { status: 'ok', value: { state: 'unknown-grade', account: { name: 'Paula' } } }, { status: 'ok', value: { state: 'later', account: { name: 'Paula' } } },
    { status: 'ok', value: { state: 'ready', account: { gradeId: 'G7' } } }, { status: 'unavailable' }]) {
    const adapter = createAccountHttpAdapter({ fetch: async () => ({ ok: true, json: async () => value }) });
    assert.deepEqual(await adapter.loadAccount(), { status: 'unavailable' });
  }
  const failed = createAccountHttpAdapter({ fetch: async () => { throw Error('offline'); } });
  assert.deepEqual(await failed.loadAccount(), { status: 'unavailable' });
  const denied = createAccountHttpAdapter({ fetch: async () => ({ ok: false, json: async () => ({ status: 'ok', value: { state: 'ready', account: { name: 'Paula' } } }) }) });
  assert.deepEqual(await denied.loadAccount(), { status: 'unavailable' });
});

test('FUCQ-212: every valid account state after an accept keeps the normal header', async () => {
  // Accepting an offer allocates the slot, so the account reads no-entitlement; closed and early windows are valid too.
  for (const state of ['ready', 'no-entitlement', 'ordering-closed', 'not-yet-eligible']) {
    const fetch = async () => ({ ok: true, json: async () => ({ status: 'ok', value: { state, account: { name: 'Paula', gradeId: 'G7' } } }) });
    assert.deepEqual(await createAccountHttpAdapter({ fetch }).loadAccount(), { status: 'ready', name: 'Paula', context: 'Grade G7' }, state);
  }
});

test('FUCQ-201: shared account adapter passes a restart through and reads a bare 401 as access-required', async () => {
  for (const status of ['stale-run', 'unknown-session', 'access-required']) {
    const adapter = createAccountHttpAdapter({ fetch: async () => ({ ok: false, status: 409, json: async () => ({ status, reason: 'x' }) }) });
    assert.deepEqual(await adapter.loadAccount(), { status });
  }
  const lapsed = createAccountHttpAdapter({ fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) }) });
  assert.deepEqual(await lapsed.loadAccount(), { status: 'access-required' });
});

test('FUCQ-204: the shared shell adapter never shows the raw company id', async () => {
  const adapter = createAccountHttpAdapter({ baseURL: 'https://local.invalid/', fetch: async () => ({ ok: true,
    json: async () => ({ status: 'ok', value: { state: 'ready', account: { name: 'Paula', companyId: 'demo-bmw-fs-uk', gradeId: 'G7' } } }) }) });
  assert.deepEqual(await adapter.loadAccount(), { status: 'ready', name: 'Paula', context: 'Grade G7' });
});
