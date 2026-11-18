import test from 'node:test';
import assert from 'node:assert/strict';
import { inputDigest, ok } from '../gcsp/repository/index.js';
import { intentValue } from '../scenarios/employee/index.js';
import { allocationFixture } from './helpers/gcsp-allocation.js';

const intent = (brief) => ({
  preferences: Object.fromEntries(Object.entries(brief.preferences).map(([key, p]) => [key,
    { value: intentValue(p.value), importance: p.importance, valueState: p.valueState, importanceState: p.importanceState }])),
  essentials: Object.fromEntries(Object.entries(brief.essentials).map(([key, e]) => [key,
    { value: e.operator === 'includes' && Array.isArray(e.value) ? [...new Set(e.value)].sort() : e.value,
      operator: e.operator, unit: e.unit, state: e.state }])),
});
// The old scan is an independent oracle for retained-history joins and short circuiting.
const excluded = (rows, employeeId, orderUuid, brief) => rows.decisions.filter((d) => d.employeeId === employeeId && d.decision === 'decline'
  && rows.offers.some((o) => o.offerId === d.offerId && o.orderUuid === orderUuid)).some((d) => {
  const previous = rows.briefs.find((b) => b.employeeId === employeeId && b.briefVersion === d.versions?.brief);
  return !previous || inputDigest(intent(previous)) === inputDigest(intent(brief));
});
const declined = (employeeId, offerId, brief = 1) => ({ employeeId, offerId, decision: 'decline', versions: { brief } });
const currentBriefs = async (f) => (await f.repository.query(f.context, 'briefs')).value;
// Override only the detached snapshot read, allowing duplicate/legacy history the write schema cannot create.
const allocate = (f, rows) => f.create({ repository: { ...f.repository,
  transaction(context, command, work, options) {
    return f.repository.transaction(context, command, (tx) => work({ ...tx,
      async list(table) { return Object.hasOwn(rows, table) ? ok(rows[table]) : tx.list(table); },
    }), options);
  },
} }).allocate(f.context, f.event);
const assertOracle = (out, rows, briefs) => {
  assert.equal(out.status, 'ok', JSON.stringify(out));
  for (const evaluation of out.value.evaluations) {
    const brief = briefs.find((b) => b.employeeId === evaluation.employeeId);
    for (const decision of evaluation.decisions) assert.equal(decision.blockers.some((b) => b.code === 'declined-unchanged'),
      excluded(rows, evaluation.employeeId, decision.orderUuid, brief), `${evaluation.employeeId}/${decision.orderUuid}`);
  }
};

test('indexed declines preserve exact employee/car joins, duplicate offer IDs and first prior brief', async () => {
  const f = await allocationFixture({ cars: 3 }); const briefs = await currentBriefs(f);
  const [a, b] = briefs; const first = { ...a, status: 'draft', briefVersion: 0 };
  const later = { ...first, preferences: { body: { ...a.preferences.body, value: 'estate' } } };
  const rows = { briefs: [first, later, ...briefs], offers: [
    { offerId: 'duplicate|offer', orderUuid: f.stock(1).orderUuid },
    { offerId: 'duplicate|offer', orderUuid: f.stock(2).orderUuid },
    { offerId: 'other', orderUuid: f.stock(3).orderUuid },
  ], decisions: [declined(a.employeeId, 'duplicate|offer', 0), declined(b.employeeId, 'other'),
    { ...declined(a.employeeId, 'other'), decision: 'expired' }, declined('unrelated|employee', 'other')] };
  const before = structuredClone(rows); const out = await allocate(f, rows);
  assertOracle(out, rows, briefs); assert.deepEqual(rows, before, 'source history and provenance stay unchanged');
  assert.equal(out.value.evaluations.find((e) => e.employeeId === a.employeeId).decisions.filter((d) =>
    d.blockers.some((v) => v.code === 'declined-unchanged')).length, 2);
});

test('intent changes reopen while provenance and includes-list order retain exclusions', async () => {
  for (const change of ['provenance', 'preference', 'equipment-order']) {
    const f = await allocationFixture({ cars: 1 }); const briefs = await currentBriefs(f); const a = briefs[0];
    const previous = { ...a, briefVersion: 0, status: 'draft' };
    const current = { ...a, preferences: { body: { ...a.preferences.body, source: 'changed-source',
      confirmedAt: '2026-11-06T12:00:00.000Z', ...(change === 'preference' ? { value: 'estate' } : {}) } } };
    if (change === 'equipment-order') {
      const equipment = { operator: 'includes', unit: 'equipment-key', state: 'confirmed', source: 'employee' };
      previous.essentials = { ...a.essentials, equipment: { ...equipment, value: ['A', 'B', 'A'] } };
      current.essentials = { ...a.essentials, equipment: { ...equipment, value: ['B', 'A'] } };
    }
    const latest = [current, ...briefs.slice(1)];
    const rows = { briefs: [previous, ...latest], offers: [{ offerId: 'offer', orderUuid: f.stock().orderUuid }],
      decisions: [declined(a.employeeId, 'offer', 0)] };
    const out = await allocate(f, rows); assertOracle(out, rows, latest);
    const decision = out.value.evaluations.find((e) => e.employeeId === a.employeeId).decisions[0];
    assert.equal(decision.blockers.some((b) => b.code === 'declined-unchanged'), change !== 'preference');
  }
});

test('missing and legacy prior versions preserve strict matching and exclusion', async () => {
  for (const version of [undefined, null, '1', 404, NaN]) {
    const f = await allocationFixture({ cars: 1 }); const briefs = await currentBriefs(f); const a = briefs[0];
    const decision = declined(a.employeeId, 'offer', version);
    if (version === undefined) delete decision.versions;
    const rows = { briefs, offers: [{ offerId: 'offer', orderUuid: f.stock().orderUuid }], decisions: [decision] };
    const out = await allocate(f, rows); assertOracle(out, rows, briefs);
    assert.ok(out.value.evaluations.find((e) => e.employeeId === a.employeeId).decisions[0].blockers.some((b) => b.code === 'declined-unchanged'));
  }
});

test('irrelevant malformed briefs are not hashed; missing history short circuits later malformed matches', async () => {
  for (const shortCircuit of [false, true]) {
    const f = await allocationFixture({ cars: 1 }); const briefs = await currentBriefs(f); const a = briefs[0];
    const malformed = { ...a, briefVersion: 0, status: 'draft', preferences: null };
    const rows = { briefs: [malformed, ...briefs], offers: [{ offerId: 'offer', orderUuid: f.stock().orderUuid }],
      decisions: shortCircuit ? [declined(a.employeeId, 'offer', 404), declined(a.employeeId, 'offer', 0)] : [] };
    assertOracle(await allocate(f, rows), rows, briefs);
  }
  const f = await allocationFixture({ cars: 1 }); const briefs = await currentBriefs(f); const a = briefs[0];
  const rows = { briefs: [{ ...a, briefVersion: 0, status: 'draft', preferences: null }, ...briefs],
    offers: [{ offerId: 'offer', orderUuid: f.stock().orderUuid }], decisions: [declined(a.employeeId, 'offer', 0), declined(a.employeeId, 'offer', 404)] };
  assert.throws(() => excluded(rows, a.employeeId, f.stock().orderUuid, a), TypeError);
  assert.equal((await allocate(f, rows)).code, 'allocation-source-invalid');
});

test('history indexing stays linear as history and car counts grow and hashes each relevant prior once', async () => {
  for (const [history, cars] of [[12, 2], [24, 8]]) {
    const f = await allocationFixture({ cars }); const briefs = await currentBriefs(f); const a = briefs[0];
    const reads = { decisions: 0, offers: 0, briefs: 0, intent: 0 };
    const observe = (row, field, counter) => new Proxy(row, { get(target, key, receiver) {
      if (key === field) reads[counter] += 1;
      return Reflect.get(target, key, receiver);
    } });
    const prior = observe({ ...a, status: 'draft', briefVersion: 0 }, 'preferences', 'intent');
    const rows = { briefs: [prior, ...Array.from({ length: history }, (_, i) =>
      observe({ ...a, status: 'draft', briefVersion: -i - 1, preferences: null }, 'briefVersion', 'briefs')), ...briefs],
    offers: Array.from({ length: history }, (_, i) => observe({ offerId: `offer:${i}`, orderUuid: f.stock(i % cars + 1).orderUuid }, 'offerId', 'offers')),
    decisions: Array.from({ length: history }, (_, i) => observe(declined(a.employeeId, `offer:${i}`, 0), 'employeeId', 'decisions')) };
    const out = await allocate(f, rows); assert.equal(out.status, 'ok', JSON.stringify(out));
    assert.equal(out.value.evaluations.find((e) => e.employeeId === a.employeeId).decisions.length, cars);
    assert.equal(reads.intent, 1, 'one digest for a prior brief reused across cars');
    assert.ok(reads.decisions <= history * 3, JSON.stringify(reads));
    assert.ok(reads.offers <= history * 3, JSON.stringify(reads));
    assert.ok(reads.briefs <= history * 3, JSON.stringify(reads));
    assertOracle(out, rows, briefs);
  }
});
