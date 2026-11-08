// Authored source only: execution requires the current TLS/resource admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Server, request } from 'node:https';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieJar } from 'jsdom';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createOfferHttpTransport } from '../../blocks/gcsp/offer/http-adapter.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';

test('local host refuses absent unreadable and invalid TLS before opening runtime resources', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gcsp-invalid-tls-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keyFile = join(root, 'invalid.key'); const certFile = join(root, 'invalid.crt');
  await writeFile(keyFile, 'not a PEM key'); await writeFile(certFile, 'not a PEM certificate');
  let opened = 0;
  const runtime = { mode: 'memory', repository: { async open() { opened += 1; throw Error('Unexpected runtime allocation.'); } } };
  for (const [tls, code] of [[{}, 'local-tls-configuration-required'], [null, 'local-tls-configuration-required'],
    [{ keyFile, certFile: join(root, 'missing.crt') }, 'local-tls-configuration-invalid'],
    [{ keyFile, certFile }, 'local-tls-configuration-invalid']]) {
    const outcome = await startGcspDemo({ runtime, tls });
    assert.equal(outcome.status, 'invalid'); assert.equal(outcome.code, code);
    assert.equal(outcome.reason, 'Configure a valid local HTTPS certificate and private key.');
    assert.equal(outcome.retryable, false);
    assert.deepEqual(Object.keys(outcome).sort(), ['code', 'reason', 'retryable', 'status']);
  }
  assert.equal(opened, 0);
});

test('verified same-origin HTTPS serves real account and offer entry through the unchanged shared gate', async (t) => {
  const previousKey = process.env.DEMO_ACCESS_KEY;
  t.after(() => { if (previousKey === undefined) delete process.env.DEMO_ACCESS_KEY; else process.env.DEMO_ACCESS_KEY = previousKey; });
  process.env.DEMO_ACCESS_KEY = 'local-https-shared-test';
  const https = await createLocalHttpsFixture(t);
  const opened = await startGcspDemo({ tls: https.configuration, runtime: { mode: 'memory',
    environmentId: 'local-https-test', policyAsOf: '2026-11-05T12:00:00.000Z', commandId: 'https-bootstrap' } });
  assert.equal(opened.status, 'ok'); const app = opened.value; t.after(() => app.close());
  assert.equal(new URL(app.origin).protocol, 'https:'); assert.ok(app.server instanceof Server);
  // No global trust bypass: the ordinary client must reject this private test certificate.
  await assert.rejects(new Promise((done, reject) => {
    const req = request(app.origin + '/gcsp-account.html', { rejectUnauthorized: true, agent: false }, (res) => {
      res.resume(); done();
    });
    req.setTimeout(5000, () => req.destroy(new Error('TLS verification wait exceeded its bound.')));
    req.on('error', reject); req.end();
  }));
  const account = await https.fetch(app.origin + '/gcsp-account.html'); assert.equal(account.status, 200);
  const cookies = account.headers.getSetCookie();
  assert.ok(cookies.length > 0); assert.ok(cookies.every((value) => value.includes('; Secure') && value.includes('; HttpOnly')));
  const session = cookies.map((value) => value.split(';')[0]).join('; ');
  const context = await https.fetch(app.origin + '/api/gcsp/context', { headers: { Cookie: session, Origin: app.origin } });
  assert.equal(context.status, 200); assert.equal((await context.json()).status, 'ok');
  const page = await https.fetch(app.origin + '/gcsp/offer?offerId=missing');
  assert.equal(page.status, 200); assert.equal(page.headers.getSetCookie().length, 0);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.ok((await page.text()).includes('/blocks/gcsp/offer/entry-harness.js'));
  let reads = 0;
  const adapter = createOfferHttpTransport({ location: { href: app.origin + '/gcsp/offer?offerId=missing' },
    fetch: (url, init) => { reads += 1; return https.fetch(url, { ...init,
      headers: { ...init.headers, Cookie: session, Origin: app.origin } }); } });
  assert.equal((await adapter.read()).status, 'not-found'); assert.equal(reads, 1);
  const foreign = await https.fetch(app.origin + '/api/gcsp/context', { headers: { Cookie: session, Origin: 'https://foreign.invalid' } });
  assert.equal(foreign.status, 403);
  const foreignHost = await https.fetch(app.origin + '/gcsp-account.html', { headers: { Host: 'foreign.invalid' } });
  assert.equal(foreignHost.status, 403);
  const unauthenticated = await https.fetch(app.origin + '/api/gcsp/context', { headers: { Origin: app.origin } });
  assert.equal(unauthenticated.status, 401);
  try {
    process.env.DEMO_ACCESS_KEY = 'different-local-https-shared-test';
    const denied = await https.fetch(app.origin + '/api/gcsp/context', { headers: { Cookie: session, Origin: app.origin } });
    assert.equal(denied.status, 401);
  } finally { process.env.DEMO_ACCESS_KEY = 'local-https-shared-test'; }
});

test('browser cookie paths preserve a deliberate Greg switch across real local page navigation', async (t) => {
  const https = await createLocalHttpsFixture(t);
  const opened = await startGcspDemo({ tls: https.configuration, accessKey: '', runtime: { mode: 'memory',
    environmentId: 'local-navigation-test', policyAsOf: '2026-11-05T12:00:00.000Z', commandId: 'navigation-bootstrap' } });
  assert.equal(opened.status, 'ok'); const app = opened.value; t.after(() => app.close());
  const jar = new CookieJar();
  async function browse(path, init = {}, cookies = jar) {
    const url = new URL(path, app.origin).href;
    const cookie = cookies.getCookieStringSync(url);
    const response = await https.fetch(url, { ...init, headers: { Origin: app.origin, ...init.headers,
      ...(cookie ? { Cookie: cookie } : {}) } });
    for (const issued of response.headers.getSetCookie()) cookies.setCookieSync(issued, url);
    return response;
  }
  const first = await browse('/gcsp-help.html?principalId=demo-greg&runId=forged');
  assert.equal(first.status, 200);
  assert.ok(first.headers.getSetCookie().every((value) => value.includes('; Secure') && value.includes('; HttpOnly')));
  // A real browser sends only the non-authority marker on HTML requests. The
  // two unchanged identity cookies are confined to their existing API path.
  const htmlCookies = jar.getCookiesSync(`${app.origin}/gcsp-presenter.html`);
  assert.deepEqual(htmlCookies.map((value) => value.key), ['GCSP_LOCAL_BOOTSTRAP']);
  assert.equal(htmlCookies[0].path, '/'); assert.equal(htmlCookies[0].sameSite, 'strict');
  const apiCookies = jar.getCookiesSync(`${app.origin}/api/gcsp/context`);
  assert.equal(apiCookies.filter((value) => value.path === '/api/gcsp').length, 2);
  const employee = await (await browse('/api/gcsp/context')).json();
  assert.equal(employee.value.principalId, 'demo-paula');
  const switched = await browse('/api/gcsp/session/switch', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ principalId: 'demo-greg', commandId: 'deliberate-greg' }) });
  assert.equal(switched.status, 200);
  assert.equal((await switched.json()).value.principalId, 'demo-greg');
  for (const path of ['/gcsp-presenter.html', '/gcsp-greg.html', '/gcsp-case-queue.html', '/gcsp-help.html', '/gcsp-account.html']) {
    assert.match(jar.getCookieStringSync(new URL(path, app.origin).href), /^GCSP_LOCAL_BOOTSTRAP=[0-9a-f]{24}$/);
    const page = await browse(path); assert.equal(page.status, 200);
    assert.equal(page.headers.getSetCookie().length, 0, 'HTML navigation must not replace the deliberately selected acting session');
    assert.equal((await (await browse('/api/gcsp/context')).json()).value.principalId, 'demo-greg');
  }
  const queue = await browse('/api/gcsp/scheme-team/cases'); assert.equal(queue.status, 200);
  assert.equal((await queue.json()).status, 'ok');
  const markerOnly = new CookieJar();
  const marker = jar.getCookieStringSync(`${app.origin}/gcsp-presenter.html`);
  markerOnly.setCookieSync(`${marker}; Path=/; Secure; HttpOnly; SameSite=Strict`, app.origin);
  assert.equal((await browse('/gcsp-presenter.html', {}, markerOnly)).status, 200);
  const denied = await browse('/api/gcsp/context', {}, markerOnly);
  assert.equal(denied.status, 401, 'The marker cannot authenticate an actor or presenter');
  // A marker from an earlier process (a restart) bootstraps a fresh session instead of reusing stale cookies.
  const restarted = new CookieJar();
  restarted.setCookieSync('GCSP_LOCAL_BOOTSTRAP=1; Path=/; Secure; HttpOnly; SameSite=Strict', app.origin);
  const fresh = await browse('/gcsp-presenter.html', {}, restarted);
  assert.equal(fresh.status, 200); assert.ok(fresh.headers.getSetCookie().length >= 2);
  assert.equal((await (await browse('/api/gcsp/context', {}, restarted)).json()).value.principalId, 'demo-paula');
});
