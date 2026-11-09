// FUCQ-176 slice 2: experiment picker, what-if render and hold-duration rerun on Greg's comparison panel (jsdom, no port, pollMs 0).
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

let panel; let fixtures; let adapterMod; let element; let rerun; let words; let HOLD;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };
const until = async (test, limit = 200) => { for (let i = 0; i < limit && !test(); i += 1) await tick(); assert.ok(test(), 'condition not met'); };
before(async () => {
  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException', 'MutationObserver']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key] ?? globalThis[key], configurable: true, writable: true });
  }
  const base = '../../blocks/gcsp/greg/comparison/';
  panel = await import(`${base}panel.js`);
  fixtures = await import(`${base}fixtures.js`);
  adapterMod = await import(`${base}http-adapter.js`);
  element = await import(`${base}element.js`);
  rerun = await import(`${base}rerun-form.js`);
  words = await import(`${base}experiment-copy.js`);
  HOLD = JSON.parse(await readFile(new URL('./fixtures/gcsp-comparison-experiment-result.json', import.meta.url), 'utf8')).storedResult;
});
const teardowns = [];
beforeEach(() => document.body.replaceChildren());
afterEach(() => { while (teardowns.length) teardowns.pop()(); });

const JOB = 'comparison-job-fixture-0001';
const host = () => { const node = document.createElement('div'); node.className = 'gcsp'; document.body.append(node); return node; };
const text = (root) => root.textContent.replace(/\s+/g, ' ');
const optionOf = (root, id) => root.querySelector(`.gcsp-comparison-picker [data-value="${id}"]`);
const press = (node, key) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const submit = (root) => root.querySelector('.gcsp-comparison-actions button');
const field = (root, which) => root.querySelector(`.gcsp-comparison-form [id$="-${which}"]`);
const stamp = (root) => root.querySelector('[data-result-heading]');
const jobBody = (status, over = {}) => ({ jobId: JOB, experimentId: 'hold-sweep', status, progress: { seedsDone: 1, seedsTotal: 3, stepsDone: 4, stepsTotal: 12 },
  startedAt: '2026-11-09T12:00:00.000Z', finishedAt: null, resultId: null, reason: null, request: { experimentId: 'hold-sweep', change: { values: [3600], basis: 'Try one hour' } }, ...over });
const okJob = (value) => adapterMod.jobOutcomeToState(200, { status: 'ok', value });
const noJob = () => adapterMod.jobOutcomeToState(404, { status: 'not-found' });

// A spy over a fixture adapter. overrides replace single methods; gate holds each readJob until step().
async function mount(name, { pollMs = 0, overrides = {}, gate = false } = {}) {
  const inner = fixtures.experimentFixtureAdapter(name);
  const calls = { loadAll: 0, loadResult: [], start: [], readJob: [] };
  let waiting = null;
  const adapter = {
    loadAll: (o) => { calls.loadAll += 1; return inner.loadAll(o); },
    loadResult: (id, o) => { calls.loadResult.push(id); return inner.loadResult(id, o); },
    start: (payload, o) => { calls.start.push(payload); return inner.start(payload, o); },
    readJob: (query, o) => { calls.readJob.push(query); return gate && query?.jobId ? new Promise((resolve) => { waiting = () => resolve(inner.readJob(query, o)); }) : inner.readJob(query, o); },
    ...overrides,
  };
  const root = host(); const teardown = panel.mountGregComparison(root, { adapter, pollMs }); teardowns.push(teardown);
  await settle();
  const step = async () => { await until(() => waiting); const release = waiting; waiting = null; release(); await settle(); };
  return { root, teardown, calls, step };
}
async function choose(root, id) { optionOf(root, id).click(); await settle(); }
async function run(root, hours, basis) {
  field(root, 'hours').value = hours; field(root, 'basis').value = basis; submit(root).click(); await settle();
}

test('the picker lists the four experiments with their stored state and the process result shows first', async () => {
  const { root } = await mount('experiments-ready');
  assert.equal(root.querySelector('.gcsp-comparison').dataset.state, 'ready');
  const options = [...root.querySelectorAll('.gcsp-comparison-picker .vm-option')];
  assert.deepEqual(options.map((o) => o.dataset.value), ['process-only', 'order-mix', 'points', 'hold-sweep']);
  assert.deepEqual(options.map((o) => o.querySelector('.vm-option-label').textContent), ['Process only', 'Order mix', 'Points allowance', 'Hold duration']);
  assert.match(options[0].textContent, /stored \d+ \w+ 2026/); assert.match(options[3].textContent, /stored 8 Nov 2026/);
  assert.match(options[1].textContent, /no stored result/); assert.match(options[2].textContent, /no stored result/);
  const group = root.querySelector('.gcsp-comparison-picker [role="radiogroup"]');
  assert.equal(group.getAttribute('aria-labelledby'), root.querySelector('.gcsp-comparison-picker .gcsp-field-label').id);
  assert.equal(root.querySelector('.gcsp-comparison-picker .gcsp-field-label').textContent, 'Experiment');
  assert.deepEqual(options.map((o) => o.tabIndex), [0, -1, -1, -1]); assert.equal(options[0].getAttribute('aria-checked'), 'true');
  assert.match(stamp(root).textContent, /^Stored result, made 8 Nov 2026/);
  assert.ok(root.querySelector('.gcsp-comparison-measure h3')); assert.equal(root.querySelector('.gcsp-comparison-form'), null);
});

test('arrow keys move the choice and change only the body below, keeping focus on the picker', async () => {
  const { root } = await mount('experiments-ready');
  const first = optionOf(root, 'process-only'); first.focus();
  const picker = root.querySelector('.gcsp-comparison-picker'); const head = root.querySelector('.gcsp-comparison-head');
  press(first, 'ArrowDown'); await settle();
  assert.equal(document.activeElement, optionOf(root, 'order-mix')); assert.equal(optionOf(root, 'order-mix').getAttribute('aria-checked'), 'true');
  assert.equal(root.querySelector('.gcsp-comparison-picker'), picker); assert.equal(root.querySelector('.gcsp-comparison-head'), head);
  assert.match(text(root.querySelector('.gcsp-comparison-stage')), /No stored result yet/);
  assert.match(root.querySelector('.gcsp-comparison-command').textContent, /--experiment order-mix/);
  press(document.activeElement, 'End'); await settle();
  assert.equal(document.activeElement, optionOf(root, 'hold-sweep')); assert.ok(root.querySelector('.gcsp-comparison-form'));
  press(document.activeElement, 'Home'); await settle();
  assert.match(stamp(root).textContent, /^Stored result/); assert.equal(root.querySelector('.gcsp-comparison-form'), null);
});

test('a what-if result shows the change, today first in each bar, every difference with its verdict, the caveat outside the details and provenance', async () => {
  const { root } = await mount('experiments-ready'); await choose(root, 'hold-sweep');
  const stage = root.querySelector('.gcsp-comparison-stage');
  const facts = text(stage.querySelector('.gcsp-comparison-facts'));
  assert.match(facts, /What changes\s*hold\.buddy\.durationSeconds/); assert.match(facts, /Unit\s*seconds/); assert.match(facts, /Today's value\s*2 h \(Assumed\)/);
  assert.match(facts, /Basis for today's value\s*Assumed new capability/); assert.match(facts, /Tried\s*15 min, 24 h/); assert.match(facts, /Why try these\s*Test basis/);
  assert.match(text(stage), /What-if: this value is tried here and never published as live policy\./);
  assert.deepEqual([...stage.querySelectorAll('.gcsp-comparison-route > h3')].map((h) => h.textContent), ['Buddy route', "Today's release route"]);
  const measure = stage.querySelector('.gcsp-comparison-route .gcsp-comparison-measure');
  assert.deepEqual([...measure.querySelectorAll('.gcsp-range-bar-label')].map((n) => n.textContent), ['2 h (today)', '15 min', '24 h']);
  assert.deepEqual([...measure.querySelectorAll('.gcsp-comparison-arm')].map((n) => text(n)),
    ['Difference (15 min minus today): 0 pts (0 pts to 0 pts) No clear difference', 'Difference (24 h minus today): 0 pts (0 pts to 0 pts) No clear difference']);
  assert.equal(stage.querySelectorAll('.gcsp-comparison-route').length, 2); assert.equal(stage.querySelectorAll('.gcsp-comparison-route:first-of-type .gcsp-comparison-measure').length, 9);
  const caveat = stage.querySelector('.gcsp-comparison-caveat');
  assert.equal(caveat.textContent, 'Calculated fit is not observed satisfaction.'); assert.equal(caveat.closest('details'), null);
  assert.ok(stage.querySelector('.gcsp-comparison-omits li'));
  const details = stage.querySelector('details'); assert.equal(details.open, false);
  const inside = text(details);
  for (const part of ['comparison-a, comparison-b, comparison-c', 'gcsp-policy-v1', '90da819d8ae5', 'comparison-inputs.sha256.v1', 'fucq136-test', HOLD.resultId, 'hold.buddy.durationSeconds']) assert.ok(inside.includes(part), part);
  assert.equal(root.querySelector('.gcsp-comparison-measure h3'), null);
});

test('a variant win and a baseline win read in the same plain style', async () => {
  const win = structuredClone(HOLD); const effects = win.result.effects;
  effects[0].routes.buddy[0].verdict = 'variant-better'; effects[1].routes.buddy[0].verdict = 'baseline-better';
  const inner = fixtures.experimentFixtureAdapter('experiments-ready');
  const loadAll = async (o) => { const state = await inner.loadAll(o); return { ...state, experiments: state.experiments.map((e) => (e.experimentId === 'hold-sweep' ? { ...e, latest: win } : e)) }; };
  const { root } = await mount('experiments-ready', { overrides: { loadAll } }); await choose(root, 'hold-sweep');
  const arms = [...root.querySelector('.gcsp-comparison-route .gcsp-comparison-measure').querySelectorAll('.gcsp-comparison-arm')];
  assert.match(arms[0].textContent, /15 min better$/); assert.match(arms[1].textContent, /Today's value better$/);
  assert.equal(arms[0].className, arms[1].className); assert.equal(arms[0].firstElementChild.className, arms[1].firstElementChild.className);
});

test('the rerun form is prefilled from the stored result and its hint carries only the stored bounds', async () => {
  const { root } = await mount('experiments-ready'); await choose(root, 'hold-sweep');
  assert.equal(field(root, 'hours').value, '0.25, 24'); assert.equal(field(root, 'basis').value, 'Test basis: an illustrative what-if value.');
  assert.equal(field(root, 'basis').maxLength, 500);
  const label = (id) => root.querySelector(`label[for="${id}"]`).textContent;
  assert.equal(label(field(root, 'hours').id), 'Hold durations, in hours'); assert.equal(label(field(root, 'basis').id), 'Why try these');
  assert.equal(root.querySelector(`#${field(root, 'hours').id}-hint`).textContent, 'Separate with commas. Decimals are fine: 0.25 is 15 minutes. From 15 min to 24 h. Up to 5 values. Not the value used today.');
  assert.equal(submit(root).textContent, 'Run the hold comparison'); assert.equal(submit(root).disabled, false);
});

test('no stored result shows the offline command and, for the hold sweep, the form with a hint that has no bounds', async () => {
  const { root } = await mount('experiments-empty');
  assert.equal(optionOf(root, 'process-only').getAttribute('aria-checked'), 'true');
  assert.match(text(root.querySelector('.gcsp-comparison-stage')), /No stored result yet/);
  assert.equal(root.querySelector('.gcsp-comparison-command').textContent, 'node scripts/gcsp-comparison.mjs --experiment process');
  assert.equal(root.querySelector('.gcsp-comparison-form'), null);
  await choose(root, 'hold-sweep');
  assert.match(root.querySelector('.gcsp-comparison-command').textContent, /--experiment hold-sweep/);
  assert.equal(field(root, 'hours').value, ''); assert.equal(field(root, 'basis').value, '');
  const hint = root.querySelector(`#${field(root, 'hours').id}-hint`).textContent;
  assert.doesNotMatch(hint, /From \d|Up to|Not the value/); assert.match(hint, /service checks the range/);
  assert.equal(submit(root).disabled, false);
});

test('shape checks: positive hours that are whole seconds, no repeats, a reason of at most 500 characters', () => {
  assert.deepEqual(rerun.parseHolds('0.25, 24, 1.5'), { seconds: [900, 86400, 5400] });
  assert.deepEqual(rerun.parseHolds('.5'), { seconds: [1800] });
  for (const bad of ['', ' , ', 'abc', '0', '-1', '1e3', '1,x', '0.0001', '1, 1', '1, 1.0', '99999999999999999999999']) assert.ok(rerun.parseHolds(bad).error, JSON.stringify(bad));
  assert.deepEqual(rerun.checkRerun({ hours: '1', basis: ' Why ' }), { values: [3600], basis: 'Why', errors: [] });
  assert.deepEqual(rerun.checkRerun({ hours: '1', basis: '  ' }).errors.map((e) => e.field), ['basis']);
  assert.deepEqual(rerun.checkRerun({ hours: '1', basis: 'x'.repeat(501) }).errors.map((e) => e.message), [words.ERR_BASIS_LONG]);
  assert.deepEqual(rerun.checkRerun({ hours: '', basis: '' }).errors.map((e) => e.field), ['hours', 'basis']);
});

test('bad input is stopped before any request, shown on the fields and in a focused summary', async () => {
  const { root, calls } = await mount('experiments-ready'); await choose(root, 'hold-sweep');
  await run(root, '', '');
  assert.equal(calls.start.length, 0);
  const summary = root.querySelector('.gcsp-error-summary'); assert.equal(summary.hidden, false);
  assert.equal(document.activeElement, summary.querySelector('h2')); assert.equal(document.activeElement.tabIndex, -1);
  assert.deepEqual([...summary.querySelectorAll('a')].map((a) => a.textContent), ['Hold durations, in hours: Give at least one hold duration.', 'Why try these: Say why these holds are worth trying.']);
  assert.equal(field(root, 'hours').getAttribute('aria-invalid'), 'true'); assert.equal(field(root, 'basis').getAttribute('aria-invalid'), 'true');
  assert.equal(root.querySelector(`#${field(root, 'hours').id}-error`).textContent, 'Give at least one hold duration.');
  summary.querySelector('a').click(); assert.equal(document.activeElement, field(root, 'hours'));
  await run(root, '1, 1', 'x'); assert.equal(calls.start.length, 0); assert.match(text(root.querySelector('.gcsp-error-summary')), /Give each hold only once\./);
  await run(root, '0.0001', 'x'); assert.equal(calls.start.length, 0); assert.match(text(root.querySelector('.gcsp-error-summary')), /not a whole number of seconds/);
  await run(root, '1', 'y'.repeat(501)); assert.equal(calls.start.length, 0);
});

test('a valid run sends exactly the chosen seconds and reason through the start route', async () => {
  const { root, calls } = await mount('job-succeeds', { gate: true }); await choose(root, 'hold-sweep');
  await run(root, ' 1 ', '  Try one hour  ');
  assert.deepEqual(calls.start, [{ experimentId: 'hold-sweep', change: { values: [3600], basis: 'Try one hour' } }]);
  assert.equal(root.querySelector('.gcsp-error-summary').hidden, true);
});

test('running shows the real seeds and steps, keeps the previous result labelled and disables the run button with its reason', async () => {
  const { root, step } = await mount('job-succeeds', { gate: true }); await choose(root, 'hold-sweep');
  await run(root, '1', 'Try one hour');
  const strip = root.querySelector('.gcsp-comparison-job');
  assert.equal(strip.hidden, false); assert.equal(strip.querySelector('[role="status"]').textContent.includes('Hold duration: running. Trying 1 h.'), true);
  assert.match(text(strip), /Seeds done: 0 of 3\. Steps: 0 of 12\./);
  const bar = strip.querySelector('progress'); assert.equal(bar.max, 12); assert.equal(bar.value, 0);
  assert.equal(strip.querySelector(`label[for="${bar.id}"]`).textContent, 'Seeds done: 0 of 3. Steps: 0 of 12.');
  assert.equal(document.activeElement, strip);
  assert.equal(submit(root).disabled, true); assert.match(text(root.querySelector('.gcsp-comparison-actions')), /A comparison is running\./);
  assert.match(stamp(root).textContent, /^Previous result, made 8 Nov 2026.*Still the latest stored\.$/);
  await step();
  assert.match(text(strip), /Seeds done: 1 of 3\. Steps: 4 of 12\./); assert.equal(strip.querySelector('progress').value, 4);
  assert.match(stamp(root).textContent, /^Previous result/); assert.doesNotMatch(text(root), /New result/);
});

test('success reads the result back and shows it as new only when the result ids match', async () => {
  const { root, calls, step } = await mount('job-succeeds', { gate: true }); await choose(root, 'hold-sweep');
  await run(root, '1', 'Try one hour'); await step(); await step(); assert.deepEqual(calls.loadResult, []);
  await step();
  assert.deepEqual(calls.loadResult, ['hold-sweep']);
  assert.match(stamp(root).textContent, /^New result, made 9 Nov 2026, 12:05/); assert.equal(document.activeElement, stamp(root));
  assert.match(text(root.querySelector('.gcsp-comparison-job')), /New result stored and read back\./);
  assert.match(optionOf(root, 'hold-sweep').textContent, /stored 9 Nov 2026/);
  assert.deepEqual([...root.querySelectorAll('.gcsp-comparison-route .gcsp-comparison-measure')[0].querySelectorAll('.gcsp-range-bar-label')].map((n) => n.textContent), ['2 h (today)', '1 h']);
  assert.match(text(root.querySelector('details')), /hold-sweep-comparison-fixture-rerun/);
  assert.equal(submit(root).disabled, false); assert.equal(root.querySelector('.gcsp-comparison-job progress').hidden, true);
  assert.equal(field(root, 'hours').value, '1');
});

test('a read-back with a different result id, or none, keeps the previous result labelled', async () => {
  for (const readBack of [async () => adapterMod.resultOutcomeToState(200, { status: 'ok', value: HOLD }), async () => adapterMod.resultOutcomeToState(503, { status: 'unavailable' }),
    async () => adapterMod.resultOutcomeToState(404, { status: 'not-found' })]) {
    document.body.replaceChildren();
    const { root, step } = await mount('job-succeeds', { gate: true, overrides: { loadResult: readBack } }); await choose(root, 'hold-sweep');
    await run(root, '1', 'Try one hour'); await step(); await step(); await step();
    assert.match(stamp(root).textContent, /^Previous result, made 8 Nov 2026/); assert.doesNotMatch(text(root), /New result/);
    assert.equal(root.querySelector('.gcsp-comparison-job [role="alert"]').textContent, 'The run finished but its result could not be read back. Reload to try again.');
    assert.equal(submit(root).disabled, false);
  }
});

test('a failed or stopped run shows its reason, stores nothing and keeps the previous result', async () => {
  for (const [name, title, reason] of [['job-fails', 'The hold comparison failed', 'The comparison used more than its 128 MB memory allowance and was stopped.'],
    ['job-interrupted', 'The hold comparison stopped before it finished', 'The backend stopped before the comparison finished.']]) {
    document.body.replaceChildren();
    const { root, calls, step } = await mount(name, { gate: true }); await choose(root, 'hold-sweep');
    await run(root, '1', 'Try one hour'); await step(); await step();
    const alert = root.querySelector('.gcsp-comparison-job [role="alert"]');
    assert.equal(alert.hidden, false); assert.equal(alert.querySelector('h3').textContent, title); assert.ok(text(alert).includes(reason));
    assert.ok(text(alert).includes('No result was stored. The result below is still the latest stored.'));
    assert.match(stamp(root).textContent, /^Previous result, made 8 Nov 2026/); assert.doesNotMatch(text(root), /New result/);
    assert.deepEqual(calls.loadResult, []); assert.equal(submit(root).disabled, false); assert.equal(field(root, 'hours').value, '1');
    assert.equal(root.querySelector('.gcsp-comparison-job progress').hidden, true);
  }
});

test('with no previous result a running job says so and a failed one says nothing was stored', async () => {
  let release; const pending = new Promise((resolve) => { release = resolve; });
  const failed = jobBody('failed', { finishedAt: '2026-11-09T12:05:00.000Z', reason: 'It stopped.' });
  const { root } = await mount('experiments-empty', { overrides: {
    start: async () => adapterMod.startOutcomeToState(202, { status: 'pending', value: jobBody('running') }),
    readJob: (q) => (q?.jobId ? pending.then(() => okJob(failed)) : Promise.resolve(noJob())) } });
  await choose(root, 'hold-sweep'); await run(root, '1', 'Try one hour');
  assert.match(text(root.querySelector('.gcsp-comparison-stage')), /No previous result/); assert.doesNotMatch(text(root.querySelector('.gcsp-comparison-stage')), /No stored result yet/);
  release(); await until(() => root.querySelector('.gcsp-comparison-job [role="alert"]:not([hidden])'));
  const alert = text(root.querySelector('.gcsp-comparison-job [role="alert"]'));
  assert.ok(alert.includes('It stopped.')); assert.ok(alert.includes('No result was stored.')); assert.doesNotMatch(alert, /still the latest/);
  assert.match(text(root.querySelector('.gcsp-comparison-stage')), /No stored result yet/);
});

test('server reasons land on the duration and reason fields, and other fields go to the summary only', async () => {
  const reasons = [{ field: 'change.values', key: 'hold.buddy.durationSeconds', reason: 'Too many holds.' }, { field: 'change.basis', key: null, reason: 'Say why.' },
    { field: 'seeds', key: null, reason: 'Seeds are not chosen here.' }];
  const { root } = await mount('start-invalid', { overrides: { start: async () => adapterMod.startOutcomeToState(400, { status: 'invalid', reasons }) } });
  await choose(root, 'hold-sweep'); await run(root, '1', 'x');
  assert.equal(root.querySelector(`#${field(root, 'hours').id}-error`).textContent, 'Too many holds.');
  assert.equal(root.querySelector(`#${field(root, 'basis').id}-error`).textContent, 'Say why.');
  assert.deepEqual([...root.querySelectorAll('.gcsp-error-summary a')].map((a) => a.textContent),
    ['Hold durations, in hours: Too many holds.', 'Why try these: Say why.', 'Seeds are not chosen here.']);
  assert.equal(document.activeElement, root.querySelector('.gcsp-error-summary h2')); assert.equal(submit(root).disabled, false);
  assert.equal(field(root, 'hours').value, '1');
  const plain = await mount('start-invalid'); await choose(plain.root, 'hold-sweep'); await run(plain.root, '1', 'x');
  assert.match(text(plain.root.querySelector('.gcsp-error-summary')), /Give no more holds than the policy allows/);
  const empty = await mount('start-invalid', { overrides: { start: async () => adapterMod.startOutcomeToState(400, { status: 'invalid' }) } });
  await choose(empty.root, 'hold-sweep'); await run(empty.root, '1', 'x'); assert.match(text(empty.root.querySelector('.gcsp-error-summary')), /did not accept these values/);
});

test('a conflict shows the reason and watches the running job', async () => {
  const { root, calls } = await mount('start-conflict', { gate: false, overrides: {
    readJob: async (q) => { calls.readJob.push(q); return q?.jobId ? okJob(jobBody('running')) : noJob(); } } });
  await choose(root, 'hold-sweep'); await run(root, '1', 'x');
  assert.ok(calls.readJob.some((q) => q?.jobId === JOB));
  const strip = root.querySelector('.gcsp-comparison-job');
  assert.match(text(strip), /A comparison is already running\. Wait for it to finish\./); assert.match(text(strip), /Hold duration: running\./);
  assert.match(text(strip), /Steps: 4 of 12/); assert.equal(submit(root).disabled, true);
});

test('the start-conflict fixture itself watches the job its 409 names, never losing contact', async () => {
  const { root, calls } = await mount('start-conflict');
  assert.equal(calls.readJob.length, 1); assert.doesNotMatch(text(root), /running\./);
  await choose(root, 'hold-sweep'); await run(root, '1', 'x');
  const strip = root.querySelector('.gcsp-comparison-job');
  await until(() => /Steps: 12 of 18/.test(text(strip)));
  assert.ok(calls.readJob.some((q) => q?.jobId === JOB)); assert.deepEqual(calls.start, [{ experimentId: 'hold-sweep', change: { values: [3600], basis: 'x' } }]);
  assert.match(text(strip), /A comparison is already running\. Wait for it to finish\./); assert.match(text(strip), /Hold duration: running\./);
  assert.doesNotMatch(text(root), /Lost contact/); assert.equal(submit(root).disabled, true);
});

test('a refused start names who can start one, an unavailable start is retryable, and neither polls', async () => {
  const refused = await mount('start-refused'); await choose(refused.root, 'hold-sweep'); await run(refused.root, '1', 'x');
  const message = refused.root.querySelector('.gcsp-comparison-form [role="alert"]');
  assert.equal(message.textContent, 'Only the scheme ordering lead or the presenter can start a comparison.'); assert.equal(message.hidden, false);
  assert.equal(submit(refused.root).disabled, false); assert.equal(refused.calls.readJob.length, 1);
  const down = await mount('experiments-ready', { overrides: { start: async () => adapterMod.startOutcomeToState(503, { status: 'unavailable', reason: 'The store is down.' }) } });
  await choose(down.root, 'hold-sweep'); await run(down.root, '1', 'x');
  assert.equal(down.root.querySelector('.gcsp-comparison-form [role="alert"]').textContent, 'The store is down.'); assert.equal(submit(down.root).disabled, false);
  const bare = await mount('experiments-ready', { overrides: { start: async () => adapterMod.startOutcomeToState(503, { status: 'unavailable' }) } });
  await choose(bare.root, 'hold-sweep'); await run(bare.root, '1', 'x');
  assert.equal(bare.root.querySelector('.gcsp-comparison-form [role="alert"]').textContent, 'The comparison could not be started. Try again in a moment.');
  assert.equal(field(bare.root, 'hours').value, '1'); assert.equal(bare.calls.readJob.length, 1);
});

test('a refused, unavailable or lapsed list shows its screen, and Retry reads again', async () => {
  const refused = await mount('experiments-refused');
  assert.equal(refused.root.querySelector('.gcsp-comparison').dataset.state, 'refused'); assert.match(text(refused.root), /Only the scheme ordering lead or the presenter can see the route comparison\./);
  assert.equal(refused.root.querySelector('.gcsp-comparison-picker'), null);
  const down = await mount('experiments-unavailable');
  assert.equal(down.root.querySelector('.gcsp-comparison').dataset.state, 'unavailable'); assert.match(text(down.root), /could not be loaded/);
  const retry = [...down.root.querySelectorAll('button')].find((b) => b.textContent === 'Retry'); retry.click(); await settle(); assert.equal(down.calls.loadAll, 2);
  const lapsed = await mount('experiments-ready', { overrides: { loadAll: async () => ({ status: 'access-required' }) } });
  assert.equal(lapsed.root.querySelector('.gcsp-comparison').dataset.state, 'access-required'); assert.match(text(lapsed.root), /Demo access needed/);
  const none = await mount('experiments-ready', { overrides: { loadAll: async () => ({ status: 'ready', activePolicyVersion: null, experiments: [] }) } });
  assert.equal(none.root.querySelector('.gcsp-comparison').dataset.state, 'unavailable');
});

test('an older policy keeps the notice, the result and the form', async () => {
  const { root } = await mount('experiments-old-policy'); await choose(root, 'hold-sweep');
  const notice = root.querySelector('.gcsp-comparison-stage .gcsp-comparison-notice');
  assert.equal(notice.querySelector('h3').textContent, 'Older policy version'); assert.match(text(notice), /Made under policy gcsp-policy-v1\. The active policy is gcsp-policy-v2\./);
  assert.ok(root.querySelector('.gcsp-comparison-route')); assert.ok(root.querySelector('.gcsp-comparison-form'));
});

test('a job that is running when the panel opens is selected, shown and polled', async () => {
  const { root, calls, step } = await mount('job-running', { gate: true });
  assert.equal(optionOf(root, 'hold-sweep').getAttribute('aria-checked'), 'true');
  assert.deepEqual(calls.readJob[0], {}); assert.match(text(root.querySelector('.gcsp-comparison-job')), /Hold duration: running\. Trying 1 h, 3 h\./);
  assert.match(text(root.querySelector('.gcsp-comparison-job')), /Seeds done: 1 of 3\. Steps: 6 of 18\./);
  assert.match(stamp(root).textContent, /^Previous result/); assert.equal(submit(root).disabled, true);
  await step(); assert.equal(calls.readJob.at(-1).jobId, JOB); assert.match(text(root.querySelector('.gcsp-comparison-job')), /Steps: 12 of 18/);
});

test('the last failed run is noted after a reload, and an unreadable or absent last job adds nothing', async () => {
  const failed = jobBody('failed', { finishedAt: '2026-11-09T12:05:00.000Z', reason: 'The comparison worker stopped before it finished.' });
  const { root } = await mount('experiments-ready', { overrides: { readJob: async () => okJob(failed) } });
  assert.equal(root.querySelector('.gcsp-comparison-job').hidden, true); await choose(root, 'hold-sweep');
  assert.match(root.querySelector('.gcsp-comparison-lastrun').textContent, /^Last run 9 Nov 2026, 12:05.*: The comparison worker stopped before it finished\.$/);
  assert.match(stamp(root).textContent, /^Stored result/); assert.equal(submit(root).disabled, false);
  await choose(root, 'process-only'); assert.equal(root.querySelector('.gcsp-comparison-lastrun'), null);
  for (const reply of [noJob(), adapterMod.jobOutcomeToState(403, {}), adapterMod.jobOutcomeToState(503, {})]) {
    document.body.replaceChildren();
    const other = await mount('experiments-ready', { overrides: { readJob: async () => reply } }); await choose(other.root, 'hold-sweep');
    assert.equal(other.root.querySelector('.gcsp-comparison-lastrun'), null); assert.equal(other.root.querySelector('.gcsp-comparison').dataset.state, 'ready');
  }
});

test('losing contact with the job says so, keeps it running on screen and recovers when contact returns', async () => {
  let down = true;
  const { root } = await mount('job-succeeds', { overrides: {
    readJob: async (q) => { if (!q?.jobId) return noJob(); return down ? adapterMod.jobOutcomeToState(503, { status: 'unavailable' }) : okJob(jobBody('running')); } } });
  await choose(root, 'hold-sweep'); await run(root, '1', 'x');
  await until(() => /Lost contact/.test(root.textContent));
  assert.equal(root.querySelector('.gcsp-comparison-job [role="alert"]').textContent, 'Lost contact with the comparison. Reload to check it.');
  assert.match(text(root.querySelector('.gcsp-comparison-job')), /Hold duration: running\./); assert.equal(submit(root).disabled, true);
  down = false; await until(() => !/Lost contact/.test(root.textContent)); assert.equal(root.querySelector('.gcsp-comparison-job [role="alert"]').hidden, true);
  const refused = await mount('job-succeeds', { overrides: { readJob: async (q) => (q?.jobId ? adapterMod.jobOutcomeToState(403, { status: 'forbidden' }) : noJob()) } });
  await choose(refused.root, 'hold-sweep'); await run(refused.root, '1', 'x'); await until(() => /Lost contact/.test(refused.root.textContent));
  const seen = refused.calls.readJob.length; await settle(); await settle(); assert.equal(refused.calls.readJob.length, seen);
});

test('teardown stops polling and ignores late answers', async () => {
  const { root, teardown, calls } = await mount('job-running');
  await until(() => calls.readJob.length > 3);
  teardown(); const seen = calls.readJob.length; await settle(); await settle();
  assert.equal(calls.readJob.length, seen); assert.equal(root.children.length, 0);
  const gated = await mount('job-succeeds', { gate: true }); await choose(gated.root, 'hold-sweep'); await run(gated.root, '1', 'x');
  gated.teardown(); await tick(5); assert.equal(gated.root.children.length, 0);
});

test('Reload while a job runs reads the list and the job again without a second poll loop', async () => {
  const { root, calls } = await mount('job-running', { pollMs: 5 });
  await tick(30); const reload = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Reload');
  reload.click(); await settle(); assert.equal(calls.loadAll, 2); assert.equal(calls.readJob.filter((q) => !q?.jobId).length, 2);
  const before = calls.readJob.length; await tick(60); const gained = calls.readJob.length - before;
  assert.ok(gained <= 14, `one loop at 5 ms polls about 12 times in 60 ms, saw ${gained}`);
});

test('every experiment state, before and after a run, has no em dash, inline handler or script', async () => {
  assert.deepEqual([...fixtures.EXPERIMENT_FIXTURE_NAMES], ['experiments-ready', 'experiments-empty', 'experiments-old-policy', 'experiments-refused', 'experiments-unavailable',
    'job-running', 'job-succeeds', 'job-fails', 'job-interrupted', 'start-invalid', 'start-conflict', 'start-refused']);
  for (const name of fixtures.EXPERIMENT_FIXTURE_NAMES) {
    document.body.replaceChildren();
    const { root } = await mount(name, { pollMs: 60000 });
    const check = (when) => {
      const html = root.innerHTML;
      assert.ok(!html.includes('—'), `${name} ${when} has an em dash`); assert.ok(!/\son[a-z]+\s*=/i.test(html), `${name} ${when} has an inline handler`); assert.ok(!/<script/i.test(html), `${name} ${when} has a script`);
    };
    check('loaded');
    for (const id of ['order-mix', 'points', 'hold-sweep', 'process-only']) if (optionOf(root, id)) { await choose(root, id); check(id); }
    if (optionOf(root, 'hold-sweep')) { await choose(root, 'hold-sweep'); await run(root, '1', 'Try one hour'); check('run'); await run(root, 'x', ''); check('invalid'); }
  }
});

test('the element takes an experiment fixture name, and the harness and gallery know every name', async () => {
  element.defineGcspGregComparison(window.customElements);
  const node = document.createElement('gcsp-greg-comparison'); node.setAttribute('fixture', 'experiments-ready'); document.body.append(node); await settle();
  assert.equal(node.querySelector('.gcsp-comparison').dataset.state, 'ready'); assert.ok(node.querySelector('.gcsp-comparison-picker')); node.remove();
  const old = document.createElement('gcsp-greg-comparison'); old.setAttribute('fixture', 'buddy-better'); document.body.append(old); await settle();
  assert.equal(old.querySelector('.gcsp-comparison-picker'), null); old.remove();
  const source = (file) => readFile(new URL(file, import.meta.url), 'utf8');
  assert.match(await source('../../blocks/gcsp/greg/harness.js'), /EXPERIMENT_FIXTURE_NAMES\.includes\(comparison\)/);
  const gallery = await source('../../blocks/gcsp/greg/comparison/gallery.js');
  assert.match(gallery, /\.\.\.EXPERIMENT_FIXTURE_NAMES/);
  for (const name of ['experiments-ready', 'experiments-empty', 'experiments-old-policy', 'job-running', 'job-fails']) assert.ok(gallery.includes(`'${name}'`), name);
});

test('an adapter with only load keeps the process-only panel', async () => {
  const root = host(); teardowns.push(panel.mountGregComparison(root, { adapter: fixtures.comparisonFixtureAdapter('buddy-better') })); await settle();
  assert.equal(root.querySelector('.gcsp-comparison-picker'), null); assert.ok(root.querySelector('.gcsp-comparison-measure h3'));
});
