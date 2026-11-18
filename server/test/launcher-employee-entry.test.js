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
const frontendUrl = 'https://employee.example.test/gcsp/';

test('public entry defaults to unavailable without importing the legacy account journey', () => {
  const source = readFileSync(new URL('../../blocks/demo-launcher/demo-launcher.js', import.meta.url), 'utf8');
  assert.match(source, /bootDemo\(\{ employeeCapability: createEmployeeCapability\(\{ enabled: true, frontendUrl: null \}\) \}\)/);
  assert.equal(ENTRY_REGISTRY.employeeAvailable, false);
  assert.equal(createEmployeeCapability().enabled, false);
  const handoff = readFileSync(new URL('../../blocks/demo-launcher/employee-entry.js', import.meta.url), 'utf8');
  assert.doesNotMatch(handoff, /manual-setup|http-adapter|fetch|credentials|customElements|import\(/);
});

test('retail and disabled or unsupported employee routes never navigate to the employee frontend', () => {
  const navigations = [];
  for (const [suffix, enabled] of [['?brand=mini&mode=swipe#m=answers', true], [employee, false],
    ['?experience=employee-cars&brand=mini', true], ['?experience=employee-cars', true]]) {
    const employeeCapability = createEmployeeCapability({ enabled, frontendUrl, navigate: (url) => navigations.push(url) });
    const { dom, win, mounts } = bootAt(suffix, { employeeCapability });
    try {
      assert.equal(navigations.length, 0);
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

test('direct and refreshed BMW entry hands off only its brand to the configured Angular frontend', async () => {
  const navigations = [];
  const capability = createEmployeeCapability({ frontendUrl, navigate: (url) => navigations.push(url) });
  const source = `${employee}&employeeId=other&role=presenter&mode=swipe&scope=national&retailer=92&answers=private&api=https%3A%2F%2Fapi.test%2Fbase&frontendUrl=https%3A%2F%2Fwrong.test%2Fgcsp%2F#m=answers`;
  const { dom, win, mounts } = bootAt(source, { remote: true, employeeCapability: capability });
  try {
    await flush();
    assert.deepEqual(navigations, [`${frontendUrl}?brand=bmw`]);
    assert.equal(mounts.length, 0);
    assert.equal(win.document.querySelector('gcsp-employee-entry'), null);
    assert.equal(win.document.querySelector('link[href*="manual-setup"]'), null);
    win.dispatchEvent(new win.Event('pageshow')); await flush();
    assert.equal(navigations.length, 1, 'unchanged location does not repeat the handoff');
    win.eval('bootDemo({ employeeCapability });'); await flush();
    assert.deepEqual(navigations, [`${frontendUrl}?brand=bmw`, `${frontendUrl}?brand=bmw`]);
    assert.ok(action(win, 'Used cars')); assert.ok(action(win, 'Car experiences'));
  } finally { dom.window.close(); }
});

test('configured launcher link goes directly to Angular and remains BMW-only after brand changes', () => {
  const navigations = [];
  const capability = createEmployeeCapability({ frontendUrl, navigate: (url) => navigations.push(url) });
  const { dom, win } = bootAt('?experience=launcher&brand=bmw&mode=swipe&scope=national&retailer=92&api=https%3A%2F%2Fapi.test#m=answers',
    { employeeCapability: capability });
  try {
    assert.equal(action(win, 'Explore Employee cars').href, `${frontendUrl}?brand=bmw`);
    const used = new URL(action(win, 'Explore BMW Used cars').href);
    assert.equal(used.searchParams.get('mode'), 'swipe');
    assert.equal(used.searchParams.get('scope'), 'national');
    assert.equal(used.searchParams.get('retailer'), '92');
    assert.equal(used.searchParams.get('api'), 'https://api.test');
    assert.equal(used.hash, '#m=answers');
    const select = win.document.querySelector('select');
    select.value = 'mini'; select.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(action(win, 'Explore Employee cars'), undefined);
    assert.ok(action(win, 'Choose BMW'));
    action(win, 'Choose BMW').click();
    assert.equal(action(win, 'Explore Employee cars').href, `${frontendUrl}?brand=bmw`);
    assert.equal(navigations.length, 0, 'rendering links does not navigate');
  } finally { dom.window.close(); }
});

test('missing or invalid frontend configuration shows unavailable with usable retail recovery', () => {
  for (const value of [undefined, '', '/gcsp/', 'https://employee.test/other', 'http://employee.test/gcsp/',
    'https://user:password@employee.test/gcsp/', `${frontendUrl}?api=other`, `${frontendUrl}#account`]) {
    const navigations = [];
    const capability = createEmployeeCapability({ frontendUrl: value, navigate: (url) => navigations.push(url) });
    assert.equal(capability.enabled, false);
    assert.equal(capability.frontendUrl, null);
    const { dom, win } = bootAt(`${employee}&mode=swipe&api=https%3A%2F%2Fapi.test#m=answers`, { employeeCapability: capability });
    try {
      assert.equal(win.document.getElementById('demo-root').dataset.entryState, 'employee-unavailable');
      assert.ok(action(win, 'Employee cars unavailable').disabled);
      assert.ok(action(win, 'Explore BMW Used cars'));
      assert.equal(navigations.length, 0);
      assert.equal(win.document.querySelector('gcsp-employee-entry'), null);
    } finally { dom.window.close(); }
  }
});

test('defensive handoff ignores disabled, aborted and non-BMW entry requests', () => {
  const navigations = [];
  const root = { ownerDocument: { defaultView: { location: { replace: (url) => navigations.push(url) } } } };
  const capability = createEmployeeCapability({ frontendUrl });
  const aborted = new AbortController(); aborted.abort();
  capability.mount(root, { brand: 'bmw' }, { signal: aborted.signal });
  capability.mount(root, { brand: 'mini' });
  capability.mount(root, { brand: null });
  createEmployeeCapability({ enabled: false, frontendUrl }).mount(root, { brand: 'bmw' });
  createEmployeeCapability().mount(root, { brand: 'bmw' });
  assert.deepEqual(navigations, []);
  capability.mount(root, { brand: 'bmw', location: '?role=presenter&api=https://wrong.test' });
  assert.deepEqual(navigations, [`${frontendUrl}?brand=bmw`]);
});
