import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, loadMode } from './dom-harness.js';
import { questionsForBrand } from '../questions.js';
import { resolveEntryContext, ENTRY_REGISTRY } from '../../blocks/demo-launcher/entry-context.js';
import { retailContextUrl, RETAIL_BRANDS } from '../../blocks/vehicle-matcher/share-context.js';

let questionnaire;
let decorate;
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const encode = (answers) => Buffer.from(JSON.stringify(answers)).toString('base64url');
const decode = (url) => JSON.parse(Buffer.from(url.hash.slice(3), 'base64url').toString());
const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);
const context = {
  api: 'https://api.example.test/retail', brand: 'mini', retailer: '92',
  retailerLabel: 'MINI Approved Used', scope: 'national', mode: 'questionnaire', overrides: {},
};

before(async () => {
  installDom();
  questionnaire = await loadMode('questionnaire');
  ({ default: decorate } = await import('../../blocks/vehicle-matcher/vehicle-matcher.js'));
});
beforeEach(() => {
  resetDom();
  window.history.replaceState(null, '', '/repo/block.html');
});

function transport(t, brand = 'mini') {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options });
    const data = String(url).includes('/api/questions')
      ? { questions: questionsForBrand(brand).filter((q) => ['budget', 'fuel'].includes(q.id)) }
      : { matches: [], nearby: [], unmet: {} };
    return { ok: true, json: async () => data };
  });
  return requests;
}

async function mount(t, href, ctx = { ...context }) {
  window.history.replaceState(null, '', href);
  const requests = transport(t, ctx.brand);
  const root = document.createElement('div');
  document.body.append(root);
  const cleanup = questionnaire.mount(root, ctx);
  t.after(cleanup);
  await flush();
  return { root, ctx, requests };
}

test('copy uses effective retail context, preserves repository path and excludes unrelated/private fields', async (t) => {
  const { root, ctx } = await mount(t, '/repo/index.html?brand=bmw&mode=podium&scope=dealer&retailer=wrong&api=https://wrong.test&key=password&access_token=secret&employeeId=paula&brief=private&debug=1#unrelated=secret');
  const answers = { budget: [15000, 35000], fuel: ['petrol', 'electric'], employeeId: 'paula', privateBrief: { name: 'private' }, access_token: 'secret' };
  ctx.answers = answers;
  ctx.showResults(answers, { updateHash: true });
  await flush();
  let copied;
  t.mock.method(navigator.clipboard, 'writeText', async (value) => { copied = value; });
  button(root, 'Copy share link').click();
  await flush();
  const url = new URL(copied);
  assert.equal(url.pathname, '/repo/index.html');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    experience: 'used-cars', brand: 'mini', mode: 'questionnaire', retailer: '92',
    retailerName: 'MINI Approved Used', scope: 'national', api: 'https://api.example.test/retail',
  });
  assert.deepEqual(decode(url), { budget: [15000, 35000], fuel: ['petrol', 'electric'] });
  assert.equal(url.href, window.location.href, 'completion and copying use the same safe serializer');
  assert.equal(resolveEntryContext(url).state, 'retail');
  assert.equal(button(root, 'Link copied').type, 'button');
});

for (const budget of ['b3', 35000, [15000, 35000]]) {
  for (const fuel of ['petrol', ['petrol', 'electric']]) {
    test(`legacy ${JSON.stringify(budget)}/${JSON.stringify(fuel)} reopens, resets and completes with context`, async (t) => {
      const answers = { budget, fuel };
      const query = '?brand=mini&mode=questionnaire&scope=national&retailer=92&api=https://api.example.test/retail';
      const { root, ctx, requests } = await mount(t, `/repo/block.html${query}#m=${encode(answers)}`);
      assert.ok(button(root, 'Copy share link'), 'legacy hash opens results');
      assert.deepEqual(ctx.answers, answers);
      assert.deepEqual(JSON.parse(requests.find((r) => r.url.endsWith('/api/match')).options.body), {
        answers, retailer: '92', brand: 'mini', scope: 'national',
      });
      button(root, 'Start over').click();
      const reset = new URL(window.location.href);
      assert.equal(reset.hash, '');
      assert.equal(reset.searchParams.get('brand'), 'mini');
      assert.equal(reset.searchParams.get('mode'), 'questionnaire');
      assert.equal(reset.searchParams.get('scope'), 'national');
      assert.equal(reset.searchParams.get('api'), context.api);
      assert.equal(reset.searchParams.get('experience'), 'used-cars');
      assert.ok(root.querySelector('.vm-intro'));
      assert.deepEqual(ctx.answers, {});
      ctx.answers = answers;
      ctx.showResults(answers, { updateHash: true });
      await flush();
      assert.deepEqual(decode(new URL(window.location.href)), answers);
      assert.equal(new URL(window.location.href).searchParams.get('retailer'), '92');
    });
  }
}

test('clipboard rejection offers the same sanitised link through the existing copy fallback', async (t) => {
  const { root, ctx } = await mount(t, '/repo/block.html?key=secret');
  ctx.showResults({ budget: 35000, fuel: 'petrol' });
  await flush();
  t.mock.method(navigator.clipboard, 'writeText', async () => { throw new Error('denied'); });
  let fallback;
  t.mock.method(window, 'prompt', (_label, value) => { fallback = value; });
  button(root, 'Copy share link').click();
  await flush();
  assert.equal(new URL(fallback).searchParams.get('brand'), 'mini');
  assert.equal(new URL(fallback).searchParams.has('key'), false);
});

test('shell shares resolved authored context and the currently mounted questionnaire', async (t) => {
  transport(t, 'ford');
  window.history.replaceState(null, '', '/repo/index.html?experience=used-cars&brand=ford');
  const block = document.createElement('div');
  block.dataset.api = 'https://api.example.test';
  for (const [key, value] of [['Brand', 'ford'], ['Retailer ID', 'public-retailer'], ['Retailer Name', 'Ford Direct'], ['Scope', 'national']]) {
    const row = document.createElement('div');
    for (const text of [key, value]) { const col = document.createElement('div'); col.textContent = text; row.append(col); }
    block.append(row);
  }
  document.body.append(block);
  const original = questionnaire.mount;
  let ctx;
  let cleanup;
  t.mock.method(questionnaire, 'mount', (root, value) => { ctx = value; cleanup = original(root, value); return cleanup; });
  await decorate(block);
  t.after(() => cleanup?.());
  await flush();
  ctx.showResults({ budget: 35000, fuel: 'petrol' }, { updateHash: true });
  await flush();
  const url = new URL(window.location.href);
  assert.equal(url.searchParams.get('mode'), 'questionnaire');
  assert.equal(url.searchParams.get('scope'), 'national');
  assert.equal(url.searchParams.get('retailer'), 'public-retailer');
  assert.equal(url.searchParams.get('api'), 'https://api.example.test');
});

test('every supported public brand and mode survives serialisation and retail entry resolution', () => {
  assert.deepEqual(RETAIL_BRANDS, ENTRY_REGISTRY.retailBrands);
  for (const brand of ENTRY_REGISTRY.retailBrands) {
    for (const mode of ENTRY_REGISTRY.retailModes) {
      for (const page of ['block.html', 'index.html']) {
        const url = new URL(retailContextUrl(`https://example.test/repo/${page}`, { ...context, brand, mode }));
        assert.equal(url.searchParams.get('brand'), brand);
        assert.equal(url.searchParams.get('mode'), mode);
        assert.equal(resolveEntryContext(url).state, 'retail');
      }
    }
  }
});

test('API environment links retain the endpoint path while excluding embedded credentials/query/hash', () => {
  const input = new URL('https://user:password@example.test/repo/block.html?key=secret&token=secret#private');
  const url = new URL(retailContextUrl(input, {
    ...context, api: 'https://api-user:api-password@api.example.test/demo/?access_token=secret&key=secret#private',
  }));
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(url.searchParams.get('api'), 'https://api.example.test/demo');
  assert.equal(url.hash, '');
  assert.equal(input.username, 'user', 'caller URL remains unchanged');
  assert.equal(input.searchParams.get('key'), 'secret');
  for (const api of ['javascript:secret', 'data:text/plain,secret', 'file:///private/secret', 'http://[invalid']) {
    assert.equal(new URL(retailContextUrl(input, { ...context, api })).searchParams.has('api'), false);
  }
  assert.equal(new URL(retailContextUrl(input, { ...context, api: '/retail-proxy/' })).searchParams.get('api'), 'https://example.test/retail-proxy');
});

test('unknown context keys cannot grant a new experience or create unsupported brand/mode/scope values', () => {
  const url = new URL(retailContextUrl('https://example.test/repo/', {
    brand: 'constructor', mode: 'employee', scope: 'all', experience: 'employee-cars',
    employeeId: 'paula', privateBrief: { note: 'private' }, access_token: 'secret', key: 'secret',
  }));
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    experience: 'used-cars', brand: 'bmw', mode: 'questionnaire', scope: 'dealer',
  });
});
