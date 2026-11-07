/** Synthetic protocol fixtures only; no source traffic, capacity or profile evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputDigest } from '../gcsp/repository/core.js';
import * as collector from '../../scripts/gcsp/collect-fleet.mjs';
import { createCollectionSession } from '../../scripts/gcsp/collection-session.mjs';

const sourceVersion = 'f59-context-qualification-20261107.v1';
const date = '2026-11-07';
function plan() {
  return { schemaVersion: 'bmw-source-context-plan.v1', planId: 'f70-fixture-context', qualificationDate: date,
    source: { id: 'bmw-uk-public', version: sourceVersion, kind: 'public-bmw-uk' },
    modelRegistration: { schemaVersion: 'bmw-public-model-registration.v1', modelCode: '1F7A', agModelCode: '82GE',
      catalogueRangeKey: 'F70', rawModelRange: 'F70', aliases: ['1'], market: 'GB', locale: 'en-GB', steering: 'RL',
      catalogueDate: '2026-11-01', orderDate: '2026-11-01', effectDate: '2027-01-05' },
    limits: { maxAttempts: 1, retryDelayMs: 0, concurrency: 1, imageRequests: 0, sourceAttempts: 3, sourceBytes: 4194304,
      responseBytes: 1048576, operationTimeoutMs: 10000, deadlineMs: 120000, checkpointBytes: 4194304,
      cacheEntries: 8, cacheRetentionMs: 86400000, requestBudgets: { page: 1, settings: 1, discover: 1 } } };
}
async function setup(t, mutate = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'bmw-context-')); t.after(() => rm(root, { recursive: true, force: true }));
  const p = plan(); const calls = [];
  const model = { modelCode: '1F7A', agModelCode: '82GE', modelRange: 'F70', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05', modelName: 'Fixture derivative' };
  const tree = { 1: { modelRanges: { F70: { models: { '1F7A': model } } } } };
  const settings = { APP: { backend: { settingsVehicleTree: { 'x-api-key': 'private-context-fixture' } } } };
  const data = { p, tree, model, settings }; mutate(data);
  const fetch = async (input) => {
    const url = new URL(input); calls.push(url.href);
    if (url.pathname.includes('/configure/')) return new Response('<script src="settings.fixture.json"></script>', { headers: { 'content-type': 'text/html' } });
    if (url.pathname.includes('/settings.')) return Response.json(settings);
    if (url.pathname.includes('/vehicle-trees/')) return Response.json(tree);
    throw new Error('Unexpected options/solver egress');
  };
  return { p, calls, input: { plan: p, statePath: join(root, 'retained-primary.json'), mode: 'source-fixture',
    http: { kind: 'fixture', fetch }, now: () => Date.parse('2026-11-07T02:00:00Z') } };
}
function factory() {
  assert.equal(typeof collector.createPublicBmwContextQualification, 'function', 'the existing collector must expose observation-only context qualification');
  return collector.createPublicBmwContextQualification;
}

test('fresh model context retains missing trim as unknown and never requests default trim, options or solver', async (t) => {
  const { input, calls } = await setup(t); const create = factory(); const work = await create(input);
  assert.equal(calls.length, 0);
  const result = await work.run();
  assert.equal(result.reason, 'source-trim-unknown'); assert.equal(result.admission, false);
  assert.equal(result.counts.httpAttempts, 3); assert.deepEqual(result.accepted, []);
  assert.equal(result.tree.document.report.nodes[0].facts.modelCode, '1F7A');
  assert.equal(result.tree.document.report.nodes[0].facts.agModelCode, '82GE');
  assert.equal(result.tree.document.report.missingFields.includes('trim'), true);
  assert.equal(calls.some((url) => url.includes('S0337') || url.includes('/options/') || url.includes('/rulesolver/')), false);
  assert.equal((await readFile(input.statePath, 'utf8')).includes('private-context-fixture'), false);
  const resumed = await (await create(input)).run(); assert.deepEqual(resumed, result); assert.equal(calls.length, 3);
  const envelope = JSON.parse(await readFile(input.statePath)); envelope.content.accepted.push({ admission: true }); envelope.contentDigest = inputDigest(envelope.content);
  await writeFile(input.statePath, JSON.stringify(envelope));
  await assert.rejects((await create(input)).run(), { code: 'checkpoint-corrupt' });
});

test('explicit fresh direct trim remains an observed field with options and candidate traffic still unallocated', async (t) => {
  const { input, calls } = await setup(t, ({ model }) => { model.trim = 'S07LG'; });
  const result = await (await factory()(input)).run();
  assert.equal(result.reason, 'context-observed-options-unallocated'); assert.equal(result.tree.document.report.nodes[0].facts.trim, 'S07LG');
  assert.equal(result.tree.document.report.nodes[0].fieldPointers.trim, '/1/modelRanges/F70/models/1F7A/trim');
  assert.equal(result.counts.httpAttempts, 3); assert.equal(calls.length, 3); assert.equal(result.admission, false);
});

test('wrong source identity and missing required aliases stop durably before any options or solver request', async (t) => {
  for (const [mutate, reason] of [
    [({ model }) => { model.agModelCode = '22GE'; }, 'source-model-substitution'],
    [({ p }) => { p.modelRegistration.aliases = ['1', 'I']; }, 'source-full-model-missing'],
  ]) {
    const { input, calls } = await setup(t, mutate); const create = factory();
    const result = await (await create(input)).run(); assert.equal(result.reason, reason); assert.equal(result.counts.httpAttempts, 3);
    await (await create(input)).run(); assert.equal(calls.length, 3);
  }
});

test('qualification stage refuses copied trim and candidate plans before source egress', async (t) => {
  const create = factory();
  for (const mutate of [({ p }) => { p.modelRegistration.optionsTrim = 'S0337'; }, ({ p }) => { p.candidates = [{ request: 'unqualified' }]; }]) {
    const { input, calls } = await setup(t, mutate); await assert.rejects(create(input), { code: 'source-context-plan' }); assert.equal(calls.length, 0);
  }
});

test('context source capability cannot register options, solver or a different model page', async (t) => {
  const { p, input, calls } = await setup(t); const create = factory();
  await create(input); // Establish the real supported version before testing its shared-session gate.
  for (const capability of ['bmw-options', 'bmw-solver']) {
    await assert.rejects(createCollectionSession({ identity: { planDigest: inputDigest(p) }, limits: { ...p.limits, requestBudgets: { forbidden: 1 } },
      statePath: input.statePath, http: input.http, operations: { forbidden: { kind: 'read-only-http', sourceId: 'bmw-uk-public', sourceVersion, capability,
        requestRegistration: { model: p.modelRegistration }, prepare: async () => ({ method: 'GET', url: 'https://configure.bmw.co.uk/en_GB/configure/F70/1F7A', headers: {} }), project: (v) => v } } }), { code: 'invalid-session' });
  }
  const session = await createCollectionSession({ identity: { planDigest: inputDigest(p) }, limits: { ...p.limits, requestBudgets: { page: 1 } },
    statePath: input.statePath, http: input.http, operations: { page: { kind: 'read-only-http', sourceId: 'bmw-uk-public', sourceVersion, capability: 'bmw-page',
      requestRegistration: { model: p.modelRegistration }, prepare: async () => ({ method: 'GET', url: 'https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ', headers: {} }), project: (v) => v } } });
  await assert.rejects(session.withCheckpoint(({ execute }) => execute('page', {})), { code: 'source-endpoint-refused' }); assert.equal(calls.length, 0);
});

test('retained source projection cannot change model facts after its outer checkpoint is resealed', async (t) => {
  const { input } = await setup(t); const create = factory(); await (await create(input)).run();
  const envelope = JSON.parse(await readFile(input.statePath));
  envelope.content.contextObservation.document.report.nodes[0].facts.agModelCode = '22GE'; envelope.contentDigest = inputDigest(envelope.content);
  await writeFile(input.statePath, JSON.stringify(envelope));
  await assert.rejects((await create(input)).run(), { code: 'source-context-binding' });
});

test('an unregistered direct alias in fresh source requires review rather than silently ignoring its facts', async (t) => {
  const { input, calls } = await setup(t, ({ tree }) => { tree.I = structuredClone(tree['1']); });
  const result = await (await factory()(input)).run(); assert.equal(result.reason, 'source-model-alias-conflict');
  assert.equal(calls.length, 3); assert.equal(result.tree, null); assert.deepEqual(result.accepted, []);
});

test('a partial retained context checkpoint cannot replay spent bootstrap requests to recover memory-only headers', async (t) => {
  const { input, calls } = await setup(t); const create = factory(); await (await create(input)).run();
  const envelope = JSON.parse(await readFile(input.statePath)); envelope.content.contextObservation = null;
  envelope.contentDigest = inputDigest(envelope.content); await writeFile(input.statePath, JSON.stringify(envelope));
  const result = await (await create(input)).run(); assert.equal(result.reason, 'context-interrupted'); assert.equal(calls.length, 3);
});

test('a changed actual qualification date stops after the first GET with a durable explicit date refusal', async (t) => {
  const { input, calls } = await setup(t); input.now = () => Date.parse('2026-11-08T02:00:00Z');
  const result = await (await factory()(input)).run(); assert.equal(result.reason, 'source-observation-date'); assert.equal(calls.length, 1);
});
