import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPolicyService } from '../gcsp/policy/index.js';
import { loadDemoPrincipals } from '../gcsp/fixtures/principals.js';
import { PORTAL_NAVIGATION, ORDERING_NAVIGATION, navigationForAccount } from '../../blocks/gcsp/employee/portal-navigation.js';
const NOW = '2026-11-05T09:00:00.000Z';
const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const principals = (source) => source.assumptions.find((row) => row.key === 'identity.demo.principals').value;
const gregOf = (source) => principals(source).find((row) => row.principalId === 'demo-greg');
const dualSeed = () => { const source = structuredClone(seed); Object.assign(gregOf(source), {
  roles: ['greg', 'employee'], gradeId: 'G7', entitlementSlotId: 'slot-greg' }); return source; };
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
