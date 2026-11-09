// FUCQ-265: Greg's order plan loads after a reset into released-stock scenarios, and every demo car is in the catalogue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createPolicyOrderPlanCatalog } from '../gcsp/predict/plan/index.js';
import { createDemoStockProvider, createDemoUpstream, withConfirmedSupply } from '../gcsp/stock/demo-provider.js';
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

async function setup(t, scenarioId, { requests = false } = {}) {
  const upstream = createDemoUpstream();
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    ...(requests ? { stockProvider: (deps) => withConfirmedSupply(createDemoStockProvider(deps), upstream), production: upstream.production } : { stockProvider: (deps) => createDemoStockProvider(deps) }), environmentId: `order-plan-${scenarioId}`, policyAsOf: '2026-11-05T09:00:00.000Z',
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

// FUCQ-290: Min 2 is set only in the draft that is submitted, so the plan under the active limits orders nothing afterwards.
test('decline-then-change: after Min 2, preview and submit, the panel says 2 vehicles were requested, not "No new order recommended"', async (t) => {
  const { JSDOM } = await import('jsdom');
  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException', 'MutationObserver']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key] ?? globalThis[key], configurable: true, writable: true });
  }
  const { mountGregOrderPlan } = await import('../../blocks/gcsp/greg/plan/panel.js');
  const { createOrderPlanHttpAdapter } = await import('../../blocks/gcsp/greg/plan/http-adapter.js');
  const client = await setup(t, 'decline-then-change', { requests: true });
  const fetchImpl = async (path, init) => { const out = await client.request(path, init.body ? JSON.parse(init.body) : undefined); return { status: out.status, json: async () => out.json }; };
  const root = document.createElement('div'); root.className = 'gcsp'; document.body.append(root);
  const teardown = mountGregOrderPlan(root, { adapter: createOrderPlanHttpAdapter({ fetchImpl }), commandId: () => 'regression-submit' });
  t.after(() => teardown());
  const until = async (done) => { for (let i = 0; i < 200 && !done(); i += 1) await new Promise((resolve) => setTimeout(resolve, 50)); assert.ok(done(), `${root.querySelector('.gcsp-plan')?.dataset.state}: ${root.querySelector('.gcsp-plan-message')?.textContent}`); };
  const stateIs = (name) => () => root.querySelector('.gcsp-plan')?.dataset.state === name;
  const headline = () => root.querySelector('.gcsp-plan-top h2').textContent;
  await until(() => ['ready', 'no-demand'].includes(root.querySelector('.gcsp-plan')?.dataset.state)); assert.equal(headline(), 'No new order recommended');
  const row = [...root.querySelectorAll('.gcsp-plan-limit')].find((r) => r.querySelector('.gcsp-plan-limit-name').textContent === '1 Series Sports Hatch 120');
  const min = row.querySelector('input[type="number"]'); min.value = '2'; min.dispatchEvent(new window.Event('input', { bubbles: true }));
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Preview with these limits').click();
  await until(stateIs('preview')); assert.equal(headline(), 'Order 2 vehicles: 1 Series Sports Hatch 120');
  [...root.querySelectorAll('button')].find((b) => b.textContent.startsWith('Request ')).click();
  await until(stateIs('submitted'));
  assert.equal(headline(), '2 vehicles requested from Production'); assert.doesNotMatch(root.textContent, /No new order recommended/);
  assert.equal(root.querySelector('.gcsp-plan-top a').getAttribute('href'), '#gcsp-order-requests'); assert.equal(document.activeElement, root.querySelector('.gcsp-plan-top h2'));
  const read = okRoute('GET after submit', await client.request(BASE));
  assert.equal(read.replan.status, 'unchanged-since-submission'); assert.equal(read.plan.orderQuantity, 0, 'requests are intent, never supply');
  assert.equal(read.replan.requests.reduce((n, r) => n + r.quantity, 0), 2);
});
