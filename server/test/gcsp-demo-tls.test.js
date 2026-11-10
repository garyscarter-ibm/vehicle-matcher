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

test('verified same-origin HTTPS serves real account and offer entry with no access key', async (t) => {
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
  const anonymous = await https.fetch(app.origin + '/gcsp-account.html');
  assert.equal(anonymous.status, 303); assert.equal(anonymous.headers.get('location'), '/gcsp/login');
  assert.equal(anonymous.headers.getSetCookie().length, 0);
  const signedIn = await https.fetch(app.origin + '/api/gcsp/session/login', { method: 'POST',
    headers: { Origin: app.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'paula.mason@gcsp-demo.com', password: 'fucq' }) });
  assert.equal(signedIn.status, 200); assert.equal((await signedIn.json()).value.context.principalId, 'demo-paula');
  const cookies = signedIn.headers.getSetCookie().filter((value) => !/Max-Age=0(?:;|$)/i.test(value));
  assert.equal(cookies.length, 1);
  assert.ok(cookies.every((value) => value.startsWith('gcsp_session=') && value.includes('; Path=/;')
    && value.includes('; Secure') && value.includes('; HttpOnly')));
  const session = cookies.map((value) => value.split(';')[0]).join('; ');
  const account = await https.fetch(app.origin + '/gcsp-account.html', { headers: { Cookie: session } });
  assert.equal(account.status, 200); assert.equal(account.headers.getSetCookie().length, 0);
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
});

test('root session cookies preserve explicit Greg login across HTML and API without presenter bootstrap', async (t) => {
  const https = await createLocalHttpsFixture(t);
  const opened = await startGcspDemo({ tls: https.configuration, runtime: { mode: 'memory',
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
  assert.equal(first.status, 303); assert.equal(first.headers.get('location'), '/gcsp/login');
  assert.equal(first.headers.getSetCookie().length, 0);
  const signedIn = await browse('/api/gcsp/session/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'greg.lawson@gcsp-demo.com', password: 'fucq' }) });
  assert.equal(signedIn.status, 200);
  assert.equal((await signedIn.json()).value.context.principalId, 'demo-greg');
  const htmlCookies = jar.getCookiesSync(`${app.origin}/gcsp-greg.html`);
  assert.deepEqual(htmlCookies.map((value) => value.key), ['gcsp_session']);
  assert.equal(htmlCookies[0].path, '/'); assert.equal(htmlCookies[0].httpOnly, true); assert.equal(htmlCookies[0].secure, true);
  assert.ok(htmlCookies[0].expires.getTime() > Date.now());
  const apiCookies = jar.getCookiesSync(`${app.origin}/api/gcsp/context`);
  assert.deepEqual(apiCookies.map((value) => [value.key, value.value, value.path]), htmlCookies.map((value) => [value.key, value.value, value.path]));
  const actingCookie = htmlCookies[0].value;
  for (const path of ['/gcsp-greg.html', '/gcsp-case-queue.html', '/gcsp-help.html', '/gcsp-account.html']) {
    assert.ok(jar.getCookiesSync(new URL(path, app.origin).href).some((value) => value.key === 'gcsp_session' && value.value === actingCookie));
    const page = await browse(path);
    const employeeOnly = ['/gcsp-help.html', '/gcsp-account.html'].includes(path);
    assert.equal(page.status, employeeOnly ? 303 : 200);
    if (employeeOnly) assert.equal(page.headers.get('location'), '/gcsp-greg.html');
    assert.equal(page.headers.getSetCookie().length, 0, 'HTML navigation must preserve the explicitly signed-in actor');
    assert.equal((await (await browse('/api/gcsp/context')).json()).value.principalId, 'demo-greg');
  }
  const presenter = await browse('/gcsp-presenter.html'); assert.equal(presenter.status, 200);
  const activePresenterCookies = presenter.headers.getSetCookie().filter((value) => !/Max-Age=0(?:;|$)/i.test(value));
  assert.equal(activePresenterCookies.length, 1); assert.ok(activePresenterCookies[0].startsWith('gcsp_presenter='));
  assert.ok(activePresenterCookies[0].includes('; Path=/;') && activePresenterCookies[0].includes('; Secure') && activePresenterCookies[0].includes('; HttpOnly'));
  assert.equal(jar.getCookiesSync(app.origin).find((value) => value.key === 'gcsp_session').value, actingCookie);
  assert.equal((await (await browse('/api/gcsp/context')).json()).value.principalId, 'demo-greg');
  const queue = await browse('/api/gcsp/scheme-team/cases'); assert.equal(queue.status, 200);
  assert.equal((await queue.json()).status, 'ok');
  for (const marker of ['1', 'earlier-process-marker']) {
    const markerOnly = new CookieJar();
    markerOnly.setCookieSync(`GCSP_LOCAL_BOOTSTRAP=${marker}; Path=/; Secure; HttpOnly; SameSite=Strict`, app.origin);
    const deniedPage = await browse('/gcsp-account.html', {}, markerOnly);
    assert.equal(deniedPage.status, 303); assert.equal(deniedPage.headers.get('location'), '/gcsp/login');
    assert.equal(deniedPage.headers.getSetCookie().length, 0);
    assert.equal((await browse('/api/gcsp/context', {}, markerOnly)).status, 401, 'A stale marker never authenticates a person');
    const control = await browse('/gcsp-presenter.html', {}, markerOnly); assert.equal(control.status, 200);
    assert.ok(markerOnly.getCookiesSync(app.origin).some((value) => value.key === 'gcsp_presenter'));
    assert.equal(markerOnly.getCookiesSync(app.origin).some((value) => value.key === 'gcsp_session'), false);
    assert.equal((await browse('/api/gcsp/manual/account', {}, markerOnly)).status, 401, 'Presenter entry never creates an acting employee session');
  }
});
