/** Synthetic protocol fixtures only: no source traffic, candidate inputs or capacity evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as collector from '../../scripts/gcsp/collect-fleet.mjs';
import { createCollectionSession } from '../../scripts/gcsp/collection-session.mjs';
import { inputDigest } from '../gcsp/repository/core.js';

const sourceVersion = 'f59-options-qualification-20261107.v1';
function plan() {
  return { schemaVersion: 'bmw-source-options-plan.v1', planId: 'f70-fixture-options', qualificationDate: '2026-11-07',
    source: { id: 'bmw-uk-public', version: sourceVersion, kind: 'public-bmw-uk' },
    modelRegistration: { schemaVersion: 'bmw-public-model-registration.v1', modelCode: '1F7B', agModelCode: '82GE',
      catalogueRangeKey: 'F70', rawModelRange: 'F70', aliases: ['1'], market: 'GB', locale: 'en-GB', steering: 'RL',
      catalogueDate: '2026-11-01', orderDate: '2026-11-01', effectDate: '2027-01-05', optionsTrim: 'S07LG' },
    limits: { maxAttempts: 1, retryDelayMs: 0, concurrency: 1, imageRequests: 0, sourceAttempts: 4, sourceBytes: 4194304,
      responseBytes: 1048576, operationTimeoutMs: 10000, deadlineMs: 90000, checkpointBytes: 4194304,
      cacheEntries: 8, cacheRetentionMs: 86400000, requestBudgets: { page: 1, settings: 1, discover: 1, options: 1 } } };
}
async function fixture(t, mutate = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'bmw-options-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const p = plan(); const model = { modelCode: '1F7B', agModelCode: '82GE', modelRange: 'F70', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05' };
  const line = { option: 'S07LG', defaultModel: { modelCode: '1F7B', agModelCode: '82GE' },
    includedTransmissionVariants: [{ configuration: { modelCode: '1F7B', elements: { S07LG: {} } } }] };
  const tree = { 1: { modelRanges: { F70: { models: { '1F7B': model }, lines: { S07LG: line } } } } };
  const definitions = Object.fromEntries([['P0300', 'paint'], ['FKTNL', 'fabric'], ['S01H5', 'rim'], ['S07LG', 'option']]
    .map(([code, optionType]) => [code, { option: code, optionType, phrases: { longDescription: `Fixture ${code}` } }]));
  const data = { p, model, line, tree, definitions, optionStatus: 200 }; mutate(data); const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes('/configure/')) return new Response('<script src="settings.fixture.json"></script>', { headers: { 'content-type': 'text/html' } });
    if (url.includes('/settings.')) return Response.json({ APP: { backend: {
      settingsVehicleTree: { 'x-api-key': 'private-tree-fixture' }, settingsLocalisation: { 'x-api-key': 'private-localisation-fixture' } } } });
    if (url.includes('/vehicle-trees/')) return Response.json(tree);
    if (url.includes('/options/')) return Response.json(definitions, { status: data.optionStatus });
    throw new Error('forbidden-solver-route');
  };
  return { p, calls, input: { plan: p, statePath: join(directory, 'primary.json'), mode: 'source-fixture', http: { kind: 'fixture', fetch },
    now: () => Date.parse('2026-11-07T02:00:00Z') } };
}
function factory() {
  assert.equal(typeof collector.createPublicBmwOptionsQualification, 'function', 'the common collector must expose options-only qualification');
  return collector.createPublicBmwOptionsQualification;
}

test('fresh exact line/model join qualifies typed definitions with a non-default explicit trim and no candidate or solver', async (t) => {
  const { input, calls } = await fixture(t); const create = factory(); const result = await (await create(input)).run();
  assert.equal(result.reason, 'source-options-qualified'); assert.equal(result.admission, false); assert.equal(calls.length, 4);
  assert.deepEqual(result.accepted, []); assert.deepEqual(result.rejected, []); assert.deepEqual(result.duplicates, []);
  assert.equal(result.counts.httpAttempts, 4); assert.equal(result.counts.operations.options, 1);
  assert.equal(calls.some((url) => url.includes('S0337') || url.includes('/rulesolver/')), false);
  assert.equal(new URL(calls[3]).searchParams.get('trim'), 'S07LG');
  assert.equal(result.options.document.report.candidates[0].definitions.length, 4);
  assert.equal(result.trimRelationships[0].option.value, 'S07LG');
  assert.equal(result.trimRelationships[0].included.modelCode, '1F7B');
  const bytes = await readFile(input.statePath, 'utf8'); assert.equal(/private-(tree|localisation)-fixture/.test(bytes), false);
  assert.deepEqual(await (await create(input)).run(), result); assert.equal(calls.length, 4);
});

for (const [label, mutate, reason] of [
  ['wrong full model', ({ model }) => { model.modelCode = '1F7A'; }, 'source-model-substitution'],
  ['wrong full AG', ({ model }) => { model.agModelCode = '22GE'; }, 'source-model-substitution'],
  ['extra full alias', ({ tree }) => { tree.I = structuredClone(tree[1]); }, 'source-model-alias-conflict'],
  ['missing registered alias', ({ p }) => { p.modelRegistration.aliases = ['1', 'I']; }, 'source-full-model-missing'],
  ['wrong direct date', ({ model }) => { model.effectDate = '2027-01-06'; }, 'source-model-substitution'],
  ['wrong line option', ({ line }) => { line.option = 'S0337'; }, 'source-trim-relationship'],
  ['wrong compact model', ({ line }) => { line.defaultModel.modelCode = '1F7A'; }, 'source-trim-relationship'],
  ['wrong compact AG', ({ line }) => { line.defaultModel.agModelCode = '22GE'; }, 'source-trim-relationship'],
  ['missing included model', ({ line }) => { line.includedTransmissionVariants[0].configuration.modelCode = '1F7A'; }, 'source-trim-relationship'],
]) test(`${label} stops after the tree, before options`, async (t) => {
  const { input, calls } = await fixture(t, mutate); const result = await (await factory()(input)).run();
  assert.equal(result.reason, reason); assert.equal(calls.length, 3); assert.equal(result.options, null);
});

test('missing trim, candidate placeholders or expanded budgets are refused without source egress', async (t) => {
  const create = factory();
  for (const mutate of [({ p }) => { delete p.modelRegistration.optionsTrim; }, ({ p }) => { p.candidates = []; },
    ({ p }) => { p.limits.requestBudgets.solve = 1; }, ({ p }) => { p.limits.sourceAttempts = 5; }]) {
    const { input, calls } = await fixture(t, mutate); await assert.rejects(create(input), { code: 'source-options-plan' }); assert.equal(calls.length, 0);
  }
});

test('access refusal and invalid typed definitions stop durably without solver or bootstrap replay', async (t) => {
  for (const [mutate, reason] of [[(data) => { data.optionStatus = 403; }, 'source-http-403'],
    [(data) => { data.definitions.P0300.option = 'P9999'; }, 'source-options-shape']]) {
    const { input, calls } = await fixture(t, mutate); const create = factory(); const result = await (await create(input)).run();
    assert.equal(result.reason, reason); assert.equal(calls.length, 4);
    await (await create(input)).run(); assert.equal(calls.length, 4);
  }
});

test('options-only source cannot register solver capability or silently use a fixed trim URL', async (t) => {
  const { input, p, calls } = await fixture(t); await factory()(input);
  const descriptor = { kind: 'read-only-http', sourceId: p.source.id, sourceVersion, requestRegistration: { model: p.modelRegistration },
    prepare: async () => ({ method: 'GET', url: 'https://prod.ucp.bmw.cloud/localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/applications/connext/models/1F7B/options/languages/en?trim=S0337', headers: {} }), project: (v) => v };
  await assert.rejects(createCollectionSession({ identity: { planDigest: inputDigest(p) }, limits: { ...p.limits, requestBudgets: { solve: 1 } },
    statePath: input.statePath, http: input.http, operations: { solve: { ...descriptor, capability: 'bmw-solver' } } }), { code: 'invalid-session' });
  const session = await createCollectionSession({ identity: { planDigest: inputDigest(p) }, limits: { ...p.limits, requestBudgets: { options: 1 } },
    statePath: input.statePath, http: input.http, operations: { options: { ...descriptor, capability: 'bmw-options' } } });
  await assert.rejects(session.withCheckpoint(({ execute }) => execute('options', {})), { code: 'source-endpoint-refused' }); assert.equal(calls.length, 0);
});

test('changed actual qualification day stops on the first GET', async (t) => {
  const { input, calls } = await fixture(t); input.now = () => Date.parse('2026-11-08T02:00:00Z');
  const result = await (await factory()(input)).run(); assert.equal(result.reason, 'source-observation-date'); assert.equal(calls.length, 1);
});

test('partial retained progress cannot replay bootstrap and resealed trim tampering is refused', async (t) => {
  const { input, calls } = await fixture(t); const create = factory(); await (await create(input)).run();
  const original = JSON.parse(await readFile(input.statePath)); const partial = structuredClone(original);
  partial.content.optionsObservation = null; partial.contentDigest = inputDigest(partial.content); await writeFile(input.statePath, JSON.stringify(partial));
  const resumed = await (await create(input)).run(); assert.equal(resumed.reason, 'options-interrupted'); assert.equal(calls.length, 4);
  original.content.trimRelationships[0].option.value = 'S0337'; original.contentDigest = inputDigest(original.content);
  await writeFile(input.statePath, JSON.stringify(original));
  await assert.rejects((await create(input)).run(), { code: 'source-trim-binding' });
});
