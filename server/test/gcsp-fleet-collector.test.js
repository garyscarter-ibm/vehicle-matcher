import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyService } from '../gcsp/policy/index.js';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bmwCatalogueLookupIdentity } from '../vehicle-evidence/bmw-catalogue-adapter.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { spawnSync } from 'node:child_process';

const policyRead = { runId: 'f59-offline', asOf: '2026-11-06T00:00:00.000Z', policyVersion: 'gcsp-policy-v1' };

test('configuration identity uses the target padded Base64 and excludes context and accessory variants', async () => {
  const { createConfigurationKey } = await import('../../scripts/gcsp/configuration-key.mjs');
  const key = await createConfigurationKey({ policyService: new PolicyService(), policyRead });
  const first = key({ vgModelCode: 't5mj', agModelCode: '72HH',
    factoryOptionCodes: ['S0488', 'p0300', 'S0337', 'S03AC', 'FKSFU', 'S0488'],
    selectedAccessories: [{ code: 'SE000001', type: 'accessory', quantity: 1 }] });
  assert.equal(first.decodedIdentity, 'T5MJ:FKSFU,P0300,S0337,S03AC,S0488');
  assert.equal(first.configurationId, 'VDVNSjpGS1NGVSxQMDMwMCxTMDMzNyxTMDNBQyxTMDQ4OA==');
  const alias = key({ vgModelCode: ' T5MJ ', factoryOptionCodes: ['337', 'FKSFU', 'P0300', 'S03AC', 'S0488'],
    aliases: { '337': 'S0337' }, catalogueDate: '2030-01-01', requestSeed: 'other', sourceVersion: 'other' });
  assert.equal(alias.configurationId, first.configurationId);
  assert.deepEqual(first.canonicalIdentity.factoryOptionCodes, ['FKSFU', 'P0300', 'S0337', 'S03AC', 'S0488']);
});

const context = { catalogueDate: '2026-11-01', market: 'GB', locale: 'en-GB',
  orderDate: '2026-11-01', effectDate: '2026-11-01', productionDate: '2027-03-01', taxDate: '2026-11-01' };
const model = { modelCode: 'T5MJ', agModelCode: '72HH', modelRange: 'G61E', rawModelRange: 'G61E', trim: 'S0337' };
const definitions = [ ['FKSFU', 'upholstery'], ['P0300', 'paint'], ['S0337', 'option'],
  ['S03AC', 'option'], ['S0488', 'option'], ['S0494', 'option'], ['SE000001', 'accessory'] ]
  .map(([code, type]) => ({ code, type, aliases: code === 'S0337' ? ['337'] : [] }));
const discovery = () => ({ schemaVersion: '1', context: { ...context }, models: [{ ...model,
  baseElements: ['FKSFU', 'P0300', 'S0337'], definitions: structuredClone(definitions) }] });
const plan = (changes = {}) => ({ schemaVersion: '1', planId: 'f59-fixture', version: '1', seed: 'stable-seed',
  policyRead: { asOf: policyRead.asOf, policyVersion: policyRead.policyVersion },
  source: { id: 'injected-offline', version: '1' }, context: { ...context }, models: ['T5MJ'], target: 3,
  candidateCount: 4, limits: { maxCandidates: 16, requestBudgets: { discover: 1, solve: 16 },
    maxAttempts: 2, operationTimeoutMs: 100, deadlineMs: 5000, retryDelayMs: 0, concurrency: 1,
    cacheEntries: 16, cacheRetentionMs: 10000, checkpointBytes: 1024 * 1024, imageRequests: 0 }, ...changes });
const requested = (elements = ['FKSFU', 'P0300', 'S0337', 'S03AC']) => ({ ...context, ...model, elements,
  selectedAccessories: [] });
const solved = (request, options = ['FKSFU', 'P0300', 'S0337', 'S0488']) => ({ status: 'ok', selectionComplete: true,
  resolvedIdentity: { ...context, ...model, selectedOptions: options, selectedAccessories: [], selectionComplete: true },
  selectedElements: options.map((code) => ({ code, type: definitions.find((d) => d.code === code).type })),
  ignoredCodes: request.elements.includes('S03AC') ? ['S03AC'] : [] });
async function keyFactory() {
  const { createConfigurationKey } = await import('../../scripts/gcsp/configuration-key.mjs');
  return createConfigurationKey({ policyService: new PolicyService(), policyRead });
}

test('deterministic seeded queues use real discovery mapping and canonical complete request elements', async () => {
  const { buildCandidateQueue, selectPlan } = await import('../../scripts/gcsp/collect-fleet.mjs');
  const p = plan({ candidates: [{ modelCode: 't5mj', elements: ['s03ac', '337', 'P0300', 'FKSFU', 'S03AC'] }] });
  const queue = buildCandidateQueue(p, discovery());
  assert.deepEqual(queue[0].request.elements, ['FKSFU', 'P0300', 'S0337', 'S03AC']);
  assert.equal(queue[0].request.agModelCode, '72HH');
  assert.deepEqual(buildCandidateQueue(plan(), discovery()), buildCandidateQueue(plan(), discovery()));
  assert.equal(selectPlan(plan(), ['T5MJ']).models.length, 1);
  assert.throws(() => selectPlan(plan(), ['BAD1']), { code: 'unplanned-model' });
  assert.throws(() => buildCandidateQueue(plan(), { ...discovery(), context: { ...context, market: 'US' } }), { code: 'discovery-context-mismatch' });
});

test('accepted resolved selections retain typed accessories, exact F39 identity and solver changes', async () => {
  const { validateSolverResponse } = await import('../../scripts/gcsp/collect-fleet.mjs');
  const request = requested(); const response = solved(request);
  response.resolvedIdentity.selectedAccessories = [{ code: 'SE000001', type: 'accessory', quantity: 2 }];
  response.selectedElements.push({ code: 'SE000001', type: 'accessory', quantity: 2 });
  const record = validateSolverResponse({ request, definitions }, response, await keyFactory());
  assert.equal(record.decodedIdentity, 'T5MJ:FKSFU,P0300,S0337,S0488');
  assert.deepEqual(record.solverChanges, { added: ['S0488', 'SE000001'], removed: [], ignored: ['S03AC'] });
  assert.deepEqual(record.resolvedOptions, ['FKSFU', 'P0300', 'S0337', 'S0488']);
  assert.equal(record.modelRange, 'G61E');
  assert.equal(record.selectedAccessories[0].quantity, 2);
  assert.deepEqual(record.lookupIdentity, bmwCatalogueLookupIdentity(record.catalogueRequest));
  assert.equal(record.catalogueRequest.selectedOptions.includes('S03AC'), false);
});

test('solver refuses substituted context, incomplete selections and contradictory typed elements', async () => {
  const { validateSolverResponse } = await import('../../scripts/gcsp/collect-fleet.mjs');
  const request = requested(); const key = await keyFactory();
  for (const field of ['modelCode', 'agModelCode', 'market', 'modelRange', 'rawModelRange', 'trim', 'orderDate', 'effectDate', 'productionDate', 'taxDate', 'catalogueDate', 'locale']) {
    const response = solved(request); response.resolvedIdentity[field] = 'SUBSTITUTED';
    assert.throws(() => validateSolverResponse({ request, definitions }, response, key), { code: 'solver-context-substitution' }, field);
  }
  const incomplete = solved(request); incomplete.selectionComplete = false;
  assert.throws(() => validateSolverResponse({ request, definitions }, incomplete, key), { code: 'incomplete-solver-selection' });
  const inconsistent = solved(request); inconsistent.selectedElements.pop();
  assert.throws(() => validateSolverResponse({ request, definitions }, inconsistent, key), { code: 'inconsistent-solver-selection' });
  const paintMissing = solved(request); paintMissing.selectedElements = paintMissing.selectedElements.filter((x) => x.code !== 'P0300');
  paintMissing.resolvedIdentity.selectedOptions = paintMissing.resolvedIdentity.selectedOptions.filter((x) => x !== 'P0300');
  assert.throws(() => validateSolverResponse({ request, definitions }, paintMissing, key), { code: 'incomplete-solver-selection' });
  const falseIgnored = solved(request); falseIgnored.ignoredCodes = ['S0488'];
  assert.throws(() => validateSolverResponse({ request, definitions }, falseIgnored, key), { code: 'invalid-solver-changes' });
});

async function withCollector(options, fn) {
  const root = await mkdtemp(join(tmpdir(), 'f59-'));
  try {
    const { createFleetCollector } = await import('../../scripts/gcsp/collect-fleet.mjs');
    const settings = { plan: plan(), mode: 'offline', statePath: join(root, 'checkpoint.json'),
      policyService: new PolicyService(), policyRead,
      source: { kind: 'offline', version: '1', discover: async () => discovery(), solve: async (request) => solved(request) }, ...options };
    await fn({ root, settings, createFleetCollector });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('collector persists accepted, duplicate and rejected outcomes and reports honest under-target progress', async () => {
  await withCollector({ plan: plan({ candidates: [
    { modelCode: 'T5MJ', elements: ['FKSFU', 'P0300', 'S0337'] },
    { modelCode: 'T5MJ', elements: ['FKSFU', 'P0300', 'S0337', 'S03AC'] },
    { modelCode: 'T5MJ', elements: ['FKSFU', 'P0300', 'S0337', 'S0494'] },
  ] }) }, async ({ settings, createFleetCollector }) => {
    const source = settings.source;
    source.solve = async (request) => request.elements.includes('S0494') ? { ...solved(request), selectionComplete: false } : solved(request);
    const result = await (await createFleetCollector(settings)).run();
    assert.equal(result.status, 'incomplete'); assert.equal(result.reason, 'queue-exhausted');
    assert.equal(result.accepted.length, 1); assert.equal(result.duplicates.length, 1); assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].code, 'incomplete-solver-selection');
    assert.equal(result.counts.sourceCalls, 0); assert.equal(result.counts.operations.solve, 3);
    assert.equal(result.coverage.distinctConfigurations, 1); assert.equal(result.coverage.target, 3);
    assert.equal(result.accepted.some((x) => x.vin17), false);
    const state = JSON.parse(await readFile(settings.statePath, 'utf8'));
    assert.equal(state.content.cursor, 3); assert.equal(state.content.duplicates.length, 1);
  });
});

test('response cache survives an interrupted outcome commit and resume makes no repeated solver request', async () => {
  await withCollector({ plan: plan({ candidates: [{ modelCode: 'T5MJ', elements: ['FKSFU', 'P0300', 'S0337'] }], target: 1 }) }, async ({ root, settings, createFleetCollector }) => {
    let calls = 0; settings.source.solve = async (request) => { calls += 1; return solved(request); };
    settings.onPhase = async (phase) => { if (phase === 'response-cached') throw new Error('simulated interruption'); };
    await assert.rejects((await createFleetCollector(settings)).run(), /simulated interruption/);
    const before = JSON.parse(await readFile(settings.statePath, 'utf8'));
    assert.equal(before.content.cursor, 0); assert.equal(calls, 1);
    delete settings.onPhase;
    const result = await (await createFleetCollector(settings)).run();
    assert.equal(result.status, 'complete'); assert.equal(calls, 1);
    assert.equal(result.counts.cacheHits.solve, 1);
    assert.deepEqual((await readdir(root)).sort(), ['checkpoint.json']);
  });
});

test('atomic checkpoint interruption preserves the prior checksum and leaves no temporary files', async () => {
  await withCollector({}, async ({ root, settings, createFleetCollector }) => {
    let prior;
    settings.onPhase = async (phase, detail) => {
      if (phase === 'before-rename' && detail.kind === 'outcome') {
        prior = await readFile(settings.statePath, 'utf8'); throw new Error('write interrupted');
      }
    };
    await assert.rejects((await createFleetCollector(settings)).run(), /write interrupted/);
    assert.equal(await readFile(settings.statePath, 'utf8'), prior);
    assert.deepEqual((await readdir(root)).sort(), ['checkpoint.json']);
  });
});

test('corrupt checkpoints and nested cache digests fail closed without requesting a source', async () => {
  await withCollector({ plan: plan({ target: 1 }) }, async ({ settings, createFleetCollector }) => {
    await (await createFleetCollector(settings)).run();
    const good = await readFile(settings.statePath, 'utf8');
    await writeFile(settings.statePath, good.slice(0, -7));
    await assert.rejects((await createFleetCollector(settings)).run(), { code: 'checkpoint-corrupt' });
    const state = JSON.parse(good);
    state.content.cache[0].payload = { wrong: true };
    state.contentDigest = inputDigest(state.content);
    await writeFile(settings.statePath, JSON.stringify(state));
    await assert.rejects((await createFleetCollector(settings)).run(), { code: 'cache-corrupt' });
  });
});

test('plan, source, tool and signature-policy versions cannot silently mix on resume', async () => {
  await withCollector({}, async ({ settings, createFleetCollector }) => {
    await (await createFleetCollector(settings)).run();
    for (const mutation of [
      { plan: plan({ version: '2' }) },
      { source: { ...settings.source, version: '2' } },
    ]) await assert.rejects((await createFleetCollector({ ...settings, ...mutation })).run(), { code: 'checkpoint-incompatible' });
    const state = JSON.parse(await readFile(settings.statePath, 'utf8'));
    state.content.identity.toolVersion = 'future'; state.contentDigest = inputDigest(state.content);
    await writeFile(settings.statePath, JSON.stringify(state));
    await assert.rejects((await createFleetCollector(settings)).run(), { code: 'checkpoint-incompatible' });
  });
});

test('lifetime request budgets stop before another operation and cache retention stays bounded', async () => {
  const p = plan(); p.limits.requestBudgets.solve = 1; p.limits.cacheEntries = 1;
  await withCollector({ plan: p }, async ({ settings, createFleetCollector }) => {
    const result = await (await createFleetCollector(settings)).run();
    assert.equal(result.status, 'incomplete'); assert.equal(result.reason, 'request-budget');
    assert.equal(result.counts.operations.solve, 1);
    const state = JSON.parse(await readFile(settings.statePath, 'utf8'));
    assert.equal(state.content.cache.length, 1); assert.ok(result.counts.cacheEvictions > 0);
    const resumed = await (await createFleetCollector(settings)).run();
    assert.equal(resumed.counts.operations.solve, 1);
  });
});

test('401, 403 and 429 stop without retries or advancing the candidate and persist their finite stop', async () => {
  for (const status of [401, 403, 429]) {
    await withCollector({}, async ({ settings, createFleetCollector }) => {
      settings.source.solve = async () => ({ status });
      const result = await (await createFleetCollector(settings)).run();
      assert.equal(result.reason, `source-http-${status}`); assert.equal(result.counts.operations.solve, 1);
      const resumed = await (await createFleetCollector(settings)).run();
      assert.equal(resumed.reason, `source-http-${status}`); assert.equal(resumed.counts.operations.solve, 1);
      assert.equal(JSON.parse(await readFile(settings.statePath, 'utf8')).content.cursor, 0);
    });
  }
});

test('transient failures and hung solver calls have finite retries and abort deadlines', async () => {
  await withCollector({}, async ({ settings, createFleetCollector }) => {
    settings.source.solve = async () => ({ status: 503 });
    const result = await (await createFleetCollector(settings)).run();
    assert.equal(result.reason, 'source-failure'); assert.equal(result.counts.operations.solve, 2);
    assert.equal(result.counts.failures, 2);
  });
  const p = plan(); p.limits.operationTimeoutMs = 10;
  await withCollector({ plan: p }, async ({ settings, createFleetCollector }) => {
    let active = 0;
    settings.source.solve = async (request, { signal }) => {
      active += 1;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => { active -= 1; reject(new Error('aborted')); }, { once: true }));
    };
    const result = await (await createFleetCollector(settings)).run();
    assert.equal(result.reason, 'source-failure'); assert.equal(result.counts.timeouts, 2); assert.equal(active, 0);
  });
});

test('expired cache cannot masquerade as valid, and a deadline stops remaining work', async () => {
  const p = plan(); p.limits.cacheRetentionMs = 10;
  await withCollector({ plan: p }, async ({ settings, createFleetCollector }) => {
    let clock = 1000; settings.now = () => clock;
    settings.onPhase = async (phase) => { if (phase === 'response-cached') throw new Error('pause'); };
    await assert.rejects((await createFleetCollector(settings)).run(), /pause/);
    clock += 11; delete settings.onPhase;
    const result = await (await createFleetCollector(settings)).run();
    assert.equal(result.counts.cacheHits.solve, 0);
    assert.ok(result.counts.operations.solve >= 2);
  });
  await withCollector({}, async ({ settings, createFleetCollector }) => {
    let clock = 1000; settings.now = () => clock;
    settings.source.solve = async (request) => { clock += 5001; return solved(request); };
    const result = await (await createFleetCollector(settings)).run();
    assert.equal(result.reason, 'deadline'); assert.equal(result.counts.operations.solve, 1);
  });
});

test('collection and later enrichment share a persisted run deadline across resume', async () => {
  const p = plan({ target: 1 }); p.limits.requestBudgets.facts = 1;
  let clock = 1000; let factsCalls = 0;
  await withCollector({ plan: p, now: () => clock, operations: {
    facts: { sourceId: 'facts-fixture', sourceVersion: '1', kind: 'offline', execute: async () => { factsCalls += 1; return {}; } },
  } }, async ({ settings, createFleetCollector }) => {
    await (await createFleetCollector(settings)).run();
    clock += p.limits.deadlineMs + 1;
    const resumed = await createFleetCollector(settings);
    await assert.rejects(resumed.session.withCheckpoint(async ({ execute }) => { await execute('facts', { exact: 'identity' }); },
      { stage: { id: 'enrichment', version: '1', inputDigest: inputDigest('deadline-stage') } }), { code: 'deadline' });
    assert.equal(factsCalls, 0);
    const state = JSON.parse(await readFile(settings.statePath, 'utf8')).content;
    assert.equal(state.deadlineAt, 1000 + p.limits.deadlineMs);
    assert.equal(state.counts.operations.facts, 0);
  });
});

test('import, default, dry-run, lookup and CI execution make zero transport operations', async () => {
  const module = await import('../../scripts/gcsp/collect-fleet.mjs');
  for (const mode of [undefined, 'dry-run', 'lookup', 'ci', 'demo-start']) {
    await withCollector({ mode, source: { kind: 'live', version: '1', discover: () => { throw new Error('traffic'); }, solve: () => { throw new Error('traffic'); } } }, async ({ settings, createFleetCollector }) => {
      const result = await (await createFleetCollector(settings)).run();
      assert.equal(result.counts.sourceCalls, 0); assert.equal(result.counts.operations.discover, 0);
      assert.equal(result.status, 'incomplete');
    });
  }
  await assert.rejects(module.createFleetCollector({ plan: plan(), mode: 'live' }), { code: 'live-source-unallocated' });
  const cli = spawnSync(process.execPath, ['scripts/gcsp/collect-fleet.mjs'], { cwd: new URL('../..', import.meta.url), encoding: 'utf8', env: { ...process.env, CI: '1' } });
  assert.equal(cli.status, 0); assert.equal(JSON.parse(cli.stdout).counts.sourceCalls, 0);
});

test('unsafe concurrency and image requests refuse before source execution', async () => {
  const { createFleetCollector } = await import('../../scripts/gcsp/collect-fleet.mjs');
  for (const limits of [{ concurrency: 2 }, { imageRequests: 1 }, { maxAttempts: 0 }, { operationTimeoutMs: Infinity }]) {
    const p = plan(); Object.assign(p.limits, limits);
    await assert.rejects(createFleetCollector({ plan: p }), { code: 'invalid-plan' });
  }
});

test('actual process death before rename resumes from the valid response cache and removes its owned staging file', async () => {
  await withCollector({ plan: plan({ target: 1 }) }, async ({ root, settings, createFleetCollector }) => {
    const worker = `
      import { createFleetCollector } from ${JSON.stringify(new URL('../../scripts/gcsp/collect-fleet.mjs', import.meta.url).href)};
      import { PolicyService } from ${JSON.stringify(new URL('../gcsp/policy/index.js', import.meta.url).href)};
      const response = ${JSON.stringify(solved(requested()))};
      const collector = await createFleetCollector({ plan:${JSON.stringify(settings.plan)},mode:'offline',statePath:${JSON.stringify(settings.statePath)},
        policyService:new PolicyService(),policyRead:${JSON.stringify(policyRead)},
        source:{kind:'offline',version:'1',discover:async()=>(${JSON.stringify(discovery())}),solve:async(request)=>({...response,ignoredCodes:[]})},
        onPhase:async(phase,detail)=>{if(phase==='before-rename' && detail.kind==='outcome')process.kill(process.pid,'SIGKILL');}});
      await collector.run();`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', worker], { encoding: 'utf8', env: process.env, timeout: 5000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    const before = JSON.parse(await readFile(settings.statePath, 'utf8'));
    assert.equal(before.content.counts.operations.solve, 1); assert.equal(before.content.cursor, 0);
    settings.source.solve = async () => { throw new Error('must use persisted response'); };
    const result = await (await createFleetCollector(settings)).run();
    assert.equal(result.status, 'complete'); assert.equal(result.counts.operations.solve, 1);
    assert.deepEqual((await readdir(root)).sort(), ['checkpoint.json']);
  });
});

test('retained F39 catalogue identity publishes through F54 without re-keying or inventing missing facts', async () => {
  const { validateSolverResponse } = await import('../../scripts/gcsp/collect-fleet.mjs');
  const { writeCorpusCandidate, validateCorpusDirectory } = await import('../gcsp/vehicle-evidence/corpus-publisher.js');
  const { emptyAllocationInventory } = await import('../gcsp/vehicle-evidence/vin-allocation.js');
  const snapshot = JSON.parse(await readFile(new URL('../vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url), 'utf8'));
  const base = new URL('../data/gcsp/vehicle-evidence/lookup-reference.v1/versions/c1f8040107f03fa1c25e88d23065bdef3f92a55ca086cd1894655a6c0b0b1709/', import.meta.url);
  const rows = (await readFile(new URL('configurations.jsonl', base), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  const original = rows.find((row) => row.sourceContext.sourceKind === 'dated-snapshot');
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  const request = { ...original.catalogue.resolvedIdentity, elements: [...snapshot.selectedOptions, ...snapshot.selectedAccessories.map((row) => row.code)] };
  const defs = request.elements.map((code) => ({ code, type: code.startsWith('SE') ? 'accessory'
    : snapshot.definitions[code]?.optionType === 'paint' ? 'paint' : snapshot.definitions[code]?.optionType === 'fabric' ? 'upholstery' : 'option', aliases: [] }));
  const response = { status: 'ok', selectionComplete: true, resolvedIdentity: { ...original.catalogue.resolvedIdentity, selectionComplete: true },
    selectedElements: defs.map(({ code, type }) => type === 'accessory' ? { code, type, quantity: snapshot.selectedAccessories.find((row) => row.code === code).quantity } : { code, type }), ignoredCodes: [] };
  const record = validateSolverResponse({ request, definitions: defs }, response, await keyFactory());
  assert.equal(record.configurationId, original.configurationId);
  assert.deepEqual(record.lookupIdentity, original.catalogue.resolvedLookupIdentity);
  assert.equal(original.catalogue.facts.bodyLength.state, 'unknown');
  const row = { ...original, canonicalIdentity: { ...record.canonicalIdentity, provenance: original.canonicalIdentity.provenance }, canonicalSignature: record.decodedIdentity };
  const root = await mkdtemp(join(tmpdir(), 'f59-publication-'));
  try {
    const output = join(root, 'candidate'); const opts = { policyService: new PolicyService(), policyRead };
    const published = await writeCorpusCandidate(output, { metadata: manifest, configurations: [row], images: [], allocationInventory: emptyAllocationInventory() }, opts);
    assert.equal(published.status, 'ok', JSON.stringify(published.failure));
    const checked = await validateCorpusDirectory(output, opts);
    assert.equal(checked.status, 'ok'); assert.equal(checked.manifest.counts.configurations, 1); assert.equal(checked.manifest.counts.vinMappings, 0);
    assert.equal(checked.corpus.configurations[0].catalogue.facts.bodyLength.state, 'unknown');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('checkpoint write errors never spend another solver attempt', async () => {
  await withCollector({}, async ({ settings, createFleetCollector }) => {
    let calls = 0; settings.source.solve = async (request) => { calls += 1; return solved(request); };
    settings.onPhase = async (phase, detail) => { if (phase === 'before-rename' && detail.kind === 'cache' && calls) throw new Error('disk failed'); };
    await assert.rejects((await createFleetCollector(settings)).run(), /disk failed/);
    assert.equal(calls, 1);
  });
});

test('shared collection session uses one persisted executor across stages and resumes cached work', async () => {
  const { createCollectionSession } = await import('../../scripts/gcsp/collection-session.mjs');
  const root = await mkdtemp(join(tmpdir(), 'f59-session-'));
  const limits = { ...plan().limits, requestBudgets: { facts: 2, description: 2 } };
  let calls = 0;
  const operation = { sourceId: 'fixture', sourceVersion: '1', kind: 'offline', execute: async () => { calls += 1; return { status: 'ok', value: calls }; } };
  const settings = { identity: { stage: 'enrichment-fixture', version: '1', inputDigest: 'same-input' },
    operations: { facts: operation, description: operation }, limits, statePath: join(root, 'stage.json'), initialState: { results: [] } };
  try {
    const first = await createCollectionSession(settings);
    await assert.rejects(first.withCheckpoint(async ({ execute }) => { await execute('facts', { model: 'T5MJ' }); throw new Error('stage interrupted'); }), /stage interrupted/);
    const second = await createCollectionSession(settings);
    const result = await second.withCheckpoint(async ({ state, execute, commit }) => {
      state.results.push(await execute('facts', { model: 'T5MJ' }));
      state.results.push(await execute('description', { model: 'T5MJ' })); await commit('stage-outcome'); return structuredClone(state);
    });
    assert.equal(calls, 2); assert.deepEqual(result.results.map((row) => row.value), [1, 2]);
    assert.deepEqual(result.counts.operations, { facts: 1, description: 1 }); assert.equal(result.counts.cacheHits.facts, 1);
    await assert.rejects((await createCollectionSession({ ...settings, identity: { ...settings.identity, version: '2' } })).withCheckpoint(async () => {}), { code: 'checkpoint-incompatible' });
    await assert.rejects((await createCollectionSession({ ...settings, operations: { ...settings.operations, facts: { ...operation, sourceVersion: '2' } } })).withCheckpoint(async () => {}), { code: 'checkpoint-incompatible' });
    assert.deepEqual((await readdir(root)).sort(), ['stage.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('collector to enrichment transition shares actual lifetime accounting and cached operations after interruption', async () => {
  const p = plan({ target: 1 }); p.limits.requestBudgets.facts = 1;
  let factsCalls = 0;
  await withCollector({ plan: p, operations: { facts: { sourceId: 'facts-fixture', sourceVersion: '1', kind: 'offline',
    execute: async () => { factsCalls += 1; return { status: 'ok', fittedEquipment: 'unknown' }; } } } }, async ({ settings, createFleetCollector }) => {
    const collector = await createFleetCollector(settings); const collected = await collector.run();
    assert.equal(collected.counts.operations.solve, 1);
    const stage = { id: 'enrichment', version: '1', inputDigest: inputDigest(collected.accepted.map((row) => row.configurationId)) };
    await assert.rejects(collector.session.withCheckpoint(async ({ state, execute }) => {
      await execute('solve', state.queue[0].request);
      await execute('facts', state.accepted[0].catalogueRequest); throw new Error('enrichment interrupted');
    }, { stage, initialState: { rows: [] } }), /enrichment interrupted/);
    const resumed = await collector.session.withCheckpoint(async ({ state, stageState, execute, commit }) => {
      stageState.rows.push(await execute('facts', state.accepted[0].catalogueRequest)); await commit('enrichment-outcome');
      return structuredClone(state);
    }, { stage, initialState: { rows: [] } });
    assert.equal(factsCalls, 1); assert.equal(resumed.counts.operations.solve, 1); assert.equal(resumed.counts.cacheHits.solve, 1);
    assert.equal(resumed.counts.operations.facts, 1); assert.equal(resumed.counts.cacheHits.facts, 1);
    assert.equal(resumed.stages.enrichment.data.rows[0].fittedEquipment, 'unknown');
    await assert.rejects(collector.session.withCheckpoint(async ({ execute }) => { await execute('facts', { another: 'request' }); },
      { stage: { ...stage, id: 'further-stage' } }), { code: 'request-budget' });
    await assert.rejects(collector.session.withCheckpoint(async () => {}, { stage: { ...stage, version: '2' } }), { code: 'stage-incompatible' });
  });
});

test('retry allowance is durable across interrupted writes and active writer ownership is preserved', async () => {
  await withCollector({}, async ({ settings, createFleetCollector }) => {
    let calls = 0; settings.source.solve = async (request) => { calls += 1; return solved(request); };
    settings.onPhase = async (phase, detail) => { if (phase === 'before-rename' && detail.kind === 'cache' && calls) throw new Error('disk interruption'); };
    for (let i = 0; i < 2; i += 1) await assert.rejects((await createFleetCollector(settings)).run(), /disk interruption/);
    const result = await (await createFleetCollector(settings)).run();
    assert.equal(result.reason, 'retry-budget'); assert.equal(calls, 2);
  });
  await withCollector({ plan: plan({ target: 1 }) }, async ({ settings, createFleetCollector }) => {
    let entered; let release; const started = new Promise((resolve) => { entered = resolve; }); const gate = new Promise((resolve) => { release = resolve; });
    const collector = await createFleetCollector({ ...settings, onPhase: async (phase) => { if (phase === 'response-cached') { entered(); await gate; } } });
    const first = collector.run(); await started;
    try { await assert.rejects((await createFleetCollector(settings)).run(), { code: 'checkpoint-busy' }); }
    finally { release(); }
    assert.equal((await first).status, 'complete');
  });
});

test('explicit offline CLI consumes only injected JSON and retains an incomplete honest checkpoint', async () => {
  const { buildCandidateQueue } = await import('../../scripts/gcsp/collect-fleet.mjs');
  const root = await mkdtemp(join(tmpdir(), 'f59-cli-'));
  try {
    const p = plan(); const queue = buildCandidateQueue(p, discovery());
    await writeFile(join(root, 'plan.json'), JSON.stringify(p));
    await writeFile(join(root, 'fixture.json'), JSON.stringify({ discovery: discovery(), responses: Object.fromEntries(queue.map((row) => [row.candidateId, solved(row.request)])) }));
    const command = spawnSync(process.execPath, ['scripts/gcsp/collect-fleet.mjs', '--plan', join(root, 'plan.json'), '--offline', join(root, 'fixture.json'), '--checkpoint', join(root, 'state.json')],
      { cwd: new URL('../..', import.meta.url), encoding: 'utf8', env: process.env, timeout: 5000 });
    assert.equal(command.status, 0, command.stderr);
    const output = JSON.parse(command.stdout);
    assert.equal(output.status, 'incomplete'); assert.equal(output.counts.sourceCalls, 0); assert.equal(output.coverage.distinctConfigurations, 1);
    assert.equal(JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).content.accepted.length, 1);
    assert.notEqual(p.policyRead.asOf.slice(0, 10), p.context.catalogueDate);
    delete p.policyRead;
    await writeFile(join(root, 'plan.json'), JSON.stringify(p));
    const invalid = spawnSync(process.execPath, ['scripts/gcsp/collect-fleet.mjs', '--plan', join(root, 'plan.json'), '--offline', join(root, 'fixture.json'), '--checkpoint', join(root, 'other.json')],
      { cwd: new URL('../..', import.meta.url), encoding: 'utf8', env: process.env, timeout: 5000 });
    assert.equal(invalid.status, 1); assert.equal(JSON.parse(invalid.stderr).code, 'invalid-plan');
    assert.equal((await readdir(root)).includes('other.json'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('identity refuses missing policy, empty factory selection and accessory pollution', async () => {
  const { createConfigurationKey } = await import('../../scripts/gcsp/configuration-key.mjs');
  await assert.rejects(createConfigurationKey({}), { code: 'signature-policy-unavailable' });
  const key = await createConfigurationKey({ policyService: new PolicyService(), policyRead });
  assert.throws(() => key({ vgModelCode: 'T5MJ', factoryOptionCodes: [] }), { code: 'invalid-factory-selection' });
  assert.throws(() => key({ vgModelCode: 'T5MJ', factoryOptionCodes: ['SE000001'] }), { code: 'accessory-in-factory-selection' });
  assert.throws(() => key({ vgModelCode: 'T5MJ', factoryOptionCodes: ['S0337'], aliases: { S0337: '0337', '0337': 'S0337' } }), { code: 'invalid-alias' });
});

const publicPage = 'https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ';
const httpLimits = () => ({ ...plan().limits, requestBudgets: { page: 4 }, sourceAttempts: 4,
  sourceBytes: 2 * 1024 * 1024, responseBytes: 1024 * 1024 });
const pageOperation = (changes = {}) => ({ sourceId: 'bmw-uk-public', sourceVersion: 'f58-20261105.v1',
  kind: 'read-only-http', capability: 'bmw-page',
  prepare: async () => ({ method: 'GET', url: publicPage, headers: {} }),
  project: async () => ({ safe: true }), ...changes });

test('read-only source executor refuses unknown routes, methods and credentials before spending an attempt', async () => {
  const { createCollectionSession } = await import('../../scripts/gcsp/collection-session.mjs');
  const root = await mkdtemp(join(tmpdir(), 'f59-http-'));
  let calls = 0;
  try {
    for (const bad of [{ method: 'POST', url: publicPage }, { method: 'GET', url: publicPage + '?other=1' },
      { method: 'GET', url: 'https://configure.bmw.co.uk/en_GB/garage' },
      { method: 'GET', url: 'https://example.invalid/en_GB/configure/G61E/T5MJ' },
      { method: 'GET', url: publicPage, headers: { 'x-api-key': 'must-stay-on-ucp' } },
      { method: 'GET', url: publicPage, headers: { cookie: 'private' } }]) {
      const session = await createCollectionSession({ identity: { run: inputDigest(bad) }, limits: httpLimits(),
        operations: { page: pageOperation({ prepare: async () => ({ headers: {}, ...bad }) }) }, statePath: join(root, inputDigest(bad)),
        http: { kind: 'fixture', fetch: async () => { calls += 1; return new Response(''); } } });
      await assert.rejects(session.withCheckpoint(async ({ execute }) => execute('page', {})), { code: 'source-endpoint-refused' });
    }
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('HTTP byte limits stop declared and streamed excess with durable accounting', async () => {
  const { createCollectionSession } = await import('../../scripts/gcsp/collection-session.mjs');
  const root = await mkdtemp(join(tmpdir(), 'f59-http-bytes-'));
  try {
    for (const kind of ['declared', 'response', 'aggregate']) {
      const limits = { ...httpLimits(), sourceBytes: kind === 'aggregate' ? 3 : 20, responseBytes: kind === 'response' ? 3 : 10 };
      const statePath = join(root, kind); let calls = 0;
      const session = await createCollectionSession({ identity: { kind }, limits, statePath, operations: { page: pageOperation() },
        http: { kind: 'fixture', fetch: async () => { calls += 1; return new Response('abcd', { headers: {
          'content-type': 'text/html', ...(kind === 'declared' ? { 'content-length': '11' } : {}) } }); } } });
      await assert.rejects(session.withCheckpoint(async ({ execute }) => execute('page', {})),
        { code: kind === 'aggregate' ? 'source-byte-budget' : 'response-byte-budget' });
      const state = JSON.parse(await readFile(statePath, 'utf8')).content;
      assert.equal(state.counts.httpAttempts, 1); assert.equal(state.counts.decodedBytes, kind === 'declared' ? 0 : 4);
      assert.equal(state.cache.length, 0);
      await assert.rejects(session.withCheckpoint(async ({ execute }) => execute('page', { next: true })), { code: state.halted });
      assert.equal(calls, 1);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('HTTP redirects, authentication, rate limits and stalled bodies stop without retry or overlapping persistence', async () => {
  const { createCollectionSession } = await import('../../scripts/gcsp/collection-session.mjs');
  const root = await mkdtemp(join(tmpdir(), 'f59-http-stops-'));
  try {
    for (const status of [302, 401, 403, 429]) {
      let calls = 0; const settings = { identity: { status }, limits: httpLimits(), statePath: join(root, String(status)), operations: { page: pageOperation() },
        http: { kind: 'fixture', fetch: async () => { calls += 1; return new Response('', { status, headers: { location: 'https://example.invalid' } }); } } };
      const code = status === 302 ? 'source-redirect-refused' : `source-http-${status}`;
      for (let i = 0; i < 2; i += 1) await assert.rejects((await createCollectionSession(settings)).withCheckpoint(async ({ execute }) => execute('page', {})), { code });
      assert.equal(calls, 1);
    }
    let canceled = false; let activeWrites = 0; let maxWrites = 0;
    const settings = { identity: { kind: 'body-timeout' }, limits: { ...httpLimits(), operationTimeoutMs: 25 },
      statePath: join(root, 'timeout'), operations: { page: pageOperation() },
      onPhase: async (phase) => { if (phase === 'before-rename') { activeWrites += 1; maxWrites = Math.max(maxWrites, activeWrites); await new Promise((resolve) => setTimeout(resolve, 2)); activeWrites -= 1; } },
      http: { kind: 'fixture', fetch: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('abcd')); }, cancel() { canceled = true; }
      }), { headers: { 'content-type': 'text/html' } }) } };
    await assert.rejects((await createCollectionSession(settings)).withCheckpoint(async ({ execute }) => execute('page', {})), { code: 'operation-timeout' });
    assert.equal(canceled, true); assert.equal(maxWrites, 1);
    const state = JSON.parse(await readFile(settings.statePath, 'utf8')).content;
    assert.equal(state.counts.timeouts, 1); assert.equal(state.counts.decodedBytes, 4); assert.equal(state.cache.length, 0);
    assert.deepEqual((await readdir(root)).filter((name) => name.includes('writer-') || name.includes('writing-')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('HTTP bytes already consumed at the absolute deadline remain counted after resume', async () => {
  const { createCollectionSession } = await import('../../scripts/gcsp/collection-session.mjs');
  const root = await mkdtemp(join(tmpdir(), 'f59-http-deadline-')); let clock = 0; let calls = 0;
  const settings = { identity: { kind: 'absolute-http-deadline' }, limits: httpLimits(), statePath: join(root, 'state'), now: () => clock,
    operations: { page: pageOperation() }, http: { kind: 'fixture', fetch: async () => { calls += 1;
      return new Response(new ReadableStream({ pull(controller) { clock = 45000; controller.enqueue(new TextEncoder().encode('abcd')); controller.close(); } }),
        { headers: { 'content-type': 'text/html' } }); } } };
  settings.limits.deadlineMs = 45000;
  try {
    await assert.rejects((await createCollectionSession(settings)).withCheckpoint(async ({ execute }) => execute('page', {})), { code: 'deadline' });
    const state = JSON.parse(await readFile(settings.statePath, 'utf8')).content;
    assert.equal(state.counts.decodedBytes, 4); assert.equal(state.counts.httpAttempts, 1);
    await assert.rejects((await createCollectionSession(settings)).withCheckpoint(async ({ execute }) => execute('page', {})), { code: 'deadline' });
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public source refuses changed settings, compact references and incomplete or retyped solver selections', async () => {
  const { createFleetCollector } = await import('../../scripts/gcsp/collect-fleet.mjs');
  const root = await mkdtemp(join(tmpdir(), 'f59-public-shape-'));
  try {
    for (const kind of ['settings', 'compact', 'substitution', 'selection', 'type']) {
      const { p, tree, solver } = await publicFixture(); let calls = 0;
      if (kind === 'compact') { delete tree['5'].modelRanges.G61E.models; delete tree.I.modelRanges.G61E.models; tree['5'].modelRanges.G61E.lines = { defaultModel: { modelCode: 'T5MJ' } }; }
      if (kind === 'substitution') tree.I.modelRanges.G61E.models.T5MJ.effectDate = '2027-01-06';
      if (kind === 'selection') delete solver.configuration.elements.S043L;
      if (kind === 'type') solver.configuration.elements.SE000001.type = 'option';
      const settings = { plan: p, source: { kind: 'public-bmw-uk', version: p.source.version }, mode: 'source-fixture',
        http: { kind: 'fixture', fetch: async (url) => {
          calls += 1;
          if (url === publicPage) return new Response('settings.fixture.json', { headers: { 'content-type': 'text/html' } });
          if (url.includes('/settings.')) return Response.json(kind === 'settings' ? { wrongProfile: { 'x-api-key': 'test-only' } }
            : { settingsVehicleTree: { 'x-api-key': 'test-only' }, settingsRules: { 'x-api-key': 'test-only' } });
          return Response.json(url.includes('/model-matrices/') ? tree : solver);
        } }, policyService: new PolicyService(), policyRead, statePath: join(root, kind) };
      const expected = { settings: 'settings-header-shape', compact: 'source-full-model-missing', substitution: 'source-model-substitution',
        selection: 'source-selection-changed', type: 'source-selection-changed' }[kind];
      const result = await (await createFleetCollector(settings)).run();
      assert.equal(result.reason, expected); assert.deepEqual(result.sourceObservations, []); assert.deepEqual(result.accepted, []);
      const previous = calls; assert.equal((await (await createFleetCollector(settings)).run()).reason, expected); assert.equal(calls, previous);
      const persisted = await readFile(settings.statePath, 'utf8'); assert.equal(persisted.includes('test-only'), false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('HTTP attempts and decoded bytes persist across stage changes, cached reuse and recreated sessions', async () => {
  const { createCollectionSession } = await import('../../scripts/gcsp/collection-session.mjs');
  const root = await mkdtemp(join(tmpdir(), 'f59-http-budget-'));
  try {
    const limits = httpLimits(); limits.sourceAttempts = 2; limits.sourceBytes = 8;
    const settings = { identity: { run: 'shared-http-fixture' }, limits, operations: { page: pageOperation() }, statePath: join(root, 'state'),
      http: { kind: 'fixture', fetch: async () => new Response('abcd', { headers: { 'content-type': 'text/html' } }) } };
    await (await createCollectionSession(settings)).withCheckpoint(async ({ execute }) => execute('page', { n: 1 }));
    const result = await (await createCollectionSession(settings)).withCheckpoint(async ({ execute, state }) => {
      await execute('page', { n: 1 }); await execute('page', { n: 2 }); return structuredClone(state);
    }, { stage: { id: 'enrichment', version: '1', inputDigest: inputDigest('http-budget') } });
    assert.equal(result.counts.httpAttempts, 2); assert.equal(result.counts.decodedBytes, 8); assert.equal(result.counts.sourceCalls, 0);
    assert.equal(result.counts.cacheHits.page, 1);
    await assert.rejects((await createCollectionSession(settings)).withCheckpoint(async ({ execute }) => execute('page', { n: 3 })), { code: 'source-attempt-budget' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function publicFixture() {
  const snapshot = JSON.parse(await readFile(new URL('../vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url), 'utf8'));
  const p = plan({ source: { id: 'bmw-uk-public', version: 'f58-20261105.v1', kind: 'public-bmw-uk' }, target: 1, candidateCount: 1,
    context: { catalogueDate: '2026-11-01', market: 'GB', locale: 'en-GB', orderDate: '2026-11-01', effectDate: '2027-01-05' },
    knownSelection: { factoryCodes: snapshot.selectedOptions, accessoryCodes: ['SE000001'] },
    limits: { ...httpLimits(), requestBudgets: { page: 1, settings: 1, discover: 1, solve: 1 }, maxAttempts: 1,
      operationTimeoutMs: 10000, deadlineMs: 45000, cacheRetentionMs: 86400000 } });
  const record = { modelCode: 'T5MJ', agModelCode: '72HH', modelRange: 'G61', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05' };
  const tree = { '5': { modelRanges: { G61E: { models: { T5MJ: record } } } }, I: { modelRanges: { G61E: { models: { T5MJ: { ...record } } } } } };
  const elements = Object.fromEntries([...snapshot.selectedOptions, 'SE000001'].map((code) => [code, { code, type: code.startsWith('SE') ? 'accessory' : 'option' }]));
  const solver = { constructible: true, configuration: { modelCode: 'T5MJ', elements }, privateOrder: 'must-not-retain-raw-response' };
  return { p, tree, solver };
}

test('actual qualified source shapes use the same collector/session without fabricating F39 dates or observation provenance', async () => {
  const { p, tree, solver } = await publicFixture(); const { createFleetCollector } = await import('../../scripts/gcsp/collect-fleet.mjs');
  const root = await mkdtemp(join(tmpdir(), 'f59-public-flow-')); const calls = [];
  const secret = 'test-only-public-application-header';
  try {
    const fetch = async (url, options) => {
      calls.push(url); assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual');
      if (url === publicPage) return new Response('<script src="/en_GB/settings.fixture.json"></script>', { headers: { 'content-type': 'text/html' } });
      if (url === 'https://configure.bmw.co.uk/en_GB/settings.fixture.json') return Response.json({ settingsVehicleTree: { 'x-api-key': secret }, settingsRuleSolver: { 'x-api-key': secret } });
      assert.equal(options.headers['x-api-key'], secret);
      if (url.includes('/model-matrices/')) return Response.json(tree);
      if (url.includes('/rulesolver/')) return Response.json(solver);
      throw new Error('unexpected route');
    };
    const settings = { plan: p, source: { kind: 'public-bmw-uk', version: p.source.version }, mode: 'source-fixture',
      http: { kind: 'fixture', fetch }, policyService: new PolicyService(), policyRead, statePath: join(root, 'state') };
    const collector = await createFleetCollector(settings); const result = await collector.run();
    assert.equal(calls.length, 4); assert.equal(result.counts.httpAttempts, 4); assert.equal(result.counts.sourceCalls, 0);
    assert.equal(result.accepted.length, 0); assert.equal(result.status, 'incomplete');
    assert.equal(result.sourceObservations.length, 1);
    const observation = result.sourceObservations[0];
    assert.equal(observation.provenance.kind, 'synthetic-http-fixture'); assert.equal(observation.constructible, true);
    assert.equal(observation.modelYear.state, 'unknown'); assert.equal(observation.canonicalAdapterContext.status, 'unqualified');
    assert.equal(observation.sourceContext.modelRangeField, 'G61'); assert.equal(observation.sourceContext.catalogueRangeKey, 'G61E');
    assert.equal(Object.hasOwn(observation.sourceContext, 'productionDate'), false);
    assert.equal(observation.originalRequest.elements.join(','), 'FKSFU,P0300,S0337,S043L');
    assert.equal(observation.resolvedSelection.selectedOptions.length, 47); assert.equal(observation.resolvedSelection.selectedAccessories[0].quantity, null);
    const persisted = await readFile(settings.statePath, 'utf8');
    assert.equal(persisted.includes(secret), false); assert.equal(persisted.includes('privateOrder'), false);
    const resumed = await (await createFleetCollector(settings)).run(); assert.equal(calls.length, 4); assert.equal(resumed.sourceObservations.length, 1);
    await assert.rejects(createFleetCollector({ ...settings, mode: 'live' }), { code: 'source-allocation-required' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
