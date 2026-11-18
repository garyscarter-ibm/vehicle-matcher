#!/usr/bin/env node
// Explicit generated-stock acceptance proof; run ONE required F388_GENERATED_CASE per process.
// node --test --test-concurrency=1 _tools/gcsp-decline-reentry-generated-proof.mjs
// Cases: blocked-ev, blocked-phev, unchanged, home-ev, home-phev, home-diesel.
// All journey writes use actual HTTPS routes/services; no state mutation fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { writeFile } from 'node:fs/promises';
import { startGcspDemo } from '../scripts/gcsp-demo.mjs';
import { createRunStockProviderFactory } from '../server/gcsp/stock/index.js';
import { ALLOCATION_EVALUATION_CONSUMER, expandEvaluation } from '../server/gcsp/allocation/evaluation-rows.js';
import { createLocalHttpsFixture } from '../server/test/helpers/local-https.js';
import { createRouteClient, resetIntoScenario, presenterTick } from '../server/test/helpers/gcsp-decline-change-route.js';

const good = (r) => { assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.status, 'ok', JSON.stringify(r.json)); return r.json.value; };
const ok = (r) => { assert.equal(r.status, 'ok', JSON.stringify(r)); return r.value; };

// Generated release responses exceed the general fixture's 1 MiB. This test alone permits 8 MiB.
const generatedFetch = (ca) => (url, init = {}) => new Promise((resolve, reject) => {
  const target = new URL(url); assert.equal(target.hostname, 'localhost');
  const req = request(target, { ca, rejectUnauthorized: true, agent: false, autoSelectFamily: false,
    method: init.method ?? 'GET', headers: init.headers }, (res) => {
    const chunks = []; let size = 0;
    res.on('data', (chunk) => { size += chunk.length; if (size > 8 * 1024 * 1024) res.destroy(new Error('Generated response exceeded 8 MiB')); else chunks.push(chunk); });
    res.on('error', reject); res.on('end', () => {
      const headers = new Headers(); for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
      resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
    });
  });
  req.setTimeout(60000, () => req.destroy(new Error('Generated request timed out'))); req.on('error', reject); req.end(init.body);
});

async function setup(t) {
  const tls = await createLocalHttpsFixture(t);
  const stockFactory = createRunStockProviderFactory({ env: {} });
  const app = ok(await startGcspDemo({ port: 0, tls: tls.configuration, runtime: { mode: 'memory',
    stockProvider: stockFactory, environmentId: 'f388-generated', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'f388-bootstrap', sessionNow: () => '2026-11-18T00:00:00.000Z', adoptOfferJourney: true } }));
  t.after(() => app.close());
  const client = createRouteClient({ fetch: generatedFetch(tls.ca), origin: app.origin });
  client.seed(ok(await app.services.createLocalSession()).setCookie);
  return { app, client, stockFactory };
}

async function reset(f, label, charging) {
  const { client, app } = f;
  const { reset } = await resetIntoScenario(client, 'main-successful-journey', label + '-reset');
  assert.equal(reset.startState.status, 'ok');
  good(await client.request('/api/gcsp/session/switch', { principalId: 'demo-paula', commandId: label + '-paula' }));
  const context = ok(await app.services.identity.resolveSession({ authorized: true, cookie: client.cookie(), purpose: 'acting' }));
  const current = ok(await app.services.brief.readCurrent(context)).brief;
  const editor = ok(await app.services.editor.readEditor(context)).initial;
  const content = { schemaVersion: 1, preferences: structuredClone(current.preferences), essentials: structuredClone(current.essentials) };
  // Complete the current editor's three-category minimum through actual employee-confirmed input.
  for (const field of ['comfort', 'sportiness']) content.preferences[field] = { value: 50, importance: 50,
    valueState: 'confirmed', importanceState: 'confirmed', source: 'employee' };
  content.essentials.charging = { ...content.essentials.charging, value: charging ?? 'not-ready', source: 'employee', state: 'confirmed' };
  const saved = good(await client.request('/api/gcsp/brief/draft', { commandId: label + '-draft', expectedBriefVersion: current.briefVersion,
    expectedDraftVersion: editor.draftVersion, brief: content }));
  if (!saved.confirmed) good(await client.request('/api/gcsp/brief/confirm', { commandId: label + '-confirm', expectedBriefVersion: current.briefVersion,
    expectedDraftVersion: saved.draftVersion, consent: { search: true, hold: true } }));
  await presenterTick(client, label + '-initial-release', { mode: 'next-release' });
  const source = f.stockFactory.provider.describe(reset.runId);
  assert.equal(source?.source, 'generated', JSON.stringify({ runId: reset.runId, source }));
  f.stockSource = { runId: reset.runId, ...source };
  return reset.runId;
}

async function rows(f) {
  const context = ok(await f.app.services.identity.resolveSession({ authorized: true, cookie: f.client.cookie(), purpose: 'presenter-control' }));
  return Object.fromEntries(await Promise.all(['offers', 'decisions', 'briefs', 'stock', 'holds', 'event_receipts']
    .map(async (table) => [table, ok(await f.app.services.repository.query(context, table))])));
}
async function active(f) {
  const listed = good(await f.client.request('/api/gcsp/offers/current'));
  for (const reference of listed.offers) {
    const offer = good(await f.client.request('/api/gcsp/offers/' + encodeURIComponent(reference.offerId)
      + '?runId=' + encodeURIComponent(reference.runId)));
    if (['active', 'pending'].includes(offer.state)) return offer;
  }
}
async function decline(f, label, value) {
  const shown = await active(f);
  if (!shown) {
    const state = await rows(f);
    const latest = state.event_receipts.filter((r) => r.consumerId === ALLOCATION_EVALUATION_CONSUMER).at(-1);
    const evaluated = expandEvaluation(latest?.outcome?.value?.evaluation);
    const decisions = evaluated?.decisions ?? [];
    const blockerCounts = {};
    for (const d of decisions) for (const b of d.blockers ?? []) blockerCounts[b.code] = (blockerCounts[b.code] ?? 0) + 1;
    assert.fail('No actual offer: ' + JSON.stringify({ stock: state.stock.length, released: state.stock.filter((r) => r.state === 'released').length,
      brief: state.briefs.at(-1)?.buddy, offers: state.offers.slice(-4).map((o) => ({ employeeId: o.employeeId, state: o.state, orderUuid: o.orderUuid })),
      evaluation: evaluated ? { employeeId: evaluated.employeeId, versions: evaluated.versions, carsChecked: decisions.length, blockerCounts,
        eligible: decisions.filter((d) => d.gateStatus === 'eligible').slice(0, 4).map((d) => ({ orderUuid: d.orderUuid, score: d.score,
          blockers: d.blockers.map((b) => b.code) })) } : null }));
  }
  const first = (await rows(f)).offers.find((o) => o.offerId === shown.offerId); assert.ok(first);
  const path = '/api/gcsp/offers/' + encodeURIComponent(first.offerId);
  const view = good(await f.client.request(path));
  const decision = good(await f.client.request(path + '/decision', { commandId: label + '-decline', runId: first.runId, decision: 'decline',
    expectedOfferVersion: view.offerVersion, expectedHoldVersion: view.holdVersion, expectedQuoteVersion: view.quote.revisions.quote, reasonCode: 'fuel' }));
  const selector = '?decisionId=' + encodeURIComponent(decision.decisionId);
  if (value !== undefined) {
    const question = good(await f.client.request('/api/gcsp/offer-followup' + selector));
    good(await f.client.request('/api/gcsp/offer-followup/confirm', { commandId: label + '-answer', decisionId: decision.decisionId,
      expectedBriefVersion: question.briefVersion, questionVersion: question.question.questionVersion, value }));
  }
  await presenterTick(f.client, label + '-release', { mode: 'next-release' });
  const nextShown = await active(f); const persisted = await rows(f);
  const next = nextShown ? persisted.offers.find((o) => o.offerId === nextShown.offerId) : undefined;
  const employee = persisted.offers.find((o) => o.offerId === first.offerId).employeeId;
  const history = persisted.briefs.filter((b) => b.employeeId === employee).sort((a, b) => a.briefVersion - b.briefVersion);
  const evaluations = persisted.event_receipts.filter((e) => e.consumerId === ALLOCATION_EVALUATION_CONSUMER && e.outcome?.value?.employeeId === employee);
  const last = expandEvaluation(evaluations.at(-1)?.outcome?.value?.evaluation);
  const car = (id) => persisted.stock.find((s) => s.orderUuid === id);
  return { first, next, persisted, employee, history, last, outcome: good(await f.client.request('/api/gcsp/offer-followup' + selector)),
    observation: { label, runId: first.runId, rejectedOrderUuid: first.orderUuid, nextOrderUuid: next?.orderUuid ?? null,
      rejectedFuel: car(first.orderUuid)?.facts.facts.fuel.value, nextFuel: next ? car(next.orderUuid)?.facts.facts.fuel.value : null,
      briefVersions: history.map((b) => ({ version: b.briefVersion, fuel: b.preferences.fuel?.value ?? null, charging: b.essentials.charging.value })),
      decisions: (last?.decisions ?? last?.evaluation?.decisions ?? []).map((d) => ({ orderUuid: d.orderUuid, gateStatus: d.gateStatus, score: d.score, blockers: d.blockers })) } };
}

const cases = [
  { name: 'blocked-ev', fuel: 'ev' }, { name: 'blocked-phev', fuel: 'phev' },
  { name: 'unchanged' }, { name: 'home-ev', fuel: 'ev', charging: 'home' },
  { name: 'home-phev', fuel: 'phev', charging: 'home' }, { name: 'home-diesel', fuel: 'diesel', charging: 'home' },
];
const selected = process.env.F388_GENERATED_CASE;
assert.ok(cases.some(({ name }) => name === selected), 'Set F388_GENERATED_CASE to exactly one documented case.');
for (const trial of cases.filter(({ name }) => name === selected)) {
  test('generated stock: ' + trial.name, async (t) => {
    const f = await setup(t); const observations = []; await reset(f, trial.name, trial.charging);
    const result = await decline(f, trial.name, trial.fuel); observations.push(result.observation);
    if (!trial.fuel) assert.notEqual(result.next?.orderUuid, result.first.orderUuid);
    else if (!trial.charging) {
      assert.equal(result.next, undefined); assert.equal(result.outcome.state, 'no-match');
      assert.equal(result.history.at(-1).preferences.fuel.value, trial.fuel);
      assert.equal(result.history.at(-1).essentials.charging.value, 'not-ready');
    } else {
      assert.ok(result.next, 'matching generated alternative exists'); assert.equal(result.observation.nextFuel, trial.fuel);
      if (trial.fuel === 'ev') {
        const repeat = await decline(f, 'repeat-ev-to-petrol', 'petrol'); observations.push(repeat.observation);
        assert.ok(repeat.next); assert.equal(repeat.observation.nextFuel, 'petrol');
        assert.equal(repeat.history.at(-1).essentials.charging.value, 'home');
      }
    }
    const summary = { schema: 'fucq388-generated-stock/1', stockSource: f.stockSource, observations };
    if (process.env.F388_GENERATED_EVIDENCE) await writeFile(process.env.F388_GENERATED_EVIDENCE.replace(/\.json$/, '-' + trial.name + '.json'), JSON.stringify(summary, null, 2) + '\n');
    t.diagnostic(JSON.stringify(observations.map(({ decisions, ...entry }) => ({ ...entry, carsChecked: decisions.length }))));
  });
}
