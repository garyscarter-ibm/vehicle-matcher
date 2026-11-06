import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { inputDigest, ok, FOUNDATION_TABLES } from '../gcsp/repository/core.js';
import { loadMigrations } from '../gcsp/migrations/index.js';

const context = { environmentId: 'supply-test', runId: 'supply-run', principalId: 'greg', roles: ['greg'] };
const provenance = { providerId: 'synthetic-production', mode: 'synthetic', sourceVersion: 'production-v1' };
async function records() {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store });
  assert.equal((await repository.open()).status, 'ok');
  let serial = 0;
  const write = (work) => { const id = `record-${++serial}`;
    return repository.transaction(context, { commandId: id, inputDigest: inputDigest(id) }, work); };
  assert.equal((await write((tx) => tx.insert('runs', { runId: context.runId,
    environmentId: context.environmentId, status: 'active', current: true }))).status, 'ok');
  return { store, repository, write };
}
const request = () => ({ runId: context.runId, requestId: 'request-a', commandId: 'submit-a',
  model: '3 Series', derivative: '320i Touring', quantity: 3, state: 'requested', requestedAt: '2026-11-06T00:00:00.000Z',
  requestedBy: context.principalId, policyVersion: 'policy-v1', stockVersion: 'stock-v1',
  providerReference: 'upstream-request-a', provenance, history: [] });
const supply = () => ({ runId: context.runId, supplyId: 'supply-a', requestId: 'request-a', commandId: 'confirm-a',
  quantity: 2, state: 'confirmed', confirmedAt: '2026-11-06T01:00:00.000Z',
  expectedAt: '2027-01-01T01:00:00.000Z', policyVersion: 'policy-v1',
  sourceVersion: 'production-v1', providerReference: 'upstream-ack-a', provenance });

test('business records persist separately across reopen and never create released stock', async () => {
  const f = await records();
  const written = await f.write(async (tx) => {
    const a = await tx.insert('future_order_requests', request());
    if (a.status !== 'ok') return a;
    return tx.insert('confirmed_supply', supply());
  });
  assert.equal(written.status, 'ok', JSON.stringify(written));
  await f.repository.close();
  const reopened = createMemoryRepository({ store: f.store }); await reopened.open();
  assert.equal((await reopened.query(context, 'future_order_requests')).value.length, 1);
  assert.equal((await reopened.query(context, 'confirmed_supply')).value[0].quantity, 2);
  assert.deepEqual((await reopened.query(context, 'stock')).value, []);
  const other = { ...context, runId: 'another-run' };
  assert.deepEqual((await reopened.query(other, 'confirmed_supply')).value, []);
  await reopened.close();
});

test('acknowledgement is immutable and must reference a request in the same run', async () => {
  const f = await records();
  const missing = await f.write((tx) => tx.insert('confirmed_supply', supply()));
  assert.equal(missing.status, 'conflict');
  assert.equal((await f.write((tx) => tx.insert('future_order_requests', request()))).status, 'ok');
  assert.equal((await f.write((tx) => tx.insert('confirmed_supply', supply()))).status, 'ok');
  const changed = await f.write((tx) => tx.compareAndSwap({ table: 'confirmed_supply',
    key: { runId: context.runId, supplyId: 'supply-a' } }, 1, { quantity: 3 }));
  assert.equal(changed.code, 'immutable-row');
  const duplicate = await f.write((tx) => tx.insert('confirmed_supply', { ...supply(), supplyId: 'supply-b' }));
  assert.equal(duplicate.status, 'conflict');
  await f.repository.close();
});

test('migration discovery and foundation snapshot include additive supply records', async () => {
  const migrations = await loadMigrations();
  const added = migrations.find((row) => row.filename === '0004_greg_supply.sql');
  assert.ok(added);
  for (const table of ['future_order_requests', 'confirmed_supply']) {
    assert.ok(FOUNDATION_TABLES.includes(table));
    assert.match(added.sql, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(added.sql, /REFERENCES future_order_requests\(run_id,request_id\)/);
});
