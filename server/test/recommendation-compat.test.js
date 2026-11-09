import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureRetailContract, frozen } from './retail-compat-harness.js';
import { captureClientContract } from './retail-compat-client-harness.js';
import * as liveEngine from '../engine.js';
import * as referenceEngine from './helpers/retail-reference-r1/engine.js';
import * as usedRetailV1 from '../scenarios/retail/used-retail-v1.js';
import { BRANDS, brandTuning } from '../brands.js';
import { REFERENCE, verifyReferenceCopy, parityCorpus, diffEngines, firstDifference as parityDifference } from './helpers/retail-parity.js';

const directory = new URL('./fixtures/retail-compat-v1/', import.meta.url);
const read = (name) => readFileSync(new URL(name, directory));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = readdirSync(directory).sort();
const original = Object.fromEntries(files.map((name) => [name, read(name)]));
const identity = (name) => {
  const stat = statSync(new URL(name, directory), { bigint: true });
  return { size: stat.size, inode: stat.ino, mtime: stat.mtimeNs, ctime: stat.ctimeNs };
};
const originalIdentity = Object.fromEntries(files.map((name) => [name, identity(name)]));
const input = frozen(JSON.parse(original['inputs.json']));
const manifest = frozen(JSON.parse(original['manifest.json']));
const expected = frozen(JSON.parse(original['expected.json']));

function firstDifference(actual, wanted, path = '$') {
  if (Object.is(actual, wanted)) return null;
  if (actual === null || wanted === null || typeof actual !== 'object' || typeof wanted !== 'object') return { path, actual, expected: wanted };
  if (Array.isArray(actual) !== Array.isArray(wanted)) return { path, actual, expected: wanted };
  for (const key of new Set([...Object.keys(wanted), ...Object.keys(actual)])) {
    if (!Object.hasOwn(actual, key) || !Object.hasOwn(wanted, key)) return { path: `${path}.${key}`, actual: actual[key], expected: wanted[key] };
    const diff = firstDifference(actual[key], wanted[key], `${path}.${key}`);
    if (diff) return diff;
  }
  return null;
}

function compare(actual, wanted, label) {
  const diff = firstDifference(actual, wanted);
  if (!diff) return;
  const snippet = (value) => (JSON.stringify(value) ?? '<missing or undefined>').slice(0, 300);
  assert.fail(`${label}: ${diff.path}; actual=${snippet(diff.actual)}; expected=${snippet(diff.expected)}. Inspect inputs.json and the production path; intentional changes require independent review and an explicit versioned capture. This command never updates expected outputs.`);
}

test('retail compatibility v1: fixed offline contract, repeated without fixture writes', async (t) => {
  try {
    assert.equal(input.version, 'retail-compat-input-v1');
    assert.equal(input.tasteShare, 0.2);
    assert.equal(manifest.sourceRevision, input.sourceRevision);
    for (const [name, hash] of Object.entries(manifest.fixtureHashes)) assert.equal(sha(original[name]), hash, `${name}: versioned fixture checksum changed; independent review required`);
    assert.ok(Object.isFrozen(input.raw.bmw[0]), 'inputs are recursively frozen');
    for (let pass = 1; pass <= 2; pass += 1) {
      const records = await captureRetailContract(input);
      compare(Object.keys(records).sort(), Object.keys(expected.server).sort(), `pass ${pass} server record keys`);
      for (const [key, value] of Object.entries(records)) {
        await t.test(`pass ${pass}: ${key}`, () => compare(value, expected.server[key], key));
      }
      const client = await captureClientContract(input, records);
      for (const [key, value] of Object.entries(client)) {
        await t.test(`pass ${pass}: client/${key}`, () => compare(value, expected.client[key], `client/${key}`));
      }
      compare(Object.keys(client).sort(), Object.keys(expected.client).sort(), `pass ${pass} client record keys`);
    }
  } finally {
    assert.deepEqual(readdirSync(directory).sort(), files, 'baseline command must not create or remove fixture files');
    for (const name of files) {
      assert.deepEqual(read(name), original[name], `${name}: fixture content changed by compatibility command`);
      assert.deepEqual(identity(name), originalIdentity[name], `${name}: fixture rewritten by compatibility command`);
    }
  }
});

// Differential parity: frozen R1 reference vs the live retail path, in memory.
const corpus = parityCorpus();
const tuningSnapshot = () => JSON.stringify(Object.keys(BRANDS).map((b) => [b, brandTuning(b)]));
const registryBefore = tuningSnapshot();
const describeDiff = (run) => run.difference && `${run.difference.caseId} ${run.difference.path}`;

test('parity: the R1 reference copy is verbatim', () => {
  assert.equal(verifyReferenceCopy(), REFERENCE.sha256);
  assert.match(REFERENCE.revision, /^3f468f6b/);
});

test('parity: firstDifference fails on key order and array length', () => {
  assert.equal(parityDifference({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }), null);
  assert.match(parityDifference({ a: 1, b: 2 }, { b: 2, a: 1 }).path, /keyOrder/);
  assert.equal(parityDifference({ a: [1] }, { a: [1, 2] }).path, '$.a.length');
  assert.ok(parityDifference({ a: 0 }, { a: -0 }));
});

test('parity: reference and live engine agree on every corpus case, with no fetch', () => {
  const run = diffEngines(referenceEngine, liveEngine, corpus);
  assert.equal(run.difference, null, describeDiff(run));
  assert.ok(run.comparisons >= 1000, `only ${run.comparisons} rankings compared`);
  assert.equal(run.comparisons, corpus.length);
  assert.equal(run.fetchCalls, 0);
});

test('parity: used-retail-v1 composition agrees with the R1 reference on every corpus case, with no fetch', () => {
  const run = diffEngines(referenceEngine, usedRetailV1, corpus);
  assert.equal(run.difference, null, describeDiff(run));
  assert.ok(run.comparisons >= 1000, `only ${run.comparisons} rankings compared`);
  assert.equal(run.comparisons, corpus.length);
  assert.equal(run.fetchCalls, 0);
});

test('parity: USED_RETAIL_V1 is a frozen composition of the module exports', () => {
  const v1 = usedRetailV1.USED_RETAIL_V1;
  assert.equal(v1.id, 'used-retail-v1');
  assert.ok(Object.isFrozen(v1) && Object.isFrozen(v1.limits));
  for (const name of ['rankCars', 'matchCars', 'groupListings', 'unmetWants', 'tradeOffs', 'budgetRange']) {
    assert.equal(v1[name], usedRetailV1[name], name);
  }
  assert.equal(v1.tasteShare, usedRetailV1.TASTE_SHARE);
  assert.deepEqual(v1.limits, Object.fromEntries(['TOP_MATCHES', 'CLUSTER_PTS', 'MAX_SHOWN', 'TASTE_PTS', 'ALTERNATIVES',
    'LISTING_SAMPLE'].map((name) => [name, usedRetailV1[name]])));
});

const perturbations = {
  'one score +1': { rankCars: (rank) => rank.map((m, i) => (i === 0 ? { ...m, score: m.score + 1 } : m)) },
  'two reasons swapped': {
    rankCars: (rank) => {
      const at = rank.findIndex((m) => m.reasons.length >= 2);
      if (at < 0) return rank;
      const reasons = [...rank[at].reasons];
      [reasons[0], reasons[1]] = [reasons[1], reasons[0]];
      return rank.map((m, i) => (i === at ? { ...m, reasons } : m));
    },
  },
  'price tie-break reversed': {
    rankCars: (rank) => [...rank].sort((a, b) => b.score - a.score || b.taste - a.taste
      || b.car.priceMin - a.car.priceMin || a.car.name.localeCompare(b.car.name)),
  },
  'LISTING_SAMPLE-1 listings in one group': {
    groupListings: (groups) => {
      const at = groups.findIndex((g) => g.listings.length >= liveEngine.LISTING_SAMPLE);
      return groups.map((g, i) => (i === at ? { ...g, listings: g.listings.slice(0, liveEngine.LISTING_SAMPLE - 1) } : g));
    },
  },
  'one match key order changed': {
    matchCars: (result) => {
      if (!result.matches.length) return result;
      const { score, ...rest } = result.matches[0];
      return { ...result, matches: [{ ...rest, score }, ...result.matches.slice(1)] };
    },
  },
};

for (const [name, change] of Object.entries(perturbations)) {
  test(`parity: deliberate change is detected (${name})`, () => {
    const [fn, alter] = Object.entries(change)[0];
    const candidate = { ...liveEngine, [fn]: (...args) => alter(liveEngine[fn](...args)) };
    const run = diffEngines(referenceEngine, candidate, corpus);
    assert.ok(run.difference, `${name} was not detected`);
    assert.ok(run.difference.caseId && run.difference.path, 'difference names the case and path');
  });
}

test('parity: TASTE_SHARE=0.3 reaches both paths (child process)', async () => {
  assert.equal(Number(process.env.TASTE_SHARE ?? 0.2), 0.2, 'run the suite with TASTE_SHARE unset');
  const base = diffEngines(referenceEngine, liveEngine, corpus);
  const script = new URL('./helpers/retail-parity-child.js', import.meta.url);
  const { stdout } = await promisify(execFile)(process.execPath, [script.pathname], {
    timeout: 60_000,
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, TASTE_SHARE: '0.3' },
  });
  const child = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(child.tasteShare, '0.3');
  assert.equal(child.difference, null, `${child.difference?.caseId} ${child.difference?.path}`);
  assert.equal(child.comparisons, corpus.length);
  assert.equal(child.fetchCalls, 0);
  assert.equal(child.usedRetailV1.difference, null, `${child.usedRetailV1.difference?.caseId} ${child.usedRetailV1.difference?.path}`);
  assert.equal(child.usedRetailV1.comparisons, corpus.length);
  assert.equal(child.usedRetailV1.fetchCalls, 0);
  assert.equal(child.usedRetailV1.scoreDigest, child.scoreDigest);
  assert.notEqual(child.scoreDigest, base.scoreDigest, 'a 0.3 blend must change at least one score');
});

test('parity: registry tuning is untouched by the differential runs', () => {
  assert.equal(tuningSnapshot(), registryBefore);
});
