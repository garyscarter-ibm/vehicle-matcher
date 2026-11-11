import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createBriefService } from '../gcsp/brief/index.js';
import { createBriefEditorService } from '../gcsp/brief/editor.js';
import { createActivityService } from '../gcsp/brief/activity.js';
import { createManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { fact, stock, providerValue } from './helpers/employee-recommendation.js';
import { startHttpServer } from './helpers/employee-recommendation-http.js';
import { createBriefTransport } from '../../blocks/gcsp/brief/brief-transport.js';
import { createActivityHttpAdapter } from '../../blocks/gcsp/activity/activity-http.js';
import { createActivityController } from '../../blocks/gcsp/activity/activity-controller.js';
import { activityEvents } from '../../blocks/gcsp/activity/activity-copy.js';

const KEY = 'brief.engagement.v1';
let serial = 0;

async function setup(t, { policy = createPolicyService() } = {}) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  await repository.open(); t.after(() => repository.close());
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'buddy-engagement-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T12:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T12:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context;
  const f = { store, repository, policy, clock, identity, presenter, acting, context };
  assert.equal((await seedManualDemoContext(f)).status, 'ok');
  f.account = createManualContextService({ ...f, ports: createRepositoryManualPorts(f) });
  f.brief = createBriefService(f);
  const now = (await clock.now(context)).value.now;
  f.source = { ...providerValue([stock(1, { equipment: fact({ towbar: true }) })]),
    runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId };
  f.source.stock.forEach((car) => { car.availability.availableFrom = now; });
  f.provider = { async resolve() { return { status: 'ok', value: structuredClone(f.source) }; } };
  f.editor = createBriefEditorService(f);
  f.activity = createActivityService(f);
  f.http = await startHttpServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspBrief: f.brief, gcspBriefEditor: f.editor, gcspActivity: f.activity,
    gcspVehicleEvidence: { lookup: { resolve: async () => ({ status: 'unavailable' }) } } });
  t.after(() => f.http.close());
  f.contractId = (await f.account.readAccount(context)).value.currentContract.contractId;
  return f;
}

const call = (f, path, body) => f.http.request(`/api/gcsp/${path}`, { session: f.acting, ...(body === undefined ? {} : { body }) });
const view = async (f) => { const r = await call(f, 'brief/editor'); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.value; };
const versions = async (f) => { const v = await view(f); return { expectedBriefVersion: v.initial.briefVersion, expectedDraftVersion: v.initial.draftVersion }; };
// Saves one patch at the editor's current versions, as the browser controller does after a reload.
const save = async (f, changes, extra = {}) => call(f, 'brief/preferences', { commandId: `save-${++serial}`, ...(await versions(f)), changes, ...extra });
const saveOk = async (f, changes, extra) => { const r = await save(f, changes, extra); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.value; };
const engageBody = async (f, commandId = `engage-${++serial}`) => ({ commandId, ...(await versions(f)) });
const engage = async (f, commandId) => call(f, 'brief/engage', await engageBody(f, commandId));
const disengage = async (f, commandId) => call(f, 'brief/disengage', await engageBody(f, commandId));
const briefs = (f) => f.store.state.tables.briefs.filter((b) => b.employeeId === f.context.employeeId).sort((a, b) => a.briefVersion - b.briefVersion);
const changes = (f) => f.store.state.tables.event_receipts.filter((r) => r.consumerId === 'brief:changes').sort((a, b) => a.outcome.value.briefVersion - b.outcome.value.briefVersion);
const operations = (f) => changes(f).map((r) => r.outcome.value.operation);
const permission = async (f) => (await call(f, 'activity')).json.value;
// The same predicate allocation uses to pick the briefs it searches for (server/gcsp/allocation/index.js).
const selectable = (f) => { const b = briefs(f).at(-1); return Boolean(b && b.buddy?.searchConsent === true && b.buddy.paused === false); };
const three = { body: { value: ['saloon', 'estate'] }, sportiness: { value: 50 }, economy: { value: 50 } };
const engagedFixture = async (t, options) => {
  const f = await setup(t, options);
  await saveOk(f, three);
  const out = await engage(f); assert.equal(out.status, 200, JSON.stringify(out.json));
  return f;
};

test('public legacy confirmation cannot engage a sparse brief, and raw draft minimum loss disengages', async (t) => {
  const f = await setup(t);
  const sparse = { schemaVersion: 1, preferences: {}, essentials: {} };
  const draft = await call(f, 'brief/draft', { commandId: 'legacy-sparse', ...(await versions(f)), brief: sparse });
  assert.equal(draft.status, 200, JSON.stringify(draft.json));
  const confirm = await call(f, 'brief/confirm', { commandId: 'legacy-confirm', ...(await versions(f)), consent: { search: true, hold: true } });
  assert.equal(confirm.status, 400, `Confirmation returned ${confirm.json.status}; sparse grants must be refused.`);
  assert.equal(confirm.json.code, 'engagement-minimum');
  assert.equal(confirm.json.remaining, 3);
  assert.equal(briefs(f).length, 0);
  const g = await engagedFixture(t);
  const removed = await call(g, 'brief/draft', { commandId: 'legacy-remove', ...(await versions(g)), brief: sparse });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(removed.json.value.confirmed.transition, 'minimum-lost');
  assert.equal(briefs(g).at(-1).buddy.searchConsent, false);
  assert.equal(briefs(g).at(-1).buddy.holdConsent, false);
});

test('legacy public confirmations accept binary grants, gate promoted drafts, and reject split grants', async (t) => {
  const f = await setup(t); await saveOk(f, three);
  const start = await versions(f);
  const partial = await call(f, 'brief/confirm', { commandId: 'split', ...start, consent: { search: true, hold: false } });
  assert.equal(partial.status, 400);
  const first = await call(f, 'brief/confirm', { commandId: 'old-form-on', ...start, consent: { search: true, hold: true } });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const input = (await view(f)).initial.brief;
  const saved = await call(f, 'brief/draft', { commandId: 'old-form-edit', ...(await versions(f)), brief: input });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.value.confirmed.briefVersion, 2);
  const off = await call(f, 'brief/confirm', { commandId: 'old-form-off', ...(await versions(f)), consent: { search: false, hold: false } });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.equal(off.json.value.brief.briefVersion, 3);
  assert.deepEqual([off.json.value.activity.canSearch, off.json.value.activity.canHold], [false, false]);
  assert.deepEqual((await call(f, 'brief/confirm', { commandId: 'old-form-off', expectedBriefVersion: 2, expectedDraftVersion: saved.json.value.draftVersion, consent: { search: false, hold: false } })).json, off.json);
});

test('fewer than three considered categories are refused with the remaining count and nothing is written', async (t) => {
  const f = await setup(t);
  await saveOk(f, { body: { value: ['saloon', 'estate'] }, sportiness: { value: 50 } });
  const before = structuredClone(f.store.state.tables);
  const out = await engage(f);
  assert.equal(out.status, 400, JSON.stringify(out.json));
  assert.equal(out.json.status, 'invalid'); assert.equal(out.json.code, 'engagement-minimum');
  assert.deepEqual([out.json.remaining, out.json.considered, out.json.minimumCategories], [1, 2, 3]);
  assert.deepEqual(out.json.reasons, [{ field: 'categories', reason: 'Choose 1 more category or turn on Same again to engage Buddy.' }]);
  assert.deepEqual(f.store.state.tables.briefs, before.briefs);
  assert.deepEqual(f.store.state.tables.event_receipts.filter((r) => r.consumerId === 'brief:changes'), []);
  // Two more missing reads as plural; a policy default or an unchosen Fuel never counts.
  const g = await setup(t);
  await saveOk(g, { body: { value: ['saloon'] } });
  const plural = await engage(g);
  assert.equal(plural.json.remaining, 2);
  assert.equal(plural.json.reasons[0].reason, 'Choose 2 more categories or turn on Same again to engage Buddy.');
  assert.equal((await view(g)).initial.buddy.canEngage, false);
});

test('three categories engage; several choices in one category count once and an opened slider counts its midpoint', async (t) => {
  const f = await setup(t);
  await saveOk(f, { body: { value: ['hatchback', 'saloon', 'estate'] }, fuel: { value: ['petrol', 'diesel'] } });
  assert.equal((await engage(f)).json.remaining, 1);
  await saveOk(f, { comfort: { value: 50 } });
  const before = await view(f);
  assert.deepEqual([before.initial.buddy.considered, before.initial.buddy.remaining, before.initial.buddy.canEngage], [3, 0, true]);
  assert.equal(briefs(f).length, 0);
  const out = await engage(f);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.deepEqual(out.json.value.buddy, { state: 'engaged', reason: null, permissionVersion: 1, minimumCategories: 3, considered: 3,
    remaining: 0, sameAgain: false, canEngage: false });
  assert.deepEqual([out.json.value.briefVersion, out.json.value.draftVersion], [1, 2]);
  const [row] = briefs(f);
  assert.deepEqual([row.briefVersion, row.buddy.searchConsent, row.buddy.holdConsent, row.buddy.paused, row.buddy.enabled, row.buddy.permissionVersion],
    [1, true, true, false, true, 1]);
  assert.equal(row.buddy.disengagedReason, undefined);
  assert.deepEqual(operations(f), ['engaged']);
  const reload = await view(f);
  assert.deepEqual(reload.initial.buddy, out.json.value.buddy);
  assert.deepEqual(reload.initial.consent, { search: true, hold: true });
  assert.equal(selectable(f), true);
  assert.deepEqual((await permission(f)).permission, { searchConsent: true, holdConsent: true, paused: false, permissionVersion: 1, canSearch: true, canHold: true });
});

test('Same again bypasses the minimum, even with no categories', async (t) => {
  const f = await setup(t);
  await saveOk(f, {}, { sameAgain: { contractId: f.contractId, on: true } });
  const before = (await view(f)).initial.buddy;
  assert.deepEqual([before.considered, before.remaining, before.sameAgain, before.canEngage], [0, 0, true, true]);
  const out = await engage(f);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.value.buddy.state, 'engaged');
  assert.equal(briefs(f)[0].sameAgain.on, true);
  assert.equal(selectable(f), true);
});

test('engaging with a pending draft confirms the draft content as the latest saved brief', async (t) => {
  const f = await setup(t);
  await saveOk(f, three);
  assert.equal(briefs(f).length, 0);
  const out = await engage(f);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const [row] = briefs(f);
  assert.deepEqual(row.preferences.body.value, ['saloon', 'estate']);
  assert.equal(row.preferences.sportiness.valueState, 'confirmed');
  assert.equal(row.knownFacts.name.value !== undefined, true);
  assert.equal(row.buddy.engagedBy, f.context.principalId);
  // Engaging again on the confirmed brief copies it: the next autosave then builds on this version.
  const next = await saveOk(f, { economy: { importance: 'high' } });
  assert.equal(next.briefVersion, 2);
});

test('a stale draft or brief version is refused and nothing is written', async (t) => {
  const f = await setup(t);
  await saveOk(f, three);
  const v = await versions(f);
  // A pending autosave (a later draft) makes the engage on the older draft stale.
  await saveOk(f, { comfort: { value: 0 } });
  const staleDraft = await call(f, 'brief/engage', { commandId: 'old-draft', ...v });
  assert.equal(staleDraft.status, 409); assert.equal(staleDraft.json.status, 'stale-version');
  assert.deepEqual([staleDraft.json.expectedVersion, staleDraft.json.currentVersion], [v.expectedDraftVersion, v.expectedDraftVersion + 1]);
  const staleBrief = await call(f, 'brief/engage', { commandId: 'old-brief', ...(await versions(f)), expectedBriefVersion: 4 });
  assert.equal(staleBrief.json.status, 'stale-version');
  assert.deepEqual([briefs(f).length, operations(f)], [0, []]);
  const fresh = await engage(f); assert.equal(fresh.status, 200);
  assert.equal(briefs(f)[0].preferences.comfort.value, 0);
  const late = await call(f, 'brief/disengage', { commandId: 'late', ...v });
  assert.equal(late.json.status, 'stale-version');
  for (const extra of [{ consent: {} }, { employeeId: 'x' }, { brief: {} }])
    assert.equal((await call(f, 'brief/engage', { ...(await engageBody(f)), ...extra })).status, 400);
  assert.equal((await call(f, 'brief/engage?employeeId=x', await engageBody(f))).status, 400);
  assert.equal((await f.http.request('/api/gcsp/brief/engage', { session: null, body: await engageBody(f) })).status, 401);
  assert.equal((await f.http.request('/api/gcsp/brief/engage', { session: f.presenter, body: await engageBody(f) })).status, 403);
});

test('repeating a command replays one outcome; a changed body or a state conflict is refused', async (t) => {
  const f = await setup(t);
  await saveOk(f, three);
  const body = await engageBody(f, 'engage-once');
  const first = await call(f, 'brief/engage', body);
  const replay = await call(f, 'brief/engage', body);
  assert.equal(first.status, 200); assert.deepEqual(replay.json, first.json);
  assert.equal(briefs(f).length, 1); assert.deepEqual(operations(f), ['engaged']);
  const changed = await call(f, 'brief/engage', { ...body, expectedDraftVersion: body.expectedDraftVersion + 1 });
  assert.equal(changed.status, 409); assert.equal(changed.json.reason, 'idempotency-input-changed');
  const again = await engage(f);
  assert.equal(again.status, 409); assert.equal(again.json.reason, 'already-engaged'); assert.equal(again.json.buddy.state, 'engaged');
  const offBody = await engageBody(f, 'off-once');
  const off = await call(f, 'brief/disengage', offBody);
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.deepEqual((await call(f, 'brief/disengage', offBody)).json, off.json);
  assert.equal(briefs(f).length, 2);
  const twice = await disengage(f);
  assert.equal(twice.status, 409); assert.equal(twice.json.reason, 'already-disengaged'); assert.equal(twice.json.buddy.state, 'disengaged');
  assert.equal(briefs(f).length, 2);
});

test('disengage stops search and hold, keeps choices, rating and Same again, and leaves existing offers alone', async (t) => {
  const f = await setup(t);
  await saveOk(f, three, { currentCarRating: { contractId: f.contractId, value: 4 } });
  await saveOk(f, {}, { sameAgain: { contractId: f.contractId, on: true } });
  assert.equal((await engage(f)).status, 200);
  const order = f.store.state.tables.stock[0];
  const planted = await f.repository.transaction(f.context, { commandId: 'offer-fixture', inputDigest: inputDigest('offer-fixture') }, async (tx) => {
    await tx.insert('quotes', { runId: f.context.runId, quoteId: 'quote', employeeId: f.context.employeeId, orderUuid: order.orderUuid });
    await tx.insert('holds', { runId: f.context.runId, holdId: 'hold', orderUuid: order.orderUuid, employeeId: f.context.employeeId,
      entitlementSlotId: f.context.entitlementSlotId, type: 'buddy-offer', state: 'active', quoteId: 'quote' });
    return tx.insert('offers', { runId: f.context.runId, offerId: 'offer', holdId: 'hold', quoteId: 'quote', employeeId: f.context.employeeId,
      orderUuid: order.orderUuid, state: 'active', briefVersion: 1, policyVersion: f.context.policyVersion, expiresAt: '2026-11-06T08:00:00.000Z',
      tokenHash: 'h', tokenMetadata: {}, operationId: 'op' });
  });
  assert.equal(planted.status, 'ok', JSON.stringify(planted));
  const stores = ['offers', 'holds', 'quotes', 'orders'].map((table) => [table, structuredClone(f.store.state.tables[table] ?? [])]);
  const [engagedRow] = briefs(f).slice(-1);
  const out = await disengage(f);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.deepEqual(out.json.value.buddy, { state: 'disengaged', reason: null, permissionVersion: 2, minimumCategories: 3, considered: 3,
    remaining: 0, sameAgain: true, canEngage: true });
  const row = briefs(f).at(-1);
  assert.deepEqual([row.buddy.searchConsent, row.buddy.holdConsent, row.buddy.paused, row.buddy.enabled, row.buddy.permissionVersion],
    [false, false, false, false, row.briefVersion]);
  for (const key of ['preferences', 'currentCarRating', 'sameAgain']) assert.deepEqual(row[key], engagedRow[key], key);
  assert.deepEqual(operations(f).at(-1), 'disengaged');
  for (const [table, rows] of stores) assert.deepEqual(f.store.state.tables[table] ?? [], rows, table);
  const activity = await permission(f);
  assert.deepEqual([activity.permission.searchConsent, activity.permission.canSearch, activity.permission.canHold], [false, false, false]);
  assert.equal(activity.currentOffer.state, 'active'); assert.equal(activity.stateChangesEvidence.rejectedReceipts, 0);
  assert.equal(activity.stateChanges.at(-1).operation, 'disengaged');
  assert.equal(activityEvents(activity.stateChanges).at(-1).label, 'Buddy disengaged');
  const current = (await call(f, 'brief')).json.value.activity;
  assert.deepEqual([current.canSearch, current.canHold, current.existingOffersUnaffected], [false, false, true]);
  assert.equal(selectable(f), false);
  assert.deepEqual((await view(f)).initial.buddy, out.json.value.buddy);
  // It can be engaged again from the same saved choices.
  assert.equal((await engage(f)).json.value.buddy.permissionVersion, 3);
});

test('a valid edit while engaged stays engaged with a new version and an unchanged permission version', async (t) => {
  const f = await engagedFixture(t);
  const out = await save(f, { comfort: { value: 100, importance: 'high' } });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.value.briefVersion, 2); assert.equal(out.json.value.buddyTransition, null);
  assert.deepEqual([out.json.value.buddy.state, out.json.value.buddy.permissionVersion, out.json.value.buddy.considered], ['engaged', 1, 4]);
  const row = briefs(f).at(-1);
  assert.deepEqual([row.briefVersion, row.buddy.searchConsent, row.buddy.holdConsent, row.buddy.permissionVersion], [2, true, true, 1]);
  assert.deepEqual(row.preferences.comfort.value, 100);
  assert.deepEqual(operations(f), ['engaged', 'preferences-updated']);
  const activity = await permission(f);
  assert.deepEqual(activity.stateChanges.map((c) => c.operation), ['engaged', 'preferences-updated']);
  assert.equal(activity.stateChangesEvidence.rejectedReceipts, 0); assert.equal(activity.permission.canHold, true);
  // The next autosave carries on from the version the response reported.
  const next = await call(f, 'brief/preferences', { commandId: 'chain', expectedBriefVersion: out.json.value.briefVersion,
    expectedDraftVersion: out.json.value.draftVersion, changes: { size: { value: 0 } } });
  assert.equal(next.status, 200, JSON.stringify(next.json)); assert.equal(next.json.value.briefVersion, 3);
  assert.equal(selectable(f), true);
});

test('removing a category below the minimum while engaged disengages with the save and allocation no longer selects it', async (t) => {
  const f = await engagedFixture(t);
  assert.equal(selectable(f), true);
  const out = await save(f, { sportiness: null });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const value = out.json.value;
  assert.equal(value.buddyTransition, 'minimum-lost'); assert.equal(value.briefVersion, 2);
  assert.deepEqual(value.buddy, { state: 'disengaged', reason: 'minimum-lost', permissionVersion: 2, minimumCategories: 3, considered: 2,
    remaining: 1, sameAgain: false, canEngage: false });
  const row = briefs(f).at(-1);
  assert.deepEqual([row.briefVersion, row.buddy.searchConsent, row.buddy.holdConsent, row.buddy.enabled, row.buddy.paused, row.buddy.disengagedReason],
    [2, false, false, false, false, 'minimum-lost']);
  assert.equal(row.preferences.sportiness, undefined); assert.deepEqual(row.preferences.body.value, ['saloon', 'estate']);
  assert.deepEqual(operations(f), ['engaged', 'disengaged']);
  assert.equal(selectable(f), false);
  const activity = await permission(f);
  assert.deepEqual([activity.permission.canSearch, activity.permission.canHold, activity.stateChangesEvidence.rejectedReceipts], [false, false, 0]);
  assert.deepEqual((await view(f)).initial.buddy, value.buddy);
  // The reason clears once Buddy is engaged again.
  await saveOk(f, { sportiness: { value: 50 } });
  const again = await engage(f);
  assert.equal(again.status, 200, JSON.stringify(again.json)); assert.equal(again.json.value.buddy.reason, null);
});

test('turning Same again off below the minimum while engaged disengages as minimum-lost', async (t) => {
  const f = await setup(t);
  await saveOk(f, {}, { sameAgain: { contractId: f.contractId, on: true } });
  assert.equal((await engage(f)).status, 200);
  const out = await save(f, {}, { sameAgain: { contractId: f.contractId, on: false } });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.value.buddyTransition, 'minimum-lost');
  assert.deepEqual([out.json.value.buddy.state, out.json.value.buddy.reason, out.json.value.buddy.remaining], ['disengaged', 'minimum-lost', 3]);
  assert.deepEqual(operations(f), ['engaged', 'disengaged']);
  assert.equal(selectable(f), false);
  assert.equal(briefs(f).at(-1).sameAgain.on, false);
});

test('a refused or stale save while engaged writes nothing and keeps Buddy engaged', async (t) => {
  const f = await engagedFixture(t);
  const before = structuredClone(f.store.state.tables);
  const bad = await save(f, { sportiness: { value: 40 } });
  assert.equal(bad.status, 400);
  const stale = await call(f, 'brief/preferences', { commandId: 'stale', expectedBriefVersion: 0, expectedDraftVersion: 0, changes: { sportiness: null } });
  assert.equal(stale.json.status, 'stale-version');
  for (const table of ['briefs', 'event_receipts']) assert.deepEqual(f.store.state.tables[table], before[table], table);
  assert.equal(selectable(f), true); assert.equal((await view(f)).initial.buddy.state, 'engaged');
});

test('an edit while paused stays paused and a disengaged brief cannot be paused', async (t) => {
  const f = await engagedFixture(t);
  assert.equal((await f.brief.pause(f.context, { commandId: 'pause-1', expectedBriefVersion: 1 })).status, 'ok');
  const out = await save(f, { comfort: { value: 100 } });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.deepEqual([out.json.value.buddy.state, out.json.value.buddy.reason, out.json.value.buddy.permissionVersion], ['disengaged', 'paused', 2]);
  const row = briefs(f).at(-1);
  assert.deepEqual([row.briefVersion, row.buddy.paused, row.buddy.searchConsent], [3, true, true]);
  assert.equal(selectable(f), false);
  const g = await engagedFixture(t);
  assert.equal((await disengage(g)).status, 200);
  const paused = await g.brief.pause(g.context, { commandId: 'pause-2', expectedBriefVersion: 2 });
  assert.deepEqual([paused.status, paused.reason], ['conflict', 'not-engaged']);
});

test('before engagement an autosave stays a draft and grants nothing', async (t) => {
  const f = await setup(t);
  await saveOk(f, three); await saveOk(f, { comfort: { value: 0 } });
  assert.deepEqual([briefs(f).length, changes(f).length], [0, 0]);
  assert.equal((await view(f)).initial.buddy.state, 'disengaged');
  assert.equal(selectable(f), false);
});

test('an accepted offer makes engage and disengage read-only', async (t) => {
  const f = await engagedFixture(t);
  const order = f.store.state.tables.stock[0];
  const planted = await f.repository.transaction(f.context, { commandId: 'accepted-fixture', inputDigest: inputDigest('accepted-fixture') }, async (tx) => {
    await tx.insert('quotes', { runId: f.context.runId, quoteId: 'q2', employeeId: f.context.employeeId, orderUuid: order.orderUuid });
    await tx.insert('holds', { runId: f.context.runId, holdId: 'h2', orderUuid: order.orderUuid, employeeId: f.context.employeeId,
      entitlementSlotId: f.context.entitlementSlotId, type: 'buddy-offer', state: 'active', quoteId: 'q2' });
    return tx.insert('offers', { runId: f.context.runId, offerId: 'o2', holdId: 'h2', quoteId: 'q2', employeeId: f.context.employeeId,
      orderUuid: order.orderUuid, state: 'accepted', briefVersion: 1, policyVersion: f.context.policyVersion, expiresAt: '2026-11-06T08:00:00.000Z',
      tokenHash: 'h', tokenMetadata: {}, operationId: 'op2' });
  });
  assert.equal(planted.status, 'ok', JSON.stringify(planted));
  const before = structuredClone(f.store.state.tables.briefs);
  for (const route of ['engage', 'disengage', 'pause-search', 'resume-search']) {
    const out = await call(f, `brief/${route}`, await engageBody(f));
    assert.equal(out.status, 409, route); assert.equal(out.json.reason, 'brief-read-only');
  }
  for (const [route, payload] of [['draft', { brief: (await view(f)).initial.brief }], ['confirm', { consent: { search: true, hold: true } }]]) {
    const out = await call(f, `brief/${route}`, { commandId: `accepted-${route}`, ...(await versions(f)), ...payload });
    assert.equal(out.status, 409, route); assert.equal(out.json.reason, 'brief-read-only');
  }
  // Simulate acceptance after the editor's snapshot: service writes recheck it transactionally.
  const at = await versions(f);
  const source = (await view(f)).initial.brief;
  const gate = { ok: true, briefVersion: at.expectedBriefVersion, draftVersion: at.expectedDraftVersion };
  for (const [operation, payload] of [['saveDraft', { brief: source }], ['confirm', { consent: { search: true, hold: true } }], ['pause', {}], ['resume', {}]]) {
    const out = await f.brief[operation](f.context, { commandId: `accepted-race-${operation}`, ...at, ...payload }, { gate, source });
    assert.equal(out.status, 'conflict', operation); assert.equal(out.reason, 'brief-read-only');
  }
  assert.deepEqual(f.store.state.tables.briefs, before);
});

test('engagement fails closed when its policy entry is malformed', async (t) => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const entry = seed.assumptions.find((a) => a.key === KEY);
  assert.deepEqual([entry.status, entry.value.onMinimumLoss, entry.value.grants], ['assumed', 'disengage', { search: true, hold: true }]);
  entry.value.onMinimumLoss = 'ignore';
  const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const f = await setup(t, { policy });
  await saveOk(f, three);
  const out = await engage(f);
  assert.equal(out.status, 503, JSON.stringify(out.json)); assert.equal(out.json.status, 'unavailable');
  const legacy = await call(f, 'brief/confirm', { commandId: 'policy-legacy', ...(await versions(f)), consent: { search: true, hold: true } });
  assert.equal(legacy.status, 503, JSON.stringify(legacy.json));
  assert.equal(briefs(f).length, 0);
});

test('the browser transport sends only the three engagement fields to the real routes', async (t) => {
  const f = await setup(t); await saveOk(f, three);
  const base = `http://127.0.0.1:${f.http.server.address().port}`;
  const fetch = (url, init) => globalThis.fetch(url, { ...init, headers: { ...init.headers, Origin: 'https://employee.test', cookie: f.acting.value.setCookie.split(';')[0] } });
  const transport = createBriefTransport({ fetch, baseURL: base });
  assert.deepEqual(await transport.engage({ commandId: 'c', expectedBriefVersion: 0, expectedDraftVersion: 3, consent: {} }), { status: 'invalid', field: 'request' });
  const out = await transport.engage({ commandId: 'transport-engage', ...(await versions(f)) });
  assert.equal(out.status, 'ok', JSON.stringify(out));
  const off = await transport.disengage({ commandId: 'transport-disengage', ...(await versions(f)) });
  assert.equal(off.status, 'ok', JSON.stringify(off)); assert.equal(off.value.buddy.state, 'disengaged');
});


test('legacy browser pause/resume aliases revoke grants and apply the Account minimum gate', async (t) => {
  const f = await engagedFixture(t);
  const off = await call(f, 'brief/pause', { commandId: 'legacy-off', expectedBriefVersion: 1 });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.equal(off.json.value.buddy.state, 'disengaged');
  assert.deepEqual([briefs(f).at(-1).buddy.searchConsent, briefs(f).at(-1).buddy.holdConsent, briefs(f).at(-1).buddy.paused], [false, false, false]);
  const on = await call(f, 'brief/resume', { commandId: 'legacy-on', expectedBriefVersion: 2 });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.equal(on.json.value.buddy.state, 'engaged');
  await saveOk(f, { sportiness: null, economy: null });
  const version = (await versions(f)).expectedBriefVersion;
  const refused = await call(f, 'brief/resume', { commandId: 'legacy-under-minimum', expectedBriefVersion: version });
  assert.equal(refused.json.code, 'engagement-minimum');
  assert.equal((await view(f)).initial.buddy.state, 'disengaged');
  const stale = await call(f, 'brief/resume', { commandId: 'legacy-stale', expectedBriefVersion: 1 });
  assert.equal(stale.json.status, 'stale-version');
});

test('legacy paused grants can be explicitly revoked or normalised by the canonical commands', async (t) => {
  const f = await engagedFixture(t);
  assert.equal((await f.brief.pause(f.context, { commandId: 'old-pause', expectedBriefVersion: 1 })).status, 'ok');
  assert.equal((await view(f)).initial.buddy.state, 'disengaged');
  const off = await disengage(f);
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.deepEqual([briefs(f).at(-1).buddy.searchConsent, briefs(f).at(-1).buddy.holdConsent, briefs(f).at(-1).buddy.paused], [false, false, false]);
  assert.equal((await engage(f)).status, 200);
  assert.equal((await f.brief.pause(f.context, { commandId: 'old-pause-again', expectedBriefVersion: 4 })).status, 'ok');
  const on = await engage(f);
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.deepEqual([briefs(f).at(-1).buddy.searchConsent, briefs(f).at(-1).buddy.holdConsent, briefs(f).at(-1).buddy.paused], [true, true, false]);
});


test('partial legacy grants are off in real service and Activity permissions, then Engage normalises both grants', async (t) => {
  const f = await setup(t);
  await saveOk(f, three);
  const initial = await versions(f);
  const confirmed = await f.brief.confirm(f.context, { commandId: 'partial-old-confirm', ...initial, consent: { search: true, hold: false } });
  assert.equal(confirmed.status, 'ok', JSON.stringify(confirmed));
  assert.equal(confirmed.value.activity.canSearch, false);
  assert.equal(confirmed.value.activity.canHold, false);
  assert.equal((await permission(f)).permission.canSearch, false);
  assert.equal((await view(f)).initial.buddy.state, 'disengaged');
  assert.equal((await engage(f)).status, 200);
  const active = (await permission(f)).permission;
  assert.deepEqual([active.searchConsent, active.holdConsent, active.paused, active.canSearch, active.canHold], [true, true, false, true, true]);
});


test('the tile HTTP commands pause and resume search while retaining grants and a held offer', async (t) => {
  const f = await engagedFixture(t); const order = f.store.state.tables.stock[0];
  const planted = await f.repository.transaction(f.context, { commandId: 'tile-held', inputDigest: inputDigest('tile-held') }, async (tx) => {
    await tx.insert('quotes', { runId: f.context.runId, quoteId: 'tile-q', employeeId: f.context.employeeId, orderUuid: order.orderUuid });
    await tx.insert('holds', { runId: f.context.runId, holdId: 'tile-h', orderUuid: order.orderUuid, employeeId: f.context.employeeId,
      entitlementSlotId: f.context.entitlementSlotId, type: 'buddy-offer', state: 'active', quoteId: 'tile-q' });
    return tx.insert('offers', { runId: f.context.runId, offerId: 'tile-o', holdId: 'tile-h', quoteId: 'tile-q', employeeId: f.context.employeeId,
      orderUuid: order.orderUuid, state: 'active', briefVersion: 1, policyVersion: f.context.policyVersion, expiresAt: '2026-11-06T08:00:00.000Z',
      tokenHash: 'h', tokenMetadata: {}, operationId: 'tile-op' });
  });
  assert.equal(planted.status, 'ok');
  const kept = ['offers', 'holds', 'quotes', 'orders'].map((table) => [table, structuredClone(f.store.state.tables[table] ?? [])]);
  const base = `http://127.0.0.1:${f.http.server.address().port}`; const writes = [];
  const adapter = createActivityHttpAdapter({ fetch: async (path, options) => {
    if (options.method === 'POST') writes.push({ path, body: JSON.parse(options.body) });
    return globalThis.fetch(base + path, { ...options, headers: { ...options.headers, Origin: 'https://employee.test', cookie: f.acting.value.setCookie.split(';')[0] } });
  } });
  const controller = createActivityController({ adapter, createCommandId: () => `tile-command-${writes.length}` }); t.after(() => controller.destroy());
  await controller.refresh(); await controller.pauseSearch();
  let value = controller.getState().result.value;
  assert.deepEqual([value.permission.searchConsent, value.permission.holdConsent, value.permission.paused, value.permission.canSearch], [true, true, true, false]);
  assert.equal(value.currentOffer.state, 'active'); assert.equal(controller.getState().message, 'Search paused.');
  await controller.resumeSearch(); value = controller.getState().result.value;
  assert.deepEqual([value.permission.searchConsent, value.permission.holdConsent, value.permission.paused, value.permission.canSearch], [true, true, false, true]);
  assert.equal(controller.getState().message, 'Search resumed.');
  assert.deepEqual(writes.map((row) => row.path), ['/api/gcsp/brief/pause-search', '/api/gcsp/brief/resume-search']);
  assert.deepEqual(writes.map((row) => [row.body.expectedBriefVersion, row.body.expectedDraftVersion]), [[1, 1], [2, 1]]);
  for (const [table, rows] of kept) assert.deepEqual(f.store.state.tables[table] ?? [], rows, table);
  assert.deepEqual(operations(f).slice(-2), ['paused', 'resumed']);
});

test('search commands reject stale editor versions and resume cannot bypass the Account minimum', async (t) => {
  const f = await engagedFixture(t); const at = await versions(f);
  const stale = await call(f, 'brief/pause-search', { commandId: 'tile-stale-draft', ...at, expectedDraftVersion: 0 });
  assert.equal(stale.json.status, 'stale-version'); assert.equal(briefs(f).length, 1);
  const paused = await call(f, 'brief/pause-search', { commandId: 'tile-pause', ...at }); assert.equal(paused.status, 200, JSON.stringify(paused.json));
  await saveOk(f, { sportiness: null, economy: null });
  const before = structuredClone(f.store.state.tables.briefs);
  const refused = await call(f, 'brief/resume-search', { commandId: 'tile-minimum', ...(await versions(f)) });
  assert.equal(refused.json.code, 'engagement-minimum'); assert.deepEqual(f.store.state.tables.briefs, before);
  const old = await call(f, 'brief/resume-search', { commandId: 'tile-stale-brief', ...at }); assert.equal(old.json.status, 'stale-version');
});
