import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGcspRuntime } from '../../gcsp/runtime.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../../gcsp/policy/index.js';
import { startHttpServer, cookieOf } from './employee-recommendation-http.js';

export const now = '2026-11-05T09:00:00.000Z';
export const good = (out) => { assert.equal(out.status, 'ok', JSON.stringify(out)); return out.value; };
export const response = (out) => { assert.equal(out.status, 200, JSON.stringify(out.json)); return good(out.json); };
export const adoptionCommand = (overrides = {}) => ({ commandId: 'adopt-presenter', expectedActiveVersion: 'gcsp-policy-v1',
  policyVersion: 'presenter-policy-v2', effectiveFrom: now, definitionSetId: 'presenter-controls-v1', ...overrides });
export async function reviewedRuntime(t, { missingStep = true, transform = () => {}, repository } = {}) {
  const seed = JSON.parse(await readFile(new URL('../../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  if (missingStep) seed.assumptions = seed.assumptions.filter((row) => row.key !== 'clock.presenter.stepSeconds');
  transform(seed);
  const store = createMemoryPolicyStore();
  const provider = new MemoryPolicyProvider({ store, seedProvider: { loadVersions: async () => [seed] } });
  const readPolicy = new PolicyService({ provider });
  const options = { mode: 'memory', repository, policy: readPolicy, environmentId: 'reviewed-adoption',
    policyAsOf: now, commandId: 'bootstrap', sessionNow: () => now };
  const runtime = good(await createGcspRuntime(options));
  const session = await runtime.createLocalSession(); good(session);
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: cookieOf(session), purpose: 'presenter-control' }));
  const http = await startHttpServer(runtime.dependencies);
  t.after(async () => { await http.close(); await runtime.close(); await readPolicy.close(); });
  const acting = async (principalId, commandId = principalId) => {
    const out = await http.request('/api/gcsp/session/switch', { session, body: { principalId, commandId } }); response(out);
    const issued = { value: { setCookie: out.headers.get('set-cookie') } };
    const context = good(await runtime.identity.resolveSession({ authorized: true, cookie: cookieOf(issued) }));
    return { session: issued, context };
  };
  const greg = await acting('demo-greg');
  return { ...runtime, store, policyProvider: provider, readPolicy, options, session, http, acting, greg, presenter,
    run: async () => good(await runtime.repository.read(session.value.context,
      { table: 'runs', key: { runId: session.value.context.runId } })) };
}
