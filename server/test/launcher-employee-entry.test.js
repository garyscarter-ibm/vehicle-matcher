import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootAt } from './helpers/launcher-dom.js';
import { createEmployeeCapability } from '../../blocks/demo-launcher/employee-entry.js';
import { buildEntryUrl, ENTRY_REGISTRY } from '../../blocks/demo-launcher/entry-context.js';

const employee = '?experience=employee-cars&brand=bmw';
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const action = (win, label) => [...win.document.querySelectorAll('button,a')].find((node) => node.textContent === label);
const response = (body, status = 200) => ({ status, ok: status >= 200 && status < 300,
  json: async () => structuredClone(body), clone() { return response(body, status); } });

// Finite transport envelopes exercise the real element and HTTP adapter, not product runtime setup.
const account = { status: 'ok', value: { state: 'ready', asOf: '2026-11-05T09:00:00Z', actions: [],
  account: { name: 'Contract Test Employee', company: 'Synthetic company', gradeId: 'Test grade' },
  contracts: [], drivers: [], histories: [], allowance: { monthlyPoints: 1200 } } };

test('public entry registers the real lazy capability while library routing stays fail-closed', () => {
  const source = readFileSync(new URL('../../blocks/demo-launcher/demo-launcher.js', import.meta.url), 'utf8');
  assert.match(source, /bootDemo\(\{ employeeCapability: createEmployeeCapability\(\) \}\)/);
  assert.equal(ENTRY_REGISTRY.employeeAvailable, false);
  const loader = readFileSync(new URL('../../blocks/demo-launcher/employee-entry.js', import.meta.url), 'utf8');
  assert.match(loader, /import\('\.\.\/gcsp\/manual-setup\/journey\.js'\)/);
  assert.doesNotMatch(loader, /harness|fixtures/);
});

test('legacy retail and disabled or unsupported employee routes never load employee modules', () => {
  let loads = 0;
  for (const [suffix, enabled] of [['?brand=mini&mode=swipe#m=answers', true], [employee, false],
    ['?experience=employee-cars&brand=mini', true], ['?experience=employee-cars', true]]) {
    const employeeCapability = createEmployeeCapability({ enabled, load: () => { loads += 1; throw Error('must stay lazy'); } });
    const { dom, win, mounts } = bootAt(suffix, { employeeCapability });
    try {
      assert.equal(loads, 0);
      if (suffix.startsWith('?brand=')) assert.equal(mounts.length, 1);
      else {
        assert.ok([...win.document.querySelectorAll('a')].some((node) => node.textContent.includes('Used cars')));
        if (suffix !== employee) assert.ok(action(win, 'Choose BMW'));
        else assert.ok(action(win, 'Employee cars unavailable').disabled);
      }
    } finally { dom.window.close(); }
  }
});

test('load rejection shows focused recovery and Retry mounts one fresh attempt', async () => {
  const first = deferred(); let attempts = 0; let stopped = 0;
  const employeeCapability = { enabled: true, mount(root) {
    attempts += 1;
    if (attempts === 1) return first.promise;
    root.textContent = 'Recovered entry';
    return () => { stopped += 1; };
  } };
  const { dom, win } = bootAt(employee, { employeeCapability });
  try {
    assert.equal(win.document.activeElement.textContent, 'Opening Employee cars');
    assert.ok(action(win, 'Car experiences')); assert.ok(action(win, 'Used cars'));
    first.reject(Error('module failed'));
    await flush();
    assert.equal(win.document.getElementById('demo-root').dataset.entryState, 'employee-load-error');
    assert.equal(win.document.activeElement.textContent, 'Employee cars could not open');
    const retry = action(win, 'Retry'); retry.focus(); assert.equal(win.document.activeElement, retry); retry.click();
    await flush();
    assert.equal(attempts, 2);
    assert.match(win.document.body.textContent, /Recovered entry/);
    assert.equal(action(win, 'Retry'), undefined);
    win.document.getElementById('demo-root').demoEntryCleanup();
    assert.equal(stopped, 1);
  } finally { dom.window.close(); }
});

test('history transitions cancel pending work, clean mounted entries and preserve retail hash navigation', async () => {
  const pending = deferred(); const signals = []; let mounts = 0; let stopped = 0;
  const employeeCapability = { enabled: true, mount(root, context, { signal }) {
    mounts += 1; signals.push(signal);
    if (mounts === 1) return pending.promise;
    root.textContent = 'Current employee entry';
    return () => { stopped += 1; };
  } };
  const { dom, win, mounts: retailMounts } = bootAt(employee, { employeeCapability });
  const navigate = async (method) => {
    const event = new Promise((resolve) => win.addEventListener('popstate', resolve, { once: true }));
    win.history[method](); await event; await flush();
  };
  try {
    win.history.pushState({}, '', '?experience=launcher&brand=bmw');
    assert.equal(signals[0].aborted, true);
    pending.resolve(() => { stopped += 1; }); await flush();
    assert.equal(stopped, 1); assert.ok(win.document.querySelector('.demo-launcher'));
    await navigate('back'); assert.equal(mounts, 2);
    win.dispatchEvent(new win.Event('pageshow')); await flush(); assert.equal(mounts, 2);
    await navigate('forward'); assert.equal(stopped, 2);
    win.history.pushState({}, '', '?brand=mini&mode=swipe#m=one');
    assert.equal(retailMounts.length, 1);
    win.history.replaceState({}, '', '?brand=mini&mode=swipe#m=two');
    assert.equal(retailMounts.length, 1);
    assert.match(win.sessionStorage.getItem('vm-retail-return'), /#m=two$/);
    assert.equal(mounts, 2);
  } finally { dom.window.close(); }
});

test('employee API context uses existing public normalization and drops identity and buyer inputs', () => {
  const source = 'https://entry.test/index.html?employeeId=other&role=presenter&key=secret&mode=swipe#private';
  for (const [api, expected] of [['https://name:password@api.test/base///?token=secret#key', 'https://api.test/base'],
    ['javascript:alert(1)', null], ['/backend/?token=secret', 'https://entry.test/backend']]) {
    const url = new URL(source); url.searchParams.set('api', api);
    const result = new URL(buildEntryUrl(url, { experience: 'employee-cars', brand: 'bmw' }), url);
    assert.equal(result.searchParams.get('api'), expected);
    assert.deepEqual([...result.searchParams.keys()].sort(), expected ? ['api', 'brand', 'experience'] : ['brand', 'experience']);
    assert.equal(result.hash, '');
  }
});

test('direct and refreshed BMW entry mounts the real custom element once and retains session failures', async () => {
  const loaded = deferred(); const moduleReady = deferred(); const calls = []; let mode = 'ready'; let lazyLoads = 0;
  const capability = createEmployeeCapability({ load: async () => {
    lazyLoads += 1; await loaded.promise;
    const [entry, transport] = await Promise.all([
      import('../../blocks/gcsp/manual-setup/journey.js'), import('../../blocks/gcsp/account/http-adapter.js'),
    ]);
    moduleReady.resolve();
    return { ...entry, ...transport };
  }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (mode === 'gate') return response({ error: 'Unauthorized' }, 401);
    if (mode === 'expired') return response({ status: 'expired-session' }, 401);
    if (mode === 'refused') return response({ status: 'forbidden', view: { supportOwner: 'scheme-support' } }, 403);
    return response(url.endsWith('/account') ? account : { status: 'not-found' }, url.endsWith('/account') ? 200 : 404);
  } });
  const { dom, win } = bootAt(`${employee}&employeeId=other&role=presenter&api=https%3A%2F%2Fname%3Apassword%40api.test%2Fbase%2F%3Ftoken%3Dprivate`,
    { remote: true, stored: 'demo-test-password', employeeCapability: capability });
  try {
    assert.equal(lazyLoads, 1); assert.equal(calls.length, 0);
    loaded.resolve(); await moduleReady.promise; await flush();
    const root = win.document.getElementById('demo-root');
    assert.equal(root.querySelectorAll('gcsp-employee-entry').length, 1);
    assert.equal(root.querySelectorAll('.gcsp-header').length, 1);
    assert.match(root.textContent, /Contract Test Employee/);
    assert.equal(win.document.activeElement.tagName, 'H1');
    // One mount reads account, draft and (since 68ea49fe, FUCQ-105) the current offer link.
    assert.equal(calls.length, 3, 'adapter is assigned before attach, with no default duplicate mount');
    for (const { url, options } of calls) {
      assert.match(url, /^https:\/\/api\.test\/base\/api\/gcsp\/(manual\/(account|draft)|offers\/current)$/);
      assert.equal(options.credentials, 'include');
      assert.equal(options.headers['X-Access-Key'], 'demo-test-password');
      assert.equal(options.method ?? 'GET', 'GET'); assert.equal(options.body, undefined);
      assert.equal(Object.keys(options.headers).some((key) => /employee|role|cookie|authorization/i.test(key)), false);
    }
    assert.equal(root.querySelector('gcsp-employee-entry').getAttribute('brand'), 'bmw');
    for (const link of root.querySelectorAll('nav[aria-label="Car experiences"] a')) {
      assert.doesNotMatch(link.href, /password|private|employeeId|role|key=/);
      assert.equal(new URL(link.href).searchParams.get('brand'), 'bmw');
    }
    // Re-execute the real boot against the same location, as a host remount/refresh does.
    const old = root.querySelector('gcsp-employee-entry');
    win.eval('bootDemo({ employeeCapability });'); await flush();
    assert.equal(old.isConnected, false); assert.equal(root.querySelectorAll('gcsp-employee-entry').length, 1);
    assert.equal(calls.length, 6);
    for (const failure of ['refused', 'expired']) {
      mode = failure; await root.querySelector('gcsp-employee-entry').refresh(); await flush();
      assert.equal(win.document.querySelector('.vm-gate'), null, 'employee rejection does not become demo identity');
      assert.doesNotMatch(root.textContent, /Contract Test Employee/);
      assert.match(root.textContent, /account|Account/);
      assert.ok(action(win, 'Used cars')); assert.ok(action(win, 'Car experiences'));
    }
    mode = 'gate'; await root.querySelector('gcsp-employee-entry').refresh(); await flush();
    assert.ok(win.document.querySelector('.vm-gate'));
    const gateRecovery = win.document.querySelector('.vm-gate nav[aria-label="Leave employee cars"]');
    assert.equal(gateRecovery.querySelectorAll('a').length, 2);
    for (const link of gateRecovery.querySelectorAll('a')) assert.doesNotMatch(link.href, /key=|employeeId|role=/);
    assert.equal(win.document.activeElement.type, 'password');
    assert.equal(win.sessionStorage.getItem(win.ACCESS_KEY_STORAGE), null);
    assert.ok(action(win, 'Used cars'));
    mode = 'ready';
    const form = win.document.querySelector('.vm-gate-card');
    form.querySelector('input').value = 'replacement-test-password';
    form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); await flush();
    assert.equal(win.document.querySelector('.vm-gate'), null);
    assert.equal(root.querySelectorAll('gcsp-employee-entry').length, 1);
    assert.match(root.textContent, /Contract Test Employee/);
    const latest = calls.slice(-3);
    latest.forEach(({ options }) => assert.equal(options.headers['X-Access-Key'], 'replacement-test-password'));
    const signals = latest.map(({ options }) => options.signal);
    win.history.replaceState({}, '', employee); await flush();
    assert.equal(root.querySelectorAll('gcsp-employee-entry').length, 1);
    calls.slice(-3).forEach(({ url }) => assert.match(url, /^https:\/\/bmw-matcher-api\.onrender\.com\/api\/gcsp\/(manual\/(account|draft)|offers\/current)$/));
    win.history.pushState({}, '', '?experience=launcher&brand=bmw'); await flush();
    assert.equal(root.querySelector('gcsp-employee-entry'), null);
    signals.forEach((signal) => assert.equal(signal.aborted, true));
  } finally { dom.window.close(); }
});
