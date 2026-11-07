import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { JSDOM } from 'jsdom';
import { createLocalHttpsFixture } from './helpers/local-https.js';

const options = { mode: 'memory', environmentId: 'brief-live-test', policyAsOf: '2026-11-05T12:00:00.000Z',
  commandId: 'bootstrap', sessionNow: () => new Date().toISOString() };
const cookie = (headers) => headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');

async function local(t) {
  const https = await createLocalHttpsFixture(t); const fetch = https.fetch;
  const app = await startGcspDemo({ runtime: options, port: 0, tls: https.configuration });
  assert.equal(app.status, 'ok'); t.after(() => app.value.close());
  const { origin } = app.value;
  const page = await fetch(`${origin}/gcsp-brief-live.html`);
  assert.equal(page.status, 200);
  const session = cookie(page.headers);
  assert.ok(session); assert.ok(page.headers.getSetCookie().every((v) => v.includes('HttpOnly') && v.includes('Secure')));
  const request = async (path, body, headers = {}) => {
    const response = await fetch(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: session, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, json: await response.json() };
  };
  return { ...app.value, request, session, fetch, ca: https.ca };
}

test('runtime refuses implicit memory fallback and unknown repository modes', async () => {
  const unknown = await createGcspRuntime({ ...options, mode: 'unknown' });
  assert.equal(unknown.status, 'invalid');
  const missing = await createGcspRuntime({ ...options, mode: 'postgres', repositoryOptions: { connectionString: '' } });
  assert.equal(missing.status, 'invalid');
  assert.equal(missing.code, 'missing-database-url');
});

test('local trusted composition loads account/editor, saves real versions and projects the same activity', async (t) => {
  const app = await local(t);
  const account = await app.request('/api/gcsp/manual/account');
  assert.equal(account.json.status, 'ok'); assert.equal(account.json.value.state, 'ready');
  const loaded = await app.request('/api/gcsp/brief/editor');
  assert.equal(loaded.json.status, 'ok'); assert.equal(loaded.json.value.initial.briefVersion, 0);
  const draft = structuredClone(loaded.json.value.initial.brief);
  Object.assign(draft.preferences.comfort, { value: 94, valueState: 'draft', source: 'employee' });
  const preview = await app.request('/api/gcsp/brief/preview', { kind: 'unsaved-draft', baseBriefVersion: 0, draftVersion: 0, brief: draft });
  assert.equal(preview.json.status, 'ok'); assert.equal(preview.json.value.state, 'no-stock');
  assert.equal(preview.json.value.eligibleCount, 0); assert.equal(preview.json.value.decisions.length, 0);
  assert.equal((await app.request('/api/gcsp/brief')).json.status, 'not-found');
  const saved = await app.request('/api/gcsp/brief/draft', { commandId: 'draft-1', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: draft });
  assert.equal(saved.json.status, 'ok'); assert.equal(saved.json.value.draftVersion, 1);
  const confirmed = await app.request('/api/gcsp/brief/confirm', { commandId: 'confirm-1', expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } });
  assert.equal(confirmed.json.status, 'ok'); assert.equal(confirmed.json.value.brief.briefVersion, 1);
  const reopened = await app.request('/api/gcsp/brief/editor');
  assert.equal(reopened.json.value.initial.brief.preferences.comfort.value, 94);
  assert.equal(reopened.json.value.initial.briefVersion, 1);
  const activity = await app.request('/api/gcsp/activity');
  assert.equal(activity.json.status, 'ok'); assert.equal(activity.json.value.briefVersion, 1);
  assert.deepEqual([activity.json.value.permission.canSearch, activity.json.value.permission.canHold], [true, true]);
  assert.equal(activity.json.value.state, 'never-searched'); assert.equal(activity.json.value.lastSuccessfulCheck, null);
  assert.equal(activity.json.value.offers.length, 0); assert.equal(activity.json.value.stateChanges[0].operation, 'confirmed');
  const conflict = await app.request('/api/gcsp/brief/draft', { commandId: 'stale-draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: draft });
  assert.equal(conflict.json.status, 'stale-version'); assert.equal(conflict.status, 409);
  assert.equal((await app.request('/api/gcsp/brief')).json.value.brief.briefVersion, 1);
  assert.equal(activity.headers.get('Cache-Control'), 'no-store');
});

test('local host retains session and strict origin/context guards without serving private source', async (t) => {
  const app = await local(t);
  assert.equal((await app.request('/api/gcsp/context')).json.status, 'ok');
  const foreign = await app.request('/api/gcsp/brief/preview', {}, { Origin: 'https://foreign.invalid' });
  assert.equal(foreign.status, 403);
  const forged = await app.request('/api/gcsp/brief/preview', { employeeId: 'another-employee' });
  assert.equal(forged.status, 400); assert.equal(forged.json.code, 'browser-context-forbidden');
  const unauthenticated = await app.fetch(`${app.origin}/api/gcsp/brief/editor`);
  assert.equal(unauthenticated.status, 401);
  // Use a verified TLS client with a different Host header to exercise the host guard.
  const foreignHost = await new Promise((done, reject) => {
    const request = httpsRequest(`${app.origin}/gcsp-brief-live.html`, { ca: app.ca, servername: 'localhost', rejectUnauthorized: true,
      headers: { Host: 'foreign.invalid' } }, (response) => {
      response.resume(); done(response.statusCode);
    });
    request.setTimeout(5000, () => request.destroy(new Error('Local HTTPS request timed out.')));
    request.on('error', reject); request.end();
  });
  assert.equal(foreignHost, 403);
  const page = await app.fetch(`${app.origin}/gcsp-brief-live.html`, { headers: { Cookie: app.session } });
  assert.equal(page.headers.getSetCookie().length, 0);
  for (const path of ['/server/index.js', '/.claude/gcsp-database-url', '/_tools/test_stamp.py', '/blocks/%2f..%2fserver/index.js']) {
    assert.equal((await app.fetch(`${app.origin}${path}`)).status, 404);
  }
  const script = await app.fetch(`${app.origin}/blocks/gcsp/brief/runtime.js`); assert.equal(script.status, 200);
});

test('browser runtime adapter uses supplied same-origin fetch and projects the existing account shape', async () => {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
  const { createBriefRuntimeAdapter } = await import('../../blocks/gcsp/brief/runtime.js');
  const calls = [];
  const adapter = createBriefRuntimeAdapter({ fetch: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ status: 'ok', value: { state: 'ready', account: { name: 'Paula (fictional)', gradeId: 'G7' } } }) };
  } });
  assert.deepEqual(await adapter.loadAccount(), { status: 'ready', name: 'Paula (fictional)', context: 'Grade G7' });
  assert.equal(calls[0].url, '/api/gcsp/manual/account'); assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(typeof adapter.transport.preview, 'function');
  const unavailable = createBriefRuntimeAdapter({ fetch: async () => { throw Error('offline'); } });
  assert.deepEqual(await unavailable.loadAccount(), { status: 'unavailable' });
  const denied = createBriefRuntimeAdapter({ fetch: async () => ({ ok: true, json: async () => ({ status: 'ok', value: { state: 'no-entitlement', account: { name: 'Paula' } } }) }) });
  assert.deepEqual(await denied.loadAccount(), { status: 'unavailable' });
  dom.window.close();
});

test('exact activity entry boundary establishes the same session without assuming an activity UI implementation', async (t) => {
  // One small static fixture proves the authorized route/session boundary only. FUCQ-95 owns the actual page.
  const root = await mkdtemp(join(tmpdir(), 'gcsp-activity-entry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'gcsp-activity-live.html'), '<!doctype html><title>Activity entry boundary fixture</title>');
  const https = await createLocalHttpsFixture(t); const fetch = https.fetch;
  const opened = await startGcspDemo({ runtime: options, root, tls: https.configuration }); assert.equal(opened.status, 'ok');
  t.after(() => opened.value.close());
  const { origin } = opened.value;
  const page = await fetch(`${origin}/gcsp-activity-live.html`); assert.equal(page.status, 200);
  const session = cookie(page.headers); assert.ok(session);
  const response = await fetch(`${origin}/api/gcsp/manual/account`, { headers: { Cookie: session } });
  assert.equal((await response.json()).value.state, 'ready');
  for (const path of ['/gcsp-activity-live.html/other', '/gcsp-activity.html', '/blocks/%2f..%2fgcsp-activity-live.html']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404);
  }
});
