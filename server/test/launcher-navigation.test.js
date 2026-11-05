import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTRY_REGISTRY, RETAIL_RETURN_STORAGE, brandChangeUrl, buildEntryUrl,
  rememberRetailLocation, retailReturnUrl,
} from '../../blocks/demo-launcher/entry-context.js';

const origin = 'https://example.test/vehicle-matcher/';
const page = (query = '', file = 'index.html') => `${origin}${file}${query}`;
const target = (location) => new URL(location, origin);
const store = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const remember = (input, storage) => rememberRetailLocation(input, { storage });
const resume = (input, storage, brand) => retailReturnUrl(input, { storage, brand });

test('same-brand launcher round trips retain every public retail field and answer hash', () => {
  for (const brand of ENTRY_REGISTRY.retailBrands) {
    for (const mode of ENTRY_REGISTRY.retailModes) {
      const storage = store();
      const input = page(`?brand=${brand}&mode=${mode}&scope=national&retailer=92&retailerName=Dealer&api=http%3A%2F%2Flocalhost%3A8788#m=YW5zd2Vycw`);
      const remembered = remember(input, storage);
      const launcher = target(buildEntryUrl(input, { experience: 'launcher' }));
      assert.equal(resume(launcher, storage, brand), remembered);
      const returned = target(resume(page(`?experience=launcher&brand=${brand}`), storage, brand));
      for (const key of ['brand', 'mode', 'scope', 'retailer', 'retailerName', 'api']) {
        assert.equal(returned.searchParams.get(key), new URL(input).searchParams.get(key), `${brand}/${mode}/${key}`);
      }
      assert.equal(returned.hash, '#m=YW5zd2Vycw');
      assert.equal(returned.pathname, '/vehicle-matcher/index.html');
    }
  }
});

test('absent, blank and invalid mode stay unlocked through storage and a brand change', () => {
  for (const mode of ['', '&mode=', '&mode=mingle', '&mode=unknown', '&mode=%20podium']) {
    const storage = store();
    remember(page(`?brand=bmw${mode}`), storage);
    for (const url of [resume(page('?experience=launcher&brand=bmw'), storage, 'bmw'),
      brandChangeUrl(page(`?brand=bmw${mode}`), 'mini')]) {
      assert.equal(target(url).searchParams.has('mode'), false, mode);
    }
  }
  assert.equal(target(brandChangeUrl(page('?brand=bmw&mode=SWIPE'), 'mini')).searchParams.get('mode'), 'swipe');
});

test('refresh and Back/Forward use current retail location over a newer saved location', () => {
  const storage = store();
  remember(page('?brand=bmw&mode=podium&scope=national#m=newer'), storage);
  for (const query of ['?brand=bmw#m=older', '?brand=bmw&mode=swipe&scope=dealer#m=older']) {
    const input = page(query);
    const returned = target(resume(input, storage, 'bmw'));
    assert.equal(returned.hash, '#m=older');
    assert.equal(returned.searchParams.get('mode'), new URL(input).searchParams.get('mode'));
    assert.equal(returned.searchParams.get('scope'), 'dealer');
  }
  const explicit = target(resume(page('?experience=launcher&brand=bmw&scope=dealer&api=http%3A%2F%2Flocalhost%3A8789'), storage, 'bmw'));
  assert.equal(explicit.searchParams.has('mode'), false);
  assert.equal(explicit.searchParams.get('api'), 'http://localhost:8789');
  assert.equal(explicit.hash, '');
});

test('deliberate cross-brand changes clear each answer format and dealer identity for all brands', () => {
  for (const brand of ENTRY_REGISTRY.retailBrands.filter((value) => value !== 'bmw')) {
    for (const hash of ['#m=answers', '#mingle=1', '#knockout=1']) {
      const input = new URL(page(`?experience=launcher&brand=bmw&mode=podium&scope=national&retailer=96&retailerName=Old&api=http%3A%2F%2Flocalhost%3A8788&key=secret${hash}`));
      const changed = target(brandChangeUrl(input, brand));
      assert.equal(changed.searchParams.get('brand'), brand);
      assert.equal(changed.searchParams.get('experience'), 'launcher');
      assert.equal(changed.searchParams.get('mode'), 'podium');
      assert.equal(changed.searchParams.get('scope'), 'national');
      assert.equal(changed.searchParams.get('api'), 'http://localhost:8788');
      assert.equal(changed.searchParams.has('retailer'), false);
      assert.equal(changed.searchParams.has('retailerName'), false);
      assert.equal(changed.searchParams.has('key'), false);
      assert.equal(changed.hash, '');
      assert.equal(input.hash, hash);
      assert.equal(input.searchParams.get('key'), 'secret');
    }
  }
});

test('same-brand selection preserves supported hashes but unknown-brand selection starts fresh', () => {
  for (const hash of ['#m=answers', '#mingle=1', '#knockout=1']) {
    assert.equal(target(brandChangeUrl(page(`?brand=bmw&retailer=96${hash}`), 'bmw')).hash, hash);
    for (const brand of ['', '&brand=unknown']) {
      const changed = target(brandChangeUrl(page(`?retailer=96&retailerName=Old${brand}${hash}`), 'mini'));
      assert.equal(changed.hash, '');
      assert.equal(changed.searchParams.has('retailer'), false);
      assert.equal(changed.searchParams.has('retailerName'), false);
    }
  }
  const picker = target(brandChangeUrl(page('?brand=bmw&retailer=96#m=answers'), null));
  assert.equal(picker.searchParams.has('brand'), false);
  assert.equal(picker.hash, '');
  assert.throws(() => brandChangeUrl(page('?brand=bmw'), 'unknown'), TypeError);
});

test('only matching selected brands resume saved locations; another brand uses current environment', () => {
  const storage = store();
  remember(page('?brand=bmw&mode=podium&scope=national&retailer=96#m=answers'), storage);
  const changed = target(resume(page('?experience=launcher&brand=bmw&mode=swipe&scope=national&retailer=96'), storage, 'mini'));
  assert.equal(changed.searchParams.get('brand'), 'mini');
  assert.equal(changed.searchParams.get('mode'), 'swipe');
  assert.equal(changed.searchParams.get('scope'), 'national');
  assert.equal(changed.searchParams.has('retailer'), false);
  assert.equal(changed.hash, '');
  assert.equal(target(resume(page('?experience=launcher'), storage, null)).searchParams.has('brand'), false);
});

test('remembered locations use only public context and strip API authentication and legacy keys', () => {
  const storage = store();
  const input = page('?brand=bmw&key=secret&key=other&employeeId=paula&offer=private&answers=private&scope=typo&api=https%3A%2F%2Fuser%3Apassword%40api.example.test%2Fbase%3Fkey%3Dsecret%23private#m=answers');
  const location = remember(input, storage);
  assert.equal(storage.getItem(RETAIL_RETURN_STORAGE), location);
  const remembered = target(location);
  assert.deepEqual([...remembered.searchParams.keys()].sort(), ['api', 'brand', 'experience', 'scope']);
  assert.equal(remembered.searchParams.get('api'), 'https://api.example.test/base');
  assert.equal(remembered.searchParams.get('scope'), 'dealer');
  assert.equal(remembered.hash, '#m=answers');
  assert.doesNotMatch(location, /secret|password|private|paula/);
  assert.equal(target(remember(page('?brand=mini&api=javascript%3Aalert(1)#employee-private'), storage)).hash, '');
  assert.equal(target(storage.getItem(RETAIL_RETURN_STORAGE)).searchParams.has('api'), false);
});

test('employee input cannot write or overwrite a retail return and never restores buyer fields directly', () => {
  const storage = store();
  const saved = remember(page('?brand=bmw&scope=national#m=retail'), storage);
  for (const file of ['index.html', 'block.html']) {
    const employee = page('?experience=employee-cars&brand=bmw&mode=swipe&scope=national&retailer=96&offer=private#m=employee', file);
    assert.equal(remember(employee, storage), null);
    assert.equal(storage.getItem(RETAIL_RETURN_STORAGE), saved);
    const fresh = target(resume(employee, store(), 'bmw'));
    assert.equal(fresh.hash, '');
    assert.deepEqual([...fresh.searchParams.keys()].sort(), ['brand', 'experience']);
  }
  assert.equal(resume(page('?experience=employee-cars&brand=bmw'), storage, 'bmw'), saved);
  const unsupported = target(retailReturnUrl(page('?experience=employee-cars&brand=unknown'), { storage }));
  assert.equal(unsupported.searchParams.has('brand'), false);
  assert.equal(unsupported.hash, '');
  const employee = target(buildEntryUrl(page('?brand=bmw&mode=swipe&scope=national&retailer=96&key=secret#m=retail'), { experience: 'employee-cars' }));
  assert.deepEqual([...employee.searchParams.keys()].sort(), ['brand', 'experience']);
  assert.equal(employee.hash, '');
});

test('retained returns require a same-origin retail entry in the current repository', () => {
  for (const saved of ['https://outside.test/vehicle-matcher/index.html?brand=bmw',
    '//outside.test/vehicle-matcher/index.html?brand=bmw',
    'https://user:password@example.test/vehicle-matcher/index.html?brand=bmw',
    '/other/index.html?brand=bmw', '/vehicle-matcher/employee.html?brand=bmw',
    '/vehicle-matcher/gcsp-employee.html?brand=bmw', '/vehicle-matcher/../index.html?brand=bmw',
    '/vehicle-matcher/index.html?experience=employee-cars&brand=bmw#m=buyer',
    '/vehicle-matcher/block.html?experience=employee-cars&brand=bmw#m=buyer',
    '/vehicle-matcher/index.html?experience=launcher&brand=bmw',
    '/vehicle-matcher/index.html?brand=unknown', 'javascript:alert(1)', 'http://[invalid']) {
    const storage = store();
    storage.setItem(RETAIL_RETURN_STORAGE, saved);
    const returned = target(resume(page('?experience=launcher&brand=bmw'), storage, 'bmw'));
    assert.equal(returned.pathname, '/vehicle-matcher/index.html', saved);
    assert.equal(returned.searchParams.get('experience'), 'used-cars', saved);
    assert.equal(returned.hash, '', saved);
  }
});

test('valid stored retail URLs are sanitized again on read and explicit current API takes precedence', () => {
  const storage = store();
  storage.setItem(RETAIL_RETURN_STORAGE, '/vehicle-matcher/block.html?brand=bmw&mode=podium&scope=national&retailer=96&key=tampered&offer=private&api=https%3A%2F%2Fold.test#m=answers');
  const returned = target(resume(page('?experience=launcher&brand=bmw&api=http%3A%2F%2Flocalhost%3A8789'), storage, 'bmw'));
  assert.equal(returned.pathname, '/vehicle-matcher/block.html');
  assert.equal(returned.searchParams.get('api'), 'http://localhost:8789');
  assert.equal(returned.searchParams.get('mode'), 'podium');
  assert.equal(returned.hash, '#m=answers');
  assert.equal(returned.searchParams.has('key'), false);
  assert.equal(returned.searchParams.has('offer'), false);
});

test('blocked, missing and corrupt storage degrade to current public retail navigation', () => {
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('unavailable'); } });
    for (const storage of [undefined, null, throwing, {}]) {
      assert.doesNotThrow(() => remember(page('?brand=bmw&key=secret'), storage));
      const returned = target(resume(page('?experience=launcher&brand=bmw&key=secret'), storage, 'bmw'));
      assert.equal(returned.searchParams.get('brand'), 'bmw');
      assert.equal(returned.searchParams.has('key'), false);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else delete globalThis.sessionStorage;
  }
});

test('legacy direct index, directory and block entry paths remain direct retail returns', () => {
  for (const file of ['index.html', 'block.html', '']) {
    const storage = store();
    const input = page('?brand=mini&mode=guess-who&scope=national#knockout=1', file);
    const saved = remember(input, storage);
    assert.ok(saved);
    assert.equal(target(saved).pathname, `/vehicle-matcher/${file}`);
    assert.equal(resume(page('?experience=launcher&brand=mini'), storage, 'mini'), saved);
  }
  assert.equal(remember(page('?experience=launcher&brand=bmw'), store()), null);
  assert.equal(remember(page('?brand=bmw', 'gcsp-employee.html'), store()), null);
  assert.equal(remember(page('?experience=used-cars'), store()), null);
});
