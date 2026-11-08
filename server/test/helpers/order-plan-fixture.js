import * as planning from '../../gcsp/predict/plan/index.js';
import { FOUNDATION_TABLES, inputDigest } from '../../gcsp/repository/index.js';
import { publishFixture, good } from './greg-publish-run.js';
import { confirm, fact as sourceFact } from './greg-demand-run.js';
import { withContractEnd } from './order-plan-input.js';
import { createFakeF104Supply } from './fake-f104-supply.js';

const fact = (...args) => { const value = sourceFact(...args); value.provenance.observedAt = '2026-11-05T00:00:00.000Z'; return value; };
export const TOURING = 'g21-touring-320i';
export const DERIVATIVES = 'orderPlan.derivativeBounds';

// The canonical order-plan fixture with a fake FUCQ-104 port (the real tables are not on this base).
export async function fixture(t) {
  const f = await publishFixture(t, { canonical: true });
  const slotRef = { table: 'entitlement_slots', key: { runId: f.context.runId, entitlementSlotId: f.employee.entitlementSlotId } };
  await f.write(async (tx) => {
    const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.employee.employeeId } };
    const row = (await tx.get(ref)).value;
    const contract = withContractEnd(row.contract, '2027-02-15');
    return tx.compareAndSwap(ref, row.version, { renewalId: 'renewal-known', contract: { ...contract, manualContext: { ...contract.manualContext,
      employeeFacts: { essentials: {}, driverEligible: fact(true), charging: fact('home') } } } });
  });
  await f.write(async (tx) => { const row = (await tx.get(slotRef)).value; return tx.compareAndSwap(slotRef, row.version, { renewalId: 'renewal-known' }); });
  await confirm(f);
  f.fake = createFakeF104Supply(f);
  f.ops = planning.createOrderPlanOperations({ repository: f.repository, policy: f.policy, identity: f.identity, clock: f.clock, supply: f.fake, requests: f.fake });
  f.now = async () => (await f.clock.now(f.context)).value.now;
  f.active = async (key) => structuredClone(good(await f.policy.getAssumption(key, { runId: f.context.runId, asOf: await f.now(), policyVersion: f.context.policyVersion })).value);
  // A fresh Greg context picks up a newly activated policy version.
  let sessions = 0;
  f.fresh = async () => good(await f.identity.switchPrincipal(f.presenter.value.context, 'demo-greg', `greg-${++sessions}`)).context;
  f.advance = async (bySeconds = 60) => {
    const state = good(await f.clock.readState(f.presenter.value.context));
    good(await f.clock.advance(f.presenter.value.context, { commandId: `advance-${state.clockVersion}`, expectedClockVersion: state.clockVersion, bySeconds }));
  };
  // Everything a preview must leave alone: every repository table, the policy store and the supply records.
  f.state = async () => {
    const tables = {};
    for (const table of FOUNDATION_TABLES) { const r = await f.repository.query(f.context, table); tables[table] = r.status === 'ok' ? r.value : r.status; }
    const version = good(await f.policy.getActiveVersion({ runId: f.context.runId, asOf: await f.now() })).policyVersion;
    return { digest: inputDigest({ tables, policy: [...f.policyStore.runs.entries()], supply: f.fake.rows }), version };
  };
  return f;
}
export const cap = (bounds, id, patch) => bounds.map((b) => (b.derivativeId === id ? { ...b, ...patch } : b));
export const submitOf = (plan, commandId, extra = {}) => ({ commandId, planId: plan.planId, versions: plan.versions, ...extra });
