import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootAt } from './helpers/launcher-dom.js';
import {
  ENTRY_REGISTRY, resolveEntryContext, buildEntryUrl,
} from '../../blocks/demo-launcher/entry-context.js';

const origin = 'https://example.test/vehicle-matcher/';
const entry = (suffix = '', options) => resolveEntryContext(`${origin}index.html${suffix}`, options);
const enabled = { employeeAvailable: true };

test('registry separates experience, six retail brands, five public mode keys and employee availability', () => {
  assert.deepEqual(ENTRY_REGISTRY.experiences, ['launcher', 'used-cars', 'employee-cars']);
  assert.deepEqual(ENTRY_REGISTRY.retailBrands, ['bmw', 'mini', 'ford', 'honda', 'motorrad', 'ferrari']);
  assert.deepEqual(ENTRY_REGISTRY.retailModes, ['questionnaire', 'swipe', 'head-to-head', 'podium', 'guess-who']);
  assert.deepEqual(ENTRY_REGISTRY.employeeBrands, ['bmw']);
  assert.equal(ENTRY_REGISTRY.employeeAvailable, false);
  assert.ok(Object.isFrozen(ENTRY_REGISTRY.retailBrands));
});

test('fresh URLs select launcher; explicit retail chooses picker or branded shell', () => {
  for (const suffix of ['', '?api=https%3A%2F%2Fapi.example.test', '?key=demo-secret', '#demo-tool']) {
    assert.equal(entry(suffix).state, 'launcher', suffix);
  }
  assert.equal(entry('?experience=used-cars').state, 'retail-picker');
  assert.equal(entry('?experience=used-cars&brand=mini').state, 'retail');
  assert.equal(entry('?experience=used-cars&brand=mini').brand, 'mini');
  const launcher = entry('?experience=launcher&brand=mini&mode=podium#m=answers');
  assert.equal(launcher.state, 'launcher');
  assert.equal(launcher.brand, 'mini');
});

test('legacy retail context remains retail even without a brand; standalone block stays retail', () => {
  for (const suffix of ['?brand=', '?mode=podium', '?scope=national', '?retailer=92', '?retailerName=Name', '#m=YW5zd2Vycw', '#mingle=1', '#knockout=1']) {
    assert.equal(entry(suffix).state, 'retail-picker', suffix);
  }
  for (const brand of ENTRY_REGISTRY.retailBrands) {
    assert.equal(entry(`?brand=${brand}`).state, 'retail');
    assert.equal(entry(`?brand=${brand}`).brand, brand);
  }
  assert.equal(entry('?brand=unknown').brand, 'bmw');
  assert.equal(entry('?experience=used-cars&brand=unknown').brand, 'bmw');
  assert.equal(resolveEntryContext(`${origin}block.html`).state, 'retail');
  assert.equal(resolveEntryContext(`${origin}block.html?experience=employee-cars&brand=mini`).experience, 'used-cars');
});

test('unknown experience and unsupported employee brand remain explicit and recoverable', () => {
  for (const suffix of ['?experience=unknown&brand=mini', '?experience=&brand=bmw']) {
    const context = entry(suffix);
    assert.equal(context.state, 'unknown-experience');
    assert.ok(context.links.launcher.includes('experience=launcher'));
  }
  for (const brand of ['mini', 'ford', 'honda', 'motorrad', 'ferrari', 'unknown', 'constructor', 'toString', '__proto__']) {
    const context = entry(`?experience=employee-cars&brand=${brand}`, enabled);
    assert.equal(context.state, 'unsupported-employee-brand');
    assert.equal(context.brand, brand.toLowerCase());
    assert.equal(new URL(context.links.employeeBmw, origin).searchParams.get('brand'), 'bmw');
  }
  assert.equal(entry('?experience=employee-cars', enabled).state, 'employee-brand-required');
  assert.equal(entry('?experience=employee-cars&brand=bmw').state, 'employee-unavailable');
  assert.equal(entry('?experience=employee-cars&brand=bmw', enabled).state, 'employee');
  assert.equal(entry('?experience=used-cars&brand=bmw', { employeeAvailable: false }).state, 'retail');
  assert.equal(entry('?experience=employee-cars&brand=bmw', { employeeAvailable: 'true' }).state, 'employee-unavailable');
});

test('retail links preserve pathname, query and answer hash; launcher retains brand and return context', () => {
  const href = `${origin}index.html?experience=used-cars&brand=mini&mode=podium&scope=national&retailer=92&retailerName=Dealer&api=https%3A%2F%2Fapi.example.test&key=demo-secret#m=answers`;
  for (const experience of ['used-cars', 'launcher']) {
    const target = new URL(buildEntryUrl(href, { experience }), origin);
    assert.equal(target.pathname, '/vehicle-matcher/index.html');
    assert.equal(target.searchParams.get('experience'), experience);
    for (const [key, value] of [['brand', 'mini'], ['mode', 'podium'], ['scope', 'national'], ['retailer', '92'], ['retailerName', 'Dealer'], ['api', 'https://api.example.test']]) assert.equal(target.searchParams.get(key), value);
    assert.equal(target.hash, '#m=answers');
    assert.equal(target.searchParams.has('key'), false);
  }
  assert.equal(new URL(buildEntryUrl('https://example.test/repo/?brand=mini', { experience: 'launcher' }), origin).pathname, '/repo/');
  assert.equal(new URL(buildEntryUrl(href, { experience: 'used-cars', brand: null }), origin).searchParams.has('brand'), false);
});

test('employee crossing allows only brand/API navigation and removes every retail answer/context', () => {
  const href = `${origin}index.html?brand=bmw&mode=swipe&scope=national&retailer=96&retailerName=Dealer&api=https%3A%2F%2Fapi.example.test&key=demo-secret&employeeId=paula&policy=retail&answers=buyer#m=answers`;
  const target = new URL(buildEntryUrl(href, { experience: 'employee-cars' }), origin);
  assert.equal(target.pathname, '/vehicle-matcher/index.html');
  assert.deepEqual([...target.searchParams.keys()].sort(), ['api', 'brand', 'experience']);
  assert.equal(target.hash, '');
  const context = resolveEntryContext(target, enabled);
  assert.equal(context.state, 'employee');
  assert.equal(JSON.stringify(context).includes('answers'), false);
  const direct = entry('?experience=employee-cars&brand=bmw&retailer=96#m=answers', enabled);
  assert.equal(JSON.stringify(direct).includes('answers'), false);
  assert.equal(JSON.stringify(direct).includes('retailer'), false);
});

test('all generated contexts/links strip duplicate or empty legacy keys without mutating input', () => {
  const input = new URL(`${origin}index.html?brand=mini&key=demo-secret&key=second-secret&mode=podium#m=answers`);
  const context = resolveEntryContext(input);
  assert.equal(input.searchParams.get('key'), 'demo-secret');
  assert.equal(JSON.stringify(context).includes('demo-secret'), false);
  assert.equal(JSON.stringify(context).includes('second-secret'), false);
  for (const url of Object.values(context.links)) assert.equal(new URL(url, origin).searchParams.has('key'), false);
  assert.equal(new URL(buildEntryUrl(`${origin}index.html?key=`, { experience: 'launcher' }), origin).searchParams.has('key'), false);
});

test('index boot dispatches launcher host, explicit retail picker, legacy shell and recovery contract', () => {
  for (const [suffix, state, count] of [['', 'launcher', 0], ['?experience=used-cars', 'retail-picker', 0], ['?mode=podium#m=answers', 'retail-picker', 0], ['?brand=mini', 'retail', 1], ['?brand=unknown', 'retail', 1], ['?experience=launcher&brand=mini', 'launcher', 0], ['?experience=employee-cars&brand=mini', 'unsupported-employee-brand', 0], ['?experience=employee-cars&brand=bmw', 'employee-unavailable', 0], ['?experience=unknown', 'unknown-experience', 0]]) {
    const { dom, win, mounts, ready } = bootAt(suffix);
    try {
      const root = win.document.getElementById('demo-root');
      assert.equal(root.dataset.entryState, state, suffix);
      assert.equal(root.entryContext.state, state, suffix);
      assert.equal(ready.length, 1);
      assert.equal(mounts.length, count, suffix);
      if (!['retail', 'retail-picker'].includes(state)) {
        assert.ok(root.querySelector('main h1'));
        assert.ok(root.querySelector('a[href]'), 'route host needs a working recovery/retail route');
      }
    } finally { dom.window.close(); }
  }
});

test('index picker retains mode/scope/API and starts each brand without old answers or retailer', () => {
  const { dom, win } = bootAt('?mode=podium&scope=national&retailer=92&retailerName=Dealer&api=http%3A%2F%2Flocalhost%3A8788#m=answers');
  try {
    const tiles = [...win.document.querySelectorAll('.demo-picker-tile')];
    assert.equal(tiles.length, 6);
    for (const tile of tiles) {
      const url = new URL(tile.href);
      assert.equal(url.pathname, '/vehicle-matcher/index.html');
      assert.equal(url.searchParams.get('experience'), 'used-cars');
      assert.equal(url.searchParams.get('mode'), 'podium');
      assert.equal(url.searchParams.get('api'), 'http://localhost:8788');
      assert.equal(url.searchParams.get('scope'), 'national');
      assert.equal(url.searchParams.has('retailer'), false);
      assert.equal(url.searchParams.has('retailerName'), false);
      assert.equal(url.hash, '');
    }
  } finally { dom.window.close(); }
});

test('index retains local/remote API choice, override and demo gate including legacy-key removal', async () => {
  for (const [suffix, remote, expected] of [['?brand=bmw', false, 'http://localhost:8787'], ['?brand=bmw', true, 'https://bmw-matcher-api.onrender.com'], ['?brand=mini&api=http%3A%2F%2Flocalhost%3A8788', true, 'http://localhost:8788']]) {
    const { dom, win, mounts } = bootAt(suffix, { remote, stored: 'stored-secret' });
    try { assert.equal(mounts.length, 1); assert.equal(mounts[0].dataset.api, expected); }
    finally { dom.window.close(); }
  }
  const { dom, win, mounts } = bootAt('?experience=used-cars&key=demo-secret&key=second-secret#m=answers', { remote: true });
  try {
    assert.equal(win.sessionStorage.getItem(win.ACCESS_KEY_STORAGE), 'demo-secret');
    assert.equal(new URL(win.location.href).searchParams.has('key'), false);
    assert.equal(win.location.hash, '#m=answers');
    assert.equal(mounts.length, 0);
    assert.equal(win.document.querySelector('.vm-gate'), null);
    assert.equal(win.document.documentElement.innerHTML.includes('demo-secret'), false);
    for (const link of win.document.querySelectorAll('.demo-picker-tile')) assert.equal(new URL(link.href).searchParams.has('key'), false);
  } finally { dom.window.close(); }
  const gated = bootAt('', { remote: true });
  try {
    assert.ok(gated.win.document.querySelector('.vm-gate'));
    assert.equal(gated.ready.length, 0);
    gated.win.document.querySelector('input').value = 'typed-secret';
    gated.win.document.querySelector('form').dispatchEvent(new gated.win.Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    assert.equal(gated.win.sessionStorage.getItem(gated.win.ACCESS_KEY_STORAGE), 'typed-secret');
    assert.equal(gated.ready[0].state, 'launcher');
  } finally { gated.dom.window.close(); }
});

test('a rejected stored demo password prompts once and remounts retail with the new session key', async () => {
  const { dom, win, mounts } = bootAt('?brand=bmw', { remote: true, stored: 'old-secret' });
  try {
    win.sessionStorage.removeItem(win.ACCESS_KEY_STORAGE); // engine's 401 behaviour
    win.dispatchEvent(new win.Event('vm-auth-failed'));
    win.dispatchEvent(new win.Event('vm-auth-failed'));
    assert.equal(win.document.querySelectorAll('.vm-gate').length, 1);
    assert.match(win.document.querySelector('.vm-gate').textContent, /try again/i);
    win.document.querySelector('input').value = 'replacement-secret';
    win.document.querySelector('form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    assert.equal(mounts.length, 2);
    assert.equal(mounts[0], mounts[1]);
    assert.equal(win.sessionStorage.getItem(win.ACCESS_KEY_STORAGE), 'replacement-secret');
    assert.equal(win.document.getElementById('demo-root').innerHTML.includes('replacement-secret'), false);
  } finally { dom.window.close(); }
});

test('an empty legacy key is removed before the route host and its links are exposed', () => {
  const { dom, win } = bootAt('?key=');
  try {
    assert.equal(new URL(win.location.href).searchParams.has('key'), false);
    const context = win.document.getElementById('demo-root').entryContext;
    for (const link of Object.values(context.links)) assert.equal(new URL(link, origin).searchParams.has('key'), false);
  } finally { dom.window.close(); }
});

test('standalone block retains retail boot, config overrides and key/session behaviour', () => {
  const { dom, win, mounts } = bootAt('?experience=employee-cars&brand=mini&mode=podium&scope=national&retailer=92&retailerName=Dealer&key=demo-secret', { standalone: true });
  try {
    assert.equal(mounts.length, 1);
    const rows = Object.fromEntries([...mounts[0].children].map((row) => [row.firstElementChild.textContent.toLowerCase(), row.lastElementChild.textContent]));
    assert.equal(rows.brand, 'mini'); assert.equal(rows['retailer id'], '92'); assert.equal(rows['retailer name'], 'Dealer');
    assert.equal(win.sessionStorage.getItem(win.ACCESS_KEY_STORAGE), 'demo-secret');
    assert.equal(new URL(win.location.href).searchParams.has('key'), false);
  } finally { dom.window.close(); }
});
