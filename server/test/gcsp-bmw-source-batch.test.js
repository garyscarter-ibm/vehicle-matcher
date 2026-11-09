/** Scripted protocol fixtures only: no public source requests or capacity claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { createFleetCollector, buildCandidateQueue } from '../../scripts/gcsp/collect-fleet.mjs';
import { createBmwCatalogueAdapter } from '../vehicle-evidence/bmw-catalogue-adapter.js';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const original = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq-58/complete-selection-2026-11-07/collection-plan.json', import.meta.url)));
const retainedOptions = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq59/canonical-source-live-2026-11-06/options.json', import.meta.url)));
const definitions = retainedOptions.report.candidates[0].definitions;
function fixture(count = 2) {
  const plan = { ...structuredClone(original), planId: 'batch-fixture', seed: 'batch-diversity', source: { ...original.source, version: 'f59-batch-20261107.v1' },
    target: count, candidateCount: count, modelRegistration: { schemaVersion: 'bmw-public-model-registration.v1', modelCode: 'T5MJ', agModelCode: '72HH',
      catalogueRangeKey: 'G61E', rawModelRange: 'G61', aliases: ['5', 'I'], market: 'GB', locale: 'en-GB', steering: 'RL',
      catalogueDate: '2026-11-01', orderDate: '2026-11-01', effectDate: '2027-01-05' },
    limits: { ...original.limits, maxCandidates: count, requestBudgets: { page: 1, settings: 1, discover: 1, options: 1, solve: count },
      sourceAttempts: count + 4, sourceBytes: 8388608, checkpointBytes: 8388608, deadlineMs: 120000, cacheEntries: count + 8 } };
  delete plan.knownSelection;
  plan.candidates = Array.from({ length: count }, (_, i) => ({ candidateId: `candidate-${i}`, request: {
    includedElements: [i % 2 ? 'FKSJX' : 'FKSFU', i % 2 ? 'P0475' : 'P0300', 'S0337', 'S03G9', 'S043L'].sort(), mandatoryElements: ['S0337'] } }));
  return plan;
}
async function setup(context, { count = 2, mutate = () => {}, duplicate = false, mode = 'live' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bmw-batch-')); context.after(() => rm(root, { recursive: true, force: true }));
  const plan = fixture(count); const calls = []; const outcomes = []; const pins = { projectorSha256: sha('fixture-projector'), qualifierSha256: sha('fixture-binder'), sessionSha256: sha('fixture-session'), policyVersion: plan.policyRead.policyVersion };
  const model = { modelCode: 'T5MJ', agModelCode: '72HH', modelRange: 'G61', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05' };
  const tree = Object.fromEntries(['5', 'I'].map((group) => [group, { modelRanges: { G61E: { models: { T5MJ: structuredClone(model) } } } }]));
  const options = Object.fromEntries(definitions.map((row) => [row.code, { option: row.code, optionType: row.optionType }]));
  const settings = { APP: { backend: { settingsVehicleTree: { 'x-api-key': 'private-tree-fixture' }, settingsLocalisation: { 'x-api-key': 'private-options-fixture' }, settingsRuleSolver: { 'x-api-key': 'private-solver-fixture' } } } };
  const data = { plan, tree, options, settings }; mutate(data);
  const fetch = async (input) => {
    const url = new URL(input); calls.push(url.href); let value;
    if (url.pathname.includes('/configure/')) return new Response('<script src="settings.fixture.json"></script>', { headers: { 'content-type': 'text/html' } });
    if (url.pathname.includes('/settings.')) value = settings;
    else if (url.pathname.includes('/vehicle-trees/')) value = tree;
    else if (url.pathname.includes('/options/')) value = options;
    else {
      const codes = url.searchParams.get('included-elements').split(',');
      const selected = duplicate ? ['FKSFU', 'P0300', 'S0337', 'S03G9', 'S043L'] : codes;
      const elements = Object.fromEntries([...selected, 'S0230', 'SE000001'].sort().map((code) => [code, { code, type: code === 'SE000001' ? 'accessory' : 'option' }]));
      value = { constructible: true, configuration: { modelCode: 'T5MJ', elements }, configurationChanges: {
        addedElements: Object.fromEntries(Object.entries(elements).filter(([code]) => !codes.includes(code))),
        removedElements: Object.fromEntries(codes.filter((code) => !selected.includes(code)).map((code) => [code, { code, type: 'option' }])), ignoredElements: {} } };
      outcomes.push(value); if (data.solver) data.solver(value, outcomes.length);
    }
    return new Response(typeof value === 'string' ? value : JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  };
  const input = { plan, mode, source: structuredClone(plan.source), statePath: join(root, 'session.json'),
    policyService: new PolicyService({ provider: new FilePolicyProvider() }), now: () => Date.parse('2026-11-07T01:00:00.000Z'),
    batchBinding: { producerPins: pins, snapshotVersion: 'fixture-source-batch.v2', existingConfigurationIds: [] },
    http: { kind: mode === 'live' ? 'live' : 'fixture', fetch,
      ...(mode === 'live' ? { allocation: { id: 'fixture-only-allocation', sourceVersion: plan.source.version, planDigest: inputDigest(plan), attempts: count + 4, bytes: 8388608 } } : {}) } };
  return { input, calls, outcomes };
}

test('finite batch qualifies fresh definitions and persists two distinct source-bound selections through the existing ports', async (context) => {
  const { input, calls } = await setup(context); const collector = await createFleetCollector(input); assert.equal(calls.length, 0);
  const result = await collector.run(); assert.equal(result.accepted.length, 2); assert.equal(result.counts.httpAttempts, 6);
  assert.equal(result.status, 'complete'); assert.equal(result.accepted[0].admission, true);
  assert.deepEqual(result.accepted[0].resolvedOptions, ['FKSFU', 'P0300', 'S0230', 'S0337', 'S03G9', 'S043L']);
  assert.deepEqual(result.accepted[1].resolvedOptions, ['FKSJX', 'P0475', 'S0230', 'S0337', 'S03G9', 'S043L']);
  assert.equal(result.accepted[1].paint.value.code, 'P0475'); assert.equal(result.accepted[1].upholstery.value.code, 'FKSJX');
  assert.equal(result.accepted[0].selectedAccessories[0].quantity.state, 'unknown');
  assert.equal(result.accepted[0].catalogue.sourceBinding.optionalFacts.modelYear.state, 'unknown');
  assert.equal(JSON.stringify(result).includes('private-'), false);
  assert.equal(collector.catalogueRegistrations.length, 2);
  const adapter = createBmwCatalogueAdapter({ sourceRegistrations: collector.catalogueRegistrations, loadSnapshot: async (_version, { lookupIdentity }) =>
    result.accepted.find((row) => row.lookupIdentity.bindingDigest === lookupIdentity.bindingDigest).catalogue });
  const row = result.accepted[1]; const options = Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion'].map((key) => [key, row.lookupIdentity[key]]));
  assert.deepEqual(await adapter.resolve(row.catalogueRequest, options), row.catalogue);
  const restarted = await createFleetCollector(input); const again = await restarted.run(); assert.deepEqual(again.accepted, result.accepted);
  assert.equal(calls.length, 6); assert.equal(restarted.catalogueRegistrations.length, 2);
  const envelope = JSON.parse(await readFile(input.statePath)); envelope.content.accepted[0].resolvedOptions.pop(); envelope.contentDigest = inputDigest(envelope.content);
  await writeFile(input.statePath, JSON.stringify(envelope));
  await assert.rejects((await createFleetCollector(input)).run(), { code: 'source-selection-mismatch' });
});

test('canonical dedup uses returned complete selection and retains removed request codes without claiming extra capacity', async (context) => {
  const { input } = await setup(context, { duplicate: true }); const result = await (await createFleetCollector(input)).run();
  assert.equal(result.accepted.length, 1); assert.equal(result.duplicates.length, 1); assert.equal(result.counts.httpAttempts, 6);
  assert.deepEqual(result.duplicates[0].solverChanges.removed, ['FKSJX', 'P0475']);
  assert.equal(result.coverage.distinctConfigurations, 1); assert.equal(result.status, 'incomplete');
});

test('explicit provider removals cover missing request codes while an absent ignored map remains unknown', async (context) => {
  const { input } = await setup(context, { duplicate: true, mutate: (f) => { f.solver = (value) => { delete value.configurationChanges.ignoredElements; }; } });
  const result = await (await createFleetCollector(input)).run();
  assert.equal(result.duplicates.length, 1); assert.equal(result.reason, 'queue-exhausted');
  assert.deepEqual(result.duplicates[0].solverChanges.removed, ['FKSJX', 'P0475']);
  assert.deepEqual(result.records[0].sourceEvidence.providerIgnored, { state: 'unknown', codes: null });
});

test('fresh definition loss, alias substitution and malformed solver stop the finite allocation without retries', async (context) => {
  for (const [mutate, reason, attempts] of [
    [(f) => { delete f.options.P0475; }, 'source-candidate-definition', 4],
    [(f) => { f.tree.I.modelRanges.G61E.models.T5MJ.agModelCode = 'OTHER'; }, 'source-model-substitution', 3],
    [(f) => { f.solver = (value) => { value.configuration.modelCode = 'OTHER'; }; }, 'source-solver-shape', 5],
    [(f) => { f.solver = (value) => { value.configuration.elements.S0230.type = 'accessory'; }; }, 'source-selection-classification', 5],
  ]) {
    const { input, calls } = await setup(context, { mutate }); const result = await (await createFleetCollector(input)).run();
    assert.equal(result.reason, reason); assert.equal(calls.length, attempts); assert.equal(result.accepted.length, 0);
    await (await createFleetCollector(input)).run(); assert.equal(calls.length, attempts);
  }
});

test('candidate enumeration diversifies actual source definitions deterministically while plan inspection remains silent', async () => {
  const plan = fixture(32); delete plan.candidates;
  const a = buildCandidateQueue(plan, { definitions }); const b = buildCandidateQueue(plan, { definitions }); assert.deepEqual(a, b);
  assert.equal(a.length, 32); assert.equal(new Set(a.map((row) => row.candidateId)).size, 32);
  for (const type of ['paint', 'fabric', 'rim']) {
    const source = definitions.filter((row) => row.optionType === type).map((row) => row.code);
    assert.equal(new Set(a.flatMap((row) => row.request.includedElements.filter((code) => source.includes(code)))).size, source.length);
  }
  plan.candidates = a; const dry = await createFleetCollector({ plan, mode: 'dry-run' }); assert.equal((await dry.run()).accepted.length, 0);
});

test('registered model context is data and still requires its own matching full aliases and response literals', async (context) => {
  const { input, calls } = await setup(context, { count: 1, mutate: (f) => {
    const old = f.tree['5'].modelRanges.G61E.models.T5MJ;
    f.plan.models = ['X123']; Object.assign(f.plan.modelRegistration, { modelCode: 'X123', agModelCode: 'A123', catalogueRangeKey: 'G99E', rawModelRange: 'G99', aliases: ['X'] });
    Object.assign(old, { modelCode: 'X123', agModelCode: 'A123', modelRange: 'G99' });
    for (const key of Object.keys(f.tree)) delete f.tree[key]; f.tree.X = { modelRanges: { G99E: { models: { X123: old } } } };
    f.solver = (value) => { value.configuration.modelCode = 'X123'; };
  } });
  const result = await (await createFleetCollector(input)).run(); assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].canonicalIdentity.vgModelCode, 'X123'); assert.equal(result.accepted[0].modelRange, 'G99');
  assert.equal(calls.some((url) => url.includes('/configure/G99E/X123')), true);
  assert.equal(calls.some((url) => url.includes('/models/X123?')), true);
});

test('fixture transport produces qualified records without actual-source admission', async (context) => {
  const { input } = await setup(context, { mode: 'source-fixture' }); const result = await (await createFleetCollector(input)).run();
  assert.equal(result.accepted.length, 0); assert.equal(result.records.length, 2); assert.equal(result.admission, false);
  assert.equal(result.records[0].sourceKind, 'synthetic-capture-fixture');
});

test('escaped bootstrap header text in another profile response is refused before safe report persistence', async (context) => {
  const { input, calls } = await setup(context, { mutate: (f) => {
    f.settings.APP.backend.settingsVehicleTree['x-api-key'] = 'private"tree-fixture';
    f.options.P0300.phrases = { longDescription: 'prefix private"tree-fixture suffix' };
  } });
  const result = await (await createFleetCollector(input)).run();
  assert.equal(result.reason, 'source-sensitive-projection'); assert.equal(calls.length, 4);
  assert.equal((await readFile(input.statePath, 'utf8')).includes('tree-fixture'), false);
});

async function interrupted(context, phase = 'outcome') {
  const fixture = await setup(context);
  let fired = false;
  fixture.input.onPhase = async (name, detail) => {
    if (!fired && (phase === 'outcome' && name === 'outcome-committed'
      || phase === 'cached' && name === 'before-rename' && detail.kind === 'candidate-outcome')) {
      fired = true; throw new Error('scripted process interruption');
    }
  };
  await assert.rejects((await createFleetCollector(fixture.input)).run(), /scripted process interruption/);
  delete fixture.input.onPhase;
  fixture.originalBytes = await readFile(fixture.input.statePath);
  fixture.originalState = JSON.parse(fixture.originalBytes).content;
  return fixture;
}
function continuationInput(fixture, id = 'fixture-continuation') {
  const { input } = fixture;
  return { ...input, statePath: join(input.statePath, '..', `${id}.json`),
    continuation: { checkpointPath: input.statePath, checkpointSha256: sha(fixture.originalBytes),
      limits: { ...input.plan.limits, requestBudgets: { ...input.plan.limits.requestBudgets, solve: 1 }, sourceAttempts: 5 } },
    http: { ...input.http, allocation: { ...input.http.allocation, id, attempts: 5 } } };
}

test('continuation preserves predecessor and admissions while fresh explicit bootstrap completes only pending work', async (context) => {
  const f = await interrupted(context); const originalCalls = [...f.calls]; const next = continuationInput(f);
  const result = await (await createFleetCollector(next)).run();
  assert.equal(result.status, 'complete'); assert.equal(result.accepted.length, 2);
  assert.deepEqual(result.accepted[0], f.originalState.accepted[0]);
  assert.equal(result.counts.httpAttempts, 10); assert.equal(result.allocationCounts.prior.httpAttempts, 5);
  assert.equal(result.allocationCounts.fresh.httpAttempts, 5);
  assert.equal(f.calls.length, 10); assert.equal(f.calls.filter((url) => url === originalCalls.at(-1)).length, 1);
  assert.deepEqual(await readFile(f.input.statePath), f.originalBytes);
  assert.equal((await (await createFleetCollector(next)).run()).accepted.length, 2); assert.equal(f.calls.length, 10);
});

test('continuation recovers retained solver cache without repeating its spent request', async (context) => {
  const f = await interrupted(context, 'cached'); const spent = f.calls.at(-1); const next = continuationInput(f);
  const result = await (await createFleetCollector(next)).run();
  assert.equal(result.accepted.length, 2); assert.equal(result.counts.httpAttempts, 10);
  assert.equal(f.calls.filter((url) => url === spent).length, 1);
  assert.equal(result.continuation.recoveredSolverResponses, 1);
  assert.deepEqual(await readFile(f.input.statePath), f.originalBytes);
});

test('continuation refuses changed predecessor, allocation reuse and destination rebinding before traffic', async (context) => {
  const f = await interrupted(context); const calls = f.calls.length;
  for (const modify of [
    (next) => { next.continuation.checkpointSha256 = sha('wrong bytes'); },
    (next) => { next.statePath = f.input.statePath; },
    (next) => { next.http.allocation.id = f.input.http.allocation.id; },
    (next) => { next.continuation.limits.requestBudgets.settings = 0; },
    (next) => { next.batchBinding = { ...next.batchBinding, snapshotVersion: 'other.v2' }; },
  ]) {
    const next = continuationInput(f); modify(next);
    await assert.rejects(async () => (await createFleetCollector(next)).run()); assert.equal(f.calls.length, calls);
  }
  const next = continuationInput(f); await (await createFleetCollector(next)).run();
  const rebound = { ...next, statePath: join(next.statePath, '..', 'rebound.json') };
  await assert.rejects(async () => (await createFleetCollector(rebound)).run(), { code: 'continuation-allocation-used' });
  assert.equal(f.calls.length, calls + 5);
});

test('FUCQ-152: a second fresh allocation cannot fork a predecessor that already has a successor', async (context) => {
  const f = await interrupted(context); const a = continuationInput(f, 'fork-a');
  assert.equal((await (await createFleetCollector(a)).run()).status, 'complete');
  const pending = f.calls.at(-1); const calls = f.calls.length; const successorBytes = await readFile(a.statePath);
  const b = continuationInput(f, 'fork-b');
  const outcome = await (await createFleetCollector(b)).run().then(() => 'ran', (error) => error);
  assert.equal(f.calls.filter((url) => url === pending).length, 1, 'the fork repeated pending candidate C');
  assert.equal(f.calls.length, calls); assert.equal(outcome.code, 'continuation-predecessor-forked');
  assert.match(outcome.message, /already has a continuation successor/);
  assert.deepEqual(await readFile(f.input.statePath), f.originalBytes); assert.deepEqual(await readFile(a.statePath), successorBytes);
  assert.equal((await readdir(join(f.input.statePath, '..'))).some((name) => name.includes(inputDigest('fork-b'))), false);
  assert.equal((await (await createFleetCollector(a)).run()).accepted.length, 2); assert.equal(f.calls.length, calls);
});

test('continuation validates retained solver cache through the strict binder before any fresh traffic', async (context) => {
  const f = await interrupted(context); const envelope = JSON.parse(f.originalBytes);
  const cached = envelope.content.cache.find((row) => row.operation === 'solve');
  cached.payload.document.report.configuration.modelCode = 'OTHER';
  cached.payload.sha256 = sha(JSON.stringify(cached.payload.document) + '\n');
  cached.payloadDigest = inputDigest(cached.payload); envelope.contentDigest = inputDigest(envelope.content);
  f.originalBytes = Buffer.from(JSON.stringify(envelope)); await writeFile(f.input.statePath, f.originalBytes);
  const calls = f.calls.length;
  await assert.rejects(async () => (await createFleetCollector(continuationInput(f))).run()); assert.equal(f.calls.length, calls);
});

test('continuation refuses a valid solver observation rebound to another candidate cache key', async (context) => {
  const f = await interrupted(context); const envelope = JSON.parse(f.originalBytes); const state = envelope.content;
  const cached = state.cache.find((row) => row.operation === 'solve'); const oldKey = cached.cacheKey;
  cached.cacheKey = inputDigest({ operation: 'solve', ...state.identity.sources.solve, request: f.input.plan.candidates[1].request });
  state.attempts[cached.cacheKey] = state.attempts[oldKey]; delete state.attempts[oldKey];
  envelope.contentDigest = inputDigest(state); f.originalBytes = Buffer.from(JSON.stringify(envelope));
  await writeFile(f.input.statePath, f.originalBytes); const calls = f.calls.length;
  await assert.rejects(async () => (await createFleetCollector(continuationInput(f))).run());
  assert.equal(f.calls.length, calls);
});

test('continuation cannot replay its allowance after destination checkpoint loss', async (context) => {
  const f = await interrupted(context); const next = continuationInput(f);
  await (await createFleetCollector(next)).run(); const calls = f.calls.length;
  await rm(next.statePath);
  await assert.rejects(async () => (await createFleetCollector(next)).run(), { code: 'continuation-allocation-used' });
  assert.equal(f.calls.length, calls);
});

test('continuation records a spent solver without retained response as rejected and never reissues it', async (context) => {
  const f = await setup(context); const fetch = f.input.http.fetch; let spent; let instant = f.input.now();
  f.input.now = () => instant;
  f.input.http.fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (!spent && url.includes('/rulesolver/')) { spent = url; instant += f.input.plan.limits.deadlineMs + 1; }
    return response;
  };
  const first = await (await createFleetCollector(f.input)).run(); assert.equal(first.reason, 'deadline');
  f.originalBytes = await readFile(f.input.statePath); f.input.http.fetch = fetch;
  const result = await (await createFleetCollector(continuationInput(f))).run();
  assert.equal(result.accepted.length, 1); assert.equal(result.coverage.processedCandidates, 2);
  assert.deepEqual(result.rejected, [{ candidateId: 'candidate-0', code: 'source-request-spent' }]);
  assert.equal(f.calls.filter((url) => url === spent).length, 1); assert.equal(result.counts.httpAttempts, 10);
});

test('continuation refuses durable access rate source refusal substitution and shape stops before marker or traffic', async (context) => {
  const f = await interrupted(context); const calls = f.calls.length;
  for (const halted of ['source-http-401', 'source-http-403', 'source-http-429', 'source-redirect-refused',
    'source-endpoint-refused', 'source-model-substitution', 'source-solver-shape', 'source-json-shape',
    'source-sensitive-projection', 'source-failure', 'unknown-source-stop']) {
    const envelope = JSON.parse(f.originalBytes); envelope.content.halted = halted;
    envelope.contentDigest = inputDigest(envelope.content);
    const bytes = Buffer.from(JSON.stringify(envelope) + '\n'); await writeFile(f.input.statePath, bytes);
    const next = continuationInput({ ...f, originalBytes: bytes });
    const directory = join(f.input.statePath, '..'); const before = (await readdir(directory)).sort();
    await assert.rejects(async () => (await createFleetCollector(next)).run(), { code: 'continuation-stop-refused' });
    assert.deepEqual(await readFile(f.input.statePath), bytes); assert.equal(f.calls.length, calls);
    assert.deepEqual((await readdir(directory)).sort(), before);
  }
});

test('continuation source change fails closed before pending solver and finite attempt budget remains effective', async (context) => {
  for (const variant of ['changed', 'budget']) {
    const f = await interrupted(context); const next = continuationInput(f); const before = f.calls.length;
    if (variant === 'changed') {
      const fetch = next.http.fetch;
      next.http.fetch = async (url, options) => {
        const response = await fetch(url, options);
        if (!url.includes('/options/')) return response;
        const value = await response.json(); value.P0300.phrases = { longDescription: 'changed source text' };
        return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
      };
    } else next.continuation.limits.sourceAttempts = 4;
    const result = await (await createFleetCollector(next)).run();
    assert.equal(result.reason, variant === 'changed' ? 'continuation-source-changed' : 'source-attempt-budget');
    assert.equal(result.accepted.length, 1); assert.equal(f.calls.length, before + 4);
    assert.deepEqual(await readFile(f.input.statePath), f.originalBytes);
  }
});

test('a second interrupted continuation needs another fresh allocation and retains exact cumulative spending', async (context) => {
  const f = await interrupted(context); const next = continuationInput(f);
  next.onPhase = async (name, detail) => {
    if (name === 'before-rename' && detail.kind === 'candidate-outcome') throw new Error('second interruption');
  };
  await assert.rejects((await createFleetCollector(next)).run(), /second interruption/);
  const secondBytes = await readFile(next.statePath); const calls = f.calls.length; const secondSolver = f.calls.at(-1);
  delete next.onPhase;
  const finalInput = continuationInput({ input: next, originalBytes: secondBytes }, 'fixture-continuation-third');
  const result = await (await createFleetCollector(finalInput)).run();
  assert.equal(result.accepted.length, 2); assert.equal(result.counts.httpAttempts, 14);
  assert.equal(result.allocationCounts.prior.httpAttempts, 10); assert.equal(result.allocationCounts.fresh.httpAttempts, 4);
  assert.equal(f.calls.length, calls + 4); assert.equal(f.calls.filter((url) => url === secondSolver).length, 1);
  assert.deepEqual(await readFile(next.statePath), secondBytes); assert.deepEqual(await readFile(f.input.statePath), f.originalBytes);
});

test('continuation refuses partial retained bootstrap and honours a fresh lifetime deadline', async (context) => {
  const partial = await setup(context);
  partial.input.onPhase = async (name, detail) => {
    if (name === 'before-rename' && detail.kind === 'batch-source-evidence') throw new Error('partial bootstrap');
  };
  await assert.rejects((await createFleetCollector(partial.input)).run(), /partial bootstrap/);
  delete partial.input.onPhase; partial.originalBytes = await readFile(partial.input.statePath);
  const calls = partial.calls.length;
  await assert.rejects(async () => (await createFleetCollector(continuationInput(partial))).run(), { code: 'continuation-bootstrap-required' });
  assert.equal(partial.calls.length, calls);

  const f = await interrupted(context); const next = continuationInput(f); let instant = next.now(); const fetch = next.http.fetch;
  next.continuation.limits.deadlineMs = 10000; next.now = () => instant;
  next.http.fetch = async (url, options) => { const response = await fetch(url, options); instant += 10001; return response; };
  const result = await (await createFleetCollector(next)).run();
  assert.equal(result.reason, 'deadline'); assert.equal(result.accepted.length, 1);
  assert.equal(result.allocationCounts.fresh.httpAttempts, 1); assert.equal(f.calls.length, 6);
});

test('FUCQ-151: tampering after a cached binding validation is still refused without new traffic', async (context) => {
  const mutate = ({ plan }) => { plan.candidates = ['FKSFU', 'FKSJX'].flatMap((fabric) => ['P0300', 'P0475'].map((paint) => [fabric, paint]))
    .map((codes, i) => ({ candidateId: `candidate-${i}`, request: { includedElements: [...codes, 'S0337', 'S03G9', 'S043L'].sort(), mandatoryElements: ['S0337'] } })); };
  const { input, calls } = await setup(context, { count: 4, mutate }); const collector = await createFleetCollector(input);
  const result = await collector.run(); assert.equal(result.accepted.length, 4); assert.equal(calls.length, 8);
  const pristine = await readFile(input.statePath, 'utf8');
  const again = await collector.run(); assert.deepEqual(again.accepted, result.accepted); assert.equal(collector.catalogueRegistrations.length, 4);
  for (const tamper of [
    (content) => { content.records[2].resolvedOptions.pop(); },
    (content) => { content.accepted[3].resolvedOptions.pop(); },
    (content) => { content.sourceCaptures[1].solver.document.report.tampered = true; },
    (content) => { const solver = content.sourceCaptures[0].solver; solver.document.report.tampered = true;
      solver.sha256 = sha(JSON.stringify(solver.document) + '\n'); },
    (content) => { content.batchEvidence.options.document.report.tampered = true; },
  ]) {
    const envelope = JSON.parse(pristine); tamper(envelope.content); envelope.contentDigest = inputDigest(envelope.content);
    await writeFile(input.statePath, JSON.stringify(envelope));
    await assert.rejects(collector.run(), { code: /^(source-selection-mismatch|invalid-selection-binding)$/ });
    assert.equal(calls.length, 8); assert.equal(collector.catalogueRegistrations.length, 4);
  }
  await writeFile(input.statePath, pristine); assert.deepEqual((await collector.run()).accepted, result.accepted); assert.equal(calls.length, 8);
});
