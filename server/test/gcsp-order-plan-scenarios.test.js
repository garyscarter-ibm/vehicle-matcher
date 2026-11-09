// FUCQ-265: Greg's order plan loads after a reset into released-stock scenarios, and every demo car is in the catalogue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createPolicyOrderPlanCatalog } from '../gcsp/predict/plan/index.js';
import { createDemoStockProvider, createDemoUpstream } from '../gcsp/stock/demo-provider.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';
import { createRouteClient, resetIntoScenario } from './helpers/gcsp-decline-change-route.js';
import { cap, DERIVATIVES } from './helpers/order-plan-fixture.js';

const BASE = '/api/gcsp/greg/order-plan';
const HATCH = 'f70-hatch-120';
const POLICY = 'gcsp-policy-v1';
const ASOF = '2026-11-06T12:00:00.000Z';
const policy = createPolicyService();
const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const okRoute = (label, out) => { assert.equal(out.status, 200, `${label}: HTTP ${out.status} ${JSON.stringify(out.json)}`);
  assert.equal(out.json.status, 'ok', `${label}: ${JSON.stringify(out.json)}`); return out.json.value; };

async function setup(t, scenarioId) {
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: (deps) => createDemoStockProvider(deps), environmentId: `order-plan-${scenarioId}`, policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: `order-plan-${scenarioId}-bootstrap`, sessionNow: () => '2026-11-06T00:00:00.000Z', adoptOfferJourney: true } }));
  t.after(() => app.close());
  const client = createRouteClient({ fetch: https.fetch, origin: app.origin });
  client.seed(good(await app.services.createLocalSession()).setCookie);
  await resetIntoScenario(client, scenarioId, `${scenarioId}-reset`);
  okRoute('switch to Greg', await client.request('/api/gcsp/session/switch', { principalId: 'demo-greg', commandId: `${scenarioId}-greg` }));
  return client;
}

for (const scenarioId of ['decline-then-change', 'main-successful-journey']) {
  test(`${scenarioId}: Greg's order plan reads ok and lists the 1 Series Sports Hatch 120`, async (t) => {
    const client = await setup(t, scenarioId);
    const read = okRoute(`GET ${scenarioId} plan`, await client.request(BASE));
    const hatch = read.presentation.derivatives.find((row) => row.derivativeId === HATCH);
    assert.ok(hatch, `${HATCH} missing from ${JSON.stringify(read.presentation.derivatives.map((row) => row.derivativeId))}`);
    assert.deepEqual([hatch.model, hatch.derivative], ['1 Series Sports Hatch', '120']);
    if (scenarioId !== 'decline-then-change') return;
    const active = good(await policy.getAssumption(DERIVATIVES, { runId: 'bounds', asOf: ASOF, policyVersion: POLICY })).value;
    const preview = okRoute('POST decline-then-change preview', await client.request(`${BASE}/preview`, { changes: [{ key: DERIVATIVES,
      value: cap(active, HATCH, { min: 2 }) }] }));
    assert.equal(preview.preview, true);
    assert.equal(preview.plan.quantities.find((row) => row.derivativeId === HATCH).quantity, 2);
  });
}

test('every demo stock configuration and production choice maps to exactly one catalogue derivative', async () => {
  const stock = good(await createDemoStockProvider({ policy }).pull({ runId: 'catalogue-guard', asOf: '2027-06-01T12:00:00.000Z',
    policyVersion: POLICY, released: [], releaseSize: 100, queuedSupply: [] })).stock;
  const choices = good(await createDemoUpstream().production.describe({})).choices;
  const read = { runId: 'catalogue-guard', asOf: ASOF, policyVersion: POLICY };
  const { derivatives } = good(await createPolicyOrderPlanCatalog({ policy }).readCatalog({ runId: read.runId }, read));
  const configurations = [...new Set(stock.map((car) => car.configurationId))];
  assert.ok(configurations.length >= 4 && choices.length >= 4, 'demo provider enumerates every car kind');
  for (const id of configurations) {
    assert.equal(derivatives.filter((row) => row.configurationIds.includes(id)).length, 1, `configuration ${id}`);
  }
  for (const { model, derivative } of choices) {
    const found = derivatives.filter((row) => row.production.model === model && row.production.derivative === derivative);
    assert.equal(found.length, 1, `production choice ${model} ${derivative}`);
  }
});
