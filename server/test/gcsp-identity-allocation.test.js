import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationFixture } from './helpers/gcsp-allocation.js';

test('trusted presenter derives frozen employee context with configured scheme authority only', async () => {
  const f = await allocationFixture({ canonicalPeople: true }); const expected = f.employees[0];
  const sessionsBefore = (await f.repository.query(f.context, 'identity_sessions')).value;
  const out = await f.identity.resolveEmployeeContext(f.context, expected.employeeId);
  assert.equal(out.status, 'ok'); assert.ok(Object.isFrozen(out.value)); assert.ok(Object.isFrozen(out.value.roles));
  for (const key of ['employeeId', 'companyId', 'schemeId', 'gradeId', 'entitlementSlotId', 'policyVersion', 'runId']) assert.equal(out.value[key], expected[key]);
  assert.equal((await f.identity.requireRole(out.value, 'employee')).status, 'ok');
  assert.equal((await f.identity.requireRole(out.value, 'presenter')).status, 'forbidden');
  assert.equal((await f.identity.resolveEmployeeContext(out.value, f.employees[1].employeeId)).status, 'forbidden');
  assert.equal((await f.identity.requireRole({ ...out.value, roles: ['presenter'] }, 'presenter')).status, 'forbidden');
  assert.deepEqual((await f.repository.query(f.context, 'identity_sessions')).value, sessionsBefore, 'no new cookie/session');
  for (const person of f.employees) {
    const configured = f.source.assumptions.find((a) => a.key === 'identity.demo.principals').value.find((p) => p.employeeId === person.employeeId);
    const resolved = await f.identity.resolveEmployeeContext(f.context, person.employeeId);
    for (const key of ['companyId', 'schemeId', 'gradeId', 'roles']) assert.deepEqual(resolved.value[key], configured[key]);
  }
  const other = f.employees[1];
  assert.equal((await f.identity.authorizeResource(out.value, { table: 'briefs', key: { runId: f.context.runId,
    employeeId: other.employeeId, briefVersion: 1 } })).status, 'forbidden');
});

test('cohort resolution rejects forged, nonpresenter, unknown and cross-run authority', async () => {
  const f = await allocationFixture(); const employee = f.employees[0];
  assert.equal((await f.identity.resolveEmployeeContext({ ...f.context }, employee.employeeId)).status, 'forbidden');
  assert.equal((await f.identity.resolveEmployeeContext(employee, employee.employeeId)).status, 'forbidden');
  assert.equal((await f.identity.resolveEmployeeContext(f.context, 'unknown')).status, 'unknown-principal');
  assert.equal((await f.identity.resolveEmployeeContext({ ...f.context, runId: 'other' }, employee.employeeId)).status, 'forbidden');
  await f.write((tx) => tx.compareAndSwap({ table: 'employees', key: { runId: f.context.runId, employeeId: employee.employeeId } }, 2, { schemeId: 'other-scheme' }));
  assert.equal((await f.identity.resolveEmployeeContext(f.context, employee.employeeId)).status, 'forbidden');
});

test('derived employee authority expires with controller and refuses a reset run', async () => {
  const f = await allocationFixture(); const employee = f.employees[0]; f.expire();
  assert.equal((await f.identity.requireRole(employee, 'employee')).status, 'expired-session');
  assert.equal((await f.identity.resolveEmployeeContext(f.context, employee.employeeId)).status, 'expired-session');
  const reset = await allocationFixture(); await reset.retire();
  assert.equal((await reset.identity.requireRole(reset.employees[0], 'employee')).status, 'stale-run');
  assert.equal((await reset.identity.resolveEmployeeContext(reset.context, reset.employees[0].employeeId)).status, 'stale-run');
});
