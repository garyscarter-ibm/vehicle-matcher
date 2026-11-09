import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brandTuning, BRANDS } from '../../brands.js';
import { questionsForBrand, applyBespokeAnswers, BUDGET_BANDS } from '../../questions.js';
import { poolsFor } from '../retail-compat-harness.js';

// Differential harness: the frozen R1 retail engine vs any candidate engine
// module, compared in memory with no I/O. See DEV-2026-11-04-047, slice 1.

export const REFERENCE = {
  revision: '3f468f6baaccbc7779e5b2e1be7899a88d83ef26',
  path: 'server/engine.js',
  blob: 'a5318ab8871af80b7d36e4827f6e27a0cf2ec988',
  sha256: 'bbe8a865d280fb75075e93a139a3badbaa20972a18406baeeafb8ca2fc56a550',
};

const root = new URL('../../../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const REWRITES = [['../../../questions.js', './questions.js'], ['../../../brands.js', './brands.js']];

/** sha256 of the reference copy after undoing the specifier rewrite and header. */
export function verifyReferenceCopy() {
  let text = readFileSync(new URL('server/test/helpers/retail-reference-r1/engine.js', root), 'utf8');
  text = text.replace(/^\/\/ Frozen post-correction R1[^\n]*\n\/\/ Test-only reference[^\n]*\n/, '');
  for (const [from, to] of REWRITES) text = text.replace(`from '${from}'`, `from '${to}'`);
  return createHash('sha256').update(text).digest('hex');
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Tuning holds scoring functions, which structuredClone refuses; share them, copy the rest.
export function cloneTuning(value) {
  if (Array.isArray(value)) return value.map(cloneTuning);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneTuning(v)]));
  return value;
}

// Small seeded PRNG (mulberry32) so the sampled corpus is identical every run.
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (text) => [...text].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261 ^ 0x5eed);

function sampleAnswers(brand, rand) {
  const answers = {};
  for (const q of questionsForBrand(brand)) {
    if (q.id !== 'budget' && rand() < 0.2) continue; // the server rejects a missing budget
    if (q.type === 'slider') {
      const steps = Math.floor((q.max - q.min) / q.step);
      const pick = () => q.min + Math.floor(rand() * (steps + 1)) * q.step;
      if (q.range) {
        const [a, b] = [pick(), pick()].sort((x, y) => x - y);
        answers[q.id] = [a, b === a ? Math.min(q.max, a + q.step) : b];
      } else answers[q.id] = pick();
    } else if (q.multi) {
      const cap = q.max ?? q.options.length;
      const count = 1 + Math.floor(rand() * Math.min(cap, q.options.length));
      const pool = q.options.map((o) => o.value);
      const chosen = [];
      while (chosen.length < count) chosen.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      answers[q.id] = chosen;
    } else {
      answers[q.id] = q.options[Math.floor(rand() * q.options.length)].value;
    }
  }
  return answers;
}

// Down-sample to about 300 cars, keeping source order.
function everyKth(cars, offset = 0) {
  const k = Math.max(1, Math.ceil(cars.length / 300));
  return cars.filter((_, i) => i % k === (k > 1 ? offset % k : 0));
}

const EDGE_BRIEFS = {
  empty: {},
  'bare-number-budget': { budget: 40000 },
  'fuel-specific': { budget: [10000, 60000], fuel: ['ev'], bodyStyles: ['suv'] },
  'fuel-open': { budget: [10000, 60000], fuel: ['open'] },
  'body-any': { budget: [10000, 60000], bodyStyles: ['any'] },
  crew: { budget: [20000, 60000], people: 'crew' },
  family: { budget: [20000, 60000], people: 'family' },
  contradictory: {
    budget: [10000, 15000], bodyStyles: ['convertible'], fuel: ['ev'], people: 'crew',
    priorities: ['economy', 'performance'], charging: 'none', mileage: 25000,
  },
};

const FIXTURE_POOLS = {
  bmw: 'fixtures/bmw-cars.json', mini: 'fixtures/mini-cars.json', ford: 'fixtures/ford-cars.json',
  honda: 'fixtures/honda-cars.json', motorrad: 'fixtures/motorrad-bikes.json', ferrari: 'fixtures/ferrari-cars.json',
};

/** Deterministic in-memory corpus: { id, brand, tuning, cars, answers } cases. */
export function parityCorpus() {
  const input = readJson('server/test/fixtures/retail-compat-v1/inputs.json');
  const cases = [];
  const tunings = new Map();
  const tuningFor = (brand) => {
    if (!tunings.has(brand)) tunings.set(brand, deepFreeze(cloneTuning(brandTuning(brand))));
    return tunings.get(brand);
  };
  const add = (id, brand, cars, answers, tuningBrand = brand) => cases.push({
    id, brand, tuning: tuningFor(tuningBrand), cars, answers: deepFreeze(structuredClone(applyBespokeAnswers(brand, answers))),
  });

  // Compat cases first: cheap, and the limits pool exercises the listing sample cap.
  const pools = poolsFor(input);
  for (const c of input.cases) add(`compat:${c.id}`, c.brand, deepFreeze(pools[c.pool || c.brand]), c.answers);
  for (const h of input.hashes) add(`compat-hash:${h.id}`, h.brand ?? 'bmw', deepFreeze(pools[h.brand ?? 'bmw']), h.answers);

  const variants = {};
  for (const [brand, path] of Object.entries(FIXTURE_POOLS)) {
    const all = readJson(path);
    const a = everyKth(all);
    variants[brand] = {
      a: deepFreeze(a),
      b: deepFreeze(everyKth(all, 1).reverse()),
      c: deepFreeze(a.slice(0, 40)),
    };
  }

  for (const [i, p] of readJson('fixtures/personas.json').personas.entries()) {
    add(`persona:${p.key ?? i}`, p.brand, variants[p.brand].a, p.answers);
  }

  for (const brand of Object.keys(BRANDS)) {
    const rand = prng(seedOf(brand));
    for (const [name, brief] of Object.entries(EDGE_BRIEFS)) add(`edge:${brand}:${name}`, brand, variants[brand].a, brief);
    for (const band of Object.keys(BUDGET_BANDS)) add(`edge:${brand}:band-${band}`, brand, variants[brand].a, { budget: band });
    for (let n = 0; n < 60; n += 1) {
      const answers = sampleAnswers(brand, rand);
      for (const v of ['a', 'b', 'c']) add(`sample:${brand}:${n}:${v}`, brand, variants[brand][v], answers);
    }
  }

  // Unknown brand: tuning falls back to the default, bmw stock stands in.
  const rand = prng(seedOf('unknown-brand'));
  for (const [name, brief] of Object.entries(EDGE_BRIEFS)) add(`edge:unknown-brand:${name}`, 'unknown-brand', variants.bmw.a, brief);
  for (let n = 0; n < 12; n += 1) add(`sample:unknown-brand:${n}`, 'unknown-brand', variants.bmw.a, sampleAnswers('bmw', rand));
  return cases;
}

const CONSTANTS = ['WEIGHTS', 'PRIORITY_BOOSTS', 'STRETCH_FACTOR', 'TOP_MATCHES', 'CLUSTER_PTS', 'MAX_SHOWN',
  'TASTE_PTS', 'ALTERNATIVES', 'LISTING_SAMPLE'];
const MUTATION = /read.only|not extensible|Cannot (assign|add|delete|define)|frozen/i;

// Record an outcome, or the error it raised; a write to frozen input is never recorded.
function outcome(fn) {
  try {
    return { value: fn() };
  } catch (error) {
    if (error instanceof TypeError && MUTATION.test(error.message)) throw error;
    return { error: `${error?.name}: ${error?.message}` };
  }
}

function captureCase(engine, c) {
  const { answers, cars, tuning } = c;
  const rank = outcome(() => engine.rankCars(answers, cars, tuning));
  return {
    id: c.id,
    rank,
    groups: rank.error ? rank : outcome(() => engine.groupListings(rank.value)),
    match: outcome(() => engine.matchCars(answers, cars, tuning)),
    unmet: outcome(() => engine.unmetWants(answers, cars)),
    tradeOffs: outcome(() => cars.slice(0, 20).map((car) => engine.tradeOffs(answers, car))),
    budget: outcome(() => engine.budgetRange(answers)),
  };
}

function captureStatic(engine) {
  return {
    constants: Object.fromEntries(CONSTANTS.map((name) => [name, engine[name]])),
    exports: Object.keys(engine).sort(),
  };
}

// Any outbound fetch is recorded and refused for the duration of `fn`.
function withFetchGuard(fn) {
  const native = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (...args) => { calls.push(String(args[0])); throw new Error('retail parity harness: fetch is not allowed'); };
  try {
    return { result: fn(), calls };
  } finally {
    globalThis.fetch = native;
  }
}

/** Capture every case from an engine module namespace; fetch is refused throughout. */
export function captureEngine(engineModule, corpus) {
  const { result, calls } = withFetchGuard(() => ({
    ...captureStatic(engineModule),
    cases: corpus.map((c) => captureCase(engineModule, c)),
  }));
  return { ...result, fetchCalls: calls.length };
}

/** Deep compare on Object.is leaves; own-key order and array length count. */
export function firstDifference(actual, expected, path = '$') {
  if (Object.is(actual, expected)) return null;
  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') {
    return { path, actual, expected };
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) return { path, actual, expected };
  if (Array.isArray(actual) && actual.length !== expected.length) {
    return { path: `${path}.length`, actual: actual.length, expected: expected.length };
  }
  const [ak, ek] = [Object.keys(actual), Object.keys(expected)];
  if (!Array.isArray(actual)) {
    const at = ak.findIndex((key, i) => key !== ek[i]);
    if (at >= 0 || ak.length !== ek.length) {
      return { path: `${path}#keyOrder`, actual: ak, expected: ek };
    }
  }
  for (const key of ek) {
    const diff = firstDifference(actual[key], expected[key], `${path}.${key}`);
    if (diff) return diff;
  }
  return null;
}

/**
 * Compare two engine modules case by case, streaming so memory stays small.
 * @returns {{ comparisons: number, difference: ?{ caseId, path, actual, expected }, fetchCalls: number, scoreDigest: string, firstScores: number[] }}
 */
export function diffEngines(reference, candidate, corpus) {
  const digest = createHash('sha256');
  const firstScores = [];
  let comparisons = 0;
  let difference = null;
  const { calls } = withFetchGuard(() => {
    const [wantStatic, gotStatic] = [captureStatic(reference), captureStatic(candidate)];
    const missing = wantStatic.exports.filter((name) => !gotStatic.exports.includes(name));
    const staticDiff = missing.length
      ? { path: '$.exports', actual: missing, expected: [] }
      : firstDifference(gotStatic.constants, wantStatic.constants, '$.constants');
    if (staticDiff) { difference = { caseId: 'static', ...staticDiff }; return; }
    for (const c of corpus) {
      const want = captureCase(reference, c);
      const got = captureCase(candidate, c);
      for (const m of want.rank.value ?? []) digest.update(`${c.id}:${m.score};`);
      if (firstScores.length < 5 && want.rank.value?.length) firstScores.push(want.rank.value[0].score);
      const diff = firstDifference(got, want);
      comparisons += 1;
      if (diff) { difference = { caseId: c.id, ...diff }; return; }
    }
  });
  return { comparisons, difference, fetchCalls: calls.length, scoreDigest: digest.digest('hex'), firstScores };
}
