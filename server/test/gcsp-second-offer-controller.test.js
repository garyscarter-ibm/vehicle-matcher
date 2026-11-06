import test from 'node:test';
import assert from 'node:assert/strict';
import { createFollowupController } from '../../blocks/gcsp/offer-followup/followup-controller.js';
import { createFollowupHttpAdapter } from '../../blocks/gcsp/offer-followup/http-adapter.js';

const decisionId = 'decline-one';
const question = (kind = 'options') => ({ status: 'ok', value: { schemaVersion: 1, state: 'question', decisionId, briefVersion: 1,
  question: { schemaVersion: 1, questionVersion: 'question-one', policyVersion: 'policy-one', prompt: 'Which body style would you prefer?',
    currentValue: kind === 'slider' ? 50 : kind === 'equipment' ? ['towbar'] : 'saloon', control: kind === 'slider'
      ? { kind, minimum: 0, maximum: 100, unit: 'percent' } : kind === 'equipment'
        ? { kind, maximumItems: 3, maximumItemLength: 20 }
        : { kind, options: [{ value: 'saloon', label: 'Saloon' }, { value: 'estate', label: 'Estate' }] } } } });
const saved = () => ({ schemaVersion: 1, state: 'change-saved', decisionId, briefVersion: 2, policyVersion: 'policy-one',
  change: { path: 'preferences.body.value', value: 'estate' }, event: { receiptReference: `brief-change:${'a'.repeat(64)}`,
    eventType: 'brief-changed', briefVersion: 2, occurredAt: '2026-11-06T00:00:00Z' } });
function setup(overrides = {}) {
  const reads = []; const confirms = []; let serial = 0;
  const transport = { read: async (input) => { reads.push(input); return question(); },
    confirm: async (input) => { confirms.push(input); return { status: 'ok', value: saved() }; }, ...overrides };
  const controller = createFollowupController({ decisionId, transport, createCommandId: () => `command-${++serial}` });
  return { controller, reads, confirms };
}

test('question load and local choice write nothing; only explicit confirmation sends the five fields', async () => {
  const { controller, reads, confirms } = setup();
  await controller.refresh(); assert.deepEqual(reads, [{ decisionId }]); assert.equal(confirms.length, 0);
  assert.equal(controller.choose('estate').status, 'ok'); assert.equal(confirms.length, 0);
  await controller.confirm(); assert.deepEqual(confirms, [{ commandId: 'command-1', decisionId, expectedBriefVersion: 1,
    questionVersion: 'question-one', value: 'estate' }]);
  assert.equal(controller.snapshot().state, 'change-saved'); assert.equal(controller.snapshot().savedChange.briefVersion, 2);
});

test('unchanged and invalid choices cannot confirm for options, slider or equipment', async () => {
  for (const [kind, invalid, valid] of [['options', 'flying-car', 'estate'], ['slider', 101, 70], ['equipment', ['towbar', 'towbar'], []]]) {
    const { controller, confirms } = setup({ read: async () => question(kind) }); await controller.refresh();
    assert.equal(controller.choose(question(kind).value.question.currentValue).status, 'invalid'); await controller.confirm();
    assert.equal(controller.choose(invalid).status, 'invalid'); await controller.confirm(); assert.equal(confirms.length, 0);
    assert.equal(controller.choose(valid).status, 'ok');
  }
});

test('uncertain retries retain the identical command even when a status read still returns the question', async () => {
  const commands = []; let reads = 0;
  const { controller } = setup({ read: async () => { reads += 1; return question(); }, confirm: async (input) => {
    commands.push(input); if (commands.length === 1) throw Error('response lost'); return { status: 'ok', value: saved() };
  } });
  await controller.refresh(); controller.choose('estate'); await controller.confirm();
  assert.equal(controller.snapshot().state, 'confirmation-uncertain'); assert.equal(controller.choose('saloon').status, 'conflict');
  await controller.refresh(); assert.equal(reads, 2); assert.equal(controller.snapshot().state, 'confirmation-uncertain');
  await controller.confirm(); assert.deepEqual(commands[1], commands[0]); assert.equal(controller.snapshot().state, 'change-saved');
});

test('reload preserves a committed saved receipt when evaluation is unavailable', async () => {
  const { controller } = setup({ read: async () => ({ status: 'unavailable', savedChange: saved() }) });
  await controller.refresh(); const result = controller.snapshot();
  assert.equal(result.state, 'unavailable'); assert.deepEqual(result.savedChange, saved()); assert.match(result.error, /change is saved/);
});

test('missing evaluation and invented waiting or no-match envelopes fail closed', async () => {
  for (const state of ['waiting', 'no-match']) {
    const { controller } = setup({ read: async () => ({ status: 'ok', value: { schemaVersion: 1, state, decisionId,
      savedChange: saved(), evaluation: { eventId: 'invented', briefVersion: 2 } } }) });
    await controller.refresh(); assert.equal(controller.snapshot().state, 'unavailable');
  }
});

test('ready requires a distinct offer and the current quote brief; malformed requirement rows fail closed', async () => {
  const ready = { schemaVersion: 1, state: 'ready', decisionId, savedChange: saved(), comparison: {
    currentBriefVersion: 2, requirements: [], previous: { offer: { offerId: 'first' } }, next: { offer: { offerId: 'second', quote: { briefVersion: 2 } } } } };
  const { controller } = setup({ read: async () => ({ status: 'ok', value: structuredClone(ready) }) });
  await controller.refresh(); assert.equal(controller.snapshot().state, 'ready');
  for (const mutate of [(v) => { v.comparison.next.offer.offerId = 'first'; },
    (v) => { v.comparison.next.offer.quote.briefVersion = 1; }, (v) => { v.comparison.requirements = [null]; }]) {
    const v = structuredClone(ready); mutate(v); const { controller: bad } = setup({ read: async () => ({ status: 'ok', value: v }) });
    await bad.refresh(); assert.equal(bad.snapshot().state, 'unavailable');
  }
});

test('stale version requires a refresh; forbidden and earlier-run responses do not retain account data', async () => {
  for (const [status, state] of [['stale-version', 'refresh-required'], ['conflict', 'refresh-required'], ['forbidden', 'forbidden'], ['stale-run', 'stale-run']]) {
    const { controller } = setup({ confirm: async () => ({ status }) }); await controller.refresh(); controller.choose('estate');
    await controller.confirm(); assert.equal(controller.snapshot().state, state); assert.equal(controller.snapshot().canConfirm, false);
  }
});

test('authentication loss clears a saved receipt while non-auth source failure preserves it', async () => {
  for (const status of ['unknown-principal', 'unavailable']) {
    let response = question(); const { controller } = setup({ read: async () => response });
    await controller.refresh(); controller.choose('estate'); await controller.confirm();
    assert.deepEqual(controller.snapshot().savedChange, saved()); response = { status }; await controller.refresh();
    const result = controller.snapshot();
    assert.equal(result.state, status === 'unknown-principal' ? 'forbidden' : 'unavailable');
    assert.deepEqual(result.savedChange, status === 'unknown-principal' ? null : saved());
    assert.equal(result.canConfirm, false); assert.equal(result.question, null);
  }
});

test('duplicate confirmation is suppressed and teardown ignores late server replies', async () => {
  let finish; let calls = 0; const { controller } = setup({ confirm: () => { calls += 1; return new Promise((resolve) => { finish = resolve; }); } });
  await controller.refresh(); controller.choose('estate'); const pending = controller.confirm(); await controller.confirm();
  assert.equal(calls, 1); controller.destroy(); finish({ status: 'ok', value: saved() }); await pending;
  assert.notEqual(controller.snapshot().state, 'change-saved');
});

test('snapshots and observers cannot mutate the server question or retained command', async () => {
  const response = question(); const { controller, confirms } = setup({ read: async () => response });
  controller.subscribe((value) => { if (value.question) value.question.questionVersion = 'tampered'; });
  await controller.refresh(); response.value.question.questionVersion = 'mutated-after-read';
  controller.snapshot().question.control.options[1].value = 'tampered'; controller.choose('estate'); await controller.confirm();
  assert.equal(confirms[0].questionVersion, 'question-one');
});

test('malformed questions and malformed success receipts cannot produce a confirmed save', async () => {
  const bad = question(); bad.value.question.control.options.push({ value: 'saloon', label: 'Duplicate' });
  const { controller: invalid } = setup({ read: async () => bad }); await invalid.refresh(); assert.equal(invalid.snapshot().state, 'unavailable');
  const { controller } = setup({ confirm: async () => { const value = saved(); delete value.event.receiptReference; value.event.eventId = 'raw-internal-id'; return { status: 'ok', value }; } });
  await controller.refresh(); controller.choose('estate'); await controller.confirm();
  assert.equal(controller.snapshot().state, 'confirmation-uncertain'); assert.equal(controller.snapshot().savedChange, null);
});

test('HTTP adapter sends strict selectors and confirmation with session cookies and no-store', async () => {
  const calls = []; const adapter = createFollowupHttpAdapter({ fetchImpl: async (url, init) => {
    calls.push({ url, init }); return { ok: true, json: async () => ({ status: 'ok', value: saved() }) };
  } });
  await adapter.read({ decisionId: 'decline&one' });
  const body = { commandId: 'command-one', decisionId, expectedBriefVersion: 1, questionVersion: 'question-one', value: [] };
  await adapter.confirm(body); assert.match(calls[0].url, /decisionId=decline%26one$/);
  assert.equal(calls[1].url, '/api/gcsp/offer-followup/confirm'); assert.deepEqual(JSON.parse(calls[1].init.body), body);
  for (const { init } of calls) { assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store'); }
});

test('HTTP adapter rejects extra authority and incomplete bodies without fetching', async () => {
  let calls = 0; const adapter = createFollowupHttpAdapter({ fetchImpl: async () => { calls += 1; throw Error('must not fetch'); } });
  for (const input of [{}, { decisionId, employeeId: 'forged' }, { decisionId: '' }]) assert.equal((await adapter.read(input)).status, 'invalid');
  const input = { commandId: 'command', decisionId, expectedBriefVersion: 1, questionVersion: 'question', value: 'estate' };
  for (const extra of ['path', 'employeeId', 'runId', 'reasonCode', 'policyVersion']) assert.equal((await adapter.confirm({ ...input, [extra]: 'forged' })).status, 'invalid');
  assert.equal((await adapter.confirm({ ...input, value: { path: 'forged' } })).status, 'invalid');
  assert.equal((await adapter.confirm({ commandId: 'command' })).status, 'invalid'); assert.equal(calls, 0);
});

test('HTTP abort, malformed JSON and unsuccessful HTTP success envelopes remain unavailable', async () => {
  const abort = new AbortController(); abort.abort(); let calls = 0;
  const cancelled = createFollowupHttpAdapter({ signal: abort.signal, fetchImpl: async () => { calls += 1; } });
  assert.equal((await cancelled.read({ decisionId })).status, 'unavailable'); assert.equal(calls, 0);
  for (const fetchImpl of [async () => { throw Error('network'); }, async () => ({ json: async () => { throw Error('invalid JSON'); } }),
    async () => ({ ok: false, json: async () => ({ status: 'ok', value: saved() }) })]) {
    assert.equal((await createFollowupHttpAdapter({ fetchImpl }).read({ decisionId })).status, 'unavailable');
  }
});
