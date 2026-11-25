import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { briefContent } from '../gcsp/scenarios/brief-start.js';
import { context, providerValue, provider, policy } from './helpers/employee-recommendation.js';

const fixtureUrl = new URL('../gcsp/fixtures/scenarios/suv-walkthrough-v1.json', import.meta.url);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('FUCQ-340: the bounded SUV preparation recomputes contrasting fits from the retained stock and canonical policy', async (t) => {
  const input = JSON.parse(readFileSync(fixtureUrl));
  const main = JSON.parse(readFileSync(new URL('../../apps/gcsp-web/e2e/fixtures/main-inputs.json', import.meta.url)));
  assert.equal(input.schemaVersion, 1);
  assert.equal(input.reset.scenarioId, main.scenario.scenarioId);
  assert.equal(input.reset.fixtureVersion, main.scenario.fixtureVersion);
  assert.deepEqual(input.mainStart, main.scenario.inputs.briefs[0]);
  assert.deepEqual(input.baseline, { ...input.mainStart, preferences: { ...input.mainStart.preferences,
    comfort: { value: 50, importance: 50 }, sportiness: { value: 50, importance: 50 } } });
  assert.deepEqual(input.suv, { ...input.baseline, preferences: { ...input.baseline.preferences, body: { value: 'suv', importance: 80 } } });
  assert.deepEqual(input.baseline.preferences.body, { value: 'estate', importance: 80 });
  assert.equal(input.stock.sha256, main.stockPlan.sha256);
  const bytes = gunzipSync(readFileSync(new URL('../../apps/gcsp-web/e2e/fixtures/main-stock-plan.json.gz', import.meta.url)));
  assert.equal(sha(bytes), input.stock.sha256);
  const plan = JSON.parse(bytes);
  const window = plan.windows.find((row) => row.windowId === input.stock.windowId);
  assert.ok(window);
  assert.equal(window.availableAt, input.stock.releaseAt);
  assert.equal(window.stock.length, input.stock.count);
  // StockService's release projection supplies availability; the source plan contains only its end.
  // The connected case below owns proof of the actual release/hold/offer path.
  const stock = window.stock.map(({ facts, ...car }) => ({ ...car, snapshot: facts,
    availability: { state: 'available', availableFrom: window.availableAt, version: window.windowId, ...car.availability } }));
  const body = new Map(stock.map((car) => [car.orderUuid, car.snapshot.facts.body.value]));
  assert.ok(stock.some((car) => body.get(car.orderUuid) === 'suv'));
  const policyService = policy();
  const time = { async now() { return { status: 'ok', value: { now: window.availableAt, runId: context.runId, clockVersion: '1' } }; } };
  const service = createEmployeeRecommendationService({ policy: policyService, provider: provider(providerValue(stock)), time });
  const results = {};
  for (const [name, briefInput] of [['baseline', input.baseline], ['suv', input.suv]]) {
    const content = await briefContent(policyService, { runId: context.runId, asOf: window.availableAt, policyVersion: context.policyVersion }, briefInput, 'scenario:suv-walkthrough-v1');
    const result = await service.previewUnsaved(context, { brief: content, baseBriefVersion: 1, baseDraftVersion: 0 });
    assert.equal(result.status, 'ok', JSON.stringify(result));
    const eligible = result.value.decisions.filter((decision) => decision.gateStatus === 'eligible');
    t.diagnostic(JSON.stringify({ name, eligibleBodies: eligible.reduce((counts, row) => {
      const key = body.get(row.orderUuid); counts[key] = (counts[key] ?? 0) + 1; return counts;
    }, {}), top: result.value.recommendations[0]?.orderUuid }));
    assert.ok(eligible.length > 0, `${name} has eligible stock`);
    const winner = result.value.recommendations[0]; assert.ok(winner);
    assert.equal(body.get(winner.orderUuid), briefInput.preferences.body.value, `${name} preference changes the actual top fit`);
    results[name] = { topBody: body.get(winner.orderUuid), eligible: eligible.length, orderUuid: winner.orderUuid };
  }
  assert.notEqual(results.baseline.orderUuid, results.suv.orderUuid);
  t.diagnostic(JSON.stringify(results));
});
