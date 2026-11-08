// Shared launcher and Paula-path helpers (FUCQ-109 harness): the composed launcher on memory, loopback HTTPS, no browser, no native DB.
// Stock is the demo provider (GCSP_STOCK_SOURCE=demo): the run chooser's generated stock is slow and not repeatable.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startGcspDemo } from '../../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../../gcsp/stock/demo-provider.js';
import { PolicyService, MemoryPolicyProvider } from '../../gcsp/policy/index.js';
import { createLocalHttpsFixture } from './local-https.js';

export const good = (outcome, note = '') => { assert.equal(outcome?.status, 'ok', `${note} ${JSON.stringify(outcome)}`.trim()); return outcome.value; };
export const jar = (value) => [value].flat().map((entry) => entry.split(';')[0]).join('; ');
export const sortedIds = (rows) => rows.map((row) => row.orderUuid).sort();
export const add = (instant, minutes) => new Date(Date.parse(instant) + minutes * 60000).toISOString();

/** Canonical seed with Alex given Paula's grade (at his own none of the demo cars is within his allowance); `edit` adjusts it further. */
export async function competingPolicy(edit) {
  const seed = JSON.parse(await readFile(new URL('../../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const principals = seed.assumptions.find((entry) => entry.key === 'identity.demo.principals').value;
  const byId = (id) => principals.find((entry) => entry.principalId === id);
  byId('demo-alex').gradeId = byId('demo-paula').gradeId;
  edit?.(seed, (key) => seed.assumptions.find((entry) => entry.key === key));
  const inner = new MemoryPolicyProvider({ seedProvider: { async loadVersions() { return [seed]; } } });
  // A stable array per run lets PolicyService reuse its validated snapshot; without it every read re-validates the whole seed.
  const cached = new Map();
  const provider = { async loadVersions(read) { if (!cached.has(read.runId)) cached.set(read.runId, await inner.loadVersions(read)); return cached.get(read.runId); },
    async publish(read, build) { const outcome = await inner.publish(read, build); cached.delete(read.runId); return outcome; }, close: () => inner.close() };
  return { seed, policy: new PolicyService({ provider }) };
}

/** Boots the launcher composition once, as the CLI does (`adoptOfferJourney`); `f.api` sends the exact Origin and cookies a browser would. */
export async function launch(t, { edit, environmentId = 'critical-path' } = {}) {
  const { seed, policy } = await competingPolicy(edit);
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: createDemoStockProvider, adoptOfferJourney: true, policy, environmentId, policyAsOf: seed.effectiveFrom, commandId: `${environmentId}-bootstrap` } }));
  t.after(() => app.close());
  const f = { app, services: app.services, policy: app.services.policy, origin: app.origin, seed, counter: 0, presenter: null, context: null };
  f.api = async (path, { body, session, method } = {}) => {
    const response = await https.fetch(`${app.origin}${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), timeoutMs: 60000,
      headers: { Origin: app.origin, Cookie: session ?? f.presenter, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, json: await response.json(), headers: response.headers };
  };
  // Trusted backend step: there is no HTTP route that issues a presenter session.
  f.reopenPresenter = async () => {
    const next = good(await f.services.identity.createPresenterSession(`presenter-${++f.counter}`));
    f.presenter = jar(next.setCookie); f.context = next.context;
  };
  await f.reopenPresenter();
  return f;
}

/** Policy values for the run's current instant, read through PolicyService only. */
export async function assumption(f, key) {
  const run = good(await f.services.repository.currentRun(f.context.environmentId));
  const read = await f.policy.getAssumption(key, { runId: run.runId, asOf: run.clockInstant, policyVersion: run.policyVersion });
  return good(read, key).value;
}
export const rows = async (f, table, filter) => good(await f.services.repository.query(f.context, table, filter), table);
export const rowOf = async (f, table, key, value) => (await rows(f, table)).find((row) => row[key] === value);
export const controls = async (f) => { const reply = await f.api('/api/gcsp/presenter/controls'); assert.equal(reply.status, 200); return reply.json.value; };

/** Presenter tick over HTTP; also proves the same command ID replays the same outcome. */
export async function tickTo(f, label, plan) {
  const before = await controls(f);
  const body = { commandId: `${label}-tick-${++f.counter}`, expectedClockVersion: before.clockVersion, ...plan };
  const reply = await f.api('/api/gcsp/presenter/controls/tick', { body });
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  const value = reply.json.value;
  const failed = value.tick.outcomes.filter((row) => row.outcome?.status !== 'ok');
  assert.deepEqual(failed.map((row) => row.handlerId), [], 'every tick handler succeeds');
  const replay = await f.api('/api/gcsp/presenter/controls/tick', { body });
  assert.equal(replay.status, 200); assert.deepEqual(replay.json, reply.json, 'the same command ID replays the same outcome');
  const outcome = (handlerId) => value.tick.outcomes.find((row) => row.handlerId === handlerId)?.outcome.value;
  return { value, now: value.advance.now ?? value.advance.clockInstant, outcome };
}

/** The presenter page's Reset over HTTP (FUCQ-85): the mechanics scenario, with the current run and versions. */
export async function postReset(f, label) {
  const before = await controls(f);
  const catalogue = good((await f.api('/api/gcsp/presenter/scenarios')).json, 'scenario catalogue').scenarios;
  const scenario = catalogue.find((row) => row.kind === 'mechanics' && row.availability.available);
  assert.ok(scenario, 'the catalogue offers the plain reset');
  const reply = await f.api('/api/gcsp/presenter/scenarios/reset', { body: { commandId: `${label}-reset`, expectedRunId: before.runId,
    expectedRunVersion: before.runVersion, scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion,
    fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion } });
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  assert.equal(reply.json.value.previousRunId, before.runId); assert.notEqual(reply.json.value.runId, before.runId);
  return { before, reply };
}

/** Resets, then re-issues the presenter session, which the reset invalidates. */
export async function resetRun(f, label) {
  const { before, reply } = await postReset(f, label);
  assert.equal((await f.api('/api/gcsp/presenter/controls')).json.status, 'stale-run', 'the earlier presenter session is refused');
  await f.reopenPresenter();
  const after = await controls(f);
  assert.equal(after.runId, reply.json.value.runId);
  return { previousRunId: before.runId, runId: after.runId, state: after };
}

/** Switches the presenter to an employee, as the browser's "view as" control does, and returns that employee's cookie. */
export async function actAs(f, label, name) {
  const switched = await f.api('/api/gcsp/session/switch', { body: { principalId: `demo-${name}`, commandId: `${label}-as-${name}` } });
  assert.equal(switched.status, 200, JSON.stringify(switched.json));
  assert.deepEqual(switched.json.value.roles, ['employee']);
  return jar(switched.headers.getSetCookie());
}

export const confirmed = (value, importance = 100) => ({ value, importance, valueState: 'confirmed', importanceState: 'confirmed', source: 'employee' });
/** Saves and confirms a brief with search and hold consent over the same routes as the brief page. */
export async function saveBrief(f, label, name, session, body) {
  const editor = good((await f.api('/api/gcsp/brief/editor', { session })).json, 'brief editor');
  assert.equal(editor.initial.briefVersion, 0); assert.equal(editor.initial.draftVersion, 0);
  const brief = { schemaVersion: 1, preferences: { body: confirmed(body) },
    essentials: { seats: { value: 5, operator: 'gte', unit: 'count', state: 'confirmed', source: 'employee' } } };
  const draft = good((await f.api('/api/gcsp/brief/draft', { session, body: { commandId: `${label}-${name}-draft`,
    expectedBriefVersion: 0, expectedDraftVersion: 0, brief } })).json, 'save draft');
  assert.equal(draft.draftVersion, 1);
  const approved = good((await f.api('/api/gcsp/brief/confirm', { session, body: { commandId: `${label}-${name}-confirm`,
    expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } } })).json, 'confirm brief');
  assert.equal(approved.brief.preferences.body.value, body); assert.equal(approved.brief.buddy.searchConsent, true);
  assert.equal(approved.brief.buddy.holdConsent, true);
  return approved;
}

export const offerPath = (selector) => `/api/gcsp/offers/${encodeURIComponent(selector.offerId)}`;
export const query = (selector) => `?runId=${encodeURIComponent(selector.runId)}`;
/** Opens an offer link as the browser does: only the link's token, no employee cookie. */
export async function openLink(f, link) {
  const url = new URL(link, f.origin);
  const selector = { runId: url.searchParams.get('runId'), offerId: url.searchParams.get('offerId') };
  const reply = await f.api('/api/gcsp/offers/access', { session: '', body: { ...selector, token: new URLSearchParams(url.hash.slice(1)).get('token') } });
  return { reply, selector, session: reply.status === 200 ? jar(reply.headers.getSetCookie()) : null };
}
export const readOffer = async (f, session, selector) => good((await f.api(`${offerPath(selector)}${query(selector)}`, { session })).json, 'offer view');

export const activityOf = async (f, session) => good((await f.api('/api/gcsp/activity', { session })).json, 'activity');

/** The activity page's view of Paula: search state, the latest check and her current offer. */
export async function expectActivity(f, seen, want) {
  const view = await activityOf(f, seen.sessions.paula);
  assert.deepEqual([view.state, view.briefVersion, view.currentOffer.offerRef.offerId, view.currentOffer.state, view.lastSuccessfulCheck.outcome,
    view.lastSuccessfulCheck.carsChecked, view.searchEvidence.checks],
  [want.state, want.briefVersion, want.offerId, want.offerState, 'offer-held', want.carsChecked, want.checks], 'activity');
}

/** Independent re-derivation of the allocator's order from the canonical rule and seed (mirrors allocation/index.js). */
export function expectedAssignments(rule, tieSeed, runId, contenders) {
  const lottery = (c) => createHash('sha256').update(JSON.stringify([tieSeed, runId, c.employeeId, c.orderUuid])).digest('hex');
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const renewal = (a, b) => cmp(a.renewalDue, b.renewalDue); const fit = (a, b) => b.score - a.score;
  const tail = (a, b) => cmp(lottery(a), lottery(b)) || cmp(a.employeeId, b.employeeId) || cmp(a.orderUuid, b.orderUuid);
  const order = { renewalDueThenFitThenSeededLottery: (a, b) => renewal(a, b) || fit(a, b) || tail(a, b),
    fitThenRenewalDueThenSeededLottery: (a, b) => fit(a, b) || renewal(a, b) || tail(a, b) }[rule];
  assert.ok(order, `known tie-break rule ${rule}`);
  const taken = []; const won = new Map();
  for (const c of [...contenders].sort(order)) {
    if (won.has(c.employeeId) || taken.includes(c.orderUuid)) continue;
    won.set(c.employeeId, c.orderUuid); taken.push(c.orderUuid);
  }
  return won;
}

/** Subtests that depend on each other: after one fails the rest are skipped rather than reported as noise. */
export function stepper(t, blocked = () => false) {
  let failed = false;
  const step = (name, run) => t.test(name, { skip: failed || blocked() ? 'an earlier step failed' : false },
    async () => { try { await run(); } catch (error) { failed = true; throw error; } });
  return step;
}

/** Walks Paula's path once on a fresh reset and returns every identifier it saw. Each step asserts its state. */
export async function walkPaulasPath(t, f, label = 'run', { beforeAccept } = {}) {
  const seen = { label, first: {}, second: {}, alex: {}, outline: {} };
  const step = stepper(t);

  await step('reset: a new run at the scenario start with nothing released', async () => {
    const reset = await resetRun(f, label);
    seen.runId = reset.runId; seen.previousRunId = reset.previousRunId;
    const names = (await assumption(f, 'clock.scenario.v1')).namedTimes;
    seen.releaseCue = names.release;
    assert.equal(reset.state.now, (await assumption(f, 'clock.scenario.v1')).startsAt);
    assert.equal(reset.state.controls.nextRelease.status, 'available'); assert.equal(reset.state.controls.nextRelease.at, seen.releaseCue);
    assert.equal((await rows(f, 'stock')).filter((row) => row.state === 'released').length, 0);
    assert.equal((await rows(f, 'offers')).length, 0);
    assert.equal((await rows(f, 'briefs')).length, 0);
  });

  await step('brief: Paula and Alex each save and confirm an estate brief with hold consent', async () => {
    // Both briefs fit the same two estates in window one, so they compete and each still gets one car.
    seen.sessions = { paula: await actAs(f, label, 'paula'), alex: await actAs(f, label, 'alex') };
    const paula = await saveBrief(f, label, 'paula', seen.sessions.paula, 'estate');
    const alex = await saveBrief(f, label, 'alex', seen.sessions.alex, 'estate');
    assert.equal(paula.brief.briefVersion, 1); assert.equal(alex.brief.briefVersion, 1);
    const briefs = await rows(f, 'briefs');
    assert.deepEqual(briefs.map((row) => [row.status, row.briefVersion]), [['confirmed', 1], ['confirmed', 1]]);
    const activity = await activityOf(f, seen.sessions.paula);
    assert.deepEqual([activity.state, activity.briefVersion, activity.permission.canSearch, activity.permission.canHold, activity.currentOffer, activity.offers],
      ['never-searched', 1, true, true, null, []]);
    assert.deepEqual(activity.stateChanges.map((row) => [row.eventType, row.operation, row.briefVersion]), [['brief-changed', 'confirmed', 1]]);
  });

  const ticks = {};
  await step('release tick: the first window is released at the policy cue', async () => {
    const windows = (await assumption(f, 'supply.release.windows')).windows;
    const tick = await tickTo(f, label, { mode: 'next-release' });
    const released = tick.outcome('stock-release');
    assert.equal(released.kind, 'stock-released'); assert.equal(released.source.mode, 'synthetic');
    assert.equal(released.windowId, windows[0].windowId); assert.equal(released.releasedAt, seen.releaseCue);
    assert.equal(released.orderUuids.length, windows[0].cars.length);
    // Allocation runs in the same tick, so the cars it takes have already left the released state.
    const now = (await rows(f, 'stock')).filter((row) => row.release?.windowId === windows[0].windowId);
    assert.deepEqual(sortedIds(now), [...released.orderUuids].sort());
    assert.ok(now.every((row) => row.release.releasedAt === seen.releaseCue && row.available !== undefined));
    seen.released = released.orderUuids; ticks.first = tick;
    seen.outline.releaseWindows = [released.windowId, released.orderUuids.length];
    seen.outline.firstHandlers = tick.value.tick.handlerOrder.map((row) => row.handlerId);
  });

  await step('allocation: competing employees are ordered by the canonical tie-break and each gets one car', async () => {
    const rule = await assumption(f, 'allocation.tieBreak.rule'); const seed = await assumption(f, 'allocation.tieBreak.seed');
    const allocations = ticks.first.outcome('buddy-allocation').allocations;
    const planned = allocations.find((row) => row.evaluations.length === 2);
    assert.ok(planned, 'one allocation evaluated both employees');
    assert.deepEqual(planned.assumptions.slice(0, 2).map((row) => [row.key, row.value]),
      [['allocation.tieBreak.rule', rule], ['allocation.tieBreak.seed', seed]], 'the plan carries the policy values it used');
    const employees = await rows(f, 'employees');
    const due = (employeeId) => { const end = employees.find((row) => row.employeeId === employeeId).contract.manualContext.contracts[0].contractEndDate; return `${end}T00:00:00.000Z`; };
    const contenders = planned.evaluations.flatMap((evaluation) => evaluation.decisions
      .filter((decision) => decision.gateStatus === 'eligible')
      .map((decision) => ({ employeeId: evaluation.employeeId, orderUuid: decision.orderUuid, score: decision.score, renewalDue: due(evaluation.employeeId) })));
    const eligible = (id) => contenders.filter((row) => row.employeeId === id).map((row) => row.orderUuid);
    const shared = eligible('employee-paula').filter((id) => eligible('employee-alex').includes(id));
    assert.ok(shared.length >= 2, 'both employees are eligible for the same cars');
    const expected = expectedAssignments(rule, seed, seen.runId, contenders);
    const actual = new Map(allocations.flatMap((row) => row.assignments).map((row) => [row.employeeId, row.orderUuid]));
    assert.deepEqual([...actual.entries()].sort(), [...expected.entries()].sort(), 'winners follow the tie-break');
    assert.equal(actual.size, 2); assert.equal(new Set(actual.values()).size, 2, 'no car is given twice');
    seen.first.orderUuid = actual.get('employee-paula'); seen.alex.orderUuid = actual.get('employee-alex');
    assert.ok(shared.includes(seen.first.orderUuid) || shared.includes(seen.alex.orderUuid));
    seen.outline.contest = { rule, tieSeed: seed, shared: shared.length, assigned: actual.size };
  });

  await step('hold, offer and outbox: Paula holds her car, has a pending offer, and the message is captured', async () => {
    const duration = await assumption(f, 'hold.buddy.durationSeconds');
    const expiresAt = add(seen.releaseCue, duration / 60);
    const messages = good((await f.api('/api/gcsp/presenter/outbox')).json, 'outbox viewer').messages;
    for (const [name, who] of [['paula', seen.first], ['alex', seen.alex]]) {
      const employeeId = `employee-${name}`;
      const hold = (await rows(f, 'holds')).find((row) => row.employeeId === employeeId);
      assert.deepEqual([hold.type, hold.state, hold.orderUuid, hold.expiresAt], ['buddy-offer', 'active', who.orderUuid, expiresAt]);
      const offer = (await rows(f, 'offers')).find((row) => row.employeeId === employeeId);
      assert.deepEqual([offer.state, offer.holdId, offer.orderUuid, offer.briefVersion], ['active', hold.holdId, who.orderUuid, 1]);
      assert.equal((await rows(f, 'quotes')).find((row) => row.quoteId === hold.quoteId).briefVersion, 1);
      const car = (await rows(f, 'stock')).find((row) => row.orderUuid === who.orderUuid);
      assert.deepEqual([car.state, car.held, car.available, car.allocated], ['held', true, false, false]);
      if (name === 'paula') seen.outline.firstBody = car.facts.facts.body.value;
      const jobs = (await rows(f, 'notification_outbox')).filter((row) => row.recipientId === employeeId);
      assert.equal(jobs.length, 1); assert.deepEqual([jobs[0].state, jobs[0].messageKind, jobs[0].offerId, jobs[0].transport], ['sent', 'offer', offer.offerId, 'captured']);
      const message = messages.find((row) => row.jobId === jobs[0].jobId);
      assert.deepEqual([message.state, message.messageKind, message.recipient.employeeId], ['sent', 'offer', employeeId]);
      const link = new URL(message.offerLink, f.origin);
      assert.deepEqual([link.pathname, link.searchParams.get('offerId'), link.searchParams.get('runId')], ['/gcsp/offer', offer.offerId, seen.runId]);
      assert.ok(/^#token=[A-Za-z0-9_-]{20,}$/.test(link.hash), 'the link carries its token in the fragment');
      Object.assign(who, { holdId: hold.holdId, quoteId: hold.quoteId, offerId: offer.offerId, jobId: jobs[0].jobId, link: message.offerLink });
    }
    assert.equal(messages.length, 2);
    assert.notEqual(seen.first.offerId, seen.alex.offerId);
    await expectActivity(f, seen, { state: 'offer', offerId: seen.first.offerId, offerState: 'active', briefVersion: 1, checks: 1, carsChecked: seen.released.length });
  });

  await step('open the offer link: the token alone opens a pending offer for the held car', async () => {
    const opened = await openLink(f, seen.first.link);
    assert.equal(opened.reply.status, 200, JSON.stringify(opened.reply.json));
    const cookie = opened.reply.headers.get('set-cookie');
    for (const attribute of ['; Secure', '; HttpOnly', 'Path=/api/gcsp/offers']) assert.ok(cookie.includes(attribute), attribute);
    const view = await readOffer(f, opened.session, opened.selector);
    assert.deepEqual(opened.reply.json.value, view);
    assert.deepEqual([view.state, view.reason, view.offerId, view.runId], ['pending', 'awaiting-decision', seen.first.offerId, seen.runId]);
    assert.deepEqual([view.offerState, view.holdState, view.quote.orderUuid, view.quote.briefVersion], ['active', 'active', seen.first.orderUuid, 1]);
    assert.ok(view.availableActions.includes('decline'));
    assert.equal(view.expiresAt, (await rows(f, 'holds')).find((row) => row.holdId === seen.first.holdId).expiresAt);
    seen.first.selector = opened.selector; seen.first.session = opened.session;
  });

  await step('decline with a reason: the offer is declined, the hold released and the car available again', async () => {
    const policyReasons = (await assumption(f, 'offer.declineReasons.v1')).reasons;
    const { selector, session } = seen.first;
    const shown = good((await f.api(`${offerPath(selector)}/decision-reasons${query(selector)}`, { session })).json, 'reasons').reasons;
    assert.deepEqual(shown.map((row) => row.code), policyReasons.map((row) => row.code), 'the reasons shown are the policy reasons');
    const reason = policyReasons.find((row) => row.attribute === 'body'); assert.ok(reason, 'policy has a body-style reason');
    const view = await readOffer(f, session, selector);
    const body = { commandId: `${label}-decline`, runId: selector.runId, decision: 'decline', reasonCode: reason.code,
      expectedOfferVersion: view.offerVersion, expectedHoldVersion: view.holdVersion, expectedQuoteVersion: view.quote.revisions.quote };
    const declined = await f.api(`${offerPath(selector)}/decision`, { session, body });
    assert.equal(declined.status, 200, JSON.stringify(declined.json));
    assert.deepEqual([declined.json.value.state, declined.json.value.offerState, declined.json.value.holdState], ['declined', 'rejected', 'released']);
    assert.deepEqual((await f.api(`${offerPath(selector)}/decision`, { session, body })).json, declined.json, 'replay is idempotent');
    const after = await readOffer(f, session, selector);
    assert.deepEqual([after.state, after.offerState, after.holdState, after.availableActions], ['declined', 'rejected', 'released', []]);
    assert.equal(after.followup.decisionId, declined.json.value.decisionId);
    assert.match(after.followup.decisionId, /^offer-decision:[a-f0-9]{64}$/);
    const decision = (await rows(f, 'decisions')).find((row) => row.decisionId === after.followup.decisionId);
    assert.deepEqual([decision.decision, decision.reason.code, decision.offerId, decision.employeeId], ['decline', reason.code, seen.first.offerId, 'employee-paula']);
    const hold = (await rows(f, 'holds')).find((row) => row.holdId === seen.first.holdId);
    assert.deepEqual([hold.state, hold.releaseReason], ['released', 'offer-declined']);
    const car = (await rows(f, 'stock')).find((row) => row.orderUuid === seen.first.orderUuid);
    assert.deepEqual([car.state, car.held, car.available, car.allocated], ['released', false, true, false], 'the declined car is back on the shelf');
    const slot = (await rows(f, 'entitlement_slots')).find((row) => row.entitlementSlotId === 'slot-paula');
    assert.notEqual(slot.state, 'allocated', 'declining does not use up the entitlement');
    seen.first.decisionId = after.followup.decisionId; seen.first.reasonCode = reason.code;
    seen.outline.decline = [reason.code, declined.json.value.state, declined.json.value.offerState, declined.json.value.holdState, car.state];
    await expectActivity(f, seen, { state: 'offer-closed', offerId: seen.first.offerId, offerState: 'rejected', briefVersion: 1, checks: 1, carsChecked: seen.released.length });
  });

  await step('confirm one change: the follow-up question changes the body style and nothing else', async () => {
    const decisionId = seen.first.decisionId; const session = seen.sessions.paula;
    const asked = good((await f.api(`/api/gcsp/offer-followup?decisionId=${encodeURIComponent(decisionId)}`, { session })).json, 'follow-up');
    const policyQuestion = (await assumption(f, 'offer.followupQuestions.v1')).questions.find((row) => row.reasonCode === seen.first.reasonCode);
    const question = asked.question;
    assert.deepEqual([asked.state, asked.briefVersion, question.path, question.currentValue, question.control],
      ['question', 1, policyQuestion.path, 'estate', policyQuestion.control], 'the question is the policy question for the decline reason');
    const choice = policyQuestion.control.options.find((row) => row.value === 'saloon'); assert.ok(choice, 'saloon is an offered answer');
    const body = { commandId: `${label}-change`, decisionId, expectedBriefVersion: asked.briefVersion, questionVersion: question.questionVersion, value: choice.value };
    const saved = good((await f.api('/api/gcsp/offer-followup/confirm', { session, body })).json, 'confirm change');
    assert.deepEqual([saved.state, saved.briefVersion, saved.change], ['change-saved', 2, { path: policyQuestion.path, before: 'estate', after: 'saloon' }]);
    assert.deepEqual(good((await f.api('/api/gcsp/offer-followup/confirm', { session, body })).json), saved, 'replay is idempotent');
    const current = good((await f.api('/api/gcsp/brief', { session })).json, 'current brief').brief;
    assert.deepEqual([current.briefVersion, current.preferences.body.value, current.status], [2, 'saloon', 'confirmed']);
    assert.equal(current.essentials.seats.value, 5, 'only the one answered preference changed');
    const waiting = good((await f.api(`/api/gcsp/offer-followup?decisionId=${encodeURIComponent(decisionId)}`, { session })).json, 'waiting');
    assert.equal(waiting.state, 'waiting', 'no tick has looked at the new brief yet');
    assert.deepEqual(waiting.savedChange, saved);
    seen.change = saved;
    seen.outline.change = [saved.state, saved.briefVersion, saved.change];
    await expectActivity(f, seen, { state: 'offer-closed', offerId: seen.first.offerId, offerState: 'rejected', briefVersion: 2, checks: 1, carsChecked: seen.released.length });
  });

  await step('release again on the next tick: the second window is released and the second offer is made', async () => {
    const windows = (await assumption(f, 'supply.release.windows')).windows;
    const at = add(seen.releaseCue, windows[1].offsetMinutes);
    const tick = await tickTo(f, label, { mode: 'to', to: at });
    const released = tick.outcome('stock-release');
    assert.equal(tick.now, at);
    assert.deepEqual([released.kind, released.windowId, released.releasedAt, released.orderUuids.length], ['stock-released', windows[1].windowId, at, windows[1].cars.length]);
    seen.released2 = released.orderUuids;
    assert.equal((await rows(f, 'stock')).filter((row) => row.release).length, windows[0].cars.length + windows[1].cars.length);
    // Alex never answers; his first offer lapses before this tick's allocation if its policy deadline has passed.
    const duration = await assumption(f, 'hold.buddy.durationSeconds');
    const alexHold = await rowOf(f, 'holds', 'holdId', seen.alex.holdId);
    const lapses = Date.parse(alexHold.expiresAt) <= Date.parse(at);
    const lapsed = tick.outcome('buddy-expiry').expired;
    assert.deepEqual(lapsed.map((row) => row.holdId), lapses ? [seen.alex.holdId] : []);
    assert.equal(alexHold.expiresAt, add(seen.releaseCue, duration / 60));
    assert.deepEqual([alexHold.state, (await rowOf(f, 'offers', 'offerId', seen.alex.offerId)).state], lapses ? ['expired', 'expired'] : ['active', 'active']);
    if (lapses) assert.deepEqual([lapsed[0].expiredAt, alexHold.releaseReason], [at, 'buddy-expired']);
    // The saved brief change is the allocation trigger that finds Paula's second car.
    const exclusion = await assumption(f, 'offer.declinedCar.exclusion');
    const allocation = tick.outcome('buddy-allocation').allocations.find((row) => row.event.eventType === 'brief-changed'
      && row.event.employeeId === 'employee-paula' && row.event.briefVersion === seen.change.briefVersion);
    assert.ok(allocation, 'the change produced an allocation event');
    const mine = allocation.assignments.find((row) => row.employeeId === 'employee-paula');
    assert.ok(mine, 'Paula is assigned a second car');
    const evaluated = allocation.evaluations.find((row) => row.employeeId === 'employee-paula').decisions;
    const declinedCar = evaluated.find((row) => row.orderUuid === seen.first.orderUuid);
    assert.deepEqual(allocation.assumptions.find((row) => row.key === 'offer.declinedCar.exclusion').value, exclusion);
    assert.ok(!declinedCar.blockers.some((row) => row.code === 'declined-unchanged'), 'the relevant confirmed change lifts the exclusion; fit keeps the car away');
    assert.notEqual(mine.orderUuid, seen.first.orderUuid, 'the declined car is not offered again');
    assert.ok(!allocation.attempts.some((row) => row.employeeId === 'employee-paula' && row.orderUuid === seen.first.orderUuid));
    assert.ok(mine.score > declinedCar.score, 'the new brief fits the second car better than the declined one');
    assert.equal(new Set(allocation.assignments.map((row) => row.orderUuid)).size, allocation.assignments.length);
    seen.second.orderUuid = mine.orderUuid;
    seen.outline.secondTick = { handlers: tick.value.tick.handlerOrder.map((row) => row.handlerId), windowId: released.windowId, alexLapsed: lapses,
      secondScoreBeatsDeclined: mine.score > declinedCar.score };
    const car = (await rows(f, 'stock')).find((row) => row.orderUuid === mine.orderUuid);
    assert.deepEqual([car.state, car.held], ['held', true]);
    assert.equal(car.facts.facts.body.value, 'saloon');
    seen.second.windowId = car.release.windowId;
    const holds = (await rows(f, 'holds')).filter((row) => row.employeeId === 'employee-paula' && row.state === 'active');
    assert.equal(holds.length, 1, 'one active hold per employee');
    const hold = holds[0]; const offer = (await rows(f, 'offers')).find((row) => row.holdId === hold.holdId);
    assert.deepEqual([hold.orderUuid, hold.expiresAt, offer.state, offer.briefVersion, offer.orderUuid], [seen.second.orderUuid, add(at, duration / 60), 'active', 2, seen.second.orderUuid]);
    assert.notEqual(offer.offerId, seen.first.offerId);
    Object.assign(seen.second, { holdId: hold.holdId, offerId: offer.offerId, quoteId: hold.quoteId, now: at });
    const alexNext = (await rows(f, 'offers')).find((row) => row.employeeId === 'employee-alex' && row.state === 'active');
    seen.alex.second = alexNext && { offerId: alexNext.offerId, orderUuid: alexNext.orderUuid };
  });

  await step('second offer: the follow-up shows it, its message is captured and its link opens', async () => {
    const messages = good((await f.api('/api/gcsp/presenter/outbox')).json, 'outbox viewer').messages;
    const job = (await rows(f, 'notification_outbox')).find((row) => row.offerId === seen.second.offerId);
    assert.deepEqual([job.recipientId, job.messageKind, job.state, job.transport], ['employee-paula', 'offer', 'sent', 'captured']);
    const message = messages.find((row) => row.jobId === job.jobId);
    assert.deepEqual([message.state, message.recipient.employeeId, message.time], ['sent', 'employee-paula', seen.second.now]);
    assert.equal(messages.filter((row) => row.recipient.employeeId === 'employee-paula').length, 2);
    const link = new URL(message.offerLink, f.origin);
    assert.deepEqual([link.searchParams.get('offerId'), link.searchParams.get('runId')], [seen.second.offerId, seen.runId]);
    assert.notEqual(message.offerLink, seen.first.link);
    seen.second.jobId = job.jobId; seen.second.link = message.offerLink;
    const ready = good((await f.api(`/api/gcsp/offer-followup?decisionId=${encodeURIComponent(seen.first.decisionId)}`, { session: seen.sessions.paula })).json, 'follow-up');
    assert.deepEqual([ready.state, ready.comparison.next.offer.offerId, ready.comparison.next.offer.quote.briefVersion], ['ready', seen.second.offerId, 2]);
    const opened = await openLink(f, seen.second.link);
    assert.equal(opened.reply.status, 200, JSON.stringify(opened.reply.json));
    const view = await readOffer(f, opened.session, opened.selector);
    assert.deepEqual([view.state, view.offerState, view.holdState, view.quote.orderUuid, view.quote.briefVersion],
      ['pending', 'active', 'active', seen.second.orderUuid, 2]);
    seen.second.selector = opened.selector; seen.second.session = opened.session;
    await expectActivity(f, seen, { state: 'offer', offerId: seen.second.offerId, offerState: 'active', briefVersion: 2, checks: 2, carsChecked: seen.released.length + seen.released2.length });
  });

  await step('accept: the second offer is accepted and its car is allocated to Paula', async () => {
    await beforeAccept?.(seen);
    const { selector, session } = seen.second;
    const view = await readOffer(f, session, selector);
    assert.ok(view.availableActions.includes('accept')); assert.equal(view.handoff.blocker, null);
    const body = { commandId: `${label}-accept`, runId: selector.runId, decision: 'accept', expectedOfferVersion: view.offerVersion,
      expectedHoldVersion: view.holdVersion, expectedQuoteVersion: view.quote.revisions.quote, termsDigest: view.handoff.termsDigest,
      declarations: Object.fromEntries(view.handoff.declarations.map((row) => [row.id, true])) };
    const accepted = await f.api(`${offerPath(selector)}/decision`, { session, body });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    const value = accepted.json.value;
    assert.deepEqual([value.state, value.offerState, value.holdState], ['accepted', 'accepted', 'allocated']);
    // The decision is the only writer of these states; the hold, claim, slot and stock all follow the offer.
    const offer = await rowOf(f, 'offers', 'offerId', seen.second.offerId); const hold = await rowOf(f, 'holds', 'holdId', seen.second.holdId);
    const claim = (await rows(f, 'claims')).find((row) => row.holdId === seen.second.holdId);
    assert.deepEqual([offer.state, hold.state, claim.state], ['accepted', 'allocated', 'allocated']);
    const car = (await rows(f, 'stock')).find((row) => row.orderUuid === seen.second.orderUuid);
    assert.deepEqual([car.state, car.held, car.available, car.allocated], ['allocated', false, false, true]);
    assert.equal((await rowOf(f, 'entitlement_slots', 'entitlementSlotId', 'slot-paula')).state, 'allocated');
    const decision = (await rows(f, 'decisions')).find((row) => row.decisionId === value.decisionId);
    assert.deepEqual([decision.decision, decision.offerId, decision.employeeId], ['accept', seen.second.offerId, 'employee-paula']);
    assert.deepEqual((await f.api(`${offerPath(selector)}/decision`, { session, body })).json, accepted.json, 'replay is idempotent');
    seen.second.decisionId = value.decisionId; seen.handoff = value.selection;
    const after = await readOffer(f, session, selector);
    assert.deepEqual([after.state, after.availableActions], ['accepted', []]);
  });

  await step('hand off: the selection reaches the ordering adapter once and waits for the first approval stage', async () => {
    const selection = seen.handoff;
    const stages = await assumption(f, 'ordering.approvalStages.v1');
    assert.deepEqual([selection.operationState, selection.selectionReceived, selection.progress.selectionState], ['acknowledged', true, 'acknowledged']);
    assert.deepEqual(selection.progress.stages.map((row) => row.name), ['selection received', ...stages]);
    assert.deepEqual(selection.progress.stages.map((row) => row.state), ['complete', 'waiting', ...stages.slice(1).map(() => 'not-started')]);
    assert.deepEqual([selection.progress.current, selection.progress.approved], [stages[0], false]);
    assert.deepEqual([selection.order.status, selection.order.orderUuid, selection.order.orderStatus, selection.order.fictional], ['confirmed', seen.second.orderUuid, stages[0], true]);
    assert.deepEqual(selection.view, { state: 'awaiting-approval', action: 'view-order' });
    const operations = (await rows(f, 'pending_operations')).filter((row) => row.operationType === 'selection-order');
    assert.equal(operations.length, 1, 'one hand-off, even after the replayed decision');
    assert.deepEqual([operations[0].operationId, operations[0].state, operations[0].payload.selection.source.type, operations[0].payload.selection.stock.orderUuid],
      [selection.operationId, 'completed', 'buddy-offer', seen.second.orderUuid]);
    const order = good((await f.api('/api/gcsp/manual/order', { session: seen.sessions.paula })).json, 'order');
    assert.deepEqual([order.operationId, order.view.state, order.order.orderUuid], [selection.operationId, 'awaiting-approval', seen.second.orderUuid]);
    seen.operationId = selection.operationId;
    seen.outline.handoff = [selection.progress.current, selection.progress.stages.map((row) => [row.name, row.state]), selection.view, selection.order.orderStatus];
    await expectActivity(f, seen, { state: 'offer-closed', offerId: seen.second.offerId, offerState: 'accepted', briefVersion: 2, checks: 2, carsChecked: seen.released.length + seen.released2.length });
  });
  return seen;
}
