// Every demo stock configuration and production choice maps to one order plan catalogue derivative.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createPolicyOrderPlanCatalog } from '../gcsp/predict/plan/index.js';
import { createDemoStockProvider, createDemoUpstream } from '../gcsp/stock/demo-provider.js';
const POLICY = 'gcsp-policy-v1';
const ASOF = '2026-11-06T12:00:00.000Z';
const policy = createPolicyService();
const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
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
