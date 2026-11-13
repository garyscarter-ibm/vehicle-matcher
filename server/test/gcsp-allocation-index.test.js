import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compileFunction } from 'node:vm';
import { allocationFixture } from './helpers/gcsp-allocation.js';

const source = await readFile(new URL('../gcsp/allocation/index.js', import.meta.url), 'utf8');
const sourceSha = createHash('sha256').update(source).digest('hex');
// Compile the production fragments, not a rewritten implementation. Shape changes require explicit review.
const construction = [...source.matchAll(/^[ \t]*const stockByOrderId = new Map\(\);[\s\S]*?(?=^[ \t]*const facts =)/gm)];
const lookup = [...source.matchAll(/^[ \t]*const stock = stockByOrderId\.get\(decision\.orderUuid\);$/gm)];
assert.equal(construction.length, 1, 'one stock index construction before employee facts');
assert.equal(lookup.length, 1, 'one production candidate lookup');
assert.match(construction[0][0], /for \(const stock of available\) if \(!stockByOrderId\.has\(stock\.orderUuid\)\) stockByOrderId\.set\(stock\.orderUuid, stock\);/);
assert.ok(construction[0].index < lookup[0].index, 'construct before candidate lookup');
const resolveRows = compileFunction(`${construction[0][0]}\nreturn decisions.map((decision) => {\n${lookup[0][0]}\nreturn stock;\n});`,
  ['available', 'decisions', 'Map'], { filename: 'allocation/index.js:extracted-stock-lookup' });

const row = (orderUuid, version) => Object.freeze({ orderUuid, configurationId: 'shared-configuration', version,
  revision: `revision-${version}`, facts: Object.freeze({ provenance: Object.freeze({ sourceRef: `stock-${version}` }) }) });
const decisionsFor = (ids) => ids.map((orderUuid) => ({ orderUuid }));
function countingMap(counts) {
  return class extends Map {
    has(key) { counts.has += 1; return super.has(key); }
    set(key, value) { counts.set += 1; return super.set(key, value); }
    get(key) { counts.get += 1; return super.get(key); }
  };
}

test('actual stock lookup preserves find identity, first duplicate, version, revision and provenance', (t) => {
  const first = row('order-a', 13); const duplicate = row('order-a', 29); const other = row('order-b', 41);
  for (const available of [[], [first], [first, other], [first, duplicate, other], [duplicate, first, other]]) {
    const ids = ['order-a', 'order-b', 'missing']; const counts = { has: 0, set: 0, get: 0 };
    const actual = resolveRows(available, decisionsFor(ids), countingMap(counts));
    for (const [i, id] of ids.entries()) {
      const expected = available.find((stock) => stock.orderUuid === id);
      assert.strictEqual(actual[i], expected, `${id}: preserve exact row identity and its version/revision/provenance`);
    }
    assert.deepEqual(counts, { has: available.length, set: new Set(available.map((stock) => stock.orderUuid)).size, get: ids.length });
  }
  t.diagnostic(`production source SHA256=${sourceSha}; bounded synthetic rows share configurationId but retain exact order IDs`);
  // Two visible duplicate IDs are rejected by recommendation validation; this isolates only the lookup boundary.
});

test('actual lookup construction and candidate access take N has + N set + C get operations', (t) => {
  for (const size of [8, 32, 128]) {
    const available = Array.from({ length: size }, (_, i) => row(`order-${i}`, i + 1));
    for (const candidates of [size, size * 2]) {
      // Last-row hits and misses both visit the entire reference pool.
      const decisions = decisionsFor(Array.from({ length: candidates }, (_, i) => i % 2 ? 'missing' : `order-${size - 1}`));
      const counts = { has: 0, set: 0, get: 0 }; let referenceVisits = 0;
      const actual = resolveRows(available, decisions, countingMap(counts));
      const expected = decisions.map((decision) => available.find((stock) => {
        referenceVisits += 1; return stock.orderUuid === decision.orderUuid;
      }));
      actual.forEach((stock, i) => assert.strictEqual(stock, expected[i]));
      assert.deepEqual(counts, { has: size, set: size, get: candidates });
      assert.equal(referenceVisits, size * candidates);
      t.diagnostic(`N=${size} C=${candidates}: has=${counts.has} set=${counts.set} get=${counts.get}; reference find predicate visits=${referenceVisits}`);
    }
  }
});

test('public allocation builds one raw-stock map per visible pool and gets each eligible candidate once', async (t) => {
  for (const cars of [8, 16]) {
    const f = await allocationFixture({ cars });
    t.after(async () => { await f.repository.close(); await f.policy.close(); });
    const original = { has: Map.prototype.has, set: Map.prototype.set, get: Map.prototype.get };
    const observations = new WeakMap(); const stockMaps = [];
    const observe = (map) => {
      if (!observations.has(map)) observations.set(map, { has: 0, set: 0, get: 0, rawStock: false });
      return observations.get(map);
    };
    let out;
    try {
      Map.prototype.has = function (key) { observe(this).has += 1; return original.has.call(this, key); };
      Map.prototype.get = function (key) { observe(this).get += 1; return original.get.call(this, key); };
      Map.prototype.set = function (key, value) {
        const counts = observe(this); counts.set += 1;
        if (!counts.rawStock && key === value?.orderUuid && value?.facts?.identityKind === 'exact-stock'
          && value.state === 'available' && Number.isSafeInteger(value.version)) {
          counts.rawStock = true; stockMaps.push(counts);
        }
        return original.set.call(this, key, value);
      };
      out = await f.service.allocate(f.context, f.event);
    } finally {
      Object.assign(Map.prototype, original);
    }
    assert.equal(out.status, 'ok', JSON.stringify(out));
    assert.equal(stockMaps.length, f.employees.length, 'one raw-stock index for each employee-visible pool');
    assert.ok(out.value.evaluations.every((evaluation) => evaluation.decisions.length === cars
      && evaluation.decisions.every((decision) => decision.gateStatus === 'eligible')));
    for (const counts of stockMaps) assert.deepEqual(counts, { has: cars, set: cars, get: cars, rawStock: true });
    t.diagnostic(`allocationFixture cars=${cars} employees=${f.employees.length}: raw-stock maps=${stockMaps.length}; each has=${cars} set=${cars} get=${cars}`);
  }
  // These counts concern stock resolution only; ranking, date/decline guards and occupancy are unchanged.
});
