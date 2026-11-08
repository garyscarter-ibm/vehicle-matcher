import test from 'node:test';
import assert from 'node:assert/strict';
import { createBriefTransport } from '../../blocks/gcsp/brief/brief-transport.js';
test('brief transport preserves exact payload, authenticated context, conflict body and abort signal', async () => {
  const calls = []; const abort = new AbortController();
  const transport = createBriefTransport({ fetch: async (...args) => { calls.push(args); return { ok: false, status: 409, json: async () => ({ status: 'stale-version', action: 'refresh' }) }; }, signal: abort.signal });
  const payload = { commandId: 'confirm1', expectedBriefVersion: 2, expectedDraftVersion: 3, consent: { search: false, hold: true } };
  assert.deepEqual(await transport.confirm(payload), { status: 'stale-version', action: 'refresh' });
  assert.equal(calls[0][0], '/api/gcsp/brief/confirm');
  assert.deepEqual(JSON.parse(calls[0][1].body), payload);
  assert.equal(calls[0][1].credentials, 'same-origin'); assert.equal(calls[0][1].signal, abort.signal);
});
test('editor reads and malformed/network failures remain unavailable without fixture fallback', async () => {
  const calls = []; const response = { status: 'ok', value: { context: { preferences: {}, essentials: {}, slider: { minimum: 0, maximum: 100 } }, initial: { brief: { schemaVersion: 1, preferences: {}, essentials: {} } } } };
  const transport = createBriefTransport({ fetch: async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, json: async () => response }; } });
  assert.deepEqual(await transport.loadEditor(), response); assert.equal(calls[0][1].method, 'GET'); assert.equal(calls[0][1].body, undefined);
  const invalid = createBriefTransport({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', value: {} }) }) });
  assert.equal((await invalid.loadEditor()).status, 'unavailable');
  assert.equal((await createBriefTransport({ fetch: async () => { throw Error('offline'); } }).preview({})).status, 'unavailable');
});

test('body lifecycle signal overrides transport signal and abort prevents further requests', async () => {
  const parent = new AbortController(); const body = new AbortController(); const calls = [];
  const transport = createBriefTransport({ signal: parent.signal, fetch: async (url, init) => { calls.push(init); return { ok: true, json: async () => ({ status: 'ok', value: {} }) }; } });
  await transport.preview({ kind: 'unsaved-draft', baseBriefVersion: 0, draftVersion: 0, brief: {} }, { signal: body.signal });
  assert.equal(calls[0].signal, body.signal); body.abort();
  assert.equal((await transport.preview({}, { signal: body.signal })).status, 'unavailable'); assert.equal(calls.length, 1);
});

const lapsed = (status = 401, body = { error: 'Unauthorized' }) => async () => ({ ok: false, status, json: async () => { if (body === undefined) throw new SyntaxError('not json'); return body; } });
test('a 401 with no status (lapsed access key) reads access-required; a status keeps its own result', async () => {
  for (const body of [{ error: 'Unauthorized' }, undefined]) {
    const transport = createBriefTransport({ fetch: lapsed(401, body) });
    assert.deepEqual(await transport.loadEditor(), { status: 'access-required' });
    assert.deepEqual(await transport.confirm({ commandId: 'c', expectedBriefVersion: 1, expectedDraftVersion: 1, consent: {} }), { status: 'access-required' });
  }
  for (const status of [401, 403]) assert.deepEqual(await createBriefTransport({ fetch: lapsed(status, { status: 'forbidden' }) }).loadEditor(), { status: 'forbidden' });
  assert.deepEqual(await createBriefTransport({ fetch: lapsed(500, undefined) }).loadEditor(), { status: 'unavailable', retryable: true });
});
