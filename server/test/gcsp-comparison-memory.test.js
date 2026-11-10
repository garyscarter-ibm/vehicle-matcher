import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createComparisonRepository, createComparisonStore } from '../gcsp/comparison/private-repository.js';
import { inputDigest, ok } from '../gcsp/repository/core.js';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { loadComparisonPolicy, generateComparisonInputs } from '../gcsp/comparison/generator.js';
import { evaluateComparisonSeed } from '../gcsp/comparison/evaluation.js';
import { openComparisonRun } from '../gcsp/comparison/harness.js';
import { replayBuddyRoute } from '../gcsp/comparison/routes/buddy.js';
import { replayCurrentRoute } from '../gcsp/comparison/routes/current.js';

const context = { environmentId: 'private-comparison', runId: 'private-run', principalId: 'presenter', roles: ['presenter'] };
const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const quoteRef = (quoteId) => ({ table: 'quotes', key: { runId: context.runId, quoteId } });
const payload = () => ({ facts: [{ value: 'estate', provenance: { source: 'same-source', version: 'v1' } }], score: 87 });
async function repository(t) {
  const store = createComparisonStore();
  const repo = createComparisonRepository({ store, now: () => '2026-11-05T09:00:00.000Z' });
  assert.equal((await repo.open()).status, 'ok'); t.after(() => repo.close());
  assert.equal((await repo.transaction(context, command('seed'), (tx) => tx.insert('runs', {
    runId: context.runId, environmentId: context.environmentId, status: 'active', current: true,
  }))).status, 'ok');
  return { store, repo };
}

test('repeated retained quote and command data share immutable subtrees without changing their values', async (t) => {
  const { store, repo } = await repository(t);
  const outcome = await repo.transaction(context, command('quotes'), async (tx) => {
    for (const quoteId of ['first', 'second']) {
      const saved = await tx.insert('quotes', { runId: context.runId, quoteId, facts: payload() });
      if (saved.status !== 'ok') return saved;
    }
    return ok({ original: payload() });
  });
  assert.equal(outcome.status, 'ok');
  const [first, second] = store.state.tables.quotes;
  assert.deepEqual(first.facts, { facts: [{ value: 'estate', provenance: { source: 'same-source', version: 'v1' } }], score: 87 });
  assert.equal(first.facts, second.facts, 'identical retained quote bodies must share storage');
  const receipt = store.state.tables.event_receipts.find((row) => row.consumerId === 'command:transaction' && row.eventId === 'quotes');
  assert.equal(receipt.outcome.value.original, first.facts, 'original response remains complete and shares the same immutable value');
  assert.ok(Object.isFrozen(first.facts) && Object.isFrozen(first.facts.facts[0].provenance));
});

test('sharing preserves original command replay, rollback and caller isolation after later writes', async (t) => {
  const { repo } = await repository(t);
  const original = await repo.transaction(context, command('original'), (tx) => tx.insert('quotes', {
    runId: context.runId, quoteId: 'original', facts: payload(),
  }));
  const saved = structuredClone(original);
  original.value.facts.facts[0].value = 'caller-change';
  const read = await repo.read(context, quoteRef('original'));
  assert.equal(read.value.facts.facts[0].value, 'estate'); read.value.facts.score = 0;
  await repo.transaction(context, command('later'), (tx) => tx.insert('quotes', {
    runId: context.runId, quoteId: 'later', facts: { ...payload(), score: 50 },
  }));
  const rolledBack = await repo.transaction(context, command('rollback'), async (tx) => {
    await tx.insert('quotes', { runId: context.runId, quoteId: 'aborted', facts: payload() });
    return { status: 'conflict', reason: 'deliberate-rollback' };
  });
  assert.equal(rolledBack.status, 'conflict');
  assert.equal((await repo.read(context, quoteRef('aborted'))).status, 'not-found');
  const retried = await repo.transaction(context, command('rollback'), (tx) => tx.insert('quotes', {
    runId: context.runId, quoteId: 'retried', facts: payload(),
  }));
  assert.equal(retried.status, 'ok', 'a rolled-back command has no committed response to replay');
  assert.deepEqual(await repo.transaction(context, command('rollback'), () => assert.fail('retry must now replay')), retried);
  const failed = await repo.transaction(context, command('thrown'), async (tx) => {
    await tx.insert('quotes', { runId: context.runId, quoteId: 'thrown-away', facts: payload() });
    throw new Error('deliberate callback failure');
  });
  assert.equal(failed.status, 'unavailable');
  assert.equal((await repo.read(context, quoteRef('thrown-away'))).status, 'not-found');
  assert.equal((await repo.transaction(context, command('thrown'), () => ok({ recovered: true }))).status, 'ok');
  const replay = await repo.transaction(context, command('original'), () => assert.fail('replay must use the original response'));
  assert.deepEqual(replay, saved);
  assert.equal((await repo.transaction(context, { ...command('original'), inputDigest: inputDigest('changed') }, () => ok({}))).status, 'conflict');
});

test('sharing keeps ordered JSON, special property names and unequal nested values distinct', async (t) => {
  const { store, repo } = await repository(t);
  const bodies = [JSON.parse('{"toString":{"safe":true},"a":1,"b":2}'),
    JSON.parse('{"b":2,"a":1,"toString":{"safe":true}}'), { nested: ['a', 'b'] }, { nested: ['a,b'] }];
  const outcome = await repo.transaction(context, command('ordered'), async (tx) => {
    for (const [index, facts] of bodies.entries()) {
      const saved = await tx.insert('quotes', { runId: context.runId, quoteId: `ordered-${index}`, facts });
      if (saved.status !== 'ok') return saved;
    }
    return ok({ saved: true });
  });
  assert.equal(outcome.status, 'ok');
  const stored = store.state.tables.quotes.map((row) => row.facts);
  assert.deepEqual(stored.map(JSON.stringify), bodies.map(JSON.stringify));
  assert.notEqual(stored[0], stored[1]); assert.notEqual(stored[2], stored[3]);
  assert.equal(Object.getPrototypeOf(stored[0]), Object.prototype);
  assert.equal(Object.hasOwn(stored[0], 'toString'), true);
});

for (const kind of ['frozen', 'read-only']) {
  test(`normalizing ${kind} stored rows preserves values and shares repeated nested content`, () => {
    const store = createComparisonStore();
    const first = { quoteId: 'first', facts: payload() };
    store.state = { ...store.state, tables: { ...store.state.tables, quotes: [first] } };
    const second = { quoteId: 'second', facts: payload() };
    if (kind === 'frozen') {
      Object.freeze(second.facts.facts[0].provenance); Object.freeze(second.facts.facts[0]);
      Object.freeze(second.facts.facts); Object.freeze(second.facts); Object.freeze(second);
    } else Object.defineProperty(second, 'facts', { writable: false });
    const original = structuredClone(second);
    assert.doesNotThrow(() => {
      store.state = { ...store.state, tables: { ...store.state.tables, quotes: [first, second] } };
    });
    const rows = store.state.tables.quotes;
    assert.deepEqual(rows[1], original);
    assert.deepEqual(second, original);
    assert.equal(rows[0].facts, rows[1].facts);
    assert.ok(Object.isFrozen(rows[1]) && Object.isFrozen(rows[1].facts));
  });
}

const policy = new PolicyService({ provider: new FilePolicyProvider() });
const fixture = JSON.parse(await readFile(new URL('./fixtures/gcsp-comparison-buddy-outcomes.json', import.meta.url), 'utf8'));
async function runFor(t, route) {
  const source = await loadComparisonPolicy({ policyService: policy,
    policyRead: { runId: 'memory-regression-preparation', asOf: '2026-11-05T09:00:00.000Z' } });
  const inputs = generateComparisonInputs(fixture.seed, source, { overlay: fixture.overlay });
  const evaluation = await evaluateComparisonSeed({ inputs, policy });
  const run = await openComparisonRun({ inputs, policy, evaluation, route, codeRevision: 'memory-regression' });
  t.after(() => run.close()); return run;
}

for (const [route, replay] of [['current', replayCurrentRoute], ['buddy', replayBuddyRoute]]) {
  test(`${route} completion verifies real outcomes without copying the full receipt history`, async (t) => {
    const run = await runFor(t, route);
    const record = await replay({ ...run, snapshot() { assert.fail('completion must use narrow table reads'); } });
    assert.equal(record.route, route); assert.equal(record.employees.length, fixture.overlay['comparison.cohortSize']);
    const diagnostic = await run.snapshot();
    assert.ok(diagnostic.event_receipts.length > 0, 'full diagnostic snapshot remains available');
    assert.equal(record.cars.length, diagnostic.stock.length);
  });
}

test('closing a private comparison repository is terminal even when services retain its handle', async (t) => {
  const run = await runFor(t, 'buddy');
  const query = run.repository.query;
  let notifications = 0;
  const unsubscribe = run.repository.afterCommit(() => { notifications += 1; });
  await run.close();
  assert.equal((await run.repository.open()).status, 'unavailable');
  assert.equal((await query(run.presenter, 'quotes')).status, 'unavailable');
  assert.doesNotThrow(unsubscribe);
  assert.equal(notifications, 0);
  assert.equal((await run.close()).status, 'ok');
});
