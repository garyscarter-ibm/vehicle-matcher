/** Scripted protocol fixtures only: no public source requests or capacity claims. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
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
