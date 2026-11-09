// Runs `node index.js` the way Render does (memory runtime, one origin) and drives it over HTTP only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { essential, preference } from './helpers/employee-recommendation.js';

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const KEY = `test-${randomBytes(9).toString('hex')}`;

async function freePort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}

// Starts the entry and resolves once its stdout contains `ready`; the child is stopped and joined in t.after.
async function launch(t, extra, ready) {
  const port = await freePort();
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? process.env.TMP ?? '/tmp',
    GCSP_OFFLINE: '1', PORT: String(port), ...extra(port) };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited; clearTimeout(timer);
    }
  });
  const seen = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Entry did not report readiness in time. Output tail: ${output.slice(-600)}`)), 60000);
    const check = () => { if (output.includes(ready)) { clearTimeout(timer); resolve(); } };
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output += chunk; check(); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Entry exited (${code}) before readiness. Output tail: ${output.slice(-600)}`)); });
  });
  await seen;
  return { port, base: `http://localhost:${port}`, output: () => output };
}

// A small cookie jar that honours Path, enough to prove the browser-visible behaviour.
function client(base) {
  const jar = new Map();
  const store = (response, path) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';').map((part) => part.trim());
      const at = pair.indexOf('=');
      const attribute = (name) => attributes.find((part) => part.toLowerCase().startsWith(`${name.toLowerCase()}=`))?.split('=')[1];
      jar.set(pair.slice(0, at), { value: pair.slice(at + 1), path: attribute('path') ?? path, line });
    }
  };
  const cookieFor = (path) => [...jar].filter(([, c]) => path.startsWith(c.path)).map(([name, c]) => `${name}=${c.value}`).join('; ');
  const request = async (path, { method = 'GET', body, json, headers = {} } = {}) => {
    const cookie = cookieFor(path);
    const response = await fetch(base + path, { method, redirect: 'manual',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' ? { Origin: base } : {}),
        ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : body });
    store(response, '/');
    const text = await response.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch { parsed = null; }
    return { status: response.status, headers: response.headers, text, json: parsed };
  };
  return { request, jar };
}
const good = (reply) => { assert.equal(reply.status, 200, reply.text.slice(0, 400)); assert.equal(reply.json?.status, 'ok', reply.text.slice(0, 400)); return reply.json.value; };

test('the hosted entry serves the gated demo and drives Paula to a captured offer email over one origin', { timeout: 120000 }, async (t) => {
  const app = await launch(t, (port) => ({ GCSP_RUNTIME: '1', GCSP_PUBLIC_ORIGIN: `http://localhost:${port}`, DEMO_ACCESS_KEY: KEY }),
    '/gcsp-presenter.html');
  assert.match(app.output(), /GCSP hosted demo \(memory\)/);
  const browser = client(app.base);
  const get = (path, options) => browser.request(path, options);
  const post = (path, json) => browser.request(path, { method: 'POST', json });

  // Retail API paths fall through the front untouched.
  assert.equal((await get('/health')).status, 200);

  // The bare host sends a browser to the access page, revealing nothing the 401 hid; the favicon is a quiet 204.
  const bare = await get('/');
  assert.equal(bare.status, 303); assert.equal(bare.headers.get('location'), '/gcsp/access?next=%2Fgcsp-presenter.html');
  assert.equal(bare.text, ''); assert.deepEqual(bare.headers.getSetCookie(), []);
  assert.equal((await get('/favicon.ico')).status, 204);
  assert.equal((await get('/', { method: 'POST' })).status, 401);

  // Pages need the demo key; the offer page does not.
  const gated = await get('/gcsp-presenter.html');
  assert.equal(gated.status, 303); assert.equal(gated.headers.get('location'), '/gcsp/access?next=%2Fgcsp-presenter.html');
  const form = await get('/gcsp/access?next=%2Fgcsp-outbox.html');
  assert.equal(form.status, 200); assert.match(form.text, /type="password"/); assert.match(form.text, /value="\/gcsp-outbox\.html"/);
  assert.equal((await get('/gcsp/offer')).status, 200);
  assert.equal((await get('/blocks/gcsp/shell/gcsp-shell.css')).status, 200);
  assert.equal((await get('/api/gcsp/context')).status, 401);
  const form401 = (key) => browser.request('/gcsp/access', { method: 'POST', body: new URLSearchParams({ key, next: '/gcsp-presenter.html' }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const wrong = await form401('not-the-key');
  assert.equal(wrong.status, 401); assert.match(wrong.text, /That key did not match\. Try again\./);
  const right = await form401(KEY);
  assert.equal(right.status, 303); assert.equal(right.headers.get('location'), '/gcsp-presenter.html');
  const access = right.headers.getSetCookie().find((line) => line.startsWith('GCSP_HOST_ACCESS='));
  assert.match(access, /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200$/);

  const bareWithAccess = await get('/');
  assert.equal(bareWithAccess.status, 303); assert.equal(bareWithAccess.headers.get('location'), '/gcsp-presenter.html');
  assert.equal(bareWithAccess.text, '');

  // The page issues the server-side demo session (Paula, plus presenter control) on the API path only.
  const page = await get('/gcsp-presenter.html');
  assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /^text\/html/);
  const issued = page.headers.getSetCookie();
  assert.ok(issued.length >= 2 && issued.some((line) => line.startsWith('GCSP_LOCAL_BOOTSTRAP=')));
  for (const line of issued.filter((entry) => !entry.startsWith('GCSP_LOCAL_BOOTSTRAP='))) assert.match(line, /; Path=\/api\/gcsp;.*; Secure/);
  const context = good(await get('/api/gcsp/context'));
  assert.equal(context.principalId, 'demo-paula');

  // Reset the way the UI does; the reply must renew the presenter cookies and the new run must carry on working.
  const before = good(await get('/api/gcsp/presenter/scenarios/current'));
  const catalogue = good(await get('/api/gcsp/presenter/scenarios'));
  const scenario = catalogue.scenarios.find((entry) => entry.kind === 'mechanics');
  const resetReply = await post('/api/gcsp/presenter/scenarios/reset', { commandId: 'hosted-reset', expectedRunId: before.runId,
    expectedRunVersion: before.runVersion, scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion,
    fixtureVersion: scenario.fixtureVersion, policyVersion: catalogue.policyVersion });
  const reset = good(resetReply);
  assert.notEqual(reset.runId, before.runId); assert.notEqual(reset.presenterSession?.status, 'unavailable');
  const renewed = resetReply.headers.getSetCookie();
  assert.ok(renewed.some((line) => line.startsWith('gcsp_presenter=')) && renewed.some((line) => line.startsWith('gcsp_session=')));
  assert.equal((await get('/gcsp-presenter.html')).status, 200);
  const state = good(await get('/api/gcsp/presenter/scenarios/current'));
  assert.equal(state.runId, reset.runId);
  const paula = good(await post('/api/gcsp/session/switch', { principalId: 'demo-paula', commandId: 'hosted-paula' }));
  assert.equal(paula.principalId, 'demo-paula'); assert.equal(paula.runId, state.runId);

  // Paula's brief, then the presenter's Next release tick allocates her a buddy offer.
  good(await post('/api/gcsp/brief/draft', { commandId: 'hosted-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
  good(await post('/api/gcsp/brief/confirm', { commandId: 'hosted-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: true, hold: true } }));
  const controls = good(await get('/api/gcsp/presenter/controls'));
  const ticked = good(await post('/api/gcsp/presenter/controls/tick', { commandId: 'hosted-release',
    expectedClockVersion: controls.clockVersion, mode: 'next-release' }));
  const allocation = ticked.tick.outcomes.find((row) => row.handlerId === 'buddy-allocation').outcome.value.allocations
    .flatMap((row) => row.assignments);
  assert.equal(allocation.length, 1, JSON.stringify(ticked.tick.outcomes.map((row) => [row.handlerId, row.outcome.status])));
  const offerId = allocation[0].claim.offer.offerId;
  const offer = good(await get(`/api/gcsp/offers/${encodeURIComponent(offerId)}?runId=${encodeURIComponent(state.runId)}`));
  assert.equal(offer.offerId, offerId);

  // The captured email is visible to the presenter, and the outbox page is live (no fixture attribute).
  const outbox = good(await get('/api/gcsp/presenter/outbox'));
  assert.ok(outbox.messages.length >= 1, JSON.stringify(outbox).slice(0, 400));
  assert.ok(JSON.stringify(outbox.messages).includes(offerId) || outbox.messages.some((message) => /offer/i.test(JSON.stringify(message))));
  const outboxPage = await get('/gcsp-outbox.html');
  assert.equal(outboxPage.status, 200); assert.match(outboxPage.text, /<gcsp-outbox>/);
});

test('without GCSP_RUNTIME the entry still answers GCSP routes as unconfigured', { timeout: 90000 }, async (t) => {
  const app = await launch(t, () => ({}), 'Matcher API listening');
  const reply = await client(app.base).request('/api/gcsp/context');
  assert.equal(reply.status, 503); assert.match(reply.text, /GCSP identity has not been configured/);
  assert.equal((await client(app.base).request('/gcsp-presenter.html')).status, 404);
});

test('the hosted entry refuses to start without a demo key', async () => {
  const { startHostedGcsp } = await import('../gcsp/host.js');
  const started = await startHostedGcsp({ buildServer: () => assert.fail('must not build'), env: { GCSP_PUBLIC_ORIGIN: 'http://localhost:1' }, port: 0 });
  assert.deepEqual(started, { status: 'invalid', code: 'access-key-required' });
});
