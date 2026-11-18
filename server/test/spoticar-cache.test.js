import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpoticarCache, SpoticarCacheUnavailableError } from '../spoticar-cache.js';

const START = 1800000000000;
const HOUR = 60 * 60 * 1000;
const car = (id = 'VIN_DEALER') => ({
  id, name: 'RAM 1500 Example', line: '1500', body: 'pickup', certification: 'cpo',
  currency: 'USD', priceMin: 30000, priceMax: 30000, features: [], tags: [],
  colour: { colour: 'White', manufacturerColour: 'Bright White' },
});

function setup(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ram-cache-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cachePath = join(root, 'national-ram.json');
  let clock = START;
  const now = () => clock;
  const base = { cachePath, now, log: () => {}, ...options };
  return {
    root, cachePath, base,
    make: (overrides = {}) => createSpoticarCache({ ...base, ...overrides }),
    advance: (ms) => { clock += ms; },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('one initial walk serves simultaneous callers, persists mapped fields atomically and restarts from disk', async (t) => {
  const env = setup(t);
  const pending = deferred();
  let calls = 0;
  const cache = env.make({ load: () => { calls += 1; return pending.promise; } });
  assert.deepEqual(cache.status(), { updatedAt: null, state: 'unavailable', count: 0 });
  const first = cache.get();
  const second = cache.get();
  assert.equal(first, second);
  assert.equal(cache.status().state, 'warming');
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve([{ ...car(), rawSource: { token: 'never-persist' }, Authorization: 'never-persist' }]);
  const cars = await first;
  assert.equal(cars.length, 1);
  assert.deepEqual(await second, cars);
  assert.equal(cache.status().state, 'fresh');
  assert.equal(cache.status().count, 1);
  const serialized = readFileSync(env.cachePath, 'utf8');
  assert.doesNotMatch(serialized, /never-persist|rawSource|Authorization/);
  const saved = JSON.parse(serialized);
  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.updatedAt, START);
  assert.deepEqual(readdirSync(env.root), ['national-ram.json']);
  let restartCalls = 0;
  const restarted = env.make({ load: () => { restartCalls += 1; throw new Error('should not load'); } });
  assert.deepEqual(await restarted.get(), cars);
  assert.equal(restartCalls, 0);
  assert.equal(restarted.status().state, 'fresh');
});

test('valid zero inventory is fresh, durable and distinct from missing or failed inventory', async (t) => {
  const env = setup(t);
  const cache = env.make({ load: async () => [] });
  assert.deepEqual(await cache.get(), []);
  assert.deepEqual(cache.status(), { updatedAt: START, state: 'fresh', count: 0 });
  const restart = env.make({ load: async () => { throw new Error('offline'); } });
  assert.deepEqual(await restart.get(), []);
  assert.equal(restart.status().state, 'fresh');
});

test('stale inventory returns immediately while one detached refresh replaces it on success', async (t) => {
  const env = setup(t);
  await env.make({ load: async () => [car()] }).get();
  env.advance(HOUR);
  const pending = deferred();
  let calls = 0;
  const cache = env.make({ load: () => { calls += 1; return pending.promise; } });
  assert.equal(cache.status().state, 'stale');
  assert.equal((await cache.get())[0].id, 'VIN_DEALER');
  assert.equal((await cache.get())[0].id, 'VIN_DEALER');
  assert.equal(calls, 1);
  pending.resolve([car('NEW_DEALER')]);
  await cache.refresh();
  assert.equal((await cache.get())[0].id, 'NEW_DEALER');
  assert.equal(cache.status().state, 'fresh');
  assert.equal(cache.status().updatedAt, START + HOUR);
});

test('failed stale refresh preserves disk and memory, redacts errors and honours cooldown', async (t) => {
  const env = setup(t);
  await env.make({ load: async () => [car()] }).get();
  const previousDisk = readFileSync(env.cachePath, 'utf8');
  env.advance(HOUR);
  let calls = 0;
  const logs = [];
  const cache = env.make({
    load: async () => { calls += 1; throw new Error('Authorization: secret-value'); },
    log: (message) => logs.push(message),
  });
  assert.equal((await cache.get())[0].id, 'VIN_DEALER');
  await assert.rejects(cache.refresh(), { message: 'RAM inventory unavailable: live inventory refresh failed' });
  assert.equal((await cache.get())[0].id, 'VIN_DEALER');
  await assert.rejects(cache.refresh(), /cooling down/);
  assert.equal(calls, 1);
  assert.equal(cache.status().state, 'stale');
  assert.equal(readFileSync(env.cachePath, 'utf8'), previousDisk);
  assert.doesNotMatch(logs.join(' '), /secret-value|Authorization/);
  env.advance(60000);
  await assert.rejects(cache.refresh(), SpoticarCacheUnavailableError);
  assert.equal(calls, 2);
});

test('expired inventory is never served after a failed fresh walk', async (t) => {
  const env = setup(t);
  await env.make({ load: async () => [car()] }).get();
  env.advance(24 * HOUR + 1);
  const cache = env.make({ load: async () => { throw new Error('offline'); } });
  await assert.rejects(cache.get(), SpoticarCacheUnavailableError);
  assert.deepEqual(cache.status(), { updatedAt: START, state: 'unavailable', count: 0 });
  await assert.rejects(cache.get(), /cooling down/);
});

test('missing, malformed, wrong-version, future and invalid mapped snapshots never fall back to fixtures', async (t) => {
  const env = setup(t);
  const snapshots = [
    null,
    '{"schemaVersion":1,"cars":[',
    JSON.stringify({ schemaVersion: 99, updatedAt: START, cars: [car()] }),
    JSON.stringify({ schemaVersion: 1, updatedAt: START + 1, cars: [car()] }),
    JSON.stringify({ schemaVersion: 1, updatedAt: START, cars: [{ ...car(), certification: 'cpo-go' }] }),
    JSON.stringify({ schemaVersion: 1, updatedAt: START, cars: 'not-array' }),
  ];
  for (const snapshot of snapshots) {
    if (snapshot !== null) writeFileSync(env.cachePath, snapshot);
    let calls = 0;
    const cache = env.make({ load: async () => { calls += 1; throw new Error('offline'); } });
    assert.equal(cache.status().state, 'unavailable');
    await assert.rejects(cache.get(), SpoticarCacheUnavailableError);
    assert.equal(calls, 1);
    assert.equal(cache.status().count, 0);
  }
});

test('invalid completed loads never replace a usable snapshot or its atomic disk file', async (t) => {
  const env = setup(t);
  await env.make({ load: async () => [car()] }).get();
  const disk = readFileSync(env.cachePath, 'utf8');
  for (const bad of [undefined, {}, [car(), car()], [{ vin: 'raw-source' }], [{ ...car(), features: {} }]]) {
    const cache = env.make({ load: async () => bad });
    await assert.rejects(cache.refresh(), SpoticarCacheUnavailableError);
    assert.equal((await cache.get())[0].id, 'VIN_DEALER');
    assert.equal(readFileSync(env.cachePath, 'utf8'), disk);
    assert.deepEqual(readdirSync(env.root), ['national-ram.json']);
  }
});

test('oversized snapshots are cache misses and oversized loaded inventories fail before persistence', async (t) => {
  const env = setup(t);
  writeFileSync(env.cachePath, Buffer.alloc(16 * 1024 * 1024 + 1, ' '));
  const cache = env.make({ load: async () => [] });
  assert.equal(cache.status().state, 'unavailable');
  assert.deepEqual(await cache.get(), []);
  const disk = readFileSync(env.cachePath, 'utf8');
  const big = env.make({ load: async () => Array.from({ length: 1100 }, (_, n) => ({
    ...car(`VIN${n}_DEALER`), blurb: 'x'.repeat(16384),
  })) });
  await assert.rejects(big.refresh(), SpoticarCacheUnavailableError);
  assert.equal(readFileSync(env.cachePath, 'utf8'), disk);
});

test('fresh memory persists through disk write failure and logging failure', async (t) => {
  const env = setup(t);
  const impossible = join(env.root, 'file-as-directory');
  writeFileSync(impossible, 'not a directory');
  const cache = env.make({
    cachePath: join(impossible, 'cache.json'), load: async () => [car()],
    log: () => { throw new Error('logger down'); },
  });
  assert.equal((await cache.get()).length, 1);
  assert.equal(cache.status().state, 'fresh');
});
