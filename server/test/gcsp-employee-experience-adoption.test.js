import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../gcsp/policy/index.js';
import { adoptOfferJourneyPolicy } from '../gcsp/policy/offer-journey-adoption.js';
import { adoptEmployeeExperiencePolicy } from '../gcsp/policy/employee-experience-adoption.js';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createLocalHttpsFixture } from './helpers/local-https.js';

const NOW = '2026-11-05T09:00:00.000Z';
const good = (out) => { assert.equal(out?.status, 'ok', JSON.stringify(out)); return out.value; };
const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const key = 'employee.currentCarFeedback.v1';
const oldSeed = () => { const old = structuredClone(seed); old.assumptions = old.assumptions.filter((row) => row.key !== 'brief.engagement.v1');
  old.assumptions.find((row) => row.key === key).value.sameAgain.dimensions = ['eligibilityModelKey', 'body', 'fuel'];
  old.assumptions.push({ ...structuredClone(old.assumptions.find((row) => row.key === 'brief.slider.minimum')), key: 'custom.retained.example', value: 17 });
  return old; };
const configuredFeedback = (value) => ({ ...structuredClone(value), rating: { positive: [5], negative: [1, 2, 3], neutral: [4] },
  similarity: { dimensions: ['fuel'] }, improvement: { requireNoWorseOnAll: false, requireBetterOnAtLeast: 2 } });
async function fixture(t, { retained = oldSeed() } = {}) {
  const store = createMemoryStore(); const policyStore = createMemoryPolicyStore(); let current;
  const start = async (adoptOfferJourney = false) => {
    const policy = new PolicyService({ provider: new MemoryPolicyProvider({ store: policyStore, seedProvider: { loadVersions: async () => [retained] } }) });
    current = good(await createGcspRuntime({ mode: 'memory', repository: createMemoryRepository({ store }), policy,
      environmentId: 'retained-employee-experience', policyAsOf: NOW, commandId: 'bootstrap', sessionNow: () => NOW, adoptOfferJourney }));
    return current;
  };
  t.after(async () => current?.close());
  const runtime = await start(); good(await adoptOfferJourneyPolicy(runtime));
  const context = good(await runtime.createLocalSession()).context;
  return { store, policyStore, runtime, context, start };
}

test('retained policy reproduces Engage 503; startup appends reviewed grants and feedback without losing preferences/history', async (t) => {
  const f = await fixture(t); const { runtime, context } = f;
  const read = good(await runtime.editor.readEditor(context));
  const saved = good(await runtime.editor.savePreferences(context, { commandId: 'same-again', expectedBriefVersion: 0, expectedDraftVersion: 0,
    changes: {}, sameAgain: { contractId: read.initial.sameAgain.contractId, on: true } }));
  const input = { commandId: 'engage-before', expectedBriefVersion: saved.briefVersion, expectedDraftVersion: saved.draftVersion };
  const failed = await runtime.editor.engage(context, input);
  assert.equal(failed.status, 'unavailable'); assert.equal(failed.reason, 'The brief service is unavailable.');
  const retained = structuredClone(f.policyStore.runs.get(context.runId));
  const draftRows = structuredClone(f.store.state.tables.event_receipts.filter((row) => row.consumerId.startsWith('brief:draft:')));
  await runtime.close(); const reopened = await f.start(true);
  const employee = good(await reopened.createLocalSession()).context;
  assert.equal(employee.runId, context.runId); assert.notEqual(employee.policyVersion, context.policyVersion);
  const versions = f.policyStore.runs.get(context.runId);
  assert.equal(versions.length, retained.length + 1); assert.deepEqual(versions.slice(0, -1), retained);
  const adopted = versions.at(-1);
  assert.deepEqual(adopted.adoption.addedKeys, ['brief.engagement.v1']);
  assert.deepEqual(adopted.adoption.updatedKeys, [key]);
  assert.deepEqual(adopted.adoption.superseded.map((row) => row.key), [key]);
  assert.deepEqual(adopted.adoption.superseded[0], retained.at(-1).seed.assumptions.find((row) => row.key === key));
  assert.equal(adopted.seed.assumptions.find((row) => row.key === 'custom.retained.example').value, 17);
  assert.deepEqual(adopted.seed.assumptions.find((row) => row.key === key).value, seed.assumptions.find((row) => row.key === key).value);
  assert.deepEqual(f.store.state.tables.event_receipts.filter((row) => row.consumerId.startsWith('brief:draft:')), draftRows);
  const loaded = good(await reopened.editor.readEditor(employee)); assert.equal(loaded.initial.sameAgain.on, true);
  const engaged = good(await reopened.editor.engage(employee, { commandId: 'engage-after', expectedBriefVersion: loaded.initial.briefVersion, expectedDraftVersion: loaded.initial.draftVersion }));
  assert.equal(engaged.buddy.state, 'engaged');
  assert.equal(good(await reopened.clock.now(employee)).now, '2026-11-05T09:00:00.001Z', 'only the publication collision advances one millisecond');
});

test('repeated startup is idempotent; scenario reset adopts the combined reviewed set once in the new run', async (t) => {
  const f = await fixture(t); await f.runtime.close(); const first = await f.start(true);
  const original = good(await first.createLocalSession()).context; const before = inputDigest([...f.policyStore.runs]);
  await first.close(); const reopened = await f.start(true);
  assert.equal(inputDigest([...f.policyStore.runs]), before);
  const presenter = good(await reopened.identity.createPresenterSession('reset')).context;
  const scenario = good(await reopened.scenarios.readCatalogue(presenter)).scenarios.find((row) => row.kind === 'mechanics');
  const state = good(await reopened.scenarios.readState(presenter));
  const reset = good(await reopened.scenarios.reset(presenter, { commandId: 'reset-experience', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion, fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion }));
  assert.notEqual(reset.runId, original.runId);
  const renewed = good(await reopened.identity.createPresenterSession('after-reset')).context;
  const now = good(await reopened.clock.now(renewed)).now;
  for (const name of ['brief.engagement.v1', key, 'offer.declineReasons.v1', 'offer.followupQuestions.v1'])
    assert.equal((await reopened.policy.getAssumption(name, { runId: renewed.runId, asOf: now, policyVersion: renewed.policyVersion })).status, 'ok');
  assert.equal(f.policyStore.runs.get(renewed.runId).length, 2, 'one combined publication, including offer sets');
});

test('current reviewed values do not create another publication or move the clock', async (t) => {
  const f = await fixture(t, { retained: seed }); const before = inputDigest([...f.policyStore.runs]);
  await f.runtime.close(); const reopened = await f.start(true);
  assert.equal(inputDigest([...f.policyStore.runs]), before);
  const context = good(await reopened.createLocalSession()).context;
  assert.equal(good(await reopened.clock.now(context)).now, NOW);
});

test('structural feedback upgrade preserves configured rating, similarity, improvement and unrelated assumptions', async (t) => {
  const retained = oldSeed(); const previous = retained.assumptions.find((row) => row.key === key);
  previous.value = configuredFeedback(previous.value); previous.status = 'verified'; previous.basis = 'Greg configured these thresholds.';
  const original = structuredClone(previous);
  const f = await fixture(t, { retained }); await f.runtime.close(); const reopened = await f.start(true);
  const context = good(await reopened.createLocalSession()).context;
  const publication = f.policyStore.runs.get(context.runId).at(-1);
  const next = publication.seed.assumptions.find((row) => row.key === key);
  assert.deepEqual(next.value, { ...original.value, sameAgain: { dimensions: [...original.value.sameAgain.dimensions, 'configurationId'] } });
  assert.equal(next.status, 'verified'); assert.ok(next.basis.startsWith(original.basis));
  assert.deepEqual(publication.adoption.superseded, [f.policyStore.runs.get(context.runId).at(-2).seed.assumptions.find((row) => row.key === key)]);
  assert.deepEqual(publication.adoption.transformations, [{ key, path: 'value.sameAgain.dimensions', appended: ['configurationId'] }]);
  assert.equal(publication.seed.assumptions.find((row) => row.key === 'custom.retained.example').value, 17);
});

test('valid configured engagement and feedback survive startup and a later Greg policy edit survives another restart', async (t) => {
  const retained = structuredClone(seed); const feedback = retained.assumptions.find((row) => row.key === key);
  feedback.value = configuredFeedback(feedback.value);
  retained.assumptions.find((row) => row.key === 'brief.engagement.v1').value.grants = { search: false, hold: false };
  const f = await fixture(t, { retained }); const before = inputDigest([...f.policyStore.runs]);
  await f.runtime.close(); const reopened = await f.start(true);
  assert.equal(inputDigest([...f.policyStore.runs]), before);
  const presenter = good(await reopened.identity.createPresenterSession('later-edit')).context;
  good(await reopened.clock.advance(presenter, { commandId: 'later-policy-time', expectedClockVersion: '1', bySeconds: 1 }));
  const greg = good(await reopened.identity.switchPrincipal(presenter, 'demo-greg', 'later-policy-greg')).context;
  const value = { ...feedback.value, rating: { positive: [4, 5], negative: [1], neutral: [2, 3] } };
  good(await reopened.policy.publishPolicyVersion(greg, { commandId: 'later-policy', expectedActiveVersion: greg.policyVersion,
    policyVersion: `${greg.policyVersion}+greg-edit`, effectiveFrom: '2026-11-05T09:00:01.000Z', changes: [{ table: 'assumptions', key,
      patch: { value, status: 'verified', basis: 'Later explicit rating calibration.', source: 'synthetic:greg-edit', sourceDate: '2026-11-05' } }] }));
  await reopened.close(); const again = await f.start(true);
  const context = good(await again.createLocalSession()).context; const versions = f.policyStore.runs.get(context.runId);
  assert.equal(versions.length, 3); assert.equal(versions.at(-1).seed.policyVersion, `${greg.policyVersion}+greg-edit`);
  assert.deepEqual(versions.at(-1).seed.assumptions.find((row) => row.key === key).value, value);
  assert.equal(good(await again.clock.now(context)).now, '2026-11-05T09:00:01.000Z');
});

test('malformed or unrecognized employee rules fail visibly before publication or clock movement', async (t) => {
  for (const transform of [
    (old) => { old.assumptions.find((row) => row.key === key).value.rating.positive = [7]; },
    (old) => { old.assumptions.find((row) => row.key === key).value.sameAgain.dimensions = ['fuel']; },
    (old) => { old.assumptions.find((row) => row.key === 'brief.engagement.v1').value.grants.search = 'true'; },
  ]) {
    const retained = structuredClone(seed); transform(retained);
    const f = await fixture(t, { retained }); const before = inputDigest([...f.policyStore.runs]);
    const outcome = await adoptEmployeeExperiencePolicy(f.runtime);
    assert.equal(outcome.status, 'unavailable'); assert.equal(outcome.code, 'employee-experience-policy-unavailable');
    assert.equal(inputDigest([...f.policyStore.runs]), before);
    assert.equal(good(await f.runtime.clock.now(f.context)).now, NOW);
    await f.runtime.close();
  }
});

test('bounded refresh requires Greg and its reviewed set; exact replay appends no second version', async (t) => {
  const f = await fixture(t); const { runtime } = f;
  const presenter = good(await runtime.identity.createPresenterSession('refresh-guards')).context;
  good(await runtime.clock.advance(presenter, { commandId: 'refresh-time', expectedClockVersion: '1', to: '2026-11-05T09:00:00.001Z' }));
  const greg = good(await runtime.identity.switchPrincipal(presenter, 'demo-greg', 'refresh-greg')).context;
  const input = { commandId: 'explicit-refresh', expectedActiveVersion: greg.policyVersion,
    policyVersion: `${greg.policyVersion}+employee-experience-v1`, effectiveFrom: '2026-11-05T09:00:00.001Z', definitionSetId: 'employee-experience-v1' };
  const before = inputDigest([...f.policyStore.runs]);
  assert.equal((await runtime.policy.refreshEmployeeExperience(f.context, input)).status, 'forbidden');
  assert.equal((await runtime.policy.refreshEmployeeExperience(greg, { ...input, definitionSetId: 'offer-journey-v1' })).status, 'invalid');
  assert.equal(inputDigest([...f.policyStore.runs]), before);
  const first = good(await runtime.policy.refreshEmployeeExperience(greg, input));
  const replay = good(await runtime.policy.refreshEmployeeExperience(greg, input));
  assert.deepEqual(replay, first); assert.equal(f.policyStore.runs.get(greg.runId).length, 3);
  assert.equal((await runtime.policy.refreshEmployeeExperience(greg, { ...input, policyVersion: 'changed' })).status, 'conflict');
});

test('real HTTPS host upgrades the retained provider before authenticated Same again and Engage return200', async (t) => {
  const f = await fixture(t); await f.runtime.close();
  const tls = await createLocalHttpsFixture(t);
  const policy = new PolicyService({ provider: new MemoryPolicyProvider({ store: f.policyStore, seedProvider: { loadVersions: async () => [oldSeed()] } }) });
  const app = good(await startGcspDemo({ runtime: { mode: 'memory', repository: createMemoryRepository({ store: f.store }), policy,
    environmentId: 'retained-employee-experience', policyAsOf: NOW, commandId: 'bootstrap', sessionNow: () => NOW, adoptOfferJourney: true }, tls: tls.configuration }));
  t.after(() => app.close());
  const login = await tls.fetch(`${app.origin}/api/gcsp/session/login`, { method: 'POST',
    headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'paula.mason@gcsp-demo.com', password: 'fucq' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().filter((row) => !/Max-Age=0(?:;|$)/i.test(row)).map((row) => row.split(';')[0]).join('; ');
  const request = async (path, body) => {
    const response = await tls.fetch(`${app.origin}${path}`, { method: body ? 'POST' : 'GET',
      headers: { Cookie: cookie, Origin: app.origin, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200); return good(await response.json());
  };
  const editor = await request('/api/gcsp/brief/editor');
  const saved = await request('/api/gcsp/brief/preferences', { commandId: 'http-same-again', expectedBriefVersion: editor.initial.briefVersion,
    expectedDraftVersion: editor.initial.draftVersion, changes: {}, sameAgain: { contractId: editor.initial.sameAgain.contractId, on: true } });
  const engaged = await request('/api/gcsp/brief/engage', { commandId: 'http-engage', expectedBriefVersion: saved.briefVersion, expectedDraftVersion: saved.draftVersion });
  assert.equal(engaged.buddy.state, 'engaged');
  const activity = await request('/api/gcsp/activity');
  assert.equal(activity.permission.canSearch, true); assert.equal(activity.permission.canHold, true);
});
