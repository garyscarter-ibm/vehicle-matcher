/** Synthetic source protocol only; no public traffic or breadth acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { createFleetCollector, buildCandidateQueue } from '../../scripts/gcsp/collect-fleet.mjs';
import { bmwModelBatchRequestUrls, validateBmwCandidateRequest } from '../../scripts/gcsp/bmw-public-registration.mjs';

const sha = v => createHash('sha256').update(v).digest('hex');
const original = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq-58/complete-selection-2026-11-07/collection-plan.json', import.meta.url)));
const contexts = [
  ['1F7A', '82GE', 'BASIC_LINE', '1F7A', '82GE', 0, null],
  ['1F7C', '22GE', 'M_PERFORMANCE_LINE', '1F7C', '22GE', 0, null],
  ['1F7D', '62GE', 'S0337', '1F7B', '82GE', 2, 'S0337'],
  ['1F7F', '62GE', 'S033B', '1F7E', '82GE', 0, 'S033B'],
];
async function fixture(t, context = contexts[0], mutate = () => {}) {
  const [modelCode, agModelCode, lineKey, defaultCode, defaultAg, includedIndex, trim] = context;
  const root = await mkdtemp(join(tmpdir(), 'bmw-model-batch-')); t.after(() => rm(root, { recursive: true, force: true }));
  const plan = { ...structuredClone(original), planId: `model-batch-${modelCode}`, seed: 'model-batch-fixture',
    source: { ...original.source, version: 'f59-model-batch-20261107.v1' }, models: [modelCode],
    modelRegistration: { schemaVersion: 'bmw-public-model-registration.v1', modelCode, agModelCode, catalogueRangeKey: 'F70', rawModelRange: 'F70',
      aliases: ['1'], market: 'GB', locale: 'en-GB', steering: 'RL', catalogueDate: '2026-11-01', orderDate: '2026-11-01', effectDate: '2027-01-05' },
    lineRegistration: { lineKey, defaultModel: { modelCode: defaultCode, agModelCode: defaultAg }, includedIndex,
      optionsQuery: trim ? { kind: 'trim', code: trim } : { kind: 'untrimmed' } },
    limits: { ...original.limits, requestBudgets: { page: 1, settings: 1, discover: 1, options: 1, solve: 1 }, sourceAttempts: 5,
      sourceBytes: 4194304, checkpointBytes: 4194304 } };
  delete plan.knownSelection;
  const model = { modelCode, agModelCode, modelRange: 'F70', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05' };
  const line = { defaultModel: { modelCode: defaultCode, agModelCode: defaultAg }, ...(trim ? { option: trim } : {}),
    includedTransmissionVariants: Array.from({ length: includedIndex + 1 }, (_, i) => ({ configuration: {
      modelCode: i === includedIndex ? modelCode : 'OTHER', elements: trim ? { [trim]: {} } : {} } })) };
  const tree = { 1: { modelRanges: { F70: { models: { [modelCode]: model }, lines: { [lineKey]: line } } } } };
  const definitions = Object.fromEntries([['P0300', 'paint'], ['FKTNL', 'fabric'], ['S01H5', 'rim'], ...(trim ? [[trim, 'trim']] : [])]
    .map(([code, optionType]) => [code, { option: code, optionType }]));
  const typed = Object.entries(definitions).map(([code, row]) => ({ code, ...row, issues: [] }));
  plan.candidates = [{ candidateId: 'fixture-candidate', request: { includedElements: ['P0300', 'FKTNL', 'S01H5', ...(trim ? [trim] : [])].sort(), mandatoryElements: trim ? [trim] : [] } }];
  const data = { plan, model, line, tree, definitions, typed }; mutate(data); const calls = [];
  const fetch = async input => {
    const url = new URL(input); calls.push(url.href);
    if (url.pathname.includes('/configure/')) return new Response('<script src="settings.fixture.json"></script>', { headers: { 'content-type': 'text/html' } });
    if (url.pathname.includes('/settings.')) return Response.json({ APP: { backend: { settingsVehicleTree: { 'x-api-key': 'private-tree-fixture' },
      settingsLocalisation: { 'x-api-key': 'private-options-fixture' }, settingsRuleSolver: { 'x-api-key': 'private-solver-fixture' } } } });
    if (url.pathname.includes('/vehicle-trees/')) return Response.json(tree);
    if (url.pathname.includes('/options/')) return Response.json(definitions);
    const codes = url.searchParams.get('included-elements').split(',');
    const elements = Object.fromEntries([...codes, 'S0230'].sort().map(code => [code, { code, type: 'option' }]));
    const value = { constructible: true, configuration: { modelCode, elements }, configurationChanges: {
      addedElements: { S0230: elements.S0230 }, removedElements: {}, ignoredElements: {} } };
    data.solver?.(value); return Response.json(value);
  };
  return { ...data, calls, input: { plan, source: structuredClone(plan.source), mode: 'source-fixture', statePath: join(root, 'checkpoint.json'),
    policyService: new PolicyService({ provider: new FilePolicyProvider() }), now: () => Date.parse('2026-11-07T04:00:00.000Z'),
    batchBinding: { producerPins: { projectorSha256: sha('projector'), qualifierSha256: sha('binder'), sessionSha256: sha('session'), policyVersion: plan.policyRead.policyVersion },
      snapshotVersion: 'model-batch-fixture.v2', existingConfigurationIds: [] }, http: { kind: 'fixture', fetch } } };
}
for (const context of contexts) test(`${context[0]} retains exact full context and observed line through shared solver binding`, async t => {
  const f = await fixture(t, context); const collector = await createFleetCollector(f.input); assert.equal(f.calls.length, 0);
  const result = await collector.run(); assert.equal(result.records.length, 1); assert.equal(result.accepted.length, 0);
  assert.equal(result.reason, 'queue-exhausted'); assert.equal(f.calls.length, 5);
  const solver = new URL(f.calls[4]); assert.equal(solver.searchParams.has('mandatory-elements'), true);
  assert.equal(solver.searchParams.get('mandatory-elements'), context[6] || '');
  assert.equal(solver.searchParams.get('add-rules-for-mandatory-element-classes'), 'fabric,paint,rim');
  assert.equal(new URL(f.calls[3]).search, context[6] ? `?trim=${context[6]}` : '');
  const row = result.records[0]; assert.equal(row.canonicalIdentity.vgModelCode, context[0]); assert.equal(row.canonicalIdentity.agModelCode, context[1]);
  assert.equal(row.catalogue.sourceBinding.optionalFacts.trim.state, 'unknown');
  assert.deepEqual(row.solverChanges.added, ['S0230']); assert.equal(row.paint.value.code, 'P0300');
  const envelope = JSON.parse(await readFile(f.input.statePath));
  assert.deepEqual(envelope.content.batchEvidence.tree.document.report.lineRelationships[0].optionsQuery, f.plan.lineRegistration.optionsQuery);
  assert.equal(JSON.stringify(envelope).includes('private-'), false);
  assert.deepEqual((await (await createFleetCollector(f.input)).run()).records, result.records); assert.equal(f.calls.length, 5);
});
for (const [name, mutate, reason, calls] of [
  ['AG substitution', f => { f.model.agModelCode = '99ZZ'; }, 'source-model-substitution', 3],
  ['effect substitution', f => { f.model.effectDate = '2027-01-06'; }, 'source-model-substitution', 3],
  ['extra alias', f => { f.tree.I = structuredClone(f.tree[1]); }, 'source-model-alias-conflict', 3],
  ['default substitution', f => { f.line.defaultModel.modelCode = '1F7B'; }, 'source-line-relationship', 3],
  ['invented line option', f => { f.line.option = 'S0337'; }, 'source-line-relationship', 3],
  ['missing included variant', f => { f.line.includedTransmissionVariants[0].configuration.modelCode = '1F7B'; }, 'source-line-relationship', 3],
  ['missing input definition', f => { delete f.definitions.P0300; }, 'source-candidate-definition', 4],
  ['borrowed direct type', f => { f.definitions.P0300.optionType = 'other'; }, 'source-candidate-definition', 4],
  ['solver substitution', f => { f.solver = v => { v.configuration.modelCode = '1F7B'; }; }, 'source-solver-shape', 5],
]) test(`${name} stops without retry or later stages`, async t => {
  const f = await fixture(t, contexts[0], mutate); const result = await (await createFleetCollector(f.input)).run();
  assert.equal(result.reason, reason); assert.equal(f.calls.length, calls); assert.equal(result.records.length, 0);
  await (await createFleetCollector(f.input)).run(); assert.equal(f.calls.length, calls);
});
test('new candidate generation has no borrowed default and old strict validator still refuses empty mandatory inputs', async t => {
  for (const context of contexts) {
    const f = await fixture(t, context); delete f.plan.candidates;
    const queue = buildCandidateQueue(f.plan, { definitions: f.typed }); assert.equal(queue.length, 1);
    assert.deepEqual(queue[0].request.mandatoryElements, context[6] ? [context[6]] : []);
    assert.equal(queue[0].request.includedElements.length, context[6] ? 4 : 3);
    const urls = bmwModelBatchRequestUrls({ model: f.plan.modelRegistration, line: f.plan.lineRegistration }, queue[0].request);
    assert.equal(new URL(urls.solve).searchParams.get('mandatory-elements'), context[6] || '');
  }
  assert.throws(() => validateBmwCandidateRequest({ includedElements: ['FKTNL', 'P0300', 'S01H5'], mandatoryElements: [] }), { code: 'source-candidate-registration' });
});
test('resealed retained relationship and empty-query tampering fail semantic binding without traffic', async t => {
  for (const kind of ['line', 'query']) {
    const f = await fixture(t); await (await createFleetCollector(f.input)).run(); const envelope = JSON.parse(await readFile(f.input.statePath));
    const state = envelope.content;
    const artifacts = kind === 'line' ? [state.batchEvidence.tree] : [state.sourceCaptures[0].solver];
    for (const artifact of artifacts) {
      if (kind === 'line') artifact.document.report.lineRelationships[0].defaultModel.agModelCode = '99ZZ';
      else {
        const url = new URL(artifact.document.observation.request.url); url.searchParams.delete('mandatory-elements'); artifact.document.observation.request.url = url.href;
        artifact.document.requestSha256 = sha(JSON.stringify(artifact.document.observation.request) + '\n');
      }
      artifact.document.rawSelectionSha256 = sha(JSON.stringify(artifact.document.report) + '\n');
      const bytes = JSON.stringify(artifact.document) + '\n'; artifact.bytes = Buffer.byteLength(bytes); artifact.sha256 = sha(bytes);
    }
    envelope.contentDigest = inputDigest(state); await writeFile(f.input.statePath, JSON.stringify(envelope));
    await assert.rejects(async () => (await createFleetCollector(f.input)).run()); assert.equal(f.calls.length, 5);
  }
});

test('no-option request registration rejects omission semantics, borrowed mandatory codes and widened candidates before traffic', async t => {
  for (const mutate of [
    f => { f.plan.modelRegistration.optionsTrim = 'S0337'; },
    f => { f.plan.candidates[0].request.mandatoryElements = ['S01H5']; },
    f => { f.plan.candidateBaseElements = ['S0230']; },
  ]) {
    const f = await fixture(t, contexts[0], mutate);
    await assert.rejects(createFleetCollector(f.input)); assert.equal(f.calls.length, 0);
  }
});
