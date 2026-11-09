// FUCQ-176 slice 1: experiment transport mappings, view models, job view and synthetic fixtures (no DOM, no port).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let adapterMod; let ev; let copy; let fixtures; let expFixture; let stored; let processStored;
before(async () => {
  const base = '../../blocks/gcsp/greg/comparison/';
  adapterMod = await import(`${base}http-adapter.js`);
  ev = await import(`${base}experiment-view.js`);
  copy = await import(`${base}comparison-copy.js`);
  fixtures = await import(`${base}fixtures.js`);
  expFixture = await import(`${base}experiment-fixture.js`);
  stored = JSON.parse(await readFile(new URL('./fixtures/gcsp-comparison-experiment-result.json', import.meta.url), 'utf8')).storedResult;
  processStored = JSON.parse(await readFile(new URL('./fixtures/gcsp-comparison-process-result.json', import.meta.url), 'utf8')).storedResult;
});
const clone = (v) => structuredClone(v);
const job = (over = {}) => ({ jobId: 'comparison-job-1', experimentId: 'hold-sweep', status: 'running', progress: { seedsDone: 1, seedsTotal: 3, stepsDone: 12, stepsTotal: 36 },
  startedAt: '2026-11-08T12:00:00.000Z', finishedAt: null, resultId: null, reason: null, request: { experimentId: 'hold-sweep', change: { values: [900, 5400], basis: 'Why' } }, ...over });
const OTHER = [[500, { status: 'error' }], [503, { status: 'unavailable', reason: 'Store is down.' }], [200, null], [200, { status: 'ok' }], [200, { status: 'other' }], [418, {}]];

test('the fixture copy equals the stored experiment result file', () => {
  assert.deepEqual(expFixture.STORED_HOLD_SWEEP, stored);
});

test('listOutcomeToState maps ready, refused, lapsed access and unavailable', () => {
  const value = { activePolicyVersion: 'v1', experiments: [{ experimentId: 'process-only', latest: null }, { experimentId: 'hold-sweep', latest: stored }] };
  assert.deepEqual(adapterMod.listOutcomeToState(200, { status: 'ok', value }), { status: 'ready', activePolicyVersion: 'v1', experiments: value.experiments });
  assert.equal(adapterMod.listOutcomeToState(200, { status: 'ok', value: { experiments: [] } }).activePolicyVersion, null);
  assert.deepEqual(adapterMod.listOutcomeToState(403, { status: 'forbidden' }), { status: 'refused' });
  assert.deepEqual(adapterMod.listOutcomeToState(401, { status: 'forbidden' }), { status: 'refused' });
  assert.deepEqual(adapterMod.listOutcomeToState(401, null), { status: 'access-required' });
  assert.deepEqual(adapterMod.listOutcomeToState(404, { status: 'not-found' }), { status: 'unavailable' });
  for (const [code, body] of OTHER) assert.equal(adapterMod.listOutcomeToState(code, body).status, 'unavailable', `${code}`);
  for (const bad of [{ experiments: 'x' }, { experiments: [{ experimentId: 'a', latest: {} }] }, { experiments: [{ latest: null }] }, { experiments: [null] }, []]) {
    assert.equal(adapterMod.listOutcomeToState(200, { status: 'ok', value: bad }).status, 'unavailable');
  }
  assert.deepEqual(adapterMod.listOutcomeToState(503, { status: 'unavailable', reason: 'Store is down.' }), { status: 'unavailable', reason: 'Store is down.' });
});

test('resultOutcomeToState maps ready, empty, refused, lapsed access and unavailable', () => {
  assert.deepEqual(adapterMod.resultOutcomeToState(200, { status: 'ok', value: stored }), { status: 'ready', stored });
  assert.deepEqual(adapterMod.resultOutcomeToState(200, { status: 'ok', value: processStored }), { status: 'ready', stored: processStored });
  assert.deepEqual(adapterMod.resultOutcomeToState(404, { status: 'not-found', resourceType: 'comparison_results' }), { status: 'empty' });
  assert.deepEqual(adapterMod.resultOutcomeToState(403, { status: 'forbidden' }), { status: 'refused' });
  assert.deepEqual(adapterMod.resultOutcomeToState(401, {}), { status: 'access-required' });
  assert.deepEqual(adapterMod.resultOutcomeToState(404, { status: 'other' }), { status: 'unavailable' });
  assert.equal(adapterMod.resultOutcomeToState(200, { status: 'ok', value: { result: { kind: 'other' } } }).status, 'unavailable');
  for (const [code, body] of OTHER) assert.equal(adapterMod.resultOutcomeToState(code, body).status, 'unavailable', `${code}`);
});

test('startOutcomeToState maps started, invalid, conflict, refused, lapsed access and unavailable', () => {
  const started = job({ status: 'running' });
  assert.deepEqual(adapterMod.startOutcomeToState(202, { status: 'pending', value: started }), { status: 'started', job: started });
  assert.equal(adapterMod.startOutcomeToState(202, { status: 'pending', value: {} }).status, 'unavailable');
  assert.equal(adapterMod.startOutcomeToState(202, null).status, 'unavailable');
  const invalid = adapterMod.startOutcomeToState(400, { status: 'invalid', code: 'invalid-experiment', reasons: [
    { field: 'change.values', key: 'hold.buddy.durationSeconds', reason: 'Too many.' }, { field: 'seeds', key: null, reason: '' }, { field: 'x', reason: 'No key.' }, null, { field: 'y' }] });
  assert.deepEqual(invalid, { status: 'invalid', reasons: [{ field: 'change.values', key: 'hold.buddy.durationSeconds', reason: 'Too many.' }, { field: 'x', key: null, reason: 'No key.' }] });
  assert.deepEqual(adapterMod.startOutcomeToState(400, { status: 'invalid' }), { status: 'invalid', reasons: [] });
  assert.deepEqual(adapterMod.startOutcomeToState(409, { status: 'conflict', code: 'job-running', jobId: 'j1', reason: 'Wait.' }), { status: 'conflict', jobId: 'j1', reason: 'Wait.' });
  assert.deepEqual(adapterMod.startOutcomeToState(409, { status: 'conflict' }), { status: 'conflict', jobId: null, reason: null });
  assert.deepEqual(adapterMod.startOutcomeToState(403, { status: 'forbidden' }), { status: 'refused' });
  assert.deepEqual(adapterMod.startOutcomeToState(401, null), { status: 'access-required' });
  assert.deepEqual(adapterMod.startOutcomeToState(503, { status: 'unavailable', reason: 'Busy.', retryable: true }), { status: 'unavailable', reason: 'Busy.' });
  for (const [code, body] of [[500, {}], [200, { status: 'ok' }], [400, { status: 'other' }], [409, { status: 'other' }]]) assert.equal(adapterMod.startOutcomeToState(code, body).status, 'unavailable', `${code}`);
});

test('jobOutcomeToState maps ok, none, refused, lapsed access and unavailable', () => {
  assert.deepEqual(adapterMod.jobOutcomeToState(200, { status: 'ok', value: job() }), { status: 'ok', job: job() });
  assert.deepEqual(adapterMod.jobOutcomeToState(404, { status: 'not-found', resourceType: 'comparison_jobs' }), { status: 'none' });
  assert.deepEqual(adapterMod.jobOutcomeToState(403, { status: 'forbidden' }), { status: 'refused' });
  assert.deepEqual(adapterMod.jobOutcomeToState(401, {}), { status: 'access-required' });
  assert.equal(adapterMod.jobOutcomeToState(200, { status: 'ok', value: { status: 'running' } }).status, 'unavailable');
  for (const [code, body] of OTHER) assert.equal(adapterMod.jobOutcomeToState(code, body).status, 'unavailable', `${code}`);
});

function fakeFetch(code, body) {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { status: code, json: async () => body }; };
  return { seen, adapter: adapterMod.createComparisonHttpAdapter({ base: 'https://x.test', fetchImpl }) };
}

test('the adapter sends the right method, URL, body and credentials for each call', async () => {
  const all = fakeFetch(200, { status: 'ok', value: { activePolicyVersion: 'v1', experiments: [] } });
  assert.equal((await all.adapter.loadAll({})).status, 'ready');
  assert.equal(all.seen[0].url, 'https://x.test/api/gcsp/comparison/results/latest');
  assert.equal(all.seen[0].init.method, 'GET'); assert.equal(all.seen[0].init.credentials, 'include'); assert.equal(all.seen[0].init.cache, 'no-store');
  assert.equal(all.seen[0].init.body, undefined);

  const one = fakeFetch(404, { status: 'not-found' });
  assert.deepEqual(await one.adapter.loadResult('hold sweep/&', {}), { status: 'empty' });
  assert.equal(one.seen[0].url, 'https://x.test/api/gcsp/comparison/results/latest?experimentId=hold%20sweep%2F%26');

  const go = fakeFetch(202, { status: 'pending', value: job() });
  const change = { values: [900, 5400], basis: 'Why' };
  assert.equal((await go.adapter.start({ experimentId: 'hold-sweep', change }, {})).status, 'started');
  const { url, init } = go.seen[0];
  assert.equal(url, 'https://x.test/api/gcsp/comparison/jobs'); assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store');
  assert.equal(init.headers['Content-Type'], 'application/json'); assert.equal(init.headers.Accept, 'application/json');
  assert.equal(init.body, JSON.stringify({ experimentId: 'hold-sweep', change }));
  await go.adapter.start({ experimentId: 'process-only' }, {});
  assert.equal(go.seen[1].init.body, '{"experimentId":"process-only"}');

  const read = fakeFetch(200, { status: 'ok', value: job() });
  assert.equal((await read.adapter.readJob({ jobId: 'comparison-job-1' }, {})).status, 'ok');
  assert.equal(read.seen[0].url, 'https://x.test/api/gcsp/comparison/jobs/latest?jobId=comparison-job-1'); assert.equal(read.seen[0].init.method, 'GET');
  await read.adapter.readJob(undefined, {}); await read.adapter.readJob({}, {});
  assert.equal(read.seen[1].url, 'https://x.test/api/gcsp/comparison/jobs/latest'); assert.equal(read.seen[2].url, 'https://x.test/api/gcsp/comparison/jobs/latest');
  const plain = fakeFetch(200, { status: 'ok', value: processStored });
  assert.equal((await plain.adapter.load({})).status, 'ready'); assert.equal(plain.seen[0].url, 'https://x.test/api/gcsp/comparison/process/latest');
});

test('network failure reads as unavailable and an abort rethrows, for every call', async () => {
  const down = adapterMod.createComparisonHttpAdapter({ fetchImpl: async () => { throw new Error('offline'); } });
  for (const run of [() => down.loadAll({}), () => down.loadResult('hold-sweep', {}), () => down.start({ experimentId: 'hold-sweep' }, {}), () => down.readJob({}, {})]) {
    assert.deepEqual(await run(), { status: 'unavailable' });
  }
  const controller = new AbortController(); controller.abort();
  const aborting = adapterMod.createComparisonHttpAdapter({ fetchImpl: async () => { throw new DOMException('Aborted', 'AbortError'); } });
  const { signal } = controller;
  for (const run of [() => aborting.loadAll({ signal }), () => aborting.loadResult('hold-sweep', { signal }), () => aborting.start({ experimentId: 'hold-sweep' }, { signal }), () => aborting.readJob({}, { signal })]) {
    await assert.rejects(run, { name: 'AbortError' });
  }
  const badBody = adapterMod.createComparisonHttpAdapter({ fetchImpl: async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }) });
  assert.deepEqual(await badBody.loadAll({}), { status: 'unavailable' });
});

test('value formatting reads for people', () => {
  assert.deepEqual([900, 7200, 5400, 86400, 3600, 90, 0].map(copy.formatHold), ['15 min', '2 h', '1 h 30 min', '24 h', '1 h', '90 s', '0 s']);
  assert.equal(copy.formatExperimentValue('points', 1.5), '1.5 times the allowance');
  assert.equal(copy.formatExperimentValue('points', 0), '0 times the allowance');
  assert.equal(copy.formatExperimentValue('order-mix', [{ modelLine: 'G21 Touring|320i', weight: 3 }, { modelLine: 'G60|520i', weight: 1 }]), 'G21 Touring|320i: 75%, G60|520i: 25%');
  assert.equal(copy.formatExperimentValue('order-mix', { odd: true }), '{"odd":true}');
});

const verdictOf = (view, route, measure, arm) => view.routes.find((r) => r.key === route).measures.find((m) => m.key === measure).arms[arm];

test('toExperimentView presents the stored hold sweep with figures only from the result', () => {
  const view = ev.toExperimentView(stored);
  assert.equal(view.id, 'hold-sweep'); assert.equal(view.label, 'Hold duration');
  assert.equal(view.change.key, 'hold.buddy.durationSeconds'); assert.equal(view.change.unit, 'seconds'); assert.equal(view.change.status, 'what-if');
  assert.equal(view.change.basis, stored.result.manifest.change.basis);
  assert.deepEqual(view.change.baseline, { value: 7200, text: '2 h', basis: stored.result.manifest.change.baselineBasis, status: 'assumed' });
  assert.deepEqual(view.change.values, [900, 86400]); assert.deepEqual(view.change.texts, ['15 min', '24 h']);
  assert.deepEqual(view.routes.map((r) => r.label), ['Buddy route', "Today's release route"]);
  const stats = stored.result.effects[0].routes.buddy.length;
  for (const [i, route] of view.routes.entries()) {
    const key = ['buddy', 'current'][i];
    assert.deepEqual(route.measures.map((m) => m.key), stored.result.effects[0].routes[key].map((e) => e.measure));
    assert.equal(route.measures.length, stats);
    for (const m of route.measures) {
      assert.deepEqual(m.rows.map((r) => r.label), ['2 h (today)', '15 min', '24 h']);
      assert.equal(m.arms.length, 2); assert.equal(typeof m.format, 'function'); assert.ok(m.scale.max >= m.scale.min);
    }
  }
  const coverage = view.routes[0].measures[0];
  const entry = stored.result.effects[0].routes.buddy[0];
  assert.equal(coverage.rows[0].mean, entry.baseline.mean); assert.equal(coverage.rows[1].mean, entry.variant.mean);
  assert.deepEqual(coverage.scale, { min: 0, max: 1 });
  assert.match(coverage.arms[0].differenceText, /^Difference \(15 min minus today\): /);
  assert.equal(coverage.arms[0].verdictText, 'No clear difference');
  const fit = view.routes[0].measures.find((m) => m.key === 'meanAcceptedFit');
  assert.equal(fit.arms[0].verdictText, 'Too few seeds to compare');
  assert.equal(view.meta.seeds, 3); assert.deepEqual(view.meta.seedList, stored.result.manifest.seeds); assert.equal(view.meta.employees, 4);
  assert.equal(view.provenance.policyHash.length, 12); assert.equal(view.provenance.resultId, stored.resultId); assert.equal(view.provenance.generatorVersion, stored.result.manifest.generatorVersion);
  assert.equal(view.provenance.codeRevision, stored.result.manifest.codeRevision); assert.equal(view.meta.codeRevision, stored.result.manifest.codeRevision);
  assert.ok(view.provenance.made && view.provenance.stored);
  assert.equal(view.oldPolicy, null); assert.equal(view.caveat, 'Calculated fit is not observed satisfaction.');
  assert.ok(!view.limitations.includes(view.caveat)); assert.ok(view.limitations.some((l) => /never published as live policy/.test(l)));
  assert.equal(view.assumptions.length, stored.result.assumptions.length);
  assert.deepEqual(Object.keys(view.assumptions[0]), ['key', 'value', 'unit', 'status', 'basis']);
});

test('bounds come from the stored definition, never from literals', () => {
  assert.deepEqual(ev.toExperimentView(stored).bounds, { minimum: 900, maximum: 86400, maximumValues: 5, unit: 'seconds' });
  const changed = clone(stored);
  const row = changed.result.assumptions.find((a) => a.key === 'comparison.experiments.v1');
  row.value.experiments['hold-sweep'] = { key: 'hold.buddy.durationSeconds', unit: 'seconds', minimum: 60, maximum: 120, maximumValues: 2 };
  assert.deepEqual(ev.toExperimentView(changed).bounds, { minimum: 60, maximum: 120, maximumValues: 2, unit: 'seconds' });
  changed.result.assumptions = changed.result.assumptions.filter((a) => a.key !== 'comparison.experiments.v1');
  assert.equal(ev.toExperimentView(changed).bounds, null);
});

test('an older policy and a missing caveat read honestly', () => {
  const old = { ...clone(stored), policyCurrent: false, activePolicyVersion: 'gcsp-policy-v2' };
  assert.equal(ev.toExperimentView(old).oldPolicy, copy.oldPolicyText('gcsp-policy-v1', 'gcsp-policy-v2'));
  delete old.result.caveat;
  assert.equal(ev.toExperimentView(old).caveat, copy.FALLBACK_CAVEAT);
});

test('every verdict has plain text and a baseline win reads as plainly as a variant win', () => {
  const changed = clone(stored);
  const buddy = changed.result.effects[0].routes.buddy;
  [buddy[0].verdict, buddy[1].verdict, buddy[2].verdict, buddy[3].verdict] = ['variant-better', 'baseline-better', 'no-clear-difference', 'insufficient-seeds'];
  const view = ev.toExperimentView(changed);
  const [a, b, c, d] = view.routes[0].measures.slice(0, 4).map((m) => m.arms[0]);
  assert.deepEqual([a.verdictText, b.verdictText, c.verdictText, d.verdictText], ['15 min better', "Today's value better", 'No clear difference', 'Too few seeds to compare']);
  assert.deepEqual([a.verdict, b.verdict], ['variant-better', 'baseline-better']);
  assert.equal(verdictOf(view, 'buddy', buddy[0].measure, 1).verdictText, 'No clear difference');
  buddy[0].verdict = 'buddy-better';
  assert.throws(() => ev.toExperimentView(changed), TypeError);
});

test('the view shows a single tried value for points and order-mix results', () => {
  const points = clone(stored);
  points.result.experimentId = 'points'; points.result.manifest.experimentId = 'points';
  Object.assign(points.result.manifest.change, { key: 'comparison.pointsAllowanceMultiplier', unit: 'allowance multiplier', baselineValue: 1, value: 1.5 }); delete points.result.manifest.change.values;
  points.result.effects = [{ ...points.result.effects[0], armId: 'variant', value: 1.5 }];
  const view = ev.toExperimentView(points);
  assert.deepEqual(view.change.texts, ['1.5 times the allowance']); assert.equal(view.change.baseline.text, '1 times the allowance');
  assert.deepEqual(view.routes[0].measures[0].rows.map((r) => r.label), ['1 times the allowance (today)', '1.5 times the allowance']);
  assert.equal(view.bounds.maximum, 3);
});

test('toExperimentView and toStoredView throw on malformed shapes', () => {
  const mutate = (fn) => { const c = clone(stored); fn(c); return c; };
  const bad = [null, [], {}, { result: {} }, processStored,
    mutate((c) => { c.result.effects = []; }), mutate((c) => { delete c.result.manifest; }), mutate((c) => { c.result.manifest.seeds = 'x'; }),
    mutate((c) => { delete c.policyVersion; }), mutate((c) => { delete c.result.manifest.change; }), mutate((c) => { c.result.manifest.change.values = []; }),
    mutate((c) => { c.result.effects.pop(); }), mutate((c) => { c.result.effects[0].routes.buddy = []; }), mutate((c) => { c.result.effects[1].routes.current[0].measure = 'other'; }),
    mutate((c) => { c.result.effects[0].routes.buddy[0].baseline = { mean: 'x', min: 0, max: 0 }; }), mutate((c) => { c.result.effects[1].routes.buddy[0].betterWhen = 'sideways'; }),
    mutate((c) => { c.result.assumptions = null; })];
  for (const item of bad) assert.throws(() => ev.toExperimentView(item), TypeError);
  for (const item of [null, {}, { result: { kind: 'other' } }]) assert.throws(() => ev.toStoredView(item), TypeError);
});

test('toStoredView dispatches on the result kind', async () => {
  const { toComparisonView } = await import('../../blocks/gcsp/greg/comparison/comparison-view.js');
  const process = ev.toStoredView(processStored);
  const direct = toComparisonView(processStored);
  assert.equal(process.kind, 'process'); assert.deepEqual(process.view.meta, direct.meta); assert.equal(process.view.measures.length, direct.measures.length);
  const experiment = ev.toStoredView(stored);
  assert.equal(experiment.kind, 'experiment'); assert.equal(experiment.view.id, 'hold-sweep');
});

test('toJobView describes each status with the real counts', () => {
  const running = ev.toJobView(job());
  assert.deepEqual([running.statusLabel, running.active, running.progressText], ['Running', true, 'Seeds done: 1 of 3. Steps: 12 of 36.']);
  assert.deepEqual(running.requested, { values: [900, 5400], texts: ['15 min', '1 h 30 min'], text: '15 min, 1 h 30 min', basis: 'Why' });
  assert.equal(running.reason, null); assert.equal(running.resultId, null); assert.equal(running.finishedAt, null); assert.ok(running.startedAt); assert.equal(running.jobId, 'comparison-job-1');
  const starting = ev.toJobView(job({ status: 'starting', progress: { seedsDone: 0, seedsTotal: 0, stepsDone: 0, stepsTotal: 0 } }));
  assert.deepEqual([starting.statusLabel, starting.active, starting.progressText], ['Starting', true, 'Preparing the run.']);
  const done = ev.toJobView(job({ status: 'succeeded', progress: { seedsDone: 3, seedsTotal: 3, stepsDone: 36, stepsTotal: 36 }, finishedAt: '2026-11-08T12:01:00.000Z', resultId: 'r1', reason: 'ignored' }));
  assert.deepEqual([done.statusLabel, done.active, done.resultId, done.reason, done.progressText], ['Finished', false, 'r1', null, 'Seeds done: 3 of 3. Steps: 36 of 36.']);
  assert.ok(done.finishedAt);
  const failed = ev.toJobView(job({ status: 'failed', reason: 'The comparison could not be completed.' }));
  assert.deepEqual([failed.statusLabel, failed.active, failed.reason], ['Failed', false, 'The comparison could not be completed.']);
  const stopped = ev.toJobView(job({ status: 'interrupted', reason: 'The backend stopped before the comparison finished.' }));
  assert.deepEqual([stopped.statusLabel, stopped.active, stopped.reason], ['Stopped before it finished', false, 'The backend stopped before the comparison finished.']);
  assert.equal(ev.toJobView(job({ request: { experimentId: 'process-only', change: null }, experimentId: 'process-only' })).requested, null);
  assert.deepEqual(ev.toJobView(job({ experimentId: 'points', request: { experimentId: 'points', change: { value: 2, basis: 'b' } } })).requested.texts, ['2 times the allowance']);
  for (const item of [null, [], {}, job({ status: 'paused' }), job({ jobId: '' }), job({ progress: null }), job({ progress: { seedsDone: -1, seedsTotal: 3, stepsDone: 0, stepsTotal: 1 } }),
    job({ progress: { seedsDone: 'x', seedsTotal: 3, stepsDone: 0, stepsTotal: 1 } })]) assert.throws(() => ev.toJobView(item), TypeError);
});

const EXPERIMENT_IDS = ['process-only', 'order-mix', 'points', 'hold-sweep'];
const latestOf = (state, id) => state.experiments.find((e) => e.experimentId === id).latest;

test('the experiment fixtures list their scenarios and answer through the mappings', async () => {
  assert.deepEqual([...fixtures.EXPERIMENT_FIXTURE_NAMES], ['experiments-ready', 'experiments-empty', 'experiments-old-policy', 'experiments-refused', 'experiments-unavailable',
    'job-running', 'job-succeeds', 'job-fails', 'job-interrupted', 'start-invalid', 'start-conflict', 'start-refused']);
  assert.equal(fixtures.experimentFixtureAdapter('nope'), null);
  for (const name of fixtures.EXPERIMENT_FIXTURE_NAMES) {
    const adapter = fixtures.experimentFixtureAdapter(name);
    assert.deepEqual(Object.keys(adapter).sort(), ['loadAll', 'loadResult', 'readJob', 'start']);
  }
  const ready = await fixtures.experimentFixtureAdapter('experiments-ready').loadAll();
  assert.equal(ready.status, 'ready'); assert.deepEqual(ready.experiments.map((e) => e.experimentId), EXPERIMENT_IDS);
  assert.deepEqual(EXPERIMENT_IDS.map((id) => latestOf(ready, id) !== null), [true, false, false, true]);
  assert.equal(ev.toStoredView(latestOf(ready, 'process-only')).kind, 'process'); assert.equal(ev.toStoredView(latestOf(ready, 'hold-sweep')).kind, 'experiment');
  const empty = await fixtures.experimentFixtureAdapter('experiments-empty').loadAll();
  assert.ok(empty.experiments.every((e) => e.latest === null));
  assert.deepEqual(await fixtures.experimentFixtureAdapter('experiments-empty').loadResult('hold-sweep'), { status: 'empty' });
  const old = fixtures.experimentFixtureAdapter('experiments-old-policy');
  const oldState = await old.loadAll();
  assert.equal(oldState.activePolicyVersion, 'gcsp-policy-v2'); assert.equal(latestOf(oldState, 'hold-sweep').policyCurrent, false);
  assert.ok(ev.toExperimentView((await old.loadResult('hold-sweep')).stored).oldPolicy);
  const refused = fixtures.experimentFixtureAdapter('experiments-refused');
  assert.deepEqual([await refused.loadAll(), await refused.loadResult('hold-sweep'), await refused.start({ experimentId: 'hold-sweep' }), await refused.readJob()], Array(4).fill({ status: 'refused' }));
  const down = fixtures.experimentFixtureAdapter('experiments-unavailable');
  assert.deepEqual([await down.loadAll(), await down.loadResult('points')], Array(2).fill({ status: 'unavailable' }));
});

const REQUEST = { experimentId: 'hold-sweep', change: { values: [3600, 10800], basis: 'Does a longer hold help?' } };

test('job-succeeds advances one step per read and then stores a matching new result', async () => {
  const adapter = fixtures.experimentFixtureAdapter('job-succeeds');
  assert.deepEqual(await adapter.readJob({}), { status: 'none' });
  const started = await adapter.start(REQUEST);
  assert.equal(started.status, 'started'); const first = ev.toJobView(started.job);
  assert.deepEqual([first.statusLabel, first.progressText], ['Running', 'Seeds done: 0 of 3. Steps: 0 of 18.']);
  const before = await adapter.loadResult('hold-sweep');
  assert.equal(before.stored.resultId, expFixture.STORED_HOLD_SWEEP.resultId, 'previous result stays while running');
  const steps = [];
  for (let i = 0; i < 4; i += 1) { const state = await adapter.readJob({ jobId: started.job.jobId }); assert.equal(state.status, 'ok'); steps.push(ev.toJobView(state.job)); }
  assert.deepEqual(steps.map((s) => s.progressText), ['Seeds done: 1 of 3. Steps: 6 of 18.', 'Seeds done: 2 of 3. Steps: 12 of 18.', 'Seeds done: 3 of 3. Steps: 18 of 18.', 'Seeds done: 3 of 3. Steps: 18 of 18.']);
  assert.deepEqual(steps.map((s) => s.statusLabel), ['Running', 'Running', 'Finished', 'Finished']);
  const last = steps[3]; assert.ok(last.resultId);
  const after = await adapter.loadResult('hold-sweep');
  assert.equal(after.stored.resultId, last.resultId);
  const view = ev.toExperimentView(after.stored);
  assert.deepEqual(view.change.values, [3600, 10800]); assert.deepEqual(view.change.texts, ['1 h', '3 h']); assert.equal(view.change.basis, 'Does a longer hold help?');
  assert.deepEqual(view.routes[0].measures[0].rows.map((r) => r.label), ['2 h (today)', '1 h', '3 h']);
  assert.equal(latestOf(await adapter.loadAll(), 'hold-sweep').resultId, last.resultId);
  assert.deepEqual(await adapter.readJob({ jobId: 'another' }), { status: 'none' });
});

test('job-running, job-fails and job-interrupted never produce a new result', async () => {
  const running = fixtures.experimentFixtureAdapter('job-running');
  const seen = [];
  for (let i = 0; i < 4; i += 1) seen.push(ev.toJobView((await running.readJob({})).job).progressText);
  assert.deepEqual(seen, ['Seeds done: 1 of 3. Steps: 6 of 18.', 'Seeds done: 2 of 3. Steps: 12 of 18.', 'Seeds done: 2 of 3. Steps: 12 of 18.', 'Seeds done: 2 of 3. Steps: 12 of 18.']);
  assert.equal((await running.start(REQUEST)).status, 'conflict');
  assert.equal((await running.loadResult('hold-sweep')).stored.resultId, expFixture.STORED_HOLD_SWEEP.resultId);
  for (const [name, label, reason] of [['job-fails', 'Failed', 'The comparison used more than its 128 MB memory allowance and was stopped.'],
    ['job-interrupted', 'Stopped before it finished', 'The backend stopped before the comparison finished.']]) {
    const adapter = fixtures.experimentFixtureAdapter(name);
    assert.equal((await adapter.start(REQUEST)).status, 'started');
    await adapter.readJob({}); const end = ev.toJobView((await adapter.readJob({})).job);
    assert.deepEqual([end.statusLabel, end.reason, end.resultId, end.active], [label, reason, null, false]);
    assert.equal(ev.toJobView((await adapter.readJob({})).job).statusLabel, label);
    assert.equal((await adapter.loadResult('hold-sweep')).stored.resultId, expFixture.STORED_HOLD_SWEEP.resultId);
  }
});

test('start scenarios answer invalid, conflict and refused', async () => {
  const invalid = await fixtures.experimentFixtureAdapter('start-invalid').start(REQUEST);
  assert.equal(invalid.status, 'invalid'); assert.equal(invalid.reasons[0].field, 'change.values'); assert.equal(invalid.reasons[0].key, 'hold.buddy.durationSeconds');
  const conflict = await fixtures.experimentFixtureAdapter('start-conflict').start(REQUEST);
  assert.equal(conflict.status, 'conflict'); assert.ok(conflict.jobId); assert.ok(conflict.reason);
  assert.deepEqual(await fixtures.experimentFixtureAdapter('start-refused').start(REQUEST), { status: 'refused' });
});

test('all new on-screen copy is free of em dashes', () => {
  const strings = [copy.WHAT_IF, copy.PREPARING, ...Object.values(copy.JOB_STATUS), ...Object.values(copy.EXPERIMENT_VERDICTS),
    ...Object.values(copy.EXPERIMENTS).flatMap((e) => [e.label, e.summary]), copy.experimentVerdict('variant-better', '15 min'),
    copy.experimentDifferenceText('count', { mean: 1, min: 0, max: 2 }, '15 min'), copy.jobProgressText({ seedsDone: 1, seedsTotal: 3, stepsDone: 2, stepsTotal: 6 }),
    ...[900, 5400].map(copy.formatHold), copy.formatExperimentValue('points', 2)];
  for (const s of strings) assert.ok(!s.includes('—'), s);
  assert.deepEqual(Object.keys(copy.EXPERIMENTS), EXPERIMENT_IDS);
  for (const s of [copy.EMPTY_TITLE, copy.EMPTY_NOTE]) assert.ok(!s.includes('—') && !s.includes('scripts/'), s);
  for (const id of EXPERIMENT_IDS) assert.equal(copy.EXPERIMENTS[id].command, undefined);
  const view = ev.toExperimentView(stored); const text = JSON.stringify(view, (k, v) => (typeof v === 'function' ? undefined : v));
  assert.ok(!text.includes('—') || stored.result.assumptions.some((a) => JSON.stringify(a).includes('—')), 'view adds no em dash');
});
