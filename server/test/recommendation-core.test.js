import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  weightTotal, evaluateDimensions, blendScore, percent, compareBy, descending, ascending, byLocale,
} from '../recommendation/index.js';

test('weightTotal adds in insertion order (float-sensitive)', () => {
  assert.equal(weightTotal({ a: 0.1, b: 0.2, c: 0.3 }), 0.1 + 0.2 + 0.3);
  assert.notEqual(weightTotal({ a: 0.1, b: 0.2, c: 0.3 }), weightTotal({ c: 0.3, b: 0.2, a: 0.1 }), 'order is not normalised');
  assert.equal(weightTotal({}), 0);
});

const dims = (log) => ({
  one: () => { log.push('one'); return { score: 1, reason: 'R1' }; },
  two: () => { log.push('two'); return { score: 0.5, reason: 'low' }; },
  three: (c, x) => { log.push(`three:${x}`); return { score: 0.9, reason: 'R3', stretch: c.over }; },
});

test('evaluateDimensions skips zero-weight dimensions and passes args', () => {
  const log = [];
  const out = evaluateDimensions({ over: true }, {
    dimensions: dims(log), fitWeights: { one: 2, three: 1 }, tasteWeights: { two: 0 }, args: ['A'],
    reasonFloor: 0.7, reasonLimit: 4,
  });
  assert.deepEqual(log, ['one', 'three:A']);
  assert.equal(out.fitWeighted, 2 * 1 + 1 * 0.9);
  assert.equal(out.tasteWeighted, 0);
  assert.equal(out.stretch, true);
  assert.deepEqual(out.reasons, ['R1', 'R3']);
  assert.deepEqual(out.evidence, [
    { dimension: 'one', score: 1, weight: 2, reason: 'R1' },
    { dimension: 'three', score: 0.9, weight: 1, reason: 'R3' },
  ]);
});

test('evaluateDimensions splits fit and taste and ranks reasons by weight times score', () => {
  const out = evaluateDimensions({}, {
    dimensions: { a: () => ({ score: 0.8, reason: 'a' }), b: () => ({ score: 1, reason: 'b' }) },
    fitWeights: { a: 3 }, tasteWeights: { a: 1, b: 1 }, reasonFloor: 0.7, reasonLimit: 4,
  });
  assert.equal(out.fitWeighted, 3 * 0.8);
  assert.equal(out.tasteWeighted, 1 * 0.8 + 1 * 1);
  assert.deepEqual(out.reasons, ['a', 'b']);
  assert.equal(out.stretch, false);
});

test('evaluateDimensions applies the reason floor and limit, ties keep dimension order', () => {
  const same = (reason) => () => ({ score: 0.8, reason });
  const out = evaluateDimensions({}, {
    dimensions: { a: same('a'), b: same('b'), c: same('c'), floor: () => ({ score: 0.69, reason: 'x' }), d: same('d') },
    fitWeights: { a: 1, b: 1, c: 1, floor: 5, d: 1 }, tasteWeights: {}, reasonFloor: 0.7, reasonLimit: 2,
  });
  assert.deepEqual(out.reasons, ['a', 'b']);
  assert.equal(out.evidence.length, 5, 'evidence keeps every scored dimension');
});

test('evaluateDimensions does not mutate its arguments', () => {
  const opts = Object.freeze({
    dimensions: Object.freeze({ a: () => ({ score: 1, reason: 'a' }) }),
    fitWeights: Object.freeze({ a: 1 }), tasteWeights: Object.freeze({}), args: Object.freeze([]),
    reasonFloor: 0.7, reasonLimit: 4,
  });
  const candidate = Object.freeze({ id: 1 });
  assert.deepEqual(evaluateDimensions(candidate, opts).reasons, ['a']);
});

test('blendScore and percent round like the retail expression', () => {
  assert.equal(blendScore(0.5, 1, 0.2), Math.round((0.5 * 0.8 + 1 * 0.2) * 100));
  assert.equal(blendScore(0.123456, 0.654321, 0.3), Math.round((0.123456 * (1 - 0.3) + 0.654321 * 0.3) * 100));
  assert.equal(blendScore(0.004, 0, 0.2), 0);
  assert.equal(blendScore(1, 1, 0.2), 100);
  assert.equal(percent(0.495), Math.round(0.495 * 100));
  assert.equal(percent(0.5), 50);
  assert.ok(Number.isNaN(percent(NaN)));
});

test('compareBy returns the first non-zero result, else 0, and lets NaN fall through', () => {
  const rows = [{ s: 1, p: 5 }, { s: 1, p: 3 }, { s: 2, p: 9 }];
  const cmp = compareBy(descending((r) => r.s), ascending((r) => r.p));
  assert.deepEqual([...rows].sort(cmp).map((r) => r.p), [9, 3, 5]);
  assert.equal(cmp({ s: 1, p: 4 }, { s: 1, p: 4 }), 0);
  assert.equal(compareBy()({}, {}), 0);
  const nan = compareBy(() => NaN, () => -3);
  assert.equal(nan({}, {}), -3);
  assert.equal(compareBy(() => NaN)({}, {}), 0);
});

test('descending, ascending and byLocale order by their key', () => {
  assert.equal(descending((x) => x)(1, 3), 2);
  assert.equal(ascending((x) => x)(1, 3), -2);
  assert.ok(byLocale((x) => x.n)({ n: 'a' }, { n: 'b' }) < 0);
  assert.equal(byLocale((x) => x.n)({ n: 'a' }, { n: 'a' }), 0);
  assert.deepEqual(['b', 'a', 'C'].sort(byLocale((x) => x)), ['a', 'b', 'C']);
});

test('server/recommendation stays pure: relative imports only, no I/O or environment', () => {
  const dir = new URL('../recommendation/', import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 3);
  for (const name of files) {
    const source = readFileSync(new URL(name, dir), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
      assert.match(specifier, /^\.\/[\w-]+\.js$/, `${name} imports ${specifier}`);
    }
    assert.doesNotMatch(source, /\bimport\s*\(|require\(|node:/, `${name} dynamic or built-in import`);
    for (const banned of ['fetch(', 'process.env', 'writeFile', 'setTimeout', 'globalThis']) {
      assert.ok(!source.includes(banned), `${name} contains ${banned}`);
    }
  }
});
