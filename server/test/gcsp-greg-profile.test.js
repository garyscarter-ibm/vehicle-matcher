import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../gcsp/policy/index.js';

const NOW = '2026-11-11T09:00:00.000Z';
const good = (out) => { assert.equal(out?.status, 'ok', JSON.stringify(out)); return out.value; };
const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
async function fixture(t, legacy = false) {
  const store = createMemoryStore(); const policyStore = createMemoryPolicyStore(); let runtime;
  const initial = structuredClone(seed);
  if (legacy) initial.assumptions = initial.assumptions.filter((row) => row.key !== 'employee.demoProfiles.v1');
  const start = async (adoptOfferJourney = false) => {
    runtime = good(await createGcspRuntime({ mode: 'memory', repository: createMemoryRepository({ store }),
      policy: new PolicyService({ provider: new MemoryPolicyProvider({ store: policyStore, seedProvider: { loadVersions: async () => [initial] } }) }),
      environmentId: 'greg-profile', policyAsOf: NOW, commandId: 'bootstrap', sessionNow: () => NOW, adoptOfferJourney }));
    return runtime;
  };
  t.after(async () => runtime?.close());
  const greg = async () => {
    const context = good(await runtime.identity.signIn({ email: 'greg.lawson@gcsp-demo.com', password: 'fucq' }, `greg:${Math.random()}`)).context;
    good(await runtime.dependencies.gcspPrepareEmployee(context)); return context;
  };
  return { start, greg, store, policyStore };
}
const ref = (c) => ({ table: 'employees', key: { runId: c.runId, employeeId: c.employeeId } });
const record = async (runtime, context) => good(await runtime.repository.read(context, ref(context)));

test('Greg has a distinct electric SUV, household, mileage and history across account and Buddy baseline', async (t) => {
  const f = await fixture(t); const runtime = await f.start(); const context = await f.greg();
  const greg = good(await runtime.account.readAccount(context));
  const paula = good(await runtime.account.readAccount(good(await runtime.createLocalSession()).context));
  assert.equal(greg.currentContract.model, 'BMW iX1 eDrive20');
  assert.equal(greg.currentContract.vehicle.fuel, 'ev');
  assert.equal(greg.currentContract.vehicle.body, 'suv');
  assert.equal(greg.currentContract.annualMileage, 8000);
  assert.equal(greg.currentContract.currentOdometer.value, 3100);
  assert.equal(greg.currentContract.vehicle.points, 800);
  assert.notEqual(greg.currentContract.media.src, paula.currentContract.media.src);
  assert.notDeepEqual(greg.account.address, paula.account.address);
  assert.equal(greg.drivers.find((d) => d.kind === 'nominated').name, 'Morgan Lawson');
  assert.equal(greg.histories.find((h) => h.schemeId === 'pcs-ukfs-bmw').entries[0].model, 'BMW 3 Series Saloon 320i');
  const baseline = good(await runtime.dependencies.gcspRecommendations.provider.resolve(context)).currentCar;
  assert.equal(baseline.facts.eligibilityModelKey.value, 'U11 iX1|iX1 20');
  assert.equal(baseline.facts.configurationId.value, greg.currentContract.vehicle.configurationId);
  assert.equal(baseline.facts.fuel.value, 'ev');
  assert.equal(baseline.facts.boot.value, 490);
  assert.equal(good(await runtime.dependencies.gcspRecommendations.provider.resolve(context)).employeeFacts.requiredBy.value,
    '2026-12-15T23:59:59.999Z');
  assert.equal(Object.hasOwn(baseline.facts, 'mpg'), false, 'electric car has no petrol MPG');
  assert.equal(good(await runtime.editor.readEditor(context)).initial.sameAgain.contractId, greg.currentContract.contractId);
  assert.equal(paula.currentContract.model, 'BMW 3 Series Touring 320i');
  assert.equal(paula.currentContract.currentOdometer.value, 5200);
});

test('retained Greg correction preserves run, slots, saved choices, Paula and policy history and is replay safe', async (t) => {
  const f = await fixture(t, true); const before = await f.start(); const old = await f.greg();
  const paula = good(await before.createLocalSession()).context;
  const paulaRow = await record(before, paula);
  good(await before.editor.savePreferences(old, { commandId: 'saved-greg', expectedBriefVersion: 0, expectedDraftVersion: 0,
    changes: { fuel: { value: ['ev'], importance: 'high' } } }));
  const account = good(await before.account.readAccount(old));
  good(await before.account.saveDraft(old, { commandId: 'manual-intent', expectedDraftVersion: 0,
    expectedContextVersion: account.contextVersion, choices: { mode: 'replacement', oldContractId: account.currentContract.contractId,
      slotId: old.entitlementSlotId, schemeId: old.schemeId } }));
  const drafts = structuredClone(f.store.state.tables.event_receipts.filter((r) => r.consumerId.startsWith('brief:draft:')));
  const slot = { table: 'entitlement_slots', key: { runId: old.runId, entitlementSlotId: old.entitlementSlotId } };
  const oldSlot = good(await before.repository.read(old, slot));
  const history = structuredClone(f.policyStore.runs.get(old.runId));
  await before.close(); const after = await f.start(true);
  assert.equal((await record(after, old)).contract.manualContext.contracts[0].model, 'BMW iX1 eDrive20', 'startup updates an existing browser session before login preparation');
  const context = await f.greg();
  assert.equal(context.runId, old.runId); assert.deepEqual(context.roles, ['greg', 'employee']);
  assert.equal(good(await after.account.readAccount(context)).currentContract.model, 'BMW iX1 eDrive20');
  assert.deepEqual(good(await after.repository.read(context, slot)), oldSlot);
  assert.deepEqual(await record(after, paula), paulaRow);
  assert.deepEqual(f.store.state.tables.event_receipts.filter((r) => r.consumerId.startsWith('brief:draft:')), drafts);
  assert.deepEqual(good(await after.editor.readEditor(context)).initial.accountPreferences.categories.fuel.value, ['ev']);
  assert.equal(good(await after.account.readDraft(context)).requiresRefresh, true);
  assert.deepEqual(f.policyStore.runs.get(old.runId).slice(0, -1), history);
  const updated = await record(after, context); const policies = inputDigest([...f.policyStore.runs]);
  await after.close(); const again = await f.start(true); const same = await f.greg();
  assert.deepEqual(await record(again, same), updated); assert.equal(inputDigest([...f.policyStore.runs]), policies);
});

test('Greg correction preserves edited source, allocated slots and frozen order/lifecycle data', async (t) => {
  for (const kind of ['edited', 'allocated', 'selection', 'lifecycle', 'quote', 'case']) {
    const f = await fixture(t, true); const before = await f.start(); const context = await f.greg();
    const stored = await record(before, context);
    good(await before.repository.transaction(context, { commandId: `protect:${kind}`, inputDigest: inputDigest(kind) }, async (tx) => {
      if (kind === 'edited') {
        const manual = structuredClone(stored.contract.manualContext); manual.account.address.line1 = 'Employee corrected address';
        return tx.compareAndSwap(ref(context), stored.version, { contract: { ...stored.contract, manualContext: manual } });
      }
      if (kind === 'quote') return tx.insert('quotes', { runId: context.runId, quoteId: 'saved-quote', employeeId: context.employeeId });
      if (kind === 'case') return tx.insert('renewal_cases', { runId: context.runId, caseId: 'saved-case', employeeId: context.employeeId, renewalId: `renewal:${context.employeeId}` });
      if (kind === 'selection') return tx.insert('pending_operations', { runId: context.runId,
        operationId: 'saved-selection', operationType: 'selection-order', idempotencyKey: 'saved-selection',
        state: 'completed', payload: { context } });
      if (kind === 'lifecycle') return tx.insert('event_receipts', { runId: context.runId,
        consumerId: 'lifecycle-current-car:state:v1', eventId: 'saved-car', state: 'completed',
        outcome: { status: 'ok', value: { employeeId: context.employeeId } } });
      const key = { table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: context.entitlementSlotId } };
      const slot = good(await tx.get(key)); return tx.compareAndSwap(key, slot.version, { state: 'allocated' });
    }));
    const protectedRow = await record(before, context);
    await before.close(); const after = await f.start(true); await f.greg();
    assert.deepEqual(await record(after, context), protectedRow, kind);
    await after.close();
  }
});
