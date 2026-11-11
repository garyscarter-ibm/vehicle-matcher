import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { deriveScenarioClock } from '../gcsp/clock/start-day.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/index.js';
import { loadScenarioCatalogue } from '../gcsp/fixtures/scenarios/index.js';
import { dayClock } from '../../blocks/gcsp/kit/friendly-time.js';
import { basicModel } from '../../blocks/gcsp/presenter-controls/basic-model.js';

const TEMPLATE = { startsAt: '2026-11-05T09:00:00.000Z',
  namedTimes: { release: '2026-11-05T09:30:00.000Z', expiry: '2026-11-05T11:00:00.000Z' } };

test('Day 1 is the wall clock London date at 9:00am, with the cues on the same day (GMT)', () => {
  const derived = deriveScenarioClock(TEMPLATE, '2026-11-11T07:30:00.000Z');
  assert.equal(derived.startsAt, '2026-11-11T09:00:00.000Z');
  assert.deepEqual(derived.namedTimes, { release: '2026-11-11T09:30:00.000Z', expiry: '2026-11-11T11:00:00.000Z' });
  assert.equal(deriveScenarioClock(TEMPLATE, TEMPLATE.startsAt).startsAt, TEMPLATE.startsAt);
});

test('in summer time 9:00am London is 08:00Z and a late UTC evening is already the next London day', () => {
  const summer = deriveScenarioClock(TEMPLATE, '2026-06-10T12:00:00.000Z');
  assert.equal(summer.startsAt, '2026-06-10T08:00:00.000Z');
  assert.deepEqual(summer.namedTimes, { release: '2026-06-10T08:30:00.000Z', expiry: '2026-06-10T10:00:00.000Z' });
  assert.equal(deriveScenarioClock(TEMPLATE, '2026-06-10T23:30:00.000Z').startsAt, '2026-06-11T08:00:00.000Z');
  assert.equal(deriveScenarioClock(TEMPLATE, '2026-11-14T10:00:00.000Z').startsAt, '2026-11-14T09:00:00.000Z', 'a Saturday still starts that day');
});

async function open(wall) {
  const repository = createMemoryRepository({ store: createMemoryStore() });
  await repository.open();
  const policy = createPolicyService();
  const clockNow = { wall };
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'start-day', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z', wallNow: () => clockNow.wall });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value.context;
  return { repository, policy, clock, presenter, clockNow };
}

test('a new run starts on the injected wall day, and its cues, release cue and catalogue follow', async () => {
  const f = await open('2026-11-11T07:30:00.000Z');
  const state = (await f.clock.readState(f.presenter)).value;
  assert.equal(state.now, '2026-11-11T09:00:00.000Z');
  const controls = (await f.clock.readControlsConfiguration(f.presenter)).value;
  assert.deepEqual(controls.namedTimes, { release: '2026-11-11T09:30:00.000Z', expiry: '2026-11-11T11:00:00.000Z' });
  assert.deepEqual(controls.nextRelease, { status: 'available', to: 'release', at: '2026-11-11T09:30:00.000Z' });
  const run = (await f.repository.read(f.presenter, { table: 'runs', key: { runId: state.runId } })).value;
  const catalogue = await loadScenarioCatalogue({ policy: f.policy, run,
    read: { runId: run.runId, asOf: run.clockInstant, policyVersion: run.policyVersion } });
  assert.equal(catalogue.status, 'ok');
  assert.ok(catalogue.value.scenarios.every((row) => row.clockStart === '2026-11-11T09:00:00.000Z' && row.namedTimes.release === '2026-11-11T09:30:00.000Z'));
  const moved = await f.clock.advance(f.presenter, { commandId: 'to-release', expectedClockVersion: '1', to: 'release' });
  assert.equal(moved.value.now, '2026-11-11T09:30:00.000Z');
  assert.equal((await f.clock.readState(f.presenter)).value.versions.scenarioClock, undefined, 'the stored derivation is not part of the public versions');
});

test('Start again on a later wall day moves Day 1 to that day', async () => {
  const f = await open('2026-11-11T07:30:00.000Z');
  const before = (await f.clock.readState(f.presenter)).value;
  f.clockNow.wall = '2026-11-12T08:15:00.000Z';
  const reset = await f.clock.reset(f.presenter, { commandId: 'again', expectedRunId: before.runId, expectedRunVersion: before.runVersion,
    scenarioVersion: before.versions.scenario, fixtureVersion: before.versions.fixture });
  assert.equal(reset.status, 'ok', JSON.stringify(reset));
  assert.equal(reset.value.now, '2026-11-12T09:00:00.000Z');
  const run = (await f.repository.currentRun('start-day')).value;
  assert.deepEqual(run.versions.scenarioClock.namedTimes, { release: '2026-11-12T09:30:00.000Z', expiry: '2026-11-12T11:00:00.000Z' });
});

test('the presenter console reads Day 1 as the derived start day', () => {
  const START = '2026-11-11T09:00:00.000Z';
  assert.equal(dayClock(START, START), 'Day 1 · Wed 11 Nov, 9:00am');
  const model = basicModel({ controls: { runId: 'r', runVersion: 1, now: START, clockVersion: '1', lastTick: null,
    currentScenario: { scenarioId: 'main-successful-journey', fixtureVersion: 'main-successful-journey-inputs-v1' } },
  scenario: { inputs: { briefs: [{ principalId: 'demo-paula' }] }, clockStart: START } });
  assert.equal(model.clock, 'Day 1 · Wed 11 Nov, 9:00am');
});
