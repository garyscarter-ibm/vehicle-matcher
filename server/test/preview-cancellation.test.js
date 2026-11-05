import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createPreviewFeed, PREVIEW_DEBOUNCE_MS } from '../../blocks/vehicle-matcher/modes/preview-feed.js';
import { installDom, resetDom, loadMode } from './dom-harness.js';
import { questionsForBrand } from '../questions.js';

const CONFIG = { api: 'https://preview.test', retailer: 'dealer-1', brand: 'bmw', scope: 'dealer' };
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const response = (matches) => ({ ok: true, json: async () => ({ matches }) });
const match = (name) => ({
  car: { id: name, name, body: 'saloon', fuel: 'petrol', priceMin: 30000, priceMax: 30000 },
  score: 90, reasons: [],
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function transport(t) {
  const requests = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', (url, options) => {
    const pending = deferred();
    requests.push({ ...pending, url, options });
    return pending.promise;
  });
  return requests;
}

test('new answers invalidate a dispatched success during the next debounce', async (t) => {
  const requests = transport(t);
  const received = [];
  const feed = createPreviewFeed(CONFIG);
  feed.schedule({ budget: 30000 }, (m) => received.push(m));
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  feed.schedule({ budget: 40000 }, (m) => received.push(m));
  requests[0].resolve(response([match('Old')]));
  await flush();
  assert.deepEqual(received, [], 'old result cannot paint while newer answers are debouncing');
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  requests[1].resolve(response([match('Latest')]));
  await flush();
  assert.equal(received[0][0].car.name, 'Latest');
});

for (const outcome of ['reject', 'non-ok', 'empty']) {
  test(`superseded ${outcome} cannot clear the current preview`, async (t) => {
    const requests = transport(t);
    const received = [];
    const feed = createPreviewFeed(CONFIG);
    feed.schedule({ budget: 30000 }, (m) => received.push(m));
    t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
    feed.schedule({ budget: 40000 }, (m) => received.push(m));
    if (outcome === 'reject') requests[0].reject(new Error('Old transport failure'));
    else requests[0].resolve(outcome === 'non-ok' ? { ok: false } : response([]));
    await flush();
    assert.deepEqual(received, []);
  });
}

test('cancel invalidates pending dispatches and already dispatched callbacks, then permits reuse', async (t) => {
  const requests = transport(t);
  const received = [];
  const feed = createPreviewFeed(CONFIG);
  feed.schedule({ budget: 30000 }, (m) => received.push(m));
  feed.cancel();
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  assert.equal(requests.length, 0);
  feed.schedule({ budget: 30000 }, (m) => received.push(m));
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  feed.cancel();
  feed.cancel();
  requests[0].resolve(response([match('Cancelled')]));
  await flush();
  assert.deepEqual(received, []);
  feed.schedule({ budget: 50000 }, (m) => received.push(m));
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  requests[1].resolve(response([match('Reopened')]));
  await flush();
  assert.equal(received[0][0].car.name, 'Reopened');
});

test('cancel also invalidates an old rejection with no abort support', async (t) => {
  const requests = transport(t);
  const received = [];
  const feed = createPreviewFeed(CONFIG);
  feed.schedule({ budget: 30000 }, (m) => received.push(m));
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  feed.cancel();
  requests[0].reject(new Error('Transport ignores cancellation'));
  await flush();
  assert.deepEqual(received, []);
});

test('independent feeds retain debounce, snapshots and retail payloads', async (t) => {
  const requests = transport(t);
  const received = [];
  const first = createPreviewFeed(CONFIG);
  const second = createPreviewFeed({ ...CONFIG, scope: 'national', group: true });
  const answers = { budget: 30000 };
  first.schedule(answers, () => assert.fail('cancelled feed painted'));
  second.schedule(answers, (m) => received.push(m));
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS - 1);
  assert.equal(requests.length, 0);
  t.mock.timers.tick(1);
  answers.budget = 50000;
  first.cancel();
  requests[0].resolve(response([match('Cancelled')]));
  requests[1].resolve(response([match('Independent')]));
  await flush();
  assert.equal(PREVIEW_DEBOUNCE_MS, 250);
  assert.equal(received[0][0].car.name, 'Independent');
  assert.equal(requests[0].url, `${CONFIG.api}/api/preview`);
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    answers: { budget: 30000 }, retailer: CONFIG.retailer, brand: 'bmw', scope: 'dealer', group: false,
  });
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    answers: { budget: 30000 }, retailer: CONFIG.retailer, brand: 'bmw', scope: 'national', group: true,
  });
});

test('current empty and transport failure still deliver the existing empty-list state', async (t) => {
  const requests = transport(t);
  const received = [];
  const feed = createPreviewFeed(CONFIG);
  for (const outcome of ['success', 'empty', 'reject']) {
    feed.schedule({ budget: 30000 }, (m) => received.push(m));
    t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
    const request = requests.at(-1);
    if (outcome === 'reject') request.reject(new Error('Current transport failure'));
    else request.resolve(response(outcome === 'success' ? [match('Current')] : []));
    await flush();
  }
  assert.equal(received[0][0].car.name, 'Current');
  assert.deepEqual(received.slice(1), [[], []]);
});

let modes;
let decorate;
let registeredModes;
before(async () => {
  installDom();
  modes = { questionnaire: await loadMode('questionnaire'), podium: await loadMode('podium') };
  ({ default: decorate } = await import('../../blocks/vehicle-matcher/vehicle-matcher.js'));
  ({ MODES: registeredModes } = await import('../../blocks/vehicle-matcher/modes/index.js'));
});
beforeEach(() => { resetDom(); window.history.replaceState(null, '', '/'); });

function modeTransport(t, { holdQuestions = false } = {}) {
  const requests = transport(t);
  const fetchMock = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (String(url).includes('/api/questions') && !holdQuestions) {
      return Promise.resolve({ ok: true, json: async () => ({ questions: questionsForBrand('bmw') }) });
    }
    return fetchMock(url, options);
  });
  return requests;
}

function mount(mode) {
  const root = document.createElement('div');
  document.body.append(root);
  const ctx = { ...CONFIG, overrides: {}, retailerLabel: 'Test retailer' };
  const cleanup = mode.mount(root, ctx);
  return { root, ctx, cleanup };
}

for (const key of ['questionnaire', 'podium']) {
  for (const outcome of ['success', 'reject']) {
    test(`${key} teardown invalidates dispatched ${outcome} and preserves the new screen`, async (t) => {
      const requests = modeTransport(t);
      const { root, cleanup } = mount(modes[key]);
      await flush();
      if (key === 'questionnaire') root.querySelector('.vm-intro button').click();
      t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
      assert.equal(requests.length, 1);
      assert.equal(typeof cleanup, 'function', 'preview mode provides synchronous teardown');
      cleanup();
      root.innerHTML = '<div class="vm-screen">Replacement screen</div>';
      if (outcome === 'success') requests[0].resolve(response([match('Departed')]));
      else requests[0].reject(new Error('Departed failure'));
      await flush();
      t.mock.timers.tick(500);
      assert.equal(root.textContent, 'Replacement screen');
      assert.equal(root.querySelector('.vm-preview'), null);
    });
  }

  for (const outcome of ['success', 'reject']) {
    test(`${key} teardown suppresses late boot ${outcome} and loading updates`, async (t) => {
      const requests = modeTransport(t, { holdQuestions: true });
      const { root, cleanup } = mount(modes[key]);
      assert.equal(requests.length, 1);
      assert.equal(typeof cleanup, 'function');
      cleanup();
      root.textContent = 'New mode';
      if (outcome === 'reject') requests[0].reject(new Error('Old questions failed'));
      else requests[0].resolve({ ok: true, json: async () => ({ questions: questionsForBrand('bmw') }) });
      await flush();
      t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
      assert.equal(root.textContent, 'New mode');
      assert.equal(requests.length, 1);
    });
  }
}

test('questionnaire keeps loading, success, empty and error preview treatment', async (t) => {
  const requests = modeTransport(t);
  const { root, ctx } = mount(modes.questionnaire);
  await flush();
  ctx.showQuestion(0);
  assert.equal(root.querySelectorAll('.vm-skel-ptile').length, 5);
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  requests[0].resolve(response([match('Current')]));
  await flush();
  assert.match(root.querySelector('.vm-preview').textContent, /Current/);
  ctx.showQuestion(0);
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  requests[1].resolve(response([]));
  await flush();
  assert.equal(root.querySelector('.vm-preview'), null);
  ctx.showQuestion(0);
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  requests[2].reject(new Error('Current failure'));
  await flush();
  assert.equal(root.querySelector('.vm-preview'), null);
});

test('shell cancels a preview before switching and reopening the questionnaire', async (t) => {
  const requests = modeTransport(t);
  const block = document.createElement('div');
  block.dataset.api = CONFIG.api;
  document.body.append(block);
  await decorate(block);
  await flush();
  block.querySelector('.vm-intro button').click();
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  const select = block.querySelector('.vm-switcher-select');
  select.value = 'podium';
  select.dispatchEvent(new window.Event('change'));
  await flush();
  select.value = 'questionnaire';
  select.dispatchEvent(new window.Event('change'));
  await flush();
  block.querySelector('.vm-intro button').click();
  requests[0].resolve(response([match('Old run')]));
  await flush();
  assert.doesNotMatch(block.textContent, /Old run/);
  assert.equal(block.querySelectorAll('.vm-skel-ptile').length, 5);
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  assert.equal(requests.length, 2, 'departed podium debounce was cancelled');
  requests[1].resolve(response([match('Reopened run')]));
  await flush();
  assert.match(block.querySelector('.vm-preview').textContent, /Reopened run/);
});

test('questionnaire instances paint only into their own block', async (t) => {
  const requests = modeTransport(t);
  const first = mount(modes.questionnaire);
  const second = mount(modes.questionnaire);
  await flush();
  first.ctx.showQuestion(0);
  second.ctx.showQuestion(0);
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  requests[0].resolve(response([match('First block')]));
  requests[1].resolve(response([match('Second block')]));
  await flush();
  assert.match(first.root.textContent, /First block/);
  assert.doesNotMatch(first.root.textContent, /Second block/);
  assert.match(second.root.textContent, /Second block/);
});

test('shell cleans up before replacement and supports every registered mode returning nothing', async (t) => {
  const events = [];
  for (const [index, mode] of registeredModes.entries()) {
    t.mock.method(mode, 'mount', (root) => {
      events.push(`mount:${mode.key}`);
      root.textContent = mode.key;
      if (index % 2) return undefined;
      return () => {
        assert.equal(root.textContent, mode.key, 'cleanup precedes stage replacement');
        events.push(`cleanup:${mode.key}`);
      };
    });
  }
  const block = document.createElement('div');
  document.body.append(block);
  await decorate(block);
  const select = block.querySelector('select');
  for (const mode of [...registeredModes.slice(1), registeredModes[0]]) {
    select.value = mode.key;
    select.dispatchEvent(new window.Event('change'));
    assert.equal(block.querySelector('.vm-stage').textContent, mode.key);
  }
  assert.deepEqual(events, [
    'mount:questionnaire', 'cleanup:questionnaire', 'mount:swipe', 'mount:head-to-head',
    'cleanup:head-to-head', 'mount:podium', 'mount:guess-who', 'cleanup:guess-who', 'mount:questionnaire',
  ]);
});
