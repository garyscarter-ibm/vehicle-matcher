import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { PolicyService, createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { ManualOrderService, SchemeOrderTerms, createManualOrderConversion } from '../gcsp/manual-order/index.js';
import { createSyntheticOrderingAdapter } from '../gcsp/adapters/synthetic-ordering.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { stock, fact } from './helpers/employee-recommendation.js';

const instant = '2026-11-05T09:00:00.000Z';
const fixtures = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq71/response-fixtures.json', import.meta.url), 'utf8'));
const cmd = (commandId, value = {}) => ({ commandId, inputDigest: inputDigest(value) });
const ref = (f, table, key) => ({ table, key: { runId: f.context.runId, ...key } });
const termsValue = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'))
  .assumptions.find((row) => row.key === 'ordering.terms.v1').value;
async function policyWith({ hr = true, terms = termsValue, missing = false } = {}) {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const metadata = { unit: 'versioned synthetic ordering contract', status: 'assumed', basis: 'Explicit test-only policy inputs, no deployed fallback.',
    source: 'server/test/gcsp-manual-order.test.js', sourceDate: '2026-11-05', policyVersion: seed.policyVersion, effectiveFrom: seed.effectiveFrom };
  seed.assumptions = seed.assumptions.filter((row) => !['ordering.terms.v1', 'ordering.approvalStages.v1'].includes(row.key));
  if (!missing) seed.assumptions.push({ ...metadata, key: 'ordering.terms.v1', value: terms }, { ...metadata, key: 'ordering.approvalStages.v1',
    value: [...(hr ? ['HR approval'] : []), 'sales-manager approval', 'sent to ordering'] });
  return new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
}
async function runtime(policy) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store, now: () => instant });
  assert.equal((await repository.open()).status, 'ok');
  const result = await createDemoRuntime({ repository, policy, environmentId: 'manual-order-test', environmentKind: 'synthetic',
    policyAsOf: instant, commandId: 'bootstrap', sessionNow: () => instant });
  assert.equal(result.status, 'ok', JSON.stringify(result));
  const { clock, identity } = result.value;
  const presenter = (await identity.createPresenterSession('presenter')).value;
  const acting = (await identity.switchPrincipal(presenter.context, 'demo-paula', 'paula')).value;
  return { store, repository, policy, clock, identity, presenter, context: acting.context };
}
async function setup(options = {}) {
  const f = await runtime(await policyWith(options));
  const choices = { mode: 'replacement', contact: { phone: '01632 960001', email: 'chooser@example.invalid' },
    expectedReturnMileage: 6700, driverId: 'fictional-driver' };
  f.prepared = { draft: { draftVersion: 1, choices }, employee: { fictional: true }, driver: { fictional: true }, oldContract: { contractId: 'old-contract' } };
  const car = stock(11, { insuranceGroup: fact(25, 'insurance-group') });
  const seeded = await f.repository.transaction(f.context, cmd('seed'), async (tx) => {
    const inserted = await tx.insert('stock', { runId: f.context.runId, orderUuid: car.orderUuid, orderNumber: '0000001',
      configurationId: car.configurationId, facts: car.snapshot, state: 'available', available: true });
    if (inserted.status !== 'ok') return inserted;
    const quote = await tx.insert('quotes', { runId: f.context.runId, quoteId: 'quote', orderUuid: car.orderUuid,
      employeeId: f.context.employeeId, entitlementSlotId: f.context.entitlementSlotId, configurationId: car.configurationId,
      facts: car.snapshot, terms: { fictional: true }, draftVersion: 1, policyVersion: f.context.policyVersion,
      quotedAt: instant, validUntil: '2026-12-01T00:00:00.000Z' });
    if (quote.status !== 'ok') return quote;
    const slot = await tx.get(ref(f, 'entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId }));
    return tx.conditionalClaim({ orderUuid: car.orderUuid, holdId: 'hold', claimId: 'claim', type: options.type ?? 'cart',
      employeeId: f.context.employeeId, entitlementSlotId: f.context.entitlementSlotId, phase: 'order-review',
      quoteId: 'quote', state: 'active', expiresAt: '2026-11-05T09:10:00.000Z', policyVersion: f.context.policyVersion,
      expectedStockVersion: 1, expectedSlotVersion: slot.value.version });
  });
  assert.equal(seeded.status, 'ok', JSON.stringify(seeded));
  f.allocateCalls = 0;
  f.converter = { async prepare() { return ok(f.prepared); }, async allocate(context, input) {
    f.allocateCalls += 1;
    return f.repository.transaction(context, cmd(`fixture-allocate:${input.commandId}`), async (tx) => {
      const operation = await tx.get(ref(f, 'pending_operations', { operationId: input.commandId }));
      assert.equal(operation.status, 'ok', 'intent must be durable before allocation');
      const history = await tx.list('event_receipts', { eventType: 'selection-received' }); assert.equal(history.value.length, 1);
      for (const [table, key] of [['holds', { holdId: 'hold' }], ['claims', { claimId: 'claim' }],
        ['stock', { orderUuid: car.orderUuid }], ['entitlement_slots', { entitlementSlotId: context.entitlementSlotId }]]) {
        const current = await tx.get(ref(f, table, key));
        const changed = await tx.compareAndSwap(ref(f, table, key), current.value.version,
          { state: 'allocated', ...(table === 'stock' ? { available: false, allocated: true } : {}) });
        if (changed.status !== 'ok') return changed;
      }
      return ok({ state: 'allocated' });
    });
  } };
  f.adapter = options.adapter?.(f) ?? createSyntheticOrderingAdapter(f);
  f.converters = { [options.type ?? 'cart']: f.converter };
  f.service = new ManualOrderService({ ...f, converters: f.converters });
  assert.equal((await f.service.registerClockHandler()).status, 'ok');
  const terms = await f.service.readTerms(f.context); assert.equal(terms.status, 'ok', JSON.stringify(terms));
  f.input = { commandId: 'submit', source: { type: options.type ?? 'cart', holdId: 'hold', expectedHoldVersion: 1, expectedDraftVersion: 1 },
    expectedQuoteId: 'quote', expectedStockVersion: 2, termsDigest: terms.value.termsDigest,
    declarations: { terms: true, driver: true, return: true } };
  return f;
}
const readOperation = async (f) => (await f.repository.query(f.context, 'pending_operations', { operationType: 'selection-order' })).value[0];
const scoped = (o, status) => ({ status, operationId: o.operationId, runId: o.runId, orderUuid: o.payload.orderUuid });
async function advance(f, bySeconds) {
  const state = (await f.clock.readState(f.presenter.context)).value;
  const advanced = await f.clock.advance(f.presenter.context, { commandId: `advance-${state.clockVersion}-${bySeconds}`, expectedClockVersion: state.clockVersion, bySeconds });
  if (advanced.status !== 'ok') return advanced;
  return f.clock.tick(f.presenter.context, { eventId: `tick-${state.clockVersion}-${bySeconds}`, expectedClockVersion: advanced.value.clockVersion, inputDigest: inputDigest({ bySeconds }) });
}

const caseSource = process.env.GCSP_F71_CASE_SOURCE_BASE64;
async function pinnedRenewalCases(f) {
  // Actual consumer from F100 4037b762086113e4970f651161471b603d39b4d5; only imports are relocated.
  const source = Buffer.from(caseSource, 'base64').toString('utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), 'a080a47479444a94f041de1b0c094974c3eea655a8076f771ec33f82ecb43379');
  for (const [path, hash] of [
    ['../gcsp/cases/policy.js', 'c6ee2d24b019695a8bf3663fe2dd22fee5705aac65a7fff834f21b5c219209e7'],
    ['../gcsp/policy/file-provider.js', '3b2662d3ac93346f07b07399401835d7138f85c32ef65443a9685a6c370d64ad'],
    ['../gcsp/manual-context/ports.js', 'c1e7db5012f6d3212b79ad989e6cde5a0e390e2f4bfe50f91ee4c79c8a7a1267'],
  ]) assert.equal(createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex'), hash);
  const imports = new Set(['../repository/index.js', '../policy/file-provider.js', '../recommendation/index.js', '../manual-context/ports.js', './policy.js']);
  const relocated = source.replace(/from '(\.[^']+)'/g, (statement, specifier) => {
    assert.ok(imports.delete(specifier), `Unexpected consumer dependency: ${specifier}`);
    return `from '${new URL(specifier, new URL('../gcsp/cases/index.js', import.meta.url)).href}'`;
  });
  assert.equal(imports.size, 0);
  const { RenewalCaseService } = await import(`data:text/javascript;base64,${Buffer.from(relocated).toString('base64')}`);
  return new RenewalCaseService(f);
}
async function renewalAuthority(f, { employeeRenewal = null, slotRenewal = null, holdRenewal } = {}) {
  const changed = await f.repository.transaction(f.context, cmd(`renewal:${inputDigest({ employeeRenewal, slotRenewal, holdRenewal: holdRenewal ?? null })}`), async (tx) => {
    const employee = await tx.get(ref(f, 'employees', { employeeId: f.context.employeeId }));
    const updated = await tx.compareAndSwap(ref(f, 'employees', { employeeId: f.context.employeeId }), employee.value.version,
      { renewalId: employeeRenewal, contract: { ...employee.value.contract, contractEndDate: '2026-11-10' } });
    if (updated.status !== 'ok') return updated;
    const slot = await tx.get(ref(f, 'entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId }));
    const entitled = await tx.compareAndSwap(ref(f, 'entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId }), slot.value.version, { renewalId: slotRenewal });
    if (entitled.status !== 'ok' || holdRenewal === undefined) return entitled;
    const hold = await tx.get(ref(f, 'holds', { holdId: 'hold' }));
    const held = await tx.compareAndSwap(ref(f, 'holds', { holdId: 'hold' }), hold.value.version, { renewalId: holdRenewal });
    if (held.status === 'ok') f.input.source.expectedHoldVersion = held.value.version;
    return held;
  });
  assert.equal(changed.status, 'ok', JSON.stringify(changed));
}

test('acknowledged selection satisfies pinned F112 renewal deadline consumer', { skip: !caseSource }, async (t) => {
  const f = await setup(); t.after(() => f.repository.close());
  await renewalAuthority(f, { slotRenewal: 'renewal-original' });
  const cases = await pinnedRenewalCases(f); assert.equal((await cases.start()).status, 'ok');
  const submitted = await f.service.submit(f.context, f.input); assert.equal(submitted.status, 'ok');
  assert.equal((await advance(f, 1)).status, 'ok');
  const found = await cases.readOwn(f.context);
  assert.equal(found.status, 'ok', JSON.stringify(found));
  assert.equal(found.value.cases.length, 0, 'Actual acknowledged selection must suppress its renewal deadline case');
  const receipts = (await f.repository.query(f.context, 'event_receipts', { eventType: 'selection-acknowledged' })).value;
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].outcome.value.renewalId, 'renewal-original');
  assert.equal(receipts[0].outcome.value.orderUuid, '00000000-0000-4000-8000-000000000011');
  assert.equal(receipts[0].outcome.value.occurredAt, instant);
  assert.equal(receipts[0].outcome.value.at, instant);
  assert.deepEqual(receipts[0].outcome.value.order, submitted.value.order);
  assert.deepEqual(await f.service.submit(f.context, { ...f.input, commandId: 'repeat' }), submitted);
  assert.equal((await f.repository.query(f.context, 'event_receipts', { eventType: 'selection-acknowledged' })).value.length, 1);
});

test('selection pins only consistent actual employee and slot renewal authority', async (t) => {
  for (const [name, authority, expected] of [
    ['slot only', { slotRenewal: 'slot-renewal' }, 'slot-renewal'],
    ['same default employee only', { employeeRenewal: 'employee-renewal' }, 'employee-renewal'],
    ['matching authorities', { employeeRenewal: 'same-renewal', slotRenewal: 'same-renewal', holdRenewal: 'same-renewal' }, 'same-renewal'],
    ['unknown', {}, null],
    ['hold without employee or slot authority', { holdRenewal: 'unbound-renewal' }, null],
    ['employee and slot disagree', { employeeRenewal: 'employee-renewal', slotRenewal: 'slot-renewal' }, null],
    ['source hold disagrees', { slotRenewal: 'slot-renewal', holdRenewal: 'different-renewal' }, null],
    ['malformed employee authority', { employeeRenewal: 42, slotRenewal: 'slot-renewal' }, null],
  ]) await t.test(name, async (row) => {
    const f = await setup(); row.after(() => f.repository.close());
    await renewalAuthority(f, authority);
    const submitted = await f.service.submit(f.context, f.input); assert.equal(submitted.status, 'ok', JSON.stringify(submitted));
    assert.equal(submitted.value.selection.renewalId, expected);
    assert.equal((await readOperation(f)).payload.selection.renewalId, expected);
    const receipt = (await f.repository.query(f.context, 'event_receipts', { eventType: 'selection-acknowledged' })).value[0];
    assert.equal(receipt.outcome.value.renewalId, expected);
  });
});

test('delayed acknowledgement keeps its pinned renewal and does not suppress a later renewal', { skip: !caseSource }, async (t) => {
  let writes = 0;
  const f = await setup({ adapter: (g) => {
    const provider = createSyntheticOrderingAdapter(g);
    return { async execute(operation) { writes += 1; await provider.execute(operation); throw Error('lost acknowledgement'); },
      reconcile: (operation) => provider.reconcile(operation) };
  } }); t.after(() => f.repository.close());
  await renewalAuthority(f, { employeeRenewal: 'renewal-original', slotRenewal: 'renewal-original' });
  const cases = await pinnedRenewalCases(f); assert.equal((await cases.start()).status, 'ok');
  assert.equal((await f.service.submit(f.context, f.input)).status, 'pending');
  await renewalAuthority(f, { employeeRenewal: 'renewal-next', slotRenewal: 'renewal-next' });
  const reconciled = await f.service.submit(f.context, { ...f.input, commandId: 'reconcile' });
  assert.equal(reconciled.status, 'ok'); assert.equal(writes, 1);
  const receipt = (await f.repository.query(f.context, 'event_receipts', { eventType: 'selection-acknowledged' })).value[0];
  assert.equal(receipt.outcome.value.renewalId, 'renewal-original');
  assert.equal((await advance(f, 1)).status, 'ok');
  const found = await cases.readOwn(f.context); assert.equal(found.status, 'ok', JSON.stringify(found));
  assert.equal(found.value.cases.length, 1);
  assert.equal(found.value.cases[0].renewalId, 'renewal-next');
  assert.equal(found.value.cases[0].trigger.type, 'renewal-deadline');
});

test('pending and failed handoffs do not suppress the pinned F112 deadline consumer', { skip: !caseSource }, async (t) => {
  for (const state of ['unknown', 'unsupported']) await t.test(state, async (row) => {
    const f = await setup({ adapter: () => ({ async reconcile(operation) { return scoped(operation, 'not-found'); },
      async execute(operation) { return scoped(operation, state); } }) }); row.after(() => f.repository.close());
    await renewalAuthority(f, { slotRenewal: 'renewal-original' });
    const cases = await pinnedRenewalCases(f); assert.equal((await cases.start()).status, 'ok');
    const response = await f.service.submit(f.context, f.input);
    assert.equal(response.value.order, null);
    assert.equal((await advance(f, 1)).status, 'ok');
    const found = await cases.readOwn(f.context); assert.equal(found.status, 'ok', JSON.stringify(found));
    assert.equal(found.value.cases.length, 1);
    assert.equal((await f.repository.query(f.context, 'event_receipts', { eventType: 'selection-acknowledged' })).value.length, 0);
  });
});

test('terms are versioned explicit fictional policy reads, missing central keys fail closed', async () => {
  const f = await setup(); const terms = await f.service.readTerms(f.context);
  assert.equal(terms.value.fictional, true); assert.equal(terms.value.termsVersion, termsValue.termsVersion);
  assert.equal((await new SchemeOrderTerms({ policy: await policyWith({ missing: true }) }).read(f.context, { asOf: instant })).status, 'unavailable');
  const changed = await new SchemeOrderTerms({ policy: await policyWith({ hr: false }) }).read(f.context, { asOf: instant });
  assert.equal(changed.value.approvalStages[0], 'sales-manager approval'); assert.notEqual(changed.value.termsDigest, terms.value.termsDigest);
});

test('canonical PolicyService supplies coherent fictional ordering terms without a consumer fallback', async () => {
  const f = await runtime(createPolicyService());
  const terms = await new SchemeOrderTerms({ policy: f.policy }).read(f.context, { asOf: instant });
  assert.equal(terms.status, 'ok', JSON.stringify(terms));
  assert.equal(terms.value.fictional, true);
  assert.equal(terms.value.termsVersion, 'fictional-order-terms-v1');
  assert.equal(terms.value.approvalStages[0], 'HR approval');
  assert.ok(terms.value.declarations.some((row) => row.appliesTo === 'replacement'));
});

test('atomic source conversion commits selection and allocation in one transaction without a second allocate', async () => {
  const f = await setup(); let conversions = 0;
  f.converter.convertSelection = async (context, input, { commitSelection }) => {
    conversions += 1;
    return f.repository.transaction(context, cmd(`atomic:${input.commandId}`), async (tx) => {
      const stored = await commitSelection(tx); if (stored.status !== 'ok') return stored;
      for (const [table, key] of [['holds', { holdId: 'hold' }], ['claims', { claimId: 'claim' }],
        ['stock', { orderUuid: stored.value.payload.orderUuid }], ['entitlement_slots', { entitlementSlotId: context.entitlementSlotId }]]) {
        const current = await tx.get(ref(f, table, key));
        const changed = await tx.compareAndSwap(ref(f, table, key), current.value.version, { state: 'allocated' });
        if (changed.status !== 'ok') return changed;
      }
      return stored;
    });
  };
  const response = await f.service.submit(f.context, f.input);
  assert.equal(response.status, 'ok', JSON.stringify(response));
  assert.equal(response.value.order.orderNumber, '0000001');
  assert.equal(conversions, 1); assert.equal(f.allocateCalls, 0);
  assert.equal((await f.service.submit(f.context, { ...f.input, commandId: 'retry' })).value.operationId, response.value.operationId);
  assert.equal(conversions, 1);
});

test('atomic source refusal rolls selection, history and allocation back together before provider effects', async () => {
  const f = await setup(); let conversions = 0;
  f.converter.convertSelection = async (context, input, { commitSelection }) => {
    conversions += 1;
    return f.repository.transaction(context, cmd(`atomic:${input.commandId}`), async (tx) => {
      const stored = await commitSelection(tx); if (stored.status !== 'ok') return stored;
      const hold = await tx.get(ref(f, 'holds', { holdId: 'hold' }));
      assert.equal((await tx.compareAndSwap(ref(f, 'holds', { holdId: 'hold' }), hold.value.version, { state: 'allocated' })).status, 'ok');
      return result('conflict', { reason: 'source-authority-changed' });
    });
  };
  const response = await f.service.submit(f.context, f.input);
  assert.equal(response.status, 'conflict'); assert.equal(response.reason, 'source-authority-changed');
  assert.equal(conversions, 1); assert.equal(f.allocateCalls, 0);
  assert.equal((await f.repository.query(f.context, 'pending_operations')).value.length, 0);
  assert.equal((await f.repository.query(f.context, 'event_receipts', { eventType: 'selection-received' })).value.length, 0);
  assert.equal((await f.repository.query(f.context, 'event_receipts', { consumerId: 'synthetic-ordering:v1' })).value.length, 0);
  assert.equal((await f.repository.read(f.context, ref(f, 'holds', { holdId: 'hold' }))).value.state, 'active');
  const quote = (await f.repository.read(f.context, ref(f, 'quotes', { quoteId: 'quote' }))).value;
  assert.equal((await f.repository.read(f.context, ref(f, 'stock', { orderUuid: quote.orderUuid }))).value.state, 'held');
});

test('atomic source pending is reconciled by its authority before ordering and never invokes a second allocation', async () => {
  const f = await setup(); let conversions = 0;
  f.converter.convertSelection = async (context, input, { commitSelection }) => {
    conversions += 1;
    return f.repository.transaction(context, cmd(`atomic:${input.commandId}`), async (tx) => {
      const stored = await commitSelection(tx); if (stored.status !== 'ok') return stored;
      const hold = await tx.get(ref(f, 'holds', { holdId: 'hold' }));
      const changed = await tx.compareAndSwap(ref(f, 'holds', { holdId: 'hold' }), hold.value.version, { state: 'selection-pending' });
      return changed.status === 'ok' ? result('pending', { operationId: input.commandId,
        operationType: 'manual-allocate', lastKnownState: 'selection-pending' }) : changed;
    });
  };
  assert.equal((await f.service.submit(f.context, f.input)).status, 'pending');
  assert.equal((await f.service.submit(f.context, { ...f.input, commandId: 'retry' })).status, 'pending');
  assert.equal((await advance(f, 1)).status, 'ok');
  assert.equal(conversions, 1); assert.equal(f.allocateCalls, 0);
  assert.equal((await f.repository.query(f.context, 'event_receipts', { consumerId: 'synthetic-ordering:v1' })).value.length, 0);
  const operation = await readOperation(f);
  assert.equal((await f.converter.allocate(f.context, operation.payload.allocationInput)).status, 'ok');
  assert.equal((await advance(f, 1)).status, 'ok');
  assert.equal((await f.service.readOrder(f.context)).value.order.orderNumber, '0000001');
  assert.equal(f.allocateCalls, 1);
});

test('pending is persisted before allocation/provider write; duplicate and double click reuse exact existing stock order', async () => {
  const f = await setup(); const before = (await f.repository.read(f.context, ref(f, 'employees', { employeeId: f.context.employeeId }))).value;
  const [first, second] = await Promise.all([f.service.submit(f.context, f.input), f.service.submit(f.context, { ...f.input, commandId: 'double-click' })]);
  assert.equal(first.status, 'ok', JSON.stringify(first)); assert.equal(second.status, 'ok', JSON.stringify(second));
  assert.equal(first.value.operationId, second.value.operationId); assert.equal(first.value.order.orderNumber, '0000001');
  assert.deepEqual({ status: first.status, orderNumber: first.value.order.orderNumber, orderStatus: first.value.order.orderStatus, view: first.value.view }, fixtures.acknowledged);
  assert.equal((await f.repository.query(f.context, 'event_receipts', { consumerId: 'synthetic-ordering:v1' })).value.length, 1);
  assert.deepEqual((await f.repository.read(f.context, ref(f, 'employees', { employeeId: f.context.employeeId }))).value, before);
  assert.equal((await f.service.submit(f.context, { ...f.input, termsDigest: 'changed' })).reason, 'active-selection-exists');
  const pinned = structuredClone(first.value.selection); f.prepared.draft.choices.contact.email = 'new@example.invalid';
  assert.deepEqual((await f.service.readOrder(f.context)).value.selection, pinned);
});

test('terms, declarations, quote/stock/hold versions, expiry and source support refuse without provider effects', async () => {
  for (const patch of [{ termsDigest: 'old' }, { declarations: { terms: true, driver: false, return: true } },
    { declarations: { terms: true, driver: true, return: true, hidden: true } }, { expectedStockVersion: 99 }, { expectedQuoteId: 'wrong' },
    { source: { type: 'cart', holdId: 'hold', expectedHoldVersion: 99, expectedDraftVersion: 1 } },
    { source: { type: 'cart', holdId: 'hold', expectedHoldVersion: 1, expectedDraftVersion: 99 } }]) {
    const f = await setup(); const response = await f.service.submit(f.context, { ...f.input, ...patch });
    assert.equal(['invalid', 'conflict'].includes(response.status), true, JSON.stringify(response)); assert.equal(f.allocateCalls, 0);
    assert.equal((await f.repository.query(f.context, 'pending_operations')).value.length, 0);
  }
  const invalidDeclarations = await setup();
  const validation = await invalidDeclarations.service.submit(invalidDeclarations.context, { ...invalidDeclarations.input, declarations: {} });
  assert.deepEqual({ status: validation.status, view: validation.view }, fixtures.validation);
  const f = await setup(); await advance(f, 600);
  assert.equal((await f.service.submit(f.context, f.input)).reason, 'claim-expired');
  const unsupported = await setup(); unsupported.converters.cart = undefined;
  assert.equal((await unsupported.service.submit(unsupported.context, unsupported.input)).status, 'unavailable');
});

test('lost provider response survives reopen and reconciles on the existing DemoClock tick without resend or expiry release', async () => {
  let writes = 0; let lost = true;
  const f = await setup({ adapter: (g) => {
    const provider = createSyntheticOrderingAdapter(g);
    return { async execute(o) { writes += 1; const answer = await provider.execute(o); if (lost) { lost = false; throw Error('lost response'); } return answer; },
      reconcile: (o) => provider.reconcile(o) };
  } });
  const pending = await f.service.submit(f.context, f.input); assert.equal(pending.status, 'pending'); assert.equal(pending.value.order, null);
  assert.equal((await readOperation(f)).lastKnownState, 'unknown');
  assert.deepEqual({ status: pending.status, operationState: pending.value.operationState, order: pending.value.order, view: pending.value.view }, fixtures.unknown);
  await f.repository.close(); assert.equal((await f.repository.open()).status, 'ok');
  const boot = await createDemoRuntime({ repository: f.repository, policy: f.policy, environmentId: 'manual-order-test',
    environmentKind: 'synthetic', policyAsOf: instant, commandId: 'reopen', sessionNow: () => instant });
  assert.equal(boot.status, 'ok');
  const reopened = new ManualOrderService({ ...f, clock: boot.value.clock, converters: f.converters });
  assert.equal((await reopened.registerClockHandler()).status, 'ok');
  assert.equal((await reopened.readOrder(f.context)).status, 'pending');
  assert.equal((await boot.value.clock.reconcileStartup()).status, 'ok');
  const final = await reopened.readOrder(f.context); assert.equal(final.status, 'ok'); assert.equal(final.value.order.orderNumber, '0000001');
  assert.equal((await advance(f, 700)).status, 'ok');
  assert.equal(writes, 1); assert.equal((await f.repository.read(f.context, ref(f, 'holds', { holdId: 'hold' }))).value.state, 'allocated');
});

test('unknown, malformed, wrong-scope and unsupported responses never invent an order', async () => {
  for (const mode of ['unknown', 'malformed', 'scope', 'unsupported']) {
    const f = await setup({ adapter: () => ({ async reconcile(o) { return scoped(o, 'not-found'); }, async execute(o) {
      if (mode === 'unsupported') return scoped(o, 'unsupported');
      if (mode === 'unknown') return { status: 'unknown' };
      return { ...scoped(o, 'confirmed'), ...(mode === 'scope' ? { runId: 'other' } : {}), orderNumber: '9999999',
        configurationId: o.payload.selection.stock.configurationId, orderStatus: 'HR approval' };
    } }) });
    const response = await f.service.submit(f.context, f.input); assert.equal(response.value.order, null);
    assert.equal(response.status, mode === 'unsupported' ? 'ok' : 'pending');
    assert.equal(response.value.view.state, mode === 'unsupported' ? 'handoff-failed' : 'handoff-pending');
  }
});

test('pending allocation is never ordering success; later confirmed ownership on a tick can hand off', async () => {
  let pending = true; let calls = 0;
  const f = await setup(); const allocate = f.converter.allocate;
  f.converter.allocate = async (...args) => { calls += 1; return pending ? result('pending', { operationId: 'claims-operation' }) : allocate(...args); };
  assert.equal((await f.service.submit(f.context, f.input)).status, 'pending');
  assert.equal((await f.repository.query(f.context, 'event_receipts', { consumerId: 'synthetic-ordering:v1' })).value.length, 0);
  const persisted = await readOperation(f);
  // The source authority confirms its pending allocation; tick must not forge an employee context.
  pending = false; assert.equal((await allocate(f.context, persisted.payload.allocationInput)).status, 'ok');
  assert.equal((await advance(f, 1)).status, 'ok');
  assert.equal((await f.service.readOrder(f.context)).value.order.orderNumber, '0000001'); assert.equal(calls, 1);
});

test('buddy input uses the same authority contract; cross-principal and changed intent cannot access an order', async () => {
  const f = await setup({ type: 'buddy-offer', hr: false }); const response = await f.service.submit(f.context, f.input);
  assert.equal(response.status, 'ok'); assert.equal(response.value.order.orderStatus, 'sales-manager approval');
  const other = { ...f.context, principalId: 'another-principal' };
  assert.equal((await f.service.submit(other, f.input)).status, 'forbidden');
  assert.equal((await f.service.readOrder(other)).status, 'forbidden');
  const stale = { ...f.context, runId: 'old-run' }; assert.notEqual((await f.service.submit(stale, f.input)).status, 'ok');
});

test('converter revalidation and definitive allocation refusals stay reviewable, never provider acknowledgements', async () => {
  const before = await setup(); before.converter.prepare = async () => result('conflict', { reason: 'driver-licence-invalid' });
  assert.equal((await before.service.submit(before.context, before.input)).reason, 'driver-licence-invalid');
  assert.equal((await before.repository.query(before.context, 'pending_operations')).value.length, 0);
  const after = await setup(); after.converter.allocate = async () => result('stale-version', { reason: 'driver-changed-during-submit' });
  const refused = await after.service.submit(after.context, after.input);
  assert.deepEqual({ status: refused.status, operationState: refused.value.operationState, order: refused.value.order, view: refused.value.view }, fixtures.allocationFailure);
  assert.equal((await after.repository.query(after.context, 'event_receipts', { consumerId: 'synthetic-ordering:v1' })).value.length, 0);
  const missing = new ManualOrderService({ ...after, converters: after.converters });
  assert.equal((await missing.submit(after.context, after.input)).status, 'unavailable');
});

const claimsRoot = process.env.GCSP_F66_CONTRACT_ROOT;
test('verified held F66 producer: real manual review/allocate feeds common ordering without copying its implementation', { skip: !claimsRoot }, async () => {
  const { createManualClaimsService } = await import(pathToFileURL(`${claimsRoot}/server/gcsp/manual-claims/index.js`).href);
  const { ManualContextService: HeldManualContextService, createRepositoryManualPorts: heldPorts } = await import(pathToFileURL(`${claimsRoot}/server/gcsp/manual-context/index.js`).href);
  const { createSyntheticManualStockAdapter } = await import(pathToFileURL(`${claimsRoot}/server/gcsp/adapters/manual-stock.js`).href);
  const f = await runtime(await policyWith()); await seedManualDemoContext(f);
  f.manual = new HeldManualContextService({ ...f, ports: heldPorts(f) });
  f.claims = createManualClaimsService({ ...f, adapter: createSyntheticManualStockAdapter() });
  assert.equal((await f.claims.registerClockHandler()).status, 'ok');
  const account = await f.manual.readAccount(f.context);
  const choices = { mode: 'replacement', oldContractId: `current:${f.context.employeeId}`, slotId: f.context.entitlementSlotId,
    schemeId: f.context.schemeId, driverId: `driver:${f.context.employeeId}`, contractOptionId: 'six-month-8000', requestedCollectionDate: '2026-11-20',
    collectionLocationId: 'demo-collection-centre', brand: 'bmw', contact: { phone: '01632 960001', email: 'chooser@example.invalid' },
    expectedReturnMileage: 6700, specialRequirements: '' };
  assert.equal((await f.manual.saveDraft(f.context, { commandId: 'draft', expectedDraftVersion: 0, expectedContextVersion: account.value.contextVersion, choices })).status, 'ok');
  const car = stock(11, { insuranceGroup: fact(25, 'insurance-group') });
  await f.repository.transaction(f.context, cmd('car'), (tx) => tx.insert('stock', { runId: f.context.runId, orderUuid: car.orderUuid,
    orderNumber: '7654321', configurationId: car.configurationId, facts: car.snapshot, state: 'released', available: true, held: false, allocated: false,
    visibility: { companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: null }, release: { availability: { ...car.availability, availableFrom: instant } } }));
  const browse = await f.claims.browseStock(f.context); assert.equal(browse.value.cars.length, 1, JSON.stringify(browse));
  assert.equal((await f.claims.claim(f.context, { commandId: 'claim', ...browse.value.cars[0].claimInput })).status, 'ok');
  const held = (await f.claims.readClaim(f.context)).value;
  const reviewed = await f.claims.beginReview(f.context, { commandId: 'review', holdId: held.hold.holdId,
    expectedHoldVersion: held.hold.version, expectedDraftVersion: 1 }); assert.equal(reviewed.status, 'ok', JSON.stringify(reviewed));
  const service = new ManualOrderService({ ...f, converters: { cart: createManualOrderConversion(f) }, adapter: createSyntheticOrderingAdapter(f) });
  assert.equal((await service.registerClockHandler()).status, 'ok');
  const terms = await service.readTerms(f.context); const h = reviewed.value.hold; const q = reviewed.value.quote;
  const freshDraft = await f.manual.readDraft(f.context);
  assert.equal(freshDraft.value.requiresRefresh, false, JSON.stringify({ draftStage: freshDraft.value.draftStage, requiresRefresh: freshDraft.value.requiresRefresh, draftVersion: freshDraft.value.draftVersion }));
  const stockRow = (await f.repository.read(f.context, ref(f, 'stock', { orderUuid: h.orderUuid }))).value;
  const response = await service.submit(f.context, { commandId: 'submit', source: { type: 'cart', holdId: h.holdId,
    expectedHoldVersion: h.version, expectedDraftVersion: 1 }, expectedQuoteId: q.quoteId, expectedStockVersion: stockRow.version,
    termsDigest: terms.value.termsDigest, declarations: { terms: true, driver: true, return: true } });
  assert.equal(response.status, 'ok', JSON.stringify({status: response.status, reason: response.reason, state: response.value?.operationState})); assert.equal(response.value.order.orderNumber, '7654321');
});
