import assert from 'node:assert/strict';
import { setup } from './greg-demand-run.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../../gcsp/policy/index.js';
import { createGregPublishService } from '../../gcsp/greg/publish/index.js';

export const now = '2026-11-05T09:00:00.000Z';
export const good = (out) => { assert.equal(out.status, 'ok', JSON.stringify(out)); return out.value; };
export async function publishFixture(t, options = {}) {
  const policyStore = createMemoryPolicyStore();
  let policyProvider;
  const f = await setup({ ...options, policyProvider(source) {
    policyProvider = new MemoryPolicyProvider({ store: policyStore, seedProvider: { async loadVersions() { return [source]; } } });
    return policyProvider;
  } });
  t.after(() => f.repository.close());
  f.policy = new PolicyService({ provider: policyProvider, identity: f.identity, clock: f.clock });
  f.source = good(await f.policy.getPolicySnapshot({ runId: f.context.runId, asOf: now }));
  f.publish = createGregPublishService(f);
  f.policyStore = policyStore;
  f.runRef = { table: 'runs', key: { runId: f.context.runId } };
  f.run = async () => good(await f.repository.read(f.context, f.runRef));
  f.price = f.source.pricePlans.find((row) => row.schemeId === f.employee.schemeId && row.matchValue === 'G21 Touring|320i');
  f.command = (value = 1200) => ({ commandId: 'publish-http', expectedActiveVersion: f.source.policyVersion,
    policyVersion: 'greg-policy-v2', effectiveFrom: now, changes: [{ id: `price:${f.price.key}`, value }] });
  f.schedule = async (effectiveFrom = '2026-11-05T09:01:00.000Z', policyVersion = 'scheduled-v2') => good(await f.policy.publishPolicyVersion(f.context, {
    commandId: `schedule:${policyVersion}`, expectedActiveVersion: f.source.policyVersion, policyVersion, effectiveFrom,
    changes: [{ table: 'pricePlans', key: f.price.key, patch: { value: 1200, monthlyPoints: 1200,
      basis: 'Explicit scheduled policy test.', source: 'synthetic:test', sourceDate: now.slice(0, 10), status: 'assumed' } }],
  }));
  return f;
}
export const allRows = async (f) => Object.fromEntries(await Promise.all(['briefs', 'employees', 'stock', 'holds', 'offers', 'quotes', 'decisions', 'runs']
  .map(async (table) => [table, good(await f.repository.query(f.context, table))])));
export const sessionCookie = (session) => [session.value.setCookie].flat().map((row) => row.split(';')[0]).join('; ');
