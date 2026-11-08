import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { inputDigest, ok, result } from '../gcsp/repository/core.js';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { ManualReviewDetailsService } from '../gcsp/manual-review/index.js';
import { createManualReviewDetailsRoutes } from '../gcsp/manual-review/http.js';

const command = (id, payload = {}) => ({ commandId: id, inputDigest: inputDigest(payload) });
const ref = (f, table, key = {}) => ({ table, key: { runId: f.context.runId, ...key } });
const detail = (patch = {}) => ({ contact: { phone: '01632 960001', email: 'chooser@example.invalid' },
  expectedReturnMileage: 6700, specialRequirements: '', ...patch });
async function setup({ mode = 'replacement' } = {}) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  assert.equal((await repository.open()).status, 'ok');
  const policy = new PolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'review-details-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T09:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context;
  const time = await clock.now(context); const now = time.value.now;
  const timing = await policy.getAssumption('hold.cart.durationSeconds', { runId: context.runId, asOf: now, policyVersion: context.policyVersion });
  const expiresAt = new Date(Date.parse(now) + timing.value.value * 1000).toISOString();
  const f = { repository, store, policy, clock, identity, context, presenter: presenter.value.context, now, expiresAt, mode, reads: 0 };
  // Explicit claim-read contract double. These tests do not claim frozen FUCQ-66 reconciliation integration.
  f.claimReadDouble = { async readClaim(c) {
    f.reads += 1;
    const pointers = await repository.query(c, 'event_receipts', { consumerId: `manual:claim-current:${c.employeeId}:${c.entitlementSlotId}` });
    const pointer = pointers.value?.sort((a, b) => Number(a.eventId) - Number(b.eventId)).at(-1);
    if (!pointer) return result('not-found', { resourceType: 'manual-claim' });
    const hold = await repository.read(c, { table: 'holds', key: { runId: c.runId, holdId: pointer.outcome.value.holdId } });
    const quote = await repository.read(c, { table: 'quotes', key: { runId: c.runId, quoteId: hold.value.quoteId } });
    return ok({ state: hold.value.state === 'active' ? 'quoted' : hold.value.state, hold: hold.value, quote: quote.value, pendingOperation: null, now, clockVersion: time.value.clockVersion });
  } };
  const seeded = await repository.transaction(context, command('review-fixture'), async (tx) => {
    let outcome = await tx.insert('stock', { runId: context.runId, orderUuid: 'review-stock', orderNumber: '9000001', configurationId: 'synthetic-review-configuration', state: 'available', facts: {} });
    if (outcome.status !== 'ok') return outcome;
    outcome = await tx.insert('quotes', { runId: context.runId, quoteId: 'review-quote', orderUuid: 'review-stock', employeeId: context.employeeId,
      entitlementSlotId: context.entitlementSlotId, configurationId: 'synthetic-review-configuration', facts: {}, terms: { label: 'Synthetic typed quote' },
      draftVersion: 1, policyVersion: context.policyVersion, quotedAt: now, validUntil: new Date(Date.parse(now) + 86400000).toISOString() });
    if (outcome.status !== 'ok') return outcome;
    const slot = await tx.get(ref(f, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId }));
    outcome = await tx.conditionalClaim({ holdId: 'review-hold', claimId: 'review-claim', orderUuid: 'review-stock', employeeId: context.employeeId,
      entitlementSlotId: context.entitlementSlotId, type: 'cart', phase: 'preview', quoteId: 'review-quote', policyVersion: context.policyVersion,
      expiresAt, expectedStockVersion: 1, expectedSlotVersion: slot.value.version });
    if (outcome.status !== 'ok') return outcome;
    for (const draftVersion of [1, 2]) {
      const draft = { runId: context.runId, employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, draftVersion,
        draftStage: 'complete', policyVersion: context.policyVersion, currentContract: mode === 'replacement' ? { contractId: 'old-contract', label: 'Synthetic current car' } : null,
        contract: { contractOptionId: 'six-month-8000' }, choices: { ...detail({ expectedReturnMileage: mode === 'replacement' ? 6700 : null,
          specialRequirements: draftVersion === 1 ? 'Pinned inputs' : 'Newer unrelated draft' }), mode,
        oldContractId: mode === 'replacement' ? 'old-contract' : null, requestedCollectionDate: '2026-11-20', collectionLocationId: 'synthetic-site' } };
      outcome = await tx.recordReceipt({ consumerId: `manual:draft:${context.employeeId}`, eventId: String(draftVersion), inputDigest: inputDigest(draft), state: 'completed', outcome: ok(draft) });
      if (outcome.status !== 'ok') return outcome;
    }
    return tx.recordReceipt({ consumerId: `manual:claim-current:${context.employeeId}:${context.entitlementSlotId}`, eventId: '1', inputDigest: inputDigest({ holdId: 'review-hold' }), state: 'completed', outcome: ok({ holdId: 'review-hold' }) });
  });
  assert.equal(seeded.status, 'ok', JSON.stringify(seeded));
  f.service = service(f); return f;
}
const service = (f, overrides = {}) => new ManualReviewDetailsService({ ...f, manualClaims: f.claimReadDouble, ...overrides });
const input = (f, patch = {}) => ({ commandId: 'save-1', holdId: 'review-hold', quoteId: 'review-quote', expectedHoldVersion: 1,
  expectedDraftVersion: 1, expectedReviewDetailsVersion: 0, details: detail({ expectedReturnMileage: f.mode === 'replacement' ? 6700 : null }), ...patch });
const save = (f, patch) => f.service.saveReviewDetails(f.context, input(f, patch));
const read = (f) => f.service.readReviewDetails(f.context);
const binding = (f) => ({ runId: f.context.runId, employeeId: f.context.employeeId, entitlementSlotId: f.context.entitlementSlotId,
  holdId: 'review-hold', quoteId: 'review-quote', expectedHoldVersion: 1, expectedDraftVersion: 1 });
const freeze = (f, id = 'freeze', version = 1, b = binding(f)) => f.repository.transaction(f.context, command(id, { b, version }),
  (tx) => f.service.freezeReviewDetails(tx, b, version));
async function patchRow(f, table, key, patch, id = 'patch') {
  return f.repository.transaction(f.context, command(id, patch), async (tx) => {
    const found = await tx.get(ref(f, table, key)); return tx.compareAndSwap(ref(f, table, key), found.value.version, patch);
  });
}
async function advance(f, to = f.expiresAt) {
  const current = await f.clock.now(f.presenter);
  assert.equal((await f.clock.advance(f.presenter, { commandId: `advance-${to}`, expectedClockVersion: current.value.clockVersion, to })).status, 'ok');
  const advanced = await f.clock.now(f.presenter);
  assert.equal((await f.clock.tick(f.presenter, { eventId: `tick-${to}`, expectedClockVersion: advanced.value.clockVersion, inputDigest: inputDigest({ to }) })).status, 'ok');
}
const durableDomain = (f) => inputDigest(Object.fromEntries(Object.entries(f.store.state.tables).filter(([key]) => !['event_receipts', 'tick_runs'].includes(key))));

test('exact pinned draft, current contract/collection and policy projection; GET has no writes', async () => {
  const f = await setup(); const before = inputDigest(f.store.state);
  const r = await read(f); assert.equal(r.status, 'ok', JSON.stringify(r));
  assert.equal(r.value.details.specialRequirements, 'Pinned inputs'); assert.equal(r.value.reviewDetailsVersion, 0);
  assert.equal(r.value.currentContract.contractId, 'old-contract'); assert.equal(r.value.requestedCollection.date, '2026-11-20');
  assert.equal(r.value.constraints.maximumSpecialRequirements, 500); assert.equal(r.value.constraints.provenance.policyVersion, f.context.policyVersion);
  assert.equal(r.value.orderNumber, '9000001'); assert.equal(r.value.now, f.now); assert.equal(r.value.editable, true); assert.equal(inputDigest(f.store.state), before); assert.equal(f.reads, 1);
});
test('save/reopen/revision race preserves domain data and exact historical replay', async () => {
  const f = await setup(); const domain = durableDomain(f);
  const [a, b] = await Promise.all([save(f), save(f, { commandId: 'other-tab' })]);
  assert.deepEqual([a.status, b.status].sort(), ['ok', 'stale-version']);
  assert.equal(durableDomain(f), domain);
  const reopened = service(f); const r = await reopened.readReviewDetails(f.context); assert.equal(r.value.reviewDetailsVersion, 1);
  const first = a.status === 'ok' ? a : b; const firstInput = a.status === 'ok' ? {} : { commandId: 'other-tab' };
  assert.equal((await save(f, { commandId: 'save-2', expectedReviewDetailsVersion: 1, details: detail({ specialRequirements: 'Later inputs' }) })).status, 'ok');
  assert.deepEqual(await save(f, firstInput), first);
  assert.equal((await save(f, { ...firstInput, details: detail({ specialRequirements: 'Changed retry' }) })).code, 'idempotency-input-changed');
  await advance(f);
  const failing = service(f, { policy: { getAssumption() { throw new Error('offline'); } } });
  assert.deepEqual(await failing.saveReviewDetails(f.context, input(f, firstInput)), first);
  const expired = await read(f); assert.equal(expired.value.editable, false); assert.equal(expired.value.canContinue, false);
  assert.equal(expired.value.details.specialRequirements, 'Later inputs');
  assert.equal((await save(f, { commandId: 'late-save', expectedReviewDetailsVersion: 2 })).code, 'claim-expired');
});
test('exact persisted deadline and source failures fail closed', async () => {
  const f = await setup(); await advance(f);
  assert.equal((await save(f)).code, 'claim-expired');
  const p = service(f, { policy: { getAssumption: async () => result('unavailable', { reason: 'offline' }) } });
  assert.equal((await p.readReviewDetails(f.context)).status, 'unavailable');
  assert.equal((await p.saveReviewDetails(f.context, input(f))).status, 'unavailable');
});
test('boundaries validate exact fields, integers, unknown keys, UTF-16 and control characters atomically', async () => {
  const f = await setup(); const before = inputDigest(f.store.state);
  for (const [details, field] of [
    [detail({ contact: { phone: '', email: 'valid@example.invalid' } }), 'contact.phone'],
    [detail({ contact: { phone: '01632 960001', email: 'bad' } }), 'contact.email'],
    [detail({ contact: { phone: '01632 960001', email: 'ok@example.invalid', extra: true } }), 'contact'],
    [detail({ expectedReturnMileage: -1 }), 'expectedReturnMileage'], [detail({ expectedReturnMileage: 500001 }), 'expectedReturnMileage'],
    [detail({ expectedReturnMileage: 1.5 }), 'expectedReturnMileage'], [detail({ expectedReturnMileage: '12' }), 'expectedReturnMileage'],
    [detail({ specialRequirements: 'x'.repeat(501) }), 'specialRequirements'], [detail({ specialRequirements: '😀'.repeat(251) }), 'specialRequirements'],
    [detail({ specialRequirements: 'control\u0000' }), 'specialRequirements'], [detail({ surprise: true }), 'details'],
  ]) {
    const r = await save(f, { details }); assert.equal(r.status, 'invalid', JSON.stringify(r)); assert.equal(r.reasons[0].field, field);
  }
  assert.equal((await save(f, { clientEmployee: 'fake' })).status, 'invalid');
  assert.equal(inputDigest(f.store.state), before);
  assert.equal((await save(f, { details: detail({ expectedReturnMileage: 500000, specialRequirements: '😀'.repeat(250) }) })).status, 'ok');
});
test('new order has no return-mileage requirement; zero valid on replacement', async () => {
  const f = await setup({ mode: 'new' });
  assert.equal((await save(f, { details: detail({ expectedReturnMileage: 1 }) })).reasons[0].field, 'expectedReturnMileage');
  const noMileage = detail(); delete noMileage.expectedReturnMileage;
  assert.equal((await save(f, { details: noMileage })).status, 'ok');
  const replacement = await setup(); assert.equal((await save(replacement, { details: detail({ expectedReturnMileage: 0 }) })).status, 'ok');
});
test('trusted role, run, owner, quote, hold and pinned draft revisions are required', async () => {
  const f = await setup();
  const forbidden = service(f, { identity: { requireRole: async (_context, role) => { assert.equal(role, 'employee'); return result('forbidden', { reason: 'test guard' }); } } });
  assert.equal((await forbidden.readReviewDetails(f.context)).status, 'forbidden');
  assert.equal((await forbidden.saveReviewDetails(f.context, input(f))).status, 'forbidden');
  assert.equal((await f.service.saveReviewDetails({ ...f.context, runId: 'another-run' }, input(f))).status, 'forbidden');
  const trustedGuardDouble = service(f, { identity: { requireRole: async () => ok({}) } });
  assert.equal((await trustedGuardDouble.saveReviewDetails({ ...f.context, runId: 'another-run' }, input(f))).status, 'stale-run');
  assert.equal((await save(f, { holdId: 'another-hold' })).code, 'claim-binding-changed');
  assert.equal((await save(f, { quoteId: 'another-quote' })).code, 'quote-binding-changed');
  assert.equal((await save(f, { expectedHoldVersion: 99 })).resource, 'hold');
  assert.equal((await save(f, { expectedDraftVersion: 2 })).resource, 'manual-draft');
  const imposter = { ...f.context, employeeId: 'someone-else' };
  assert.equal((await f.service.saveReviewDetails(imposter, input(f))).status, 'forbidden');
  assert.equal((await freeze(f, 'wrong-owner', 0, { ...binding(f), employeeId: 'someone-else' })).status, 'not-found');
  const noClaim = await setup();
  noClaim.store.state.tables.event_receipts = noClaim.store.state.tables.event_receipts.filter((r) => !r.consumerId.startsWith('manual:claim-current:'));
  assert.equal((await read(noClaim)).status, 'not-found'); assert.equal((await save(noClaim)).status, 'not-found');
});
test('canonical changed policy constraints used, pinned version retained, invalid source rejected', async () => {
  const f = await setup(); const provider = new FilePolicyProvider(); const versions = structuredClone(await provider.loadVersions({}));
  const row = versions[0].assumptions.find((r) => r.key === 'manual.context.v1');
  row.value.maximumSpecialRequirements = 3; row.value.maximumReturnMileage = 10;
  const policy = new PolicyService({ provider: { loadVersions: async () => versions } });
  const s = service(f, { policy });
  const r = await s.readReviewDetails(f.context); assert.equal(r.value.constraints.maximumSpecialRequirements, 3);
  assert.equal((await s.saveReviewDetails(f.context, input(f))).reasons[0].field, 'expectedReturnMileage');
  assert.equal((await s.saveReviewDetails(f.context, input(f, { details: detail({ expectedReturnMileage: 10, specialRequirements: 'four' }) }))).reasons[0].field, 'specialRequirements');
  assert.equal((await s.saveReviewDetails(f.context, input(f, { details: detail({ expectedReturnMileage: 10, specialRequirements: 'yes' }) }))).status, 'ok');
  const wrong = service(f, { policy: { getAssumption: async () => ({ status: 'ok', policyVersion: 'wrong', value: row }) } });
  assert.equal((await wrong.readReviewDetails(f.context)).status, 'unavailable');
  await patchRow(f, 'runs', {}, { policyVersion: 'later-active-policy' }, 'policy-activation');
  assert.equal((await read(f)).value.constraints.provenance.policyVersion, f.context.policyVersion);
});
test('freeze revision zero refuses, exact saved snapshot locks edits, repeat is idempotent', async () => {
  const f = await setup(); assert.equal((await freeze(f, 'zero', 0)).code, 'review-details-not-saved');
  assert.equal((await save(f)).status, 'ok'); const domain = durableDomain(f);
  const frozen = await freeze(f); assert.equal(frozen.status, 'ok', JSON.stringify(frozen));
  assert.equal(frozen.value.reviewDetailsVersion, 1); assert.equal(frozen.value.constraints.maximumSpecialRequirements, 500);
  assert.deepEqual(await freeze(f, 'repeat'), frozen);
  assert.equal((await freeze(f, 'different', 2)).status, 'stale-version');
  assert.equal((await save(f, { commandId: 'after-freeze', expectedReviewDetailsVersion: 1 })).code, 'review-details-locked');
  assert.equal((await read(f)).value.editable, false); assert.equal(durableDomain(f), domain);
});
test('save before freeze races by exact version; freeze before save prevents editing', async () => {
  const f = await setup(); await save(f);
  let entered; const inside = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const ordered = service(f, { repository: { ...f.repository, transaction: (context, cmd, work) => f.repository.transaction(context, cmd, async (tx) => { entered(); await gate; return work(tx); }) } });
  const saving = ordered.saveReviewDetails(f.context, input(f, { commandId: 'second', expectedReviewDetailsVersion: 1 }));
  await inside; const freezing = freeze(f); release();
  const [saved, frozen] = await Promise.all([saving, freezing]);
  assert.equal(saved.status, 'ok'); assert.equal(frozen.status, 'stale-version');
  assert.equal((await freeze(f, 'latest-freeze', 2)).status, 'ok');
  const g = await setup(); await save(g);
  const [locked, late] = await Promise.all([freeze(g), save(g, { commandId: 'second', expectedReviewDetailsVersion: 1 })]);
  assert.equal(locked.status, 'ok'); assert.equal(late.code, 'review-details-locked');
});
test('caller rollback removes freeze and selection together; no nested transactions or source calls', async () => {
  const f = await setup(); await save(f); const before = inputDigest(f.store.state);
  const isolated = new ManualReviewDetailsService();
  const r = await f.repository.transaction(f.context, command('rolled-back-selection'), async (tx) => {
    assert.equal((await isolated.freezeReviewDetails(tx, binding(f), 1)).status, 'ok');
    return result('conflict', { reason: 'selection failed' });
  });
  assert.equal(r.status, 'conflict'); assert.equal(inputDigest(f.store.state), before);
  assert.equal((await save(f, { commandId: 'after-rollback', expectedReviewDetailsVersion: 1 })).status, 'ok');
});
test('freeze and save refuse pending selection, allocation and deadline without domain mutations', async () => {
  for (const state of ['selection-pending', 'allocated', 'expired']) {
    const f = await setup(); await save(f); await patchRow(f, 'holds', { holdId: 'review-hold' }, { state }, `hold-${state}`);
    const domain = durableDomain(f);
    const b = { ...binding(f), expectedHoldVersion: 2 };
    const s = await save(f, { commandId: 'blocked', expectedHoldVersion: 2, expectedReviewDetailsVersion: 1 });
    assert.equal(s.status, 'conflict'); assert.equal((await freeze(f, 'blocked-freeze', 1, b)).status, 'conflict');
    assert.equal(durableDomain(f), domain);
  }
  const f = await setup(); await save(f);
  await f.repository.transaction(f.context, command('pending-op'), (tx) => tx.insert('pending_operations', { runId: f.context.runId,
    operationId: 'selection-pending', operationType: 'manual-allocate', idempotencyKey: 'selection', inputDigest: inputDigest({}), state: 'pending', holdId: 'review-hold' }));
  assert.equal((await save(f, { commandId: 'pending-save', expectedReviewDetailsVersion: 1 })).code, 'review-details-locked');
  assert.equal((await freeze(f)).code, 'review-details-locked');
  const expired = await setup(); await save(expired); await advance(expired); assert.equal((await freeze(expired)).code, 'claim-expired');
});
test('route factory is additive, rejects query selectors and does not couple release to validation', async () => {
  const f = await setup(); const routes = createManualReviewDetailsRoutes(f.service);
  assert.deepEqual(routes.map((r) => [r.method, r.path, r.role]), [['GET', '/api/gcsp/manual/review-details', 'employee'], ['POST', '/api/gcsp/manual/review-details', 'employee']]);
  assert.equal((await routes[0].handle({ context: f.context, searchParams: new URLSearchParams('employee=fake') })).status, 'invalid');
  assert.equal((await routes[0].handle({ context: f.context, searchParams: new URLSearchParams() })).status, 'ok');
  assert.equal((await routes[1].handle({ context: f.context, body: input(f, { details: detail({ contact: {} }) }), searchParams: new URLSearchParams() })).status, 'invalid');
  assert.equal((await createManualReviewDetailsRoutes()[0].handle({ searchParams: new URLSearchParams() })).status, 'unavailable');
});


test('clock advance during policy preparation fences a save without partial receipts', async () => {
  const f = await setup(); let moved = false;
  const changing = service(f, { policy: { async getAssumption(key, readContext) {
    const constraints = await f.policy.getAssumption(key, readContext);
    if (!moved) { moved = true; await advance(f, new Date(Date.parse(f.now) + 1000).toISOString()); }
    return constraints;
  } } });
  const r = await changing.saveReviewDetails(f.context, input(f));
  assert.equal(r.status, 'stale-version'); assert.equal(r.resource, 'clock');
  assert.equal((await read(f)).value.reviewDetailsVersion, 0);
});
test('missing pinned receipt, cross-owner quote and malformed metadata fail closed', async () => {
  const missing = await setup();
  missing.store.state.tables.event_receipts = missing.store.state.tables.event_receipts.filter((row) => !(row.consumerId.startsWith('manual:draft:') && row.eventId === '1'));
  assert.equal((await read(missing)).source, 'pinned-draft'); assert.equal((await save(missing)).status, 'unavailable');
  const owner = await setup(); owner.store.state.tables.quotes.find((q) => q.quoteId === 'review-quote').employeeId = 'another-employee';
  assert.equal((await read(owner)).code, 'quote-binding-changed'); assert.equal((await save(owner)).code, 'quote-binding-changed');
  const corrupt = await setup(); await save(corrupt);
  corrupt.store.state.tables.event_receipts.find((r) => r.consumerId.startsWith('manual:review-details:')).outcome = ok({});
  assert.equal((await read(corrupt)).source, 'metadata'); assert.equal((await freeze(corrupt)).source, 'metadata');
});

test('reload stock label is bound to exact quoted configuration', async () => {
  const f = await setup();
  f.store.state.tables.stock.find((row) => row.orderUuid === 'review-stock').configurationId = 'another-configuration';
  assert.equal((await read(f)).code, 'stock-binding-changed');
  assert.equal((await save(f)).code, 'stock-binding-changed');
});
