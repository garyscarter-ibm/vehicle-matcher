/** Synthetic protocol fixtures: no source traffic or configuration/capacity evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createPublicBmwOptionsQualification } from '../../scripts/gcsp/collect-fleet.mjs';
import { createCollectionSession } from '../../scripts/gcsp/collection-session.mjs';
import { inputDigest } from '../gcsp/repository/core.js';

const contexts = [
  ['1F7A', '82GE', 'BASIC_LINE', '1F7A', '82GE', 0, null],
  ['1F7C', '22GE', 'M_PERFORMANCE_LINE', '1F7C', '22GE', 0, null],
  ['1F7D', '62GE', 'S0337', '1F7B', '82GE', 2, 'S0337'],
  ['1F7F', '62GE', 'S033B', '1F7E', '82GE', 0, 'S033B'],
];
async function fixture(t, context = contexts[0], mutate = () => {}) {
  const [modelCode, agModelCode, lineKey, defaultCode, defaultAg, includedIndex, trim] = context;
  const directory = await mkdtemp(join(tmpdir(), 'bmw-model-options-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const p = { schemaVersion: 'bmw-source-model-options-plan.v1', planId: `fixture-${modelCode}`, qualificationDate: '2026-11-07',
    source: { id: 'bmw-uk-public', version: 'f59-model-options-qualification-20261107.v1', kind: 'public-bmw-uk' },
    modelRegistration: { schemaVersion: 'bmw-public-model-registration.v1', modelCode, agModelCode, catalogueRangeKey: 'F70', rawModelRange: 'F70',
      aliases: ['1'], market: 'GB', locale: 'en-GB', steering: 'RL', catalogueDate: '2026-11-01', orderDate: '2026-11-01', effectDate: '2027-01-05' },
    lineRegistration: { lineKey, defaultModel: { modelCode: defaultCode, agModelCode: defaultAg }, includedIndex,
      optionsQuery: trim ? { kind: 'trim', code: trim } : { kind: 'untrimmed' } },
    limits: { maxAttempts: 1, retryDelayMs: 0, concurrency: 1, imageRequests: 0, sourceAttempts: 4, sourceBytes: 4194304,
      responseBytes: 1048576, operationTimeoutMs: 10000, deadlineMs: 40000, checkpointBytes: 4194304,
      cacheEntries: 8, cacheRetentionMs: 86400000, requestBudgets: { page: 1, settings: 1, discover: 1, options: 1 } } };
  const model = { modelCode, agModelCode, modelRange: 'F70', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05' };
  const line = { defaultModel: { modelCode: defaultCode, agModelCode: defaultAg },
    ...(trim ? { option: trim } : {}), includedTransmissionVariants: Array.from({ length: includedIndex + 1 }, (_, i) =>
      ({ configuration: { modelCode: i === includedIndex ? modelCode : 'OTHER', elements: trim ? { [trim]: {} } : {} } })) };
  const tree = { 1: { modelRanges: { F70: { models: { [modelCode]: model }, lines: { [lineKey]: line } } } } };
  const definitions = Object.fromEntries([['P0300', 'paint'], ['FKTNL', 'fabric'], ['S01H5', 'rim'], ...(trim ? [[trim, 'option']] : [])]
    .map(([code, optionType]) => [code, { option: code, optionType }]));
  const data = { p, model, line, tree, definitions }; mutate(data); const calls = [];
  const fetch = async url => {
    calls.push(url);
    if (url.includes('/configure/')) return new Response('<script src="settings.fixture.json"></script>', { headers: { 'content-type': 'text/html' } });
    if (url.includes('/settings.')) return Response.json({ APP: { backend: { settingsVehicleTree: { 'x-api-key': 'private-tree-fixture' }, settingsLocalisation: { 'x-api-key': 'private-options-fixture' } } } });
    if (url.includes('/vehicle-trees/')) return Response.json(tree);
    if (url.includes('/options/')) return Response.json(definitions);
    throw new Error('forbidden-solver-route');
  };
  return { ...data, calls, input: { plan: p, statePath: join(directory, 'primary.json'), mode: 'source-fixture', http: { kind: 'fixture', fetch },
    now: () => Date.parse('2026-11-07T02:00:00Z') } };
}
for (const context of contexts) test(`${context[0]} binds full target separately from line default and uses its explicit query`, async t => {
  const { input, calls, p } = await fixture(t, context); const result = await (await createPublicBmwOptionsQualification(input)).run();
  assert.equal(result.reason, 'source-options-qualified'); assert.equal(calls.length, 4); assert.equal(result.admission, false);
  assert.deepEqual(result.accepted, []); assert.equal(calls.some(url => url.includes('/rulesolver/')), false);
  assert.equal(new URL(calls[3]).search, context[6] ? `?trim=${context[6]}` : '');
  const relationship = result.trimRelationships[0]; assert.equal(relationship.included.modelCode, context[0]);
  assert.equal(relationship.defaultModel.modelCode, p.lineRegistration.defaultModel.modelCode);
  assert.deepEqual(relationship.optionsQuery, p.lineRegistration.optionsQuery);
  assert.equal(result.tree.document.report.nodes[0].facts.agModelCode, context[1]);
  assert.equal(/private-(tree|options)-fixture/.test(await readFile(input.statePath, 'utf8')), false);
  assert.deepEqual(await (await createPublicBmwOptionsQualification(input)).run(), result); assert.equal(calls.length, 4);
});
for (const [name, mutate, reason] of [
  ['full model', ({ model }) => { model.modelCode = '1F7B'; }, 'source-model-substitution'],
  ['full AG', ({ model }) => { model.agModelCode = '99ZZ'; }, 'source-model-substitution'],
  ['raw range', ({ model }) => { model.modelRange = 'G42'; }, 'source-model-substitution'],
  ['effect date', ({ model }) => { model.effectDate = '2027-01-06'; }, 'source-model-substitution'],
  ['order date', ({ model }) => { model.orderDate = '2026-11-02'; }, 'source-model-substitution'],
  ['extra alias', ({ tree }) => { tree.I = structuredClone(tree[1]); }, 'source-model-alias-conflict'],
  ['no-option line gets an option', ({ line }) => { line.option = 'S0337'; }, 'source-line-relationship'],
  ['line default substitution', ({ line }) => { line.defaultModel.agModelCode = '99ZZ'; }, 'source-line-relationship'],
  ['absent requested variant', ({ line }) => { line.includedTransmissionVariants[0].configuration.modelCode = '1F7B'; }, 'source-line-relationship'],
  ['ambiguous requested variant', ({ line }) => { line.includedTransmissionVariants.push(structuredClone(line.includedTransmissionVariants[0])); }, 'source-line-relationship'],
]) test(`${name} stops before options`, async t => {
  const { input, calls } = await fixture(t, contexts[0], mutate); const result = await (await createPublicBmwOptionsQualification(input)).run();
  assert.equal(result.reason, reason); assert.equal(calls.length, 3); assert.equal(result.options, null);
});
for (const [name, mutate] of [
  ['wrong line option', ({ line }) => { line.option = 'S033B'; }],
  ['missing included option', ({ line }) => { delete line.includedTransmissionVariants[2].configuration.elements.S0337; }],
]) test(`${name} refuses trimmed relationship`, async t => {
  const { input, calls } = await fixture(t, contexts[2], mutate); const result = await (await createPublicBmwOptionsQualification(input)).run();
  assert.equal(result.reason, 'source-line-relationship'); assert.equal(calls.length, 3);
});
for (const [name, mutate] of [
  ['mismatched direct option', ({ definitions }) => { definitions.P0300.option = 'P9999'; }],
  ['missing direct type', ({ definitions }) => { delete definitions.P0300.optionType; }],
  ['missing explicit trim definition', ({ definitions }) => { delete definitions.S0337; }],
]) test(`${name} is not qualified from another definition`, async t => {
  const { input, calls } = await fixture(t, contexts[2], mutate); const result = await (await createPublicBmwOptionsQualification(input)).run();
  assert.equal(result.reason, 'source-options-shape'); assert.equal(calls.length, 4); assert.equal(result.options, null);
});
test('registration rejects borrowed trim, solver and widened allocation before egress', async t => {
  for (const mutate of [({ p }) => { p.modelRegistration.optionsTrim = 'S0337'; }, ({ p }) => { p.lineRegistration.optionsQuery.code = 'S0337'; },
    ({ p }) => { p.limits.requestBudgets.solve = 1; }, ({ p }) => { p.limits.sourceAttempts = 5; }]) {
    const { input, calls } = await fixture(t, contexts[0], mutate);
    await assert.rejects(createPublicBmwOptionsQualification(input), { code: 'source-options-plan' }); assert.equal(calls.length, 0);
  }
});
test('options query registration cannot grant solver capability or a default trim URL', async t => {
  const { input, p, calls } = await fixture(t); const requestRegistration = { model: p.modelRegistration, line: p.lineRegistration };
  const descriptor = { kind: 'read-only-http', sourceId: p.source.id, sourceVersion: p.source.version, requestRegistration,
    prepare: async () => ({ method: 'GET', url: 'https://prod.ucp.bmw.cloud/localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/applications/connext/models/1F7A/options/languages/en?trim=S0337', headers: {} }), project: v => v };
  await assert.rejects(createCollectionSession({ identity: { planDigest: inputDigest(p) }, limits: { ...p.limits, requestBudgets: { solve: 1 } }, statePath: input.statePath, http: input.http,
    operations: { solve: { ...descriptor, capability: 'bmw-solver' } } }), { code: 'invalid-session' });
  const session = await createCollectionSession({ identity: { planDigest: inputDigest(p) }, limits: { ...p.limits, requestBudgets: { options: 1 } }, statePath: input.statePath, http: input.http,
    operations: { options: { ...descriptor, capability: 'bmw-options' } } });
  await assert.rejects(session.withCheckpoint(({ execute }) => execute('options', {})), { code: 'source-endpoint-refused' }); assert.equal(calls.length, 0);
});
test('resealed checkpoint cannot change bound line default or typed definition', async t => {
  for (const which of ['line', 'options']) {
    const { input, calls } = await fixture(t); await (await createPublicBmwOptionsQualification(input)).run();
    const state = JSON.parse(await readFile(input.statePath));
    if (which === 'line') {
      state.content.trimRelationships[0].defaultModel.modelCode = '1F7B';
      state.content.contextObservation.document.trimRelationships = structuredClone(state.content.trimRelationships);
    } else state.content.optionsObservation.document.report.candidates[0].definitions[0].option = 'P9999';
    const artifact = which === 'line' ? state.content.contextObservation : state.content.optionsObservation;
    const bytes = JSON.stringify(artifact.document) + '\n'; artifact.bytes = Buffer.byteLength(bytes); artifact.sha256 = createHash('sha256').update(bytes).digest('hex');
    state.contentDigest = inputDigest(state.content); await writeFile(input.statePath, JSON.stringify(state));
    await assert.rejects((await createPublicBmwOptionsQualification(input)).run(), { code: which === 'line' ? 'source-trim-binding' : 'source-options-binding' }); assert.equal(calls.length, 4);
  }
});
