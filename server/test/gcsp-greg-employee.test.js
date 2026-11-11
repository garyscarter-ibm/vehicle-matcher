import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore, createPolicyService } from '../gcsp/policy/index.js';
import { loadDemoPrincipals } from '../gcsp/fixtures/principals.js';
import { prepareSuccessor, completePublication } from '../gcsp/policy/publish.js';
import { PORTAL_NAVIGATION, ORDERING_NAVIGATION, navigationForAccount } from '../../blocks/gcsp/employee/portal-navigation.js';

const NOW = '2026-11-05T09:00:00.000Z';
const good = (out) => { assert.equal(out?.status, 'ok', JSON.stringify(out)); return out.value; };
const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const principals = (source) => source.assumptions.find((row) => row.key === 'identity.demo.principals').value;
const gregOf = (source) => principals(source).find((row) => row.principalId === 'demo-greg');
const legacySeed = () => { const source = structuredClone(seed); const greg = gregOf(source);
  greg.roles = ['greg']; delete greg.gradeId; delete greg.entitlementSlotId; return source; };
const dualSeed = () => { const source = structuredClone(seed); Object.assign(gregOf(source), {
  roles: ['greg', 'employee'], gradeId: 'G7', entitlementSlotId: 'slot-greg' }); return source; };
const cookieOf = (login) => [login.setCookie].flat().filter((row) => !row.includes('Max-Age=0')).map((row) => row.split(';')[0]).join('; ');

test('employee and ordering roles compose while presenter remains exclusive and employee eligibility stays required', async () => {
  const base = createPolicyService();
  const read = { runId: 'principal-validation', asOf: NOW };
  const validate = (people) => loadDemoPrincipals({ getAssumption: async (key, input) => {
    const row = await base.getAssumption(key, input);
    return key === 'identity.demo.principals' ? { ...row, value: { ...row.value, value: people } } : row;
  } }, read);
  assert.equal((await validate(principals(dualSeed()))).status, 'ok');
  for (const roles of [['employee', 'greg'], ['employee', 'presenter'], ['greg', 'presenter'], ['greg', 'greg'], ['greg', 'other']]) {
    const source = dualSeed(); gregOf(source).roles = roles;
    assert.equal((await validate(principals(source))).status, roles.includes('employee') && roles.includes('greg') ? 'ok' : 'unavailable');
  }
  for (const field of ['gradeId', 'entitlementSlotId']) {
    const source = dualSeed(); delete gregOf(source)[field];
    assert.equal((await validate(principals(source))).status, 'unavailable', field);
  }
  const collision = dualSeed(); gregOf(collision).entitlementSlotId = 'slot-paula';
  assert.equal((await validate(principals(collision))).status, 'unavailable');
});

test('both shared shell entry points show personal destinations plus ordering for a dual-role employee', () => {
  for (const navigation of [PORTAL_NAVIGATION, ORDERING_NAVIGATION]) {
    assert.deepEqual(navigationForAccount(navigation, { status: 'ready', roles: ['greg', 'employee'] }).map((row) => row.key),
      ['cars', 'order-progress', 'ordering']);
  }
  assert.deepEqual(navigationForAccount(PORTAL_NAVIGATION, { status: 'ready', roles: ['employee'] }), PORTAL_NAVIGATION);
  assert.deepEqual(navigationForAccount(PORTAL_NAVIGATION, { status: 'ready', roles: ['greg'] }), ORDERING_NAVIGATION);
  assert.deepEqual(navigationForAccount(ORDERING_NAVIGATION, { status: 'loading', roles: ['greg', 'employee'] }), []);
});

async function retainedFixture(t) {
  const store = createMemoryStore(); const policyStore = createMemoryPolicyStore(); let runtime;
  const start = async (adoptOfferJourney = false) => {
    const policy = new PolicyService({ provider: new MemoryPolicyProvider({ store: policyStore,
      seedProvider: { loadVersions: async () => [legacySeed()] } }) });
    runtime = good(await createGcspRuntime({ mode: 'memory', repository: createMemoryRepository({ store }), policy,
      environmentId: 'greg-own-buddy', policyAsOf: NOW, commandId: 'bootstrap', sessionNow: () => NOW, adoptOfferJourney }));
    return runtime;
  };
  t.after(async () => runtime?.close());
  return { store, policyStore, start };
}

test('Greg upgrade follows a retained employee-experience publication and its older receipt without collision', async (t) => {
  const f = await retainedFixture(t); const original = await f.start();
  const login = good(await original.identity.signIn({ email: 'greg.lawson@gcsp-demo.com', password: 'fucq' }, 'old-publication'));
  const greg = login.context;
  const history = f.policyStore.runs.get(greg.runId);
  const input = { commandId: `adopt:employee-experience-v1:${greg.runId}`, expectedActiveVersion: greg.policyVersion,
    policyVersion: `${greg.policyVersion}+employee-experience-v1`, effectiveFrom: NOW, definitionSetId: 'employee-experience-v1' };
  // Model the already-deployed, immutable publication with its original command ID
  // and digest. Its employee rules are current, but Greg is still ordering-only.
  const prepared = prepareSuccessor(history, greg, input, NOW, { operation: 'refresh-employee-experience', input, definitionDigest: 'older-reviewed-bundle' });
  const previous = completePublication(history, greg, input, NOW, prepared, { adoption: { definitionSetId: 'employee-experience-v1', digest: 'older-reviewed-bundle' } });
  good(previous.outcome); f.policyStore.runs.set(greg.runId, [...history, previous.record]);
  const retained = structuredClone(f.policyStore.runs.get(greg.runId));
  await original.close(); const upgraded = await f.start(true);
  const resolved = good(await upgraded.identity.resolveSession({ authorized: true, cookie: cookieOf(login) }));
  assert.equal(resolved.runId, greg.runId); assert.deepEqual(resolved.roles, ['greg', 'employee']);
  const versions = f.policyStore.runs.get(greg.runId);
  assert.equal(versions.length, retained.length + 1); assert.deepEqual(versions.slice(0, -1), retained);
  assert.ok(versions.at(-1).commandId.startsWith(`${input.commandId}:`));
  assert.equal(good(await upgraded.clock.now(resolved)).now, '2026-11-05T09:00:00.001Z');
  const identity = inputDigest([...f.policyStore.runs]);
  await upgraded.close(); await f.start(true);
  assert.equal(inputDigest([...f.policyStore.runs]), identity);
});

test('retained Greg gains his own Buddy without replacing the run, Paula preferences, identity or policy history', async (t) => {
  const f = await retainedFixture(t); const original = await f.start();
  const paula = good(await original.createLocalSession()).context;
  const paulaEditor = good(await original.editor.readEditor(paula));
  good(await original.editor.savePreferences(paula, { commandId: 'paula-saved', expectedBriefVersion: 0, expectedDraftVersion: 0,
    changes: {}, sameAgain: { contractId: paulaEditor.initial.sameAgain.contractId, on: true } }));
  const beforeGreg = good(await original.identity.signIn({ email: 'greg.lawson@gcsp-demo.com', password: 'fucq' }, 'legacy-greg'));
  const context = beforeGreg.context;
  const ref = { table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } };
  const stored = good(await original.repository.read(context, ref));
  good(await original.repository.transaction(context, { commandId: 'retained-greg-data', inputDigest: inputDigest('retained') },
    (tx) => tx.compareAndSwap(ref, stored.version, { contract: { retainedSetting: 'keep' }, renewalId: 'retained-renewal' })));
  const history = structuredClone(f.policyStore.runs.get(context.runId));
  await original.close(); const upgraded = await f.start(true);
  const resolved = good(await upgraded.identity.resolveSession({ authorized: true, cookie: cookieOf(beforeGreg) }));
  assert.equal(resolved.runId, context.runId); assert.equal(resolved.employeeId, 'operator-greg');
  assert.deepEqual(resolved.roles, ['greg', 'employee']);
  assert.equal((await upgraded.identity.requireRole(resolved, 'greg')).status, 'ok');
  assert.equal((await upgraded.identity.requireRole(resolved, 'employee')).status, 'ok');
  assert.equal((await upgraded.identity.requireRole(resolved, 'presenter')).status, 'forbidden');
  const retained = good(await upgraded.repository.read(resolved, ref));
  assert.equal(retained.contract.retainedSetting, 'keep'); assert.equal(retained.renewalId, 'retained-renewal');
  assert.equal(retained.gradeId, 'G7'); assert.equal(retained.entitlementSlotId, 'slot-greg');
  assert.deepEqual(retained.roles, ['greg', 'employee']);
  const versions = f.policyStore.runs.get(context.runId);
  assert.equal(versions.length, history.length + 1); assert.deepEqual(versions.slice(0, -1), history);
  assert.deepEqual(principals(versions.at(-1).seed).filter((person) => person.principalId !== 'demo-greg'),
    principals(history.at(-1).seed).filter((person) => person.principalId !== 'demo-greg'));
  good(await upgraded.dependencies.gcspPrepareEmployee(resolved));
  const account = good(await upgraded.account.readAccount(resolved));
  assert.equal(account.account.name, 'Greg Lawson'); assert.equal(account.account.employeeId, 'operator-greg');
  assert.deepEqual(account.account.roles, ['greg', 'employee'], 'personal pages retain both navigation capabilities');
  const editor = good(await upgraded.editor.readEditor(resolved));
  assert.equal(editor.initial.sameAgain.on, false);
  assert.notEqual(editor.initial.sameAgain.contractId, paulaEditor.initial.sameAgain.contractId);
  const saved = good(await upgraded.editor.savePreferences(resolved, { commandId: 'greg-saved', expectedBriefVersion: 0, expectedDraftVersion: 0,
    changes: {}, sameAgain: { contractId: editor.initial.sameAgain.contractId, on: true } }));
  const engaged = good(await upgraded.editor.engage(resolved, { commandId: 'greg-engage', expectedBriefVersion: saved.briefVersion,
    expectedDraftVersion: saved.draftVersion }));
  assert.equal(engaged.buddy.state, 'engaged');
  const paulaAfter = good(await upgraded.createLocalSession()).context;
  const paulaLoaded = good(await upgraded.editor.readEditor(paulaAfter));
  assert.equal(paulaLoaded.initial.sameAgain.on, true);
  const paulaEngaged = good(await upgraded.editor.engage(paulaAfter, { commandId: 'paula-engage',
    expectedBriefVersion: paulaLoaded.initial.briefVersion, expectedDraftVersion: paulaLoaded.initial.draftVersion }));
  for (const action of ['read', 'write']) {
    const gregBrief = { table: 'briefs', key: { runId: resolved.runId, employeeId: resolved.employeeId, briefVersion: engaged.briefVersion } };
    const paulaBrief = { table: 'briefs', key: { runId: paulaAfter.runId, employeeId: paulaAfter.employeeId, briefVersion: paulaEngaged.briefVersion } };
    assert.equal((await upgraded.identity.authorizeResource(resolved, gregBrief, action)).status, 'ok');
    assert.equal((await upgraded.identity.authorizeResource(paulaAfter, gregBrief, action)).status, 'forbidden');
    assert.equal((await upgraded.identity.authorizeResource(resolved, paulaBrief, action)).status, 'forbidden');
  }
  const presenter = good(await upgraded.identity.createPresenterSession('resolve-greg')).context;
  assert.equal(good(await upgraded.identity.resolveEmployeeContext(presenter, resolved.employeeId)).employeeId, resolved.employeeId);
  const savedIdentity = inputDigest(good(await upgraded.repository.read(resolved, ref)));
  const policyIdentity = inputDigest([...f.policyStore.runs]);
  await upgraded.close(); const reopened = await f.start(true);
  assert.equal(inputDigest([...f.policyStore.runs]), policyIdentity);
  const again = good(await reopened.identity.resolveSession({ authorized: true, cookie: cookieOf(beforeGreg) }));
  assert.equal(inputDigest(good(await reopened.repository.read(again, ref))), savedIdentity);
  assert.equal(good(await reopened.editor.readEditor(again)).initial.buddy.state, 'engaged');
});

test('Greg adoption preserves an existing owned entitlement and refuses another employee\'s slot', async (t) => {
  for (const owner of ['operator-greg', 'employee-paula']) {
    const f = await retainedFixture(t); const original = await f.start();
    const context = good(await original.identity.createPresenterSession(`slot:${owner}`)).context;
    const slot = { table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: 'slot-greg' } };
    good(await original.repository.transaction(context, { commandId: 'existing-slot', inputDigest: inputDigest(owner) }, (tx) =>
      tx.insert('entitlement_slots', { ...slot.key, employeeId: owner, capacity: 1, employeeCapacity: 1, state: 'entitled',
        renewalId: 'saved-greg-renewal', contractId: 'saved-greg-contract' })));
    const before = good(await original.repository.read(context, slot));
    await original.close();
    if (owner === 'operator-greg') {
      const upgraded = await f.start(true);
      const greg = good(await upgraded.identity.signIn({ email: 'greg.lawson@gcsp-demo.com', password: 'fucq' }, 'slot-owner')).context;
      assert.deepEqual(good(await upgraded.repository.read(greg, slot)), before);
      await upgraded.close();
    } else await assert.rejects(f.start(true), /unavailable/);
  }
});
